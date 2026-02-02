# Using WA-EVI API for Claude Chat Analysis

This guide explains how Claude can use the WA-EVI API endpoints to analyze WhatsApp chats.

## Authentication

All API requests require authentication. First, get a session cookie:

```bash
curl -s -c cookies.txt -X POST http://100.71.26.11:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

## Available Endpoints for Analysis

### 1. List All Chats
Get overview of all conversations.

```bash
curl -s -b cookies.txt http://100.71.26.11:3000/api/chats
```

**Response:**
```json
[
  {
    "id": "6281234567890@c.us",
    "name": "Customer Name",
    "unread_count": 5,
    "last_message_time": 1706850000000
  }
]
```

**Use cases:**
- Identify most active chats
- Find chats with unread messages
- Get chat IDs for detailed analysis

### 2. Get Messages from Specific Chat
Retrieve conversation history.

```bash
curl -s -b cookies.txt "http://100.71.26.11:3000/api/chats/6281234567890@c.us/messages?limit=100"
```

**Parameters:**
- `limit` - Number of messages (default: 50)
- `offset` - Skip messages for pagination

**Response:**
```json
[
  {
    "id": "message_id",
    "body": "Message text here",
    "timestamp": 1706850000000,
    "is_from_me": false,
    "sender_name": "Customer Name",
    "has_media": false
  }
]
```

**Use cases:**
- Analyze conversation flow
- Extract customer inquiries
- Review order discussions

### 3. Search Messages
Find messages containing specific keywords.

```bash
curl -s -b cookies.txt "http://100.71.26.11:3000/api/search?q=order"
```

**Parameters:**
- `q` - Search query (required)
- `limit` - Max results (default: 100)

**Use cases:**
- Find all order-related messages
- Search for specific products
- Locate customer complaints

### 4. Get Deleted Messages
Review messages that were deleted by sender.

```bash
curl -s -b cookies.txt http://100.71.26.11:3000/api/deleted
```

**Use cases:**
- Audit deleted communications
- Recover important information
- Track message deletions

### 5. Get Edited Messages
See original vs edited message content.

```bash
curl -s -b cookies.txt http://100.71.26.11:3000/api/edited
```

**Response includes:**
- Original message body
- Edited message body
- Edit timestamp

**Use cases:**
- Track price changes in quotes
- Monitor communication accuracy
- Audit conversation integrity

### 6. Database Query Scripts
For more complex analysis, use the database query scripts via exec endpoint:

```bash
# Today's messages
curl -s -b cookies.txt "http://100.71.26.11:3000/api/admin/exec?cmd=npm%20run%20db:today"

# Recent messages
curl -s -b cookies.txt "http://100.71.26.11:3000/api/admin/exec?cmd=node%20scripts/db-query.js%20recent%20100"

# Search for keyword
curl -s -b cookies.txt "http://100.71.26.11:3000/api/admin/exec?cmd=node%20scripts/db-query.js%20search%20order"

# Messages from specific chat
curl -s -b cookies.txt "http://100.71.26.11:3000/api/admin/exec?cmd=node%20scripts/db-query.js%20chat%20%22Customer%20Name%22"

# Database statistics
curl -s -b cookies.txt "http://100.71.26.11:3000/api/admin/exec?cmd=npm%20run%20db:stats"
```

## Analysis Workflows

### Customer Inquiry Analysis
1. Search for keywords like "harga", "order", "pesan"
2. Get full chat history for interested customers
3. Analyze response times and conversion

```bash
# Find potential orders
curl -s -b cookies.txt "http://100.71.26.11:3000/api/search?q=harga"

# Get specific customer chat
curl -s -b cookies.txt "http://100.71.26.11:3000/api/chats/CHAT_ID/messages?limit=200"
```

### Daily Activity Report
1. Get today's messages
2. Summarize by chat/customer
3. Identify follow-ups needed

```bash
curl -s -b cookies.txt "http://100.71.26.11:3000/api/admin/exec?cmd=npm%20run%20db:today"
```

### Order Tracking
1. Search for order-related keywords
2. Extract order details (quantities, prices)
3. Track order status mentions

```bash
curl -s -b cookies.txt "http://100.71.26.11:3000/api/admin/exec?cmd=npm%20run%20db:orders"
```

### Deleted Message Audit
1. Get list of deleted messages
2. Cross-reference with chat context
3. Identify patterns or concerns

```bash
curl -s -b cookies.txt http://100.71.26.11:3000/api/deleted
```

## Tips for Claude Analysis

### Formatting Timestamps
Timestamps are in milliseconds. Convert to readable format:
```javascript
new Date(1706850000000).toLocaleString('id-ID')
// "2/2/2024, 10:00:00"
```

### Handling Indonesian Text
Messages are primarily in Indonesian. Common keywords:
- **Orders:** pesan, order, beli, harga, berapa
- **Shipping:** kirim, ongkir, alamat, ekspedisi
- **Payment:** transfer, bayar, rekening, bukti
- **Products:** barang, stok, ready, habis

### Chat ID Formats
- Phone: `628123456789@c.us`
- LID: `28037663957043@lid`
- Group: `120363403839445272@g.us`

### Rate Limiting
- Add small delays between requests
- Use pagination for large result sets
- Cache results when possible

## Example: Full Analysis Session

```bash
# 1. Login
curl -s -c cookies.txt -X POST http://100.71.26.11:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# 2. Get all chats overview
curl -s -b cookies.txt http://100.71.26.11:3000/api/chats | jq '.[0:10]'

# 3. Search for orders today
curl -s -b cookies.txt "http://100.71.26.11:3000/api/search?q=order"

# 4. Get specific chat details
curl -s -b cookies.txt "http://100.71.26.11:3000/api/chats/6281234567890@c.us/messages?limit=50"

# 5. Check deleted messages
curl -s -b cookies.txt http://100.71.26.11:3000/api/deleted

# 6. Get database stats
curl -s -b cookies.txt "http://100.71.26.11:3000/api/admin/exec?cmd=npm%20run%20db:stats"
```

## Security Notes

- API is only accessible via Tailscale (100.71.26.11)
- Always use authenticated requests
- Admin endpoints require admin privileges
- Exec endpoint can run arbitrary commands (use carefully)
