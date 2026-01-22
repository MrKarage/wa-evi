const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'whatsapp_archive.db');

let db = null;
let SQL = null;

// Initialize database
async function initDatabase() {
    SQL = await initSqlJs();

    // Load existing database or create new one
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    // Create tables
    db.run(`
        CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            name TEXT,
            is_group INTEGER DEFAULT 0,
            profile_pic TEXT,
            last_message_time INTEGER,
            created_at INTEGER
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS contacts (
            id TEXT PRIMARY KEY,
            number TEXT,
            name TEXT,
            pushname TEXT,
            profile_pic TEXT,
            is_business INTEGER DEFAULT 0,
            created_at INTEGER
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            chat_id TEXT,
            sender_id TEXT,
            sender_name TEXT,
            body TEXT,
            type TEXT,
            timestamp INTEGER,
            is_forwarded INTEGER DEFAULT 0,
            is_from_me INTEGER DEFAULT 0,
            has_media INTEGER DEFAULT 0,
            media_path TEXT,
            media_mimetype TEXT,
            is_deleted INTEGER DEFAULT 0,
            deleted_at INTEGER,
            raw_data TEXT,
            created_at INTEGER
        )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_deleted ON messages(is_deleted)`);

    // Users table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            is_admin INTEGER DEFAULT 0,
            created_at INTEGER
        )
    `);

    // User chat permissions
    db.run(`
        CREATE TABLE IF NOT EXISTS user_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL,
            can_read INTEGER DEFAULT 1,
            can_send INTEGER DEFAULT 0,
            created_at INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, chat_id)
        )
    `);

    // Sessions table
    db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at INTEGER,
            expires_at INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // Create default admin if not exists
    const adminExists = db.exec("SELECT id FROM users WHERE username = 'admin'");
    if (adminExists.length === 0 || adminExists[0].values.length === 0) {
        const crypto = require('crypto');
        const defaultPassword = crypto.createHash('sha256').update('admin123').digest('hex');
        db.run(`INSERT INTO users (username, password, is_admin, created_at) VALUES ('admin', '${defaultPassword}', 1, ${Date.now()})`);
        console.log('Default admin created: admin / admin123');
    }

    saveDatabase();
    console.log('Database initialized');
    return db;
}

// Save database to file
function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    }
}

// Auto-save every 30 seconds
setInterval(() => {
    saveDatabase();
}, 30000);

// Helper to convert undefined to null (sql.js doesn't handle undefined)
function sanitize(val) {
    return val === undefined ? null : val;
}

// Database operations
function insertChat(id, name, isGroup, profilePic, lastMessageTime) {
    if (!db) return;
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO chats (id, name, is_group, profile_pic, last_message_time, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run([sanitize(id), sanitize(name), isGroup ? 1 : 0, sanitize(profilePic), sanitize(lastMessageTime), Date.now()]);
    stmt.free();
    saveDatabase();
}

function insertContact(id, number, name, pushname, profilePic, isBusiness) {
    if (!db) return;
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO contacts (id, number, name, pushname, profile_pic, is_business, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run([sanitize(id), sanitize(number), sanitize(name), sanitize(pushname), sanitize(profilePic), isBusiness ? 1 : 0, Date.now()]);
    stmt.free();
    saveDatabase();
}

function insertMessage(id, chatId, senderId, senderName, body, type, timestamp, isForwarded, isFromMe, hasMedia, mediaPath, mediaMimetype, rawData) {
    if (!db) return;
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO messages
        (id, chat_id, sender_id, sender_name, body, type, timestamp, is_forwarded, is_from_me, has_media, media_path, media_mimetype, raw_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run([sanitize(id), sanitize(chatId), sanitize(senderId), sanitize(senderName), sanitize(body), sanitize(type), sanitize(timestamp), isForwarded ? 1 : 0, isFromMe ? 1 : 0, hasMedia ? 1 : 0, sanitize(mediaPath), sanitize(mediaMimetype), sanitize(rawData), Date.now()]);
    stmt.free();
    saveDatabase();
}

function markMessageDeleted(id, deletedAt) {
    if (!db) return;
    const stmt = db.prepare(`UPDATE messages SET is_deleted = 1, deleted_at = ? WHERE id = ?`);
    stmt.run([deletedAt, id]);
    stmt.free();
    saveDatabase();
}

function getChats() {
    if (!db) return [];
    const results = db.exec(`
        SELECT c.*,
               (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) as message_count,
               (SELECT body FROM messages m WHERE m.chat_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message
        FROM chats c
        ORDER BY c.last_message_time DESC
    `);
    return resultsToObjects(results);
}

function getMessages(chatId) {
    if (!db) return [];
    const stmt = db.prepare(`SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC`);
    stmt.bind([chatId]);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

function getDeletedMessages() {
    if (!db) return [];
    const results = db.exec(`SELECT * FROM messages WHERE is_deleted = 1 ORDER BY deleted_at DESC`);
    return resultsToObjects(results);
}

function searchMessages(query) {
    if (!db) return [];
    const stmt = db.prepare(`
        SELECT m.*, c.name as chat_name
        FROM messages m
        JOIN chats c ON m.chat_id = c.id
        WHERE m.body LIKE ?
        ORDER BY m.timestamp DESC
        LIMIT 100
    `);
    stmt.bind([`%${query}%`]);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

// Helper to convert sql.js results to array of objects
function resultsToObjects(results) {
    if (!results || results.length === 0) return [];
    const { columns, values } = results[0];
    return values.map(row => {
        const obj = {};
        columns.forEach((col, i) => {
            obj[col] = row[i];
        });
        return obj;
    });
}

// User management
function createUser(username, password, isAdmin = false) {
    if (!db) return null;
    const crypto = require('crypto');
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    try {
        const stmt = db.prepare(`INSERT INTO users (username, password, is_admin, created_at) VALUES (?, ?, ?, ?)`);
        stmt.run([username, hashedPassword, isAdmin ? 1 : 0, Date.now()]);
        stmt.free();
        saveDatabase();
        return { success: true };
    } catch (e) {
        return { success: false, error: 'Username already exists' };
    }
}

function verifyUser(username, password) {
    if (!db) return null;
    const crypto = require('crypto');
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    const stmt = db.prepare(`SELECT id, username, is_admin FROM users WHERE username = ? AND password = ?`);
    stmt.bind([username, hashedPassword]);
    if (stmt.step()) {
        const user = stmt.getAsObject();
        stmt.free();
        return user;
    }
    stmt.free();
    return null;
}

function getUsers() {
    if (!db) return [];
    const results = db.exec(`SELECT id, username, is_admin, created_at FROM users ORDER BY created_at DESC`);
    return resultsToObjects(results);
}

function deleteUser(userId) {
    if (!db) return;
    db.run(`DELETE FROM user_permissions WHERE user_id = ${userId}`);
    db.run(`DELETE FROM sessions WHERE user_id = ${userId}`);
    db.run(`DELETE FROM users WHERE id = ${userId}`);
    saveDatabase();
}

function updateUserPassword(userId, newPassword) {
    if (!db) return;
    const crypto = require('crypto');
    const hashedPassword = crypto.createHash('sha256').update(newPassword).digest('hex');
    const stmt = db.prepare(`UPDATE users SET password = ? WHERE id = ?`);
    stmt.run([hashedPassword, userId]);
    stmt.free();
    saveDatabase();
}

// Session management
function createSession(userId) {
    if (!db) return null;
    const crypto = require('crypto');
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
    const stmt = db.prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`);
    stmt.run([sessionId, userId, Date.now(), expiresAt]);
    stmt.free();
    saveDatabase();
    return sessionId;
}

function verifySession(sessionId) {
    if (!db || !sessionId) return null;
    const stmt = db.prepare(`
        SELECT u.id, u.username, u.is_admin
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.id = ? AND s.expires_at > ?
    `);
    stmt.bind([sessionId, Date.now()]);
    if (stmt.step()) {
        const user = stmt.getAsObject();
        stmt.free();
        return user;
    }
    stmt.free();
    return null;
}

function deleteSession(sessionId) {
    if (!db) return;
    db.run(`DELETE FROM sessions WHERE id = '${sessionId}'`);
    saveDatabase();
}

// Permission management
function setUserPermission(userId, chatId, canRead, canSend) {
    if (!db) return;
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO user_permissions (user_id, chat_id, can_read, can_send, created_at)
        VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run([userId, chatId, canRead ? 1 : 0, canSend ? 1 : 0, Date.now()]);
    stmt.free();
    saveDatabase();
}

function removeUserPermission(userId, chatId) {
    if (!db) return;
    const stmt = db.prepare(`DELETE FROM user_permissions WHERE user_id = ? AND chat_id = ?`);
    stmt.run([userId, chatId]);
    stmt.free();
    saveDatabase();
}

function getUserPermissions(userId) {
    if (!db) return [];
    const stmt = db.prepare(`
        SELECT p.*, c.name as chat_name
        FROM user_permissions p
        LEFT JOIN chats c ON p.chat_id = c.id
        WHERE p.user_id = ?
    `);
    stmt.bind([userId]);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

function getAllPermissions() {
    if (!db) return [];
    const stmt = db.prepare(`
        SELECT p.*, u.username, c.name as chat_name
        FROM user_permissions p
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN chats c ON p.chat_id = c.id
    `);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

function getUserChats(userId, isAdmin) {
    if (!db) return [];
    if (isAdmin) {
        return getChats(); // Admin sees all chats
    }
    const stmt = db.prepare(`
        SELECT c.*, p.can_read, p.can_send,
               (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) as message_count,
               (SELECT body FROM messages m WHERE m.chat_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message
        FROM chats c
        JOIN user_permissions p ON c.id = p.chat_id
        WHERE p.user_id = ? AND p.can_read = 1
        ORDER BY c.last_message_time DESC
    `);
    stmt.bind([userId]);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

function canUserSendToChat(userId, chatId, isAdmin) {
    if (isAdmin) return true;
    if (!db) return false;
    const stmt = db.prepare(`SELECT can_send FROM user_permissions WHERE user_id = ? AND chat_id = ?`);
    stmt.bind([userId, chatId]);
    if (stmt.step()) {
        const result = stmt.getAsObject();
        stmt.free();
        return result.can_send === 1;
    }
    stmt.free();
    return false;
}

module.exports = {
    initDatabase,
    saveDatabase,
    insertChat,
    insertContact,
    insertMessage,
    markMessageDeleted,
    getChats,
    getMessages,
    getDeletedMessages,
    searchMessages,
    // User management
    createUser,
    verifyUser,
    getUsers,
    deleteUser,
    updateUserPassword,
    // Session management
    createSession,
    verifySession,
    deleteSession,
    // Permission management
    setUserPermission,
    removeUserPermission,
    getUserPermissions,
    getAllPermissions,
    getUserChats,
    canUserSendToChat
};
