const STORAGE_KEY = 'dimchat_split_front_v1';
const NAME_ALLOWED_RE = /^[A-Za-zА-Яа-яЁё0-9 _.-]{1,24}$/;
const REACTION_SET = ['😁', '😎', '😍', '😘', '😭', '🤯', '😱'];
const SUPPORT_USER = {
  username: 'Тех.Поддержка',
  publicKey: 'support',
  avatar: '1.png',
  createdAt: '',
  verified: false,
  online: null,
  lastSeenAt: ''
};

let state = loadState();
let currentUser = state.currentUser || null;
let plainSecret = state.plainSecret || '';
let currentChat = state.currentChat || null;
let theme = state.theme === 'dark' ? 'dark' : 'light';
let contacts = Array.isArray(state.contacts) ? state.contacts : [];
let groups = Array.isArray(state.groups) ? state.groups : [];
let messages = Array.isArray(state.messages) ? state.messages : [];
let replyToMessageId = null;
let highlightedMessageId = null;
let suppressDocumentClose = false;
let pendingImageDataUrl = '';
let originalPendingImageDataUrl = '';
let editorMode = 'draw';
let editorIsDrawing = false;
let editorBrushColor = '#ff2d55';
let editorBaseDataUrl = '';
let cropRect = null;
let cropStart = null;
let isSelectingCrop = false;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordStartedAt = 0;
let pendingVoiceDataUrl = '';
let pendingVoiceDuration = 0;
let contactSearch = '';
let currentProfileGroupId = null;

const registerScreen = document.getElementById('registerScreen');
const loginScreen = document.getElementById('loginScreen');
const appScreen = document.getElementById('appScreen');
const editorCanvas = document.getElementById('editorCanvas');
const editorCtx = editorCanvas.getContext('2d');

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ currentUser, plainSecret, currentChat, theme, contacts, groups, messages })
    );
  } catch (e) {
    console.error(e);
  }
}

function showStatus(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || '';
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function isValidBaseName(name) {
  return NAME_ALLOWED_RE.test(name);
}

function makePublicKey() {
  return Math.random().toString(36).slice(2, 7);
}

function makeSecretKey() {
  return Math.random().toString(36).slice(2, 12);
}

function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function initialsAvatar(name) {
  const first = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#60a5fa"/><stop offset="100%" stop-color="#e879f9"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="110" font-weight="700" fill="#ffffff">${first}</text></svg>`
    )
  );
}

function getDisplayName(user) {
  return user ? user.username + (user.verified ? ' ✅' : '') : '';
}

function isOnline(user) {
  return user?.online === true;
}

function touchCurrentUserOnline() {
  if (currentUser) {
    currentUser.online = true;
    currentUser.lastSeenAt = new Date().toISOString();
  }
}

function markCurrentUserOffline() {
  if (currentUser) {
    currentUser.online = false;
    currentUser.lastSeenAt = new Date().toISOString();
    saveState();
  }
}

function formatLastSeen(user) {
  if (!user) return '???';
  if (user.online === true) return 'в сети';
  if (user.online === false && user.lastSeenAt) {
    return 'был(а) в сети: ' + new Date(user.lastSeenAt).toLocaleString();
  }
  return '???';
}

function avatarHtml(src, online, sizeClass = 'mini-avatar') {
  return `<span class="avatar-wrap"><img class="${sizeClass}" src="${src}" alt="avatar">${
    online ? '<span class="online-dot"></span>' : ''
  }</span>`;
}

function getCurrentAvatar(user) {
  return user && user.avatar ? user.avatar : initialsAvatar(user?.username || '?');
}

function formatTime(dateIso) {
  const d = new Date(dateIso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + String(r).padStart(2, '0');
}

function makeWaveBars(seedText, count = 34) {
  const seed = String(seedText || 'voice');
  const arr = [];
  for (let i = 0; i < count; i += 1) {
    const code = seed.charCodeAt(i % seed.length) || 65;
    arr.push(26 + ((code * (i + 3)) % 70));
  }
  return arr;
}

function directChatId(a, b) {
  return [String(a || '').trim().toLowerCase(), String(b || '').trim().toLowerCase()].sort().join('__');
}

function getMessageStatus(msg) {
  if (msg.failed) return '🕒';
  const readers = Array.isArray(msg.readBy) ? msg.readBy.filter(Boolean) : [];
  if (msg.chatType === 'group') {
    const g = groups.find(x => String(x.id) === String(msg.chatId));
    const totalMembers = Math.max(1, g?.memberKeys?.length || 1);
    const totalOthers = Math.max(0, totalMembers - 1);
    if (totalOthers === 0) return '✓✓';
    if (readers.length >= totalOthers) return '✓✓';
    if (readers.length >= 1) return '✓';
    return '';
  }
  return readers.length ? '✓' : '';
}

function updateMobileLayout() {
  if (window.innerWidth > 760) {
    document.body.classList.remove('mobile-sidebar-open', 'mobile-chat-open');
    return;
  }
  if (currentChat) {
    document.body.classList.add('mobile-chat-open');
    document.body.classList.remove('mobile-sidebar-open');
  } else {
    document.body.classList.add('mobile-sidebar-open');
    document.body.classList.remove('mobile-chat-open');
  }
}

function applyTheme() {
  document.body.classList.toggle('theme-dark', theme === 'dark');
  document.getElementById('themeBtn').textContent = theme === 'dark' ? '☀' : '☾';
  document.getElementById('themeText').innerHTML =
    theme === 'dark'
      ? 'смена режима со<br>тёмного на светлый'
      : 'смена режима со<br>светлого на тёмный';
  updateMobileLayout();
}

function show(screen) {
  registerScreen.classList.add('hidden');
  loginScreen.classList.add('hidden');
  appScreen.classList.add('hidden');
  screen.classList.remove('hidden');
  applyTheme();
}

function showModal(id, visible) {
  document.getElementById(id).classList.toggle('hidden', !visible);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function setImagePreview(src) {
  const wrap = document.getElementById('imagePreviewWrap');
  const img = document.getElementById('imagePreview');
  pendingImageDataUrl = src || '';
  if (!src) {
    wrap.classList.remove('show');
    img.removeAttribute('src');
    return;
  }
  img.src = src;
  wrap.classList.add('show');
}

function getMessageById(id) {
  return messages.find(m => String(m.id) === String(id)) || null;
}

function getReplySnippet(m) {
  if (!m) return '';
  if (m.voice) return '[голосовое сообщение]';
  const t = m.text ? m.text.slice(0, 80) : m.image ? '[изображение]' : '';
  return t || '[пусто]';
}

function setReplyPreview(id) {
  replyToMessageId = id;
  const p = document.getElementById('replyPreview');
  const m = getMessageById(id);
  if (!m) {
    p.classList.add('hidden');
    p.innerHTML = '';
    return;
  }
  p.classList.remove('hidden');
  p.innerHTML = '<b>Ответ на:</b> ' + escapeHtml(getReplySnippet(m));
}

function clearReplyPreview() {
  replyToMessageId = null;
  const p = document.getElementById('replyPreview');
  p.classList.add('hidden');
  p.innerHTML = '';
}

function groupedReactions(msg) {
  const list = Array.isArray(msg.reactions) ? msg.reactions : [];
  const map = new Map();
  for (const r of list) map.set(r.emoji, (map.get(r.emoji) || 0) + 1);
  return Array.from(map.entries());
}

function ensureSupport() {
  if (
    currentUser &&
    currentUser.publicKey !== 'support' &&
    !contacts.some(c => (c.publicKey || '').toLowerCase() === 'support')
  ) {
    contacts.push({ ...SUPPORT_USER, createdAt: new Date().toISOString() });
  }
}

function currentMessages() {
  if (!currentUser || !currentChat) return [];
  return currentChat.type === 'self'
    ? messages.filter(m => m.chatType === 'self' && String(m.chatId) === String(currentUser.publicKey))
    : messages.filter(m => m.chatType === currentChat.type && String(m.chatId) === String(currentChat.id));
}

function markCurrentChatRead() {
  if (!currentUser || !currentChat) return;
  let changed = false;
  currentMessages().forEach(msg => {
    if (msg.sender?.publicKey === currentUser.publicKey) return;
    if (!Array.isArray(msg.readBy)) msg.readBy = [];
    if (!msg.readBy.includes(currentUser.publicKey)) {
      msg.readBy.push(currentUser.publicKey);
      changed = true;
    }
  });
  if (changed) saveState();
}

function renderSidebar() {
  if (!currentUser) return;
  ensureSupport();
  document.getElementById('publicInfo').innerHTML = 'ключ: ' + escapeHtml(currentUser.publicKey);
  document.getElementById('mobileSidebarAvatar').src = getCurrentAvatar(currentUser);
  document.getElementById('mobileSidebarOnlineDot').classList.toggle('hidden', !isOnline(currentUser));
  document.getElementById('mobileSidebarKey').textContent = currentUser.publicKey;

  const q = (contactSearch || '').trim().toLowerCase();
  const items = [
    {
      type: 'self',
      id: currentUser.publicKey,
      title: getDisplayName(currentUser),
      subtitle: 'избранное',
      avatar: getCurrentAvatar(currentUser),
      online: isOnline(currentUser)
    }
  ];

  for (const user of contacts) {
    const item = {
      type: 'direct',
      id: directChatId(currentUser.publicKey, user.publicKey),
      title: getDisplayName(user),
      subtitle: isOnline(user) ? 'в сети' : '???',
      avatar: getCurrentAvatar(user),
      online: isOnline(user)
    };
    if (!q || item.title.toLowerCase().includes(q) || String(user.publicKey || '').toLowerCase().includes(q)) {
      items.push(item);
    }
  }

  for (const group of groups) {
    const item = {
      type: 'group',
      id: String(group.id),
      title: group.name,
      subtitle: 'группа',
      avatar: group.avatar || initialsAvatar(group.name),
      online: false
    };
    if (!q || item.title.toLowerCase().includes(q)) items.push(item);
  }

  const list = document.getElementById('contactList');
  list.innerHTML = items
    .map(
      item =>
        `<div class="list-item ${
          currentChat && currentChat.type === item.type && String(currentChat.id) === String(item.id) ? 'active' : ''
        }" data-type="${item.type}" data-id="${escapeHtml(item.id)}">${avatarHtml(item.avatar, !!item.online)}<div><div class="item-title">${escapeHtml(
          item.title
        )}</div><div class="item-sub">${escapeHtml(item.subtitle)}</div></div></div>`
    )
    .join('');

  list.querySelectorAll('.list-item').forEach(el => {
    el.onclick = () => {
      currentChat = { type: el.dataset.type, id: el.dataset.id };
      saveState();
      renderSidebar();
      renderCurrentChat();
      markCurrentChatRead();
      updateMobileLayout();
    };
  });
}

function chatHeaderData() {
  if (!currentChat) return null;
  if (currentChat.type === 'self') {
    return {
      title: getDisplayName(currentUser),
      avatar: getCurrentAvatar(currentUser),
      online: isOnline(currentUser),
      canLeave: false
    };
  }
  if (currentChat.type === 'group') {
    const g = groups.find(x => String(x.id) === String(currentChat.id));
    if (!g) return null;
    return { title: g.name, avatar: g.avatar || initialsAvatar(g.name), online: false, canLeave: true };
  }
  const peer = contacts.find(c => directChatId(currentUser.publicKey, c.publicKey) === String(currentChat.id));
  if (!peer) return null;
  return { title: getDisplayName(peer), avatar: getCurrentAvatar(peer), online: isOnline(peer), canLeave: false };
}

function openProfileForUser(user) {
  if (!user) return;
  currentProfileGroupId = null;
  document.getElementById('profileAvatar').src = getCurrentAvatar(user);
  document.getElementById('profileName').textContent = getDisplayName(user);
  document.getElementById('profileStatus').textContent = formatLastSeen(user);
  document.getElementById('profileOnlineDot').classList.toggle('hidden', !isOnline(user));
  document.getElementById('profileKey').textContent = 'Публичный ключ: ' + (user.publicKey || '—');
  document.getElementById('profileDate').textContent =
    'Дата создания: ' + (user.createdAt ? new Date(user.createdAt).toLocaleString() : 'неизвестно');
  const members = document.getElementById('profileMembers');
  members.classList.add('hidden');
  members.innerHTML = '';
  showModal('userProfileModal', true);
}

function removeGroupMember(memberKey) {
  if (!currentProfileGroupId) return;
  const g = groups.find(x => String(x.id) === String(currentProfileGroupId));
  if (!g) return;
  g.memberKeys = (Array.isArray(g.memberKeys) && g.memberKeys.length ? g.memberKeys : [currentUser.publicKey]).filter(
    k => k !== memberKey
  );
  saveState();
  openCurrentHeaderProfile();
  renderSidebar();
  renderCurrentChat();
}

function openCurrentHeaderProfile() {
  if (!currentChat) return;
  if (currentChat.type === 'self') return openProfileForUser(currentUser);
  if (currentChat.type === 'direct') {
    const peer = contacts.find(c => directChatId(currentUser.publicKey, c.publicKey) === String(currentChat.id));
    if (peer) return openProfileForUser(peer);
    return;
  }
  const group = groups.find(g => String(g.id) === String(currentChat.id));
  if (!group) return;
  currentProfileGroupId = String(group.id);
  document.getElementById('profileAvatar').src = group.avatar || initialsAvatar(group.name);
  document.getElementById('profileName').textContent = group.name;
  document.getElementById('profileStatus').textContent = 'группа';
  document.getElementById('profileOnlineDot').classList.add('hidden');
  document.getElementById('profileKey').textContent = 'Группа';
  document.getElementById('profileDate').textContent =
    'Дата создания: ' + (group.createdAt ? new Date(group.createdAt).toLocaleString() : 'неизвестно');
  const members = document.getElementById('profileMembers');
  const keys = Array.isArray(group.memberKeys) && group.memberKeys.length ? group.memberKeys : [currentUser.publicKey];
  members.classList.remove('hidden');
  members.innerHTML =
    '<div style="font-weight:800;">Участники</div>' +
    keys
      .map(key => {
        const user =
          key === currentUser.publicKey
            ? currentUser
            : contacts.find(c => c.publicKey === key) ||
              (key === 'support'
                ? SUPPORT_USER
                : { username: key, publicKey: key, avatar: '', createdAt: '', verified: false, online: null, lastSeenAt: '' });
        return `<div class="member-row"><div class="member-left">${avatarHtml(getCurrentAvatar(user), !!isOnline(user))}<div><div style="font-weight:800;">${escapeHtml(
          getDisplayName(user) || key
        )}</div><div style="font-size:14px;color:var(--muted);">${escapeHtml(key)}</div></div></div>${
          key !== currentUser.publicKey ? `<button class="member-remove" data-remove-member="${escapeHtml(key)}">убрать</button>` : ''
        }</div>`;
      })
      .join('');
  members.querySelectorAll('[data-remove-member]').forEach(btn => {
    btn.onclick = () => removeGroupMember(btn.dataset.removeMember);
  });
  showModal('userProfileModal', true);
}

function scrollToMessage(messageId) {
  const el = document.getElementById('msg-' + messageId);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  highlightedMessageId = messageId;
  renderCurrentChat();
  setTimeout(() => {
    highlightedMessageId = null;
    renderCurrentChat();
  }, 1600);
}

function renderCurrentChat() {
  const head = chatHeaderData();
  const chatAvatar = document.getElementById('chatAvatar');
  const chatTitle = document.getElementById('chatTitle');
  const leaveBtn = document.getElementById('leaveChatBtn');
  const chatArea = document.getElementById('chatArea');

  if (!head) {
    chatAvatar.src = initialsAvatar('?');
    chatTitle.textContent = 'Чат';
    document.getElementById('chatOnlineDot').classList.add('hidden');
    leaveBtn.classList.add('hidden');
    chatArea.innerHTML = '<div class="empty-state">Открой чат, чтобы общаться</div>';
    return;
  }

  chatAvatar.src = head.avatar;
  chatTitle.textContent = head.title;
  document.getElementById('chatOnlineDot').classList.toggle('hidden', !head.online);
  leaveBtn.classList.toggle('hidden', !head.canLeave);

  const list = currentMessages();
  if (!list.length) {
    chatArea.innerHTML = '';
    return;
  }

  chatArea.innerHTML = list
    .map(msg => {
      const isMe = msg.sender && msg.sender.publicKey === currentUser.publicKey;
      const replyMsg = msg.replyToMessageId ? getMessageById(msg.replyToMessageId) : null;
      const img = msg.image
        ? `<div style="margin-bottom:10px"><img src="${msg.image}" style="max-width:100%;max-height:700px;height:auto;border:3px solid var(--line);border-radius:16px" alt="img"></div>`
        : '';
      const voice = msg.voice
        ? (() => {
            const bars = makeWaveBars(msg.id);
            return `<div class="voice-bubble"><audio class="voice-player" id="audio-${msg.id}" src="${msg.voice}"></audio><div class="voice-top"><button class="voice-play" data-audio-play="${msg.id}">▶</button><div class="voice-wave">${bars
              .map(h => `<div class="voice-bar" style="height:${h}px"></div>`)
              .join('')}</div></div><div class="voice-time">${escapeHtml(formatDuration(msg.voiceDuration || 0))} (длина аудио)</div></div>`;
          })()
        : '';
      const replyBlock = replyMsg
        ? `<div class="reply-chip" data-jump="${replyMsg.id}"><b>предыдущее:</b> ${escapeHtml(getReplySnippet(replyMsg))}</div>`
        : '';
      const reactions = groupedReactions(msg);
      const reactionsHtml = reactions.length
        ? `<div class="reactions-row">${reactions
            .map(([emoji, count]) => `<button class="reaction-chip" data-react-message="${msg.id}" data-react-emoji="${emoji}">${emoji} ${count}</button>`)
            .join('')}</div>`
        : '';

      return `<div id="msg-wrap-${msg.id}" class="message-wrap ${isMe ? 'me' : ''}"><div id="msg-${msg.id}" class="message ${
        highlightedMessageId === msg.id ? 'reply-target' : ''
      } ${isMe ? 'me' : ''}" data-msgid="${msg.id}"><div class="msg-top"><span class="msg-user-name" data-userid="${msg.id}">${escapeHtml(
        msg.sender ? getDisplayName(msg.sender) : 'user'
      )}</span>${isMe ? `<button class="msg-del" data-del="${msg.id}">удалить</button>` : `<span>${formatTime(msg.createdAt)}</span>`}</div>${replyBlock}${img}${voice}<div>${
        msg.voice ? '' : escapeHtml(msg.text || '')
      }</div>${isMe ? `<div class="msg-meta"><span>${formatTime(msg.createdAt)}</span><span class="msg-checks">${getMessageStatus(msg)}</span></div>` : ''}</div>${reactionsHtml}</div>`;
    })
    .join('');

  chatArea.querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = () => {
      messages = messages.filter(m => String(m.id) !== String(btn.dataset.del));
      saveState();
      renderCurrentChat();
    };
  });

  chatArea.querySelectorAll('[data-jump]').forEach(btn => {
    btn.onclick = () => scrollToMessage(btn.dataset.jump);
  });

  chatArea.querySelectorAll('[data-msgid]').forEach(el => {
    el.ondblclick = () => openActionsMenu(el.dataset.msgid);
    el.oncontextmenu = e => {
      e.preventDefault();
      openReactionPicker(el.dataset.msgid);
    };
    let pressTimer = null;
    el.onpointerdown = () => {
      pressTimer = setTimeout(() => openReactionPicker(el.dataset.msgid), 450);
    };
    el.onpointerup = () => {
      if (pressTimer) clearTimeout(pressTimer);
    };
    el.onpointerleave = () => {
      if (pressTimer) clearTimeout(pressTimer);
    };
  });

  chatArea.querySelectorAll('[data-userid]').forEach(el => {
    el.onclick = e => {
      e.stopPropagation();
      const msg = getMessageById(el.dataset.userid);
      if (msg?.sender) openProfileForUser(msg.sender);
    };
  });

  chatArea.querySelectorAll('[data-react-message]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const msg = getMessageById(btn.dataset.reactMessage);
      if (!msg) return;
      const emoji = btn.dataset.reactEmoji;
      const current = Array.isArray(msg.reactions)
        ? msg.reactions.find(r => r.userPublicKey === currentUser.publicKey)
        : null;
      msg.reactions = Array.isArray(msg.reactions) ? msg.reactions.filter(r => r.userPublicKey !== currentUser.publicKey) : [];
      if (!current || current.emoji !== emoji) {
        msg.reactions.push({ userPublicKey: currentUser.publicKey, emoji });
      }
      saveState();
      renderCurrentChat();
    };
  });

  chatArea.querySelectorAll('[data-audio-play]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const audio = document.getElementById('audio-' + btn.dataset.audioPlay);
      if (!audio) return;
      if (audio.paused) {
        document.querySelectorAll('.voice-player').forEach(a => {
          if (a !== audio) a.pause();
        });
        document.querySelectorAll('[data-audio-play]').forEach(b => {
          if (b !== btn) b.textContent = '▶';
        });
        audio.play();
        btn.textContent = '⏸';
      } else {
        audio.pause();
        btn.textContent = '▶';
      }
      audio.onended = () => {
        btn.textContent = '▶';
      };
    };
  });

  chatArea.scrollTop = chatArea.scrollHeight;
}

function openActionsMenu(messageId) {
  document.querySelectorAll('.message-actions-menu,.reaction-picker').forEach(el => el.remove());
  const msg = getMessageById(messageId);
  if (!msg) return;
  const holder = document.getElementById('msg-wrap-' + messageId);
  if (!holder) return;
  const menu = document.createElement('div');
  menu.className = 'message-actions-menu';

  if (msg.sender?.publicKey === currentUser.publicKey) {
    const del = document.createElement('button');
    del.className = 'action-pill delete';
    del.textContent = 'удалить';
    del.onclick = e => {
      e.stopPropagation();
      messages = messages.filter(m => String(m.id) !== String(messageId));
      saveState();
      renderCurrentChat();
    };
    menu.appendChild(del);

    const edit = document.createElement('button');
    edit.className = 'action-pill edit';
    edit.textContent = 'изменить';
    edit.onclick = e => {
      e.stopPropagation();
      const updated = prompt('Измени сообщение', msg.text || '');
      if (updated === null) return;
      msg.text = updated.trim();
      saveState();
      renderCurrentChat();
    };
    menu.appendChild(edit);
  }

  const reply = document.createElement('button');
  reply.className = 'action-pill reply';
  reply.textContent = 'ответить';
  reply.onclick = e => {
    e.stopPropagation();
    setReplyPreview(messageId);
    menu.remove();
  };
  menu.appendChild(reply);
  holder.appendChild(menu);
}

function openReactionPicker(messageId) {
  document.querySelectorAll('.reaction-picker,.message-actions-menu').forEach(el => el.remove());
  const holder = document.getElementById('msg-wrap-' + messageId);
  if (!holder) return;
  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  REACTION_SET.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'reaction-option';
    btn.textContent = emoji;
    btn.onclick = e => {
      e.stopPropagation();
      const msg = getMessageById(messageId);
      if (!msg) return;
      const current = Array.isArray(msg.reactions)
        ? msg.reactions.find(r => r.userPublicKey === currentUser.publicKey)
        : null;
      msg.reactions = Array.isArray(msg.reactions) ? msg.reactions.filter(r => r.userPublicKey !== currentUser.publicKey) : [];
      if (!current || current.emoji !== emoji) {
        msg.reactions.push({ userPublicKey: currentUser.publicKey, emoji });
      }
      saveState();
      renderCurrentChat();
    };
    picker.appendChild(btn);
  });
  holder.appendChild(picker);
  suppressDocumentClose = true;
  setTimeout(() => {
    suppressDocumentClose = false;
  }, 0);
}

async function registerUser() {
  const name = normalizeName(document.getElementById('registerName').value);
  const avatarFile = document.getElementById('registerAvatar').files?.[0] || null;
  if (!name) {
    showStatus('authStatus', 'введи имя');
    return;
  }
  if (!isValidBaseName(name)) {
    showStatus('authStatus', 'в имени нельзя использовать эмодзи');
    return;
  }
  let avatar = '';
  if (avatarFile) avatar = await readFileAsDataUrl(avatarFile);
  currentUser = {
    username: name,
    publicKey: makePublicKey(),
    avatar,
    createdAt: new Date().toISOString(),
    verified: false,
    online: true,
    lastSeenAt: new Date().toISOString()
  };
  plainSecret = makeSecretKey();
  currentChat = { type: 'self', id: currentUser.publicKey };
  ensureSupport();
  saveState();
  document.getElementById('keysText').innerHTML =
    'ключ доступа: ' + escapeHtml(currentUser.publicKey) + '<br>пароль: ' + escapeHtml(plainSecret);
  document.getElementById('registerKeysCard').classList.remove('hidden');
  document.getElementById('registerHint').classList.add('hidden');
}

function loginUser() {
  showStatus('loginStatus', 'без backend вход по старым ключам недоступен');
}

function addContact() {
  const key = document.getElementById('addContactInput').value.trim();
  if (!key) return;
  if (currentUser && key.toLowerCase() === currentUser.publicKey.toLowerCase()) return alert('нельзя добавить себя');
  let user = null;
  if (key.toLowerCase() === 'support') {
    user = { ...SUPPORT_USER, createdAt: new Date().toISOString() };
  } else {
    user = contacts.find(c => (c.publicKey || '').toLowerCase() === key.toLowerCase()) || null;
  }
  if (!user) return alert('пользователь не найден');
  if (!contacts.some(c => (c.publicKey || '').toLowerCase() === user.publicKey.toLowerCase())) {
    contacts.push(user);
  }
  document.getElementById('addContactInput').value = '';
  showModal('addContactModal', false);
  saveState();
  renderSidebar();
}

async function createGroup() {
  const name = document.getElementById('groupNameInput').value.trim();
  if (!name) return alert('введи название');
  const avatarFile = document.getElementById('groupAvatarInput').files?.[0] || null;
  let avatar = '';
  if (avatarFile) avatar = await readFileAsDataUrl(avatarFile);
  const memberKeys = [
    currentUser.publicKey,
    ...document
      .getElementById('groupMembersInput')
      .value.split(',')
      .map(v => v.trim())
      .filter(Boolean)
      .filter(v => v !== currentUser.publicKey)
  ];
  const group = { id: String(Date.now()), name, avatar, createdAt: new Date().toISOString(), memberKeys };
  groups.unshift(group);
  currentChat = { type: 'group', id: String(group.id) };
  document.getElementById('groupNameInput').value = '';
  document.getElementById('groupMembersInput').value = '';
  document.getElementById('groupAvatarInput').value = '';
  document.getElementById('groupAvatarPreview').src = initialsAvatar('?');
  showModal('groupModal', false);
  saveState();
  renderSidebar();
  renderCurrentChat();
  updateMobileLayout();
}

function leaveCurrentChat() {
  if (!currentChat || currentChat.type !== 'group') return;
  currentChat = null;
  saveState();
  renderSidebar();
  renderCurrentChat();
  updateMobileLayout();
}

function logoutAccount() {
  currentUser = null;
  plainSecret = '';
  currentChat = null;
  contacts = [];
  groups = [];
  messages = [];
  saveState();
  show(registerScreen);
  updateMobileLayout();
}

function redrawEditor() {
  if (!editorBaseDataUrl) return;
  const img = new Image();
  img.onload = () => {
    editorCanvas.width = img.width;
    editorCanvas.height = img.height;
    editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
    editorCtx.drawImage(img, 0, 0);
    if (cropRect) {
      editorCtx.save();
      editorCtx.strokeStyle = '#00aaff';
      editorCtx.lineWidth = Math.max(3, editorCanvas.width * 0.004);
      editorCtx.setLineDash([12, 8]);
      editorCtx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
      editorCtx.restore();
    }
  };
  img.src = editorBaseDataUrl;
}

function openImageEditor(mode) {
  if (!pendingImageDataUrl) return;
  editorMode = mode || 'draw';
  editorBaseDataUrl = pendingImageDataUrl;
  cropRect = null;
  redrawEditor();
  showModal('imageEditorModal', true);
}

function editorPointerPos(evt) {
  const rect = editorCanvas.getBoundingClientRect();
  const scaleX = editorCanvas.width / rect.width;
  const scaleY = editorCanvas.height / rect.height;
  return { x: (evt.clientX - rect.left) * scaleX, y: (evt.clientY - rect.top) * scaleY };
}

function startEditorAction(evt) {
  evt.preventDefault();
  const p = editorPointerPos(evt);
  if (editorMode === 'draw') {
    editorIsDrawing = true;
    editorCtx.lineCap = 'round';
    editorCtx.lineJoin = 'round';
    editorCtx.lineWidth = Math.max(6, editorCanvas.width * 0.008);
    editorCtx.strokeStyle = editorBrushColor;
    editorCtx.beginPath();
    editorCtx.moveTo(p.x, p.y);
  } else {
    isSelectingCrop = true;
    cropStart = p;
    cropRect = { x: p.x, y: p.y, w: 1, h: 1 };
    redrawEditor();
  }
}

function moveEditorAction(evt) {
  const p = editorPointerPos(evt);
  if (editorMode === 'draw' && editorIsDrawing) {
    evt.preventDefault();
    editorCtx.lineTo(p.x, p.y);
    editorCtx.stroke();
  } else if (editorMode === 'crop' && isSelectingCrop) {
    evt.preventDefault();
    cropRect = {
      x: Math.min(cropStart.x, p.x),
      y: Math.min(cropStart.y, p.y),
      w: Math.abs(p.x - cropStart.x),
      h: Math.abs(p.y - cropStart.y)
    };
    redrawEditor();
  }
}

function endEditorAction() {
  if (editorMode === 'draw' && editorIsDrawing) {
    editorIsDrawing = false;
    editorBaseDataUrl = editorCanvas.toDataURL('image/png');
  }
  if (editorMode === 'crop' && isSelectingCrop) {
    isSelectingCrop = false;
    redrawEditor();
  }
}

function applyFreeCrop() {
  if (!cropRect || cropRect.w < 5 || cropRect.h < 5) return;
  const temp = document.createElement('canvas');
  temp.width = Math.round(cropRect.w);
  temp.height = Math.round(cropRect.h);
  temp.getContext('2d').drawImage(
    editorCanvas,
    cropRect.x,
    cropRect.y,
    cropRect.w,
    cropRect.h,
    0,
    0,
    temp.width,
    temp.height
  );
  editorCanvas.width = temp.width;
  editorCanvas.height = temp.height;
  editorCtx.clearRect(0, 0, temp.width, temp.height);
  editorCtx.drawImage(temp, 0, 0);
  editorBaseDataUrl = editorCanvas.toDataURL('image/png');
  cropRect = null;
  redrawEditor();
}

async function sendMessage(voiceDataUrl = '', voiceDuration = 0) {
  if (!currentUser || !currentChat) return;
  const input = document.getElementById('messageInput');
  const fileInput = document.getElementById('messageImageInput');
  const text = input.value.trim();
  const file = fileInput.files?.[0] || null;
  if (!text && !pendingImageDataUrl && !file && !voiceDataUrl) return;
  let image = '';
  if (pendingImageDataUrl) image = pendingImageDataUrl;
  else if (file) image = await readFileAsDataUrl(file);
  messages.push({
    id: uid('msg'),
    chatType: currentChat.type,
    chatId: currentChat.type === 'self' ? currentUser.publicKey : currentChat.id,
    sender: { ...currentUser },
    text: voiceDataUrl ? '' : text,
    image: voiceDataUrl ? '' : image,
    voice: voiceDataUrl || '',
    voiceDuration: Number(voiceDuration) || 0,
    replyToMessageId,
    reactions: [],
    readBy: currentChat.type === 'self' ? [currentUser.publicKey] : [],
    failed: false,
    createdAt: new Date().toISOString()
  });
  input.value = '';
  fileInput.value = '';
  pendingImageDataUrl = '';
  originalPendingImageDataUrl = '';
  setImagePreview('');
  clearReplyPreview();
  saveState();
  renderCurrentChat();
}

function openVoicePreview(dataUrl, duration) {
  pendingVoiceDataUrl = dataUrl || '';
  pendingVoiceDuration = Number(duration) || 0;
  const p = document.getElementById('voicePreviewPlayer');
  p.src = pendingVoiceDataUrl;
  p.currentTime = 0;
  showModal('voicePreviewModal', true);
}

async function toggleVoiceRecording() {
  const btn = document.getElementById('voiceRecordBtn');
  if (isRecording && mediaRecorder) {
    mediaRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    recordStartedAt = Date.now();
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => {
      if (e.data.size) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      const duration = (Date.now() - recordStartedAt) / 1000;
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const dataUrl = await blobToDataUrl(blob);
      stream.getTracks().forEach(t => t.stop());
      isRecording = false;
      btn.textContent = '🎤';
      openVoicePreview(dataUrl, duration);
    };
    mediaRecorder.start();
    isRecording = true;
    btn.textContent = '⏹';
  } catch {
    /* ignore */
  }
}

document.addEventListener('click', e => {
  if (suppressDocumentClose) return;
  if (!e.target.closest('.message-actions-menu') && !e.target.closest('.reaction-picker') && !e.target.closest('[data-msgid]')) {
    document.querySelectorAll('.message-actions-menu,.reaction-picker').forEach(el => el.remove());
  }
});

document.addEventListener('paste', async e => {
  if (!currentUser || appScreen.classList.contains('hidden')) return;
  const items = e.clipboardData?.items ? Array.from(e.clipboardData.items) : [];
  const imageItem = items.find(item => item.type && item.type.startsWith('image/'));
  if (!imageItem) return;
  const file = imageItem.getAsFile();
  if (!file) return;
  e.preventDefault();
  const dataUrl = await readFileAsDataUrl(file);
  originalPendingImageDataUrl = dataUrl;
  setImagePreview(dataUrl);
});

window.addEventListener('beforeunload', markCurrentUserOffline);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) markCurrentUserOffline();
  else if (currentUser) {
    touchCurrentUserOnline();
    saveState();
    renderSidebar();
    renderCurrentChat();
  }
});

document.getElementById('registerAvatarPreview').src = initialsAvatar('?');
document.getElementById('groupAvatarPreview').src = initialsAvatar('?');

document.getElementById('registerAvatar').onchange = async e => {
  const file = e.target.files?.[0] || null;
  document.getElementById('registerAvatarPreview').src = file ? await readFileAsDataUrl(file) : initialsAvatar('?');
};

document.getElementById('groupAvatarInput').onchange = async e => {
  const file = e.target.files?.[0] || null;
  document.getElementById('groupAvatarPreview').src = file ? await readFileAsDataUrl(file) : initialsAvatar('?');
};

document.getElementById('messageImageInput').onchange = async e => {
  const file = e.target.files?.[0] || null;
  if (!file) {
    pendingImageDataUrl = '';
    originalPendingImageDataUrl = '';
    setImagePreview('');
    return;
  }
  const data = await readFileAsDataUrl(file);
  originalPendingImageDataUrl = data;
  setImagePreview(data);
};

document.getElementById('removePreviewImage').onclick = () => {
  document.getElementById('messageImageInput').value = '';
  pendingImageDataUrl = '';
  originalPendingImageDataUrl = '';
  setImagePreview('');
};

document.getElementById('editImageBtn').onclick = () => {
  document.getElementById('openEditorHelpVideoBtn').classList.remove('hidden');
  openImageEditor('draw');
};

document.getElementById('cropImageBtn').onclick = () => {
  document.getElementById('openEditorHelpVideoBtn').classList.remove('hidden');
  openImageEditor('crop');
};

document.getElementById('editorDrawMode').onclick = () => {
  editorMode = 'draw';
  cropRect = null;
  redrawEditor();
};

document.getElementById('editorCropFree').onclick = () => {
  editorMode = 'crop';
  cropRect = null;
  redrawEditor();
};

document.getElementById('editorColorPicker').oninput = e => {
  editorBrushColor = e.target.value || '#ff2d55';
};

document.getElementById('editorApplyCrop').onclick = () => applyFreeCrop();
document.getElementById('editorReset').onclick = () => {
  editorBaseDataUrl = originalPendingImageDataUrl || pendingImageDataUrl;
  cropRect = null;
  redrawEditor();
};
document.getElementById('editorApply').onclick = () => {
  const out = editorCanvas.toDataURL('image/png');
  pendingImageDataUrl = out;
  setImagePreview(out);
  showModal('imageEditorModal', false);
};
document.getElementById('editorCancel').onclick = () => showModal('imageEditorModal', false);
editorCanvas.addEventListener('pointerdown', startEditorAction);
editorCanvas.addEventListener('pointermove', moveEditorAction);
editorCanvas.addEventListener('pointerup', endEditorAction);
editorCanvas.addEventListener('pointerleave', endEditorAction);

document.getElementById('openHelpVideoBtn').onclick = () => showModal('helpVideoModal', true);
document.getElementById('closeHelpVideoModal').onclick = () => showModal('helpVideoModal', false);
document.getElementById('openEditorHelpVideoBtn').onclick = () => showModal('editorHelpVideoModal', true);
document.getElementById('closeEditorHelpVideoModal').onclick = () => showModal('editorHelpVideoModal', false);

document.getElementById('voiceRecordBtn').onclick = toggleVoiceRecording;
document.getElementById('voicePreviewSend').onclick = () => {
  const data = pendingVoiceDataUrl;
  const duration = pendingVoiceDuration;
  pendingVoiceDataUrl = '';
  pendingVoiceDuration = 0;
  showModal('voicePreviewModal', false);
  sendMessage(data, duration);
};
document.getElementById('voicePreviewCancel').onclick = () => {
  pendingVoiceDataUrl = '';
  pendingVoiceDuration = 0;
  showModal('voicePreviewModal', false);
};

document.getElementById('registerBtn').onclick = registerUser;
document.getElementById('loginBtn').onclick = loginUser;
document.getElementById('goLogin').onclick = () => show(loginScreen);
document.getElementById('goRegister').onclick = () => show(registerScreen);
document.getElementById('keysOkBtn').onclick = () => {
  document.getElementById('registerKeysCard').classList.add('hidden');
  document.getElementById('registerHint').classList.remove('hidden');
  renderSidebar();
  renderCurrentChat();
  markCurrentChatRead();
  show(appScreen);
  updateMobileLayout();
};

document.getElementById('showPasswordLink').onclick = () => {
  document.getElementById('passwordModalText').textContent = plainSecret || 'пароль скрыт';
  showModal('passwordModal', true);
};

document.getElementById('openChangePasswordBtn').onclick = () => {
  showModal('passwordModal', false);
  document.getElementById('oldPasswordInput').value = '';
  document.getElementById('newPasswordInput').value = '';
  document.getElementById('repeatNewPasswordInput').value = '';
  showStatus('changePasswordStatus', '');
  showModal('changePasswordModal', true);
};

document.getElementById('saveNewPasswordBtn').onclick = () => {
  const oldP = document.getElementById('oldPasswordInput').value;
  const newP = document.getElementById('newPasswordInput').value;
  const rep = document.getElementById('repeatNewPasswordInput').value;
  if (oldP !== plainSecret) {
    showStatus('changePasswordStatus', 'старый пароль неверный');
    return;
  }
  if (!newP || newP.length < 3) {
    showStatus('changePasswordStatus', 'новый пароль слишком короткий');
    return;
  }
  if (newP !== rep) {
    showStatus('changePasswordStatus', 'новые пароли не совпадают');
    return;
  }
  plainSecret = newP;
  saveState();
  showModal('changePasswordModal', false);
  document.getElementById('passwordModalText').textContent = plainSecret;
  showModal('passwordModal', true);
};

document.getElementById('cancelChangePasswordBtn').onclick = () => showModal('changePasswordModal', false);
document.getElementById('closePasswordModal').onclick = () => showModal('passwordModal', false);

document.getElementById('themeBtn').onclick = () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  saveState();
  applyTheme();
  renderCurrentChat();
};

document.getElementById('togglePlusMenu').onclick = () => {
  document.getElementById('plusActions').classList.toggle('hidden');
};

document.getElementById('searchInput').addEventListener('input', e => {
  contactSearch = e.target.value || '';
  renderSidebar();
});

document.getElementById('openAddContact').onclick = () => showModal('addContactModal', true);
document.getElementById('addContactCancel').onclick = () => showModal('addContactModal', false);
document.getElementById('addContactConfirm').onclick = addContact;

document.getElementById('openCreateGroup').onclick = () => showModal('groupModal', true);
document.getElementById('groupCreateCancel').onclick = () => showModal('groupModal', false);
document.getElementById('groupCreateConfirm').onclick = createGroup;

document.getElementById('leaveChatBtn').onclick = leaveCurrentChat;
document.getElementById('sendBtn').onclick = () => sendMessage();

document.getElementById('logoutCancel').onclick = () => showModal('logoutModal', false);
document.getElementById('logoutConfirm').onclick = () => {
  showModal('logoutModal', false);
  document.getElementById('logoutCodeInput').value = '';
  showModal('logoutCodeModal', true);
};
document.getElementById('logoutCodeCancel').onclick = () => showModal('logoutCodeModal', false);
document.getElementById('logoutCodeConfirm').onclick = () => {
  if (document.getElementById('logoutCodeInput').value.trim() === '4821') {
    showModal('logoutCodeModal', false);
    logoutAccount();
  } else {
    alert('Неверный код. Выход отменён.');
  }
};

document.getElementById('openSettingsBtn').onclick = () => {
  if (!currentUser) return;
  document.getElementById('settingsNameInput').value = currentUser.username || '';
  document.getElementById('settingsAvatarInput').value = '';
  document.getElementById('settingsAvatarPreview').src = getCurrentAvatar(currentUser);
  showModal('settingsModal', true);
};

document.getElementById('openLogoutFlowFromSettings').onclick = () => {
  showModal('settingsModal', false);
  showModal('logoutModal', true);
};

document.getElementById('settingsCancel').onclick = () => showModal('settingsModal', false);
document.getElementById('settingsAvatarInput').onchange = async e => {
  const file = e.target.files?.[0] || null;
  document.getElementById('settingsAvatarPreview').src = file
    ? await readFileAsDataUrl(file)
    : getCurrentAvatar(currentUser);
};
document.getElementById('settingsToggleTheme').onclick = () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  saveState();
  applyTheme();
  renderCurrentChat();
};
document.getElementById('settingsSave').onclick = async () => {
  const name = normalizeName(document.getElementById('settingsNameInput').value);
  const file = document.getElementById('settingsAvatarInput').files?.[0] || null;
  if (name && isValidBaseName(name)) currentUser.username = name;
  if (file) currentUser.avatar = await readFileAsDataUrl(file);
  saveState();
  renderSidebar();
  renderCurrentChat();
  showModal('settingsModal', false);
};

document.getElementById('closeUserProfileModal').onclick = () => {
  currentProfileGroupId = null;
  showModal('userProfileModal', false);
};

document.getElementById('messageInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendMessage();
  }
});

document.getElementById('chatHeadBtn').onclick = () => openCurrentHeaderProfile();
document.getElementById('mobileBackBtn').onclick = e => {
  e.stopPropagation();
  currentChat = null;
  saveState();
  renderSidebar();
  renderCurrentChat();
  updateMobileLayout();
};
window.addEventListener('resize', updateMobileLayout);

applyTheme();
if (currentUser) {
  touchCurrentUserOnline();
  ensureSupport();
  saveState();
  renderSidebar();
  renderCurrentChat();
  markCurrentChatRead();
  show(appScreen);
  updateMobileLayout();
} else {
  show(registerScreen);
  updateMobileLayout();
}
