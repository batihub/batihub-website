// blog.js — Blog feed page logic

const API = 'https://beelog-poes.onrender.com';

let _nextCursor  = null;
let _loading     = false;
let _activeSlug  = '';   // active category filter slug

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
}

function showToast(msg, type = '') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function avatarLetter(user) {
  return ((user?.display_name || user?.username || '?')[0]).toUpperCase();
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderFeaturedPost(post) {
  const el = document.getElementById('featured-container');
  if (!el || !post) return;

  const bg = post.cover_image_url
    ? `<img src="${escapeHtml(post.cover_image_url)}" alt="${escapeHtml(post.title)}" loading="lazy">`
    : `<div style="width:100%;height:100%;background:linear-gradient(135deg,var(--accent-light),var(--surface-2))"></div>`;

  const catBadge = post.category
    ? `<span class="featured-badge"><i class="fa-solid fa-bookmark"></i> ${escapeHtml(post.category.name)}</span>`
    : `<span class="featured-badge"><i class="fa-solid fa-star"></i> Featured</span>`;

  el.innerHTML = `
    <div class="featured-post" onclick="location.href='post.html?slug=${encodeURIComponent(post.slug)}'">
      <div class="featured-post__bg">${bg}</div>
      <div class="featured-post__overlay"></div>
      <div class="featured-post__content">
        ${catBadge}
        <div class="featured-post__title">${escapeHtml(post.title)}</div>
        <div class="featured-post__meta">
          <span>${escapeHtml(post.author?.display_name || post.author?.username || '')}</span>
          <span>${fmtDate(post.published_at || post.created_at)}</span>
          <span><i class="fa-regular fa-clock"></i> ${post.read_time} min read</span>
          <span><i class="fa-regular fa-heart"></i> ${post.like_count}</span>
        </div>
      </div>
    </div>`;
}

function renderPostCard(post) {
  const img = post.cover_image_url
    ? `<img class="post-card__img" src="${escapeHtml(post.cover_image_url)}" alt="${escapeHtml(post.title)}" loading="lazy">`
    : `<div class="post-card__img-placeholder"><i class="fa-regular fa-image"></i></div>`;

  const cat = post.category
    ? `<span class="cat-badge">${escapeHtml(post.category.name)}</span>`
    : '';

  const tags = post.tags?.length
    ? `<div class="tag-chips">${post.tags.slice(0,4).map(t =>
        `<span class="tag-chip" onclick="filterByTag(event,'${escapeHtml(t.slug)}')">#${escapeHtml(t.name)}</span>`
      ).join('')}</div>`
    : '';

  return `
    <article class="post-card" onclick="location.href='post.html?slug=${encodeURIComponent(post.slug)}'">
      ${img}
      <div class="post-card__body">
        <div class="post-card__meta">
          ${cat}
          <span class="read-time"><i class="fa-regular fa-clock"></i> ${post.read_time} min</span>
        </div>
        <h2 class="post-card__title">${escapeHtml(post.title)}</h2>
        ${post.subtitle ? `<p class="post-card__subtitle">${escapeHtml(post.subtitle)}</p>` : ''}
        <div class="post-card__footer">
          <a class="author-chip" href="profile.html?user=${encodeURIComponent(post.author?.username||'')}"
             onclick="event.stopPropagation()">
            <span class="a-avatar">${avatarLetter(post.author)}</span>
            ${escapeHtml(post.author?.display_name || post.author?.username || '')}
          </a>
          <span style="font-size:.78rem;color:var(--text-3)">${fmtDate(post.published_at || post.created_at)}</span>
          <span class="post-stats">
            <span><i class="fa-regular fa-eye"></i> ${post.view_count}</span>
            <span><i class="fa-regular fa-heart"></i> ${post.like_count}</span>
            <span><i class="fa-regular fa-comment"></i> ${post.comment_count}</span>
          </span>
        </div>
        ${tags}
      </div>
    </article>`;
}

// ── Fetch & render feed ───────────────────────────────────────────────────────

async function fetchFeed(replace = false) {
  if (_loading) return;
  _loading = true;

  const feed = document.getElementById('feed');
  if (replace) {
    feed.innerHTML = '<div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div>';
    _nextCursor = null;
  }

  const params = new URLSearchParams({ limit: '15' });
  if (_nextCursor)  params.set('before_id', _nextCursor);
  if (_activeSlug)  params.set('category', _activeSlug);

  try {
    const res  = await fetch(`${API}/posts?${params}`);
    const data = await res.json();

    if (replace) feed.innerHTML = '';

    if (!data.posts?.length && replace) {
      feed.innerHTML = `
        <div class="feed-empty">
          <i class="fa-regular fa-file-lines"></i>
          <h3>No posts yet</h3>
          <p>Check back soon!</p>
        </div>`;
      return;
    }

    for (const post of data.posts) {
      feed.insertAdjacentHTML('beforeend', renderPostCard(post));
    }

    _nextCursor = data.next_cursor || null;
    const loadBtn = document.getElementById('load-more-btn');
    if (loadBtn) loadBtn.style.display = _nextCursor ? 'block' : 'none';

  } catch (e) {
    if (replace) feed.innerHTML = `
      <div class="feed-empty">
        <i class="fa-solid fa-circle-exclamation"></i>
        <h3>Could not load posts</h3>
        <p>Check your connection and try again.</p>
      </div>`;
  } finally {
    _loading = false;
  }
}

async function fetchFeatured() {
  try {
    const res  = await fetch(`${API}/posts?featured=true&limit=1`);
    const data = await res.json();
    if (data.posts?.length) renderFeaturedPost(data.posts[0]);
  } catch {}
}

async function fetchCategories() {
  try {
    const res   = await fetch(`${API}/posts/categories`);
    const cats  = await res.json();
    const bar   = document.getElementById('filter-bar');
    const list  = document.getElementById('sidebar-cats');

    cats.forEach(c => {
      const pill = document.createElement('button');
      pill.className = 'filter-pill';
      pill.dataset.slug = c.slug;
      pill.textContent = c.name;
      pill.addEventListener('click', () => filterByCategory(c.slug, pill));
      bar.appendChild(pill);
    });

    list.innerHTML = cats.map(c =>
      `<li><a href="#" onclick="event.preventDefault();filterByCategory('${escapeHtml(c.slug)}',null)">
        ${escapeHtml(c.name)}
        <span>${c.post_count}</span>
      </a></li>`
    ).join('') || '<li style="font-size:.85rem;color:var(--text-3);padding:4px 10px">No categories yet</li>';

  } catch {}
}

function filterByCategory(slug, pillEl) {
  _activeSlug = slug;
  document.querySelectorAll('.filter-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.slug === slug);
  });
  fetchFeed(true);
}

function filterByTag(e, slug) {
  e.stopPropagation();
  // Tags use the ?tag= param — for now navigate to a filtered URL
  const url = new URL(location.href);
  url.searchParams.set('tag', slug);
  location.href = url.toString();
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('year').textContent = new Date().getFullYear();

  // Check URL params for pre-applied filters
  const params = new URLSearchParams(location.search);
  if (params.get('category')) _activeSlug = params.get('category');
  if (params.get('tag')) {
    // tag filter handled server-side
  }

  fetchFeatured();
  fetchCategories();
  fetchFeed(true);

  // Infinite scroll
  const sentinel = document.getElementById('feed-sentinel');
  if (sentinel && 'IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && _nextCursor) fetchFeed();
    }, { rootMargin: '400px' }).observe(sentinel);
  }

  document.getElementById('load-more-btn')?.addEventListener('click', () => fetchFeed());

  // "All" filter pill
  document.querySelector('.filter-pill[data-slug=""]')?.addEventListener('click', function() {
    filterByCategory('', this);
  });

  // Scroll to top button
  window.addEventListener('scroll', () => {
    document.getElementById('scroll-top-btn')?.classList.toggle('visible', window.scrollY > 400);
  });

  // Show/hide create-post FAB based on auth role (auth.js dispatches this after init)
  document.addEventListener('auth:navRendered', () => {
    const fab  = document.getElementById('create-post-fab');
    if (!fab) return;
    const user = typeof currentUser !== 'undefined' ? currentUser : null;
    if (user && ['author', 'admin', 'root'].includes(user.role)) {
      fab.style.display = 'flex';
    }
  });

  // auth.js handles initTheme / renderNavUser / _initMobileNav
});
