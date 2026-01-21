const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const db = require('./database');

const app = express();
const server = createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MEDIA_DIR = path.join(__dirname, 'media');

// Ensure media directory exists
if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(MEDIA_DIR));

// Session directory for persistent login
const SESSION_DIR = path.join(__dirname, '.wwebjs_auth');

// Initialize WhatsApp client with persistent session
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: SESSION_DIR
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

let isReady = false;
let currentQR = null;

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
async function saveChat(chat) {
    try {
        let profilePic = null;
        try {
            profilePic = await chat.getContact().then(c => c.getProfilePicUrl());
        } catch (e) {}

        db.insertChat(
            chat.id._serialized,
            chat.name || chat.id.user,
            chat.isGroup,
            profilePic,
            Date.now()
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
        } catch (e) {}

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

// Save message to database
async function saveMessage(message) {
    try {
        const chat = await message.getChat();

        // For sent messages, contact info might not be available the same way
        let senderId, senderName;
        if (message.fromMe) {
            // For sent messages, use 'me' as sender
            senderId = 'me';
            senderName = 'Me';
        } else {
            // For received messages, get contact info
            try {
                const contact = await message.getContact();
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
            JSON.stringify(message)
        );

        // Update chat last message time
        db.insertChat(
            chat.id._serialized,
            chat.name || chat.id.user,
            chat.isGroup,
            null,
            message.timestamp * 1000
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
            mediaMimetype: mediaInfo.mimetype
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

client.on('ready', async () => {
    console.log('WhatsApp client is ready!');
    isReady = true;
    currentQR = null;
    io.emit('ready');

    // Load existing chats
    try {
        const chats = await client.getChats();
        for (const chat of chats.slice(0, 50)) {
            await saveChat(chat);
        }
        io.emit('chats_loaded');
    } catch (err) {
        console.error('Error loading chats:', err);
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

// API Routes
app.get('/api/status', (req, res) => {
    res.json({ ready: isReady, qr: !isReady ? currentQR : null });
});

app.get('/api/chats', (req, res) => {
    try {
        const chats = db.getChats();
        res.json(chats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/chats/:chatId/messages', (req, res) => {
    try {
        const messages = db.getMessages(req.params.chatId);
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/deleted', (req, res) => {
    try {
        const messages = db.getDeletedMessages();
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/search', (req, res) => {
    try {
        const query = req.query.q || '';
        const messages = db.searchMessages(query);
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Socket.io connection
io.on('connection', (socket) => {
    console.log('Dashboard client connected');

    // Send current status
    socket.emit('status', { ready: isReady });
    if (!isReady && currentQR) {
        socket.emit('qr', currentQR);
    }

    socket.on('disconnect', () => {
        console.log('Dashboard client disconnected');
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
