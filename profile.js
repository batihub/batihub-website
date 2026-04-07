// profile.js — BeeLog Author Profile Page

const API = 'https://beelog-poes.onrender.com';

let _profileUsername = null;
let _isOwnProfile    = false;

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

// ── Render profile hero ────────────────────────────────────────────────────────

function renderHero(user) {
  const avatarInner = user.avatar_url
    ? `<img src="${escapeHtml(user.avatar_url)}" alt="avatar">`
    : avatarLetter(user);
  const uploadOverlay = _isOwnProfile
    ? `<span class="avatar-upload-overlay" onclick="_triggerAvatarUpload()" title="Change photo">
         <i class="fa-solid fa-camera"></i>
         <span>Change</span>
       </span>`
    : '';
  const avatar = `
    <div class="profile-hero__avatar-wrap">
      <div class="profile-hero__avatar">${avatarInner}</div>
      ${uploadOverlay}
    </div>`;

  const verified = user.is_verified
    ? `<span title="Verified" style="color:var(--accent)"><i class="fa-solid fa-circle-check"></i></span>`
    : '';

  const links = [];
  if (user.website_url) links.push(`<a href="${escapeHtml(user.website_url)}" target="_blank" rel="noopener" title="Website"><i class="fa-solid fa-globe"></i></a>`);
  if (user.twitter_handle) {
    const handle = user.twitter_handle.replace(/^@/, '');
    links.push(`<a href="https://x.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener" title="Twitter/X"><i class="fa-brands fa-x-twitter"></i></a>`);
  }

  const heroEl = document.getElementById('profile-hero');
  heroEl.innerHTML = `
    <div class="profile-hero__content">
      ${avatar}
      <h1 class="profile-hero__name">${escapeHtml(user.display_name || user.username)}</h1>
      <div class="profile-hero__handle">
        <span>@${escapeHtml(user.username)}</span>
        ${verified}
        <span class="cat-badge" style="font-size:.7rem">${user.role}</span>
      </div>
      ${user.bio ? `<p class="profile-hero__bio">${escapeHtml(user.bio)}</p>` : ''}
      <div class="profile-hero__stats">
        <div class="stat"><span class="val">${user.post_count||0}</span><span class="lbl">Posts</span></div>
      </div>
      ${links.length ? `<div class="profile-hero__links">${links.join('')}</div>` : ''}
    </div>`;
}

// ── Render profile info card ───────────────────────────────────────────────────

function renderInfoCard(user) {
  const card = document.getElementById('profile-info-card');
  const rows = [];
  if (user.bio) rows.push(`<div class="profile-info-item"><i class="fa-solid fa-align-left"></i><span>${escapeHtml(user.bio)}</span></div>`);
  rows.push(`<div class="profile-info-item"><i class="fa-regular fa-calendar"></i><span>Joined ${fmtDate(user.created_at)}</span></div>`);
  if (user.website_url) rows.push(`<div class="profile-info-item"><i class="fa-solid fa-globe"></i><a href="${escapeHtml(user.website_url)}" target="_blank" rel="noopener">${escapeHtml(user.website_url.replace(/^https?:\/\//, ''))}</a></div>`);
  if (user.twitter_handle) rows.push(`<div class="profile-info-item"><i class="fa-brands fa-x-twitter"></i><a href="https://x.com/${encodeURIComponent(user.twitter_handle.replace(/^@/,''))}" target="_blank" rel="noopener">@${escapeHtml(user.twitter_handle.replace(/^@/,''))}</a></div>`);

  card.innerHTML = rows.join('') || '<div style="color:var(--text-3);font-size:.875rem">No info provided.</div>';
}

// ── Render post card for feed ─────────────────────────────────────────────────

function renderProfilePostCard(post) {
  const img = post.cover_image_url
    ? `<img class="post-card__img" src="${escapeHtml(post.cover_image_url)}" alt="${escapeHtml(post.title)}" loading="lazy">`
    : `<div class="post-card__img-placeholder"><i class="fa-regular fa-image"></i></div>`;

  const cat = post.category
    ? `<span class="cat-badge">${escapeHtml(post.category.name)}</span>`
    : '';

  const draftBadge = post.status === 'draft'
    ? '<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:20px;font-size:.72rem;font-weight:700">DRAFT</span>'
    : '';

  return `
    <article class="post-card" onclick="location.href='post.html?slug=${encodeURIComponent(post.slug)}'">
      ${img}
      <div class="post-card__body">
        <div class="post-card__meta">
          ${cat} ${draftBadge}
          <span class="read-time"><i class="fa-regular fa-clock"></i> ${post.read_time} min</span>
        </div>
        <h2 class="post-card__title">${escapeHtml(post.title)}</h2>
        ${post.subtitle ? `<p class="post-card__subtitle">${escapeHtml(post.subtitle)}</p>` : ''}
        <div class="post-card__footer">
          <span style="font-size:.78rem;color:var(--text-3)">${fmtDate(post.published_at || post.created_at)}</span>
          <span class="post-stats">
            <span><i class="fa-regular fa-eye"></i> ${post.view_count}</span>
            <span><i class="fa-regular fa-heart"></i> ${post.like_count}</span>
          </span>
        </div>
      </div>
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

    renderHero(user);
    renderInfoCard(user);

    // Show edit controls if own profile
    _isOwnProfile = typeof currentUser !== 'undefined' && currentUser &&
      (currentUser.username === username || currentUser.role === 'admin' || currentUser.role === 'root');

    if (_isOwnProfile) {
      document.getElementById('own-profile-actions').style.display = 'block';
      prefillEditForm(user);
    }

  } catch (e) {
    document.getElementById('profile-hero').innerHTML = `
      <div class="feed-empty">
        <i class="fa-solid fa-user-slash"></i>
        <h3>User not found</h3>
        <a href="blog.html" class="btn btn-primary" style="margin-top:16px">Back to Blog</a>
      </div>`;
  }
}

async function loadProfilePosts(username) {
  const feed  = document.getElementById('profile-feed');
  const empty = document.getElementById('profile-empty');

  try {
    const headers = {};
    if (typeof authToken !== 'undefined' && authToken) headers['Authorization'] = `Bearer ${authToken}`;

    let posts;
    if (_isOwnProfile) {
      // Show drafts too on own profile
      const res = await fetch(`${API}/posts/me/posts`, { headers });
      posts = await res.json();
    } else {
      const res = await fetch(`${API}/posts?author=${encodeURIComponent(username)}&limit=50`);
      const data = await res.json();
      posts = data.posts || [];
    }

    feed.innerHTML = '';
    if (!posts.length) {
      feed.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    posts.forEach(p => feed.insertAdjacentHTML('beforeend', renderProfilePostCard(p)));

  } catch {
    feed.innerHTML = '<div class="feed-empty"><h3>Could not load posts.</h3></div>';
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

    // Update localStorage
    if (typeof currentUser !== 'undefined' && currentUser) {
      currentUser.display_name = user.display_name;
      localStorage.setItem('baerhub-user', JSON.stringify(currentUser));
    }

    toggleEditProfile();
    renderHero(user);
    renderInfoCard(user);
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
    if (overlay) { overlay.classList.add('uploading'); overlay.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }

    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = typeof authToken !== 'undefined' ? authToken : null;
      const res = await fetch(`${API}/admin/media/upload`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) throw new Error('Upload failed');
      const { url } = await res.json();

      // Save the new avatar URL to profile
      const patchRes = await fetch(`${API}/auth/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ avatar_url: url }),
      });
      if (!patchRes.ok) throw new Error('Profile update failed');
      const user = await patchRes.json();

      // Update localStorage
      if (typeof currentUser !== 'undefined' && currentUser) {
        currentUser.avatar_url = url;
        localStorage.setItem('baerhub-user', JSON.stringify(currentUser));
      }

      renderHero(user);
      renderInfoCard(user);
      if (typeof renderNavUser === 'function') renderNavUser();
      showToast('Profile picture updated!', 'success');
    } catch (e) {
      showToast('Upload failed: ' + e.message, 'error');
      if (overlay) { overlay.classList.remove('uploading'); overlay.innerHTML = '<i class="fa-solid fa-camera"></i><span>Change</span>'; }
    }
  };
};

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('year').textContent = new Date().getFullYear();

  // auth.js handles initTheme / renderNavUser / _initMobileNav

  // Determine whose profile to show
  const params = new URLSearchParams(location.search);
  _profileUsername = params.get('user') || (typeof currentUser !== 'undefined' && currentUser?.username) || '';

  if (!_profileUsername) {
    document.getElementById('profile-hero').innerHTML = `
      <div class="feed-empty">
        <i class="fa-solid fa-user"></i>
        <h3>No user specified</h3>
        <a href="blog.html" class="btn btn-primary" style="margin-top:16px">Go to Blog</a>
      </div>`;
    return;
  }

  // After auth state is ready
  document.addEventListener('auth:navRendered', () => {
    _isOwnProfile = typeof currentUser !== 'undefined' && currentUser &&
      (currentUser.username === _profileUsername || currentUser.role === 'admin' || currentUser.role === 'root');

    loadProfile(_profileUsername);
    loadProfilePosts(_profileUsername);
  });

  // Scroll to top
  window.addEventListener('scroll', () => {
    document.getElementById('scroll-top-btn')?.classList.toggle('visible', window.scrollY > 400);
  });
});
