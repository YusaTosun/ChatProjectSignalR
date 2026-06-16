// API_BASE_URL, HUB_URL, CURRENT_USER_ID, CURRENT_USERNAME — Razor view tarafından inject edilir

let connection = null;
let currentUser = CURRENT_USERNAME;
let currentRoomId = null;    // Guid string
let currentRoomName = null;  // Görüntüleme için
let allRooms = [];           // { id, name, createdBy, createdAt }[]
let onlineUsers = [];        // string[]
let isSending = false;

// ── Pending media ─────────────────────────────────────────
let pendingMediaUrl  = null;
let pendingMediaType = null;

function setPendingMedia(url, type) {
    pendingMediaUrl  = url;
    pendingMediaType = type;
    mediaPreviewInner.innerHTML = type === 'image'
        ? `<img src="${url}" alt="preview">`
        : `<video src="${url}"></video>`;
    mediaPreview.hidden = false;
}

function clearPendingMedia() {
    pendingMediaUrl  = null;
    pendingMediaType = null;
    mediaPreviewInner.innerHTML = '';
    mediaPreview.hidden = true;
    mediaInput.value = '';
}

// ── Typing ────────────────────────────────────────────────
const typingUsers = new Map(); // username → otomatik temizleme timer'ı
let typingTimer = null;        // kendi "yazmayı bıraktım" debounce timer'ı

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
const typingIndicator  = document.getElementById('typing-indicator');
const mediaPreview     = document.getElementById('media-preview');
const mediaPreviewInner = document.getElementById('media-preview-inner');
const mediaRemoveBtn   = document.getElementById('media-remove-btn');
const mediaInput       = document.getElementById('media-input');

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

function renderRooms(roomList) {
    allRooms = roomList || [];

    if (allRooms.length === 0) {
        roomsList.innerHTML = '<li class="list-empty">No rooms yet</li>';
        return;
    }

    roomsList.innerHTML = allRooms.map(r => `
        <li class="room-item ${r.id === currentRoomId ? 'room-item--active' : ''}"
            data-id="${escapeHtml(r.id)}">
            <span class="room-hash">#</span>
            <span>${escapeHtml(r.name)}</span>
        </li>`
    ).join('');

    roomsList.querySelectorAll('.room-item').forEach(li => {
        li.addEventListener('click', async () => {
            const id = li.dataset.id;
            const room = allRooms.find(r => r.id === id);
            if (!room || id === currentRoomId) return;
            if (connection?.state === signalR.HubConnectionState.Connected)
                await joinRoom(room.id, room.name);
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

const EMOJI_ONLY_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u;

function isEmojiOnly(str) {
    return str && EMOJI_ONLY_RE.test(str.trim()) && str.trim().length > 0;
}

function appendMessage(msg) {
    const isOwn = msg.sender === currentUser;
    const el = document.createElement('div');
    el.className = `msg msg--${isOwn ? 'own' : 'other'}`;

    let mediaHtml = '';
    if (msg.mediaUrl) {
        if (msg.mediaType === 'image') {
            mediaHtml = `<img class="msg__media-img" src="${escapeHtml(msg.mediaUrl)}" alt="image" loading="lazy" onclick="window.open(this.src)">`;
        } else if (msg.mediaType === 'video') {
            mediaHtml = `<video class="msg__media-video" src="${escapeHtml(msg.mediaUrl)}" controls></video>`;
        }
    }

    const emojiOnly = !msg.mediaUrl && isEmojiOnly(msg.content);
    const bubbleClass = `msg__bubble${emojiOnly ? ' msg__bubble--emoji-only' : ''}`;

    el.innerHTML = `
        ${!isOwn ? `<div class="msg__sender">${escapeHtml(msg.sender)}</div>` : ''}
        <div class="${bubbleClass}">
            ${mediaHtml}
            ${msg.content ? `<span>${escapeHtml(msg.content)}</span>` : ''}
        </div>
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

// ── Typing indicator ──────────────────────────────────────

function addTypingUser(username) {
    if (typingUsers.has(username)) clearTimeout(typingUsers.get(username));
    // Karşı taraf disconnect olursa 4 saniye sonra otomatik temizle
    const timer = setTimeout(() => removeTypingUser(username), 4000);
    typingUsers.set(username, timer);
    renderTypingIndicator();
}

function removeTypingUser(username) {
    if (!typingUsers.has(username)) return;
    clearTimeout(typingUsers.get(username));
    typingUsers.delete(username);
    renderTypingIndicator();
}

function clearTypingUsers() {
    typingUsers.forEach(timer => clearTimeout(timer));
    typingUsers.clear();
    renderTypingIndicator();
}

function renderTypingIndicator() {
    if (typingUsers.size === 0) {
        typingIndicator.textContent = '';
        return;
    }
    const names = [...typingUsers.keys()].join(', ');
    typingIndicator.textContent = typingUsers.size === 1
        ? `${names} yazıyor...`
        : `${names} yazıyor...`;
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
    connection.on('UpdateUsers', (users) => { onlineUsers = users; renderUsers(users); });
    connection.on('UserConnected', (username) => {
        if (!onlineUsers.includes(username)) { onlineUsers = [...onlineUsers, username]; renderUsers(onlineUsers); }
    });
    connection.on('UserDisconnected', (username) => {
        onlineUsers = onlineUsers.filter(u => u !== username); renderUsers(onlineUsers);
    });
    connection.on('UpdateRooms', renderRooms);
    connection.on('UserTyping', addTypingUser);
    connection.on('UserStoppedTyping', removeTypingUser);
    connection.on('RoomCreated', (room) => {
        allRooms = [...allRooms.filter(r => r.id !== room.id), room];
        renderRooms(allRooms);
    });

    connection.onreconnecting(() => { setStatus('reconnecting'); setInputEnabled(false); });

    connection.onreconnected(async () => {
        setStatus('connected');
        if (currentRoomId) await connection.invoke('JoinRoom', currentRoomId);
        setInputEnabled(!!currentRoomId);
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

async function createRoom() {
    const name = roomInput.value.trim();
    if (!name) { roomInput.focus(); return; }

    joinBtn.disabled = true;
    try {
        const resp = await fetch(`${API_BASE_URL}/api/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, createdById: CURRENT_USER_ID })
        });
        if (resp.ok) {
            roomInput.value = '';
            // RoomCreated eventi tüm clientlara gönderilir, liste otomatik güncellenir
        } else {
            console.error('Oda oluşturulamadı:', await resp.text());
        }
    } catch (err) {
        console.error('Ağ hatası:', err);
    } finally {
        joinBtn.disabled = false;
    }
}

async function joinRoom(roomId, roomName) {
    if (currentRoomId && currentRoomId !== roomId) {
        try { await connection.invoke('LeaveRoom', currentRoomId); } catch { /* ignore */ }
    }

    clearTypingUsers();
    await connection.invoke('JoinRoom', roomId);
    currentRoomId = roomId;
    currentRoomName = roomName;

    panelSetup.hidden = true;
    panelRoom.hidden = false;
    roomTag.textContent = `# ${roomName}`;
    chatOverlay.hidden = true;

    messages.innerHTML = '';
    try {
        const resp = await fetch(`${API_BASE_URL}/api/messages/${roomId}`);
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

    renderRooms(allRooms); // aktif odayı vurgulamak için yeniden render et
    setInputEnabled(true);
    messageInput.focus();
}

async function leaveRoom() {
    if (!currentRoomId) return;
    try { await connection.invoke('LeaveRoom', currentRoomId); } catch { /* ignore */ }

    currentRoomId = null;
    currentRoomName = null;
    messages.innerHTML = '';
    setInputEnabled(false);
    chatOverlay.hidden = false;
    panelRoom.hidden = true;
    panelSetup.hidden = false;
    renderRooms(allRooms);
}

// ── Send message ──────────────────────────────────────────

async function sendMessage() {
    const content = messageInput.value.trim();
    if (!content && !pendingMediaUrl) return;
    if (!currentRoomId || isSending) return;

    isSending = true;
    setInputEnabled(false);
    clearTimeout(typingTimer);
    if (currentRoomId) connection.invoke('StopTyping', currentRoomId).catch(() => {});

    try {
        const resp = await fetch(`${API_BASE_URL}/api/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sender: currentUser,
                content,
                roomId: currentRoomId,
                mediaUrl: pendingMediaUrl,
                mediaType: pendingMediaType
            })
        });
        if (resp.ok) {
            messageInput.value = '';
            clearPendingMedia();
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
    if (connection?.state !== signalR.HubConnectionState.Connected) return;
    await createRoom();
});

leaveBtn.addEventListener('click', leaveRoom);
sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('input', () => {
    if (!currentRoomId) return;

    connection.invoke('StartTyping', currentRoomId).catch(() => {});

    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        connection.invoke('StopTyping', currentRoomId).catch(() => {});
    }, 2000);
});

messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });

mediaInput.addEventListener('change', async () => {
    const file = mediaInput.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const resp = await fetch(`${API_BASE_URL}/api/uploads`, {
            method: 'POST',
            body: formData
        });
        if (resp.ok) {
            const { url, mediaType } = await resp.json();
            setPendingMedia(url, mediaType);
        } else {
            const err = await resp.json();
            console.error('Yükleme hatası:', err.error);
            alert(err.error);
        }
    } catch {
        console.error('Dosya yüklenemedi.');
    }
});

mediaRemoveBtn.addEventListener('click', clearPendingMedia);

// ── Sidebar toggle (mobile) ───────────────────────────────
const sidebarToggle   = document.getElementById('sidebar-toggle');
const sidebar         = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');

function openSidebar() {
    sidebar.classList.add('open');
    sidebarToggle.classList.add('open');
    sidebarBackdrop.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarToggle.classList.remove('open');
    sidebarBackdrop.classList.remove('visible');
    document.body.style.overflow = '';
}

sidebarToggle.addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
});

sidebarBackdrop.addEventListener('click', closeSidebar);

// Oda seçince mobilde sidebar kapansın
roomsList.addEventListener('click', () => {
    if (window.innerWidth <= 650) closeSidebar();
});

// ── Emoji Picker ──────────────────────────────────────────

const EMOJI_DATA = {
    '😀': ['Yüzler', ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😗','😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','🥴','😠','😡','🤬','😷','🤒','🤕','🤢','🤧','🥳','🥸','🤠','😈','👿','💀','💩','🤡','👹','👺','👻','👽','👾','🤖']],
    '👍': ['El & Beden', ['👍','👎','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👋','🤚','🖐️','✋','🖖','👏','🙌','🤲','🤝','🙏','✍️','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🫀','🫁','🧠','🦷','🦴','👁️','👀']],
    '❤️': ['Kalpler', ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','❤️‍🔥','❤️‍🩹','💔','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☯️','💋','💯','💢','💥','💫','💦','💨','🕳️','💬','💭','💤']],
    '🐶': ['Hayvanlar', ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🐘','🦏','🦛','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🪶','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔']],
    '🍎': ['Yiyecek', ['🍎','🍊','🍋','🍇','🍓','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🧄','🧅','🥔','🍠','🌽','🥕','🫛','🧆','🥚','🍳','🥘','🍲','🫕','🥣','🥗','🍿','🧈','🥞','🧇','🍖','🍗','🥩','🥓','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥫','🍝','🍜','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥮','🍢','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🧃','🥤','🧋','☕','🫖','🍵','🧉','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🍾']],
    '⚽': ['Spor & Aktivite', ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🏒','🥊','⛳','🎯','🎳','🏹','🎣','🤿','🎽','🎿','🛷','🥌','🏋️','⛹️','🤺','🤼','🤸','⛷️','🏂','🏊','🚣','🧘','🛹','🛷','🤾','🏌️','🏇','🧗','🏄','🚵','🚴','🤽']],
    '🌍': ['Seyahat & Yerler', ['🌍','🌎','🌏','🗺️','🧭','🏔️','⛰️','🌋','🗻','🏕️','🏖️','🏜️','🏝️','🏞️','🏟️','🏛️','🏗️','🧱','🏘️','🏚️','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🛕','🕍','⛩️','🕋','⛲','⛺','🌁','🌃','🌄','🌅','🌆','🌇','🌉','♨️','🎠','🎡','🎢','✈️','🚀','🛸','🚁','⛵','🚢','🚂','🚃','🚄','🚅','🚆','🚇','🚈','🚉','🚊','🚝','🚞','🚋','🚌','🚍','🚎','🚐','🚑','🚒','🚓','🚔','🚕','🚖','🚗','🚘','🚙','🛻','🚚','🚛','🚜','🏎️','🏍️','🛵','🦽','🦼','🛺','🚲','🛴','🛹','🛼','🚏','🛣️','🛤️','⛽','🚨','🚥','🚦','🚧','⚓']],
    '💡': ['Nesneler', ['💡','🔦','🕯️','🪔','💰','💴','💵','💸','💳','💎','⚖️','🧰','🔧','🪛','🔨','⛏️','⚙️','🗜️','🔩','🪤','🧲','💣','🔫','🪃','🛡️','🪚','🔪','🗡️','⚔️','🪜','🧲','🪣','🛁','🪠','🧺','🧹','🪤','🪣','🗑️','📦','📫','📬','📭','📮','🗳️','📝','📄','📃','📋','📁','📂','🗂️','📅','📆','🗒️','📇','📈','📉','📊','📌','📍','🗺️','📎','🖇️','✂️','🗃️','🗄️','🖨️','⌨️','🖱️','💾','💿','📀','📱','☎️','📞','📟','📠','📺','📷','📸','📹','🎥','📽️','🎞️','📡','🔋','🔌','💡','🔦','🕯️','🧯','🪙']],
    '🎉': ['Semboller & Etkinlik', ['🎉','🎊','🎈','🎁','🎀','🎗️','🎟️','🎫','🏆','🥇','🥈','🥉','🏅','🎖️','🎪','🤹','🎭','🎨','🎬','🎤','🎧','🎼','🎵','🎶','🎹','🥁','🪘','🎷','🎺','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🕹️','🧩','🧸','🪀','🪁','🃏','🀄','🎴','🔮','🪬','🧿','🪄','🧸','🎭','✨','🌟','⭐','🌠','🎇','🎆','🌈','☀️','🌤️','⛅','🌥️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄','🌬️','💧','💦','🌊','🌀','🌈','🌂','⛱️','⚡','🔥','💥','✨','🌸','🌺','🌼','🌻','🌹','🥀','🌷','🌱','🌿','☘️','🍀','🎋','🎍','🍃','🍂','🍁','🌾']]
};

const emojiBtn      = document.getElementById('emoji-btn');
const emojiPicker   = document.getElementById('emoji-picker');
const emojiGrid     = document.getElementById('emoji-grid');
const emojiSearch   = document.getElementById('emoji-search');
const emojiCats     = document.getElementById('emoji-categories');

let emojiOpen = false;
let activeCat = Object.keys(EMOJI_DATA)[0];

function buildCategoryBar() {
    emojiCats.innerHTML = Object.entries(EMOJI_DATA).map(([icon, [label]]) =>
        `<button class="emoji-cat-btn${icon === activeCat ? ' active' : ''}" data-cat="${icon}" title="${label}">${icon}</button>`
    ).join('');
    emojiCats.querySelectorAll('.emoji-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeCat = btn.dataset.cat;
            emojiSearch.value = '';
            emojiCats.querySelectorAll('.emoji-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderGrid(EMOJI_DATA[activeCat][1]);
        });
    });
}

function renderGrid(emojis) {
    emojiGrid.innerHTML = emojis.map(e =>
        `<button class="emoji-item" title="${e}">${e}</button>`
    ).join('');
    emojiGrid.querySelectorAll('.emoji-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const pos = messageInput.selectionStart ?? messageInput.value.length;
            const val = messageInput.value;
            messageInput.value = val.slice(0, pos) + btn.textContent + val.slice(pos);
            messageInput.setSelectionRange(pos + btn.textContent.length, pos + btn.textContent.length);
            messageInput.focus();
        });
    });
}

function openEmojiPicker() {
    emojiOpen = true;
    emojiBtn.classList.add('active');
    emojiPicker.hidden = false;
    buildCategoryBar();
    renderGrid(EMOJI_DATA[activeCat][1]);
    emojiSearch.value = '';
    emojiSearch.focus();
}

function closeEmojiPicker() {
    emojiOpen = false;
    emojiBtn.classList.remove('active');
    emojiPicker.hidden = true;
}

emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiOpen ? closeEmojiPicker() : openEmojiPicker();
});

emojiSearch.addEventListener('input', () => {
    const q = emojiSearch.value.trim().toLowerCase();
    if (!q) {
        renderGrid(EMOJI_DATA[activeCat][1]);
        return;
    }
    const allEmojis = Object.values(EMOJI_DATA).flatMap(([, list]) => list);
    renderGrid(allEmojis.filter(e => e.includes(q)));
});

document.addEventListener('click', (e) => {
    if (emojiOpen && !emojiPicker.contains(e.target) && e.target !== emojiBtn) {
        closeEmojiPicker();
    }
});

// ── Sayfa açılışında bağlan ───────────────────────────────
initConnection();
