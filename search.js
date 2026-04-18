// search.js — BeeLog Search Page

const API = 'https://beelog-poes.onrender.com';

let _searchTimer = null;
let _activeType  = 'all';

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

// ── Render helpers ────────────────────────────────────────────────────────────

function renderPostResult(post) {
  const cat = post.category ? `<span class="cat-badge">${escapeHtml(post.category.name)}</span>` : '';
  const imgHtml = post.cover_image_url
    ? `<div class="spc-img"><img src="${escapeHtml(post.cover_image_url)}" alt="" loading="lazy"></div>`
    : '';
  const authorAvatar = post.author?.avatar_url
    ? `<img src="${escapeHtml(post.author.avatar_url)}" alt="">`
    : avatarLetter(post.author);

  return `
    <article class="search-post-card" onclick="location.href='post.html?slug=${encodeURIComponent(post.slug)}'">
      ${imgHtml}
      <div class="spc-body">
        <div class="spc-meta">
          ${cat}
          <span class="read-time"><i class="fa-regular fa-clock"></i> ${post.read_time} min</span>
        </div>
        <h3 class="spc-title">${escapeHtml(post.title)}</h3>
        ${post.subtitle ? `<p class="spc-subtitle">${escapeHtml(post.subtitle)}</p>` : ''}
        <div class="spc-footer">
          <span class="spc-author">
            <span class="a-avatar">${authorAvatar}</span>
            ${escapeHtml(post.author?.display_name || post.author?.username || '')}
          </span>
          <span>${fmtDate(post.published_at || post.created_at)}</span>
          <span class="post-stats">
            <span><i class="fa-regular fa-eye"></i> ${post.view_count}</span>
            <span><i class="fa-regular fa-heart"></i> ${post.like_count}</span>
          </span>
        </div>
      </div>
    </article>`;
}

function renderUserResult(user) {
  const avatarInner = user.avatar_url
    ? `<img src="${escapeHtml(user.avatar_url)}" alt="${escapeHtml(user.username)}">`
    : avatarLetter(user);

  return `
    <div class="search-user-card" onclick="location.href='profile.html?user=${encodeURIComponent(user.username)}'">
      <div class="suc-avatar">${avatarInner}</div>
      <div class="suc-info">
        <div class="suc-name">
          ${escapeHtml(user.display_name || user.username)}
          ${user.is_verified ? '<i class="fa-solid fa-circle-check" style="color:var(--accent);font-size:.8rem" title="Verified"></i>' : ''}
        </div>
        <div class="suc-handle">@${escapeHtml(user.username)} &bull; ${user.post_count} post${user.post_count !== 1 ? 's' : ''}</div>
        ${user.bio ? `<p class="suc-bio">${escapeHtml(user.bio)}</p>` : ''}
      </div>
    </div>`;
}

// ── Search logic ──────────────────────────────────────────────────────────────

async function doSearch(q, type) {
  if (!q.trim()) { clearResults(); return; }

  const status  = document.getElementById('search-status');
  const results = document.getElementById('search-results');
  status.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Searching…';
  results.innerHTML = '';

  try {
    const params = new URLSearchParams({ q: q.trim(), type, limit: '20' });
    const res    = await fetch(`${API}/posts/search?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const hasPosts = data.posts?.length > 0;
    const hasUsers = data.users?.length > 0;

    if (!hasPosts && !hasUsers) {
      status.innerHTML = '';
      results.innerHTML = `
        <div class="feed-empty">
          <i class="fa-solid fa-magnifying-glass" style="opacity:.35"></i>
          <h3>No results for &ldquo;${escapeHtml(q)}&rdquo;</h3>
          <p>Try different keywords, or browse by category on the blog.</p>
          <a href="blog.html" class="btn btn-secondary btn-sm" style="margin-top:14px">Browse Posts</a>
        </div>`;
      return;
    }

    const total = (data.posts?.length || 0) + (data.users?.length || 0);
    status.innerHTML = `<strong>${total}</strong> result${total !== 1 ? 's' : ''} for &ldquo;${escapeHtml(q)}&rdquo;`;

    let html = '';

    if (hasUsers && (type === 'all' || type === 'users')) {
      html += `
        <div class="search-section">
          <h4 class="search-section-title"><i class="fa-solid fa-users"></i> Authors</h4>
          <div class="search-users-grid">${data.users.map(renderUserResult).join('')}</div>
        </div>`;
    }

    if (hasPosts && (type === 'all' || type === 'posts')) {
      html += `
        <div class="search-section">
          <h4 class="search-section-title"><i class="fa-solid fa-file-lines"></i> Posts</h4>
          <div class="search-posts-list">${data.posts.map(renderPostResult).join('')}</div>
        </div>`;
    }

    results.innerHTML = html;

  } catch (e) {
    status.innerHTML = '';
    results.innerHTML = `
      <div class="feed-empty">
        <i class="fa-solid fa-circle-exclamation"></i>
        <h3>Search failed</h3>
        <p>${escapeHtml(e.message)}</p>
      </div>`;
  }
}

function clearResults() {
  document.getElementById('search-status').innerHTML  = '';
  document.getElementById('search-results').innerHTML = '';
}

function clearSearch() {
  const input = document.getElementById('search-input');
  input.value = '';
  document.getElementById('search-clear').style.display = 'none';
  clearResults();
  input.focus();
  history.replaceState({}, '', location.pathname);
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('year').textContent = new Date().getFullYear();

  window.addEventListener('scroll', () => {
    document.querySelector('.top-nav')?.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });

  const input    = document.getElementById('search-input');
  const clearBtn = document.getElementById('search-clear');

  // Pre-fill from URL params
  const urlParams = new URLSearchParams(location.search);
  const initQ    = urlParams.get('q')    || '';
  const initType = urlParams.get('type') || 'all';

  if (initQ) {
    input.value = initQ;
    clearBtn.style.display = '';
    _activeType = initType;
    document.querySelectorAll('.search-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.type === initType)
    );
    doSearch(initQ, initType);
  }

  // Live search with debounce
  input.addEventListener('input', () => {
    const val = input.value;
    clearBtn.style.display = val ? '' : 'none';
    clearTimeout(_searchTimer);
    if (!val.trim()) { clearResults(); return; }
    _searchTimer = setTimeout(() => {
      doSearch(val, _activeType);
      const url = new URL(location.href);
      url.searchParams.set('q', val);
      url.searchParams.set('type', _activeType);
      history.replaceState({}, '', url);
    }, 320);
  });

  // Type filter tabs
  document.querySelectorAll('.search-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.search-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      _activeType = tab.dataset.type;
      const val = input.value.trim();
      if (val) doSearch(val, _activeType);
    });
  });
});
