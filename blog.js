// blog.js — BeeLog page logic
// Auth (login/logout/register/renderNavUser/initTheme) is handled by auth.js

// ── Pagination state ──────────────────────────────────────────────────────────
let _nextCursor  = null;   // next before_id to fetch, null = no more pages
let _loadingMore = false;  // guard against concurrent fetches

document.addEventListener('DOMContentLoaded', () => {
    fetchTweets();

    // Infinite scroll — watch the sentinel element at the bottom of the feed
    const sentinel = document.getElementById('feed-sentinel');
    if (sentinel && 'IntersectionObserver' in window) {
        const obs = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting) _loadMoreTweets();
        }, { rootMargin: '400px' });
        obs.observe(sentinel);
    }

    // Char counter
    const contentInput = document.getElementById('post-content');
    const charCountEl  = document.getElementById('char-count');
    if (contentInput && charCountEl) {
        contentInput.addEventListener('input', () => {
            const len = contentInput.value.length;
            charCountEl.textContent = `${len} chars`;
            charCountEl.style.color = '';
        });
    }

    // Scroll to top button
    window.addEventListener('scroll', () => {
        const btn = document.getElementById('scroll-top-btn');
        if (btn) btn.classList.toggle('visible', window.scrollY > 400);
    });

    // Composer toggle
    const composerToggle = document.getElementById('composer-toggle');
    const composerBody   = document.getElementById('composer-body');
    if (composerToggle && composerBody) {
        composerToggle.addEventListener('click', () => {
            const open = composerBody.classList.toggle('open');
            composerToggle.querySelector('.toggle-icon').style.transform = open ? 'rotate(180deg)' : '';
        });
    }

    // Modal backdrop close
    window.addEventListener('click', e => {
        if (e.target === document.getElementById('edit-modal'))   closeEditModal();
        if (e.target === document.getElementById('delete-modal')) closeDeleteModal();
    });

    // Keyboard shortcuts
    document.getElementById('post-content')?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) createPost();
    });

    // Show/hide composer based on login state
    _updateComposerVisibility();
});

// Listen for auth events from auth.js
document.addEventListener('auth:login',      () => { _updateComposerVisibility(); fetchTweets(); });
document.addEventListener('auth:logout',     () => { _updateComposerVisibility(); fetchTweets(); });
document.addEventListener('auth:navRendered',() => { _updateComposerVisibility(); });

function _updateComposerVisibility() {
    const postSection = document.getElementById('post-section');
    if (postSection) postSection.style.display = (authToken && currentUser) ? 'flex' : 'none';
}

// ── Tweet CRUD ────────────────────────────────────────────────────────────────
async function createPost() {
    const content = document.getElementById('post-content').value.trim();
    if (!content) return showToast('Write something first.', 'error');

    const btn = document.querySelector('.tweet-post-btn') || document.querySelector('#composer-body .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    try {
        const res = await fetch(`${API_URL}/tweets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ content }),
        });
        if (res.ok) {
            const tweet = await res.json();
            showToast('Posted!');
            document.getElementById('post-content').value = '';
            document.getElementById('char-count').textContent = '0 chars';
            const container = document.getElementById('posts-container');
            const placeholder = container.querySelector('.loading-text');
            if (placeholder) placeholder.remove();
            prependTweet(tweet, container);
        } else if (res.status === 401) {
            showToast('Session expired. Log in again.', 'error');
            logout();
        } else {
            showToast('Failed to post.', 'error');
        }
    } catch (e) { showToast('Network error.', 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Post'; } }
}

async function fetchTweets() {
    // Reset pagination state for a fresh load
    _nextCursor  = null;
    _loadingMore = true;

    const container = document.getElementById('posts-container');
    const endMsg    = document.getElementById('feed-end-msg');
    const indicator = document.getElementById('feed-load-indicator');
    container.innerHTML = '<p class="loading-text"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</p>';
    if (endMsg)    endMsg.style.display    = 'none';
    if (indicator) indicator.style.display = 'none';

    try {
        const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
        const res     = await fetch(`${API_URL}/tweets`, { headers });
        if (!res.ok) throw new Error();
        const data = await res.json();
        container.innerHTML = '';
        if (!data.tweets.length) {
            container.innerHTML = '<p class="loading-text">No tweets yet. Be the first!</p>';
        } else {
            data.tweets.forEach(t => container.appendChild(buildTweetCard(t)));
        }
        _nextCursor = data.next_cursor ?? null;
        if (_nextCursor === null && endMsg && data.tweets.length) endMsg.style.display = 'block';
    } catch (e) {
        container.innerHTML = '<p class="error"><i class="fa-solid fa-triangle-exclamation"></i> Could not load feed. Is the API running?</p>';
    } finally {
        _loadingMore = false;
    }
}

async function _loadMoreTweets() {
    if (_loadingMore || _nextCursor === null) return;
    _loadingMore = true;

    const indicator = document.getElementById('feed-load-indicator');
    const endMsg    = document.getElementById('feed-end-msg');
    if (indicator) indicator.style.display = 'block';

    try {
        const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
        const res = await fetch(`${API_URL}/tweets?before_id=${_nextCursor}`, { headers });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const container = document.getElementById('posts-container');
        data.tweets.forEach(t => container.appendChild(buildTweetCard(t)));
        _nextCursor = data.next_cursor ?? null;
        if (_nextCursor === null) {
            if (indicator) indicator.style.display = 'none';
            if (endMsg)    endMsg.style.display    = 'block';
        }
    } catch (e) {
        // Silently fail — user can scroll up and back to retry
    } finally {
        _loadingMore = false;
        const ind = document.getElementById('feed-load-indicator');
        if (ind && _nextCursor !== null) ind.style.display = 'none';
    }
}

// ── Tweet expand / collapse ───────────────────────────────────────────────────
let _expandedCard = null;

function collapseActiveTweet() {
    if (!_expandedCard) return;
    _expandedCard.classList.remove('is-expanded');
    const toggle = _expandedCard.querySelector('.content-toggle');
    if (toggle) toggle.innerHTML = _toggleHtml(false);
    _expandedCard = null;
    document.getElementById('tweet-backdrop')?.classList.remove('active');
}

function _toggleHtml(expanded) {
    return expanded
        ? `Show less <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 8l4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        : `Show more <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function _isTruncated(contentEl) {
    // Temporarily remove clamp to measure real height
    contentEl.style.webkitLineClamp = 'unset';
    contentEl.style.overflow = 'visible';
    const full = contentEl.scrollHeight;
    contentEl.style.webkitLineClamp = '';
    contentEl.style.overflow = '';
    const clamped = contentEl.clientHeight;
    return full > clamped + 4;
}

function prependTweet(tweet, container) {
    const card = buildTweetCard(tweet);
    card.style.cssText = 'opacity:0;transform:translateY(-12px)';
    container.prepend(card);
    requestAnimationFrame(() => {
        card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        card.style.opacity    = '1';
        card.style.transform  = 'translateY(0)';
    });
}

function buildTweetCard(tweet) {
    const card = document.createElement('div');
    card.className = 'post-card';
    card.id = `post-card-${tweet.id}`;
    const isOwner     = currentUser && tweet.author.username === currentUser.username;
    const editedBadge = tweet.is_edited ? '<span class="edited-badge"><i class="fa-solid fa-pencil"></i> edited</span>' : '';
    const letter      = tweet.author.username.charAt(0).toUpperCase();
    const displayName = tweet.author.display_name ? `<span class="display-name">${escapeHtml(tweet.author.display_name)}</span>` : '';

    card.innerHTML = `
        <div class="post-header">
            <div class="author-info">
                <a href="profile.html?user=${encodeURIComponent(tweet.author.username)}" class="avatar-circle" style="text-decoration:none;color:inherit">${letter}</a>
                <div><a href="profile.html?user=${encodeURIComponent(tweet.author.username)}" style="text-decoration:none;color:inherit">${displayName}<div class="username-handle">@${escapeHtml(tweet.author.username)}</div></a></div>
            </div>
            <span class="author-badge">#${tweet.id}</span>
        </div>
        <div class="post-meta">${new Date(tweet.created_at).toLocaleString()} ${editedBadge}</div>
        <div class="post-content">${escapeHtml(tweet.content)}</div>
        <div class="post-actions">
            <div class="tweet-stats">
                <button class="stat-btn like-btn ${tweet.liked_by_me ? 'is-liked' : ''}"
                    data-tweet-id="${tweet.id}" data-liked="${tweet.liked_by_me ? 'true' : 'false'}"
                    onclick="toggleLike(this)" ${!authToken ? 'disabled title="Log in to like"' : ''}>
                    <i class="${tweet.liked_by_me ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
                    <span class="like-count">${tweet.like_count}</span>
                </button>
                <span class="stat-btn"><i class="fa-regular fa-comment"></i> ${tweet.comment_count}</span>
            </div>
            <div class="action-btns">
                ${isOwner ? `
                    <button class="btn btn-secondary btn-sm" onclick='openEditModal(${JSON.stringify(tweet).replace(/'/g, "&#39;")})'>
                        <i class="fa-solid fa-pen"></i> Edit</button>
                    <button class="btn btn-danger" onclick="deletePost(${tweet.id})">
                        <i class="fa-solid fa-trash"></i> Delete</button>` : ''}
            </div>
        </div>`;

    // After inserting into DOM, check if content overflows and add toggle
    requestAnimationFrame(() => {
        const contentEl = card.querySelector('.post-content');
        if (!contentEl) return;
        if (_isTruncated(contentEl)) {
            const toggle = document.createElement('button');
            toggle.className = 'content-toggle';
            toggle.innerHTML = _toggleHtml(false);
            contentEl.insertAdjacentElement('afterend', toggle);

            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isExpanded = card.classList.contains('is-expanded');
                if (isExpanded) {
                    collapseActiveTweet();
                } else {
                    // Collapse any previously expanded card first
                    collapseActiveTweet();
                    card.classList.add('is-expanded');
                    toggle.innerHTML = _toggleHtml(true);
                    _expandedCard = card;
                    document.getElementById('tweet-backdrop')?.classList.add('active');
                }
            });
        }
    });

    return card;
}

// ── Like ──────────────────────────────────────────────────────────────────────
async function toggleLike(btn) {
    if (!authToken) return showToast('Log in to like tweets.', 'error');
    const tweetId = parseInt(btn.dataset.tweetId);
    const isLiked = btn.dataset.liked === 'true';
    const icon    = btn.querySelector('i');
    const countEl = btn.querySelector('.like-count');

    btn.disabled = true;
    const newLiked = !isLiked;
    const newCount = parseInt(countEl.textContent) + (newLiked ? 1 : -1);
    countEl.textContent  = newCount;
    icon.className       = `${newLiked ? 'fa-solid' : 'fa-regular'} fa-heart`;
    btn.classList.toggle('is-liked', newLiked);
    btn.dataset.liked    = String(newLiked);

    try {
        const res = await fetch(`${API_URL}/tweets/${tweetId}/like`, {
            method: newLiked ? 'POST' : 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (!res.ok && res.status !== 204) throw new Error();
    } catch {
        countEl.textContent  = parseInt(countEl.textContent) + (newLiked ? -1 : 1);
        icon.className       = `${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart`;
        btn.classList.toggle('is-liked', isLiked);
        btn.dataset.liked    = String(isLiked);
    } finally {
        btn.disabled = false;
    }
}

// ── Delete ────────────────────────────────────────────────────────────────────
let postToDeleteId = null;
function deletePost(id) { postToDeleteId = id; document.getElementById('delete-modal').style.display = 'flex'; }
function closeDeleteModal() { document.getElementById('delete-modal').style.display = 'none'; postToDeleteId = null; }
async function confirmDelete() {
    if (!postToDeleteId) return;
    try {
        const res = await fetch(`${API_URL}/tweets/${postToDeleteId}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.ok || res.status === 204) {
            showToast('Post deleted.');
            closeDeleteModal();
            const card = document.getElementById(`post-card-${postToDeleteId}`);
            if (card) {
                card.style.transition = 'all 0.3s ease';
                card.style.opacity    = '0';
                card.style.transform  = 'scale(0.95)';
                setTimeout(() => card.remove(), 300);
            }
        } else { showToast('Failed to delete.', 'error'); closeDeleteModal(); }
    } catch (e) { showToast('Error.', 'error'); closeDeleteModal(); }
}

// ── Edit ──────────────────────────────────────────────────────────────────────
function openEditModal(tweet) {
    document.getElementById('edit-id').value      = tweet.id;
    document.getElementById('edit-content').value = tweet.content;
    document.getElementById('edit-modal').style.display = 'flex';
}
function closeEditModal() { document.getElementById('edit-modal').style.display = 'none'; }
async function submitEdit() {
    const id      = document.getElementById('edit-id').value;
    const content = document.getElementById('edit-content').value.trim();
    if (!content) return showToast('Content cannot be empty.', 'error');
    try {
        const res = await fetch(`${API_URL}/tweets/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ content }),
        });
        if (res.ok) { closeEditModal(); showToast('Post updated!'); fetchTweets(); }
        else showToast('Failed to update.', 'error');
    } catch (e) { showToast('Network error.', 'error'); }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
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

// ── Scroll to top ─────────────────────────────────────────────────────────────
function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

// ── Emoji picker ──────────────────────────────────────────────────────────────
const _EMOJIS = [
    '😀','😂','😍','🥰','😎','🤔','😅','🤣','😊','😁',
    '😭','😢','😤','😱','🤯','🥳','🎉','😴','🥱','😈',
    '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🔥','✨',
    '💫','⭐','💯','👍','👎','👏','🙌','🤝','✌️','🙏',
    '💪','🫂','🤷','🤦','👀','💀','🚀','💡','🔒','🌍',
    '🍕','🍔','🎮','🎵','🎶','📱','💻','🐾','🌈','⚡',
];

function _getOrCreateBlogEmojiPanel() {
    let panel = document.getElementById('emoji-panel-blog');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id        = 'emoji-panel-blog';
    panel.className = 'emoji-panel';
    panel.style.display = 'none';
    panel.innerHTML = _EMOJIS.map(e =>
        `<button type="button" onclick="insertEmojiBlog('${e}')">${e}</button>`
    ).join('');
    document.body.appendChild(panel);
    return panel;
}

function toggleBlogEmoji(btn) {
    const panel = _getOrCreateBlogEmojiPanel();
    const isOpen = panel.style.display !== 'none';
    if (isOpen) { panel.style.display = 'none'; return; }

    const rect = btn.getBoundingClientRect();
    panel.style.display = 'grid';
    // Position above the button, aligned to its left
    panel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    panel.style.left   = `${Math.min(rect.left, window.innerWidth - 280)}px`;

    setTimeout(() => {
        document.addEventListener('click', function _close(e) {
            if (!panel.contains(e.target) && e.target !== btn) {
                panel.style.display = 'none';
                document.removeEventListener('click', _close);
            }
        });
    }, 0);
}

function insertEmojiBlog(emoji) {
    const ta = document.getElementById('post-content');
    if (ta) {
        const s = ta.selectionStart ?? ta.value.length;
        const e = ta.selectionEnd   ?? s;
        ta.value = ta.value.slice(0, s) + emoji + ta.value.slice(e);
        ta.selectionStart = ta.selectionEnd = s + [...emoji].length;
        ta.focus();
        ta.dispatchEvent(new Event('input'));
    }
    const panel = document.getElementById('emoji-panel-blog');
    if (panel) panel.style.display = 'none';
}