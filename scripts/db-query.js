/**
 * Database Query Helper
 * Usage: node scripts/db-query.js <command> [options]
 *
 * Commands:
 *   today           - Show today's messages
 *   recent [n]      - Show last n messages (default: 50)
 *   search <term>   - Search messages containing term
 *   chats           - List all chats with message counts
 *   stats           - Show database statistics
 *   orders          - Show potential orders (messages with order keywords)
 *   chat <id>       - Show messages from specific chat
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function getDatabase() {
    const SQL = await initSqlJs();

    // Find the database file
    const files = fs.readdirSync(path.join(__dirname, '..'))
        .filter(f => f.startsWith('whatsapp_archive_') && f.endsWith('.db'));

    if (files.length === 0) {
        // Try default name
        const defaultDb = path.join(__dirname, '..', 'whatsapp_archive.db');
        if (fs.existsSync(defaultDb)) {
            return new SQL.Database(fs.readFileSync(defaultDb));
        }
        console.error('No database file found');
        process.exit(1);
    }

    const dbPath = path.join(__dirname, '..', files[0]);
    console.log('Using database:', files[0]);
    return new SQL.Database(fs.readFileSync(dbPath));
}

function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
    return new Date(ts).toLocaleDateString('id-ID');
}

function formatDateTime(ts) {
    return new Date(ts).toLocaleString('id-ID');
}

function printMessages(rows, columns) {
    if (!rows || rows.length === 0) {
        console.log('No messages found');
        return;
    }

    const colIdx = {};
    columns.forEach((col, i) => colIdx[col] = i);

    let lastDate = '';
    rows.forEach(row => {
        const body = row[colIdx.body] || '[media]';
        const ts = row[colIdx.timestamp];
        const fromMe = row[colIdx.is_from_me];
        const chat = row[colIdx.chat_name] || row[colIdx.chat_id] || 'Unknown';
        const sender = row[colIdx.sender_name] || 'Unknown';

        const dateStr = formatDate(ts);
        if (dateStr !== lastDate) {
            console.log(`\n=== ${dateStr} ===`);
            lastDate = dateStr;
        }

        const time = formatTime(ts);
        const dir = fromMe ? '[SENT]' : '[RECV]';
        console.log(`${time} | ${chat} | ${sender} ${dir}`);
        console.log(`   ${body.substring(0, 150)}`);
    });
}

async function today(db) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const startOfDay = now.getTime();
    const endOfDay = startOfDay + 86400000;

    console.log(`\nMessages for ${formatDate(startOfDay)}:\n`);

    const result = db.exec(`
        SELECT m.body, m.sender_name, m.timestamp, m.is_from_me, m.chat_id,
               (SELECT name FROM chats WHERE id = m.chat_id) as chat_name
        FROM messages m
        WHERE m.timestamp >= ${startOfDay} AND m.timestamp < ${endOfDay}
        ORDER BY m.timestamp ASC
    `);

    if (result.length > 0) {
        printMessages(result[0].values, result[0].columns);
        console.log(`\nTotal: ${result[0].values.length} messages`);
    } else {
        console.log('No messages today');
    }
}

async function recent(db, limit = 50) {
    console.log(`\nLast ${limit} messages:\n`);

    const result = db.exec(`
        SELECT m.body, m.sender_name, m.timestamp, m.is_from_me, m.chat_id,
               (SELECT name FROM chats WHERE id = m.chat_id) as chat_name
        FROM messages m
        ORDER BY m.timestamp DESC
        LIMIT ${limit}
    `);

    if (result.length > 0) {
        // Reverse to show oldest first
        result[0].values.reverse();
        printMessages(result[0].values, result[0].columns);
    } else {
        console.log('No messages found');
    }
}

async function search(db, term) {
    console.log(`\nSearching for "${term}":\n`);

    const result = db.exec(`
        SELECT m.body, m.sender_name, m.timestamp, m.is_from_me, m.chat_id,
               (SELECT name FROM chats WHERE id = m.chat_id) as chat_name
        FROM messages m
        WHERE m.body LIKE '%${term.replace(/'/g, "''")}%'
        ORDER BY m.timestamp DESC
        LIMIT 100
    `);

    if (result.length > 0) {
        result[0].values.reverse();
        printMessages(result[0].values, result[0].columns);
        console.log(`\nFound: ${result[0].values.length} messages`);
    } else {
        console.log('No messages found');
    }
}

async function chats(db) {
    console.log('\nAll chats:\n');

    const result = db.exec(`
        SELECT c.id, c.name, c.is_group, c.unread_count, c.last_message_time,
               (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) as msg_count
        FROM chats c
        ORDER BY c.last_message_time DESC
    `);

    if (result.length > 0) {
        console.log('Last Active       | Messages | Unread | Name');
        console.log('-'.repeat(70));
        result[0].values.forEach(row => {
            const [id, name, isGroup, unread, lastTime, msgCount] = row;
            const time = formatDateTime(lastTime);
            const groupTag = isGroup ? '[G]' : '   ';
            console.log(`${time} | ${String(msgCount).padStart(8)} | ${String(unread || 0).padStart(6)} | ${groupTag} ${name || id}`);
        });
        console.log(`\nTotal: ${result[0].values.length} chats`);
    } else {
        console.log('No chats found');
    }
}

async function stats(db) {
    console.log('\nDatabase Statistics:\n');

    const msgStats = db.exec(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN is_from_me = 1 THEN 1 ELSE 0 END) as sent,
               SUM(CASE WHEN is_from_me = 0 THEN 1 ELSE 0 END) as received,
               SUM(CASE WHEN is_deleted = 1 THEN 1 ELSE 0 END) as deleted,
               SUM(CASE WHEN is_edited = 1 THEN 1 ELSE 0 END) as edited,
               SUM(CASE WHEN has_media = 1 THEN 1 ELSE 0 END) as media,
               MIN(timestamp) as oldest,
               MAX(timestamp) as newest
        FROM messages
    `);

    if (msgStats.length > 0) {
        const [total, sent, received, deleted, edited, media, oldest, newest] = msgStats[0].values[0];
        console.log('Messages:');
        console.log(`  Total:    ${total}`);
        console.log(`  Sent:     ${sent}`);
        console.log(`  Received: ${received}`);
        console.log(`  Deleted:  ${deleted}`);
        console.log(`  Edited:   ${edited}`);
        console.log(`  Media:    ${media}`);
        console.log(`  Oldest:   ${formatDateTime(oldest)}`);
        console.log(`  Newest:   ${formatDateTime(newest)}`);
    }

    const chatStats = db.exec('SELECT COUNT(*) FROM chats');
    const contactStats = db.exec('SELECT COUNT(*) FROM contacts');

    console.log(`\nChats:    ${chatStats[0]?.values[0][0] || 0}`);
    console.log(`Contacts: ${contactStats[0]?.values[0][0] || 0}`);
}

async function orders(db) {
    console.log('\nPotential orders (keywords: order, pesan, beli, unit, pcs, lunas, tf, dp, bayar):\n');

    const result = db.exec(`
        SELECT m.body, m.sender_name, m.timestamp, m.is_from_me, m.chat_id,
               (SELECT name FROM chats WHERE id = m.chat_id) as chat_name
        FROM messages m
        WHERE (
            m.body LIKE '%order%' OR
            m.body LIKE '%pesan%' OR
            m.body LIKE '%beli%' OR
            m.body LIKE '%unit%' OR
            m.body LIKE '%pcs%' OR
            m.body LIKE '%lunas%' OR
            m.body LIKE '% tf %' OR
            m.body LIKE '%transfer%' OR
            m.body LIKE '% dp %' OR
            m.body LIKE '%bayar%'
        )
        ORDER BY m.timestamp DESC
        LIMIT 50
    `);

    if (result.length > 0) {
        result[0].values.reverse();
        printMessages(result[0].values, result[0].columns);
        console.log(`\nFound: ${result[0].values.length} potential order messages`);
    } else {
        console.log('No order-related messages found');
    }
}

async function chat(db, chatId) {
    console.log(`\nMessages from chat: ${chatId}\n`);

    // Try to find chat by partial match
    const chatResult = db.exec(`
        SELECT id, name FROM chats
        WHERE id LIKE '%${chatId.replace(/'/g, "''")}%'
           OR name LIKE '%${chatId.replace(/'/g, "''")}%'
        LIMIT 1
    `);

    if (chatResult.length === 0 || chatResult[0].values.length === 0) {
        console.log('Chat not found');
        return;
    }

    const [fullChatId, chatName] = chatResult[0].values[0];
    console.log(`Chat: ${chatName || fullChatId}\n`);

    const result = db.exec(`
        SELECT m.body, m.sender_name, m.timestamp, m.is_from_me, m.chat_id,
               '${(chatName || '').replace(/'/g, "''")}' as chat_name
        FROM messages m
        WHERE m.chat_id = '${fullChatId.replace(/'/g, "''")}'
        ORDER BY m.timestamp DESC
        LIMIT 100
    `);

    if (result.length > 0) {
        result[0].values.reverse();
        printMessages(result[0].values, result[0].columns);
        console.log(`\nShowing last ${result[0].values.length} messages`);
    } else {
        console.log('No messages found');
    }
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';

    if (command === 'help') {
        console.log(`
Database Query Helper
Usage: node scripts/db-query.js <command> [options]

Commands:
  today           - Show today's messages
  recent [n]      - Show last n messages (default: 50)
  search <term>   - Search messages containing term
  chats           - List all chats with message counts
  stats           - Show database statistics
  orders          - Show potential orders (order keywords)
  chat <id|name>  - Show messages from specific chat
  help            - Show this help
        `);
        return;
    }

    const db = await getDatabase();

    switch (command) {
        case 'today':
            await today(db);
            break;
        case 'recent':
            await recent(db, parseInt(args[1]) || 50);
            break;
        case 'search':
            if (!args[1]) {
                console.error('Usage: node scripts/db-query.js search <term>');
                process.exit(1);
            }
            await search(db, args.slice(1).join(' '));
            break;
        case 'chats':
            await chats(db);
            break;
        case 'stats':
            await stats(db);
            break;
        case 'orders':
            await orders(db);
            break;
        case 'chat':
            if (!args[1]) {
                console.error('Usage: node scripts/db-query.js chat <id|name>');
                process.exit(1);
            }
            await chat(db, args.slice(1).join(' '));
            break;
        default:
            console.error(`Unknown command: ${command}`);
            console.log('Use "help" for available commands');
            process.exit(1);
    }
}

main().catch(console.error);
