const API_URL = "http://127.0.0.1:8000";

// Shared auth from localStorage — no re-login needed
let authToken   = localStorage.getItem('baerhub-token') || null;
let currentUser = JSON.parse(localStorage.getItem('baerhub-user') || 'null');

let ws              = null;
let currentRoom     = null;
let onlineUsers     = [];

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    renderNavUser();

    if (authToken && currentUser) {
        showRoomsPanel();
        loadRooms();
    } else {
        showAuthPanel();
    }

    document.getElementById('login-password')?.addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
    document.getElementById('reg-password')?.addEventListener('keypress',   e => { if (e.key === 'Enter') register(); });
    document.getElementById('message-input')?.addEventListener('keypress',  e => { if (e.key === 'Enter') sendMessage(); });
    document.getElementById('room-name-input')?.addEventListener('keypress',e => { if (e.key === 'Enter') createRoom(); });

    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.auth-form').forEach(f => f.style.display = 'none');
            document.getElementById(`${tab.dataset.tab}-form`).style.display = 'block';
            document.getElementById('auth-error').textContent = '';
        });
    });
});

// ── Theme ─────────────────────────────────────────────────────────────────────
function initTheme() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const icon = btn.querySelector('i');
    if (document.documentElement.getAttribute('data-theme') === 'dark') icon.classList.replace('fa-moon', 'fa-sun');
    btn.addEventListener('click', () => {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (dark) { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('baerhub-theme','light'); icon.classList.replace('fa-sun','fa-moon'); }
        else      { document.documentElement.setAttribute('data-theme','dark'); localStorage.setItem('baerhub-theme','dark'); icon.classList.replace('fa-moon','fa-sun'); }
    });
}

// ── Nav user pill ─────────────────────────────────────────────────────────────
function renderNavUser() {
    const slot = document.getElementById('nav-user-slot');
    if (!slot) return;
    if (authToken && currentUser) {
        const letter = (currentUser.display_name || currentUser.username).charAt(0).toUpperCase();
        slot.innerHTML = `
            <div class="nav-user-pill" id="user-pill" onclick="toggleUserMenu(event)">
                <span class="nav-avatar">${letter}</span>
                <span class="nav-username">@${escapeHtml(currentUser.username)}</span>
                <i class="fa-solid fa-chevron-down toggle-icon" style="font-size:0.7rem;color:var(--text-muted);transition:transform 0.2s"></i>
            </div>
            <div class="user-dropdown" id="user-dropdown">
                <div class="dropdown-info">
                    <span class="dropdown-display">${escapeHtml(currentUser.display_name || currentUser.username)}</span>
                    <span class="dropdown-handle">@${escapeHtml(currentUser.username)}</span>
                </div>
                <div class="dropdown-divider"></div>
                <button class="dropdown-item danger" onclick="logout()">
                    <i class="fa-solid fa-right-from-bracket"></i> Log Out
                </button>
            </div>`;
    } else {
        slot.innerHTML = '';
    }
}

function toggleUserMenu(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('user-dropdown');
    const pill     = document.getElementById('user-pill');
    if (!dropdown) return;
    const open = dropdown.classList.toggle('open');
    pill.querySelector('.toggle-icon').style.transform = open ? 'rotate(180deg)' : '';
    if (open) setTimeout(() => { document.addEventListener('click', closeDropdown, { once: true }); }, 0);
}
function closeDropdown() {
    const d = document.getElementById('user-dropdown');
    const p = document.getElementById('user-pill');
    if (d) d.classList.remove('open');
    if (p) { const i = p.querySelector('.toggle-icon'); if (i) i.style.transform = ''; }
}

// ── Panel visibility helpers ──────────────────────────────────────────────────
function showAuthPanel()  { document.getElementById('auth-panel').style.display  = 'block'; document.getElementById('rooms-panel').style.display = 'none'; document.getElementById('chat-panel').style.display = 'none'; }
function showRoomsPanel() { document.getElementById('auth-panel').style.display  = 'none';  document.getElementById('rooms-panel').style.display = 'block'; document.getElementById('chat-panel').style.display = 'none'; }
function showChatPanel()  { document.getElementById('auth-panel').style.display  = 'none';  document.getElementById('rooms-panel').style.display = 'none'; document.getElementById('chat-panel').style.display = 'block'; }

// ── Auth ──────────────────────────────────────────────────────────────────────
async function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('auth-error');
    errEl.textContent = '';
    if (!username || !password) { errEl.textContent = 'Fill in all fields.'; return; }

    const form = new URLSearchParams();
    form.append('username', username);
    form.append('password', password);

    try {
        const res = await fetch(`${API_URL}/token`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
        });
        if (res.ok) {
            const data = await res.json();
            authToken   = data.access_token;
            currentUser = { username };
            localStorage.setItem('baerhub-token', authToken);
            localStorage.setItem('baerhub-user',  JSON.stringify(currentUser));
            renderNavUser();
            showRoomsPanel();
            loadRooms();
        } else { errEl.textContent = 'Incorrect username or password.'; }
    } catch (e) { errEl.textContent = 'Network error. Is the backend running?'; }
}

async function register() {
    const username    = document.getElementById('reg-username').value.trim();
    const displayName = document.getElementById('reg-displayname').value.trim();
    const password    = document.getElementById('reg-password').value;
    const errEl       = document.getElementById('auth-error');
    errEl.textContent = '';
    if (!username || !password) { errEl.textContent = 'Username and password required.'; return; }
    try {
        const res = await fetch(`${API_URL}/user`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, display_name: displayName }),
        });
        if (res.ok) {
            document.getElementById('login-username').value = username;
            document.getElementById('login-password').value = password;
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            document.querySelector('[data-tab="login"]').classList.add('active');
            document.querySelectorAll('.auth-form').forEach(f => f.style.display = 'none');
            document.getElementById('login-form').style.display = 'block';
            await login();
        } else {
            const err = await res.json().catch(() => ({}));
            errEl.textContent = err.detail || 'Registration failed.';
        }
    } catch (e) { errEl.textContent = 'Network error.'; }
}

function logout() {
    if (ws) { ws.close(); ws = null; }
    authToken = null; currentUser = null;
    localStorage.removeItem('baerhub-token');
    localStorage.removeItem('baerhub-user');
    renderNavUser();
    showAuthPanel();
}

// ── Rooms ─────────────────────────────────────────────────────────────────────
async function loadRooms() {
    const list = document.getElementById('rooms-list');
    list.innerHTML = '<p class="rooms-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading rooms…</p>';
    try {
        const res = await fetch(`${API_URL}/rooms`);
        const rooms = await res.json();
        list.innerHTML = '';
        if (!rooms.length) { list.innerHTML = '<p class="rooms-loading">No rooms yet. Create one above!</p>'; return; }
        rooms.forEach(room => list.appendChild(buildRoomCard(room)));
    } catch (e) {
        list.innerHTML = '<p class="rooms-loading error-text">Could not load rooms. Is the API running?</p>';
    }
}

function buildRoomCard(room) {
    const card = document.createElement('div');
    card.className = 'room-card';
    card.id = `room-card-${room.name}`;
    const isOwner = currentUser && room.owner === currentUser.username;
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
            <button class="btn btn-danger" onclick="deleteRoom('${escapeHtml(room.name)}')">
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
                card.style.opacity = '1'; card.style.transform = 'translateY(0)';
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
            if (card) { card.style.transition = 'all 0.3s ease'; card.style.opacity = '0'; card.style.transform = 'scale(0.95)'; setTimeout(() => card.remove(), 300); }
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

    ws.onopen = () => {
        loadRoomHistory(roomName);
    };

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

    ws.onclose  = () => { appendSystemMessage('Disconnected.'); setTimeout(leaveRoom, 1500); };
    ws.onerror  = () => { appendSystemMessage('Connection failed.'); };
}

async function loadRoomHistory(roomName) {
    try {
        const res = await fetch(`${API_URL}/chat_logs?room=${encodeURIComponent(roomName)}`, {
            headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (res.status === 404) return; // no history yet
        if (!res.ok) return;
        const logs = await res.json();
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
        appendMessage(currentUser.username, message); // optimistic
        input.value = '';
    }
}

function leaveRoom() {
    if (ws) { ws.close(); ws = null; }
    currentRoom = null;
    showRoomsPanel();
    loadRooms();
}

// ── Online users list ─────────────────────────────────────────────────────────
function updateOnlineList(users) {
    onlineUsers = users;
    const el = document.getElementById('online-list');
    const countEl = document.getElementById('online-count');
    if (countEl) countEl.textContent = users.length;
    if (el) {
        el.innerHTML = users.map(u => `<span class="online-user">${escapeHtml(u)}</span>`).join('');
    }
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

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
