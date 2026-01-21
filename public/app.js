const socket = io();

// DOM Elements
const qrScreen = document.getElementById('qr-screen');
const dashboard = document.getElementById('dashboard');
const qrCode = document.getElementById('qr-code');
const chatList = document.getElementById('chat-list');
const noChatSelected = document.getElementById('no-chat-selected');
const chatView = document.getElementById('chat-view');
const deletedView = document.getElementById('deleted-view');
const messagesContainer = document.getElementById('messages-container');
const deletedMessagesContainer = document.getElementById('deleted-messages-container');
const chatName = document.getElementById('chat-name');
const chatStatus = document.getElementById('chat-status');
const chatAvatar = document.getElementById('chat-avatar');
const searchInput = document.getElementById('search-input');
const showDeletedBtn = document.getElementById('show-deleted-btn');
const closeDeletedBtn = document.getElementById('close-deleted-btn');
const imageModal = document.getElementById('image-modal');
const modalImage = document.getElementById('modal-image');

let currentChatId = null;
let chats = [];

// Socket Events
socket.on('qr', (qr) => {
    qrCode.innerHTML = `<img src="${qr}" alt="QR Code">`;
});

socket.on('ready', () => {
    qrScreen.classList.add('hidden');
    dashboard.classList.remove('hidden');
    loadChats();
});

socket.on('authenticated', () => {
    console.log('Authenticated');
});

socket.on('disconnected', (reason) => {
    alert('WhatsApp disconnected: ' + reason);
    location.reload();
});

socket.on('new_message', (message) => {
    // Update chat list
    loadChats();

    // If viewing this chat, add the message
    if (currentChatId === message.chatId) {
        appendMessage(message, messagesContainer);
        scrollToBottom();
    }
});

socket.on('message_deleted', (data) => {
    const messageEl = document.querySelector(`[data-message-id="${data.id}"]`);
    if (messageEl) {
        messageEl.classList.add('deleted');
        const bubble = messageEl.querySelector('.message-bubble');
        const meta = bubble.querySelector('.message-meta');
        const badge = document.createElement('div');
        badge.className = 'message-deleted-badge';
        badge.innerHTML = `
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path></svg>
            Deleted
        `;
        bubble.insertBefore(badge, meta);
    }
});

socket.on('chats_loaded', () => {
    loadChats();
});

// Check initial status
fetch('/api/status')
    .then(res => res.json())
    .then(data => {
        if (data.ready) {
            qrScreen.classList.add('hidden');
            dashboard.classList.remove('hidden');
            loadChats();
        } else if (data.qr) {
            qrCode.innerHTML = `<img src="${data.qr}" alt="QR Code">`;
        }
    });

// Load chats
async function loadChats() {
    try {
        const res = await fetch('/api/chats');
        chats = await res.json();
        renderChatList(chats);
    } catch (err) {
        console.error('Error loading chats:', err);
    }
}

// Render chat list
function renderChatList(chatData) {
    chatList.innerHTML = '';

    chatData.forEach(chat => {
        const div = document.createElement('div');
        div.className = `chat-item ${chat.id === currentChatId ? 'active' : ''}`;
        div.dataset.chatId = chat.id;

        const time = chat.last_message_time ? formatTime(chat.last_message_time) : '';
        const preview = chat.last_message || 'No messages';

        div.innerHTML = `
            <div class="avatar">
                ${chat.profile_pic
                    ? `<img src="${chat.profile_pic}" alt="">`
                    : `<svg viewBox="0 0 212 212" width="40" height="40">
                        <path fill="#DFE5E7" d="M106.251.5C164.653.5 212 47.846 212 106.25S164.653 212 106.25 212C47.846 212 .5 164.654.5 106.25S47.846.5 106.251.5z"></path>
                        <path fill="#FFF" d="M173.561 171.615a62.767 62.767 0 0 0-2.065-2.955 67.7 67.7 0 0 0-2.608-3.299 70.112 70.112 0 0 0-3.184-3.527 71.097 71.097 0 0 0-5.924-5.47 72.458 72.458 0 0 0-10.204-7.026 75.2 75.2 0 0 0-5.98-3.055c-.062-.028-.118-.059-.18-.087-9.792-4.44-22.106-7.529-37.416-7.529s-27.624 3.089-37.416 7.529c-.338.153-.653.318-.985.474a75.37 75.37 0 0 0-6.229 3.298 72.589 72.589 0 0 0-9.15 6.395 71.243 71.243 0 0 0-5.924 5.47 70.064 70.064 0 0 0-3.184 3.527 67.142 67.142 0 0 0-2.609 3.299 63.292 63.292 0 0 0-2.065 2.955 56.33 56.33 0 0 0-1.447 2.324c-.033.056-.073.119-.104.174a47.92 47.92 0 0 0-1.07 1.926c-.559 1.068-.818 1.678-.818 1.678v.398c18.285 17.927 43.322 28.985 70.945 28.985 27.678 0 52.761-11.103 71.055-29.095v-.289s-.619-1.45-1.992-3.778a58.346 58.346 0 0 0-1.446-2.322zM106.002 125.5c2.645 0 5.212-.253 7.68-.737a38.272 38.272 0 0 0 3.624-.896 37.124 37.124 0 0 0 5.12-1.958 36.307 36.307 0 0 0 6.15-3.67 35.923 35.923 0 0 0 9.489-10.48 36.558 36.558 0 0 0 2.422-4.84 37.051 37.051 0 0 0 1.716-5.25c.299-1.208.542-2.443.725-3.701.275-1.887.417-3.827.417-5.811s-.142-3.925-.417-5.811a38.734 38.734 0 0 0-1.215-5.494 36.68 36.68 0 0 0-3.648-8.298 35.923 35.923 0 0 0-9.489-10.48 36.347 36.347 0 0 0-6.15-3.67 37.124 37.124 0 0 0-5.12-1.958 37.67 37.67 0 0 0-3.624-.896 39.875 39.875 0 0 0-7.68-.737c-21.162 0-37.345 16.183-37.345 37.345 0 21.159 16.183 37.342 37.345 37.342z"></path>
                    </svg>`
                }
            </div>
            <div class="chat-item-info">
                <div class="chat-item-header">
                    <span class="chat-item-name">${escapeHtml(chat.name || 'Unknown')}</span>
                    <span class="chat-item-time">${time}</span>
                </div>
                <div class="chat-item-preview">${escapeHtml(preview.substring(0, 50))}</div>
            </div>
        `;

        div.addEventListener('click', () => selectChat(chat));
        chatList.appendChild(div);
    });
}

// Select chat
async function selectChat(chat) {
    currentChatId = chat.id;

    // Update UI
    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`[data-chat-id="${chat.id}"]`)?.classList.add('active');

    chatName.textContent = chat.name || 'Unknown';
    chatStatus.textContent = `${chat.message_count || 0} messages archived`;

    noChatSelected.classList.add('hidden');
    deletedView.classList.add('hidden');
    chatView.classList.remove('hidden');

    // Load messages
    try {
        const res = await fetch(`/api/chats/${encodeURIComponent(chat.id)}/messages`);
        const messages = await res.json();
        renderMessages(messages, messagesContainer);
        scrollToBottom();
    } catch (err) {
        console.error('Error loading messages:', err);
    }
}

// Render messages
function renderMessages(messages, container) {
    container.innerHTML = '';
    let lastDate = null;

    messages.forEach(msg => {
        const msgDate = new Date(msg.timestamp).toDateString();

        // Date separator
        if (msgDate !== lastDate) {
            const separator = document.createElement('div');
            separator.className = 'date-separator';
            separator.innerHTML = `<span>${formatDate(msg.timestamp)}</span>`;
            container.appendChild(separator);
            lastDate = msgDate;
        }

        appendMessage(msg, container);
    });
}

// Append single message
function appendMessage(msg, container) {
    const div = document.createElement('div');
    div.className = `message ${msg.is_from_me || msg.isFromMe ? 'sent' : 'received'} ${msg.is_deleted ? 'deleted' : ''}`;
    div.dataset.messageId = msg.id;

    let mediaHtml = '';
    const mediaPath = msg.media_path || msg.mediaPath;
    const mediaMimetype = msg.media_mimetype || msg.mediaMimetype;

    if ((msg.has_media || msg.hasMedia) && mediaPath) {
        if (mediaMimetype?.startsWith('image/')) {
            mediaHtml = `<div class="message-media"><img src="${mediaPath}" alt="Image" loading="lazy"></div>`;
        } else if (mediaMimetype?.startsWith('video/')) {
            mediaHtml = `<div class="message-media"><video src="${mediaPath}" controls></video></div>`;
        } else if (mediaMimetype?.startsWith('audio/')) {
            mediaHtml = `<audio src="${mediaPath}" controls style="max-width: 250px;"></audio>`;
        } else {
            mediaHtml = `<div class="message-media"><a href="${mediaPath}" target="_blank">Download attachment</a></div>`;
        }
    }

    const senderName = msg.sender_name || msg.senderName;
    const deletedBadge = msg.is_deleted ? `
        <div class="message-deleted-badge">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path></svg>
            Deleted
        </div>
    ` : '';

    div.innerHTML = `
        <div class="message-bubble">
            ${!(msg.is_from_me || msg.isFromMe) ? `<div class="message-sender">${escapeHtml(senderName || 'Unknown')}</div>` : ''}
            ${mediaHtml}
            <div class="message-text">${escapeHtml(msg.body || '')}</div>
            ${deletedBadge}
            <div class="message-meta">
                <span class="message-time">${formatTime(msg.timestamp)}</span>
            </div>
        </div>
    `;

    // Click to view image
    const img = div.querySelector('.message-media img');
    if (img) {
        img.addEventListener('click', () => {
            modalImage.src = img.src;
            imageModal.classList.remove('hidden');
        });
    }

    container.appendChild(div);
}

// Show deleted messages
showDeletedBtn.addEventListener('click', async () => {
    currentChatId = null;

    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));

    noChatSelected.classList.add('hidden');
    chatView.classList.add('hidden');
    deletedView.classList.remove('hidden');

    try {
        const res = await fetch('/api/deleted');
        const messages = await res.json();
        renderMessages(messages, deletedMessagesContainer);
    } catch (err) {
        console.error('Error loading deleted messages:', err);
    }
});

closeDeletedBtn.addEventListener('click', () => {
    deletedView.classList.add('hidden');
    noChatSelected.classList.remove('hidden');
});

// Search
let searchTimeout;
searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();

    if (!query) {
        renderChatList(chats);
        return;
    }

    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const results = await res.json();

            // Group by chat
            const chatMap = new Map();
            results.forEach(msg => {
                if (!chatMap.has(msg.chat_id)) {
                    chatMap.set(msg.chat_id, {
                        id: msg.chat_id,
                        name: msg.chat_name,
                        last_message: msg.body,
                        last_message_time: msg.timestamp,
                        message_count: 1
                    });
                }
            });

            renderChatList(Array.from(chatMap.values()));
        } catch (err) {
            console.error('Search error:', err);
        }
    }, 300);
});

// Close modal
imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal || e.target.classList.contains('modal-close')) {
        imageModal.classList.add('hidden');
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        imageModal.classList.add('hidden');
    }
});

// Helpers
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
        return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    } else {
        return date.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
