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

function toggleCreateForm() {
    const form = document.getElementById('create-room-form');
    const isOpen = form.style.display !== 'none';
    form.style.display = isOpen ? 'none' : 'block';
    document.getElementById('room-create-error').textContent = '';
    if (!isOpen) setTimeout(() => document.getElementById('room-name-input')?.focus(), 50);
}

// ── Rooms ─────────────────────────────────────────────────────────────────────
async function loadRooms() {
    const list = document.getElementById('rooms-list');
    if (!list) return;
    list.innerHTML = '<p class="rooms-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading rooms…</p>';
    try {
        const res   = await fetch(`${API_URL}/rooms`, {
            headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
        });
        const rooms = await res.json();
        list.innerHTML = '';
        if (!rooms.length) { list.innerHTML = '<p class="rooms-loading">No rooms yet. Create one above!</p>'; return; }
        rooms.forEach(room => list.appendChild(buildRoomCard(room)));
    } catch (e) {
        list.innerHTML = '<p class="rooms-loading error-text">Could not load rooms. Is the API running?</p>';
    }
}

function buildRoomCard(room) {
    const card     = document.createElement('div');
    card.className = 'room-card';
    card.id        = `room-card-${room.id}`;
    const isOwner  = currentUser && room.owner_id === currentUser.id;

    // Friendly display name for private rooms
    let displayName = room.name;
    if (room.type === 'private' && room.name.startsWith('private:')) {
        const parts = room.name.replace('private:', '').split(':');
        const other = parts.find(u => u !== currentUser?.username) || parts[0];
        displayName = `DM: ${other}`;
    }

    const typeIcon   = room.type === 'private' ? 'fa-lock' : 'fa-hashtag';
    const onlineHtml = room.online_count > 0
        ? `<span class="online-badge"><span class="online-dot"></span>${room.online_count} online</span>` : '';

    card.innerHTML = `
        <div class="room-card-main" onclick="joinRoom('${room.id}', '${escapeHtml(room.name)}')">
            <div class="room-icon"><i class="fa-solid ${typeIcon}" style="font-size:0.85rem"></i></div>
            <div class="room-info">
                <div class="room-name">${escapeHtml(displayName)}</div>
                <div class="room-desc">${escapeHtml(room.description || '')} ${onlineHtml}</div>
            </div>
        </div>
        <div class="room-actions">
            <button class="btn btn-primary btn-sm" onclick="joinRoom('${room.id}', '${escapeHtml(room.name)}')">
                <i class="fa-solid fa-arrow-right-to-bracket"></i> Join
            </button>
            ${isOwner && room.name !== 'general' ? `
            <button class="room-delete-btn" onclick="deleteRoom('${room.id}')" title="Delete room">
                <i class="fa-solid fa-trash"></i>
            </button>` : ''}
        </div>`;
    return card;
}

// ── Create room — tab switching ───────────────────────────────────────────────
let _createMode = 'group'; // 'group' | 'private'

function switchCreateTab(mode) {
    _createMode = mode;
    document.getElementById('tab-group-btn').classList.toggle('active',   mode === 'group');
    document.getElementById('tab-private-btn').classList.toggle('active', mode === 'private');
    document.getElementById('create-group-fields').style.display   = mode === 'group'   ? 'block' : 'none';
    document.getElementById('create-private-fields').style.display = mode === 'private' ? 'block' : 'none';
    document.getElementById('create-submit-label').textContent     = mode === 'group' ? 'Create Group' : 'Start DM';
    document.getElementById('room-create-error').textContent = '';

    // Focus the relevant input
    setTimeout(() => {
        const el = mode === 'group'
            ? document.getElementById('room-name-input')
            : document.getElementById('dm-username-input');
        el?.focus();
    }, 50);
}

function handleCreateRoom() {
    if (_createMode === 'private') createPrivateRoom();
    else createRoom();
}

async function createPrivateRoom() {
    const usernameInput = document.getElementById('dm-username-input');
    const errEl         = document.getElementById('room-create-error');
    const username      = usernameInput.value.trim();
    errEl.textContent   = '';

    if (!username) { errEl.textContent = 'Enter a username.'; return; }
    if (username === currentUser?.username) { errEl.textContent = "You can't DM yourself."; return; }

    const btn = document.getElementById('create-submit-btn');
    btn.disabled = true;

    try {
        const res = await fetch(`${API_URL}/rooms/private`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ username }),
        });
        if (res.ok || res.status === 201) {
            const room = await res.json();
            usernameInput.value = '';
            toggleCreateForm();
            // Join the room immediately
            joinRoom(room.id, room.name);
        } else {
            const err = await res.json().catch(() => ({}));
            errEl.textContent = err.detail || 'Failed to start DM.';
        }
    } catch(e) { errEl.textContent = 'Network error.'; }
    finally { btn.disabled = false; }
}


    const nameInput = document.getElementById('room-name-input');
    const descInput = document.getElementById('room-desc-input');
    const errEl     = document.getElementById('room-create-error');
    const name      = nameInput.value.trim();
    const desc      = descInput?.value.trim() || '';
    errEl.textContent = '';

    if (!name) { errEl.textContent = 'Room name is required.'; return; }

    try {
        const res = await fetch(`${API_URL}/rooms/group`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ name, description: desc }),
        });
        if (res.ok || res.status === 201) {
            const room = await res.json();
            nameInput.value = '';
            if (descInput) descInput.value = '';
            toggleCreateForm();
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

async function deleteRoom(roomId) {
    if (!confirm(`Delete this room? This cannot be undone.`)) return;
    try {
        const res = await fetch(`${API_URL}/rooms/${roomId}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (res.ok || res.status === 204) {
            const card = document.getElementById(`room-card-${roomId}`);
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
function joinRoom(roomId, roomDisplayName) {
    currentRoom = roomId;
    // For private rooms, show "DM: otheruser" instead of the canonical key
    let title = roomDisplayName || roomId;
    if (title.startsWith('private:')) {
        const parts = title.replace('private:', '').split(':');
        const other = parts.find(u => u !== currentUser?.username) || parts[0];
        title = `DM: ${other}`;
    }
    document.getElementById('room-title').textContent = `# ${title}`;
    document.getElementById('messages').innerHTML = '';
    updateOnlineList([]);
    showChatPanel();

    const wsUrl = `wss://beelog-poes.onrender.com/ws/chat?token=${encodeURIComponent(authToken)}&room=${encodeURIComponent(roomId)}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => { loadRoomHistory(currentRoom); };

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

async function loadRoomHistory(roomId) {
    try {
        const res = await fetch(`${API_URL}/chat_logs?room=${encodeURIComponent(roomId)}`, {
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