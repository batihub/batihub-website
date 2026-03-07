/**
 * auth.js — Shared authentication for baerhub
 * Include this on every page BEFORE any page-specific script.
 * Exposes: authToken, currentUser, login(), register(), logout(), renderNavUser(), initTheme()
 */


// ── Inject modal styles (self-contained so works on any page) ────────────────
(function() {
    const style = document.createElement('style');
    style.textContent = `
        #baerhub-login-modal.modal {
            display: none;
            position: fixed;
            z-index: 9999;
            left: 0; top: 0;
            width: 100%; height: 100%;
            background-color: rgba(15, 23, 42, 0.65);
            backdrop-filter: blur(8px);
            justify-content: center;
            align-items: center;
        }
        #baerhub-login-modal .modal-content {
            background-color: var(--card-bg, #1e293b);
            padding: 40px;
            border-radius: 24px;
            width: 90%;
            max-width: 500px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.3);
        }
        #baerhub-login-modal .auth-tabs {
            display: flex; gap: 4px;
            background: var(--input-bg, #0f172a);
            padding: 4px; border-radius: 12px; width: fit-content;
        }
        #baerhub-login-modal .auth-tab {
            background: transparent; border: none;
            padding: 8px 20px; border-radius: 9px;
            font-family: inherit; font-size: 0.9rem; font-weight: 600;
            color: var(--text-muted, #94a3b8); cursor: pointer;
            transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px;
        }
        #baerhub-login-modal .auth-tab.active {
            background: var(--card-bg, #1e293b);
            color: var(--text-main, #f8fafc);
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        #baerhub-login-modal .form-group { margin-bottom: 20px; }
        #baerhub-login-modal label {
            display: block; margin-bottom: 8px;
            font-size: 0.9rem; font-weight: 600;
            color: var(--text-main, #f8fafc);
        }
        #baerhub-login-modal input[type=text],
        #baerhub-login-modal input[type=password] {
            width: 100%; padding: 12px 14px;
            border: 1px solid var(--input-border, #334155);
            border-radius: 10px; box-sizing: border-box;
            background: var(--input-bg, #0f172a);
            color: var(--text-main, #f8fafc);
            font-size: 0.95rem; font-family: inherit;
            transition: all 0.2s;
        }
        #baerhub-login-modal input:focus {
            outline: none;
            border-color: var(--accent, #818cf8);
            box-shadow: 0 0 0 3px rgba(99,102,241,0.2);
            background: var(--card-bg, #1e293b);
        }
        #baerhub-login-modal .form-error {
            color: #ef4444; font-size: 0.85rem;
            min-height: 18px; margin-bottom: 8px;
        }
        #baerhub-login-modal .button-group {
            display: flex; gap: 10px;
        }
        #baerhub-login-modal .modal-actions {
            justify-content: flex-end; margin-top: 24px;
        }
        #baerhub-login-modal .input-group {
            display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
        }
        #baerhub-login-modal .input-wrapper label { margin-top: 0; }
        #baerhub-login-modal .text-danger { color: #ef4444; }
        #baerhub-login-modal .btn {
            padding: 12px 20px; border: none; border-radius: 10px;
            cursor: pointer; font-weight: 600; font-family: inherit;
            font-size: 0.95rem; color: white;
            transition: all 0.2s; display: inline-flex;
            align-items: center; justify-content: center; gap: 8px;
        }
        #baerhub-login-modal .btn-primary {
            background-color: var(--accent, #6366f1);
        }
        #baerhub-login-modal .btn-primary:hover {
            background-color: var(--accent-hover, #4f46e5);
            transform: translateY(-1px);
        }
        .nav-login-btn {
            padding: 8px 16px !important;
            font-size: 0.85rem !important;
            border-radius: 20px !important;
        }
        #baerhub-login-modal .btn-secondary {
            background-color: var(--input-border, #334155);
            color: var(--text-main, #f8fafc);
        }
    `;
    document.head.appendChild(style);
})();

const API_URL = "http://127.0.0.1:8000";

let authToken   = localStorage.getItem('baerhub-token') || null;
let currentUser = JSON.parse(localStorage.getItem('baerhub-user') || 'null');

// ── Theme ─────────────────────────────────────────────────────────────────────
function initTheme() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const icon = btn.querySelector('i');
    if (document.documentElement.getAttribute('data-theme') === 'dark') {
        icon.classList.replace('fa-moon', 'fa-sun');
    }
    btn.addEventListener('click', () => {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (dark) {
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

// ── Nav user pill (works on every page) ──────────────────────────────────────
function renderNavUser() {
    const slot = document.getElementById('nav-user-slot');
    if (!slot) return;

    if (authToken && currentUser) {
        const letter = (currentUser.display_name || currentUser.username).charAt(0).toUpperCase();
        slot.innerHTML = `
            <div class="nav-user-pill" id="user-pill" onclick="toggleUserMenu(event)">
                <span class="nav-avatar">${letter}</span>
                <span class="nav-username">@${escapeHtml(currentUser.username)}</span>
                <i class="fa-solid fa-chevron-down toggle-icon" style="font-size:0.7rem;color:var(--text-muted);transition:transform 0.2s"></i>
            </div>
            <div class="user-dropdown" id="user-dropdown">
                <div class="dropdown-info">
                    <span class="dropdown-display">${escapeHtml(currentUser.display_name || currentUser.username)}</span>
                    <span class="dropdown-handle">@${escapeHtml(currentUser.username)}</span>
                </div>
                <div class="dropdown-divider"></div>
                <button class="dropdown-item danger" onclick="logout()">
                    <i class="fa-solid fa-right-from-bracket"></i> Log Out
                </button>
            </div>`;
    } else {
        // Show login button on every page
        slot.innerHTML = `<button class="btn btn-primary nav-login-btn" onclick="openLoginModal()">
            <i class="fa-solid fa-right-to-bracket"></i> Log In
        </button>`;
    }

    // Notify the page that nav state changed (pages can listen for this)
    document.dispatchEvent(new CustomEvent('auth:navRendered', { detail: { loggedIn: !!(authToken && currentUser) } }));
}

function toggleUserMenu(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('user-dropdown');
    const pill     = document.getElementById('user-pill');
    if (!dropdown) return;
    const open = dropdown.classList.toggle('open');
    pill.querySelector('.toggle-icon').style.transform = open ? 'rotate(180deg)' : '';
    if (open) {
        setTimeout(() => { document.addEventListener('click', closeDropdown, { once: true }); }, 0);
    }
}

function closeDropdown() {
    const d = document.getElementById('user-dropdown');
    const p = document.getElementById('user-pill');
    if (d) d.classList.remove('open');
    if (p) { const i = p.querySelector('.toggle-icon'); if (i) i.style.transform = ''; }
}

// ── Global login modal (injected into every page automatically) ───────────────
function _injectLoginModal() {
    if (document.getElementById('baerhub-login-modal')) return; // already there
    const el = document.createElement('div');
    el.innerHTML = `
    <div id="baerhub-login-modal" class="modal" style="display:none">
        <div class="modal-content">
            <div class="auth-tabs">
                <button class="auth-tab active" data-baertab="login">
                    <i class="fa-solid fa-right-to-bracket"></i> Log In
                </button>
                <button class="auth-tab" data-baertab="register">
                    <i class="fa-solid fa-user-plus"></i> Register
                </button>
            </div>

            <div id="baer-login-form" class="auth-form" style="margin-top:28px">
                <div class="form-group"><label>Username</label>
                    <input type="text" id="baer-login-username" placeholder="your_username">
                </div>
                <div class="form-group"><label>Password</label>
                    <input type="password" id="baer-login-password" placeholder="••••••••">
                </div>
                <div id="baer-login-error" class="form-error"></div>
                <div class="button-group modal-actions">
                    <button class="btn btn-secondary" onclick="closeLoginModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="login()">
                        <i class="fa-solid fa-right-to-bracket"></i> Log In
                    </button>
                </div>
            </div>

            <div id="baer-register-form" class="auth-form" style="display:none;margin-top:28px">
                <div class="input-group">
                    <div class="input-wrapper">
                        <label>Username <small class="text-danger">*</small></label>
                        <input type="text" id="baer-reg-username" placeholder="unique_handle" maxlength="50">
                    </div>
                    <div class="input-wrapper">
                        <label>Display Name</label>
                        <input type="text" id="baer-reg-displayname" placeholder="Your Name">
                    </div>
                </div>
                <div class="form-group" style="margin-top:16px">
                    <label>Password <small class="text-danger">*</small></label>
                    <input type="password" id="baer-reg-password" placeholder="••••••••">
                </div>
                <div id="baer-reg-error" class="form-error"></div>
                <div class="button-group modal-actions">
                    <button class="btn btn-secondary" onclick="closeLoginModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="register()">
                        <i class="fa-solid fa-user-plus"></i> Create Account
                    </button>
                </div>
            </div>
        </div>
    </div>`;
    document.body.appendChild(el.firstElementChild);

    // Tab switching
    document.querySelectorAll('[data-baertab]').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('[data-baertab]').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('baer-login-form').style.display   = tab.dataset.baertab === 'login'    ? 'block' : 'none';
            document.getElementById('baer-register-form').style.display = tab.dataset.baertab === 'register' ? 'block' : 'none';
            document.getElementById('baer-login-error').textContent = '';
            document.getElementById('baer-reg-error').textContent   = '';
        });
    });

    // Close on backdrop click
    document.getElementById('baerhub-login-modal').addEventListener('click', e => {
        if (e.target === document.getElementById('baerhub-login-modal')) closeLoginModal();
    });

    // Enter key support
    document.getElementById('baer-login-password').addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
    document.getElementById('baer-reg-password').addEventListener('keypress',   e => { if (e.key === 'Enter') register(); });
}

function openLoginModal() {
    _injectLoginModal();
    document.getElementById('baerhub-login-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('baer-login-username')?.focus(), 50);
}

function closeLoginModal() {
    const modal = document.getElementById('baerhub-login-modal');
    if (modal) modal.style.display = 'none';
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function login() {
    _injectLoginModal(); // ensure modal exists even if called from a page's own button
    const username = document.getElementById('baer-login-username')?.value.trim()
                  || document.getElementById('login-username')?.value.trim();
    const password = document.getElementById('baer-login-password')?.value
                  || document.getElementById('login-password')?.value;
    const errEl    = document.getElementById('baer-login-error')
                  || document.getElementById('login-error')
                  || document.getElementById('auth-error');

    if (errEl) errEl.textContent = '';
    if (!username || !password) { if (errEl) errEl.textContent = 'Fill in all fields.'; return; }

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
            const data  = await res.json();
            authToken   = data.access_token;
            currentUser = { username };
            localStorage.setItem('baerhub-token', authToken);
            localStorage.setItem('baerhub-user',  JSON.stringify(currentUser));
            closeLoginModal();
            renderNavUser();
            document.dispatchEvent(new CustomEvent('auth:login', { detail: { username } }));
            if (typeof showToast === 'function') showToast(`Welcome back, ${username}!`);
        } else {
            if (errEl) errEl.textContent = 'Incorrect username or password.';
        }
    } catch (e) {
        if (errEl) errEl.textContent = 'Network error. Is the backend running?';
    }
}

// ── Register ──────────────────────────────────────────────────────────────────
async function register() {
    _injectLoginModal();
    const username    = document.getElementById('baer-reg-username')?.value.trim()
                     || document.getElementById('reg-username')?.value.trim();
    const displayName = document.getElementById('baer-reg-displayname')?.value.trim()
                     || document.getElementById('reg-displayname')?.value.trim();
    const password    = document.getElementById('baer-reg-password')?.value
                     || document.getElementById('reg-password')?.value;
    const errEl       = document.getElementById('baer-reg-error')
                     || document.getElementById('reg-error')
                     || document.getElementById('auth-error');

    if (errEl) errEl.textContent = '';
    if (!username || !password) { if (errEl) errEl.textContent = 'Username and password required.'; return; }

    try {
        const res = await fetch(`${API_URL}/user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, display_name: displayName }),
        });
        if (res.ok) {
            // Auto-login after register
            if (document.getElementById('baer-login-username'))
                document.getElementById('baer-login-username').value = username;
            if (document.getElementById('baer-login-password'))
                document.getElementById('baer-login-password').value = password;
            // Switch to login tab
            document.querySelectorAll('[data-baertab]').forEach(t => t.classList.remove('active'));
            const loginTab = document.querySelector('[data-baertab="login"]');
            if (loginTab) loginTab.classList.add('active');
            if (document.getElementById('baer-register-form'))
                document.getElementById('baer-register-form').style.display = 'none';
            if (document.getElementById('baer-login-form'))
                document.getElementById('baer-login-form').style.display = 'block';
            await login();
        } else {
            const err = await res.json().catch(() => ({}));
            if (errEl) errEl.textContent = err.detail || 'Registration failed.';
        }
    } catch (e) {
        if (errEl) errEl.textContent = 'Network error.';
    }
}

// ── Logout ────────────────────────────────────────────────────────────────────
function logout() {
    authToken   = null;
    currentUser = null;
    localStorage.removeItem('baerhub-token');
    localStorage.removeItem('baerhub-user');
    renderNavUser();
    document.dispatchEvent(new CustomEvent('auth:logout'));
    if (typeof showToast === 'function') showToast('Logged out.');
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    renderNavUser();
    _injectLoginModal();
});
