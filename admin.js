// admin.js — BeeLog Content Dashboard

const API = 'https://beelog-poes.onrender.com';

let _quill     = null;
let _editSlug  = null;
let _autosave  = null;
let _confirmCb = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
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

async function apiReq(path, opts = {}) {
  const token = typeof authToken !== 'undefined' ? authToken : null;
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── View switching ────────────────────────────────────────────────────────────

function switchView(name, btnEl) {
  document.querySelectorAll('.admin-view').forEach(v => v.style.display = 'none');
  document.getElementById(`view-${name}`).style.display = 'block';
  document.querySelectorAll('.admin-nav__item').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  else {
    const btn = document.querySelector(`[data-view="${name}"]`);
    if (btn) btn.classList.add('active');
  }
  const titles = { posts:'Posts', editor:'Editor', categories:'Categories', users:'Users' };
  document.getElementById('nav-page-title').textContent = titles[name] || name;

  if (name === 'posts')      { loadPosts(); loadStats(); }
  if (name === 'categories') loadCategories();
  if (name === 'users')      loadUsers();
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function loadStats() {
  const isAdmin = typeof currentUser !== 'undefined' && currentUser &&
    (currentUser.role === 'admin' || currentUser.role === 'root');
  if (!isAdmin) return;
  try {
    const s = await apiReq('/admin/stats');
    document.getElementById('stats-bar').innerHTML = `
      <div class="stat-card"><div class="stat-val">${s.total_posts}</div><div class="stat-lbl">Total Posts</div></div>
      <div class="stat-card"><div class="stat-val">${s.total_published}</div><div class="stat-lbl">Published</div></div>
      <div class="stat-card"><div class="stat-val">${s.total_drafts}</div><div class="stat-lbl">Drafts</div></div>
      <div class="stat-card"><div class="stat-val">${s.total_users}</div><div class="stat-lbl">Users</div></div>
      <div class="stat-card"><div class="stat-val">${s.total_comments}</div><div class="stat-lbl">Comments</div></div>`;
  } catch {}
}

// ── Posts ─────────────────────────────────────────────────────────────────────

let _postsFilter = '';

async function loadPosts(status) {
  if (status !== undefined) _postsFilter = status;
  const list = document.getElementById('posts-list');
  list.innerHTML = '<div class="table-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div>';

  const isAdmin = typeof currentUser !== 'undefined' && currentUser &&
    (currentUser.role === 'admin' || currentUser.role === 'root');

  try {
    let posts;
    if (isAdmin) {
      const q = _postsFilter ? `?status=${_postsFilter}` : '';
      posts = await apiReq(`/admin/posts${q}`);
    } else {
      posts = await apiReq('/posts/me/posts');
      if (_postsFilter === 'published') posts = posts.filter(p => p.status === 'published');
      else if (_postsFilter === 'draft') posts = posts.filter(p => p.status === 'draft');
    }

    if (!posts.length) { list.innerHTML = '<div class="table-loading">No posts found.</div>'; return; }

    list.innerHTML = posts.map(p => `
      <div class="post-row">
        <div>
          <div class="post-row__title">${escapeHtml(p.title || 'Untitled')}</div>
          <div class="post-row__meta">
            ${p.author_username ? escapeHtml(p.author_username) + ' · ' : ''}
            ${fmtDate(p.created_at)}
            &nbsp;·&nbsp;<i class="fa-regular fa-eye"></i> ${p.view_count||0}
            &nbsp;·&nbsp;<i class="fa-regular fa-heart"></i> ${p.like_count||0}
          </div>
        </div>
        <span class="status-badge ${p.status}">${p.status}</span>
        ${p.featured ? '<span title="Featured" style="color:var(--warning)"><i class="fa-solid fa-star"></i></span>' : '<span></span>'}
        <div class="post-row__actions">
          <button class="btn btn-ghost btn-xs" onclick="editPost('${escapeHtml(p.slug)}')">
            <i class="fa-solid fa-pen"></i>
          </button>
          <a class="btn btn-ghost btn-xs" href="post.html?slug=${encodeURIComponent(p.slug)}" target="_blank">
            <i class="fa-solid fa-arrow-up-right-from-square"></i>
          </a>
          <button class="btn btn-xs" style="border:1px solid var(--danger);color:var(--danger);background:none"
            onclick="confirmDelete('post','${escapeHtml(p.slug)}','${escapeHtml(p.title||'')}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>`).join('');

  } catch (e) {
    list.innerHTML = `<div class="table-loading">Error: ${escapeHtml(e.message)}</div>`;
  }
}

// ── Editor ────────────────────────────────────────────────────────────────────

function newPost() {
  _editSlug = null;
  resetEditor();
  switchView('editor', document.querySelector('[data-view="editor"]'));

  const saved = localStorage.getItem('beelog-draft');
  if (saved) {
    try {
      const d = JSON.parse(saved);
      if (d.title || d.body_delta) {
        if (confirm('Restore unsaved draft?')) {
          document.getElementById('post-title').value    = d.title || '';
          document.getElementById('post-subtitle').value = d.subtitle || '';
          if (d.body_delta && _quill) _quill.setContents(JSON.parse(d.body_delta));
          document.getElementById('post-tags').value     = (d.tags || []).join(', ');
          document.getElementById('post-meta').value     = d.meta_description || '';
          if (d.cover_image_url) {
            document.getElementById('post-cover-url').value = d.cover_image_url;
            updateCoverPreview(d.cover_image_url);
          }
          setAutosaveStatus('restored');
        }
      }
    } catch {}
  }
}

function resetEditor() {
  document.getElementById('edit-slug').value         = '';
  document.getElementById('post-title').value        = '';
  document.getElementById('post-subtitle').value     = '';
  document.getElementById('post-cover-url').value    = '';
  document.getElementById('post-tags').value         = '';
  document.getElementById('post-meta').value         = '';
  document.getElementById('post-featured').checked   = false;
  document.getElementById('cover-preview').innerHTML = '';
  document.getElementById('save-feedback').textContent = '';
  if (_quill) _quill.setText('');
  setStatus('draft');
  setAutosaveStatus('');
  _editSlug = null;
}

async function editPost(slug) {
  _editSlug = slug;
  switchView('editor', document.querySelector('[data-view="editor"]'));

  try {
    const headers = {};
    if (typeof authToken !== 'undefined' && authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res  = await fetch(`${API}/posts/${encodeURIComponent(slug)}`, { headers });
    if (!res.ok) throw new Error('Post not found');
    const post = await res.json();

    document.getElementById('edit-slug').value      = post.slug;
    document.getElementById('post-title').value     = post.title || '';
    document.getElementById('post-subtitle').value  = post.subtitle || '';
    document.getElementById('post-cover-url').value = post.cover_image_url || '';
    document.getElementById('post-tags').value      = post.tags?.map(t => t.name).join(', ') || '';
    document.getElementById('post-meta').value      = post.meta_description || '';
    document.getElementById('post-featured').checked = !!post.featured;
    if (post.cover_image_url) updateCoverPreview(post.cover_image_url);

    if (_quill) {
      if (post.body_delta) {
        try { _quill.setContents(JSON.parse(post.body_delta)); }
        catch { _quill.clipboard.dangerouslyPasteHTML(post.body_html || ''); }
      } else {
        _quill.clipboard.dangerouslyPasteHTML(post.body_html || '');
      }
    }

    setStatus(post.status);
    if (post.category_id) {
      const sel = document.getElementById('post-category');
      if (sel) sel.value = post.category_id;
    }
    setAutosaveStatus('loaded');
  } catch (e) {
    showToast('Failed to load post: ' + e.message, 'error');
  }
}

async function savePost(statusOverride) {
  const title    = document.getElementById('post-title').value.trim();
  const subtitle = document.getElementById('post-subtitle').value.trim();
  const coverUrl = document.getElementById('post-cover-url').value.trim();
  const tagsRaw  = document.getElementById('post-tags').value;
  const metaDesc = document.getElementById('post-meta').value.trim();
  const featured = document.getElementById('post-featured').checked;
  const catVal   = document.getElementById('post-category').value;

  let currentStatus = 'draft';
  document.querySelectorAll('.status-btn').forEach(b => {
    if (b.classList.contains('active')) currentStatus = b.dataset.status;
  });
  const status = statusOverride || currentStatus;

  if (!title) { showToast('Title is required', 'error'); return; }

  const bodyHtml  = _quill ? _quill.root.innerHTML : '';
  const bodyDelta = _quill ? JSON.stringify(_quill.getContents()) : null;
  const tags      = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

  const payload = {
    title, subtitle: subtitle || null,
    body_html: bodyHtml, body_delta: bodyDelta,
    cover_image_url: coverUrl || null,
    category_id: catVal ? parseInt(catVal) : null,
    tags, status,
    meta_description: metaDesc || null,
    featured,
  };

  document.getElementById('save-draft-btn').disabled = true;
  document.getElementById('publish-btn').disabled    = true;
  setAutosaveStatus('saving');

  try {
    let result;
    if (_editSlug) {
      result = await apiReq(`/posts/${encodeURIComponent(_editSlug)}`, {
        method: 'PATCH', body: JSON.stringify(payload),
      });
    } else {
      result = await apiReq('/posts', { method: 'POST', body: JSON.stringify(payload) });
      _editSlug = result.slug;
      document.getElementById('edit-slug').value = result.slug;
    }

    localStorage.removeItem('beelog-draft');
    setAutosaveStatus('saved');
    document.getElementById('save-feedback').textContent =
      status === 'published' ? '✓ Published!' : '✓ Draft saved.';
    showToast(status === 'published' ? 'Post published!' : 'Draft saved.', 'success');
    if (status === 'published') setStatus('published');

  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
    setAutosaveStatus('');
  } finally {
    document.getElementById('save-draft-btn').disabled = false;
    document.getElementById('publish-btn').disabled    = false;
  }
}

function setStatus(s) {
  document.querySelectorAll('.status-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.status === s)
  );
}

function setAutosaveStatus(state) {
  const bar = document.getElementById('autosave-bar');
  const lbl = document.getElementById('autosave-status');
  if (!bar || !lbl) return;
  bar.className = 'autosave-bar ' + state;
  const map = { saving:'Saving…', saved:'Saved', loaded:'Loaded', restored:'Draft restored', '':'Unsaved changes' };
  lbl.textContent = map[state] ?? state;
}

function updateCoverPreview(url) {
  const p = document.getElementById('cover-preview');
  if (p) p.innerHTML = url
    ? `<img src="${escapeHtml(url)}" alt="cover preview" onerror="this.parentElement.innerHTML='Invalid URL'">`
    : '';
}

// ── Autosave to localStorage ──────────────────────────────────────────────────

function startAutosave() {
  clearInterval(_autosave);
  _autosave = setInterval(() => {
    if (!_quill || _editSlug) return; // Only autosave new (unsaved) posts
    const draft = {
      title:            document.getElementById('post-title')?.value || '',
      subtitle:         document.getElementById('post-subtitle')?.value || '',
      body_delta:       JSON.stringify(_quill.getContents()),
      cover_image_url:  document.getElementById('post-cover-url')?.value || '',
      tags:             (document.getElementById('post-tags')?.value || '').split(',').map(t=>t.trim()).filter(Boolean),
      meta_description: document.getElementById('post-meta')?.value || '',
      saved_at:         new Date().toISOString(),
    };
    localStorage.setItem('beelog-draft', JSON.stringify(draft));
    setAutosaveStatus('saved');
  }, 30000);
}

// ── Categories ────────────────────────────────────────────────────────────────

async function loadCategories() {
  const list = document.getElementById('cats-list');
  try {
    const cats = await apiReq('/admin/categories');
    if (!cats.length) { list.innerHTML = '<div class="table-loading">No categories yet.</div>'; return; }
    list.innerHTML = cats.map(c => `
      <div class="cat-row">
        <div>
          <div class="cat-name">${escapeHtml(c.name)}</div>
          ${c.description ? `<div class="cat-desc">${escapeHtml(c.description)}</div>` : ''}
        </div>
        <span style="font-size:.78rem;color:var(--text-3)">${c.post_count} posts</span>
        <div class="row-actions">
          <button class="btn btn-xs" style="border:1px solid var(--danger);color:var(--danger);background:none"
            onclick="confirmDelete('category',${c.id},'${escapeHtml(c.name)}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>`).join('');
  } catch (e) {
    list.innerHTML = `<div class="table-loading">Error: ${escapeHtml(e.message)}</div>`;
  }
}

async function createCategory() {
  const name = document.getElementById('new-cat-name').value.trim();
  const desc = document.getElementById('new-cat-desc').value.trim();
  if (!name) return;
  try {
    await apiReq('/admin/categories', {
      method: 'POST', body: JSON.stringify({ name, description: desc || null }),
    });
    document.getElementById('new-cat-name').value = '';
    document.getElementById('new-cat-desc').value = '';
    loadCategories();
    populateCategorySelect();
    showToast('Category created!', 'success');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

async function populateCategorySelect() {
  try {
    const cats = await apiReq('/admin/categories');
    const sel  = document.getElementById('post-category');
    const cur  = sel.value;
    sel.innerHTML = '<option value="">— None —</option>' +
      cats.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    sel.value = cur;
  } catch {}
}

// ── Users ─────────────────────────────────────────────────────────────────────

async function loadUsers() {
  const list = document.getElementById('users-list');
  try {
    const users = await apiReq('/admin/users');
    list.innerHTML = users.map(u => `
      <div class="user-row">
        <div class="a-avatar" style="width:36px;height:36px;flex-shrink:0;font-size:.9rem">
          ${((u.display_name||u.username||'?')[0]).toUpperCase()}
        </div>
        <div>
          <div style="font-weight:600;font-size:.9rem">${escapeHtml(u.display_name||u.username)}</div>
          <div style="font-size:.78rem;color:var(--text-3)">@${escapeHtml(u.username)} · ${fmtDate(u.created_at)}</div>
        </div>
        <span class="user-role-badge ${u.role}">${u.role}</span>
        <div class="row-actions">
          ${u.role !== 'root' ? `
          <select class="settings-input" style="width:auto;padding:4px 8px;font-size:.78rem"
            onchange="changeRole(${u.id},this.value)">
            <option value="author" ${u.role==='author'?'selected':''}>Author</option>
            <option value="admin"  ${u.role==='admin'?'selected':''}>Admin</option>
          </select>
          <button class="btn btn-xs" style="border:1px solid var(--danger);color:var(--danger);background:none"
            onclick="confirmDelete('user',${u.id},'${escapeHtml(u.username)}')">
            <i class="fa-solid fa-trash"></i>
          </button>` : '<span style="color:var(--text-3);font-size:.78rem">Root</span>'}
        </div>
      </div>`).join('');
  } catch (e) { list.innerHTML = `<div class="table-loading">Error: ${escapeHtml(e.message)}</div>`; }
}

async function createUser() {
  const username = document.getElementById('new-user-username').value.trim();
  const display  = document.getElementById('new-user-display').value.trim();
  const password = document.getElementById('new-user-password').value;
  const role     = document.getElementById('new-user-role').value;
  if (!username || !password) { showToast('Username and password required', 'error'); return; }
  try {
    await apiReq('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, display_name: display, password, role }),
    });
    ['new-user-username','new-user-display','new-user-password'].forEach(id =>
      document.getElementById(id) && (document.getElementById(id).value = ''));
    loadUsers();
    showToast('User created!', 'success');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

async function changeRole(userId, role) {
  try {
    await apiReq(`/admin/users/${userId}/role`, { method:'PATCH', body: JSON.stringify({ role }) });
    showToast('Role updated.', 'success');
    loadUsers();
  } catch (e) { showToast('Error: ' + e.message, 'error'); loadUsers(); }
}

// ── Confirm delete ────────────────────────────────────────────────────────────

function confirmDelete(type, id, name) {
  document.getElementById('confirm-title').textContent = `Delete ${type}?`;
  document.getElementById('confirm-msg').textContent   = `"${name}" will be permanently deleted.`;
  document.getElementById('confirm-modal').style.display = 'flex';
  _confirmCb = async () => {
    try {
      if (type === 'post') {
        await fetch(`${API}/posts/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${authToken}` },
        });
      } else if (type === 'category') {
        await apiReq(`/admin/categories/${id}`, { method: 'DELETE' });
      } else if (type === 'user') {
        await apiReq(`/admin/users/${id}`, { method: 'DELETE' });
      }
      showToast('Deleted.', 'success');
      closeConfirm();
      if (type === 'post')     loadPosts();
      if (type === 'category') loadCategories();
      if (type === 'user')     loadUsers();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
  };
}

function doConfirm()  { if (_confirmCb) _confirmCb(); }
function closeConfirm() {
  document.getElementById('confirm-modal').style.display = 'none';
  _confirmCb = null;
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // auth.js handles initTheme / renderNavUser / _initMobileNav

  document.addEventListener('auth:navRendered', e => {
    if (!e.detail?.loggedIn) {
      setTimeout(() => typeof openLoginModal === 'function' && openLoginModal(), 400);
      return;
    }

    const role = (typeof currentUser !== 'undefined' && currentUser?.role) || '';

    // Show admin-only nav items
    if (role === 'admin' || role === 'root') {
      document.getElementById('admin-divider')?.style && (document.getElementById('admin-divider').style.display = '');
      document.getElementById('users-nav-btn')?.style && (document.getElementById('users-nav-btn').style.display = '');
    }

    // Show admin panel link in dropdown for author role too
    if (role === 'admin' || role === 'root' || role === 'author') {
      document.getElementById('admin-link-item')?.style && (document.getElementById('admin-link-item').style.display = '');
    }

    // Init Quill
    _quill = new Quill('#quill-editor', {
      theme: 'snow',
      placeholder: 'Write your post here…',
      modules: {
        toolbar: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          ['blockquote', 'code-block'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link', 'image', 'video'],
          [{ color: [] }, { background: [] }],
          ['clean'],
        ],
      },
    });
    _quill.on('text-change', () => setAutosaveStatus(''));

    // Cover URL live preview
    document.getElementById('post-cover-url')?.addEventListener('input', e => {
      updateCoverPreview(e.target.value.trim());
    });

    // Meta description char counter
    document.getElementById('post-meta')?.addEventListener('input', e => {
      const len = e.target.value.length;
      const hint = document.getElementById('meta-chars');
      if (hint) {
        hint.textContent = `${len} / 160`;
        hint.style.color = len > 160 ? 'var(--danger)' : '';
      }
    });

    // Status buttons
    document.querySelectorAll('.status-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.status-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      });
    });

    // Post tabs
    document.querySelectorAll('#posts-tabs .tab').forEach(t => {
      t.addEventListener('click', () => {
        document.querySelectorAll('#posts-tabs .tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        loadPosts(t.dataset.status);
      });
    });

    populateCategorySelect();

    // URL param: ?edit=slug
    const params = new URLSearchParams(location.search);
    if (params.get('edit')) {
      editPost(params.get('edit'));
    } else {
      loadPosts();
      loadStats();
    }

    startAutosave();
  });
});
