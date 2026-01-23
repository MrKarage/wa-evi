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

const app = express();
const server = createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MEDIA_DIR = path.join(__dirname, 'media');

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
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        timeout: 120000
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/nicoh00/nicoh_whatsappstorage/master/md.json'
    }
});

let isReady = false;
let currentQR = null;
let clientInitializing = false;

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
        try {
            profilePic = await chat.getContact().then(c => c.getProfilePicUrl());
        } catch (e) { }

        // Use provided unreadCount or get from chat object
        const unread = unreadCount !== null ? unreadCount : (chat.unreadCount || 0);

        db.insertChat(
            chat.id._serialized,
            chat.name || chat.id.user,
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
            try {
                const contact = await withRetry(() => message.getContact());
                senderId = contact.id._serialized;
                senderName = contact.pushname || contact.name || contact.number || 'Unknown';
                await saveContact(contact);
            } catch (e) {
                senderId = message.from || 'unknown';
                senderName = 'Unknown';
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
    console.log('QR code received');
    currentQR = await QRCode.toDataURL(qr);
    io.emit('qr', currentQR);
});

// Handle loading screen (WhatsApp is loading)
client.on('loading_screen', (percent, message) => {
    console.log(`WhatsApp loading: ${percent}% - ${message}`);
    io.emit('loading', { percent, message });
});

client.on('ready', async () => {
    console.log('WhatsApp client is ready!');
    isReady = true;
    currentQR = null;
    io.emit('ready');

    // Get the connected phone number and reinitialize database for this account
    try {
        const info = client.info;
        const phoneNumber = info?.wid?.user || info?.me?.user;
        if (phoneNumber) {
            console.log(`Connected as: ${phoneNumber}`);
            // Reinitialize database for this specific account
            await db.initDatabase(phoneNumber);
        }
    } catch (e) {
        console.log('Could not get phone number, using default database');
    }

    // Load existing chats and their message history
    try {
        const chats = await withRetry(() => client.getChats());
        console.log(`Loading ${Math.min(chats.length, 30)} chats...`);

        for (const chat of chats.slice(0, 30)) {
            try {
                // Debug: log unread count from WhatsApp
                const unread = chat.unreadCount || 0;
                if (unread > 0) {
                    console.log(`  ${chat.name || chat.id.user}: ${unread} unread messages`);
                }
                await saveChat(chat, unread);

                // Fetch message history for each chat (with retry)
                const messages = await withRetry(() => chat.fetchMessages({ limit: 50 }), 2, 1000);
                console.log(`  ${chat.name || chat.id.user}: ${messages.length} messages`);

                for (const msg of messages) {
                    await saveMessage(msg);
                }
            } catch (e) {
                // Log but continue with other chats
                console.error(`  Error loading ${chat.name || chat.id.user}:`, e.message);
            }
        }

        console.log('Chat history loaded!');
        io.emit('chats_loaded');
    } catch (err) {
        console.error('Error loading chats:', err.message);
        io.emit('chats_loaded'); // Still emit so UI doesn't hang
    }
});

client.on('authenticated', () => {
    console.log('Authentication successful!');
    io.emit('authenticated');
});

client.on('auth_failure', (msg) => {
    console.error('Authentication failed:', msg);
    io.emit('auth_failure', msg);
});

client.on('disconnected', (reason) => {
    console.log('Client disconnected:', reason);
    isReady = false;
    io.emit('disconnected', reason);
});

// Handle ALL messages (both sent and received) via message_create
client.on('message_create', async (message) => {
    const direction = message.fromMe ? 'SENT' : 'RECEIVED';
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

// Logout WhatsApp (disconnect and require new QR scan)
app.post('/api/admin/whatsapp/logout', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        console.log('WhatsApp logout requested by admin');
        await client.logout();
        isReady = false;
        currentQR = null;
        res.json({ success: true, message: 'WhatsApp logged out successfully' });
    } catch (err) {
        console.error('WhatsApp logout error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ API ROUTES ============
app.get('/api/status', (req, res) => {
    res.json({ ready: isReady, qr: !isReady ? currentQR : null });
});

app.get('/api/chats', authMiddleware, (req, res) => {
    try {
        const chats = db.getUserChats(req.user.id, req.user.is_admin);
        res.json(chats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/chats/:chatId/messages', authMiddleware, (req, res) => {
    try {
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
        if (isReady) {
            try {
                const chat = await client.getChatById(chatId);
                await chat.sendSeen();
            } catch (e) {
                // Ignore WhatsApp errors, local read status is still updated
                console.log('Could not send seen to WhatsApp:', e.message);
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
    console.log(`User ${socket.user.username} connected`);

    // Join user-specific room
    socket.join(`user_${socket.user.id}`);

    // Send current status
    socket.emit('status', { ready: isReady, user: socket.user });
    if (!isReady && currentQR && socket.user.is_admin) {
        socket.emit('qr', currentQR);
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
        console.log(`========================================\n`);

        // Initialize WhatsApp client
        console.log('Initializing WhatsApp client...');
        client.initialize();
    });
}

start().catch(console.error);
