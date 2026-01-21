const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'whatsapp_archive.db'));

// Initialize database tables
db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        name TEXT,
        is_group INTEGER DEFAULT 0,
        profile_pic TEXT,
        last_message_time INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        number TEXT,
        name TEXT,
        pushname TEXT,
        profile_pic TEXT,
        is_business INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

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
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (chat_id) REFERENCES chats(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_deleted ON messages(is_deleted);
`);

// Prepared statements for better performance
const insertChat = db.prepare(`
    INSERT OR REPLACE INTO chats (id, name, is_group, profile_pic, last_message_time)
    VALUES (?, ?, ?, ?, ?)
`);

const insertContact = db.prepare(`
    INSERT OR REPLACE INTO contacts (id, number, name, pushname, profile_pic, is_business)
    VALUES (?, ?, ?, ?, ?, ?)
`);

const insertMessage = db.prepare(`
    INSERT OR REPLACE INTO messages
    (id, chat_id, sender_id, sender_name, body, type, timestamp, is_forwarded, is_from_me, has_media, media_path, media_mimetype, raw_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const markMessageDeleted = db.prepare(`
    UPDATE messages SET is_deleted = 1, deleted_at = ? WHERE id = ?
`);

const getChats = db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) as message_count,
           (SELECT body FROM messages m WHERE m.chat_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message
    FROM chats c
    ORDER BY c.last_message_time DESC
`);

const getMessages = db.prepare(`
    SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC
`);

const getDeletedMessages = db.prepare(`
    SELECT * FROM messages WHERE is_deleted = 1 ORDER BY deleted_at DESC
`);

const searchMessages = db.prepare(`
    SELECT m.*, c.name as chat_name
    FROM messages m
    JOIN chats c ON m.chat_id = c.id
    WHERE m.body LIKE ?
    ORDER BY m.timestamp DESC
    LIMIT 100
`);

module.exports = {
    db,
    insertChat,
    insertContact,
    insertMessage,
    markMessageDeleted,
    getChats,
    getMessages,
    getDeletedMessages,
    searchMessages
};
