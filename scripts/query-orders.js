const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function query() {
    const SQL = await initSqlJs();
    const dbPath = path.join(__dirname, '..', 'whatsapp_archive_6281334350020.db');

    if (!fs.existsSync(dbPath)) {
        console.log('Database not found:', dbPath);
        return;
    }

    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    // Get most recent messages
    const result = db.exec(`
        SELECT m.body, m.sender_name, m.timestamp, m.is_from_me, c.name as chat_name
        FROM messages m
        LEFT JOIN chats c ON m.chat_id = c.id
        ORDER BY m.timestamp DESC
        LIMIT 100
    `);

    if (result.length > 0) {
        const messages = result[0].values;
        console.log('Most recent messages (' + messages.length + '):\n');

        // Group by date
        let lastDate = '';
        messages.reverse().forEach(row => {
            const [body, sender, ts, fromMe, chatName] = row;
            const date = new Date(ts);
            const dateStr = date.toLocaleDateString('id-ID');
            const time = date.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit'});

            if (dateStr !== lastDate) {
                console.log('\n=== ' + dateStr + ' ===');
                lastDate = dateStr;
            }

            const direction = fromMe ? '[SENT]' : '[RECV]';
            console.log(`${time} | ${chatName || 'Unknown'} | ${sender} ${direction}`);
            console.log(`   ${(body || '[media]').substring(0, 150)}`);
        });
    } else {
        console.log('No messages in database');
    }

    // Also show database stats
    const stats = db.exec('SELECT COUNT(*) as count, MIN(timestamp) as oldest, MAX(timestamp) as newest FROM messages');
    if (stats.length > 0) {
        const [count, oldest, newest] = stats[0].values[0];
        console.log('\n--- Database Stats ---');
        console.log('Total messages:', count);
        console.log('Oldest:', new Date(oldest).toLocaleString('id-ID'));
        console.log('Newest:', new Date(newest).toLocaleString('id-ID'));
    }
}

query().catch(console.error);
