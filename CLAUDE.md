# WA-EVI - WhatsApp Archive Dashboard

## Project Overview
Read-only WhatsApp Web client with dashboard and message archiving. Captures all messages (sent/received), tracks deleted/edited messages, and provides a web dashboard for viewing.

## Architecture

```
wa-evi/
├── server.js          # Main Express server + WhatsApp client
├── database.js        # SQLite database operations (sql.js)
├── logger.js          # File-based logging system
├── public/            # Frontend files
│   ├── index.html     # Main dashboard
│   ├── app.js         # Frontend JavaScript
│   └── login.html     # Login page
├── scripts/
│   ├── patch-whatsapp.js  # Patches whatsapp-web.js library
│   └── db-query.js        # Database query helper
├── media/             # Downloaded media files
├── logs/              # Log files (only in dev mode)
└── .wwebjs_auth/      # WhatsApp session data
```

## Remote Server Access

- **URL**: http://100.71.26.11:3000/ (via Tailscale)
- **Credentials**: admin / admin123
- **Remote path**: C:\Users\BJM\wa-evi

### Accessing via curl
```bash
# Login and save cookie
curl -s -c cookies.txt -X POST http://100.71.26.11:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Use authenticated endpoints
curl -s -b cookies.txt http://100.71.26.11:3000/api/chats
curl -s -b cookies.txt http://100.71.26.11:3000/api/search?q=order

# Execute commands on remote server
curl -s -b cookies.txt "http://100.71.26.11:3000/api/admin/exec?cmd=dir"
```

## Database

- **Location**: `whatsapp_archive_<phone>.db` (e.g., `whatsapp_archive_6281252856896.db`)
- **Engine**: SQLite via sql.js (in-memory, persisted to file)
- **Tables**: chats, messages, contacts, users, sessions, permissions, settings, assignments, keyword_rules

### Database Query Scripts
```bash
# Show today's messages
npm run db:today

# Show potential orders
npm run db:orders

# Show database stats
npm run db:stats

# List all chats
npm run db:chats

# General query commands
node scripts/db-query.js today              # Today's messages
node scripts/db-query.js recent 100         # Last 100 messages
node scripts/db-query.js search "keyword"   # Search messages
node scripts/db-query.js chat "Bu Evie"     # Messages from specific chat
node scripts/db-query.js orders             # Order-related messages
node scripts/db-query.js stats              # Database statistics
```

### Query on Remote Server
```bash
# Run db query on remote via exec endpoint
curl -s -b cookies.txt "http://100.71.26.11:3000/api/admin/exec?cmd=npm%20run%20db:today"
curl -s -b cookies.txt "http://100.71.26.11:3000/api/admin/exec?cmd=npm%20run%20db:orders"
```

## Key API Endpoints

### Public
- `GET /api/status` - WhatsApp connection status

### Authenticated
- `GET /api/chats` - List all chats
- `GET /api/chats/:chatId/messages` - Get messages for a chat
- `GET /api/search?q=keyword` - Search messages
- `GET /api/deleted` - Get deleted messages
- `GET /api/edited` - Get edited messages

### Admin Only
- `POST /api/admin/whatsapp/sync` - Sync chats from WhatsApp
- `POST /api/admin/whatsapp/restart` - Restart WhatsApp client
- `POST /api/admin/whatsapp/clear-session` - Clear session (force new QR)
- `GET /api/admin/exec?cmd=...` - Execute command on server
- `GET /api/logs` - View logs (dev mode only)

## whatsapp-web.js Known Issues & Fixes

### Issue 1: Ready event never fires
**Symptom**: Auth successful, loading reaches 100%, but `ready` event never fires
**Cause**: whatsapp-web.js v1.26.0 has a bug where `ready` event sometimes doesn't fire
**Location**: `node_modules/whatsapp-web.js/src/Client.js` line ~267

**Fix implemented in server.js**:
```javascript
// Force-ready mechanism triggers after 5 seconds of auth+loading complete
function checkForceReady() {
    if (loadingComplete && authComplete && !isReady) {
        readyTimeout = setTimeout(async () => {
            if (!isReady && loadingComplete && authComplete) {
                isReady = true;
                // Manually attach event listeners...
            }
        }, 5000);
    }
}
```

### Issue 2: Events not firing after force-ready (message_create)
**Symptom**: Messages not captured in real-time after force-ready
**Cause**: `attachEventListeners()` in Client.js line ~267 only runs on real `ready` event
**Root cause**: `window.Store.Msg.on('add', ...)` never attached in force-ready mode

**Fix**: Manually inject event listeners via `pupPage.evaluate()` after force-ready:
```javascript
await client.pupPage.evaluate(() => {
    window.Store.Msg.on('add', (msg) => {
        if (msg.isNewMsg) {
            if (msg.type === 'ciphertext') {
                msg.once('change:type', (_msg) => {
                    if (window.onAddMessageEvent) {
                        window.onAddMessageEvent(window.WWebJS.getMessageModel(_msg));
                    }
                });
            } else {
                if (window.onAddMessageEvent) {
                    window.onAddMessageEvent(window.WWebJS.getMessageModel(msg));
                }
            }
        }
    });
});
```

### Issue 3: GetChats error - GroupMetadata.update undefined
**Symptom**: `Cannot read properties of undefined (reading 'update')`
**Location**: `node_modules/whatsapp-web.js/src/util/Injected/Utils.js`
**Cause**: `window.Store.GroupMetadata.update(chatWid)` is deprecated/undefined

**Fix**: `scripts/patch-whatsapp.js` comments out the problematic line:
```javascript
// Find and comment out this line in Utils.js:
// await window.Store.GroupMetadata.update(chatWid);
```

**Auto-patch**: Runs on `npm install` via postinstall script

### Issue 4: sendSeen error - markedUnread undefined
**Symptom**: `Cannot read properties of undefined (reading 'markedUnread')`
**Cause**: Some chats use `@lid` format instead of `@c.us`, causing sendSeen to fail

**Fix**: Wrap sendSeen in try-catch (non-critical - local read status still works)
```javascript
try {
    await chat.sendSeen();
} catch (e) {
    // Silently ignore - expected with @lid chats
}
```

### Issue 5: Stuck loading state
**Symptom**: Status shows `loading=true` but nothing happens
**Fix**:
```bash
# Restart via API
curl -X POST -b cookies.txt http://100.71.26.11:3000/api/admin/whatsapp/restart

# Or clear session for fresh QR
curl -X POST -b cookies.txt http://100.71.26.11:3000/api/admin/whatsapp/clear-session
```

### Issue 6: Session corrupted
**Symptom**: WhatsApp won't connect, errors on startup
**Fix**:
```bash
# Via API
curl -X POST http://100.71.26.11:3000/api/admin/whatsapp/clear-session

# Or manually delete
rm -rf .wwebjs_auth
```

### Issue 7: Chat names showing phone numbers instead of contact names
**Symptom**: Chat list displays phone numbers (e.g., "+62 851-7970-1559") instead of contact names (e.g., "Sinar Sengkaling Admin"), even though messages show the correct sender name.
**Cause**: When chats are synced, contact names may not be available yet. The `fixChatNamesFromMessages()` function used `LIMIT 1` without ordering, returning the oldest message which often has phone number as sender_name instead of the actual contact name.
**Location**: `database.js` - `fixChatNamesFromMessages()` function

**Fix**: Order messages by timestamp DESC and check multiple results to find a non-phone-number name:
```javascript
// Find a sender name from messages that isn't a phone number
// Order by timestamp DESC to prefer more recent names
const msgResult = db.exec(`
    SELECT sender_name FROM messages
    WHERE chat_id = '${chatId}'
    AND is_from_me = 0
    AND sender_name IS NOT NULL
    AND sender_name != 'Unknown'
    ORDER BY timestamp DESC
    LIMIT 10
`);

// Iterate through results to find first non-phone-number name
for (const [senderName] of msgResult[0].values) {
    if (senderName && !phonePattern.test(senderName)) {
        // Update chat name
        break;
    }
}
```

**To fix existing chats**:
```bash
curl -X POST -b cookies.txt http://100.71.26.11:3000/api/admin/fix-chat-names
```

### Issue 8: Dashboard stuck on QR page after restart (ready flag not set)
**Symptom**: After server restart, WhatsApp authenticates successfully but:
- Dashboard keeps redirecting to QR scan page
- Status shows `ready: false, stuck: true`
- Messages NOT being captured (even though auth succeeded)

**Cause**: The `ready` event from whatsapp-web.js never fires after restoring session. This means:
1. `isReady` flag stays `false` → frontend shows QR page
2. Event listeners for message capture never attached

**Diagnosis**:
```bash
# Check status - look for ready:false with stuck:true
curl -s http://100.71.26.11:3000/api/status
# {"ready":false,"loading":true,"qr":null,"stuck":true}

# Check if messages being captured (should show old timestamps if broken)
ssh BJM "cd C:/Users/BJM/wa-evi && node scripts/db-query.js recent 3"

# Check server logs for "Authentication successful!" without "ready" event
```

**Fix**: Use the force-ready endpoint which sets the flag AND attaches event listeners:
```bash
# Login first
curl -s -c cookies.txt -X POST http://100.71.26.11:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Force ready state (attaches message listeners too)
curl -s -b cookies.txt -X POST http://100.71.26.11:3000/api/admin/whatsapp/force-ready
# {"success":true,"message":"Ready state forced with event listeners"}

# Verify
curl -s http://100.71.26.11:3000/api/status
# {"ready":true,"loading":false,"qr":null,"stuck":false}
```

**Server logs after fix should show**:
```
Force ready state requested by admin
Force-ready: Manually attaching event listeners...
Force-ready: Event listeners attached!
[WA:EVENT:message_create] RECEIVED from=... body=...
```

## Chat ID Formats

WhatsApp uses different ID formats:
- **Phone number**: `628123456789@c.us` (standard format)
- **LID format**: `28037663957043@lid` (newer format, same phone can have different lid)
- **Group**: `120363403839445272@g.us`

**Important**: When filtering chats by phone number, check BOTH formats:
```javascript
const HIDDEN_CHATS = [
    '628113030640',           // Phone number (partial match)
    '28037663957043@lid',     // LID format (exact match)
];
```

## Running the Server

```bash
# Production
npm start

# Development (with logs endpoint)
npm run dev
```

## Debugging Tips

1. **Check server status**: `curl http://100.71.26.11:3000/api/status`
2. **View logs** (dev mode): `curl -b cookies.txt http://100.71.26.11:3000/api/logs?lines=100`
3. **Check WhatsApp state**: Look for `isReady`, `isLoading`, `currentQR` in status
4. **Force sync**: `curl -X POST -b cookies.txt http://100.71.26.11:3000/api/admin/whatsapp/sync`

## SSH Access

```bash
# SSH to remote server (key-based auth)
ssh BJM@100.71.26.11

# Run commands directly
ssh BJM@100.71.26.11 "cd C:/Users/BJM/wa-evi && git pull"
ssh BJM@100.71.26.11 "pm2 restart wa-evi"
ssh BJM@100.71.26.11 "pm2 logs wa-evi --lines 50"
```

## PM2 Commands

```bash
# On remote server
pm2 start server.js --name wa-evi   # Start
pm2 restart wa-evi                   # Restart
pm2 stop wa-evi                      # Stop
pm2 logs wa-evi --lines 100          # View logs
pm2 list                             # List processes
pm2 monit                            # Monitor
pm2 startup                          # Auto-start on boot
pm2 save                             # Save process list
```

### PM2 Process List Empty After Reboot

**Symptom**: `pm2 list` shows empty table after Windows reboot

**Cause**: On Windows, `pm2-windows-startup` only triggers on **user login** (GUI/RDP). SSH connection does NOT count as login.

**Quick Fix** (run via SSH after reboot):
```bash
ssh BJM "pm2 resurrect"
```

**How it works**:
1. `pm2 save` stores process list in `C:\Users\BJM\.pm2\dump.pm2`
2. `pm2 resurrect` restores from that dump file
3. `pm2-windows-startup` calls `pm2 resurrect` on user login

**Health check script**:
```bash
# Check if PM2 has processes, resurrect if empty
ssh BJM "pm2 list | findstr wa-evi || pm2 resurrect"
```

## Git Workflow

```bash
# On local machine
git add . && git commit -m "message" && git push

# On remote server (via SSH)
ssh BJM@100.71.26.11 "cd C:/Users/BJM/wa-evi && git pull && pm2 restart wa-evi"
```

## Timestamps

All timestamps in the database are in milliseconds (JavaScript Date.getTime() format).
- To filter today: `WHERE timestamp >= startOfDay AND timestamp < endOfDay`
- Convert to date: `new Date(timestamp).toLocaleString('id-ID')`
