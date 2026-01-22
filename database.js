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
    autoAssignChat
};
