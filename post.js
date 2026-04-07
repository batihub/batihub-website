// post.js — Single post page logic

const API = 'https://beelog-poes.onrender.com';

let _slug    = '';
let _postId  = null;
let _liked   = false;
let _likeCount = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
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
  setTimeout(() => t.remove(), 3000);
}

// ── Reading progress bar ──────────────────────────────────────────────────────

function initReadingBar() {
  const bar = document.getElementById('reading-bar');
  if (!bar) return;
  window.addEventListener('scroll', () => {
    const total  = document.body.scrollHeight - window.innerHeight;
    const pct    = total > 0 ? (window.scrollY / total) * 100 : 0;
    bar.style.width = Math.min(pct, 100) + '%';
  }, { passive: true });
}

// ── Table of Contents ─────────────────────────────────────────────────────────

function buildTOC() {
  const body    = document.getElementById('art-body');
  const tocWrap = document.getElementById('toc-wrap');
  const toc     = document.getElementById('toc');
  if (!body || !toc) return;

  const headings = body.querySelectorAll('h2, h3');
  if (headings.length < 3) return;

  tocWrap.style.display = 'block';
  headings.forEach((h, i) => {
    if (!h.id) h.id = 'h-' + i;
    const a  = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    a.className   = h.tagName === 'H3' ? 'toc-h3' : '';
    a.addEventListener('click', e => {
      e.preventDefault();
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    toc.appendChild(a);
  });

  // Highlight active section on scroll
  const links   = Array.from(toc.querySelectorAll('a'));
  const hEls    = Array.from(headings);
  window.addEventListener('scroll', () => {
    const pos = window.scrollY + 100;
    let active = hEls[0];
    for (const h of hEls) {
      if (h.offsetTop <= pos) active = h;
    }
    links.forEach(a => a.classList.toggle('active', a.hash === '#' + active?.id));
  }, { passive: true });
}

// ── Render post ───────────────────────────────────────────────────────────────

function renderPost(post) {
  document.title = post.title + ' — BeeLog';
  document.querySelector('[rel=canonical]').href = location.href;
  document.querySelector('[property="og:title"]').content = post.title;
  document.querySelector('[property="og:description"]').content = post.meta_description || post.subtitle || '';
  document.querySelector('[property="og:image"]').content = post.cover_image_url || '';

  // Draft banner
  if (post.status !== 'published') {
    const banner = document.createElement('div');
    banner.className = 'draft-banner';
    banner.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Draft preview — not publicly visible';
    document.body.insertBefore(banner, document.getElementById('reading-bar').nextSibling);
  }

  // Cover
  const cover = document.getElementById('post-cover');
  if (post.cover_image_url) {
    cover.innerHTML = `<img src="${escapeHtml(post.cover_image_url)}" alt="${escapeHtml(post.title)}">`;
  } else {
    cover.style.display = 'none';
  }

  // Meta
  const catBadge = post.category
    ? `<span class="cat-badge">${escapeHtml(post.category.name)}</span>`
    : '';
  document.getElementById('art-meta').innerHTML = `
    ${catBadge}
    <span class="read-time"><i class="fa-regular fa-clock"></i> ${post.read_time} min read</span>
    ${post.featured ? '<span class="featured-badge"><i class="fa-solid fa-star"></i> Featured</span>' : ''}`;

  document.getElementById('art-title').textContent    = post.title;
  document.getElementById('art-subtitle').textContent = post.subtitle || '';
  if (!post.subtitle) document.getElementById('art-subtitle').style.display = 'none';

  const author = post.author || {};
  const avatarHtml = author.avatar_url
    ? `<img src="${escapeHtml(author.avatar_url)}" alt="${escapeHtml(author.display_name||author.username||'')}">`
    : avatarLetter(author);
  document.getElementById('art-byline').innerHTML = `
    <div class="byline-author">
      <span class="byline-avatar">${avatarHtml}</span>
      <div>
        <strong>${escapeHtml(author.display_name || author.username || '')}</strong>
        <div class="byline-meta">
          <span><i class="fa-regular fa-calendar"></i> ${fmtDate(post.published_at || post.created_at)}</span>
          <span><i class="fa-regular fa-eye"></i> ${post.view_count.toLocaleString()} views</span>
          <span><i class="fa-regular fa-heart"></i> ${post.like_count} likes</span>
        </div>
      </div>
    </div>
    ${(typeof currentUser !== 'undefined' && currentUser &&
       (currentUser.id === author.id || currentUser.role === 'admin' || currentUser.role === 'root'))
      ? `<a href="admin.html?edit=${encodeURIComponent(post.slug)}" class="btn btn-secondary btn-sm" style="margin-left:auto">
           <i class="fa-solid fa-pen"></i> Edit
         </a>` : ''}`;

  // Body
  document.getElementById('art-body').innerHTML = post.body_html || '<p>No content.</p>';

  // Tags
  const tagsEl = document.getElementById('art-tags');
  if (post.tags?.length) {
    tagsEl.innerHTML = post.tags.map(t =>
      `<a class="tag-chip" href="blog.html?tag=${encodeURIComponent(t.slug)}">#${escapeHtml(t.name)}</a>`
    ).join('');
  }

  // Like state
  _likeCount = post.like_count;
  _liked     = post.liked_by_me === true;
  updateLikeBtn();

  // View count pill
  const viewEl = document.getElementById('view-count');
  if (viewEl) viewEl.textContent = (post.view_count || 0).toLocaleString();

  // Author card
  const cardAvatarHtml = author.avatar_url
    ? `<img src="${escapeHtml(author.avatar_url)}" alt="${escapeHtml(author.display_name||author.username||'')}">`
    : avatarLetter(author);
  document.getElementById('author-card').innerHTML = `
    <div class="author-card-avatar">${cardAvatarHtml}</div>
    <div class="author-card-info">
      <h4>${escapeHtml(author.display_name || author.username || '')}</h4>
      ${author.bio ? `<p>${escapeHtml(author.bio)}</p>` : ''}
      <a href="profile.html?user=${encodeURIComponent(author.username||'')}" class="btn btn-secondary btn-sm" style="margin-top:12px">
        <i class="fa-solid fa-user"></i> View Profile
      </a>
    </div>`;

  // Show content, hide loading
  document.getElementById('article-loading').style.display = 'none';
  document.getElementById('article-content').style.display = 'block';

  // Post-render: highlight code blocks, build TOC
  if (window.hljs) document.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  buildTOC();
}

// ── Likes ─────────────────────────────────────────────────────────────────────

function updateLikeBtn() {
  const btn = document.getElementById('like-btn');
  const cnt = document.getElementById('like-count');
  if (!btn) return;
  btn.classList.toggle('liked', _liked);
  btn.querySelector('i').className = _liked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
  if (cnt) cnt.textContent = _likeCount;
}

async function toggleLike() {
  if (typeof authToken === 'undefined' || !authToken) {
    if (typeof openLoginModal === 'function') openLoginModal();
    return;
  }
  const method = _liked ? 'DELETE' : 'POST';
  try {
    const res = await fetch(`${API}/posts/${encodeURIComponent(_slug)}/like`, {
      method,
      headers: { 'Authorization': `Bearer ${authToken}` },
    });
    if (res.ok || res.status === 204) {
      _liked = !_liked;
      _likeCount += _liked ? 1 : -1;
      updateLikeBtn();
    }
  } catch {}
}

// ── Comments ──────────────────────────────────────────────────────────────────

async function loadComments() {
  try {
    const res  = await fetch(`${API}/posts/${encodeURIComponent(_slug)}/comments`);
    const data = await res.json();

    const badge = document.getElementById('comment-count-badge');
    if (badge) badge.textContent = data.length;

    const list = document.getElementById('comments-list');
    list.innerHTML = '';
    data.forEach(c => renderComment(c, list));
  } catch {}
}

function renderComment(c, container) {
  const commentAvatarInner = c.author?.avatar_url
    ? `<img src="${escapeHtml(c.author.avatar_url)}" alt="${escapeHtml(c.author.display_name||c.author.username||'')}">`
    : avatarLetter(c.author);
  const div = document.createElement('div');
  div.className = 'comment-item';
  div.innerHTML = `
    <span class="a-avatar" style="width:36px;height:36px;font-size:.85rem;flex-shrink:0">${commentAvatarInner}</span>
    <div class="comment-body-wrap">
      <div class="comment-bubble">
        <span class="comment-author-name">${escapeHtml(c.author?.display_name || c.author?.username || '')}</span>
        <span class="comment-date">${fmtDate(c.created_at)}</span>
        <p class="comment-text">${escapeHtml(c.body)}</p>
      </div>
      <button class="comment-reply-btn" onclick="startReply(${c.id}, '${escapeHtml(c.author?.username||'')}')">
        <i class="fa-solid fa-reply"></i> Reply
      </button>
      ${c.replies?.length ? `<div class="replies" id="replies-${c.id}"></div>` : ''}
    </div>`;
  container.appendChild(div);

  if (c.replies?.length) {
    const replyContainer = div.querySelector(`#replies-${c.id}`);
    c.replies.forEach(r => renderComment(r, replyContainer));
  }
}

let _replyToId = null;

function startReply(id, username) {
  _replyToId = id;
  const input = document.getElementById('comment-input');
  if (input) {
    input.focus();
    input.placeholder = `Replying to @${username}… (press Esc to cancel)`;
  }
}

async function submitComment() {
  if (typeof authToken === 'undefined' || !authToken) {
    if (typeof openLoginModal === 'function') openLoginModal();
    return;
  }
  const input = document.getElementById('comment-input');
  const body  = input?.value.trim();
  if (!body) return;

  try {
    const res = await fetch(`${API}/posts/${encodeURIComponent(_slug)}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ body, parent_id: _replyToId }),
    });
    if (res.ok) {
      input.value = '';
      input.placeholder = 'Write a comment…';
      _replyToId = null;
      loadComments();
      showToast('Comment posted!', 'success');
    }
  } catch {
    showToast('Failed to post comment.', 'error');
  }
}

// ── Adjacent post navigation ──────────────────────────────────────────────────

async function loadAdjacent() {
  try {
    const res  = await fetch(`${API}/posts/${encodeURIComponent(_slug)}/adjacent`);
    if (!res.ok) return;
    const data = await res.json();
    const nav  = document.getElementById('adjacent-nav');
    if (!nav || (!data.prev && !data.next)) return;

    nav.style.display = 'grid';
    nav.innerHTML = '';

    if (data.prev) {
      nav.insertAdjacentHTML('beforeend', `
        <a class="adjacent-link prev" href="post.html?slug=${encodeURIComponent(data.prev.slug)}">
          <span class="adjacent-label"><i class="fa-solid fa-arrow-left"></i> Previous</span>
          <span class="adjacent-title">${escapeHtml(data.prev.title)}</span>
        </a>`);
    } else {
      nav.insertAdjacentHTML('beforeend', `<div></div>`);
    }

    if (data.next) {
      nav.insertAdjacentHTML('beforeend', `
        <a class="adjacent-link next" href="post.html?slug=${encodeURIComponent(data.next.slug)}">
          <span class="adjacent-label">Next <i class="fa-solid fa-arrow-right"></i></span>
          <span class="adjacent-title">${escapeHtml(data.next.title)}</span>
        </a>`);
    }
  } catch {}
}

// ── Related posts ─────────────────────────────────────────────────────────────

async function loadRelated() {
  try {
    const res  = await fetch(`${API}/posts/${encodeURIComponent(_slug)}/related`);
    const data = await res.json();
    if (!data.length) return;

    const section = document.getElementById('related-section');
    const grid    = document.getElementById('related-grid');
    section.style.display = 'block';
    grid.innerHTML = data.map(p => `
      <div class="related-card" onclick="location.href='post.html?slug=${encodeURIComponent(p.slug)}'">
        ${p.cover_image_url
          ? `<img src="${escapeHtml(p.cover_image_url)}" alt="${escapeHtml(p.title)}" loading="lazy">`
          : `<div style="width:100%;aspect-ratio:16/9;background:var(--surface-2)"></div>`}
        <div class="related-card-body">
          <h4>${escapeHtml(p.title)}</h4>
          <p>${escapeHtml(p.author?.display_name || p.author?.username || '')} · ${p.read_time} min</p>
        </div>
      </div>`).join('');
  } catch {}
}

// ── Share ─────────────────────────────────────────────────────────────────────

async function sharePost() {
  try {
    if (navigator.share) {
      await navigator.share({ title: document.title, url: location.href });
    } else {
      await navigator.clipboard.writeText(location.href);
      showToast('Link copied!', 'success');
    }
  } catch {}
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(location.search);
  _slug = params.get('slug') || '';

  if (!_slug) {
    location.href = 'blog.html';
    return;
  }

  initReadingBar();

  // Nav shadow on scroll
  window.addEventListener('scroll', () => {
    document.querySelector('.top-nav')?.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });

  // auth.js handles initTheme / renderNavUser / _initMobileNav

  // Fetch post
  try {
    const headers = {};
    if (typeof authToken !== 'undefined' && authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    const res = await fetch(`${API}/posts/${encodeURIComponent(_slug)}`, { headers });

    if (!res.ok) {
      document.getElementById('article-loading').innerHTML = `
        <div class="feed-empty">
          <i class="fa-solid fa-circle-exclamation"></i>
          <h3>Post not found</h3>
          <a href="blog.html" class="btn btn-primary" style="margin-top:16px">Back to Blog</a>
        </div>`;
      return;
    }

    const post = await res.json();
    _postId = post.id;
    renderPost(post);
    loadComments();
    loadRelated();
    loadAdjacent();
  } catch {
    document.getElementById('article-loading').innerHTML = `
      <div class="feed-empty">
        <i class="fa-solid fa-wifi"></i>
        <h3>Could not load post</h3>
        <p>Check your connection and try again.</p>
      </div>`;
  }

  // Auth-gated comment form
  document.addEventListener('auth:navRendered', e => {
    const logged = e.detail?.loggedIn;
    document.getElementById('comment-form-wrap').style.display  = logged ? 'block' : 'none';
    document.getElementById('comment-login-prompt').style.display = logged ? 'none' : 'flex';
    if (logged) {
      const av = document.getElementById('my-avatar');
      if (av && typeof currentUser !== 'undefined' && currentUser) {
        av.textContent = ((currentUser.display_name || currentUser.username || '?')[0]).toUpperCase();
      }
    }
  });

  // Scroll top
  window.addEventListener('scroll', () => {
    document.getElementById('scroll-top-btn')?.classList.toggle('visible', window.scrollY > 400);
  });

  // Esc cancels reply
  document.getElementById('comment-input')?.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      _replyToId = null;
      e.target.placeholder = 'Write a comment…';
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitComment();
  });
});
