// ============================================================
//  server.js — Côté SERVEUR
//  Express + MongoDB (Mongoose) + Socket.io
//
//  Nouveautés par rapport à la version précédente :
//    - Modèle Coloc : création, rejoindre par code
//    - Toutes les routes items/messages filtrent par colocId
//    - Isolation complète des données entre colocs
//    - Route de validation de liste
//    - Socket.io : rooms par coloc (isolation du chat)
// ============================================================

require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const mongoose   = require('mongoose');
const cors       = require('cors');
const morgan     = require('morgan');
const path       = require('path');

const Coloc   = require('./models/Coloc');
const Item    = require('./models/Item');
const Message = require('./models/Message');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Connexion MongoDB ────────────────────────────────────────
const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('❌ MONGODB_URI manquante dans .env');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connecté à MongoDB'))
  .catch(err => {
    console.error('❌ Connexion MongoDB échouée :', err.message);
    process.exit(1);
  });

// ── Helper : génère un code coloc unique (ex: "SOLEIL-73") ───
const MOTS = ['SOLEIL','LUNE','ETOILE','NUAGE','VENT','PLUIE',
              'NEIGE','MER','FORET','COLOC','MAISON','CUISINE'];

async function genererCodeUnique() {
  let code, existe;
  do {
    const mot = MOTS[Math.floor(Math.random() * MOTS.length)];
    const num = Math.floor(10 + Math.random() * 90); // 10-99
    code  = `${mot}-${num}`;
    existe = await Coloc.findOne({ code });
  } while (existe);
  return code;
}

// ============================================================
//  ROUTES API — COLOCS
// ============================================================

// POST /api/colocs — Créer une nouvelle coloc
app.post('/api/colocs', async (req, res) => {
  try {
    const { name, emoji, username } = req.body;
    if (!name || !username) {
      return res.status(400).json({ error: 'Nom de coloc et username requis' });
    }

    const code  = await genererCodeUnique();
    const coloc = await new Coloc({
      name:    name.trim(),
      emoji:   emoji || '🏠',
      code,
      members: [username.trim()]
    }).save();

    console.log(`🏠 Coloc créée : "${coloc.name}" (code: ${coloc.code})`);
    res.status(201).json(coloc);

  } catch (err) {
    console.error('POST /api/colocs :', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/colocs/join — Rejoindre une coloc par son code
app.post('/api/colocs/join', async (req, res) => {
  try {
    const { code, username } = req.body;
    if (!code || !username) {
      return res.status(400).json({ error: 'Code et username requis' });
    }

    const coloc = await Coloc.findOne({ code: code.trim().toUpperCase() });
    if (!coloc) {
      return res.status(404).json({ error: `Aucune coloc avec le code "${code.toUpperCase()}"` });
    }

    // Ajouter le membre s'il n'est pas déjà présent
    if (!coloc.members.includes(username.trim())) {
      coloc.members.push(username.trim());
      await coloc.save();
    }

    console.log(`👤 ${username} a rejoint la coloc "${coloc.name}"`);
    res.json(coloc);

  } catch (err) {
    console.error('POST /api/colocs/join :', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/colocs/:id — Infos d'une coloc
app.get('/api/colocs/:id', async (req, res) => {
  try {
    const coloc = await Coloc.findById(req.params.id);
    if (!coloc) return res.status(404).json({ error: 'Coloc introuvable' });
    res.json(coloc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  ROUTES API — ITEMS (filtrés par colocId)
// ============================================================

// GET /api/colocs/:colocId/items — Articles d'une coloc spécifique
app.get('/api/colocs/:colocId/items', async (req, res) => {
  try {
    const { search, category, status, sortBy } = req.query;

    // Filtre de base : articles appartenant à cette coloc UNIQUEMENT
    const filter = { colocId: req.params.colocId };

    if (search)             filter.name     = { $regex: search, $options: 'i' };
    if (category)           filter.category = category;
    if (status === 'pending') filter.bought = false;
    if (status === 'done')    filter.bought = true;

    let sort = { createdAt: 1 };
    if (sortBy === 'name')     sort = { name: 1 };
    if (sortBy === 'category') sort = { category: 1, name: 1 };
    if (sortBy === 'urgent')   sort = { urgent: -1, createdAt: 1 };
    if (sortBy === 'dueDate')  sort = { dueDate: 1, createdAt: 1 };

    const items = await Item.find(filter).sort(sort);
    res.json(items);

  } catch (err) {
    console.error('GET items :', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/colocs/:colocId/items — Créer un article dans cette coloc
app.post('/api/colocs/:colocId/items', async (req, res) => {
  try {
    // On s'assure que la coloc existe
    const coloc = await Coloc.findById(req.params.colocId);
    if (!coloc) return res.status(404).json({ error: 'Coloc introuvable' });

    // colocId est injecté côté serveur, jamais fourni par le client
    const item = await new Item({
      ...req.body,
      colocId: req.params.colocId
    }).save();

    console.log(`➕ [${coloc.name}] Article : "${item.name}"`);
    res.status(201).json(item);

  } catch (err) {
    console.error('POST items :', err.message);
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/colocs/:colocId/items/:id — Modifier un article
app.put('/api/colocs/:colocId/items/:id', async (req, res) => {
  try {
    // On filtre par _id ET colocId pour garantir l'isolation
    const item = await Item.findOneAndUpdate(
      { _id: req.params.id, colocId: req.params.colocId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ error: 'Article introuvable' });
    res.json(item);

  } catch (err) {
    console.error('PUT items :', err.message);
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/colocs/:colocId/items/bought/clear — Vider les achetés
// ⚠️ Cette route doit être déclarée AVANT /:id
app.delete('/api/colocs/:colocId/items/bought/clear', async (req, res) => {
  try {
    const result = await Item.deleteMany({
      colocId: req.params.colocId,
      bought:  true
    });
    console.log(`🗑️  [coloc] ${result.deletedCount} article(s) achetés supprimés`);
    res.json({ message: `${result.deletedCount} article(s) supprimé(s)`, deletedCount: result.deletedCount });

  } catch (err) {
    console.error('DELETE bought/clear :', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/colocs/:colocId/items/:id — Supprimer un article
app.delete('/api/colocs/:colocId/items/:id', async (req, res) => {
  try {
    const item = await Item.findOneAndDelete({
      _id:     req.params.id,
      colocId: req.params.colocId  // sécurité : ne peut pas supprimer hors de sa coloc
    });
    if (!item) return res.status(404).json({ error: 'Article introuvable' });
    res.json({ message: 'Supprimé', id: req.params.id });

  } catch (err) {
    console.error('DELETE items :', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── VALIDATION DE LISTE ──────────────────────────────────────
// POST /api/colocs/:colocId/validate
// Marque tous les articles achetés comme supprimés et passe
// le statut de la coloc à 'validated', puis remet à 'active'.
// Cela équivaut à "terminer les courses" et repartir d'une liste neuve.
app.post('/api/colocs/:colocId/validate', async (req, res) => {
  try {
    const { username } = req.body;

    const coloc = await Coloc.findById(req.params.colocId);
    if (!coloc) return res.status(404).json({ error: 'Coloc introuvable' });

    // Compter et supprimer les articles achetés
    const bought = await Item.countDocuments({ colocId: req.params.colocId, bought: true });
    await Item.deleteMany({ colocId: req.params.colocId, bought: true });

    // Mettre à jour la coloc
    coloc.validatedBy = username || 'Anonyme';
    coloc.validatedAt = new Date();
    coloc.listStatus  = 'active'; // Immédiatement "active" pour accueillir une nouvelle liste
    await coloc.save();

    console.log(`✅ [${coloc.name}] Liste validée par ${username}, ${bought} article(s) achetés supprimés`);
    res.json({ message: 'Liste validée', deletedCount: bought, coloc });

  } catch (err) {
    console.error('POST validate :', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  ROUTES API — MESSAGES (filtrés par colocId)
// ============================================================

// GET /api/colocs/:colocId/messages — 50 derniers messages de cette coloc
app.get('/api/colocs/:colocId/messages', async (req, res) => {
  try {
    const messages = await Message
      .find({ colocId: req.params.colocId })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(messages.reverse());

  } catch (err) {
    console.error('GET messages :', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SPA fallback ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
//  SOCKET.IO
//  Chaque coloc a sa propre "room" Socket.io.
//  Les événements ne sont diffusés qu'aux membres de la même room.
// ============================================================

io.on('connection', (socket) => {

  // ── Rejoindre la room de sa coloc ─────────────────────────
  socket.on('coloc:join', ({ colocId, username, avatar }) => {
    // Quitter toutes les rooms précédentes sauf la room personnelle
    Array.from(socket.rooms)
      .filter(r => r !== socket.id)
      .forEach(r => socket.leave(r));

    // Rejoindre la room de la coloc
    socket.join(colocId);
    socket.data.username = username;
    socket.data.avatar   = avatar;
    socket.data.colocId  = colocId;

    // Mettre à jour la liste des membres en ligne dans cette coloc
    broadcastOnlineUsers(colocId);

    // Message système dans le chat de la coloc
    io.to(colocId).emit('chat:message', {
      type:      'system',
      text:      `${username} a rejoint la coloc' 🏠`,
      timestamp: new Date().toISOString()
    });

    console.log(`👤 ${username} → room ${colocId}`);
  });

  // ── Message chat ──────────────────────────────────────────
  socket.on('chat:send', async ({ text }) => {
    const { username, avatar, colocId } = socket.data;
    if (!colocId) return;

    try {
      // Sauvegarder en MongoDB avec le colocId
      const message = await new Message({ colocId, username, avatar, text }).save();

      // Diffuser uniquement dans la room de cette coloc
      io.to(colocId).emit('chat:message', {
        type:      'user',
        username:  message.username,
        avatar:    message.avatar,
        text:      message.text,
        timestamp: message.createdAt
      });
    } catch (err) {
      socket.emit('chat:error', 'Impossible d\'envoyer le message');
    }
  });

  // ── Indicateur "en train d'écrire" ────────────────────────
  socket.on('chat:typing', ({ isTyping }) => {
    const { username, colocId } = socket.data;
    if (!colocId) return;
    socket.to(colocId).emit('chat:typing', { username, isTyping });
  });

  // ── Notification courses ──────────────────────────────────
  socket.on('user:shopping', () => {
    const { username, colocId } = socket.data;
    if (!colocId) return;
    io.to(colocId).emit('chat:message', {
      type:      'system',
      text:      `🛒 ${username} est parti(e) faire les courses !`,
      timestamp: new Date().toISOString()
    });
    socket.to(colocId).emit('shopping:started', { username });
  });

  // ── Sync liste (broadcast dans la room coloc) ─────────────
  socket.on('item:added',   (item)   => socket.to(socket.data.colocId).emit('item:added',   item));
  socket.on('item:updated', (item)   => socket.to(socket.data.colocId).emit('item:updated', item));
  socket.on('item:deleted', ({ id }) => socket.to(socket.data.colocId).emit('item:deleted', { id }));
  socket.on('list:cleared', ()       => socket.to(socket.data.colocId).emit('list:cleared'));
  socket.on('list:validated',()      => socket.to(socket.data.colocId).emit('list:validated'));

  // ── Déconnexion ───────────────────────────────────────────
  socket.on('disconnect', () => {
    const { username, colocId } = socket.data || {};
    if (username && colocId) {
      broadcastOnlineUsers(colocId);
      io.to(colocId).emit('chat:message', {
        type:      'system',
        text:      `${username} a quitté la coloc'`,
        timestamp: new Date().toISOString()
      });
    }
  });
});

// ── Helper : diffuse les utilisateurs en ligne d'une coloc ──
function broadcastOnlineUsers(colocId) {
  const room    = io.sockets.adapter.rooms.get(colocId);
  const online  = [];
  if (room) {
    room.forEach(socketId => {
      const s = io.sockets.sockets.get(socketId);
      if (s && s.data.username) {
        online.push({ username: s.data.username, avatar: s.data.avatar });
      }
    });
  }
  io.to(colocId).emit('users:update', online);
}

// ── Démarrage ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('🚀 ================================');
  console.log(`   Coloc' Courses → http://localhost:${PORT}`);
  console.log('================================');
  console.log('');
});
