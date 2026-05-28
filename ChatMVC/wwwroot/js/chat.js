// API_BASE_URL, HUB_URL, CURRENT_USERNAME — Razor view tarafından inject edilir
const API_MESSAGES = `${API_BASE_URL}/api/messages`;

let connection = null;
let currentUser = CURRENT_USERNAME;
let currentRoom = null;
let isSending = false;

// ── DOM refs ──────────────────────────────────────────────
const roomInput       = document.getElementById('room-input');
const joinBtn         = document.getElementById('join-btn');
const leaveBtn        = document.getElementById('leave-btn');
const messages        = document.getElementById('messages');
const messageInput    = document.getElementById('message-input');
const sendBtn         = document.getElementById('send-btn');
const connectionBadge = document.getElementById('connection-badge');
const connectionText  = document.getElementById('connection-text');
const usersList       = document.getElementById('users-list');
const roomsList       = document.getElementById('rooms-list');
const chatOverlay     = document.getElementById('chat-overlay');
const panelSetup      = document.getElementById('panel-setup');
const panelRoom       = document.getElementById('panel-room');
const roomTag         = document.getElementById('room-tag');

// ── Helpers ───────────────────────────────────────────────

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function formatTime(isoString) {
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function setStatus(state) {
    connectionBadge.className = `badge badge--${state}`;
    const labels = { disconnected: 'Disconnected', connecting: 'Connecting…', connected: 'Connected', reconnecting: 'Reconnecting…' };
    connectionText.textContent = labels[state] ?? state;
}

function setInputEnabled(enabled) {
    messageInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
}

// ── Rooms list ────────────────────────────────────────────

function renderRooms(rooms) {
    if (!rooms || rooms.length === 0) {
        roomsList.innerHTML = '<li class="list-empty">No active rooms</li>';
        return;
    }

    roomsList.innerHTML = rooms.map(name => `
        <li class="room-item ${name === currentRoom ? 'room-item--active' : ''}"
            data-room="${escapeHtml(name)}">
            <span class="room-hash">#</span>
            <span>${escapeHtml(name)}</span>
        </li>`
    ).join('');

    roomsList.querySelectorAll('.room-item').forEach(li => {
        li.addEventListener('click', async () => {
            const roomName = li.dataset.room;
            if (roomName === currentRoom) return;
            if (connection?.state === signalR.HubConnectionState.Connected)
                await joinRoom(roomName);
        });
    });
}

// ── Users list ────────────────────────────────────────────

function renderUsers(users) {
    if (!users || users.length === 0) {
        usersList.innerHTML = '<li class="list-empty">No users online</li>';
        return;
    }
    usersList.innerHTML = users.map(name => `
        <li>
            <div class="user-avatar">${escapeHtml(name.charAt(0))}</div>
            <span>${escapeHtml(name)}</span>
        </li>`
    ).join('');
}

// ── Message rendering ─────────────────────────────────────

function appendMessage(msg) {
    const isOwn = msg.sender === currentUser;
    const el = document.createElement('div');
    el.className = `msg msg--${isOwn ? 'own' : 'other'}`;
    el.innerHTML = `
        ${!isOwn ? `<div class="msg__sender">${escapeHtml(msg.sender)}</div>` : ''}
        <div class="msg__bubble">${escapeHtml(msg.content)}</div>
        <div class="msg__time">${formatTime(msg.timestamp)}</div>`;
    messages.appendChild(el);
}

function appendSystem(text) {
    const el = document.createElement('div');
    el.className = 'sys-msg';
    el.textContent = text;
    messages.appendChild(el);
}

function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
}

// ── SignalR bağlantısı ────────────────────────────────────

async function initConnection() {
    setStatus('connecting');

    connection = new signalR.HubConnectionBuilder()
        .withUrl(`${HUB_URL}?username=${encodeURIComponent(currentUser)}`)
        .withAutomaticReconnect([0, 2000, 5000, 10000])
        .configureLogging(signalR.LogLevel.Warning)
        .build();

    connection.on('ReceiveMessage', (msg) => { appendMessage(msg); scrollToBottom(); });
    connection.on('UpdateUsers', renderUsers);
    connection.on('UpdateRooms', renderRooms);

    connection.onreconnecting(() => { setStatus('reconnecting'); setInputEnabled(false); });

    connection.onreconnected(async () => {
        setStatus('connected');
        if (currentRoom) await connection.invoke('JoinRoom', currentRoom);
        setInputEnabled(!!currentRoom);
    });

    connection.onclose(() => { setStatus('disconnected'); setInputEnabled(false); });

    try {
        await connection.start();
        setStatus('connected');
    } catch (err) {
        console.error('Bağlantı kurulamadı:', err);
        setStatus('disconnected');
    }
}

// ── Room management ───────────────────────────────────────

async function joinRoom(roomName) {
    if (currentRoom && currentRoom !== roomName) {
        try { await connection.invoke('LeaveRoom', currentRoom); } catch { /* ignore */ }
    }

    await connection.invoke('JoinRoom', roomName);
    currentRoom = roomName;

    panelSetup.hidden = true;
    panelRoom.hidden = false;
    roomTag.textContent = `# ${roomName}`;
    chatOverlay.hidden = true;

    messages.innerHTML = '';
    try {
        const resp = await fetch(`${API_MESSAGES}/${encodeURIComponent(roomName)}`);
        if (resp.ok) {
            const history = await resp.json();
            history.length > 0
                ? history.forEach(appendMessage)
                : appendSystem('No messages yet — start the conversation!');
            scrollToBottom();
        }
    } catch (err) {
        console.error('Mesaj geçmişi yüklenemedi:', err);
    }

    setInputEnabled(true);
    messageInput.focus();
}

async function leaveRoom() {
    if (!currentRoom) return;
    try { await connection.invoke('LeaveRoom', currentRoom); } catch { /* ignore */ }

    currentRoom = null;
    messages.innerHTML = '';
    setInputEnabled(false);
    chatOverlay.hidden = false;
    panelRoom.hidden = true;
    panelSetup.hidden = false;
}

// ── Send message ──────────────────────────────────────────

async function sendMessage() {
    const content = messageInput.value.trim();
    if (!content || !currentRoom || isSending) return;

    isSending = true;
    setInputEnabled(false);

    try {
        const resp = await fetch(API_MESSAGES, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender: currentUser, content, roomName: currentRoom })
        });
        if (resp.ok) {
            messageInput.value = '';
        } else {
            console.error('Gönderme hatası:', await resp.text());
        }
    } catch (err) {
        console.error('Ağ hatası:', err);
    } finally {
        isSending = false;
        setInputEnabled(true);
        messageInput.focus();
    }
}

// ── Event listeners ───────────────────────────────────────

joinBtn.addEventListener('click', async () => {
    const room = roomInput.value.trim();
    if (!room) { roomInput.focus(); return; }

    if (connection?.state !== signalR.HubConnectionState.Connected) return;

    joinBtn.disabled = true;
    await joinRoom(room);
    joinBtn.disabled = false;
});

leaveBtn.addEventListener('click', leaveRoom);
sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });

// ── Sayfa açılışında bağlan ───────────────────────────────
initConnection();
