const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// Default database path (used when no phone number provided)
const DEFAULT_DB_NAME = 'whatsapp_archive.db';
let DB_PATH = path.join(__dirname, DEFAULT_DB_NAME);

let db = null;
let SQL = null;
let currentPhoneNumber = null;

// Get database path for a specific phone number
function getDbPath(phoneNumber) {
    if (!phoneNumber) {
        return path.join(__dirname, DEFAULT_DB_NAME);
    }
    // Sanitize phone number for filename (remove non-alphanumeric)
    const sanitized = phoneNumber.replace(/[^0-9]/g, '');
    return path.join(__dirname, `whatsapp_archive_${sanitized}.db`);
}

// Initialize database (optionally with phone number for per-account separation)
async function initDatabase(phoneNumber = null) {
    SQL = await initSqlJs();

    // Set database path based on phone number
    if (phoneNumber) {
        currentPhoneNumber = phoneNumber;
        DB_PATH = getDbPath(phoneNumber);
        console.log(`Using database for account: ${phoneNumber}`);
        console.log(`Database file: ${DB_PATH}`);
    }

    // Load existing database or create new one
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
        console.log(`Loaded existing database: ${path.basename(DB_PATH)}`);
    } else {
        db = new SQL.Database();
        console.log(`Created new database: ${path.basename(DB_PATH)}`);
    }

    // Create tables
    db.run(`
        CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            name TEXT,
            is_group INTEGER DEFAULT 0,
            profile_pic TEXT,
            last_message_time INTEGER,
            unread_count INTEGER DEFAULT 0,
            created_at INTEGER
        )
    `);

    // Migration: Add unread_count column if not exists
    try {
        db.run(`ALTER TABLE chats ADD COLUMN unread_count INTEGER DEFAULT 0`);
    } catch (e) { }

    // Migration: Add custom_name column for user-defined display names
    try {
        db.run(`ALTER TABLE chats ADD COLUMN custom_name TEXT`);
    } catch (e) { }

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
            is_edited INTEGER DEFAULT 0,
            edited_at INTEGER,
            original_body TEXT,
            ack INTEGER DEFAULT 0,
            raw_data TEXT,
            created_at INTEGER
        )
    `);

    // Migration: Add new columns if not exists
    try {
        db.run(`ALTER TABLE messages ADD COLUMN ack INTEGER DEFAULT 0`);
    } catch (e) { }

    // Fix NULL ack values
    db.run(`UPDATE messages SET ack = 0 WHERE ack IS NULL`);
    try {
        db.run(`ALTER TABLE messages ADD COLUMN is_edited INTEGER DEFAULT 0`);
    } catch (e) { }
    try {
        db.run(`ALTER TABLE messages ADD COLUMN edited_at INTEGER`);
    } catch (e) { }
    try {
        db.run(`ALTER TABLE messages ADD COLUMN original_body TEXT`);
    } catch (e) { }

    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_deleted ON messages(is_deleted)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_edited ON messages(is_edited)`);

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

    // Settings table
    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);

    // Chat assignments table (which agent handles which chat)
    db.run(`
        CREATE TABLE IF NOT EXISTS chat_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            assigned_at INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // Keyword rules table (for keyword-based routing)
    db.run(`
        CREATE TABLE IF NOT EXISTS keyword_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            keyword TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            priority INTEGER DEFAULT 0,
            created_at INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // Set default assignment mode if not exists
    const modeExists = db.exec("SELECT value FROM settings WHERE key = 'assignment_mode'");
    if (modeExists.length === 0 || modeExists[0].values.length === 0) {
        db.run(`INSERT INTO settings (key, value) VALUES ('assignment_mode', 'manual')`);
    }

    // Set default round-robin index if not exists
    const rrExists = db.exec("SELECT value FROM settings WHERE key = 'round_robin_index'");
    if (rrExists.length === 0 || rrExists[0].values.length === 0) {
        db.run(`INSERT INTO settings (key, value) VALUES ('round_robin_index', '0')`);
    }

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
// unreadCount: number to set, null to preserve existing value
function insertChat(id, name, isGroup, profilePic, lastMessageTime, unreadCount = null) {
    if (!db) return;

    // If unreadCount is null, preserve existing value or default to 0
    let finalUnreadCount = 0;
    if (unreadCount === null) {
        // Check existing value
        const existing = db.exec(`SELECT unread_count FROM chats WHERE id = '${id.replace(/'/g, "''")}'`);
        if (existing.length > 0 && existing[0].values.length > 0) {
            finalUnreadCount = existing[0].values[0][0] || 0;
        }
    } else {
        finalUnreadCount = unreadCount;
    }

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO chats (id, name, is_group, profile_pic, last_message_time, unread_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run([sanitize(id), sanitize(name), isGroup ? 1 : 0, sanitize(profilePic), sanitize(lastMessageTime), sanitize(finalUnreadCount), Date.now()]);
    stmt.free();
    saveDatabase();
}

// Update unread count for a chat (used when marking as read)
function updateChatUnreadCount(chatId, unreadCount) {
    if (!db) return;
    const stmt = db.prepare(`UPDATE chats SET unread_count = ? WHERE id = ?`);
    stmt.run([unreadCount, chatId]);
    stmt.free();
    saveDatabase();
}

// Set custom display name for a chat (user-defined name override)
function setChatCustomName(chatId, customName) {
    if (!db) return;
    const stmt = db.prepare(`UPDATE chats SET custom_name = ? WHERE id = ?`);
    stmt.run([customName || null, chatId]); // null to clear custom name
    stmt.free();
    saveDatabase();
}

// Get chat by ID
function getChatById(chatId) {
    if (!db) return null;
    const stmt = db.prepare(`
        SELECT id, COALESCE(custom_name, name) as name, name as original_name, custom_name,
               is_group, profile_pic, last_message_time, unread_count
        FROM chats WHERE id = ?
    `);
    stmt.bind([chatId]);
    if (stmt.step()) {
        const result = stmt.getAsObject();
        stmt.free();
        return result;
    }
    stmt.free();
    return null;
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

function insertMessage(id, chatId, senderId, senderName, body, type, timestamp, isForwarded, isFromMe, hasMedia, mediaPath, mediaMimetype, rawData, ack = 0) {
    if (!db) return;
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO messages
        (id, chat_id, sender_id, sender_name, body, type, timestamp, is_forwarded, is_from_me, has_media, media_path, media_mimetype, ack, raw_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run([sanitize(id), sanitize(chatId), sanitize(senderId), sanitize(senderName), sanitize(body), sanitize(type), sanitize(timestamp), isForwarded ? 1 : 0, isFromMe ? 1 : 0, hasMedia ? 1 : 0, sanitize(mediaPath), sanitize(mediaMimetype), sanitize(ack), sanitize(rawData), Date.now()]);
    stmt.free();
    saveDatabase();
}

// Update message ACK status (0=pending, 1=sent, 2=delivered, 3=read, 4=played)
function updateMessageAck(messageId, ack) {
    if (!db) return;
    const stmt = db.prepare(`UPDATE messages SET ack = ? WHERE id = ?`);
    stmt.run([ack, messageId]);
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
        SELECT c.id, COALESCE(c.custom_name, c.name) as name, c.is_group, c.profile_pic,
               c.last_message_time, c.unread_count, c.created_at, c.custom_name,
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

// Mark message as edited and save original content
function markMessageEdited(id, newBody, editedAt) {
    if (!db) return;
    // First get the original body if not already edited
    const stmt = db.prepare(`SELECT body, original_body, is_edited FROM messages WHERE id = ?`);
    stmt.bind([id]);
    let originalBody = null;
    if (stmt.step()) {
        const row = stmt.getAsObject();
        // Keep the very first original body
        originalBody = row.is_edited ? row.original_body : row.body;
    }
    stmt.free();

    // Update the message
    const updateStmt = db.prepare(`UPDATE messages SET body = ?, is_edited = 1, edited_at = ?, original_body = ? WHERE id = ?`);
    updateStmt.run([newBody, editedAt, originalBody, id]);
    updateStmt.free();
    saveDatabase();
}

function getEditedMessages() {
    if (!db) return [];
    const results = db.exec(`SELECT * FROM messages WHERE is_edited = 1 ORDER BY edited_at DESC`);
    return resultsToObjects(results);
}

// Get all modified messages (deleted or edited)
function getModifiedMessages() {
    if (!db) return [];
    const results = db.exec(`SELECT * FROM messages WHERE is_deleted = 1 OR is_edited = 1 ORDER BY COALESCE(deleted_at, edited_at) DESC`);
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
        SELECT c.id, COALESCE(c.custom_name, c.name) as name, c.is_group, c.profile_pic,
               c.last_message_time, c.unread_count, c.created_at, c.custom_name,
               p.can_read, p.can_send,
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

// ============ SETTINGS ============
function getSetting(key) {
    if (!db) return null;
    const stmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
    stmt.bind([key]);
    if (stmt.step()) {
        const result = stmt.getAsObject();
        stmt.free();
        return result.value;
    }
    stmt.free();
    return null;
}

function setSetting(key, value) {
    if (!db) return;
    const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    stmt.run([key, value]);
    stmt.free();
    saveDatabase();
}

function getAllSettings() {
    if (!db) return {};
    const stmt = db.prepare(`SELECT key, value FROM settings`);
    const settings = {};
    while (stmt.step()) {
        const row = stmt.getAsObject();
        settings[row.key] = row.value;
    }
    stmt.free();
    return settings;
}

// ============ CHAT ASSIGNMENTS ============
function getChatAssignment(chatId) {
    if (!db) return null;
    const stmt = db.prepare(`
        SELECT a.*, u.username
        FROM chat_assignments a
        LEFT JOIN users u ON a.user_id = u.id
        WHERE a.chat_id = ?
    `);
    stmt.bind([chatId]);
    if (stmt.step()) {
        const result = stmt.getAsObject();
        stmt.free();
        return result;
    }
    stmt.free();
    return null;
}

function assignChatToUser(chatId, userId) {
    if (!db) return;
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO chat_assignments (chat_id, user_id, assigned_at)
        VALUES (?, ?, ?)
    `);
    stmt.run([chatId, userId, Date.now()]);
    stmt.free();

    // Also grant read/send permissions automatically
    setUserPermission(userId, chatId, true, true);
    saveDatabase();
}

function unassignChat(chatId) {
    if (!db) return;
    const stmt = db.prepare(`DELETE FROM chat_assignments WHERE chat_id = ?`);
    stmt.run([chatId]);
    stmt.free();
    saveDatabase();
}

function getAllAssignments() {
    if (!db) return [];
    const stmt = db.prepare(`
        SELECT a.*, u.username, c.name as chat_name
        FROM chat_assignments a
        LEFT JOIN users u ON a.user_id = u.id
        LEFT JOIN chats c ON a.chat_id = c.id
        ORDER BY a.assigned_at DESC
    `);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

function getUserAssignmentCount(userId) {
    if (!db) return 0;
    const stmt = db.prepare(`SELECT COUNT(*) as count FROM chat_assignments WHERE user_id = ?`);
    stmt.bind([userId]);
    if (stmt.step()) {
        const result = stmt.getAsObject();
        stmt.free();
        return result.count;
    }
    stmt.free();
    return 0;
}

// ============ KEYWORD RULES ============
function addKeywordRule(keyword, userId, priority = 0) {
    if (!db) return;
    const stmt = db.prepare(`
        INSERT INTO keyword_rules (keyword, user_id, priority, created_at)
        VALUES (?, ?, ?, ?)
    `);
    stmt.run([keyword.toLowerCase(), userId, priority, Date.now()]);
    stmt.free();
    saveDatabase();
}

function removeKeywordRule(id) {
    if (!db) return;
    const stmt = db.prepare(`DELETE FROM keyword_rules WHERE id = ?`);
    stmt.run([id]);
    stmt.free();
    saveDatabase();
}

function getAllKeywordRules() {
    if (!db) return [];
    const stmt = db.prepare(`
        SELECT k.*, u.username
        FROM keyword_rules k
        LEFT JOIN users u ON k.user_id = u.id
        ORDER BY k.priority DESC, k.keyword
    `);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

function findKeywordMatch(text) {
    if (!db || !text) return null;
    const lowerText = text.toLowerCase();
    const rules = getAllKeywordRules();

    // Check each keyword (sorted by priority)
    for (const rule of rules) {
        if (lowerText.includes(rule.keyword)) {
            return rule;
        }
    }
    return null;
}

// ============ AUTO-ASSIGNMENT LOGIC ============
function getAvailableAgents() {
    if (!db) return [];
    // Get non-admin users who can be assigned
    const stmt = db.prepare(`SELECT * FROM users WHERE is_admin = 0`);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

function getNextRoundRobinAgent() {
    const agents = getAvailableAgents();
    if (agents.length === 0) return null;

    const currentIndex = parseInt(getSetting('round_robin_index') || '0');
    const nextIndex = (currentIndex + 1) % agents.length;
    setSetting('round_robin_index', nextIndex.toString());

    return agents[currentIndex % agents.length];
}

function getLeastBusyAgent() {
    const agents = getAvailableAgents();
    if (agents.length === 0) return null;

    let leastBusy = null;
    let minCount = Infinity;

    for (const agent of agents) {
        const count = getUserAssignmentCount(agent.id);
        if (count < minCount) {
            minCount = count;
            leastBusy = agent;
        }
    }

    return leastBusy;
}

function autoAssignChat(chatId, messageText) {
    // Check if chat is already assigned
    const existing = getChatAssignment(chatId);
    if (existing) return existing;

    const mode = getSetting('assignment_mode') || 'manual';
    let assignedAgent = null;

    switch (mode) {
        case 'round_robin':
            assignedAgent = getNextRoundRobinAgent();
            break;

        case 'least_busy':
            assignedAgent = getLeastBusyAgent();
            break;

        case 'keyword':
            const keywordMatch = findKeywordMatch(messageText);
            if (keywordMatch) {
                // Get user for this keyword
                const stmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
                stmt.bind([keywordMatch.user_id]);
                if (stmt.step()) {
                    assignedAgent = stmt.getAsObject();
                }
                stmt.free();
            }
            // Fallback to round-robin if no keyword match
            if (!assignedAgent) {
                assignedAgent = getNextRoundRobinAgent();
            }
            break;

        case 'manual':
        default:
            // Manual mode - don't auto-assign
            return null;
    }

    if (assignedAgent) {
        assignChatToUser(chatId, assignedAgent.id);
        return { user_id: assignedAgent.id, username: assignedAgent.username, chat_id: chatId };
    }

    return null;
}

module.exports = {
    initDatabase,
    saveDatabase,
    insertChat,
    insertContact,
    insertMessage,
    updateMessageAck,
    markMessageDeleted,
    markMessageEdited,
    getChats,
    getChatById,
    setChatCustomName,
    getMessages,
    getDeletedMessages,
    getEditedMessages,
    getModifiedMessages,
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
    canUserSendToChat,
    // Settings
    getSetting,
    setSetting,
    getAllSettings,
    // Chat assignments
    getChatAssignment,
    assignChatToUser,
    unassignChat,
    getAllAssignments,
    getUserAssignmentCount,
    // Keyword rules
    addKeywordRule,
    removeKeywordRule,
    getAllKeywordRules,
    findKeywordMatch,
    // Auto-assignment
    getAvailableAgents,
    autoAssignChat,
    // Unread count
    updateChatUnreadCount
};
