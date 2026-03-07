// chat.js — Live Chat page logic
// Auth (login/logout/register/renderNavUser/initTheme) is handled by auth.js

let ws          = null;
let currentRoom = null;
let onlineUsers = [];

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('message-input')?.addEventListener('keypress',   e => { if (e.key === 'Enter') sendMessage(); });
    document.getElementById('room-name-input')?.addEventListener('keypress', e => { if (e.key === 'Enter') createRoom(); });

    // Show correct panel on load
    _updatePanel();
});

// Listen for auth events from auth.js
document.addEventListener('auth:login',  () => { _updatePanel(); });
document.addEventListener('auth:logout', () => {
    if (ws) { ws.close(); ws = null; }
    currentRoom = null;
    _updatePanel();
});

function _updatePanel() {
    if (authToken && currentUser) {
        showRoomsPanel();
        loadRooms();
    } else {
        // Not logged in — hide all panels, the nav Login button (from auth.js) handles it
        document.getElementById('auth-panel').style.display  = 'none';
        document.getElementById('rooms-panel').style.display = 'none';
        document.getElementById('chat-panel').style.display  = 'none';
        _showGuestPrompt();
    }
}

function _showGuestPrompt() {
    // Show a friendly "log in to chat" message instead of the old embedded auth form
    const container = document.querySelector('.chat-container');
    if (!container) return;
    container.innerHTML = `
        <div class="panel" style="text-align:center;padding:60px 40px">
            <i class="fa-solid fa-comments" style="font-size:3rem;color:var(--accent);margin-bottom:20px;display:block"></i>
            <h2 style="margin:0 0 12px 0">Join the conversation</h2>
            <p style="color:var(--text-muted);margin:0 0 28px 0">Log in or create an account to access Live Rooms.</p>
            <button class="btn btn-primary" style="padding:14px 32px;font-size:1rem" onclick="openLoginModal()">
                <i class="fa-solid fa-right-to-bracket"></i> Log In / Register
            </button>
        </div>`;
}

// ── Panel visibility helpers ──────────────────────────────────────────────────
function showRoomsPanel() {
    document.getElementById('auth-panel').style.display  = 'none';
    document.getElementById('rooms-panel').style.display = 'block';
    document.getElementById('chat-panel').style.display  = 'none';
}
function showChatPanel() {
    document.getElementById('auth-panel').style.display  = 'none';
    document.getElementById('rooms-panel').style.display = 'none';
    document.getElementById('chat-panel').style.display  = 'block';
}

// ── Rooms ─────────────────────────────────────────────────────────────────────
async function loadRooms() {
    const list = document.getElementById('rooms-list');
    if (!list) return;
    list.innerHTML = '<p class="rooms-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading rooms…</p>';
    try {
        const res   = await fetch(`${API_URL}/rooms`);
        const rooms = await res.json();
        list.innerHTML = '';
        if (!rooms.length) { list.innerHTML = '<p class="rooms-loading">No rooms yet. Create one above!</p>'; return; }
        rooms.forEach(room => list.appendChild(buildRoomCard(room)));
    } catch (e) {
        list.innerHTML = '<p class="rooms-loading error-text">Could not load rooms. Is the API running?</p>';
    }
}

function buildRoomCard(room) {
    const card    = document.createElement('div');
    card.className = 'room-card';
    card.id        = `room-card-${room.name}`;
    const isOwner  = currentUser && room.owner === currentUser.username;
    const onlineHtml = room.online > 0
        ? `<span class="online-badge"><span class="online-dot"></span>${room.online} online</span>` : '';
    card.innerHTML = `
        <div class="room-card-main" onclick="joinRoom('${escapeHtml(room.name)}')">
            <div class="room-icon">#</div>
            <div class="room-info">
                <div class="room-name">${escapeHtml(room.name)}</div>
                <div class="room-desc">${escapeHtml(room.description || 'No description')} ${onlineHtml}</div>
            </div>
        </div>
        <div class="room-actions">
            <button class="btn btn-primary btn-sm" onclick="joinRoom('${escapeHtml(room.name)}')">
                <i class="fa-solid fa-arrow-right-to-bracket"></i> Join
            </button>
            ${isOwner && room.name !== 'general' ? `
            <button class="room-delete-btn" onclick="deleteRoom('${escapeHtml(room.name)}')" title="Delete room">
                <i class="fa-solid fa-trash"></i>
            </button>` : ''}
        </div>`;
    return card;
}

async function createRoom() {
    const nameInput = document.getElementById('room-name-input');
    const descInput = document.getElementById('room-desc-input');
    const errEl     = document.getElementById('room-create-error');
    const name      = nameInput.value.trim();
    const desc      = descInput?.value.trim() || '';
    errEl.textContent = '';

    if (!name) { errEl.textContent = 'Room name is required.'; return; }

    try {
        const res = await fetch(`${API_URL}/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ name, description: desc }),
        });
        if (res.ok || res.status === 201) {
            const room = await res.json();
            nameInput.value = '';
            if (descInput) descInput.value = '';
            const list = document.getElementById('rooms-list');
            const placeholder = list.querySelector('.rooms-loading');
            if (placeholder) placeholder.remove();
            const card = buildRoomCard(room);
            card.style.cssText = 'opacity:0;transform:translateY(-8px)';
            list.prepend(card);
            requestAnimationFrame(() => {
                card.style.transition = 'opacity 0.3s ease,transform 0.3s ease';
                card.style.opacity    = '1';
                card.style.transform  = 'translateY(0)';
            });
        } else {
            const err = await res.json().catch(() => ({}));
            errEl.textContent = err.detail || 'Failed to create room.';
        }
    } catch (e) { errEl.textContent = 'Network error.'; }
}

async function deleteRoom(name) {
    if (!confirm(`Delete room "${name}"? This cannot be undone.`)) return;
    try {
        const res = await fetch(`${API_URL}/rooms/${name}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (res.ok || res.status === 204) {
            const card = document.getElementById(`room-card-${name}`);
            if (card) {
                card.style.transition = 'all 0.3s ease';
                card.style.opacity    = '0';
                card.style.transform  = 'scale(0.95)';
                setTimeout(() => card.remove(), 300);
            }
        } else {
            const err = await res.json().catch(() => ({}));
            alert(err.detail || 'Failed to delete room.');
        }
    } catch (e) { alert('Network error.'); }
}

// ── Chat / WebSocket ──────────────────────────────────────────────────────────
function joinRoom(roomName) {
    currentRoom = roomName;
    document.getElementById('room-title').textContent = `# ${roomName}`;
    document.getElementById('messages').innerHTML = '';
    updateOnlineList([]);
    showChatPanel();

    const wsUrl = `ws://127.0.0.1:8000/ws/chat?token=${encodeURIComponent(authToken)}&room=${encodeURIComponent(roomName)}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => { loadRoomHistory(roomName); };

    ws.onmessage = event => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'system') {
                appendSystemMessage(data.text);
                if (data.users) updateOnlineList(data.users);
            } else if (data.type === 'chat') {
                if (data.username !== currentUser?.username) {
                    appendMessage(data.username, data.text, data.timestamp);
                }
            }
        } catch (e) { appendSystemMessage(event.data); }
        document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
    };

    ws.onclose = () => { appendSystemMessage('Disconnected.'); setTimeout(leaveRoom, 1500); };
    ws.onerror = () => { appendSystemMessage('Connection failed.'); };
}

async function loadRoomHistory(roomName) {
    try {
        const res = await fetch(`${API_URL}/chat_logs?room=${encodeURIComponent(roomName)}`, {
            headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (res.status === 404) return;
        if (!res.ok) return;
        const logs   = await res.json();
        const recent = logs.slice(-50);
        if (recent.length > 0) {
            appendSystemMessage(`─── last ${recent.length} messages ───`);
            recent.forEach(msg => appendMessage(msg.username, msg.text, msg.timestamp, true));
            appendSystemMessage('─── live ───');
        }
        document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
    } catch (e) { /* silent */ }
}

function sendMessage() {
    const input   = document.getElementById('message-input');
    const message = input.value.trim();
    if (message && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
        appendMessage(currentUser.username, message);
        input.value = '';
    }
}

function leaveRoom() {
    if (ws) { ws.close(); ws = null; }
    currentRoom = null;
    showRoomsPanel();
    loadRooms();
}

// ── Online users ──────────────────────────────────────────────────────────────
function updateOnlineList(users) {
    onlineUsers = users;
    const el      = document.getElementById('online-list');
    const countEl = document.getElementById('online-count');
    if (countEl) countEl.textContent = users.length;
    if (el) el.innerHTML = users.map(u => `<span class="online-user">${escapeHtml(u)}</span>`).join('');
}

// ── Message rendering ─────────────────────────────────────────────────────────
function appendMessage(sender, text, isoTimestamp = null, isHistory = false) {
    const messagesDiv = document.getElementById('messages');
    const wrapper     = document.createElement('div');
    wrapper.classList.add('msg-wrapper');
    const msgDiv      = document.createElement('div');
    msgDiv.classList.add('message');
    const now        = isoTimestamp ? new Date(isoTimestamp) : new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const timeSpan   = `<span class="msg-time">${timeString}</span>`;

    if (sender === currentUser?.username) {
        msgDiv.classList.add('msg-me');
        if (isHistory) msgDiv.style.opacity = '0.65';
        msgDiv.innerHTML = `${escapeHtml(text)} ${timeSpan}`;
        wrapper.classList.add('wrapper-me');
    } else {
        msgDiv.classList.add('msg-other');
        if (isHistory) msgDiv.style.opacity = '0.65';
        msgDiv.innerHTML = `<div class="sender-name">${escapeHtml(sender)}</div><div class="msg-content">${escapeHtml(text)} ${timeSpan}</div>`;
        wrapper.classList.add('wrapper-other');
    }

    wrapper.appendChild(msgDiv);
    messagesDiv.appendChild(wrapper);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function appendSystemMessage(text) {
    const messagesDiv = document.getElementById('messages');
    const wrapper     = document.createElement('div');
    wrapper.classList.add('msg-wrapper', 'wrapper-system');
    const msgDiv      = document.createElement('div');
    msgDiv.classList.add('message', 'msg-system');
    const timeString  = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    msgDiv.innerHTML  = `${escapeHtml(text)} <span class="system-time">${timeString}</span>`;
    wrapper.appendChild(msgDiv);
    messagesDiv.appendChild(wrapper);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}