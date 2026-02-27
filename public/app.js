// ============================================================
//  app.js — Côté CLIENT
//
//  Architecture des 3 écrans :
//    1. screen-login  → choix pseudo + avatar
//    2. screen-coloc  → créer / rejoindre / switcher de coloc
//    3. screen-app    → liste de courses + chat
//
//  Flux de données :
//    fetch() → /api/colocs/:colocId/items → Express → MongoDB
//    socket   → room Socket.io isolée par coloc
//
//  Nouveautés :
//    ✅ Création / rejoindre une coloc (code unique)
//    ✅ Switch de coloc depuis le header
//    ✅ Isolation complète des données par colocId
//    ✅ Champ username vidé après création de coloc
//    ✅ Bouton "Valider la liste" avec confirmation
//    ✅ Colocs récentes mémorisées (localStorage)
// ============================================================

// ── Constantes ───────────────────────────────────────────────
const CATEGORY_ICONS = {
  'Fruits & Légumes':   '🥬',
  'Viandes & Poissons': '🥩',
  'Produits laitiers':  '🧀',
  'Épicerie':           '🫙',
  'Boissons':           '🥤',
  'Hygiène':            '🧴',
  'Surgelés':           '🧊',
  'Boulangerie':        '🥖',
  'Autre':              '📦'
};

// ── État global ───────────────────────────────────────────────
let currentUser  = null;   // { username, avatar }
let currentColoc = null;   // { _id, name, emoji, code, members }
let socket       = null;   // instance Socket.io
let allItems     = [];     // cache local des articles de la coloc courante
let editingId    = null;   // _id de l'article en cours d'édition
let modeCourse   = false;
let addBarOpen   = false;
let searchTimer  = null;
let typingTimer  = null;

// ── Emoji sélectionné ────────────────────────────────────────
let selectedAvatar     = '🧑';
let selectedColocEmoji = '🏠';

// ============================================================
//  ÉCRAN 1 — LOGIN
// ============================================================

function selectAvatar(btn) {
  document.querySelectorAll('.avatar-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedAvatar = btn.dataset.emoji;
}

function doLogin() {
  const input = document.getElementById('login-name');
  const name  = input.value.trim();
  if (!name) {
    input.style.borderColor = '#d64545';
    input.focus();
    setTimeout(() => input.style.borderColor = '', 1500);
    return;
  }

  currentUser = { username: name, avatar: selectedAvatar };

  // Passer à l'écran de sélection de coloc
  goToScreen('coloc');

  // Afficher le message de bienvenue
  document.getElementById('coloc-welcome').innerHTML =
    `<span>${selectedAvatar}</span> Bonjour, <strong>${escHtml(name)}</strong> !`;

  // Charger et afficher les colocs récentes depuis localStorage
  renderMyColocs();
}

// ============================================================
//  ÉCRAN 2 — GESTION DES COLOCS
// ============================================================

// ── Onglets Créer / Rejoindre ────────────────────────────────
function switchColocTab(tab) {
  document.querySelectorAll('.coloc-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.coloc-panel').forEach(p => p.classList.remove('active'));

  document.querySelector(`.coloc-tab:${tab === 'create' ? 'first-child' : 'last-child'}`)
    .classList.add('active');
  document.getElementById(`panel-${tab}`).classList.add('active');
}

// ── Sélection de l'emoji coloc ───────────────────────────────
document.querySelectorAll('.coloc-emoji-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.coloc-emoji-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedColocEmoji = btn.dataset.emoji;
  });
});

// ── Créer une nouvelle coloc ─────────────────────────────────
async function createColoc() {
  const input = document.getElementById('coloc-name-input');
  const name  = input.value.trim();
  if (!name) {
    input.style.borderColor = '#d64545';
    input.focus();
    setTimeout(() => input.style.borderColor = '', 1500);
    return;
  }

  try {
    const res = await fetch('/api/colocs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name,
        emoji:    selectedColocEmoji,
        username: currentUser.username
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const coloc = await res.json();

    // ✅ CORRECTION : vider le champ nom après création
    input.value = '';

    // Sauvegarder dans localStorage et entrer dans la coloc
    saveColocToHistory(coloc);
    enterColoc(coloc);

    showToast(`🏠 Coloc "${coloc.name}" créée ! Code : ${coloc.code}`, 'ok');

  } catch (err) {
    console.error('createColoc :', err.message);
    showToast(`Erreur : ${err.message}`, 'err');
  }
}

// ── Rejoindre une coloc existante par son code ───────────────
async function joinColoc() {
  const input = document.getElementById('coloc-code-input');
  const code  = input.value.trim().toUpperCase();
  if (!code) {
    input.style.borderColor = '#d64545';
    input.focus();
    setTimeout(() => input.style.borderColor = '', 1500);
    return;
  }

  try {
    const res = await fetch('/api/colocs/join', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code, username: currentUser.username })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `Aucune coloc avec le code "${code}"`);
    }

    const coloc = await res.json();

    // ✅ CORRECTION : vider le champ code après avoir rejoint
    input.value = '';

    saveColocToHistory(coloc);
    enterColoc(coloc);

    showToast(`✅ Rejoint la coloc "${coloc.name}" !`, 'ok');

  } catch (err) {
    console.error('joinColoc :', err.message);
    showToast(`Erreur : ${err.message}`, 'err');
  }
}

// ── Entrer dans une coloc (transition vers l'app) ────────────
function enterColoc(coloc) {
  currentColoc = coloc;

  // Mettre à jour le header
  document.getElementById('header-coloc-emoji').textContent = coloc.emoji || '🏠';
  document.getElementById('header-coloc-name').textContent  = coloc.name;
  document.getElementById('chip-code').textContent          = coloc.code;
  document.getElementById('user-chip').innerHTML =
    `<span>${currentUser.avatar}</span><span>${currentUser.username}</span>`;

  // Réinitialiser l'état de la liste
  allItems    = [];
  editingId   = null;
  modeCourse  = false;
  addBarOpen  = false;

  // Réinitialiser le chat
  document.getElementById('chat-messages').innerHTML = '';
  document.getElementById('badge-chat').style.display = 'none';

  // Réinitialiser les filtres
  document.getElementById('search-input').value   = '';
  document.getElementById('filter-status').value  = '';
  document.getElementById('filter-cat').value     = '';
  document.getElementById('sort-by').value        = '';

  goToScreen('app');
  switchView('liste');

  // Connexion Socket.io + chargement des données depuis MongoDB
  initSocket();
  loadItems();
  loadChatHistory();
}

// ── Switcher de coloc (retour à l'écran coloc) ───────────────
function switchColoc() {
  // Quitter la room Socket.io actuelle
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  currentColoc = null;

  // Rafraîchir la liste des colocs récentes
  renderMyColocs();
  goToScreen('coloc');
}

// ── Gestion des colocs récentes (localStorage) ───────────────
const STORAGE_KEY = 'coloc-courses:history';

function saveColocToHistory(coloc) {
  let history = getColocHistory();
  // Mettre à jour ou ajouter (évite les doublons par _id)
  history = history.filter(c => c._id !== coloc._id);
  history.unshift({ _id: coloc._id, name: coloc.name, emoji: coloc.emoji, code: coloc.code });
  // Garder seulement les 5 plus récentes
  history = history.slice(0, 5);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

function getColocHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch { return []; }
}

function renderMyColocs() {
  const history = getColocHistory();
  const section = document.getElementById('my-colocs-section');
  const list    = document.getElementById('my-colocs-list');

  if (history.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  list.innerHTML = history.map(c => `
    <div class="my-coloc-row" onclick="quickJoinColoc('${c._id}', ${JSON.stringify(c).replace(/"/g, '&quot;')})">
      <span class="my-coloc-emoji">${c.emoji || '🏠'}</span>
      <div class="my-coloc-info">
        <div class="my-coloc-name">${escHtml(c.name)}</div>
        <div class="my-coloc-code">Code : ${c.code}</div>
      </div>
      <span class="my-coloc-arrow">→</span>
    </div>
  `).join('');
}

// Rejoindre directement une coloc depuis l'historique
async function quickJoinColoc(colocId, colocData) {
  try {
    // Ré-appeler join pour s'assurer qu'on est bien membre
    const res = await fetch('/api/colocs/join', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code: colocData.code, username: currentUser.username })
    });

    if (!res.ok) throw new Error('Coloc introuvable');
    const coloc = await res.json();
    enterColoc(coloc);

  } catch (err) {
    showToast(`Impossible de rejoindre : ${err.message}`, 'err');
  }
}

// ── Copier le code coloc dans le presse-papier ───────────────
async function copyColocCode() {
  if (!currentColoc) return;
  try {
    await navigator.clipboard.writeText(currentColoc.code);
    showToast(`Code copié : ${currentColoc.code} 📋`, 'ok');
  } catch {
    showToast(`Code : ${currentColoc.code}`, 'info');
  }
}

// ============================================================
//  NAVIGATION ENTRE ÉCRANS
// ============================================================

function goToScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelector(`[data-view="${view}"]`).classList.add('active');

  if (view === 'chat') {
    const badge = document.getElementById('badge-chat');
    badge.style.display = 'none';
    badge.textContent   = '0';
    const c = document.getElementById('chat-messages');
    c.scrollTop = c.scrollHeight;
    document.getElementById('chat-input').focus();
  }
}

function toggleModeCourse() {
  modeCourse = !modeCourse;
  document.getElementById('btn-mode-course').classList.toggle('active', modeCourse);
  document.getElementById('items-container').classList.toggle('mode-course', modeCourse);
  showToast(modeCourse ? '🏪 Mode course activé' : 'Mode normal', 'info');
}

// ============================================================
//  SOCKET.IO — Connexion isolée par coloc (room)
// ============================================================

function initSocket() {
  // Fermer la connexion précédente si elle existe
  if (socket) socket.disconnect();

  socket = io();

  socket.on('connect', () => {
    // Rejoindre la room spécifique à cette coloc
    socket.emit('coloc:join', {
      colocId:  currentColoc._id,
      username: currentUser.username,
      avatar:   currentUser.avatar
    });
  });

  // Membres en ligne de cette coloc uniquement
  socket.on('users:update', (users) => {
    const pills = document.getElementById('online-pills');
    pills.innerHTML = users.map(u =>
      `<div class="online-pill"><span>${u.avatar}</span><span>${u.username}</span></div>`
    ).join('');
  });

  // Messages chat (isolés dans la room de cette coloc)
  socket.on('chat:message', (msg) => {
    appendChatMessage(msg);
    if (!document.querySelector('[data-view="chat"]').classList.contains('active')) {
      const badge = document.getElementById('badge-chat');
      badge.style.display = 'inline';
      badge.textContent   = parseInt(badge.textContent || 0) + 1;
    }
  });

  // Indicateur "en train d'écrire"
  socket.on('chat:typing', ({ username, isTyping }) => {
    const indicator = document.getElementById('typing-indicator');
    document.getElementById('typing-text').textContent = `${username} écrit`;
    indicator.style.display = isTyping ? 'flex' : 'none';
  });

  // Synchronisation liste — articles de CETTE coloc uniquement
  socket.on('item:added', (item) => {
    if (!allItems.find(i => i._id === item._id)) {
      allItems.push(item);
      renderItems();
      showToast(`${item.addedBy} a ajouté : ${item.name}`, 'info');
    }
  });
  socket.on('item:updated', (item) => {
    const idx = allItems.findIndex(i => i._id === item._id);
    if (idx !== -1) { allItems[idx] = item; renderItems(); }
  });
  socket.on('item:deleted', ({ id }) => {
    allItems = allItems.filter(i => i._id !== id);
    renderItems();
  });
  socket.on('list:cleared',   () => loadItems());
  socket.on('list:validated', () => {
    loadItems();
    showToast('✅ La liste a été validée par un colocataire !', 'ok');
  });

  socket.on('shopping:started', ({ username }) => {
    if (username !== currentUser.username)
      showToast(`🛒 ${username} est en courses !`, 'info');
  });

  socket.on('connect_error', () => showToast('Problème de connexion temps réel', 'err'));
}

// ============================================================
//  LISTE DE COURSES — Chargement depuis MongoDB
//  URL : /api/colocs/:colocId/items
//  Garantit que seuls les articles de la coloc courante sont récupérés
// ============================================================

async function loadItems() {
  if (!currentColoc) return;

  try {
    const params = new URLSearchParams();
    const search   = document.getElementById('search-input').value.trim();
    const category = document.getElementById('filter-cat').value;
    const status   = document.getElementById('filter-status').value;
    const sortBy   = document.getElementById('sort-by').value;

    if (search)   params.set('search',   search);
    if (category) params.set('category', category);
    if (status)   params.set('status',   status);
    if (sortBy)   params.set('sortBy',   sortBy);

    // La route inclut colocId → MongoDB filtre automatiquement
    const res = await fetch(`/api/colocs/${currentColoc._id}/items?${params}`);
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);

    allItems = await res.json();
    renderItems();

  } catch (err) {
    console.error('loadItems :', err.message);
    showToast('Impossible de charger la liste', 'err');
  }
}

// ── Rendu DOM de la liste ────────────────────────────────────
function renderItems() {
  const container = document.getElementById('items-container');
  const emptyMsg  = document.getElementById('empty-list');

  Array.from(container.children)
    .filter(el => el.id !== 'empty-list')
    .forEach(el => el.remove());

  if (allItems.length === 0) {
    emptyMsg.style.display = 'block';
    updateSummary();
    return;
  }
  emptyMsg.style.display = 'none';

  // Grouper par catégorie
  const groups = {};
  allItems.forEach(item => {
    const cat = item.category || 'Autre';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });

  Object.entries(groups).forEach(([cat, items]) => {
    const group = document.createElement('div');
    group.className  = 'category-group';
    group.dataset.cat = cat;
    group.innerHTML  = `<div class="category-title">${CATEGORY_ICONS[cat] || '📦'} ${escHtml(cat)}</div>`;

    items.forEach((item, i) => {
      const card = buildItemCard(item);
      card.style.animationDelay = `${i * 0.03}s`;
      group.appendChild(card);
    });
    container.appendChild(group);
  });

  updateSummary();
}

function buildItemCard(item) {
  const today    = new Date(); today.setHours(0,0,0,0);
  const dueDate  = item.dueDate ? new Date(item.dueDate) : null;
  const isOverdue = dueDate && dueDate < today && !item.bought;

  const card = document.createElement('div');
  card.className = ['item-card',
    item.bought  ? 'bought'  : '',
    item.urgent  ? 'urgent'  : '',
    isOverdue    ? 'overdue' : ''
  ].filter(Boolean).join(' ');
  card.dataset.id = item._id;

  const priceStr   = item.estimatedPrice > 0 ? `≈ ${(item.estimatedPrice * item.quantity).toFixed(2)} €` : '';
  const dueDateStr = dueDate ? `📅 ${dueDate.toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}` : '';

  card.innerHTML = `
    <div class="item-check" onclick="toggleBought('${item._id}', ${item.bought})">
      ${item.bought ? '✓' : ''}
    </div>
    <div class="item-body">
      <div class="item-name">
        ${escHtml(item.name)}
        ${item.urgent && !item.bought ? '<span class="badge-urgent">⚡ URGENT</span>' : ''}
        ${isOverdue ? '<span class="badge-overdue">⏰ EN RETARD</span>' : ''}
      </div>
      <div class="item-meta">
        <span class="item-qty">${item.quantity} ${item.unit}</span>
        ${priceStr                ? `<span class="item-price">${priceStr}</span>` : ''}
        ${item.assignedTo         ? `<span class="item-assigned">👤 ${escHtml(item.assignedTo)}</span>` : ''}
        ${dueDateStr              ? `<span class="item-due">${dueDateStr}</span>` : ''}
        <span style="opacity:0.6;font-size:0.72rem">Par ${escHtml(item.addedBy)}</span>
        ${item.note ? `<span class="item-note">· ${escHtml(item.note)}</span>` : ''}
      </div>
    </div>
    <div class="item-actions">
      <button class="item-btn edit" onclick="openEditModal('${item._id}')">✎</button>
      <button class="item-btn del"  onclick="deleteItem('${item._id}')">✕</button>
    </div>`;
  return card;
}

function updateSummary() {
  const total   = allItems.length;
  const bought  = allItems.filter(i => i.bought).length;
  const price   = allItems.reduce((s, i) => s + (i.estimatedPrice || 0) * i.quantity, 0);
  const pending = total - bought;

  document.getElementById('summary-text').textContent  = `${total} article${total !== 1 ? 's' : ''}`;
  document.getElementById('summary-price').textContent = `${price.toFixed(2)} €`;
  document.getElementById('summary-done').textContent  = `${bought} acheté${bought !== 1 ? 's' : ''}`;

  const badge = document.getElementById('badge-liste');
  badge.textContent   = pending;
  badge.style.display = pending > 0 ? 'inline' : 'none';
  document.getElementById('btn-clear').style.display = bought > 0 ? 'inline-flex' : 'none';
}

// ============================================================
//  CRUD ARTICLES
//  Toutes les routes incluent le colocId → isolation MongoDB
// ============================================================

async function quickAdd() {
  const name = document.getElementById('quick-name').value.trim();
  if (!name) { showToast('Entrez le nom de l\'article', 'err'); return; }

  const body = {
    name,
    category:       document.getElementById('quick-cat').value,
    quantity:       parseFloat(document.getElementById('quick-qty').value)   || 1,
    unit:           document.getElementById('quick-unit').value,
    estimatedPrice: parseFloat(document.getElementById('quick-price').value) || 0,
    assignedTo:     document.getElementById('quick-assigned').value.trim(),
    urgent:         document.getElementById('quick-urgent').checked,
    note:           document.getElementById('quick-note').value.trim(),
    dueDate:        document.getElementById('quick-due').value || null,
    addedBy:        currentUser.username
  };

  try {
    // POST vers /api/colocs/:colocId/items — colocId injecté côté serveur
    const res = await fetch(`/api/colocs/${currentColoc._id}/items`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    if (!res.ok) throw new Error((await res.json()).error);

    const newItem = await res.json();
    allItems.push(newItem);
    renderItems();
    if (socket) socket.emit('item:added', newItem);

    // Réinitialiser
    ['quick-name','quick-price','quick-assigned','quick-note','quick-due']
      .forEach(id => document.getElementById(id).value = '');
    document.getElementById('quick-urgent').checked = false;
    document.getElementById('quick-qty').value = '1';

    showToast(`✓ "${newItem.name}" ajouté !`, 'ok');

  } catch (err) { showToast(`Erreur : ${err.message}`, 'err'); }
}

async function toggleBought(id, current) {
  try {
    const res = await fetch(`/api/colocs/${currentColoc._id}/items/${id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ bought: !current })
    });
    if (!res.ok) throw new Error();
    const updated = await res.json();
    const idx = allItems.findIndex(i => i._id === id);
    if (idx !== -1) allItems[idx] = updated;
    renderItems();
    if (socket) socket.emit('item:updated', updated);
  } catch { showToast('Impossible de mettre à jour', 'err'); }
}

async function deleteItem(id) {
  const card = document.querySelector(`.item-card[data-id="${id}"]`);
  if (card) {
    card.style.transition = 'all 0.25s ease';
    card.style.opacity    = '0';
    card.style.transform  = 'translateX(20px)';
    await new Promise(r => setTimeout(r, 240));
  }
  try {
    const res = await fetch(`/api/colocs/${currentColoc._id}/items/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    allItems = allItems.filter(i => i._id !== id);
    renderItems();
    if (socket) socket.emit('item:deleted', { id });
    showToast('Article supprimé', 'ok');
  } catch {
    showToast('Impossible de supprimer', 'err');
    if (card) { card.style.opacity = '1'; card.style.transform = 'none'; }
  }
}

async function clearBought() {
  const count = allItems.filter(i => i.bought).length;
  if (count === 0) return;
  try {
    const res = await fetch(`/api/colocs/${currentColoc._id}/items/bought/clear`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    const result = await res.json();
    allItems = allItems.filter(i => !i.bought);
    renderItems();
    if (socket) socket.emit('list:cleared');
    showToast(`🗑 ${result.deletedCount} article(s) supprimés`, 'ok');
  } catch { showToast('Erreur lors de la suppression', 'err'); }
}

// ── Modal édition ────────────────────────────────────────────
function openEditModal(id) {
  const item = allItems.find(i => i._id === id);
  if (!item) return;
  editingId = id;

  document.getElementById('edit-name').value     = item.name;
  document.getElementById('edit-cat').value      = item.category   || 'Autre';
  document.getElementById('edit-qty').value      = item.quantity;
  document.getElementById('edit-unit').value     = item.unit;
  document.getElementById('edit-price').value    = item.estimatedPrice || '';
  document.getElementById('edit-assigned').value = item.assignedTo || '';
  document.getElementById('edit-note').value     = item.note       || '';
  document.getElementById('edit-urgent').checked = item.urgent;
  document.getElementById('edit-due').value      = item.dueDate
    ? new Date(item.dueDate).toISOString().split('T')[0] : '';

  document.getElementById('modal-edit').classList.add('open');
  document.getElementById('edit-name').focus();
}

function closeEditModal(e) {
  if (e && e.target !== document.getElementById('modal-edit')) return;
  document.getElementById('modal-edit').classList.remove('open');
  editingId = null;
}

async function saveEdit() {
  if (!editingId) return;
  const name = document.getElementById('edit-name').value.trim();
  if (!name) { showToast('Le nom est requis', 'err'); return; }

  const body = {
    name,
    category:       document.getElementById('edit-cat').value,
    quantity:       parseFloat(document.getElementById('edit-qty').value)   || 1,
    unit:           document.getElementById('edit-unit').value,
    estimatedPrice: parseFloat(document.getElementById('edit-price').value) || 0,
    assignedTo:     document.getElementById('edit-assigned').value.trim(),
    note:           document.getElementById('edit-note').value.trim(),
    urgent:         document.getElementById('edit-urgent').checked,
    dueDate:        document.getElementById('edit-due').value || null
  };

  try {
    const res = await fetch(`/api/colocs/${currentColoc._id}/items/${editingId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    if (!res.ok) throw new Error((await res.json()).error);
    const updated = await res.json();
    const idx = allItems.findIndex(i => i._id === editingId);
    if (idx !== -1) allItems[idx] = updated;
    renderItems();
    if (socket) socket.emit('item:updated', updated);
    document.getElementById('modal-edit').classList.remove('open');
    editingId = null;
    showToast('✓ Article mis à jour !', 'ok');
  } catch (err) { showToast(`Erreur : ${err.message}`, 'err'); }
}

// ============================================================
//  VALIDATION DE LA LISTE
//  Supprime les articles achetés + notifie tous les membres
// ============================================================

function validateList() {
  const bought  = allItems.filter(i => i.bought).length;
  const pending = allItems.filter(i => !i.bought).length;

  // Remplir le résumé dans le modal de confirmation
  document.getElementById('validate-info').innerHTML =
    `<strong>${bought}</strong> article${bought !== 1 ? 's' : ''} acheté${bought !== 1 ? 's' : ''} à supprimer · 
     <strong>${pending}</strong> article${pending !== 1 ? 's' : ''} non acheté${pending !== 1 ? 's' : ''} à conserver`;

  document.getElementById('modal-validate').classList.add('open');
}

function closeValidateModal(e) {
  if (e && e.target !== document.getElementById('modal-validate')) return;
  document.getElementById('modal-validate').classList.remove('open');
}

async function confirmValidation() {
  try {
    // POST /api/colocs/:colocId/validate → supprime les achetés en MongoDB
    const res = await fetch(`/api/colocs/${currentColoc._id}/validate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username: currentUser.username })
    });
    if (!res.ok) throw new Error((await res.json()).error);

    const result = await res.json();

    // Fermer le modal et recharger la liste
    document.getElementById('modal-validate').classList.remove('open');
    await loadItems();

    // Notifier les autres membres en temps réel
    if (socket) socket.emit('list:validated');

    showToast(`✅ Liste validée ! ${result.deletedCount} article(s) supprimés.`, 'ok');

  } catch (err) { showToast(`Erreur : ${err.message}`, 'err'); }
}

// ============================================================
//  BARRE D'AJOUT
// ============================================================

function expandAddBar() {
  if (addBarOpen) return;
  addBarOpen = true;
  document.getElementById('add-bar-extra').classList.add('open');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.add-bar') && addBarOpen) {
    if (!document.getElementById('quick-name').value.trim()) {
      addBarOpen = false;
      document.getElementById('add-bar-extra').classList.remove('open');
    }
  }
});

// ============================================================
//  CHAT
// ============================================================

async function loadChatHistory() {
  if (!currentColoc) return;
  try {
    // GET /api/colocs/:colocId/messages — messages de CETTE coloc uniquement
    const res = await fetch(`/api/colocs/${currentColoc._id}/messages`);
    if (!res.ok) return;
    const messages = await res.json();
    messages.forEach(m => appendChatMessage({
      type: 'user', username: m.username, avatar: m.avatar, text: m.text, timestamp: m.createdAt
    }));
    const c = document.getElementById('chat-messages');
    c.scrollTop = c.scrollHeight;
  } catch (err) { console.error('loadChatHistory :', err.message); }
}

function sendMessage() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text || !socket) return;
  // Le serveur ajoute colocId depuis socket.data → sauvegarde en MongoDB
  socket.emit('chat:send', { text });
  input.value = '';
  socket.emit('chat:typing', { isTyping: false });
  clearTimeout(typingTimer);
}

function handleChatKeydown(e) { if (e.key === 'Enter') sendMessage(); }

function handleTyping() {
  if (!socket) return;
  socket.emit('chat:typing', { isTyping: true });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.emit('chat:typing', { isTyping: false }), 2000);
}

function appendChatMessage(msg) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const div = document.createElement('div');

  if (msg.type === 'system') {
    div.className = 'chat-msg system';
    div.innerHTML = `<div class="msg-bubble">${escHtml(msg.text)}</div>`;
  } else {
    const isSelf = currentUser && msg.username === currentUser.username;
    div.className = `chat-msg ${isSelf ? 'self' : 'other'}`;
    div.innerHTML = `
      ${!isSelf ? `<div class="msg-who"><span>${escHtml(msg.avatar||'🧑')}</span><strong>${escHtml(msg.username)}</strong></div>` : ''}
      <div class="msg-bubble">${escHtml(msg.text)}</div>
      ${msg.timestamp ? `<div class="msg-time">${formatTime(msg.timestamp)}</div>` : ''}`;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ============================================================
//  BOUTON COURSES
// ============================================================
function goShopping() {
  if (!socket) return;
  socket.emit('user:shopping');
  showToast('🛒 La coloc\' a été prévenue !', 'ok');
}

function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadItems, 280);
}

// ============================================================
//  UTILITAIRES
// ============================================================

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
}

function showToast(text, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = text;
  toast.className   = `toast ${type} show`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 3500);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('modal-edit').classList.remove('open');
    document.getElementById('modal-validate').classList.remove('open');
    editingId = null;
  }
});
