# WhatsApp Archive (wa-evi)

A read-only WhatsApp Web client with a beautiful dashboard that archives all messages, including deleted ones.

## Features

- **WhatsApp-like UI** - Dark theme dashboard that looks like the real WhatsApp Web
- **Read-only mode** - Only monitors messages, cannot send anything
- **Message archiving** - Saves all messages to a local SQLite database
- **Deleted message recovery** - Captures and preserves messages even after they're deleted
- **Media saving** - Downloads and stores all images, videos, and audio files locally
- **Search** - Search through all archived messages
- **Real-time updates** - New messages appear instantly via WebSocket

## Screenshots

The dashboard features:
- Left sidebar with chat list
- Main area showing messages with WhatsApp-style bubbles
- Image viewer modal for photos
- Deleted messages section

## Installation

### Prerequisites

- Node.js 18 or higher
- npm

### Setup

1. Clone or download this project

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open your browser to `http://localhost:3000`

5. Scan the QR code with WhatsApp on your phone:
   - Open WhatsApp
   - Go to Settings > Linked Devices
   - Tap "Link a Device"
   - Point your camera at the QR code

## Project Structure

```
wa-evi/
├── server.js           # Main server (Express + Socket.io + WhatsApp client)
├── database.js         # SQLite database schema and queries
├── package.json        # Dependencies
├── public/
│   ├── index.html      # Dashboard HTML
│   ├── styles.css      # WhatsApp-like styling
│   └── app.js          # Frontend JavaScript
├── media/              # Downloaded media files (created automatically)
├── .wwebjs_auth/       # WhatsApp session data (created automatically)
└── whatsapp_archive.db # SQLite database (created automatically)
```

## How It Works

1. **Authentication**: Uses `whatsapp-web.js` to connect to WhatsApp Web via QR code
2. **Message capture**: Listens for all incoming and outgoing messages
3. **Storage**: Saves messages to SQLite database with full metadata
4. **Media handling**: Downloads and stores media files locally
5. **Deletion tracking**: When someone deletes a message, it's marked as deleted but preserved
6. **Dashboard**: Real-time web interface shows all archived messages

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | Check connection status |
| `GET /api/chats` | List all chats |
| `GET /api/chats/:id/messages` | Get messages for a chat |
| `GET /api/deleted` | List all deleted messages |
| `GET /api/search?q=query` | Search messages |

## Data Storage

- **Messages**: Stored in `whatsapp_archive.db` (SQLite)
- **Media**: Stored in `media/` folder
- **Session**: Stored in `.wwebjs_auth/` folder

## Privacy & Security

- All data is stored locally on your machine
- No data is sent to external servers
- Session data allows reconnection without re-scanning QR code
- Add these folders to `.gitignore` to avoid committing personal data

## Limitations

- **Read-only**: This tool cannot send messages, it only archives
- **Single session**: WhatsApp Web only allows one linked session per account
- **Rate limits**: WhatsApp may temporarily block if too many requests are made
- **Media expiration**: Some media may expire before being downloaded

## Troubleshooting

### QR code not showing
- Make sure port 3000 is not in use
- Check console for errors
- Try deleting `.wwebjs_auth` folder and restarting

### Messages not saving
- Check that the `media` folder has write permissions
- Verify SQLite database is created in project root

### Disconnected frequently
- WhatsApp may disconnect inactive sessions
- Keep the dashboard open to maintain connection

## License

MIT License - Use at your own risk. This tool is for personal archiving purposes only.

## Disclaimer

This project is not affiliated with WhatsApp or Meta. Use responsibly and in accordance with WhatsApp's Terms of Service.
