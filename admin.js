// admin.js — Admin dashboard logic
// Requires auth.js to be loaded first (provides authToken, currentUser, API_URL, escapeHtml, showToast)

let _allUsers = [];

document.addEventListener('DOMContentLoaded', () => {
    _checkAccess();
});

document.addEventListener('auth:login',  () => _checkAccess());
document.addEventListener('auth:logout', () => {
    document.getElementById('admin-dashboard').style.display = 'none';
    document.getElementById('access-denied').style.display  = 'block';
});

// ── Access guard ──────────────────────────────────────────────────────────────
function _checkAccess() {
    const dashboard   = document.getElementById('admin-dashboard');
    const denied      = document.getElementById('access-denied');
    const role        = currentUser?.role;

    if (!authToken || !currentUser || (role !== 'admin' && role !== 'root')) {
        dashboard.style.display = 'none';
        denied.style.display    = 'block';
        return;
    }

    denied.style.display    = 'none';
    dashboard.style.display = 'block';

    // Show role badge
    const badge = document.getElementById('admin-role-badge');
    badge.innerHTML = `<span class="role-badge ${role}">${role === 'root' ? '👑 Root' : '🛡 Admin'}</span>`;

    // Hide role-change column for non-root (admins can view but not change roles)
    if (role !== 'root') {
        document.getElementById('actions-col').textContent = '';
    }

    loadStats();
    loadUsers();
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab, btn) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    btn.classList.add('active');

    if (tab === 'rooms')    loadAdminRooms();
    if (tab === 'messages') loadAdminMessages();
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function loadStats() {
    try {
        const res   = await fetch(`${API_URL}/admin/stats`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const data  = await res.json();
        animateCount('stat-users',   data.total_users   ?? 0);
        animateCount('stat-tweets',  data.total_tweets  ?? 0);
        animateCount('stat-rooms',   data.total_rooms   ?? 0);
        animateCount('stat-admins',  data.total_admins  ?? 0);
    } catch(e) { /* silent — stats are non-critical */ }
}

function animateCount(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const dur = 600, steps = 30;
    let i = 0;
    const timer = setInterval(() => {
        i++;
        el.textContent = Math.round(target * (i / steps));
        if (i >= steps) { el.textContent = target; clearInterval(timer); }
    }, dur / steps);
}

// ── Users ─────────────────────────────────────────────────────────────────────
async function loadUsers() {
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="table-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</td></tr>';
    try {
        const res = await fetch(`${API_URL}/admin/users`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) throw new Error(res.status);
        _allUsers = await res.json();
        renderUsers(_allUsers);
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="6" class="table-loading" style="color:var(--danger)">
            <i class="fa-solid fa-triangle-exclamation"></i> Failed to load users (${e.message})
        </td></tr>`;
    }
}

function filterUsers() {
    const q = document.getElementById('user-search').value.toLowerCase();
    renderUsers(_allUsers.filter(u =>
        u.username.toLowerCase().includes(q) ||
        (u.display_name || '').toLowerCase().includes(q)
    ));
}

function renderUsers(users) {
    const tbody   = document.getElementById('users-tbody');
    const isRoot  = currentUser?.role === 'root';
    if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="table-loading">No users found.</td></tr>';
        return;
    }
    tbody.innerHTML = users.map(u => {
        const letter  = (u.display_name || u.username).charAt(0).toUpperCase();
        const color   = `hsl(${(u.id * 47) % 360}deg 55% 45%)`;
        const joined  = new Date(u.created_at).toLocaleDateString();
        const rpClass = { intern: 'rp-intern', admin: 'rp-admin', root: 'rp-root' }[u.role] || 'rp-intern';
        const isSelf  = u.username === currentUser.username;
        const isRootUser = u.role === 'root';

        // Role cell — dropdown for root, badge for non-root
        const roleCell = (isRoot && !isRootUser)
            ? `<select class="role-select" onchange="changeRole(${u.id}, this)" ${isSelf ? 'disabled title="Cannot change your own role"' : ''}>
                    <option value="intern"  ${u.role === 'intern'  ? 'selected' : ''}>intern</option>
                    <option value="admin"   ${u.role === 'admin'   ? 'selected' : ''}>admin</option>
               </select>`
            : `<span class="rp ${rpClass}">${u.role}</span>`;

        const actionsCell = (isRoot && !isRootUser && !isSelf)
            ? `<button class="tbl-btn tbl-btn-danger" onclick="deleteUser(${u.id}, '${escapeHtml(u.username)}')">
                   <i class="fa-solid fa-trash"></i> Delete
               </button>`
            : `<span style="color:var(--text-muted);font-size:0.78rem">—</span>`;

        return `<tr>
            <td style="color:var(--text-muted);font-size:0.8rem">#${u.id}</td>
            <td>
                <div class="user-cell">
                    <div class="av" style="background:${color}">${letter}</div>
                    <div>
                        <div class="uname">${escapeHtml(u.display_name || u.username)}</div>
                        <div class="dname">@${escapeHtml(u.username)}</div>
                    </div>
                </div>
            </td>
            <td>${roleCell}</td>
            <td style="font-weight:600">${u.tweet_count ?? 0}</td>
            <td style="color:var(--text-muted)">${joined}</td>
            <td>${actionsCell}</td>
        </tr>`;
    }).join('');
}

async function changeRole(userId, selectEl) {
    const newRole = selectEl.value;
    selectEl.disabled = true;
    try {
        const res = await fetch(`${API_URL}/admin/users/${userId}/role`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ role: newRole }),
        });
        if (res.ok) {
            showToast(`Role updated to ${newRole}`);
            // Update local cache
            const u = _allUsers.find(u => u.id === userId);
            if (u) u.role = newRole;
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || 'Failed to update role', 'error');
            // Revert
            await loadUsers();
        }
    } catch(e) {
        showToast('Network error', 'error');
    } finally {
        selectEl.disabled = false;
    }
}

function deleteUser(userId, username) {
    openConfirm(
        `Delete @${username}?`,
        'This will permanently delete their account, tweets, and messages. This cannot be undone.',
        async () => {
            try {
                const res = await fetch(`${API_URL}/admin/users/${userId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${authToken}` }
                });
                if (res.ok || res.status === 204) {
                    showToast(`@${username} deleted`);
                    _allUsers = _allUsers.filter(u => u.id !== userId);
                    renderUsers(_allUsers);
                    loadStats();
                } else {
                    const err = await res.json().catch(() => ({}));
                    showToast(err.detail || 'Failed to delete', 'error');
                }
            } catch(e) { showToast('Network error', 'error'); }
        }
    );
}

// ── Rooms ─────────────────────────────────────────────────────────────────────
async function loadAdminRooms() {
    const tbody = document.getElementById('rooms-tbody');
    tbody.innerHTML = '<tr><td colspan="7" class="table-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</td></tr>';
    try {
        const res   = await fetch(`${API_URL}/admin/rooms`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) throw new Error(res.status);
        const rooms = await res.json();
        if (!rooms.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="table-loading">No rooms found.</td></tr>';
            return;
        }
        tbody.innerHTML = rooms.map(r => {
            const typeClass  = r.type === 'group' ? 'type-group' : 'type-private';
            const lockClass  = r.locked ? 'locked' : 'unlocked';
            const lockIcon   = r.locked ? 'fa-lock' : 'fa-lock-open';
            const lockLabel  = r.locked ? 'Locked' : 'Open';
            const created    = new Date(r.created_at).toLocaleDateString();
            return `<tr>
                <td style="font-weight:600">${escapeHtml(r.name)}</td>
                <td><span class="type-pill ${typeClass}">${r.type}</span></td>
                <td style="color:var(--text-muted)">@${escapeHtml(r.owner_username || '—')}</td>
                <td style="font-weight:600">${r.member_count ?? '—'}</td>
                <td style="color:var(--text-muted)">${created}</td>
                <td><span class="lock-badge ${lockClass}"><i class="fa-solid ${lockIcon}"></i> ${lockLabel}</span></td>
                <td style="display:flex;gap:6px;flex-wrap:wrap">
                    <button class="tbl-btn tbl-btn-secondary" onclick="toggleRoomLock('${r.id}', ${r.locked}, this)">
                        <i class="fa-solid ${r.locked ? 'fa-lock-open' : 'fa-lock'}"></i>
                        ${r.locked ? 'Unlock' : 'Lock'}
                    </button>
                    <button class="tbl-btn tbl-btn-danger" onclick="deleteAdminRoom('${r.id}', '${escapeHtml(r.name)}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>`;
        }).join('');
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="7" class="table-loading" style="color:var(--danger)">
            <i class="fa-solid fa-triangle-exclamation"></i> Failed to load rooms
        </td></tr>`;
    }
}

async function toggleRoomLock(roomId, currentlyLocked, btn) {
    btn.disabled = true;
    try {
        const res = await fetch(`${API_URL}/admin/rooms/${roomId}/lock`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ locked: !currentlyLocked }),
        });
        if (res.ok) { showToast(`Room ${currentlyLocked ? 'unlocked' : 'locked'}`); loadAdminRooms(); }
        else showToast('Failed', 'error');
    } catch(e) { showToast('Network error', 'error'); }
    finally { btn.disabled = false; }
}

function deleteAdminRoom(roomId, name) {
    openConfirm(
        `Delete room "${name}"?`,
        'All messages and memberships in this room will be permanently deleted.',
        async () => {
            try {
                const res = await fetch(`${API_URL}/rooms/${roomId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${authToken}` }
                });
                if (res.ok || res.status === 204) {
                    showToast(`Room deleted`);
                    loadAdminRooms();
                    loadStats();
                } else {
                    const err = await res.json().catch(() => ({}));
                    showToast(err.detail || 'Failed', 'error');
                }
            } catch(e) { showToast('Network error', 'error'); }
        }
    );
}

// ── Messages ──────────────────────────────────────────────────────────────────
async function loadAdminMessages() {
    const feed = document.getElementById('messages-list');
    feed.innerHTML = '<p class="table-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</p>';
    try {
        const res  = await fetch(`${API_URL}/admin/messages`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) throw new Error();
        const msgs = await res.json();
        if (!msgs.length) { feed.innerHTML = '<p class="table-loading">No messages yet.</p>'; return; }
        feed.innerHTML = msgs.map(m => {
            const letter = (m.sender_username || '?').charAt(0).toUpperCase();
            const color  = `hsl(${((m.sender_username || '?').charCodeAt(0) * 47) % 360}deg 55% 45%)`;
            const ts     = new Date(m.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            return `<div class="msg-row">
                <div class="av" style="background:${color}">${letter}</div>
                <div>
                    <div class="sender">${escapeHtml(m.sender_username || 'unknown')}</div>
                    <div class="room-tag"># ${escapeHtml(m.room_name || m.room_id)}</div>
                </div>
                <div class="body" title="${escapeHtml(m.message)}">${escapeHtml(m.message)}</div>
                <div class="ts">${ts}</div>
            </div>`;
        }).join('');
    } catch(e) {
        feed.innerHTML = `<p class="table-loading" style="color:var(--danger)">
            <i class="fa-solid fa-triangle-exclamation"></i> Failed to load messages
        </p>`;
    }
}

// ── Confirm modal ─────────────────────────────────────────────────────────────
let _confirmCallback = null;

function openConfirm(title, body, callback) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-body').textContent  = body;
    _confirmCallback = callback;
    document.getElementById('confirm-modal').style.display = 'flex';
    document.getElementById('confirm-ok-btn').onclick = () => {
        closeConfirm();
        _confirmCallback?.();
    };
}
function closeConfirm() {
    document.getElementById('confirm-modal').style.display = 'none';
    _confirmCallback = null;
}
window.addEventListener('click', e => {
    if (e.target === document.getElementById('confirm-modal')) closeConfirm();
});

// ── Toast (mirrors blog.js toast — works standalone too) ──────────────────────
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast     = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success'
        ? '<i class="fa-solid fa-circle-check" style="color:var(--success)"></i>'
        : '<i class="fa-solid fa-circle-exclamation" style="color:var(--danger)"></i>';
    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}