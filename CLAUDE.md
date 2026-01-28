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

## Common Issues & Fixes

### 1. Ready event never fires
**Symptom**: Auth successful, loading 100%, but no ready event
**Cause**: whatsapp-web.js ready event sometimes doesn't fire
**Fix**: Force-ready mechanism in server.js triggers after 5 seconds of auth+loading complete

### 2. Events not firing (message_create)
**Symptom**: Messages not being captured in real-time
**Cause**: `attachEventListeners()` only called on real ready event, not force-ready
**Fix**: Manual event listener injection via `pupPage.evaluate()` after force-ready

### 3. GetChats error - GroupMetadata.update undefined
**Symptom**: `Cannot read properties of undefined (reading 'update')`
**Cause**: whatsapp-web.js uses deprecated API
**Fix**: `scripts/patch-whatsapp.js` comments out the problematic line

### 4. Stuck loading state
**Symptom**: Status shows loading=true but nothing happens
**Fix**: Use restart endpoint or clear-session endpoint

### 5. Session corrupted
**Fix**:
```bash
# Via API
curl -X POST http://100.71.26.11:3000/api/admin/whatsapp/clear-session

# Or manually delete
rm -rf .wwebjs_auth
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

## Git Workflow

```bash
# On local machine
git add . && git commit -m "message" && git push

# On remote server (via exec endpoint or SSH)
cd C:\Users\BJM\wa-evi && git pull && npm run dev
```

## Timestamps

All timestamps in the database are in milliseconds (JavaScript Date.getTime() format).
- To filter today: `WHERE timestamp >= startOfDay AND timestamp < endOfDay`
- Convert to date: `new Date(timestamp).toLocaleString('id-ID')`
