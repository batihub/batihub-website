// profile.js — BeeLog Author Profile Page

const API = 'https://beelog-poes.onrender.com';

let _profileUsername  = null;
let _isOwnProfile     = false;
let _profileNextCursor = null;
let _profileLoading   = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function avatarLetter(u) {
  return ((u?.display_name || u?.username || '?')[0]).toUpperCase();
}

function showToast(msg, type = '') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ── Render profile identity card (left sidebar) ───────────────────────────────

function renderProfileSidebar(user) {
  const card = document.getElementById('profile-identity-card');
  if (!card) return;

  const avatarInner = user.avatar_url
    ? `<img src="${escapeHtml(user.avatar_url)}" alt="avatar">`
    : avatarLetter(user);

  const uploadOverlay = _isOwnProfile
    ? `<span class="avatar-upload-overlay" onclick="_triggerAvatarUpload()" title="Change photo">
         <i class="fa-solid fa-camera"></i>
         <span>Change</span>
       </span>`
    : '';

  const verified = user.is_verified
    ? `<span title="Verified" style="color:var(--accent)"><i class="fa-solid fa-circle-check"></i></span>`
    : '';

  const roleLabel = { root: '★ Root', admin: 'Admin', author: 'Author' }[user.role] || user.role;

  const infoItems = [];
  infoItems.push(`<div class="pid-info-item"><i class="fa-regular fa-calendar"></i><span>Joined ${fmtDate(user.created_at)}</span></div>`);
  if (user.website_url) {
    infoItems.push(`<div class="pid-info-item"><i class="fa-solid fa-globe"></i><a href="${escapeHtml(user.website_url)}" target="_blank" rel="noopener">${escapeHtml(user.website_url.replace(/^https?:\/\//, ''))}</a></div>`);
  }
  if (user.twitter_handle) {
    const handle = user.twitter_handle.replace(/^@/, '');
    infoItems.push(`<div class="pid-info-item"><i class="fa-brands fa-x-twitter"></i><a href="https://x.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener">@${escapeHtml(handle)}</a></div>`);
  }

  card.innerHTML = `
    <div class="pid-avatar-wrap">
      <div class="pid-avatar">${avatarInner}</div>
      ${uploadOverlay}
    </div>
    <div class="pid-name">${escapeHtml(user.display_name || user.username)}</div>
    <div class="pid-meta">
      <span class="pid-handle">@${escapeHtml(user.username)}</span>
      ${verified}
      <span class="cat-badge" style="font-size:.62rem;padding:2px 7px">${roleLabel}</span>
    </div>
    ${user.bio ? `<p class="pid-bio">${escapeHtml(user.bio)}</p>` : ''}
    <div class="pid-stats">
      <div class="pid-stat">
        <span class="pid-stat-val">${user.post_count || 0}</span>
        <span class="pid-stat-lbl">Posts</span>
      </div>
    </div>
    ${infoItems.length ? `<div class="pid-info">${infoItems.join('')}</div>` : ''}
  `;
}

// ── Render post card (no cover image) ─────────────────────────────────────────

function renderProfilePostCard(post) {
  const cat = post.category
    ? `<span class="cat-badge">${escapeHtml(post.category.name)}</span>`
    : '';

  const draftBadge = post.status === 'draft'
    ? '<span class="draft-label">DRAFT</span>'
    : '';

  const tags = post.tags?.length
    ? `<div class="ppi-tags">${post.tags.slice(0, 4).map(t =>
        `<span class="tag-chip">#${escapeHtml(t.name)}</span>`
      ).join('')}</div>`
    : '';

  return `
    <article class="profile-post-item" onclick="location.href='post.html?slug=${encodeURIComponent(post.slug)}'">
      <div class="ppi-top">
        <div class="ppi-badges">${cat} ${draftBadge}</div>
        <span class="ppi-date">${fmtDate(post.published_at || post.created_at)}</span>
      </div>
      <h3 class="ppi-title">${escapeHtml(post.title)}</h3>
      ${post.subtitle ? `<p class="ppi-subtitle">${escapeHtml(post.subtitle)}</p>` : ''}
      <div class="ppi-footer">
        <span class="read-time"><i class="fa-regular fa-clock"></i> ${post.read_time} min</span>
        <span class="ppi-stats">
          <span><i class="fa-regular fa-eye"></i> ${post.view_count}</span>
          <span><i class="fa-regular fa-heart"></i> ${post.like_count}</span>
        </span>
      </div>
      ${tags}
    </article>`;
}

// ── Load profile data ─────────────────────────────────────────────────────────

async function loadProfile(username) {
  try {
    const res  = await fetch(`${API}/users/${encodeURIComponent(username)}`);
    if (!res.ok) throw new Error('User not found');
    const user = await res.json();

    document.title = `${user.display_name || user.username} — BeeLog`;
    document.querySelector('[rel=canonical]').href = location.href;
    document.querySelector('[property="og:title"]').content = user.display_name || user.username;
    document.querySelector('[property="og:description"]').content = user.bio || '';
    document.querySelector('[property="og:image"]').content = user.avatar_url || '';

    renderProfileSidebar(user);

    if (_isOwnProfile) {
      document.getElementById('own-profile-actions').style.display = 'block';
      prefillEditForm(user);
    }

  } catch (e) {
    document.getElementById('profile-identity-card').innerHTML = `
      <div class="feed-empty">
        <i class="fa-solid fa-user-slash"></i>
        <h3>User not found</h3>
        <a href="blog.html" class="btn btn-primary" style="margin-top:16px">Back to Blog</a>
      </div>`;
  }
}

// ── Load profile posts (with infinite scroll for other users) ─────────────────

async function loadProfilePosts(username, replace = true) {
  if (_profileLoading) return;
  _profileLoading = true;

  const feed  = document.getElementById('profile-feed');
  const empty = document.getElementById('profile-empty');

  if (replace) {
    feed.innerHTML = '<div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div>';
    _profileNextCursor = null;
  }

  try {
    const headers = {};
    if (typeof authToken !== 'undefined' && authToken) headers['Authorization'] = `Bearer ${authToken}`;

    let posts;

    if (_isOwnProfile) {
      // Own profile: load all posts (including drafts) — no pagination
      const res = await fetch(`${API}/posts/me/posts`, { headers });
      posts = await res.json();
      if (replace) feed.innerHTML = '';
      if (!posts.length) {
        feed.style.display = 'none';
        empty.style.display = 'block';
      } else {
        posts.forEach(p => feed.insertAdjacentHTML('beforeend', renderProfilePostCard(p)));
      }
    } else {
      // Other users: paginated
      const params = new URLSearchParams({ author: username, limit: '20' });
      if (_profileNextCursor) params.set('before_id', _profileNextCursor);
      const res  = await fetch(`${API}/posts?${params}`);
      const data = await res.json();
      posts = data.posts || [];

      if (replace) feed.innerHTML = '';

      if (!posts.length && replace) {
        feed.style.display = 'none';
        empty.style.display = 'block';
      } else {
        posts.forEach(p => feed.insertAdjacentHTML('beforeend', renderProfilePostCard(p)));
        _profileNextCursor = data.next_cursor || null;
      }
    }

  } catch {
    if (replace) feed.innerHTML = '<div class="feed-empty"><h3>Could not load posts.</h3></div>';
  } finally {
    _profileLoading = false;
  }
}

// ── Edit profile ──────────────────────────────────────────────────────────────

function prefillEditForm(user) {
  document.getElementById('ep-displayname').value = user.display_name || '';
  document.getElementById('ep-bio').value         = user.bio || '';
  document.getElementById('ep-avatar').value      = user.avatar_url || '';
  document.getElementById('ep-website').value     = user.website_url || '';
  document.getElementById('ep-twitter').value     = user.twitter_handle || '';
}

function toggleEditProfile() {
  const form = document.getElementById('edit-profile-form');
  const btn  = document.querySelector('#own-profile-actions button');
  const show = form.style.display === 'none';
  form.style.display = show ? 'block' : 'none';
  if (btn) btn.innerHTML = show
    ? '<i class="fa-solid fa-xmark"></i> Cancel Edit'
    : '<i class="fa-solid fa-pen"></i> Edit Profile';
}

async function saveProfile() {
  const body = {
    display_name:   document.getElementById('ep-displayname').value.trim() || null,
    bio:            document.getElementById('ep-bio').value.trim() || null,
    avatar_url:     document.getElementById('ep-avatar').value.trim() || null,
    website_url:    document.getElementById('ep-website').value.trim() || null,
    twitter_handle: document.getElementById('ep-twitter').value.trim() || null,
  };

  try {
    const res = await fetch(`${API}/auth/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Save failed');
    const user = await res.json();

    if (typeof currentUser !== 'undefined' && currentUser) {
      currentUser.display_name = user.display_name;
      currentUser.avatar_url   = user.avatar_url;
      localStorage.setItem('baerhub-user', JSON.stringify(currentUser));
    }

    toggleEditProfile();
    renderProfileSidebar(user);
    if (typeof renderNavUser === 'function') renderNavUser();
    showToast('Profile updated!', 'success');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

// ── Avatar upload ─────────────────────────────────────────────────────────────

window._triggerAvatarUpload = function() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.click();
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;

    const overlay = document.querySelector('.avatar-upload-overlay');
    if (overlay) {
      overlay.classList.add('uploading');
      overlay.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    try {
      const fd  = new FormData();
      fd.append('file', file);
      const token = typeof authToken !== 'undefined' ? authToken : null;

      const res = await fetch(`${API}/admin/media/upload`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) throw new Error('Upload failed');
      const { url } = await res.json();

      const patchRes = await fetch(`${API}/auth/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ avatar_url: url }),
      });
      if (!patchRes.ok) throw new Error('Profile update failed');
      const user = await patchRes.json();

      if (typeof currentUser !== 'undefined' && currentUser) {
        currentUser.avatar_url = url;
        localStorage.setItem('baerhub-user', JSON.stringify(currentUser));
      }

      // Update avatar input in edit form
      const ep = document.getElementById('ep-avatar');
      if (ep) ep.value = url;

      renderProfileSidebar(user);
      if (typeof renderNavUser === 'function') renderNavUser();
      showToast('Profile picture updated!', 'success');
    } catch (e) {
      showToast('Upload failed: ' + e.message, 'error');
      if (overlay) {
        overlay.classList.remove('uploading');
        overlay.innerHTML = '<i class="fa-solid fa-camera"></i><span>Change</span>';
      }
    }
  };
};

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('year').textContent = new Date().getFullYear();

  const params = new URLSearchParams(location.search);
  _profileUsername = params.get('user') || (typeof currentUser !== 'undefined' && currentUser?.username) || '';

  if (!_profileUsername) {
    document.getElementById('profile-identity-card').innerHTML = `
      <div class="feed-empty">
        <i class="fa-solid fa-user"></i>
        <h3>No user specified</h3>
        <a href="blog.html" class="btn btn-primary" style="margin-top:16px">Go to Blog</a>
      </div>`;
    return;
  }

  document.addEventListener('auth:navRendered', () => {
    _isOwnProfile = typeof currentUser !== 'undefined' && currentUser &&
      (currentUser.username === _profileUsername || currentUser.role === 'admin' || currentUser.role === 'root');

    loadProfile(_profileUsername);
    loadProfilePosts(_profileUsername, true);

    // Infinite scroll (other users only — own profile loads all at once)
    const sentinel = document.getElementById('profile-feed-sentinel');
    if (sentinel && 'IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && _profileNextCursor && !_isOwnProfile) {
          loadProfilePosts(_profileUsername, false);
        }
      }, { rootMargin: '300px' }).observe(sentinel);
    }
  });

  window.addEventListener('scroll', () => {
    document.querySelector('.top-nav')?.classList.toggle('scrolled', window.scrollY > 10);
    document.getElementById('scroll-top-btn')?.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
});
