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

// Database operations
function insertChat(id, name, isGroup, profilePic, lastMessageTime) {
    if (!db) return;
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO chats (id, name, is_group, profile_pic, last_message_time, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run([id, name, isGroup ? 1 : 0, profilePic, lastMessageTime, Date.now()]);
    stmt.free();
    saveDatabase();
}

function insertContact(id, number, name, pushname, profilePic, isBusiness) {
    if (!db) return;
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO contacts (id, number, name, pushname, profile_pic, is_business, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run([id, number, name, pushname, profilePic, isBusiness ? 1 : 0, Date.now()]);
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
    stmt.run([id, chatId, senderId, senderName, body, type, timestamp, isForwarded ? 1 : 0, isFromMe ? 1 : 0, hasMedia ? 1 : 0, mediaPath, mediaMimetype, rawData, Date.now()]);
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
    searchMessages
};
