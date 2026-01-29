const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const cookieParser = require('cookie-parser');
const db = require('./database');
const logger = require('./logger');

const app = express();
const server = createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MEDIA_DIR = path.join(__dirname, 'media');
const LOGS_DIR = path.join(__dirname, 'logs');
const IS_DEV = process.argv.includes('--dev');

// Hidden chats (will not appear in chat list or messages)
const HIDDEN_CHATS = [
    '628113030640',           // +62 811-3030-640 (phone number)
    '28037663957043@lid',     // +62 811-3030-640 (lid format)
];

// Check if a chat ID should be hidden
function isHiddenChat(chatId) {
    if (!chatId) return false;
    return HIDDEN_CHATS.some(hidden => {
        if (hidden.includes('@')) {
            return chatId === hidden;
        }
        return chatId.includes(hidden);
    });
}

// Message queue for handling concurrent sends
const messageQueue = [];
let isProcessingQueue = false;

// Ensure media directory exists
if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use('/media', express.static(MEDIA_DIR));

// Auth middleware
function authMiddleware(req, res, next) {
    const sessionId = req.cookies.session;
    const user = db.verifySession(sessionId);
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    next();
}

function adminMiddleware(req, res, next) {
    if (!req.user.is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

// Serve login page for unauthenticated users
app.use((req, res, next) => {
    // Skip auth check for static files, API auth routes, and login page
    if (req.path.startsWith('/api/auth') || req.path === '/login.html' || req.path.startsWith('/media')) {
        return next();
    }

    const sessionId = req.cookies.session;
    const user = db.verifySession(sessionId);

    if (!user && !req.path.startsWith('/api/')) {
        return res.redirect('/login.html');
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Session directory for persistent login
const SESSION_DIR = path.join(__dirname, '.wwebjs_auth');

// Initialize WhatsApp client with persistent session
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: SESSION_DIR
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--mute-audio',
            '--no-default-browser-check',
            '--autoplay-policy=user-gesture-required',
            '--disable-background-networking',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--safebrowsing-disable-auto-update'
        ],
        timeout: 0  // No timeout
    }
    // No webVersionCache - use default
});

let isReady = false;
let currentQR = null;
let clientInitializing = false;
let isLoading = false; // Track if WhatsApp is loading from saved session

// Retry wrapper for puppeteer operations (handles detached frame errors)
async function withRetry(operation, maxRetries = 2, delay = 500) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (err) {
            const isRetryable = err.message?.includes('detached Frame') ||
                err.message?.includes('Execution context was destroyed') ||
                err.message?.includes('Protocol error');

            if (isRetryable && attempt < maxRetries) {
                await new Promise(r => setTimeout(r, delay * attempt));
                continue;
            }
            throw err;
        }
    }
}

// Save media file
async function saveMedia(message) {
    try {
        if (message.hasMedia) {
            const media = await message.downloadMedia();
            if (media) {
                const extension = mime.extension(media.mimetype) || 'bin';
                const filename = `${message.id._serialized.replace(/[^a-zA-Z0-9]/g, '_')}.${extension}`;
                const filepath = path.join(MEDIA_DIR, filename);

                fs.writeFileSync(filepath, Buffer.from(media.data, 'base64'));
                return { path: `/media/${filename}`, mimetype: media.mimetype };
            }
        }
    } catch (err) {
        console.error('Error saving media:', err);
    }
    return { path: null, mimetype: null };
}

// Save chat to database
async function saveChat(chat, unreadCount = null) {
    try {
        let profilePic = null;
        let chatName = chat.name || chat.id.user;

        // For non-group chats, try multiple sources for contact name
        if (!chat.isGroup && chatName.match(/^\+?\d[\d\s-]+$/)) {
            try {
                const contact = await chat.getContact();
                if (contact) {
                    // Enhanced fallback chain for contact names
                    // Priority: saved name > pushname > verified business name > phone number
                    chatName = contact.name ||           // Saved in WhatsApp
                               contact.pushname ||       // Profile name they set
                               contact.verifiedName ||   // Business verified name
                               contact.shortName ||      // Short version
                               chatName;                 // Keep phone number as last resort

                    try {
                        profilePic = await contact.getProfilePicUrl();
                    } catch (e) { }
                }
            } catch (e) { }
        } else {
            try {
                profilePic = await chat.getContact().then(c => c.getProfilePicUrl());
            } catch (e) { }
        }

        // Use provided unreadCount or get from chat object
        const unread = unreadCount !== null ? unreadCount : (chat.unreadCount || 0);

        db.insertChat(
            chat.id._serialized,
            chatName,
            chat.isGroup,
            profilePic,
            Date.now(),
            unread
        );
    } catch (err) {
        console.error('Error saving chat:', err);
    }
}

// Save contact to database
async function saveContact(contact) {
    try {
        let profilePic = null;
        try {
            profilePic = await contact.getProfilePicUrl();
        } catch (e) { }

        db.insertContact(
            contact.id._serialized,
            contact.number,
            contact.name || null,
            contact.pushname || null,
            profilePic,
            contact.isBusiness
        );
    } catch (err) {
        console.error('Error saving contact:', err);
    }
}

// Save message to database (with retry for detached frame errors)
async function saveMessage(message) {
    try {
        // Use retry wrapper for chat retrieval (most common failure point)
        const chat = await withRetry(() => message.getChat());

        // For sent messages, contact info might not be available the same way
        let senderId, senderName;
        if (message.fromMe) {
            // For sent messages, use 'me' as sender
            senderId = 'me';
            senderName = 'Me';
        } else {
            // For received messages, get contact info
            // Also try notifyName from message data as fallback
            const notifyName = message._data?.notifyName || message.notifyName;
            try {
                const contact = await withRetry(() => message.getContact());
                senderId = contact.id._serialized;
                // Enhanced fallback chain for sender name
                senderName = contact.name ||           // Saved in WhatsApp
                             contact.pushname ||       // Profile name
                             contact.verifiedName ||   // Business name
                             notifyName ||             // From message data
                             contact.number ||
                             'Unknown';
                await saveContact(contact);
            } catch (e) {
                senderId = message.from || 'unknown';
                senderName = notifyName || 'Unknown';
            }
        }

        await saveChat(chat);

        const mediaInfo = await saveMedia(message);

        // Get ack status (0=pending, 1=sent, 2=delivered, 3=read, 4=played)
        const ack = message.ack || 0;

        db.insertMessage(
            message.id._serialized,
            chat.id._serialized,
            senderId,
            senderName,
            message.body,
            message.type,
            message.timestamp * 1000,
            message.isForwarded,
            message.fromMe,
            message.hasMedia,
            mediaInfo.path,
            mediaInfo.mimetype,
            JSON.stringify(message),
            ack
        );

        // Update chat last message time (preserve unread count for incoming messages)
        const newUnread = message.fromMe ? 0 : undefined; // Don't change unread for incoming
        db.insertChat(
            chat.id._serialized,
            chat.name || chat.id.user,
            chat.isGroup,
            null,
            message.timestamp * 1000,
            newUnread
        );

        return {
            id: message.id._serialized,
            chatId: chat.id._serialized,
            chatName: chat.name || chat.id.user,
            senderId: senderId,
            senderName: senderName,
            body: message.body,
            type: message.type,
            timestamp: message.timestamp * 1000,
            isFromMe: message.fromMe,
            hasMedia: message.hasMedia,
            mediaPath: mediaInfo.path,
            mediaMimetype: mediaInfo.mimetype,
            ack: ack
        };
    } catch (err) {
        console.error('Error saving message:', err);
        return null;
    }
}

// WhatsApp Events
client.on('qr', async (qr) => {
    logger.whatsapp('QR', 'QR code received');
    isLoading = false; // QR means session restore failed, need fresh login
    loadingComplete = false;
    authComplete = false;
    if (readyTimeout) clearTimeout(readyTimeout);
    currentQR = await QRCode.toDataURL(qr);
    io.emit('qr', currentQR);
});

// Handle loading screen (WhatsApp is loading)
let loadingComplete = false;
let authComplete = false;
let readyTimeout = null;

async function loadChatsAndMessages(options = {}) {
    const { retryCount = 0, maxChats = 30, maxMessages = 50, lastHoursOnly = 0 } = options;
    const maxRetries = 3;
    const retryDelay = 5000;

    try {
        if (retryCount === 0) {
            console.log('Waiting for client to stabilize...');
            await new Promise(r => setTimeout(r, 3000));
        }

        const chats = await withRetry(() => client.getChats(), 3, 2000);

        // Filter chats by last activity time if lastHoursOnly specified
        let filteredChats = chats;
        if (lastHoursOnly > 0) {
            const cutoffTime = Date.now() - (lastHoursOnly * 60 * 60 * 1000);
            filteredChats = chats.filter(chat => {
                const lastMsgTime = chat.timestamp ? chat.timestamp * 1000 : 0;
                return lastMsgTime >= cutoffTime;
            });
            console.log(`Filtering to chats active in last ${lastHoursOnly} hour(s): ${filteredChats.length} chats`);
        }

        // Filter out hidden numbers
        filteredChats = filteredChats.filter(chat => !isHiddenChat(chat.id._serialized));

        const chatsToLoad = filteredChats.slice(0, maxChats);
        console.log(`Loading ${chatsToLoad.length} chats...`);

        for (const chat of chatsToLoad) {
            try {
                const unread = chat.unreadCount || 0;
                if (unread > 0) {
                    console.log(`  ${chat.name || chat.id.user}: ${unread} unread messages`);
                }
                await saveChat(chat, unread);

                const messages = await withRetry(() => chat.fetchMessages({ limit: maxMessages }), 2, 1000);

                // Filter messages by time if lastHoursOnly specified
                let filteredMessages = messages;
                if (lastHoursOnly > 0) {
                    const cutoffTime = Math.floor((Date.now() - (lastHoursOnly * 60 * 60 * 1000)) / 1000);
                    filteredMessages = messages.filter(msg => msg.timestamp >= cutoffTime);
                }

                console.log(`  ${chat.name || chat.id.user}: ${filteredMessages.length} messages`);

                for (const msg of filteredMessages) {
                    await saveMessage(msg);
                }
            } catch (e) {
                console.error(`  Error loading ${chat.name || chat.id.user}:`, e.message);
            }
        }

        console.log('Chat history loaded!');
        io.emit('chats_loaded');
    } catch (err) {
        console.error('Error loading chats:', err.message);

        if (retryCount < maxRetries && isReady) {
            console.log(`Retrying chat load in ${retryDelay/1000}s... (attempt ${retryCount + 1}/${maxRetries})`);
            await new Promise(r => setTimeout(r, retryDelay));
            return loadChatsAndMessages({ ...options, retryCount: retryCount + 1 });
        }

        io.emit('chats_loaded');
    }
}

function checkForceReady() {
    // If both loading 100% and auth happened but ready didn't fire, force it
    if (loadingComplete && authComplete && !isReady) {
        if (readyTimeout) clearTimeout(readyTimeout);
        readyTimeout = setTimeout(async () => {
            if (!isReady && loadingComplete && authComplete) {
                logger.whatsapp('READY-FORCE', 'Forcing ready state (auth+loading complete but no ready event)');
                isReady = true;
                isLoading = false;
                currentQR = null;

                // Try to get phone number and init DB
                try {
                    const info = client.info;
                    const phoneNumber = info?.wid?.user || info?.me?.user;
                    if (phoneNumber) {
                        console.log(`Connected as: ${phoneNumber}`);
                        await db.initDatabase(phoneNumber);
                    }
                } catch (e) {
                    console.log('Could not get phone number:', e.message);
                }

                // Manually attach event listeners since ready event didn't fire
                try {
                    console.log('Force-ready: Manually attaching event listeners...');
                    await client.pupPage.evaluate(() => {
                        // Check if listeners already attached
                        if (window._waEviListenersAttached) {
                            console.log('Listeners already attached');
                            return;
                        }
                        window._waEviListenersAttached = true;

                        // Attach message listener
                        window.Store.Msg.on('add', (msg) => {
                            if (msg.isNewMsg) {
                                if (msg.type === 'ciphertext') {
                                    msg.once('change:type', (_msg) => {
                                        if (window.onAddMessageEvent) {
                                            window.onAddMessageEvent(window.WWebJS.getMessageModel(_msg));
                                        }
                                    });
                                } else {
                                    if (window.onAddMessageEvent) {
                                        window.onAddMessageEvent(window.WWebJS.getMessageModel(msg));
                                    }
                                }
                            }
                        });

                        // Attach ack listener
                        window.Store.Msg.on('change:ack', (msg, ack) => {
                            if (window.onMessageAckEvent) {
                                window.onMessageAckEvent(window.WWebJS.getMessageModel(msg), ack);
                            }
                        });

                        console.log('Event listeners attached manually');
                    });
                    console.log('Force-ready: Event listeners attached!');

                    // Stop polling if it was started
                    stopMessagePolling();
                } catch (e) {
                    console.log('Force-ready: Could not attach event listeners:', e.message);
                    console.log('Force-ready: Falling back to polling...');
                    startMessagePolling();
                }

                io.emit('ready');
                io.emit('chats_loaded');
                console.log('Use /api/admin/whatsapp/sync to manually load chat history.');
            }
        }, 5000); // Wait 5 seconds after both conditions met
    }
}

// Polling for new messages (fallback when events don't work)
let pollingInterval = null;
let lastPolledTimestamp = Math.floor(Date.now() / 1000);

async function startMessagePolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }

    console.log('Starting message polling every 5 seconds...');

    pollingInterval = setInterval(async () => {
        if (!isReady) {
            console.log('Polling skipped: not ready');
            return;
        }

        try {
            const chats = await client.getChats();
            // Filter out hidden numbers
            const visibleChats = chats.filter(chat => !isHiddenChat(chat.id._serialized));

            for (const chat of visibleChats.slice(0, 10)) { // Check top 10 chats
                try {
                    const messages = await chat.fetchMessages({ limit: 5 });

                    for (const msg of messages) {
                        // Only process messages newer than last poll
                        if (msg.timestamp > lastPolledTimestamp) {
                            const direction = msg.fromMe ? 'SENT' : 'RECEIVED';
                            logger.whatsapp('POLL', `${direction}: ${msg.body?.substring(0, 30) || '[media]'}`);

                            const savedMessage = await saveMessage(msg);
                            if (savedMessage) {
                                io.emit('new_message', savedMessage);
                            }
                        }
                    }
                } catch (e) {
                    // Ignore individual chat errors
                }
            }

            lastPolledTimestamp = Math.floor(Date.now() / 1000);
        } catch (e) {
            console.log('Polling error:', e.message);
        }
    }, 5000); // Poll every 5 seconds
}

function stopMessagePolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        console.log('Message polling stopped');
    }
}

client.on('loading_screen', (percent, message) => {
    logger.whatsapp('LOADING', `${percent}% - ${message}`);
    isLoading = true;
    io.emit('loading', { percent, message });

    if (percent >= 99) {
        loadingComplete = true;
        checkForceReady();
    }
});

client.on('ready', async () => {
    logger.whatsapp('READY', 'WhatsApp client is ready!');
    if (readyTimeout) clearTimeout(readyTimeout);
    loadingComplete = false;
    authComplete = false;
    isReady = true;
    isLoading = false;
    currentQR = null;
    io.emit('ready');

    // Get the connected phone number and reinitialize database for this account
    try {
        const info = client.info;
        const phoneNumber = info?.wid?.user || info?.me?.user;
        if (phoneNumber) {
            console.log(`Connected as: ${phoneNumber}`);
            await db.initDatabase(phoneNumber);
        }
    } catch (e) {
        console.log('Could not get phone number, using default database');
    }

    // Load chats and messages
    await loadChatsAndMessages();
});

client.on('authenticated', () => {
    logger.whatsapp('AUTH', 'Authentication successful!');
    authComplete = true;
    io.emit('authenticated');
    checkForceReady();
});

client.on('auth_failure', (msg) => {
    logger.error('Authentication failed:', msg);
    isLoading = false;
    isReady = false;
    currentQR = null;
    io.emit('auth_failure', msg);
});

client.on('disconnected', (reason) => {
    logger.whatsapp('DISCONNECT', 'Client disconnected:', reason);
    isReady = false;
    isLoading = false;
    io.emit('disconnected', reason);
});

// Debug: catch any client errors
client.on('change_state', (state) => {
    logger.whatsapp('STATE', `State changed to: ${state}`);
});

client.on('change_battery', (info) => {
    logger.whatsapp('BATTERY', `Battery: ${info.battery}% plugged: ${info.plugged}`);
    // If we get battery info, client should be ready
    if (!isReady && info.battery !== undefined) {
        logger.whatsapp('READY-FIX', 'Got battery event but not ready - forcing ready state');
        isReady = true;
        isLoading = false;
        io.emit('ready');
    }
});

// Debug: Log all raw events
client.on('message', (message) => {
    logger.whatsapp('EVENT:message', `from=${message.from} body=${message.body?.substring(0, 30) || '[media]'}`);
});

client.on('message_ack', (message, ack) => {
    logger.whatsapp('EVENT:message_ack', `id=${message.id._serialized?.substring(0, 20)} ack=${ack}`);
});

client.on('message_reaction', (reaction) => {
    logger.whatsapp('EVENT:message_reaction', `${reaction.reaction} on ${reaction.msgId?._serialized?.substring(0, 20)}`);
});

// Handle ALL messages (both sent and received) via message_create
client.on('message_create', async (message) => {
    // Skip hidden numbers
    if (isHiddenChat(message.from) || isHiddenChat(message.to)) {
        return;
    }

    const direction = message.fromMe ? 'SENT' : 'RECEIVED';
    logger.whatsapp('EVENT:message_create', `${direction} from=${message.from} to=${message.to} body=${message.body?.substring(0, 30) || '[media]'}`);
    console.log(`Message ${direction}: ${message.body?.substring(0, 50) || '[media]'}`);

    const savedMessage = await saveMessage(message);
    if (savedMessage) {
        io.emit('new_message', savedMessage);

        // Auto-assign chat to agent if it's a new incoming message
        if (!message.fromMe) {
            const chatId = message.from || message.to;
            const assignment = db.autoAssignChat(chatId, message.body || '');
            if (assignment) {
                console.log(`Auto-assigned chat ${chatId} to ${assignment.username}`);
                io.emit('chat_assigned', {
                    chatId: chatId,
                    userId: assignment.user_id,
                    username: assignment.username
                });
            }
        }
    }
});

// Message deleted
client.on('message_revoke_everyone', async (message, revokedMsg) => {
    console.log('Message deleted detected');
    if (revokedMsg) {
        db.markMessageDeleted(revokedMsg.id._serialized, Date.now());
        io.emit('message_deleted', {
            id: revokedMsg.id._serialized,
            deletedAt: Date.now()
        });
    }
});

// Message ACK (read receipts) - 0=pending, 1=sent, 2=delivered, 3=read, 4=played
client.on('message_ack', (message, ack) => {
    const messageId = message.id._serialized;
    console.log(`Message ACK: ${messageId} -> ${ack}`);
    db.updateMessageAck(messageId, ack);
    io.emit('message_ack', { id: messageId, ack: ack });
});

// Message edited
client.on('message_edit', async (message, newBody, prevBody) => {
    const messageId = message.id._serialized;
    console.log(`Message EDITED: ${messageId} - "${prevBody}" -> "${newBody}"`);
    db.markMessageEdited(messageId, newBody, Date.now());
    io.emit('message_edited', {
        id: messageId,
        newBody: newBody,
        prevBody: prevBody,
        editedAt: Date.now()
    });
});

// ============ AUTH ROUTES ============
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.verifyUser(username, password);

    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const sessionId = db.createSession(user.id);
    res.cookie('session', sessionId, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
    res.json({ success: true, user: { id: user.id, username: user.username, is_admin: user.is_admin } });
});

app.post('/api/auth/logout', (req, res) => {
    const sessionId = req.cookies.session;
    if (sessionId) {
        db.deleteSession(sessionId);
    }
    res.clearCookie('session');
    res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
    const sessionId = req.cookies.session;
    const user = db.verifySession(sessionId);
    if (!user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json({ user: { id: user.id, username: user.username, is_admin: user.is_admin } });
});

// ============ ADMIN ROUTES ============
app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const users = db.getUsers();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
    const { username, password, isAdmin } = req.body;
    const result = db.createUser(username, password, isAdmin);
    if (result.success) {
        res.json({ success: true });
    } else {
        res.status(400).json({ error: result.error });
    }
});

app.delete('/api/admin/users/:userId', authMiddleware, adminMiddleware, (req, res) => {
    const userId = parseInt(req.params.userId);
    if (userId === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    db.deleteUser(userId);
    res.json({ success: true });
});

app.get('/api/admin/users/:userId/permissions', authMiddleware, adminMiddleware, (req, res) => {
    const userId = parseInt(req.params.userId);
    const permissions = db.getUserPermissions(userId);
    res.json(permissions);
});

app.post('/api/admin/users/:userId/permissions', authMiddleware, adminMiddleware, (req, res) => {
    const userId = parseInt(req.params.userId);
    const { chatId, canRead, canSend } = req.body;
    db.setUserPermission(userId, chatId, canRead, canSend);
    res.json({ success: true });
});

app.delete('/api/admin/users/:userId/permissions/:chatId', authMiddleware, adminMiddleware, (req, res) => {
    const userId = parseInt(req.params.userId);
    const chatId = decodeURIComponent(req.params.chatId);
    db.removeUserPermission(userId, chatId);
    res.json({ success: true });
});

app.get('/api/admin/permissions/all', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const permissions = db.getAllPermissions();
        res.json(permissions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ SETTINGS ROUTES ============
app.get('/api/admin/settings', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const settings = db.getAllSettings();
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/settings', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { key, value } = req.body;
        db.setSetting(key, value);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ ASSIGNMENT ROUTES ============
app.get('/api/admin/assignments', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const assignments = db.getAllAssignments();
        res.json(assignments);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/assignments', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { chatId, userId } = req.body;
        db.assignChatToUser(chatId, userId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/assignments/:chatId', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const chatId = decodeURIComponent(req.params.chatId);
        db.unassignChat(chatId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ KEYWORD RULES ROUTES ============
app.get('/api/admin/keywords', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const rules = db.getAllKeywordRules();
        res.json(rules);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/keywords', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { keyword, userId, priority } = req.body;
        db.addKeywordRule(keyword, userId, priority || 0);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/keywords/:id', authMiddleware, adminMiddleware, (req, res) => {
    try {
        db.removeKeywordRule(parseInt(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get available agents for assignment
app.get('/api/admin/agents', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const agents = db.getAvailableAgents();
        res.json(agents);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Sync/reload chats from WhatsApp
app.post('/api/admin/whatsapp/sync', authMiddleware, adminMiddleware, async (req, res) => {
    if (!isReady) {
        return res.status(503).json({ error: 'WhatsApp not connected' });
    }
    try {
        const hours = parseInt(req.query.hours) || 0; // 0 = no time limit
        const maxChats = parseInt(req.query.chats) || 30;
        const maxMessages = parseInt(req.query.messages) || 50;

        console.log(`Sync requested: hours=${hours}, maxChats=${maxChats}, maxMessages=${maxMessages}`);
        res.json({ success: true, message: 'Sync started', options: { hours, maxChats, maxMessages } });

        await loadChatsAndMessages({ lastHoursOnly: hours, maxChats, maxMessages });
    } catch (err) {
        console.error('Sync error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Logout WhatsApp (disconnect and require new QR scan)
app.post('/api/admin/whatsapp/logout', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        console.log('WhatsApp logout requested by admin');
        await client.logout();
        isReady = false;
        isLoading = false;
        currentQR = null;
        res.json({ success: true, message: 'WhatsApp logged out successfully' });
    } catch (err) {
        console.error('WhatsApp logout error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Restart WhatsApp client (for stuck sessions)
app.post('/api/admin/whatsapp/restart', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        console.log('WhatsApp restart requested by admin');
        isReady = false;
        isLoading = true;
        currentQR = null;

        // Try to destroy existing client
        try {
            await client.destroy();
        } catch (e) {
            console.log('Client destroy error (continuing):', e.message);
        }

        // Reinitialize
        setTimeout(() => {
            console.log('Reinitializing WhatsApp client...');
            client.initialize();
        }, 2000);

        res.json({ success: true, message: 'WhatsApp client restarting...' });
    } catch (err) {
        console.error('WhatsApp restart error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Clear session and restart (forces new QR scan)
app.post('/api/admin/whatsapp/clear-session', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        console.log('WhatsApp session clear requested by admin');
        isReady = false;
        isLoading = false;
        currentQR = null;

        // Try to destroy existing client
        try {
            await client.destroy();
        } catch (e) {
            console.log('Client destroy error (continuing):', e.message);
        }

        // Delete session folder
        if (fs.existsSync(SESSION_DIR)) {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            console.log('Session folder deleted:', SESSION_DIR);
        }

        // Reinitialize after short delay
        setTimeout(() => {
            console.log('Reinitializing WhatsApp client (fresh session)...');
            isLoading = true;
            client.initialize();
        }, 2000);

        res.json({ success: true, message: 'Session cleared, new QR code will appear shortly' });
    } catch (err) {
        console.error('WhatsApp clear session error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Execute command on server (admin only)
const { exec } = require('child_process');

function executeCommand(command, res, username) {
    logger.info(`Admin ${username} executing command: ${command}`);

    // Use cmd.exe on Windows to avoid PowerShell script restrictions
    exec(command, {
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 5, // 5MB max output
        cwd: process.cwd(),
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
    }, (error, stdout, stderr) => {
        const output = {
            stdout: stdout || '',
            stderr: stderr || '',
            error: error ? error.message : null,
            exitCode: error ? error.code : 0
        };

        logger.info(`Command result: exit=${output.exitCode}, stdout=${stdout?.length || 0} bytes, stderr=${stderr?.length || 0} bytes`);

        res.json(output);
    });
}

// POST /api/admin/exec - JSON body with command
app.post('/api/admin/exec', authMiddleware, adminMiddleware, (req, res) => {
    const { command } = req.body;

    if (!command || typeof command !== 'string') {
        return res.status(400).json({ error: 'Command is required' });
    }

    executeCommand(command, res, req.user.username);
});

// GET /api/admin/exec?cmd=... - easier to use from curl
app.get('/api/admin/exec', authMiddleware, adminMiddleware, (req, res) => {
    const command = req.query.cmd;

    if (!command || typeof command !== 'string') {
        return res.status(400).json({
            error: 'Command is required',
            usage: '/api/admin/exec?cmd=your_command_here',
            examples: [
                '/api/admin/exec?cmd=dir',
                '/api/admin/exec?cmd=type package.json',
                '/api/admin/exec?cmd=node -v'
            ]
        });
    }

    executeCommand(command, res, req.user.username);
});

// Get server info (admin only)
app.get('/api/admin/server-info', authMiddleware, adminMiddleware, (req, res) => {
    res.json({
        platform: process.platform,
        nodeVersion: process.version,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        cwd: process.cwd(),
        whatsappReady: isReady,
        whatsappLoading: isLoading
    });
});

// ============ API ROUTES ============
app.get('/api/status', (req, res) => {
    res.json({
        ready: isReady,
        loading: isLoading,
        qr: !isReady ? currentQR : null,
        stuck: isLoading && !isReady && !currentQR // Helpful for debugging
    });
});

// Dev-only log viewer endpoint
app.get('/api/logs', (req, res) => {
    if (!IS_DEV) {
        return res.status(403).json({ error: 'Logs only available in dev mode' });
    }

    try {
        const logFile = req.query.file || 'server';
        const lines = parseInt(req.query.lines) || 100;
        const date = req.query.date || new Date().toISOString().split('T')[0];

        const filename = `${logFile}-${date}.log`;
        const filepath = path.join(LOGS_DIR, filename);

        if (!fs.existsSync(filepath)) {
            return res.status(404).json({ error: `Log file not found: ${filename}` });
        }

        const content = fs.readFileSync(filepath, 'utf8');
        const logLines = content.trim().split('\n');
        const lastLines = logLines.slice(-lines);

        res.type('text/plain').send(lastLines.join('\n'));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List available log files (dev only)
app.get('/api/logs/list', (req, res) => {
    if (!IS_DEV) {
        return res.status(403).json({ error: 'Logs only available in dev mode' });
    }

    try {
        if (!fs.existsSync(LOGS_DIR)) {
            return res.json([]);
        }
        const files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.log'));
        res.json(files);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/chats', authMiddleware, (req, res) => {
    try {
        const chats = db.getUserChats(req.user.id, req.user.is_admin);
        // Filter out hidden numbers
        const filteredChats = chats.filter(chat => !isHiddenChat(chat.id));
        res.json(filteredChats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/chats/:chatId/messages', authMiddleware, (req, res) => {
    try {
        // Block access to hidden chats
        if (isHiddenChat(req.params.chatId)) {
            return res.status(404).json({ error: 'Chat not found' });
        }
        const messages = db.getMessages(req.params.chatId);
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Mark chat as read (clear unread count)
app.post('/api/chats/:chatId/read', authMiddleware, async (req, res) => {
    const chatId = decodeURIComponent(req.params.chatId);

    try {
        // Update database
        db.updateChatUnreadCount(chatId, 0);

        // Optionally send seen to WhatsApp (mark messages as read on their end)
        // Note: This may fail with force-ready state, but local read status still works
        if (isReady) {
            try {
                const chat = await client.getChatById(chatId);
                if (chat && typeof chat.sendSeen === 'function') {
                    await chat.sendSeen();
                }
            } catch (e) {
                // Silently ignore - expected with force-ready state
            }
        }

        // Notify all clients about the read status
        io.emit('chat_read', { chatId, unreadCount: 0 });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/deleted', authMiddleware, (req, res) => {
    try {
        const messages = db.getDeletedMessages();
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/edited', authMiddleware, (req, res) => {
    try {
        const messages = db.getEditedMessages();
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/modified', authMiddleware, (req, res) => {
    try {
        const messages = db.getModifiedMessages();
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/search', authMiddleware, (req, res) => {
    try {
        const query = req.query.q || '';
        const messages = db.searchMessages(query);
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ SEND MESSAGE ============
async function processMessageQueue() {
    if (isProcessingQueue || messageQueue.length === 0) return;

    isProcessingQueue = true;

    while (messageQueue.length > 0) {
        const { chatId, message, resolve, reject } = messageQueue.shift();

        try {
            // Get the chat
            const chat = await client.getChatById(chatId);

            // Send typing indicator
            try {
                await chat.sendStateTyping();
            } catch (e) {
                console.log('Typing indicator failed, continuing...');
            }

            // Calculate typing delay based on message length (50ms per character, min 1s, max 5s)
            const typingDelay = Math.min(Math.max(message.length * 50, 1000), 5000);
            await new Promise(r => setTimeout(r, typingDelay));

            // Send the message with sendSeen disabled to avoid markedUnread errors on @lid chats
            const sentMessage = await client.sendMessage(chatId, message, { sendSeen: false });

            // Clear typing state
            try {
                await chat.clearState();
            } catch (e) {
                // Ignore clear state errors
            }

            resolve(sentMessage);
        } catch (err) {
            reject(err);
        }

        // Add delay between messages from queue (500ms)
        if (messageQueue.length > 0) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    isProcessingQueue = false;
}

app.post('/api/chats/:chatId/send', authMiddleware, async (req, res) => {
    const chatId = req.params.chatId;
    const { message } = req.body;

    if (!isReady) {
        return res.status(503).json({ error: 'WhatsApp not connected' });
    }

    if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Message cannot be empty' });
    }

    // Check permission
    if (!db.canUserSendToChat(req.user.id, chatId, req.user.is_admin)) {
        return res.status(403).json({ error: 'No permission to send to this chat' });
    }

    try {
        // Add to queue and wait for result
        const sentMessage = await new Promise((resolve, reject) => {
            messageQueue.push({ chatId, message: message.trim(), resolve, reject });
            processMessageQueue();
        });

        res.json({ success: true, messageId: sentMessage.id._serialized });
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Typing indicator endpoint
app.post('/api/chats/:chatId/typing', authMiddleware, async (req, res) => {
    const chatId = req.params.chatId;
    const { typing } = req.body;

    if (!isReady) {
        return res.status(503).json({ error: 'WhatsApp not connected' });
    }

    try {
        const chat = await client.getChatById(chatId);
        if (typing) {
            await chat.sendStateTyping();
        } else {
            await chat.clearState();
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Socket.io connection with authentication
io.use((socket, next) => {
    const cookies = socket.handshake.headers.cookie;
    if (cookies) {
        const sessionMatch = cookies.match(/session=([^;]+)/);
        if (sessionMatch) {
            const user = db.verifySession(sessionMatch[1]);
            if (user) {
                socket.user = user;
                return next();
            }
        }
    }
    next(new Error('Authentication required'));
});

io.on('connection', (socket) => {
    logger.socket('CONNECT', `User ${socket.user.username} connected`);
    logger.debug(`State: isReady=${isReady}, isLoading=${isLoading}, hasQR=${!!currentQR}`);

    // Join user-specific room
    socket.join(`user_${socket.user.id}`);

    // Send current status - include loading state so frontend knows if session is being restored
    logger.socket('EMIT', `status: ready=${isReady}, loading=${isLoading}`);
    socket.emit('status', { ready: isReady, loading: isLoading, user: socket.user });

    // If already ready, emit ready event so frontend switches to dashboard
    if (isReady) {
        logger.socket('EMIT', 'ready event');
        socket.emit('ready');
    } else if (currentQR && socket.user.is_admin) {
        logger.socket('EMIT', 'qr event');
        socket.emit('qr', currentQR);
    } else {
        logger.debug('Not ready yet, no QR to show');
    }

    // Handle typing events from client
    socket.on('start_typing', async (chatId) => {
        if (!isReady) return;
        if (!db.canUserSendToChat(socket.user.id, chatId, socket.user.is_admin)) return;

        try {
            const chat = await client.getChatById(chatId);
            await chat.sendStateTyping();
        } catch (err) {
            console.error('Typing error:', err);
        }
    });

    socket.on('stop_typing', async (chatId) => {
        if (!isReady) return;

        try {
            const chat = await client.getChatById(chatId);
            await chat.clearState();
        } catch (err) {
            console.error('Clear typing error:', err);
        }
    });

    socket.on('disconnect', () => {
        console.log(`User ${socket.user.username} disconnected`);
    });
});

// Start server
async function start() {
    // Initialize database first
    await db.initDatabase();

    server.listen(PORT, () => {
        console.log(`\n========================================`);
        console.log(`  WhatsApp Archive Dashboard`);
        console.log(`  Open: http://localhost:${PORT}`);
        if (IS_DEV) {
            console.log(`  Mode: DEVELOPMENT`);
            console.log(`  Logs: http://localhost:${PORT}/api/logs`);
        }
        console.log(`========================================\n`);

        // Initialize WhatsApp client
        console.log('Initializing WhatsApp client...');
        isLoading = true; // Mark as loading before client.initialize() so frontend knows
        client.initialize();

        // Timeout for stuck initialization (2 minutes)
        setTimeout(() => {
            if (isLoading && !isReady && !currentQR) {
                console.log('WARNING: Initialization stuck - no QR or ready after 2 minutes');
                console.log('Session may be corrupted. Use /api/admin/whatsapp/restart to retry.');
                io.emit('init_timeout', { message: 'Initialization stuck - restart may be needed' });
            }
        }, 120000);
    });
}

start().catch(console.error);
