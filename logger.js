const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Get current date for log file names
function getDateString() {
    const now = new Date();
    return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

// Get timestamp for log entries
function getTimestamp() {
    return new Date().toISOString();
}

// Write to log file
function writeToFile(filename, message) {
    const filepath = path.join(LOGS_DIR, filename);
    const line = `[${getTimestamp()}] ${message}\n`;
    fs.appendFileSync(filepath, line);
}

// Logger object
const logger = {
    info: function (message, ...args) {
        const fullMessage = args.length > 0
            ? `${message} ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`
            : message;
        console.log(`[INFO] ${fullMessage}`);
        writeToFile(`server-${getDateString()}.log`, `[INFO] ${fullMessage}`);
    },

    debug: function (message, ...args) {
        const fullMessage = args.length > 0
            ? `${message} ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`
            : message;
        console.log(`[DEBUG] ${fullMessage}`);
        writeToFile(`server-${getDateString()}.log`, `[DEBUG] ${fullMessage}`);
    },

    warn: function (message, ...args) {
        const fullMessage = args.length > 0
            ? `${message} ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`
            : message;
        console.warn(`[WARN] ${fullMessage}`);
        writeToFile(`server-${getDateString()}.log`, `[WARN] ${fullMessage}`);
        writeToFile(`errors-${getDateString()}.log`, `[WARN] ${fullMessage}`);
    },

    error: function (message, ...args) {
        const fullMessage = args.length > 0
            ? `${message} ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`
            : message;
        console.error(`[ERROR] ${fullMessage}`);
        writeToFile(`server-${getDateString()}.log`, `[ERROR] ${fullMessage}`);
        writeToFile(`errors-${getDateString()}.log`, `[ERROR] ${fullMessage}`);
    },

    whatsapp: function (event, message, ...args) {
        const fullMessage = args.length > 0
            ? `${message} ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`
            : message;
        console.log(`[WA:${event}] ${fullMessage}`);
        writeToFile(`server-${getDateString()}.log`, `[WA:${event}] ${fullMessage}`);
        writeToFile(`whatsapp-${getDateString()}.log`, `[${event}] ${fullMessage}`);
    },

    socket: function (event, message, ...args) {
        const fullMessage = args.length > 0
            ? `${message} ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`
            : message;
        console.log(`[SOCKET:${event}] ${fullMessage}`);
        writeToFile(`server-${getDateString()}.log`, `[SOCKET:${event}] ${fullMessage}`);
    },

    api: function (method, path, status) {
        const message = `${method} ${path} -> ${status}`;
        console.log(`[API] ${message}`);
        writeToFile(`server-${getDateString()}.log`, `[API] ${message}`);
    }
};

module.exports = logger;
