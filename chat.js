// chat.js — ChatHub live chat logic (Discord/WhatsApp-style UI)
// Auth is handled by auth.js (loaded before this script)

let ws          = null;
let currentRoom = null;
let onlineUsers = [];
const memberMap = {}; // sender_id → username

// E2EE state for the currently open room
let _currentRoomType  = null;   // 'private' | 'group'
let _currentDMPartner = null;   // partner username (private rooms only)
let _currentRoomOwner = null;   // owner_id of the current room (for group key distribution)

// ── Member map (resolve sender IDs to usernames) ───────────────────
async function loadMemberMap(roomId) {
    try {
        const res = await fetch(`${API_URL}/rooms/${roomId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        _currentRoomOwner = data.owner_id ?? null;
        (data.members || []).forEach(m => { memberMap[m.user_id] = m.username; });
    } catch(e) {}
}

function resolveUsername(senderId) {
    return memberMap[senderId] || memberMap[String(senderId)] || `user_${senderId}`;
}

// ── Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('message-input')?.addEventListener('keypress', e => {
        if (e.key === 'Enter') sendMessage();
    });
    document.getElementById('room-name-input')?.addEventListener('keypress', e => {
        if (e.key === 'Enter') createRoom();
    });
    _updatePanel();
});

document.addEventListener('auth:login',  () => _updatePanel());
document.addEventListener('auth:logout', () => {
    if (ws) { ws.close(); ws = null; }
    currentRoom = null;
    _currentRoomType  = null;
    _currentDMPartner = null;
    _currentRoomOwner = null;
    E2EE.reset();
    // Clear active room highlight
    document.querySelectorAll('.room-item.active').forEach(el => el.classList.remove('active'));
    _updatePanel();
});

// ── Panel management ─────────────────────────────────────────────
function _updatePanel() {
    _updateUserPanel();
    if (authToken && currentUser) {
        showRoomsPanel();
        loadRooms();
        // Init E2EE key pair for this user (idempotent — safe to call on every panel update)
        E2EE.init(currentUser.username, authToken, API_URL).catch(e =>
            console.warn('[E2EE] init failed:', e)
        );
    } else {
        _showGuestPanel();
    }
}

function _showGuestPanel() {
    document.getElementById('auth-panel').style.display  = 'flex';
    document.getElementById('rooms-panel').style.display = 'none';
    document.getElementById('chat-panel').style.display  = 'none';
    // Clear sidebar rooms since not logged in
    const list = document.getElementById('rooms-list');
    if (list) list.innerHTML = '<div class="sidebar-empty">Log in to see rooms</div>';
    const dms = document.getElementById('dms-list');
    if (dms) dms.innerHTML = '';
}

function showRoomsPanel() {
    document.getElementById('auth-panel').style.display  = 'none';
    document.getElementById('rooms-panel').style.display = 'flex';
    document.getElementById('chat-panel').style.display  = 'none';
    // Update message-input placeholder
    const input = document.getElementById('message-input');
    if (input) input.placeholder = 'Select a room first';
}

function showChatPanel() {
    document.getElementById('auth-panel').style.display  = 'none';
    document.getElementById('rooms-panel').style.display = 'none';
    document.getElementById('chat-panel').style.display  = 'flex';
    // On mobile, close the sidebar so the chat is visible
    if (window.innerWidth <= 768) closeMobileSidebar?.();
}

// ── User panel (bottom of sidebar) ──────────────────────────────
function _updateUserPanel() {
    const nameEl   = document.getElementById('up-name');
    const subEl    = document.getElementById('up-sub');
    const avatarEl = document.getElementById('up-avatar-circle');
    const dotEl    = document.getElementById('up-status-dot');

    if (currentUser) {
        const display = currentUser.display_name || currentUser.username;
        if (nameEl)   nameEl.textContent   = display;
        if (subEl)    subEl.textContent    = `@${currentUser.username}`;
        if (avatarEl) avatarEl.textContent = display.charAt(0).toUpperCase();
        if (dotEl)    { dotEl.className = 'status-dot status-online'; }
    } else {
        if (nameEl)   nameEl.textContent   = 'Guest';
        if (subEl)    subEl.textContent    = 'Click to log in';
        if (avatarEl) avatarEl.textContent = '?';
        if (dotEl)    { dotEl.className = 'status-dot status-offline'; }
    }
}

// ── Create room form toggle ──────────────────────────────────────
function toggleCreateForm() {
    const form = document.getElementById('create-room-form');
    const isOpen = form.style.display !== 'none';
    form.style.display = isOpen ? 'none' : 'flex';
    document.getElementById('room-create-error').textContent = '';
    if (!isOpen) {
        setTimeout(() => {
            const el = _createMode === 'group'
                ? document.getElementById('room-name-input')
                : document.getElementById('dm-username-input');
            el?.focus();
        }, 50);
    }
}

// ── Rooms ─────────────────────────────────────────────────────────
async function loadRooms() {
    const channelList = document.getElementById('rooms-list');
    const dmList      = document.getElementById('dms-list');
    if (!channelList) return;

    channelList.innerHTML = '<div class="sidebar-loading"><i class="fa-solid fa-spinner fa-spin"></i></div>';
    if (dmList) dmList.innerHTML = '';

    try {
        const res   = await fetch(`${API_URL}/rooms`, {
            headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
        });
        const rooms = await res.json();

        const channels = rooms.filter(r => r.type !== 'private');
        const dms      = rooms.filter(r => r.type === 'private');

        channelList.innerHTML = '';
        if (!channels.length) {
            channelList.innerHTML = '<div class="sidebar-empty">No channels yet — create one!</div>';
        }
        channels.forEach(r => channelList.appendChild(buildRoomItem(r)));

        if (dmList) {
            dmList.innerHTML = '';
            if (!dms.length) {
                dmList.innerHTML = '<div class="sidebar-empty">No DMs yet</div>';
            }
            dms.forEach(r => dmList.appendChild(buildRoomItem(r)));
        }
    } catch(e) {
        channelList.innerHTML = '<div class="sidebar-empty sidebar-error">Could not load rooms</div>';
    }
}

function buildRoomItem(room) {
    const item    = document.createElement('div');
    item.className = 'room-item';
    item.id        = `room-card-${room.id}`;
    if (room.id === currentRoom) item.classList.add('active');

    const isOwner = currentUser && room.owner_id === currentUser.id;
    let displayName = room.name;
    if (room.type === 'private' && room.name.startsWith('private:')) {
        const parts = room.name.replace('private:', '').split(':');
        displayName = parts.find(u => u !== currentUser?.username) || parts[0];
    }

    const icon      = room.type === 'private' ? 'fa-lock' : 'fa-hashtag';
    const hasBadge  = room.online_count > 0;
    const deleteBtn = (isOwner && room.name !== 'general')
        ? `<button class="room-item__delete" onclick="deleteRoom('${room.id}')" title="Delete room">
               <i class="fa-solid fa-trash"></i>
           </button>`
        : '';

    item.innerHTML = `
        <div class="room-item__main" onclick="joinRoom('${room.id}', '${escapeHtml(room.name)}')">
            <i class="fa-solid ${icon} room-item__icon"></i>
            <span class="room-item__name">${escapeHtml(displayName)}</span>
            ${hasBadge ? `<span class="room-item__badge">${room.online_count}</span>` : ''}
        </div>
        ${deleteBtn}
    `;
    return item;
}

// ── Create room tab switching ────────────────────────────────────
let _createMode = 'group';

function switchCreateTab(mode) {
    _createMode = mode;
    document.getElementById('tab-group-btn').classList.toggle('active',   mode === 'group');
    document.getElementById('tab-private-btn').classList.toggle('active', mode === 'private');
    document.getElementById('create-group-fields').style.display   = mode === 'group'   ? 'block' : 'none';
    document.getElementById('create-private-fields').style.display = mode === 'private' ? 'block' : 'none';
    document.getElementById('create-submit-label').textContent     = mode === 'group'   ? 'Create Group' : 'Start DM';
    document.getElementById('room-create-error').textContent = '';
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
            await loadRooms();
            joinRoom(room.id, room.name);
        } else {
            const err = await res.json().catch(() => ({}));
            errEl.textContent = err.detail || 'Failed to start DM.';
        }
    } catch(e) { errEl.textContent = 'Network error.'; }
    finally    { btn.disabled = false; }
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
            await loadRooms();
            joinRoom(room.id, room.name);
        } else {
            const err = await res.json().catch(() => ({}));
            errEl.textContent = err.detail || 'Failed to create room.';
        }
    } catch(e) { errEl.textContent = 'Network error.'; }
}

async function deleteRoom(roomId) {
    if (!confirm('Delete this room? This cannot be undone.')) return;
    try {
        const res = await fetch(`${API_URL}/rooms/${roomId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (res.ok || res.status === 204) {
            if (currentRoom === roomId) leaveRoom();
            await loadRooms();
            if (typeof showToast === 'function') showToast('Room deleted.');
        } else {
            const err = await res.json().catch(() => ({}));
            alert(err.detail || 'Failed to delete room.');
        }
    } catch(e) { alert('Network error.'); }
}

// ── Chat / WebSocket ─────────────────────────────────────────────
function joinRoom(roomId, roomRawName) {
    currentRoom = roomId;

    // Compute display name and DM partner
    let displayName = roomRawName || roomId;
    let isPrivate   = false;
    let dmPartner   = null;
    if (displayName.startsWith('private:')) {
        isPrivate = true;
        const parts = displayName.replace('private:', '').split(':');
        dmPartner   = parts.find(u => u !== currentUser?.username) || parts[0];
        displayName = dmPartner;
    }

    // Set E2EE room context
    _currentRoomType  = isPrivate ? 'private' : 'group';
    _currentDMPartner = dmPartner;
    _currentRoomOwner = null;

    // Update top bar
    const titleEl = document.getElementById('room-title');
    const descEl  = document.getElementById('room-desc');
    const iconEl  = document.getElementById('room-icon-badge');
    const inputEl = document.getElementById('message-input');
    if (titleEl) titleEl.textContent  = displayName;
    if (descEl)  descEl.textContent   = isPrivate ? 'Private conversation (E2EE)' : 'Public channel';
    if (iconEl)  iconEl.innerHTML     = isPrivate
        ? '<i class="fa-solid fa-lock" style="font-size:0.85rem"></i>'
        : '#';
    if (inputEl) inputEl.placeholder  = `Message ${isPrivate ? '' : '#'}${displayName}`;

    // Highlight active room in sidebar
    document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
    const card = document.getElementById(`room-card-${roomId}`);
    if (card) card.classList.add('active');

    // Clear messages
    const msgDiv = document.getElementById('messages');
    if (msgDiv) msgDiv.innerHTML = '';
    updateOnlineList([]);
    showChatPanel();

    const wsUrl = `wss://beelog-poes.onrender.com/ws/chat?token=${encodeURIComponent(authToken)}&room=${encodeURIComponent(roomId)}`;
    if (ws) ws.close();
    ws = new WebSocket(wsUrl);

    ws.onopen = async () => {
        await loadMemberMap(currentRoom);

        // ── E2EE key setup ────────────────────────────────────────────────────
        if (_currentRoomType === 'group') {
            // Try to load existing group key
            const hasKey = await E2EE.loadGroupKey(currentRoom).catch(() => null);
            if (!hasKey && _currentRoomOwner === currentUser?.id) {
                // Owner first-time setup: distribute key to all current members
                const memberUsernames = Object.values(memberMap).filter(Boolean);
                if (memberUsernames.length) {
                    await E2EE.distributeGroupKey(currentRoom, memberUsernames)
                        .catch(e => console.warn('[E2EE] Key distribution failed:', e));
                }
            }
        }
        // DM keys are derived on-demand in encryptDM/decryptDM — nothing to preload here
    };

    ws.onmessage = async event => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'system') {
                appendSystemMessage(data.text);
                if (data.users) updateOnlineList(data.users);
            } else if (data.type === 'chat') {
                const isMe = data.username === currentUser?.username;
                if (!isMe) {
                    const sender    = data.username || resolveUsername(data.sender_id);
                    let   text      = data.text || data.message || '';
                    const timestamp = data.timestamp || data.created_at || null;

                    // Decrypt if the payload carries the ENC: prefix
                    if (_currentRoomType === 'private' && _currentDMPartner) {
                        text = await E2EE.decryptDM(text, _currentDMPartner);
                    } else if (_currentRoomType === 'group') {
                        text = await E2EE.decryptGroup(text, currentRoom);
                    }

                    appendMessage(sender, text, timestamp);
                }
            }
        } catch(e) { appendSystemMessage(event.data); }
    };

    ws.onclose = () => {
        appendSystemMessage('Disconnected from room.');
        setTimeout(() => { if (currentRoom === roomId) leaveRoom(); }, 2000);
    };
    ws.onerror = () => appendSystemMessage('Connection error.');
}


async function sendMessage() {
    const input   = document.getElementById('message-input');
    const message = input?.value.trim();
    if (!message || !ws || ws.readyState !== WebSocket.OPEN) return;

    // Encrypt before sending; fall back to plaintext if E2EE not available
    let payload = message;
    try {
        if (_currentRoomType === 'private' && _currentDMPartner) {
            payload = await E2EE.encryptDM(message, _currentDMPartner);
        } else if (_currentRoomType === 'group') {
            payload = await E2EE.encryptGroup(message, currentRoom);
        }
    } catch (e) {
        console.warn('[E2EE] Encryption failed, sending plaintext:', e);
    }

    ws.send(payload);
    appendMessage(currentUser.username, message); // always render the original plaintext locally
    input.value = '';
}

function leaveRoom() {
    if (ws) { ws.close(); ws = null; }
    currentRoom = null;
    document.querySelectorAll('.room-item.active').forEach(el => el.classList.remove('active'));
    showRoomsPanel();
    loadRooms();
}

// ── Online users ─────────────────────────────────────────────────
function updateOnlineList(users) {
    onlineUsers = users;
    const countEl        = document.getElementById('online-count');
    const countMembersEl = document.getElementById('online-count-members');
    if (countEl)        countEl.textContent        = users.length;
    if (countMembersEl) countMembersEl.textContent = users.length;

    const el = document.getElementById('online-list');
    if (!el) return;
    if (!users.length) {
        el.innerHTML = '<p class="members-hint">No one online yet</p>';
        return;
    }
    el.innerHTML = users.map(u => `
        <div class="member-item">
            <div class="member-avatar">${escapeHtml(u.charAt(0).toUpperCase())}</div>
            <div class="member-info">
                <span class="member-name">${escapeHtml(u)}</span>
                <span class="member-status">Online</span>
            </div>
        </div>
    `).join('');
}

// ── Message rendering (Discord-style with grouping) ───────────────
function appendMessage(sender, text, isoTimestamp = null, isHistory = false) {
    const msgDiv = document.getElementById('messages');
    if (!msgDiv) return;

    const isMe      = sender === currentUser?.username;
    const now       = isoTimestamp ? new Date(isoTimestamp) : new Date();
    const timeStr   = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Try to group with previous message row from same sender
    const lastRow = msgDiv.lastElementChild;
    const canGroup = lastRow &&
                     lastRow.dataset.sender === sender &&
                     lastRow.classList.contains('msg-row') &&
                     !lastRow.classList.contains('msg-system-row');

    if (canGroup) {
        const texts  = lastRow.querySelector('.msg-texts');
        const line   = document.createElement('div');
        line.className = 'msg-line';
        if (isHistory) line.style.opacity = '0.65';
        line.innerHTML = `${escapeHtml(text)}<span class="msg-time">${timeStr}</span>`;
        texts?.appendChild(line);
    } else {
        const row = document.createElement('div');
        row.className   = `msg-row${isMe ? ' msg-row--me' : ''}${isHistory ? ' msg-row--history' : ''}`;
        row.dataset.sender = sender;

        const letter = sender.charAt(0).toUpperCase();
        const avatarColor = isMe
            ? 'background:linear-gradient(135deg,#4f46e5,#7c3aed)'
            : `background:${_colorForUsername(sender)}`;

        row.innerHTML = `
            <div class="msg-avatar" style="${avatarColor}">${escapeHtml(letter)}</div>
            <div class="msg-body">
                <div class="msg-header">
                    <span class="msg-sender${isMe ? ' msg-sender--me' : ''}">${escapeHtml(sender)}</span>
                    <span class="msg-timestamp">${timeStr}</span>
                </div>
                <div class="msg-texts">
                    <div class="msg-line">${escapeHtml(text)}<span class="msg-time">${timeStr}</span></div>
                </div>
            </div>
        `;
        msgDiv.appendChild(row);
    }

    msgDiv.scrollTop = msgDiv.scrollHeight;
}

function appendSystemMessage(text) {
    const msgDiv = document.getElementById('messages');
    if (!msgDiv) return;
    const row = document.createElement('div');
    row.className = 'msg-system-row';
    const span = document.createElement('div');
    span.className = 'msg-system';
    span.textContent = text;
    row.appendChild(span);
    msgDiv.appendChild(row);
    msgDiv.scrollTop = msgDiv.scrollHeight;
}

// Generate a consistent color per username (for avatars)
function _colorForUsername(name) {
    const colors = [
        'linear-gradient(135deg,#6366f1,#4f46e5)',
        'linear-gradient(135deg,#ec4899,#db2777)',
        'linear-gradient(135deg,#f59e0b,#d97706)',
        'linear-gradient(135deg,#10b981,#059669)',
        'linear-gradient(135deg,#3b82f6,#2563eb)',
        'linear-gradient(135deg,#8b5cf6,#7c3aed)',
        'linear-gradient(135deg,#ef4444,#dc2626)',
        'linear-gradient(135deg,#14b8a6,#0d9488)',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}
