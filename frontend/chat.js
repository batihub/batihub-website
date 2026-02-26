const API_URL = "http://127.0.0.1:8000";
let ws = null;
let currentUsername = "";
let authToken = null;

document.addEventListener('DOMContentLoaded', () => {
    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        const icon = themeToggle.querySelector('i');
        if (document.documentElement.getAttribute('data-theme') === 'dark') {
            icon.classList.replace('fa-moon', 'fa-sun');
        }
        themeToggle.addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
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

    // Enter key on password / username
    document.getElementById('password')?.addEventListener('keypress', e => {
        if (e.key === 'Enter') connectWebSocket();
    });
    document.getElementById('username')?.addEventListener('keypress', e => {
        if (e.key === 'Enter') connectWebSocket();
    });

    // Auth tab switching
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            document.querySelectorAll('.auth-form').forEach(f => f.style.display = 'none');
            document.getElementById(`${target}-form`).style.display = 'block';
            document.getElementById('connection-error').textContent = '';
        });
    });
});

// ── Register ──────────────────────────────────────────────────────────────────

async function registerAndJoin() {
    const username = document.getElementById('reg-username').value.trim();
    const displayName = document.getElementById('reg-displayname').value.trim();
    const password = document.getElementById('reg-password').value;
    const errorDiv = document.getElementById('connection-error');

    if (!username || !password) {
        errorDiv.textContent = 'Username and password are required.';
        return;
    }

    try {
        const res = await fetch(`${API_URL}/user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, display_name: displayName }),
        });

        if (res.ok) {
            // Auto-login after register
            await _doLogin(username, password, errorDiv);
        } else {
            const err = await res.json().catch(() => ({}));
            errorDiv.textContent = err.detail || 'Registration failed.';
        }
    } catch (e) {
        errorDiv.textContent = 'Network error. Is the backend running?';
    }
}

// ── Login + Connect ───────────────────────────────────────────────────────────

async function connectWebSocket() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('connection-error');

    if (!username || !password) {
        errorDiv.textContent = 'Please enter your username and password.';
        return;
    }

    await _doLogin(username, password, errorDiv);
}

async function _doLogin(username, password, errorDiv) {
    const form = new URLSearchParams();
    form.append('username', username);
    form.append('password', password);

    try {
        const res = await fetch(`${API_URL}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form,
        });

        if (!res.ok) {
            errorDiv.textContent = 'Incorrect username or password.';
            return;
        }

        const data = await res.json();
        authToken = data.access_token;
        currentUsername = username;
        errorDiv.textContent = '';

        _openWebSocket();
    } catch (e) {
        errorDiv.textContent = 'Network error. Is the backend running?';
    }
}

function _openWebSocket() {
    const wsUrl = `ws://127.0.0.1:8000/ws/chat?token=${encodeURIComponent(authToken)}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        document.getElementById('join-panel').style.display = 'none';
        document.getElementById('chat-panel').style.display = 'block';
        document.getElementById('room-title').textContent = 'Room: general';
        document.getElementById('messages').innerHTML = '';
        // Load chat history
        loadChatHistory();
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'system') {
                appendSystemMessage(data.text);
            } else if (data.type === 'chat') {
                // Don't double-render our own messages (we append optimistically on send)
                if (data.username !== currentUsername) {
                    appendMessage(data.username, data.text, data.timestamp);
                }
            }
        } catch (e) {
            appendSystemMessage(event.data);
        }

        const messagesDiv = document.getElementById('messages');
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    };

    ws.onclose = () => {
        appendSystemMessage('Disconnected from the chat server.');
        setTimeout(disconnectWebSocket, 2000);
    };

    ws.onerror = () => {
        document.getElementById('connection-error').textContent =
            'WebSocket connection failed. Is the server running?';
    };
}

// ── Load History ──────────────────────────────────────────────────────────────

async function loadChatHistory() {
    try {
        const res = await fetch(`${API_URL}/chat_logs`, {
            headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (!res.ok) return;
        const logs = await res.json();

        // Show last 50 messages as history
        const recent = logs.slice(-50);
        if (recent.length > 0) {
            appendSystemMessage(`── Chat history (last ${recent.length} messages) ──`);
            recent.forEach(msg => appendMessage(msg.username, msg.text, msg.timestamp, true));
            appendSystemMessage('── Live ──');
        }

        const messagesDiv = document.getElementById('messages');
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } catch (e) { /* silent — history is nice-to-have */ }
}

// ── Send ──────────────────────────────────────────────────────────────────────

function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    if (message && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
        appendMessage(currentUsername, message); // optimistic
        input.value = '';
    }
}

function handleKeyPress(event) {
    if (event.key === 'Enter') sendMessage();
}

// ── Disconnect ────────────────────────────────────────────────────────────────

function disconnectWebSocket() {
    if (ws) {
        ws.close();
        ws = null;
    }
    authToken = null;
    document.getElementById('chat-panel').style.display = 'none';
    document.getElementById('join-panel').style.display = 'block';
}

// ── Render Messages ───────────────────────────────────────────────────────────

function appendMessage(sender, text, isoTimestamp = null, isHistory = false) {
    const messagesDiv = document.getElementById('messages');
    const wrapper = document.createElement('div');
    wrapper.classList.add('msg-wrapper');

    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');

    const now = isoTimestamp ? new Date(isoTimestamp) : new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const timeSpan = `<span class="msg-time">${timeString}</span>`;

    if (sender === currentUsername) {
        msgDiv.classList.add('msg-me');
        if (isHistory) msgDiv.style.opacity = '0.7';
        msgDiv.innerHTML = `${escapeHtml(text)} ${timeSpan}`;
        wrapper.classList.add('wrapper-me');
    } else {
        msgDiv.classList.add('msg-other');
        if (isHistory) msgDiv.style.opacity = '0.7';
        msgDiv.innerHTML = `<div class="sender-name">${escapeHtml(sender)}</div>
                            <div class="msg-content">${escapeHtml(text)} ${timeSpan}</div>`;
        wrapper.classList.add('wrapper-other');
    }

    wrapper.appendChild(msgDiv);
    messagesDiv.appendChild(wrapper);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function appendSystemMessage(text) {
    const messagesDiv = document.getElementById('messages');
    const wrapper = document.createElement('div');
    wrapper.classList.add('msg-wrapper', 'wrapper-system');

    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', 'msg-system');
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    msgDiv.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${escapeHtml(text)}
                        <span class="system-time">${timeString}</span>`;

    wrapper.appendChild(msgDiv);
    messagesDiv.appendChild(wrapper);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
