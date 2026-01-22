const socket = io();

// State
let currentUser = null;
let currentChatId = null;
let currentChatCanSend = false;
let chats = [];
let typingTimeout = null;

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
const searchInput = document.getElementById('search-input');
const showDeletedBtn = document.getElementById('show-deleted-btn');
const closeDeletedBtn = document.getElementById('close-deleted-btn');
const imageModal = document.getElementById('image-modal');
const modalImage = document.getElementById('modal-image');
const usernameDisplay = document.getElementById('username-display');
const adminBtn = document.getElementById('admin-btn');
const logoutBtn = document.getElementById('logout-btn');
const closeAdminBtn = document.getElementById('close-admin-btn');
const messageInputContainer = document.getElementById('message-input-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');

// Check authentication on load
async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
            usernameDisplay.textContent = currentUser.username;
            if (currentUser.is_admin) {
                adminBtn.style.display = 'flex';
            }
            return true;
        }
    } catch (e) {}
    window.location.href = '/login.html';
    return false;
}

// Socket Events
socket.on('connect_error', (err) => {
    if (err.message === 'Authentication required') {
        window.location.href = '/login.html';
    }
});

socket.on('qr', (qr) => {
    if (currentUser?.is_admin) {
        qrCode.innerHTML = `<img src="${qr}" alt="QR Code">`;
    }
});

socket.on('ready', () => {
    qrScreen.classList.add('hidden');
    dashboard.classList.remove('hidden');
    loadChats();
});

socket.on('status', (data) => {
    if (data.ready) {
        qrScreen.classList.add('hidden');
        dashboard.classList.remove('hidden');
        loadChats();
    } else if (data.user?.is_admin) {
        // Show QR screen only for admin
    }
});

socket.on('new_message', (message) => {
    loadChats();
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
        const badge = document.createElement('div');
        badge.className = 'message-deleted-badge';
        badge.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path></svg> Deleted`;
        bubble.appendChild(badge);
    }
});

socket.on('chats_loaded', () => {
    loadChats();
});

// Initialize
checkAuth().then(authenticated => {
    if (authenticated) {
        fetch('/api/status')
            .then(res => res.json())
            .then(data => {
                if (data.ready) {
                    qrScreen.classList.add('hidden');
                    dashboard.classList.remove('hidden');
                    loadChats();
                } else if (data.qr && currentUser?.is_admin) {
                    qrCode.innerHTML = `<img src="${data.qr}" alt="QR Code">`;
                } else if (!currentUser?.is_admin) {
                    qrScreen.querySelector('.qr-loading p').textContent = 'Waiting for admin to connect WhatsApp...';
                }
            });
    }
});

// Load chats
async function loadChats() {
    try {
        const res = await fetch('/api/chats');
        if (res.status === 401) {
            window.location.href = '/login.html';
            return;
        }
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
        div.dataset.canSend = chat.can_send || currentUser?.is_admin ? '1' : '0';

        const time = chat.last_message_time ? formatTime(chat.last_message_time) : '';
        const preview = chat.last_message || 'No messages';

        div.innerHTML = `
            <div class="avatar">
                <svg viewBox="0 0 212 212" width="40" height="40">
                    <path fill="#DFE5E7" d="M106.251.5C164.653.5 212 47.846 212 106.25S164.653 212 106.25 212C47.846 212 .5 164.654.5 106.25S47.846.5 106.251.5z"></path>
                    <path fill="#FFF" d="M173.561 171.615a62.767 62.767 0 0 0-2.065-2.955 67.7 67.7 0 0 0-2.608-3.299 70.112 70.112 0 0 0-3.184-3.527 71.097 71.097 0 0 0-5.924-5.47 72.458 72.458 0 0 0-10.204-7.026 75.2 75.2 0 0 0-5.98-3.055c-.062-.028-.118-.059-.18-.087-9.792-4.44-22.106-7.529-37.416-7.529s-27.624 3.089-37.416 7.529c-.338.153-.653.318-.985.474a75.37 75.37 0 0 0-6.229 3.298 72.589 72.589 0 0 0-9.15 6.395 71.243 71.243 0 0 0-5.924 5.47 70.064 70.064 0 0 0-3.184 3.527 67.142 67.142 0 0 0-2.609 3.299 63.292 63.292 0 0 0-2.065 2.955 56.33 56.33 0 0 0-1.447 2.324c-.033.056-.073.119-.104.174a47.92 47.92 0 0 0-1.07 1.926c-.559 1.068-.818 1.678-.818 1.678v.398c18.285 17.927 43.322 28.985 70.945 28.985 27.678 0 52.761-11.103 71.055-29.095v-.289s-.619-1.45-1.992-3.778a58.346 58.346 0 0 0-1.446-2.322zM106.002 125.5c2.645 0 5.212-.253 7.68-.737a38.272 38.272 0 0 0 3.624-.896 37.124 37.124 0 0 0 5.12-1.958 36.307 36.307 0 0 0 6.15-3.67 35.923 35.923 0 0 0 9.489-10.48 36.558 36.558 0 0 0 2.422-4.84 37.051 37.051 0 0 0 1.716-5.25c.299-1.208.542-2.443.725-3.701.275-1.887.417-3.827.417-5.811s-.142-3.925-.417-5.811a38.734 38.734 0 0 0-1.215-5.494 36.68 36.68 0 0 0-3.648-8.298 35.923 35.923 0 0 0-9.489-10.48 36.347 36.347 0 0 0-6.15-3.67 37.124 37.124 0 0 0-5.12-1.958 37.67 37.67 0 0 0-3.624-.896 39.875 39.875 0 0 0-7.68-.737c-21.162 0-37.345 16.183-37.345 37.345 0 21.159 16.183 37.342 37.345 37.342z"></path>
                </svg>
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
    currentChatCanSend = chat.can_send || currentUser?.is_admin;

    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`[data-chat-id="${chat.id}"]`)?.classList.add('active');

    chatName.textContent = chat.name || 'Unknown';
    chatStatus.textContent = `${chat.message_count || 0} messages`;

    noChatSelected.classList.add('hidden');
    deletedView.classList.add('hidden');
    chatView.classList.remove('hidden');

    // Show/hide message input based on permission
    messageInputContainer.style.display = currentChatCanSend ? 'block' : 'none';

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
    const deletedBadge = msg.is_deleted ? `<div class="message-deleted-badge"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path></svg> Deleted</div>` : '';

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

    const img = div.querySelector('.message-media img');
    if (img) {
        img.addEventListener('click', () => {
            modalImage.src = img.src;
            imageModal.classList.remove('hidden');
        });
    }

    container.appendChild(div);
}

// Send message
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || !currentChatId || !currentChatCanSend) return;

    sendBtn.disabled = true;
    messageInput.disabled = true;

    try {
        const res = await fetch(`/api/chats/${encodeURIComponent(currentChatId)}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        if (res.ok) {
            messageInput.value = '';
            messageInput.style.height = 'auto';
        } else {
            const data = await res.json();
            alert(data.error || 'Failed to send message');
        }
    } catch (err) {
        alert('Failed to send message');
    }

    sendBtn.disabled = false;
    messageInput.disabled = false;
    messageInput.focus();
}

// Typing indicator
messageInput?.addEventListener('input', () => {
    if (!currentChatId || !currentChatCanSend) return;

    // Send typing start
    socket.emit('start_typing', currentChatId);

    // Clear previous timeout
    if (typingTimeout) clearTimeout(typingTimeout);

    // Stop typing after 3 seconds of no input
    typingTimeout = setTimeout(() => {
        socket.emit('stop_typing', currentChatId);
    }, 3000);

    // Auto-resize textarea
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
});

messageInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

sendBtn?.addEventListener('click', sendMessage);

// Logout
logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
});

// Admin panel state
let adminUsers = [];
let adminAllPermissions = [];
let selectedUserId = null;
let selectedChatIds = new Set();
let usersPage = 1;
const USERS_PER_PAGE = 10;

const adminPanel = document.getElementById('admin-panel');

// Admin panel
adminBtn?.addEventListener('click', () => {
    adminPanel.classList.remove('hidden');
    dashboard.classList.add('hidden');
    loadAdminData();
});

closeAdminBtn?.addEventListener('click', () => {
    adminPanel.classList.add('hidden');
    dashboard.classList.remove('hidden');
});

// Admin tab switching
document.querySelectorAll('.admin-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
        btn.classList.add('active');
        document.getElementById(`${btn.dataset.tab}-tab`).classList.remove('hidden');

        // Load tab-specific data
        if (btn.dataset.tab === 'matrix') {
            loadPermissionMatrix();
        }
    });
});

// Load admin data
async function loadAdminData() {
    try {
        const [usersRes, permsRes] = await Promise.all([
            fetch('/api/admin/users'),
            fetch('/api/admin/permissions/all')
        ]);

        adminUsers = await usersRes.json();
        adminAllPermissions = await permsRes.json().catch(() => []);

        // Update stats
        document.getElementById('stat-users').textContent = adminUsers.length;
        document.getElementById('stat-chats').textContent = chats.length;
        document.getElementById('stat-perms').textContent = adminAllPermissions.length;

        renderUsersTable();
        renderRecentUsers();
        updatePermissionDropdowns();
    } catch (err) {
        console.error('Error loading admin data:', err);
    }
}

// Render users table with search and pagination
function renderUsersTable(searchQuery = '') {
    const filtered = adminUsers.filter(u =>
        u.username.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const totalPages = Math.ceil(filtered.length / USERS_PER_PAGE);
    const start = (usersPage - 1) * USERS_PER_PAGE;
    const paged = filtered.slice(start, start + USERS_PER_PAGE);

    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = paged.map(u => {
        const permCount = adminAllPermissions.filter(p => p.user_id === u.id).length;
        const createdDate = u.created_at ? new Date(u.created_at).toLocaleDateString() : '-';
        return `
            <tr>
                <td><strong>${escapeHtml(u.username)}</strong></td>
                <td><span class="badge ${u.is_admin ? 'badge-admin' : 'badge-user'}">${u.is_admin ? 'Admin' : 'User'}</span></td>
                <td><span class="badge badge-count">${u.is_admin ? 'All' : permCount}</span></td>
                <td>${createdDate}</td>
                <td>
                    ${!u.is_admin ? `<button class="btn btn-danger btn-sm delete-user-btn" data-user-id="${u.id}">Delete</button>` : '<span class="text-muted">-</span>'}
                </td>
            </tr>
        `;
    }).join('');

    // Add delete handlers
    tbody.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (confirm('Delete this user? This will also remove all their permissions.')) {
                await fetch(`/api/admin/users/${btn.dataset.userId}`, { method: 'DELETE' });
                loadAdminData();
            }
        });
    });

    // Render pagination
    renderPagination('users-pagination', usersPage, totalPages, (page) => {
        usersPage = page;
        renderUsersTable(searchQuery);
    });
}

function renderPagination(containerId, currentPage, totalPages, onPageChange) {
    const container = document.getElementById(containerId);
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = `<button ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">&lt;</button>`;

    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
            html += `<button class="${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
        } else if (i === currentPage - 2 || i === currentPage + 2) {
            html += `<span>...</span>`;
        }
    }

    html += `<button ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">&gt;</button>`;
    container.innerHTML = html;

    container.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!btn.disabled) onPageChange(parseInt(btn.dataset.page));
        });
    });
}

function renderRecentUsers() {
    const recent = adminUsers.slice(0, 5);
    const container = document.getElementById('recent-users');
    container.innerHTML = recent.map(u => `
        <div class="perm-card">
            <div class="perm-card-info">
                <div class="perm-card-name">${escapeHtml(u.username)}</div>
                <div class="perm-card-badges">
                    <span class="perm-badge ${u.is_admin ? 'send' : 'read'}">${u.is_admin ? 'Admin' : 'User'}</span>
                </div>
            </div>
        </div>
    `).join('') || '<p class="text-muted">No users yet</p>';
}

// User search
document.getElementById('user-search')?.addEventListener('input', (e) => {
    usersPage = 1;
    renderUsersTable(e.target.value);
});

// Permission dropdowns
function updatePermissionDropdowns() {
    // User dropdown
    const userDropdown = document.getElementById('perm-user-dropdown');
    const nonAdminUsers = adminUsers.filter(u => !u.is_admin);
    userDropdown.innerHTML = nonAdminUsers.map(u => `
        <div class="select-dropdown-item" data-user-id="${u.id}">${escapeHtml(u.username)}</div>
    `).join('') || '<div class="select-dropdown-item">No non-admin users</div>';

    // Chat dropdown
    updateChatDropdown();
}

function updateChatDropdown(searchQuery = '') {
    const chatDropdown = document.getElementById('perm-chat-dropdown');
    const filtered = chats.filter(c =>
        (c.name || c.id).toLowerCase().includes(searchQuery.toLowerCase())
    );

    chatDropdown.innerHTML = filtered.slice(0, 50).map(c => `
        <div class="select-dropdown-item ${selectedChatIds.has(c.id) ? 'selected' : ''}" data-chat-id="${c.id}">
            ${escapeHtml(c.name || c.id)}
            ${selectedChatIds.has(c.id) ? '<span>✓</span>' : ''}
        </div>
    `).join('') || '<div class="select-dropdown-item">No chats found</div>';

    // Add click handlers
    chatDropdown.querySelectorAll('.select-dropdown-item[data-chat-id]').forEach(item => {
        item.addEventListener('click', () => {
            const chatId = item.dataset.chatId;
            if (selectedChatIds.has(chatId)) {
                selectedChatIds.delete(chatId);
            } else {
                selectedChatIds.add(chatId);
            }
            updateChatDropdown(searchQuery);
        });
    });
}

// User search dropdown
const permUserSearch = document.getElementById('perm-user-search');
const permUserDropdown = document.getElementById('perm-user-dropdown');

permUserSearch?.addEventListener('focus', () => {
    permUserDropdown.classList.add('show');
});

permUserSearch?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const items = permUserDropdown.querySelectorAll('.select-dropdown-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(query) ? '' : 'none';
    });
});

permUserDropdown?.addEventListener('click', (e) => {
    const item = e.target.closest('.select-dropdown-item');
    if (item && item.dataset.userId) {
        selectedUserId = item.dataset.userId;
        const user = adminUsers.find(u => u.id == selectedUserId);
        permUserSearch.value = user?.username || '';
        permUserDropdown.classList.remove('show');

        document.getElementById('selected-user').textContent = user?.username;
        document.getElementById('selected-user').classList.add('show');
        document.getElementById('perm-user-name').textContent = user?.username;

        loadUserPermissionsGrid(selectedUserId);
    }
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-select')) {
        document.querySelectorAll('.select-dropdown').forEach(d => d.classList.remove('show'));
    }
});

// Chat search dropdown
const permChatSearch = document.getElementById('perm-chat-search');
const permChatDropdown = document.getElementById('perm-chat-dropdown');

permChatSearch?.addEventListener('focus', () => {
    permChatDropdown.classList.add('show');
});

permChatSearch?.addEventListener('input', (e) => {
    updateChatDropdown(e.target.value);
    permChatDropdown.classList.add('show');
});

// Select all chats
document.getElementById('select-all-chats-btn')?.addEventListener('click', () => {
    if (selectedChatIds.size === chats.length) {
        selectedChatIds.clear();
    } else {
        chats.forEach(c => selectedChatIds.add(c.id));
    }
    updateChatDropdown(permChatSearch?.value || '');
});

// Load user permissions grid
async function loadUserPermissionsGrid(userId) {
    const res = await fetch(`/api/admin/users/${userId}/permissions`);
    const permissions = await res.json();

    const grid = document.getElementById('permissions-grid');
    grid.innerHTML = permissions.map(p => `
        <div class="perm-card">
            <div class="perm-card-info">
                <div class="perm-card-name">${escapeHtml(p.chat_name || p.chat_id)}</div>
                <div class="perm-card-badges">
                    ${p.can_read ? '<span class="perm-badge read">Read</span>' : ''}
                    ${p.can_send ? '<span class="perm-badge send">Send</span>' : ''}
                </div>
            </div>
            <div class="perm-card-actions">
                <button class="btn btn-danger btn-sm" data-chat-id="${p.chat_id}">Remove</button>
            </div>
        </div>
    `).join('') || '<p class="text-muted">No permissions assigned</p>';

    grid.querySelectorAll('.btn-danger').forEach(btn => {
        btn.addEventListener('click', async () => {
            await fetch(`/api/admin/users/${userId}/permissions/${encodeURIComponent(btn.dataset.chatId)}`, { method: 'DELETE' });
            loadUserPermissionsGrid(userId);
            loadAdminData();
        });
    });
}

// Filter permissions list
document.getElementById('perm-list-search')?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    document.querySelectorAll('#permissions-grid .perm-card').forEach(card => {
        const name = card.querySelector('.perm-card-name').textContent.toLowerCase();
        card.style.display = name.includes(query) ? '' : 'none';
    });
});

// Add user
document.getElementById('add-user-btn')?.addEventListener('click', async () => {
    const username = document.getElementById('new-username').value;
    const password = document.getElementById('new-password').value;
    const isAdmin = document.getElementById('new-is-admin').checked;

    if (!username || !password) return alert('Fill all fields');

    const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, isAdmin })
    });

    if (res.ok) {
        document.getElementById('new-username').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('new-is-admin').checked = false;
        loadAdminData();
    } else {
        const data = await res.json();
        alert(data.error);
    }
});

// Add permissions (bulk)
document.getElementById('add-perm-btn')?.addEventListener('click', async () => {
    if (!selectedUserId) return alert('Select a user first');
    if (selectedChatIds.size === 0) return alert('Select at least one chat');

    const canRead = document.getElementById('perm-can-read').checked;
    const canSend = document.getElementById('perm-can-send').checked;

    // Add permissions for all selected chats
    for (const chatId of selectedChatIds) {
        await fetch(`/api/admin/users/${selectedUserId}/permissions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId, canRead, canSend })
        });
    }

    selectedChatIds.clear();
    updateChatDropdown('');
    loadUserPermissionsGrid(selectedUserId);
    loadAdminData();
    alert(`Permissions applied to ${selectedChatIds.size || 'selected'} chat(s)`);
});

// Permission Matrix
async function loadPermissionMatrix() {
    const nonAdminUsers = adminUsers.filter(u => !u.is_admin);

    if (nonAdminUsers.length === 0 || chats.length === 0) {
        document.getElementById('matrix-body').innerHTML = '<tr><td colspan="100">No data available</td></tr>';
        return;
    }

    // Build header
    const header = document.getElementById('matrix-header');
    header.innerHTML = `
        <tr>
            <th>User / Chat</th>
            ${chats.slice(0, 20).map(c => `<th title="${escapeHtml(c.name || c.id)}">${escapeHtml((c.name || c.id).substring(0, 10))}...</th>`).join('')}
        </tr>
    `;

    // Build body
    const body = document.getElementById('matrix-body');
    body.innerHTML = nonAdminUsers.map(user => {
        const userPerms = adminAllPermissions.filter(p => p.user_id === user.id);
        return `
            <tr>
                <td>${escapeHtml(user.username)}</td>
                ${chats.slice(0, 20).map(chat => {
                    const perm = userPerms.find(p => p.chat_id === chat.id);
                    let cellClass = 'none';
                    if (perm?.can_read && perm?.can_send) cellClass = 'both';
                    else if (perm?.can_read) cellClass = 'read';
                    else if (perm?.can_send) cellClass = 'send';
                    return `<td class="matrix-cell ${cellClass}" data-user-id="${user.id}" data-chat-id="${chat.id}" title="${escapeHtml(user.username)} - ${escapeHtml(chat.name || chat.id)}"></td>`;
                }).join('')}
            </tr>
        `;
    }).join('');

    // Add click handlers for matrix cells
    body.querySelectorAll('.matrix-cell').forEach(cell => {
        cell.addEventListener('click', async () => {
            const userId = cell.dataset.userId;
            const chatId = cell.dataset.chatId;

            // Cycle through: none -> read -> both -> none
            if (cell.classList.contains('none')) {
                await setPermission(userId, chatId, true, false);
                cell.className = 'matrix-cell read';
            } else if (cell.classList.contains('read')) {
                await setPermission(userId, chatId, true, true);
                cell.className = 'matrix-cell both';
            } else {
                await deletePermission(userId, chatId);
                cell.className = 'matrix-cell none';
            }
            loadAdminData();
        });
    });
}

async function setPermission(userId, chatId, canRead, canSend) {
    await fetch(`/api/admin/users/${userId}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, canRead, canSend })
    });
}

async function deletePermission(userId, chatId) {
    await fetch(`/api/admin/users/${userId}/permissions/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
}

// Matrix filters
document.getElementById('matrix-user-filter')?.addEventListener('input', () => filterMatrix());
document.getElementById('matrix-chat-filter')?.addEventListener('input', () => filterMatrix());

function filterMatrix() {
    const userFilter = document.getElementById('matrix-user-filter').value.toLowerCase();
    const chatFilter = document.getElementById('matrix-chat-filter').value.toLowerCase();

    // Filter rows (users)
    document.querySelectorAll('#matrix-body tr').forEach(row => {
        const username = row.querySelector('td:first-child').textContent.toLowerCase();
        row.style.display = username.includes(userFilter) ? '' : 'none';
    });

    // For chat filter we'd need to rebuild - for now just reload
    if (chatFilter) {
        // This is a simplified version - full implementation would filter columns
    }
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
let searchTimeout2;
searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout2);
    const query = e.target.value.trim();

    if (!query) {
        renderChatList(chats);
        return;
    }

    searchTimeout2 = setTimeout(async () => {
        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const results = await res.json();
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

// Close modals
imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal || e.target.classList.contains('modal-close')) {
        imageModal.classList.add('hidden');
    }
});

adminPanel?.addEventListener('click', (e) => {
    if (e.target === adminPanel) {
        adminPanel.classList.add('hidden');
        dashboard.classList.remove('hidden');
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        imageModal.classList.add('hidden');
        if (adminPanel && !adminPanel.classList.contains('hidden')) {
            adminPanel.classList.add('hidden');
            dashboard.classList.remove('hidden');
        }
    }
});

// Helpers
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
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
