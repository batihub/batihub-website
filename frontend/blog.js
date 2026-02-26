const API_URL = "http://127.0.0.1:8000";

let authToken = localStorage.getItem('baerhub-token') || null;
let currentUser = JSON.parse(localStorage.getItem('baerhub-user') || 'null');
let charCountEl = null;

document.addEventListener('DOMContentLoaded', () => {
    fetchTweets();
    updateAuthUI();

    charCountEl = document.getElementById('char-count');
    const contentInput = document.getElementById('post-content');
    if (contentInput && charCountEl) {
        contentInput.addEventListener('input', () => {
            const len = contentInput.value.length;
            charCountEl.textContent = `${len}/280`;
            charCountEl.style.color = len > 260 ? (len >= 280 ? 'var(--danger)' : 'orange') : 'var(--text-muted)';
        });
    }

    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        const icon = themeToggle.querySelector('i');
        if (document.documentElement.getAttribute('data-theme') === 'dark') {
            icon.classList.replace('fa-moon', 'fa-sun');
        }
        themeToggle.addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            document.documentElement.setAttribute('data-theme', isDark ? '' : 'dark');
            if (isDark) {
                document.documentElement.removeAttribute('data-theme');
                localStorage.setItem('baerhub-theme', 'light');
                icon.classList.replace('fa-sun', 'fa-moon');
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
                localStorage.setItem('baerhub-theme', 'dark');
                icon.classList.replace('fa-moon', 'fa-sun');
            }
        });
    }

    // Tab switching (login / register)
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            document.querySelectorAll('.auth-form').forEach(f => f.style.display = 'none');
            document.getElementById(`${target}-form`).style.display = 'block';
        });
    });
});

// ── Auth UI ───────────────────────────────────────────────────────────────────

function updateAuthUI() {
    const authSection = document.getElementById('auth-section');
    const loggedInSection = document.getElementById('logged-in-section');
    const postSection = document.getElementById('post-section');

    if (authToken && currentUser) {
        authSection.style.display = 'none';
        loggedInSection.style.display = 'block';
        postSection.style.display = 'block';
        document.getElementById('logged-in-username').textContent = `@${currentUser.username}`;
    } else {
        authSection.style.display = 'block';
        loggedInSection.style.display = 'none';
        postSection.style.display = 'none';
    }
}

async function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (!username || !password) return showToast('Enter username and password.', 'error');

    const form = new URLSearchParams();
    form.append('username', username);
    form.append('password', password);

    try {
        const res = await fetch(`${API_URL}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form,
        });
        if (res.ok) {
            const data = await res.json();
            authToken = data.access_token;
            currentUser = { username };
            localStorage.setItem('baerhub-token', authToken);
            localStorage.setItem('baerhub-user', JSON.stringify(currentUser));
            showToast(`Welcome back, ${username}!`);
            updateAuthUI();
            fetchTweets(); // re-fetch to get liked_by_me
        } else {
            showToast('Incorrect username or password.', 'error');
        }
    } catch (e) {
        showToast('Network error. Is the backend running?', 'error');
    }
}

async function register() {
    const username = document.getElementById('reg-username').value.trim();
    const displayName = document.getElementById('reg-displayname').value.trim();
    const password = document.getElementById('reg-password').value;

    if (!username || !password) return showToast('Username and password are required.', 'error');
    if (username.length > 50) return showToast('Username max 50 characters.', 'error');

    try {
        const res = await fetch(`${API_URL}/user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, display_name: displayName }),
        });
        if (res.ok) {
            const data = await res.json();
            showToast(`Account created! You can now log in.`);
            // Switch to login tab
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            document.querySelector('[data-tab="login"]').classList.add('active');
            document.querySelectorAll('.auth-form').forEach(f => f.style.display = 'none');
            document.getElementById('login-form').style.display = 'block';
            document.getElementById('login-username').value = username;
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || 'Registration failed.', 'error');
        }
    } catch (e) {
        showToast('Network error.', 'error');
    }
}

function logout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('baerhub-token');
    localStorage.removeItem('baerhub-user');
    updateAuthUI();
    fetchTweets();
    showToast('Logged out.');
}

// ── Tweet CRUD ────────────────────────────────────────────────────────────────

async function createPost() {
    const content = document.getElementById('post-content').value.trim();
    if (!content) return showToast('Write something first.', 'error');
    if (content.length > 280) return showToast('Max 280 characters.', 'error');

    try {
        const res = await fetch(`${API_URL}/tweets`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({ content }),
        });
        if (res.ok) {
            showToast('Tweet posted!');
            document.getElementById('post-content').value = '';
            if (charCountEl) charCountEl.textContent = '0/280';
            fetchTweets();
        } else if (res.status === 401) {
            showToast('Session expired. Please log in again.', 'error');
            logout();
        } else {
            showToast('Failed to post tweet.', 'error');
        }
    } catch (e) {
        showToast('Network error.', 'error');
    }
}

async function fetchTweets() {
    const container = document.getElementById('posts-container');
    container.innerHTML = '<p class="loading-text">Loading tweets...</p>';

    try {
        const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
        const res = await fetch(`${API_URL}/tweets`, { headers });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const tweets = data.tweets;
        container.innerHTML = '';

        if (!tweets.length) {
            container.innerHTML = '<p class="loading-text">No tweets yet. Be the first to post!</p>';
            return;
        }

        tweets.forEach(tweet => renderTweet(tweet, container));
    } catch (e) {
        container.innerHTML = '<p class="error">Error fetching tweets. Is the API running?</p>';
    }
}

function renderTweet(tweet, container) {
    const card = document.createElement('div');
    card.className = 'post-card';
    card.id = `post-card-${tweet.id}`;

    const isOwner = currentUser && tweet.author.username === currentUser.username;
    const editedBadge = tweet.is_edited
        ? '<span class="edited-badge"><i class="fa-solid fa-pencil"></i> edited</span>' : '';
    const likedClass = tweet.liked_by_me ? 'fa-solid fa-heart liked' : 'fa-regular fa-heart';
    const displayName = tweet.author.display_name
        ? `<span class="display-name">${escapeHtml(tweet.author.display_name)}</span>` : '';

    const avatarLetter = tweet.author.username.charAt(0).toUpperCase();

    card.innerHTML = `
        <div class="post-header">
            <div class="author-info">
                <div class="avatar-circle">${avatarLetter}</div>
                <div>
                    ${displayName}
                    <div class="username-handle">@${escapeHtml(tweet.author.username)}</div>
                </div>
            </div>
            <span class="author-badge">#${tweet.id}</span>
        </div>
        <div class="post-meta">
            ${new Date(tweet.created_at).toLocaleString()} ${editedBadge}
        </div>
        <div class="post-content">${escapeHtml(tweet.content)}</div>
        <div class="post-actions">
            <div class="tweet-stats">
                <button class="stat-btn like-btn ${tweet.liked_by_me ? 'is-liked' : ''}" 
                    onclick="toggleLike(${tweet.id}, ${tweet.liked_by_me})"
                    ${!authToken ? 'disabled title="Log in to like"' : ''}>
                    <i class="${likedClass}"></i>
                    <span id="like-count-${tweet.id}">${tweet.like_count}</span>
                </button>
                <span class="stat-btn">
                    <i class="fa-regular fa-comment"></i>
                    ${tweet.comment_count}
                </span>
            </div>
            <div class="action-btns">
                ${isOwner ? `
                    <button class="btn btn-secondary btn-sm" onclick='openEditModal(${JSON.stringify(tweet).replace(/'/g, "&#39;")})'>
                        <i class="fa-solid fa-pen"></i> Edit
                    </button>
                    <button class="btn btn-danger" onclick="deletePost(${tweet.id})">
                        <i class="fa-solid fa-trash"></i> Delete
                    </button>
                ` : ''}
            </div>
        </div>
    `;
    container.appendChild(card);
}

async function toggleLike(tweetId, isLiked) {
    if (!authToken) return showToast('Log in to like tweets.', 'error');
    const method = isLiked ? 'DELETE' : 'POST';
    try {
        await fetch(`${API_URL}/tweets/${tweetId}/like`, {
            method,
            headers: { 'Authorization': `Bearer ${authToken}` },
        });
        fetchTweets();
    } catch (e) { /* silent */ }
}

// ── Delete ────────────────────────────────────────────────────────────────────

let postToDeleteId = null;
const deleteModal = document.getElementById('delete-modal');

function deletePost(id) {
    postToDeleteId = id;
    deleteModal.style.display = 'flex';
}

function closeDeleteModal() {
    deleteModal.style.display = 'none';
    postToDeleteId = null;
}

async function confirmDelete() {
    if (!postToDeleteId) return;
    try {
        const res = await fetch(`${API_URL}/tweets/${postToDeleteId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (res.ok || res.status === 204) {
            showToast('Tweet deleted.');
            closeDeleteModal();
            const card = document.getElementById(`post-card-${postToDeleteId}`);
            if (card) {
                card.style.transition = 'all 0.3s ease';
                card.style.opacity = '0';
                card.style.transform = 'scale(0.95)';
                setTimeout(() => card.remove(), 300);
            }
        } else {
            showToast('Failed to delete.', 'error');
            closeDeleteModal();
        }
    } catch (e) {
        showToast('Error deleting tweet.', 'error');
        closeDeleteModal();
    }
}

// ── Edit ──────────────────────────────────────────────────────────────────────

const editModal = document.getElementById('edit-modal');

function openEditModal(tweet) {
    document.getElementById('edit-id').value = tweet.id;
    document.getElementById('edit-content').value = tweet.content;
    editModal.style.display = 'flex';
}

function closeEditModal() {
    editModal.style.display = 'none';
}

async function submitEdit() {
    const id = document.getElementById('edit-id').value;
    const content = document.getElementById('edit-content').value.trim();
    if (!content) return showToast('Content cannot be empty.', 'error');

    try {
        const res = await fetch(`${API_URL}/tweets/${id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({ content }),
        });
        if (res.ok) {
            closeEditModal();
            showToast('Tweet updated!');
            fetchTweets();
        } else {
            showToast('Failed to update.', 'error');
        }
    } catch (e) {
        showToast('Network error.', 'error');
    }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
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

// ── Utilities ─────────────────────────────────────────────────────────────────

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

window.onclick = function (event) {
    if (event.target === editModal) closeEditModal();
    if (event.target === deleteModal) closeDeleteModal();
};
