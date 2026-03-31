// profile.js — BeeLog profile page logic
// Depends on auth.js being loaded first (provides: authToken, currentUser, API_URL,
//   escapeHtml, openLoginModal, logout, renderNavUser)

// ── State ─────────────────────────────────────────────────────────────────────
let _profileUsername  = null;   // whose profile we're viewing
let _isOwnProfile     = false;
let _tweetToDeleteId  = null;

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const params   = new URLSearchParams(window.location.search);
    const urlUser  = params.get('user');

    if (urlUser) {
        _profileUsername = urlUser;
        _isOwnProfile    = !!(currentUser && currentUser.username === urlUser);
    } else if (currentUser) {
        _profileUsername = currentUser.username;
        _isOwnProfile    = true;
    } else {
        // Not logged in and no ?user= param — prompt login
        _showLoginPrompt();
        return;
    }

    _renderProfileHeader(_profileUsername, _isOwnProfile);
    _loadUserTweets(_profileUsername);

    // Scroll-to-top button
    window.addEventListener('scroll', () => {
        const btn = document.getElementById('scroll-top-btn');
        if (btn) btn.classList.toggle('visible', window.scrollY > 400);
    });

    // Modal backdrop close
    window.addEventListener('click', e => {
        if (e.target === document.getElementById('edit-modal'))         closeEditModal();
        if (e.target === document.getElementById('delete-modal'))       closeDeleteModal();
        if (e.target === document.getElementById('edit-profile-modal')) closeEditProfile();
    });
});

// Re-render when auth state changes
document.addEventListener('auth:login', () => {
    // If we were showing the login prompt, reload properly
    const params  = new URLSearchParams(window.location.search);
    const urlUser = params.get('user');
    if (!urlUser && currentUser) {
        _profileUsername = currentUser.username;
        _isOwnProfile    = true;
        _renderProfileHeader(_profileUsername, _isOwnProfile);
        _loadUserTweets(_profileUsername);
        // Hide the prompt if present
        const prompt = document.getElementById('profile-login-prompt');
        if (prompt) prompt.remove();
    } else if (urlUser) {
        _isOwnProfile = !!(currentUser && currentUser.username === urlUser);
        _renderProfileHeader(_profileUsername, _isOwnProfile);
        _loadUserTweets(_profileUsername);
    }
});

document.addEventListener('auth:logout', () => {
    const params  = new URLSearchParams(window.location.search);
    const urlUser = params.get('user');
    if (!urlUser) {
        // Own profile page and now logged out — show prompt
        _showLoginPrompt();
    } else {
        _isOwnProfile = false;
        _renderProfileHeader(_profileUsername, false);
        _loadUserTweets(_profileUsername);
    }
});

// ── Login Prompt ──────────────────────────────────────────────────────────────
function _showLoginPrompt() {
    const tweetsEl = document.getElementById('profile-tweets');
    if (tweetsEl) {
        tweetsEl.innerHTML = `
            <div class="profile-empty" id="profile-login-prompt">
                <i class="fa-solid fa-user-slash"></i>
                <p>Log in to view your profile.</p>
                <button class="profile-btn profile-btn--follow" onclick="openLoginModal()" style="display:inline-flex">
                    <i class="fa-solid fa-right-to-bracket"></i> Log In
                </button>
            </div>`;
    }
    const nameEl = document.getElementById('profile-display-name');
    if (nameEl) nameEl.textContent = 'Your Profile';
    const editBtn = document.getElementById('profile-edit-btn');
    if (editBtn) editBtn.style.display = 'none';
    const followBtn = document.getElementById('profile-follow-btn');
    if (followBtn) followBtn.style.display = 'none';
}

// ── Render Profile Header ─────────────────────────────────────────────────────
function _renderProfileHeader(username, isOwnProfile) {
    // Display name
    const displayName = (isOwnProfile && currentUser && currentUser.display_name)
        ? currentUser.display_name
        : username;
    const nameEl = document.getElementById('profile-display-name');
    if (nameEl) nameEl.textContent = displayName;

    // @username
    const usernameEl = document.getElementById('profile-username');
    if (usernameEl) usernameEl.textContent = '@' + username;

    // Avatar initial
    const avatarEl = document.getElementById('profile-avatar');
    if (avatarEl) avatarEl.textContent = username.charAt(0).toUpperCase();

    // Cover faded initial
    const coverInitialEl = document.getElementById('profile-cover-initial');
    if (coverInitialEl) coverInitialEl.textContent = username.charAt(0).toUpperCase();

    // Edit vs Follow button
    const editBtn   = document.getElementById('profile-edit-btn');
    const followBtn = document.getElementById('profile-follow-btn');
    if (editBtn)   editBtn.style.display   = isOwnProfile ? '' : 'none';
    if (followBtn) followBtn.style.display = isOwnProfile ? 'none' : '';

    // Joined date
    const joinEl = document.getElementById('profile-join-date');
    if (joinEl) {
        if (isOwnProfile && currentUser && currentUser.created_at) {
            const d = new Date(currentUser.created_at);
            joinEl.innerHTML = `<i class="fa-regular fa-calendar"></i> Joined ${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
        } else {
            joinEl.innerHTML = '';
        }
    }

    // Update document title
    document.title = `BeeLog — @${username}`;
}

// ── Load User Tweets ──────────────────────────────────────────────────────────
async function _loadUserTweets(username) {
    const container = document.getElementById('profile-tweets');
    container.innerHTML = `
        <div class="loading-placeholder">
            <div class="loading-spinner"></div>
            <p>Loading tweets…</p>
        </div>`;

    try {
        const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
        const res     = await fetch(`${API_URL}/tweets`, { headers });
        if (!res.ok) throw new Error('fetch_failed');

        const data    = await res.json();
        const tweets  = (data.tweets || []).filter(t => t.author && t.author.username === username);

        // Update tweet count badge
        const countEl = document.getElementById('profile-tweet-count');
        if (countEl) countEl.textContent = tweets.length;

        container.innerHTML = '';

        if (!tweets.length) {
            container.innerHTML = `
                <div class="profile-empty">
                    <i class="fa-regular fa-note-sticky"></i>
                    <p>No tweets yet.</p>
                </div>`;
            return;
        }

        tweets.forEach(t => container.appendChild(_buildProfileTweetCard(t)));
    } catch (e) {
        container.innerHTML = `
            <div class="profile-empty">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <p>Could not load tweets. Is the API running?</p>
            </div>`;
    }
}

// ── Build Profile Tweet Card ──────────────────────────────────────────────────
function _buildProfileTweetCard(tweet) {
    const card        = document.createElement('div');
    card.className    = 'post-card';
    card.id           = `post-card-${tweet.id}`;

    const isOwner     = currentUser && tweet.author.username === currentUser.username;
    const editedBadge = tweet.is_edited
        ? '<span class="edited-badge"><i class="fa-solid fa-pencil"></i> edited</span>'
        : '';
    const letter      = tweet.author.username.charAt(0).toUpperCase();
    const displayName = tweet.author.display_name
        ? `<span class="display-name">${escapeHtml(tweet.author.display_name)}</span>`
        : '';
    const likeDisabledAttr = !authToken ? 'disabled title="Log in to like"' : '';
    const likeIconClass    = tweet.liked_by_me ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
    const likedClass       = tweet.liked_by_me ? 'is-liked' : '';
    const likedData        = tweet.liked_by_me ? 'true' : 'false';

    const ownerButtons = isOwner ? `
        <button class="btn btn-secondary btn-sm"
                onclick='_openEditTweet(${JSON.stringify(tweet).replace(/'/g, "&#39;")})'>
            <i class="fa-solid fa-pen"></i> Edit
        </button>
        <button class="btn btn-danger"
                onclick="_deleteTweet(${tweet.id})">
            <i class="fa-solid fa-trash"></i> Delete
        </button>` : '';

    card.innerHTML = `
        <div class="post-header">
            <div class="author-info">
                <div class="avatar-circle">${letter}</div>
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
                <button class="stat-btn like-btn ${likedClass}"
                        data-tweet-id="${tweet.id}"
                        data-liked="${likedData}"
                        onclick="_toggleLike(this)"
                        ${likeDisabledAttr}>
                    <i class="${likeIconClass}"></i>
                    <span class="like-count">${tweet.like_count}</span>
                </button>
                <span class="stat-btn">
                    <i class="fa-regular fa-comment"></i> ${tweet.comment_count}
                </span>
            </div>
            <div class="action-btns">
                ${ownerButtons}
            </div>
        </div>`;

    return card;
}

// ── Like ──────────────────────────────────────────────────────────────────────
async function _toggleLike(btn) {
    if (!authToken) return showToast('Log in to like tweets.', 'error');

    const tweetId = parseInt(btn.dataset.tweetId);
    const isLiked = btn.dataset.liked === 'true';
    const icon    = btn.querySelector('i');
    const countEl = btn.querySelector('.like-count');

    btn.disabled = true;

    const newLiked = !isLiked;
    const newCount = parseInt(countEl.textContent) + (newLiked ? 1 : -1);
    countEl.textContent = newCount;
    icon.className      = `${newLiked ? 'fa-solid' : 'fa-regular'} fa-heart`;
    btn.classList.toggle('is-liked', newLiked);
    btn.dataset.liked   = String(newLiked);

    try {
        const res = await fetch(`${API_URL}/tweets/${tweetId}/like`, {
            method:  newLiked ? 'POST' : 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (!res.ok && res.status !== 204) throw new Error();
    } catch {
        // Revert optimistic update
        countEl.textContent = parseInt(countEl.textContent) + (newLiked ? -1 : 1);
        icon.className      = `${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart`;
        btn.classList.toggle('is-liked', isLiked);
        btn.dataset.liked   = String(isLiked);
        showToast('Failed to update like.', 'error');
    } finally {
        btn.disabled = false;
    }
}

// ── Edit Tweet ────────────────────────────────────────────────────────────────
function _openEditTweet(tweet) {
    document.getElementById('edit-id').value      = tweet.id;
    document.getElementById('edit-content').value = tweet.content;
    document.getElementById('edit-modal').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('edit-modal').style.display = 'none';
}

async function submitEdit() {
    const id      = document.getElementById('edit-id').value;
    const content = document.getElementById('edit-content').value.trim();
    if (!content) return showToast('Content cannot be empty.', 'error');

    try {
        const res = await fetch(`${API_URL}/tweets/${id}`, {
            method:  'PATCH',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({ content }),
        });
        if (res.ok) {
            closeEditModal();
            showToast('Post updated!');
            _loadUserTweets(_profileUsername);
        } else {
            showToast('Failed to update.', 'error');
        }
    } catch {
        showToast('Network error.', 'error');
    }
}

// ── Delete Tweet ──────────────────────────────────────────────────────────────
function _deleteTweet(id) {
    _tweetToDeleteId = id;
    document.getElementById('delete-modal').style.display = 'flex';
}

function closeDeleteModal() {
    document.getElementById('delete-modal').style.display = 'none';
    _tweetToDeleteId = null;
}

async function confirmDelete() {
    if (!_tweetToDeleteId) return;
    try {
        const res = await fetch(`${API_URL}/tweets/${_tweetToDeleteId}`, {
            method:  'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (res.ok || res.status === 204) {
            showToast('Post deleted.');
            closeDeleteModal();
            const card = document.getElementById(`post-card-${_tweetToDeleteId}`);
            if (card) {
                card.style.transition = 'all 0.3s ease';
                card.style.opacity    = '0';
                card.style.transform  = 'scale(0.95)';
                setTimeout(() => {
                    card.remove();
                    // Update count after removal
                    const countEl = document.getElementById('profile-tweet-count');
                    if (countEl) countEl.textContent = Math.max(0, parseInt(countEl.textContent) - 1);
                }, 300);
            }
        } else {
            showToast('Failed to delete.', 'error');
            closeDeleteModal();
        }
    } catch {
        showToast('Error.', 'error');
        closeDeleteModal();
    }
}

// ── Edit Profile ──────────────────────────────────────────────────────────────
function editProfile() {
    const modal = document.getElementById('edit-profile-modal');
    if (!modal) return;

    // Pre-fill fields
    const displayNameInput = document.getElementById('edit-display-name');
    if (displayNameInput) {
        displayNameInput.value = (currentUser && currentUser.display_name) ? currentUser.display_name : '';
    }
    const bioInput = document.getElementById('edit-bio');
    if (bioInput) bioInput.value = '';

    modal.style.display = 'flex';
    if (displayNameInput) displayNameInput.focus();
}

function closeEditProfile() {
    const modal = document.getElementById('edit-profile-modal');
    if (modal) modal.style.display = 'none';
}

function saveProfile() {
    showToast('Profile editing will be available in a future update!', 'error');
    closeEditProfile();
}

// ── Toast ─────────────────────────────────────────────────────────────────────
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

// ── Scroll to Top ─────────────────────────────────────────────────────────────
function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
