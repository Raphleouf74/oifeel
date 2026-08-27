require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const helmet = require("helmet");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const fsPromises = require("fs/promises");
const cron = require("node-cron");

const jwtService = require('./services/jwt.cjs');

// ============================================================
// 2FA — dépendances (npm install otplib qrcode twilio)
// otplib v13+ utilise une API fonctionnelle (plus de classe "authenticator").
// ============================================================
let otpGenerateSecret = null, otpVerify = null, otpGenerateURI = null;
try {
  const otplibPkg = require('otplib');
  otpGenerateSecret = otplibPkg.generateSecret;
  otpVerify = otplibPkg.verify;
  otpGenerateURI = otplibPkg.generateURI;
  if (!otpGenerateSecret || !otpVerify || !otpGenerateURI) {
    console.error('❌ [2FA] otplib chargé mais des exports attendus manquent. Clés disponibles:', Object.keys(otplibPkg));
  } else {
    console.log('✅ [2FA] otplib chargé correctement (API fonctionnelle v13+)');
  }
} catch (e) {
  console.error('❌ [2FA] Impossible de charger otplib — le TOTP sera indisponible:', e.message);
}
const totpReady = () => !!(otpGenerateSecret && otpVerify && otpGenerateURI);

let QRCode = null;
try {
  const qrcodePkg = require('qrcode');
  QRCode = qrcodePkg.toDataURL ? qrcodePkg : (qrcodePkg.default || null);
  if (!QRCode) console.error('❌ [2FA] qrcode chargé mais export inattendu:', Object.keys(qrcodePkg));
} catch (e) {
  console.error('❌ [2FA] Impossible de charger qrcode — le QR code TOTP sera indisponible:', e.message);
}


// ============================================================
// MONGODB — persistance inter-redémarrages
// ============================================================
const MONGO_URI = 'mongodb+srv://MoodShareAdminRaph:Jem4ppelleraphael!@cluster0.7lnr6qq.mongodb.net/?appName=Cluster0';
cron.schedule("0 0 * * *", async () => {
  try {
    if (!posts.length) return;

    const randomPost = posts[Math.floor(Math.random() * posts.length)];

    await db.collection("daily_featured").insertOne({
      date: new Date().toISOString().split("T")[0],
      postId: randomPost.id,
      createdAt: new Date()
    });

    console.log("Post of the day updated");
  } catch (e) {
    console.error("Daily post error:", e);
  }
});
const postSchema = new mongoose.Schema({
  _id: { type: String, default: () => Date.now().toString() },
  userId: { type: String, default: null },
  userName: { type: String, default: 'Anonyme' },
  text: String,
  emoji: String,
  color: String,
  textColor: String,
  stickerUrl: { type: String, default: null },
  track: {
    type: {
      title: { type: String, default: null },
      artist: { type: String, default: null },
      cover: { type: String, default: null },
      trackId: { type: String, default: null },
      preview: { type: String, default: null },
      link: { type: String, default: null }
    },
    default: null
  },
  anonymous: { type: Boolean, default: false },
  likes: { type: Number, default: 0 },
  views: { type: Number, default: 0 },
  // reactions: { heart: N, haha: N, ... }
  reactions: { type: Map, of: Number, default: {} },
  ephemeral: { type: Boolean, default: false },
  expiresAt: { type: Date, default: null },
  repostedFrom: String,
  createdAt: { type: Date, default: Date.now },
  editedAt: Date,
  pinned: { type: Boolean, default: false },
  pinnedLabel: { type: String, default: '' },
  aiGenerated: { type: Boolean, default: false },
  ip: { type: String, default: null, select: false },
  ipLoggedAt: { type: Date, default: null, select: false }
}, { _id: false });

const PostModel = mongoose.models.Post || mongoose.model('Post', postSchema);

// ============================================================
// USER SCHEMA pour MongoDB — avec features sociales
// ============================================================
const userSchema = new mongoose.Schema({
  _id: { type: String, default: () => Date.now().toString() },
  displayName: { type: String, required: true },
  password: { type: String, required: true },
  email: { type: String, sparse: true, default: null, lowercase: true, trim: true },
  isGuest: { type: Boolean, default: false },

  // Profil
  bio: { type: String, default: '', maxLength: 200 },
  avatar: { type: String, default: '👤' },

  // Clé publique E2E (ECDH P-256, format JWK base64)
  publicKey: { type: String, default: null },

  // Réseau social
  followers: [{ type: String }],
  following: [{ type: String }],
  favorites: [{ type: String }],

  // Notifications
  pushTokens: [{ type: String }],

  // Stats
  postsCount: { type: Number, default: 0 },
  followersCount: { type: Number, default: 0 },
  followingCount: { type: Number, default: 0 },

  // Ban system
  bannedUntil: { type: Date, default: null },
  bannedReason: { type: String, default: '' },
  permanentlyBanned: { type: Boolean, default: false },

  // Timestamps
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now },

  // IP de connexion (même politique de rétention 30j que les posts)
  lastLoginIp: { type: String, default: null, select: false },
  lastLoginIpAt: { type: Date, default: null, select: false },

  emailNotifications: {
    announcements: {
      type: Boolean,
      default: false
    },
    updates: {
      type: Boolean,
      default: false
    }
  },

  // Préférence d'affichage des posts générés par IA : 'allow' | 'avoid' | 'block'
  aiPostsPreference: { type: String, enum: ['allow', 'avoid', 'block'], default: 'allow' },

  // ── 2FA — activable au choix par l'utilisateur dans ses réglages ──
  twoFactor: {
    enabled: { type: Boolean, default: false },
    method: { type: String, enum: ['email', 'totp', null], default: null },
    totpSecret: { type: String, default: null, select: false },
    phone: { type: String, default: null },
    phoneVerified: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false }
  },

  // googleId: { type: String, default: null, index: true, sparse: true },
  googleId: { type: String, default: null, index: true, sparse: true },
  verified: { type: Boolean, default: false },

  // ── Personnalisation du compte — visible par les autres sur le
  // profil et sur les posts (hors posts publiés en anonyme) ──
  theme: {
    accentColor: { type: String, default: '#5f95b9' },
    font: {
      type: String,
      enum: ['default', 'elegant', 'hand', 'round', 'mono', 'display'],
      default: 'default'
    }
  },
}, { _id: false });

userSchema.index({ displayName: 'text' });

const UserModel = mongoose.models.User || mongoose.model('User', userSchema);

// ============================================================
// DISCORD LINK SCHEMA — lie un compte Discord à un compte oifeel.
// _id = ID Discord (string, unique). userId = _id du User oifeel.
// ============================================================
const discordLinkSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // Discord user ID
  userId: { type: String, required: true, index: true }, // oifeel. user ID
  linkedAt: { type: Date, default: Date.now }
}, { _id: false });

const DiscordLinkModel = mongoose.models.DiscordLink || mongoose.model('DiscordLink', discordLinkSchema);

// Routes externes (users) — chargé ICI, seulement après l'enregistrement du
// schéma User complet ci-dessus. routes/users.cjs charge lui-même
// models/User.cjs, qui contient un schéma minimal et fait
// `mongoose.models.User || mongoose.model('User', ...)`. En chargeant ce
// module trop tôt (avant cette ligne), son schéma minimal gagnait la course
// à l'enregistrement Mongoose et écrasait silencieusement le schéma complet
// pour TOUTE l'application (email, emailNotifications, lastLoginIp,
// bannedUntil, etc. disparaissaient alors du modèle actif).
const usersRoutes = require("./routes/users.cjs");

// ============================================================
// NOTIFICATION SCHEMA
// ============================================================
const notificationSchema = new mongoose.Schema({
  _id: { type: String, default: () => Date.now().toString() },
  userId: { type: String, required: true, index: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  data: { type: Object, default: {} },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const NotificationModel = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

// ============================================================
// MESSAGE & CONVERSATION SCHEMA
// ============================================================
const messageSchema = new mongoose.Schema({
  senderId: { type: String, required: true },
  senderName: { type: String, required: true },
  content: { type: String, default: '' },
  encrypted: { type: Boolean, default: false },
  sharedPostId: { type: String, default: null },
  stickerUrl: { type: String, default: null },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  participants: [{ type: String, required: true }],
  participantNames: { type: Map, of: String },
  messages: { type: [messageSchema], default: [] },
  lastMessageAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

const ConversationModel = mongoose.models.Conversation || mongoose.model('conversation', conversationSchema);

// ============================================================
// COMMENT SCHEMA
// ============================================================
const commentSchema = new mongoose.Schema({
  _id: { type: String, default: () => Date.now().toString() },
  postId: { type: String, required: true, index: true },
  author: { type: String, default: 'Anonyme' },
  authorId: { type: String, default: null },
  text: { type: String, required: true, maxLength: 500 },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const CommentModel = mongoose.models.Comment || mongoose.model('Comment', commentSchema);

// ============================================================
// AI USAGE SCHEMA — limite la génération IA à 3 requêtes/semaine/IP
// ============================================================
const aiUsageSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // IP du client
  requests: { type: [Date], default: [] }
}, { _id: false });

const AiUsageModel = mongoose.models.AiUsage || mongoose.model('AiUsage', aiUsageSchema);

// Fallback mémoire si MongoDB est indisponible (réinitialisé au redémarrage du serveur)
const aiUsageMemory = new Map(); // ip -> [Date, Date, ...]

// POSTS STORAGE
let posts = [
  {
    text: 'Bienvenue dans oifeel.!',
    color: '#022f35',
    date: '01/01/2026',
    emoji: '👋',
    ephemeral: false,
    expiresAt: null,
    id: '0'
  }
];

let mongoReady = false;

if (MONGO_URI) {
  mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 6000 })
    .then(async () => {
      mongoReady = true;
      console.log('✅ MongoDB connecté');
      await loadPostsFromMongo();
    })
    .catch(err => {
      console.error('❌ MongoDB connexion échouée — fallback JSON:', err.message);
    });
} else {
  console.warn('⚠️  MONGO_URI absent — persistance JSON seule');
}

setInterval(async () => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  let purgedCount = 0;

  // ── Purge dans le tableau en mémoire ──────────────────────
  posts.forEach(post => {
    if (post.ipLoggedAt && new Date(post.ipLoggedAt) < thirtyDaysAgo && post.ip) {
      post.ip = null;
      post.ipLoggedAt = null;
      purgedCount++;
    }
  });

  // ── Purge dans MongoDB ─────────────────────────────────────
  if (typeof mongoReady !== 'undefined' && mongoReady) {
    try {
      const result = await PostModel.updateMany(
        { ipLoggedAt: { $lt: thirtyDaysAgo }, ip: { $ne: null } },
        { $set: { ip: null, ipLoggedAt: null } }
      );
      purgedCount += result.modifiedCount || 0;
    } catch (err) {
      console.error('❌ Erreur purge IPs MongoDB:', err);
    }
  }

  if (purgedCount > 0) {
    console.log(`🧹 [PURGE IP] ${purgedCount} adresse(s) IP supprimée(s) — ${new Date().toISOString()}`);
  }
}, 60 * 60 * 1000); // toutes les heures


async function loadPostsFromMongo() {
  try {
    const docs = await PostModel.find({}).sort({ pinned: -1, createdAt: -1 }).lean();
    if (docs.length > 0) {
      posts = docs.map(d => ({ ...d, id: d._id }));
      console.log(`📦 ${posts.length} posts chargés depuis MongoDB`);
    }
  } catch (err) {
    console.error('❌ loadPostsFromMongo:', err.message);
  }
}

async function saveToDB(post) {
  if (!mongoReady) return;
  try {
    const doc = { ...post, _id: String(post.id) };
    delete doc.id;
    await PostModel.findOneAndUpdate({ _id: doc._id }, doc, { upsert: true, after: true });
  } catch (err) {
    console.error('❌ saveToDB:', err.message);
  }
}

async function deleteFromDB(id) {
  if (!mongoReady) return;
  try {
    await PostModel.deleteOne({ _id: String(id) });
  } catch (err) {
    console.error('❌ deleteFromDB:', err.message);
  }
}

async function savePostsToFile() {
  try {
    await fsPromises.writeFile(postsFile, JSON.stringify(posts, null, 2));
  } catch (err) {
    console.error('❌ savePostsToFile:', err.message);
  }
}

async function persistPost(post) {
  await savePostsToFile();
  await saveToDB(post);
}

async function unpersistPost(id) {
  posts = posts.filter(p => String(p.id) !== String(id));
  await savePostsToFile();
  await deleteFromDB(id);
}

process.on("uncaughtException", err => console.error("❌ Exception non attrapée:", err));
process.on("unhandledRejection", err => console.error("❌ Rejection non faite:", err));

const app = express();

app.set('trust proxy', 1);

app.use((req, res, next) => {
  console.log(`[REQ] ${new Date().toISOString()} ${req.method} ${req.originalUrl} Origin=${req.headers.origin || 'none'}`);
  next();
});

app.get('/ping', (req, res) => {
  res.set('x-server', 'oifeel-server');
  res.json({ ok: true, time: Date.now() });
});

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    const allowedHosts = [
      "https://oifeel.netlify.app",
      "http://127.0.0.1:5500",
      "http://127.0.0.1:5501",
      "http://127.0.0.1:5502",
      "http://127.0.0.1:5503",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:10000",
      "https://moodshare-7dd7.onrender.com"
    ];
    const localhostsRegex = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.1\.21)(:\d+)?$/;

    if (localhostsRegex.test(origin) || allowedHosts.includes(origin)) {
      return callback(null, true);
    }
    console.log("❌ Bloqué par le CORS:", origin);
    return callback(new Error("Non accepté par le CORS"));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Admin-Secret']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(helmet());
app.use(express.json());
app.use(cookieParser());
app.use(bodyParser.json());

app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query?.token === 'string' ? req.query.token : null;

  if ((authHeader && authHeader.startsWith('Bearer ')) || queryToken) {
    const token = queryToken || authHeader.substring(7);
    try {
      const decoded = jwtService.verify(token);
      req.user = { id: decoded.id || decoded.userId };
    } catch (err) {
      // invalid token, ignore
    }
  }

  next();
});
let sseClients = [];
// ============================================================
// SESSION — Configuration avec MongoDB store
// ============================================================
const { MongoStore } = require('connect-mongo');

app.use(session({
  secret: process.env.SESSION_SECRET,
  admin_pwd: process.env.ADMIN_PASSWORD,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: MONGO_URI,
    touchAfter: 24 * 3600,
    ttl: 7 * 24 * 60 * 60
  }),
  proxy: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));

app.use((req, res, next) => {
  console.log(`[SESSION] ${req.method} ${req.path} - Session ID: ${req.sessionID} - User: ${req.session?.user?.id || 'none'}`);
  next();
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  skip: (req, res) => {
    if (req.path.startsWith('/api/admin')) return true;
    if (req.path === '/api/stream') return true;
    if (req.path === '/api/notifications/stream') return true;
    if (req.path.startsWith('/api/auth')) return true;
    return false;
  }
});

function isAdminSecretRequest(req) {
  return !!process.env.ADMIN_SECRET && req.headers['x-admin-secret'] === process.env.ADMIN_SECRET;
}

app.use(generalLimiter);

app.use((req, res, next) => {
  if (!config.maintenance) return next();
  const isAdminRequest = isAdminSecretRequest(req);
  const allowed = isAdminRequest || req.path.startsWith('/api/admin') || req.path === '/api/maintenance' || req.path === '/api/stream' || req.path === '/api/notifications/stream';
  if (allowed) return next();
  if (req.path.startsWith('/api')) {
    return res.status(503).json({ error: 'Site en maintenance', maintenance: true });
  }
  next();
});

const dataDir = path.join(__dirname, "data");
const postsFile = path.join(dataDir, "posts.json");
const configFile = path.join(dataDir, "config.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function safeLoadJSON(filePath, fallback, label) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("Not an array");
      console.log(`✅ ${label}: ${parsed.length} entrées chargées`);
      return parsed;
    }
  } catch (err) {
    console.error(`❌ ${label} corrompu (${err.message}) — réinitialisation`);
    try { fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2)); } catch (_) { }
  }
  return fallback;
}

function safeLoadJSONFile(filePath, fallback, label) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        console.log(`✅ ${label} chargé`);
        return parsed;
      }
      throw new Error("Not an object");
    }
  } catch (err) {
    console.error(`❌ ${label} corrompu (${err.message}) — réinitialisation`);
    try { fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2)); } catch (_) { }
  }
  return fallback;
}

let config = { maintenance: false };

posts = safeLoadJSON(postsFile, posts, "posts.json");

let stories = [];
const storiesFile = path.join(dataDir, "stories.json");
stories = safeLoadJSON(storiesFile, stories, "stories.json");

let reports = [];
const reportsFile = path.join(dataDir, "reports.json");
reports = safeLoadJSON(reportsFile, reports, "reports.json");

config = safeLoadJSONFile(configFile, config, "config.json");

async function saveConfig() {
  try {
    await fsPromises.writeFile(configFile, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('❌ Erreur sauvegarde config:', err);
  }
}


function sendSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(c => {
    try { c.res.write(payload); } catch (err) { console.error('❌ Erreur envoi SSE:', err); }
  });
}
function sanitizePostForPublic(post) {
  const { ip, ipLoggedAt, ...safe } = post;
  return safe;
}

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  const clientId = `${Date.now()}_${Math.random()}`;
  sseClients.push({ id: clientId, res });

  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  res.write(`event: initial_posts\ndata: ${JSON.stringify(posts)}\n\n`);
  res.write(`event: initial_stories\ndata: ${JSON.stringify(stories)}\n\n`);

  req.on('close', () => { sseClients = sseClients.filter(c => c.id !== clientId); });
});

app.get("/api/stories", (req, res) => {
  try {
    const now = Date.now();
    const active = stories.filter(s => !s.expiresAt || new Date(s.expiresAt).getTime() > now);

    const expiredExists = stories.length !== active.length;
    if (expiredExists) {
      stories = active;
      fsPromises.writeFile(storiesFile, JSON.stringify(stories, null, 2)).catch(err => {
        console.error("❌ Erreur lors de la sauvegarde des stories après la purge:", err);
      });
      try { sendSSE('stories_update', stories); } catch (e) { console.error('❌ Erreur SSE:', e); }
    }

    res.json(active);
  } catch (err) {
    console.error("❌ Erreur lors de la récupération des stories:", err);
    res.status(500).json({ error: "Erreur interne" });
  }
});

app.get("/api/posts", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '200', 10)));
  const sort = req.query.sort || 'recent'; // recent | popular | trending

  let result = [...posts];

  const start = (page - 1) * limit;
  let paged = result.slice(start, start + limit);
  paged = await attachAuthorThemes(paged);
  res.json(paged.map(sanitizePostForPublic));
});

function sanitizeText(text) {
  if (!text) return "";
  const forbiddenPattern = /(script|javascript:|onerror=|onclick=|onload=|<iframe|<img|<svg|document\.|window\.)/i;
  if (forbiddenPattern.test(text)) {
    throw new Error("Contenu interdit detecté");
  }
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const THEME_FONTS = ['default', 'elegant', 'hand', 'round', 'mono', 'display'];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// Valide/nettoie un thème de compte envoyé par le client. Renvoie
// uniquement les champs valides ; ignore silencieusement le reste
// plutôt que de rejeter toute la requête pour une seule valeur invalide.
function sanitizeTheme(theme, fallback) {
  const base = fallback && typeof fallback === 'object'
    ? { accentColor: fallback.accentColor, font: fallback.font }
    : { accentColor: '#5f95b9', font: 'default' };

  if (!theme || typeof theme !== 'object') return base;

  const out = { ...base };
  if (typeof theme.accentColor === 'string' && HEX_COLOR_RE.test(theme.accentColor)) {
    out.accentColor = theme.accentColor;
  }
  if (typeof theme.font === 'string' && THEME_FONTS.includes(theme.font)) {
    out.font = theme.font;
  }
  return out;
}

// Attache le thème public de l'auteur (`authorTheme`) à une liste de posts,
// via un seul lookup groupé — jamais pour les posts publiés en anonyme,
// pour ne pas laisser la personnalisation trahir l'identité de l'auteur.
async function attachAuthorThemes(postsArr) {
  const ids = [...new Set(
    postsArr.filter(p => p && !p.anonymous && p.userId).map(p => p.userId)
  )];
  if (!ids.length) return postsArr;

  try {
    const authors = await UserModel.find({ _id: { $in: ids } }).select('theme').lean();
    const themeById = new Map(authors.map(a => [a._id, a.theme || null]));
    return postsArr.map(p => {
      if (!p || p.anonymous || !p.userId) return p;
      const theme = themeById.get(p.userId);
      return theme ? { ...p, authorTheme: theme } : p;
    });
  } catch (err) {
    console.error('❌ Erreur attachAuthorThemes:', err);
    return postsArr; // en cas d'erreur, on renvoie les posts sans thème plutôt que de faire échouer la requête
  }
}

// Construit un objet track "propre" à partir de ce que le client envoie,
// pour ne jamais stocker/renvoyer de champs arbitraires non prévus.
function sanitizeTrack(track) {
  if (!track || typeof track !== "object") return null;
  const preview = typeof track.preview === "string" ? track.preview : null;
  if (!preview) return null; // sans extrait audio, pas d'intérêt à garder le morceau
  return {
    title: sanitizeText(String(track.title || "").slice(0, 120)),
    artist: sanitizeText(String(track.artist || "").slice(0, 120)),
    cover: typeof track.cover === "string" ? track.cover.slice(0, 500) : null,
    trackId: track.trackId ? String(track.trackId).slice(0, 30) : null,
    preview: preview.slice(0, 500),
    link: typeof track.link === "string" ? track.link.slice(0, 500) : null
  };
}

app.post("/api/posts", async (req, res) => {
  try {

    const cleanText = sanitizeText(req.body.text);
    const cleanEmoji = sanitizeText(req.body.emoji);
    const cleanTrack = sanitizeTrack(req.body.track);
    // 1. Capturer l'IP (APRÈS les lignes const cleanText / cleanEmoji)
    const clientIp =
      (req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip']
        || req.socket?.remoteAddress
        || null);

    const userId = req.session?.user?.id || req.user?.id || null;
    const isAnon = !!req.body.anonymous;
    const userName = isAnon ? 'Anonyme' : (req.session?.user?.displayName || req.body.userName || 'Anonyme');

    const newPost = {
      text: cleanText,
      emoji: cleanEmoji,
      color: req.body.color,
      textColor: req.body.textColor,
      stickerUrl: req.body.stickerUrl || null,
      track: cleanTrack,
      anonymous: isAnon,
      id: Date.now().toString(),
      userId: isAnon ? null : userId,
      userName,
      likes: 0,
      views: 0,
      reactions: {},
      pinned: false,
      aiGenerated: !!req.body.aiGenerated,
      ephemeral: !!req.body.ephemeral,
      expiresAt: req.body.expiresAt || null,
      createdAt: new Date().toISOString(),
      ip: clientIp,
      ipLoggedAt: new Date().toISOString()
    };

    posts.unshift(newPost);
    await persistPost(newPost);

    // Attache le thème de l'auteur pour un affichage immédiat (sans attendre
    // un refetch du feed), sauf si le post est publié en anonyme.
    const [newPostWithTheme] = await attachAuthorThemes([newPost]);

    try { sendSSE('new_post', sanitizePostForPublic(newPostWithTheme)); } catch (e) { console.error('❌ Erreur SSE:', e); }

    // Incrémenter postsCount
    if (!isAnon && userId && mongoReady) {
      UserModel.findByIdAndUpdate(userId, { $inc: { postsCount: 1 } }).catch(() => { });
    }

    res.status(201).json(sanitizePostForPublic(newPostWithTheme));
  } catch (err) {
    return res.status(400).json({ error: "Contenu invalide" });
  }
});

// ============================================================
// IA — GÉNÉRATION DE TEXTE DE POST (Groq)
// Limite: 3 générations / semaine / IP, pour dissuader l'abus
// (le backend Render n'a pas la puissance pour faire tourner un agent en local)
// ============================================================
const AI_WEEKLY_LIMIT = 3;
const AI_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function getClientIp(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown');
}

app.get('/api/ai/usage', async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const now = new Date();
    const windowStart = new Date(now.getTime() - AI_WINDOW_MS);

    let recentRequests;
    if (mongoReady) {
      const usage = await AiUsageModel.findById(clientIp).lean();
      recentRequests = (usage?.requests || []).map(d => new Date(d)).filter(d => d > windowStart);
    } else {
      recentRequests = (aiUsageMemory.get(clientIp) || []).filter(d => d > windowStart);
    }

    const remaining = Math.max(0, AI_WEEKLY_LIMIT - recentRequests.length);
    let retryAt = null;
    if (remaining === 0 && recentRequests.length) {
      const oldest = recentRequests.slice().sort((a, b) => a - b)[0];
      retryAt = new Date(oldest.getTime() + AI_WINDOW_MS).toISOString();
    }

    res.json({ remaining, limit: AI_WEEKLY_LIMIT, retryAt });
  } catch (err) {
    console.error('❌ Erreur usage IA:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/ai/generate-post', async (req, res) => {
  try {
    if (!process.env.GROQ_API) {
      return res.status(503).json({ error: "La génération IA n'est pas configurée pour le moment." });
    }

    const clientIp = getClientIp(req);
    const now = new Date();
    const windowStart = new Date(now.getTime() - AI_WINDOW_MS);

    let recentRequests;
    if (mongoReady) {
      const usage = await AiUsageModel.findById(clientIp).lean();
      recentRequests = (usage?.requests || []).map(d => new Date(d)).filter(d => d > windowStart);
    } else {
      recentRequests = (aiUsageMemory.get(clientIp) || []).filter(d => d > windowStart);
    }

    if (recentRequests.length >= AI_WEEKLY_LIMIT) {
      const oldest = recentRequests.slice().sort((a, b) => a - b)[0];
      const retryAt = new Date(oldest.getTime() + AI_WINDOW_MS);
      return res.status(429).json({
        error: `Limite atteinte : ${AI_WEEKLY_LIMIT} générations IA par semaine. Réessaie après le ${retryAt.toLocaleDateString('fr-FR')} à ${retryAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`,
        retryAt: retryAt.toISOString()
      });
    }

    // On enregistre la tentative AVANT l'appel à Groq pour empêcher le contournement par rafale
    recentRequests.push(now);

    if (mongoReady) {
      await AiUsageModel.findByIdAndUpdate(
        clientIp,
        { _id: clientIp, requests: recentRequests },
        { upsert: true }
      );
    } else {
      aiUsageMemory.set(clientIp, recentRequests);
    }

    const hint = String(req.body?.hint || '').trim().slice(0, 200);

    const userPrompt = hint
      ? `Écris une courte publication (15 à 35 mots), à la première personne, sincère et naturelle, sur le thème ou l'humeur suivante : "${hint}". Pas de hashtags, pas d'emoji, pas de guillemets dans la réponse. Réponds uniquement avec le texte du post.`
      : `Écris une courte publication (15 à 35 mots) à la première personne, exprimant une humeur ou un ressenti du moment, sincère et naturel, avec un ton varié (joyeux, mélancolique, drôle, motivant, fatigué, etc. au choix). Pas de hashtags, pas d'emoji, pas de guillemets dans la réponse. Réponds uniquement avec le texte du post.`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: "Tu es un générateur de courtes publications pour oifeel., un réseau social anonyme où les gens partagent leur humeur du moment. Tu réponds toujours en français, uniquement avec le texte du post demandé, sans aucun texte additionnel ni introduction." },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.9,
        max_tokens: 120
      })
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text().catch(() => '');
      console.error('❌ Erreur Groq:', groqRes.status, errText);
      return res.status(502).json({ error: "Le générateur IA est momentanément indisponible, réessaie plus tard." });
    }

    const groqData = await groqRes.json();
    let generatedText = groqData?.choices?.[0]?.message?.content || '';
    generatedText = generatedText.trim().replace(/^["'«»]+|["'«»]+$/g, '').slice(0, 200);

    if (!generatedText) {
      return res.status(502).json({ error: "L'IA n'a rien généré, réessaie." });
    }

    res.json({
      text: generatedText,
      remaining: Math.max(0, AI_WEEKLY_LIMIT - recentRequests.length)
    });
  } catch (err) {
    console.error('❌ Erreur génération IA:', err);
    res.status(500).json({ error: "Erreur serveur lors de la génération IA." });
  }
});

// ============================================================
// MUSIQUE — recherche de morceaux via l'API Deezer (proxy serveur)
// Deezer ne gère pas le CORS pour les appels navigateur, et Spotify
// ne fournit plus les preview_url en 30s depuis nov. 2024 : on passe
// donc par Deezer, qui reste gratuit, sans clé, et fournit un vrai
// extrait mp3 de 30s par morceau (champ "preview").
// ============================================================
app.get('/api/music/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (!q) return res.json({ results: [] });

    const deezerRes = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=15`);

    if (!deezerRes.ok) {
      console.error('❌ Erreur Deezer:', deezerRes.status);
      return res.status(502).json({ error: "Recherche musicale indisponible pour le moment." });
    }

    const deezerData = await deezerRes.json();

    const results = (deezerData?.data || [])
      .filter(t => t.preview) // uniquement les morceaux avec un extrait 30s exploitable
      .slice(0, 12)
      .map(t => ({
        trackId: String(t.id),
        title: t.title,
        artist: t.artist?.name || '',
        cover: t.album?.cover_medium || t.album?.cover || null,
        preview: t.preview,
        link: t.link || null
      }));

    res.json({ results });
  } catch (err) {
    console.error('❌ Erreur recherche musique:', err);
    res.status(500).json({ error: "Erreur serveur lors de la recherche musicale." });
  }
});

app.get('/api/music/preview/:trackId', async (req, res) => {
  try {
    const trackId = String(req.params.trackId || '').match(/^\d+$/)?.[0];
    if (!trackId) return res.status(400).json({ error: 'Identifiant de morceau invalide.' });

    const deezerRes = await fetch(`https://api.deezer.com/track/${trackId}`);
    if (!deezerRes.ok) return res.status(502).json({ error: 'Extrait musical indisponible.' });

    const track = await deezerRes.json();
    if (!track?.preview) return res.status(404).json({ error: 'Aucun extrait disponible.' });
    res.json({ preview: track.preview });
  } catch (err) {
    console.error('❌ Erreur résolution preview Deezer:', err);
    res.status(502).json({ error: 'Extrait musical indisponible.' });
  }
});

app.post('/api/posts/:id/report', async (req, res) => {
  try {
    const targetPost = posts.find(p => p.id == req.params.id);
    if (!targetPost) return res.status(404).json({ error: 'Post non trouvé' });

    const { reason = '' } = req.body;
    const report = {
      id: Date.now().toString(),
      postId: req.params.id,
      reason: String(reason).slice(0, 1000),
      createdAt: new Date().toISOString()
    };

    reports.unshift(report);
    await fsPromises.writeFile(reportsFile, JSON.stringify(reports, null, 2));
    try { sendSSE('report', report); } catch (e) { console.error('❌ Erreur SSE:', e); }

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Erreur de signalement:', err);
    res.status(500).json({ error: 'Interne' });
  }
});

app.post('/api/posts/:id/repost', async (req, res) => {
  try {
    const orig = posts.find(p => p.id == req.params.id);
    if (!orig) return res.status(404).json({ error: 'Post non trouvé' });

    const newPost = {
      text: orig.text,
      emoji: orig.emoji,
      color: orig.color,
      textColor: orig.textColor,
      track: orig.track || null,
      id: Date.now().toString(),
      likes: 0,
      aiGenerated: !!orig.aiGenerated,
      repostedFrom: orig.id,
      createdAt: new Date().toISOString()
    };

    posts.unshift(newPost);
    await fsPromises.writeFile(postsFile, JSON.stringify(posts, null, 2));
    try { sendSSE('new_post', newPost); } catch (e) { console.error('❌ Erreur SSE:', e); }

    res.status(201).json(newPost);
  } catch (err) {
    console.error('❌ Erreur de republication:', err);
    res.status(500).json({ error: 'Interne' });
  }
});

app.post("/api/stories", async (req, res) => {
  try {
    const text = String(req.body.text || "").trim();
    const emoji = String(req.body.emoji || "").trim();
    const color = req.body.color || "#ffffff";
    const textColor = req.body.textColor || null;
    const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt).toISOString() : null;

    if (!text && !emoji) {
      return res.status(400).json({ error: "Story vide" });
    }

    const cleanText = sanitizeText(text);
    const cleanEmoji = sanitizeText(emoji);

    const newStory = {
      id: Date.now().toString(),
      text: cleanText,
      emoji: cleanEmoji,
      color,
      ...(textColor ? { textColor } : {}),
      createdAt: new Date().toISOString(),
      expiresAt
    };

    stories.unshift(newStory);
    await fsPromises.writeFile(storiesFile, JSON.stringify(stories, null, 2));
    try { sendSSE('new_story', newStory); } catch (e) { console.error('❌ Erreur SSE:', e); }

    res.status(201).json(newStory);
  } catch (err) {
    console.error("❌ Erreur lors de la création de la story:", err);
    res.status(400).json({ error: "Contenu Invalide" });
  }
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  if (req.user.id.startsWith('guest_')) {
    return res.json({ user: { id: req.user.id, displayName: 'Invité' } });
  }

  try {
    const user = await UserModel.findById(req.user.id);
    if (!user) return res.status(401).json({ error: "User not found" });
    const banData = checkBanSync(user);
    if (banData) return res.status(403).json({ error: "Banni", banData });
    res.json({ user: { id: user._id, displayName: user.displayName, googleLinked: !!user.googleId } });
  } catch (err) {
    console.error('Error getting current user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post("/api/posts/:id/like", async (req, res) => {
  const post = posts.find(p => p.id == req.params.id);
  if (!post) return res.status(404).json({ error: "Post non trouvé" });

  post.likes++;
  await persistPost(post);

  // Envoyer notification SSE au propriétaire du post
  if (post.userId) {
    const actorId = req.session?.user?.id || req.user?.id || null;
    let actorName = req.session?.user?.displayName || 'Quelqu\'un';

    if (actorId && mongoReady && actorName === 'Quelqu\'un') {
      const actor = await UserModel.findById(actorId).select('displayName').lean().catch(() => null);
      if (actor?.displayName) actorName = actor.displayName;
    }

    if (!actorId || String(post.userId) !== String(actorId)) {
      createNotification(
        post.userId,
        'like',
        actorName,
        'a aimé ton post',
        { postId: post.id, actorId }
      ).catch(() => { });
    }
  }
  res.json(post);
});

app.post("/api/posts/:id/unlike", async (req, res) => {
  const post = posts.find(p => p.id == req.params.id);
  if (!post) return res.status(404).json({ error: "Post non trouvé" });

  post.likes = Math.max(0, post.likes - 1);
  await persistPost(post);
  res.json(post);
});

app.post("/api/posts/:id/share", async (req, res) => {
  try {
    const originalPost = posts.find(p => p.id == req.params.id);
    if (!originalPost) return res.status(404).json({ error: "Post non trouvé" });

    if (!req.session?.user) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const sharedPost = {
      id: Date.now().toString(),
      text: req.body.text || `📤 Partagé par ${req.session.user.displayName}`,
      color: originalPost.color,
      emoji: originalPost.emoji,
      date: new Date().toLocaleDateString('fr-FR'),
      userId: req.session.user.id,
      userName: req.session.user.displayName,
      likes: 0,
      ephemeral: false,
      sharedFrom: {
        id: originalPost.id,
        userName: originalPost.userName || 'Anonyme',
        text: originalPost.text,
        emoji: originalPost.emoji,
        color: originalPost.color
      }
    };

    posts.unshift(sharedPost);
    await savePostsToFile();
    await persistPost(sharedPost);
    sendSSE('new_post', sharedPost);

    res.json(sharedPost);
  } catch (err) {
    console.error('❌ Erreur share:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// ROUTES SOCIALES — avec MongoDB
// ============================================================

// ============================================================
// AUTH MIDDLEWARE — accepte session ET JWT Bearer token
// ============================================================
async function requireAuth(req, res, next) {
  // 1. JWT présent → priorité (fiable même en cross-domain, contrairement au cookie de session)
  if (req.user?.id) {
    try {
      const userId = req.user.id;
      if (userId.startsWith('guest_')) {
        req.session.user = { id: userId, displayName: 'Invité', isGuest: true };
        return next();
      }
      if (!mongoReady) return res.status(503).json({ error: 'DB non disponible' });
      const user = await UserModel.findById(userId).lean();
      if (!user) return res.status(401).json({ error: 'Non authentifié' });
      const banData = checkBanSync(user);
      if (banData) return res.status(403).json({ error: 'Banni', banData });
      req.session.user = { id: user._id, displayName: user.displayName }; // resynchronise la session
      return next();
    } catch (err) {
      console.error('❌ requireAuth JWT hydration error:', err);
      return res.status(401).json({ error: 'Non authentifié' });
    }
  }

  // 2. Pas de JWT → on retombe sur la session (cas où le front n'envoie pas de token)
  if (req.session?.user?.id) {
    const banData = await checkBan(req.session.user.id);
    if (banData) return res.status(403).json({ error: 'Banni', banData });
    return next();
  }

  return res.status(401).json({ error: 'Non authentifié' });
}

async function checkBan(userId) {
  if (!mongoReady) return null;
  try {
    const user = await UserModel.findById(userId).select('bannedUntil permanentlyBanned bannedReason').lean();
    return checkBanSync(user);
  } catch (err) {
    console.error('❌ Erreur checkBan:', err);
    return null;
  }
}

function checkBanSync(user) {
  if (!user) return null;
  if (user.permanentlyBanned) {
    return { reason: user.bannedReason || 'Ban définitif', permanent: true };
  }
  if (user.bannedUntil && user.bannedUntil > new Date()) {
    return { reason: user.bannedReason || 'Ban temporaire', until: user.bannedUntil, permanent: false };
  }
  return null;
}

// GET /api/social/profile/:userId — Profil utilisateur
app.get("/api/social/profile/:userId", async (req, res) => {
  try {
    const targetUserId = req.params.userId;
    const currentUserId = req.session?.user?.id || req.user?.id || null;

    console.log(`📌 GET /api/social/profile/${targetUserId} - Current user: ${currentUserId}`);

    // Chercher l'utilisateur dans MongoDB
    let targetUser = await UserModel.findById(targetUserId).lean();

    // Si pas trouvé, créer un user temporaire
    if (!targetUser) {
      console.log(`⚠️ User ${targetUserId} non trouvé, création temporaire`);
      targetUser = {
        _id: targetUserId,
        displayName: 'Utilisateur',
        avatar: '👤',
        bio: 'Bienvenue sur oifeel.!',
        postsCount: 0,
        followersCount: 0,
        followingCount: 0,
        followers: [],
        following: [],
        theme: { accentColor: '#5f95b9', font: 'default' }
      };
    }

    // Vérifier si le user courant suit ce profil
    let isFollowing = false;
    let isOwnProfile = false;

    if (currentUserId) {
      const currentUser = await UserModel.findById(currentUserId);
      if (currentUser) {
        isFollowing = (currentUser.following || []).includes(targetUserId);
        isOwnProfile = currentUserId === targetUserId;
      }
    }

    // Récupérer les posts de cet utilisateur
    const userPosts = await PostModel.find({ userId: targetUserId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({
      user: {
        ...targetUser,
        isFollowing,
        isOwnProfile,
        postsCount: userPosts.length
      },
      posts: userPosts.map(p => ({ ...p, id: p._id }))
    });

  } catch (error) {
    console.error('❌ Erreur /api/social/profile:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});

// PUT /api/social/profile - Modifier son profil
app.put("/api/social/profile", requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.user.id;
    const { displayName, avatar, bio, theme } = req.body;

    const user = await UserModel.findById(currentUserId);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    if (bio !== undefined) user.bio = bio.substring(0, 200);
    if (avatar !== undefined) user.avatar = avatar.substring(0, 10);
    if (displayName !== undefined) {
      user.displayName = displayName.substring(0, 50);
      req.session.user.displayName = user.displayName;
    }
    if (theme !== undefined) {
      user.theme = sanitizeTheme(theme, user.theme);
    }

    await user.save();
    await new Promise((resolve, reject) => {
      req.session.save(err => err ? reject(err) : resolve());
    });

    res.json({
      success: true,
      user: {
        id: user._id,
        displayName: user.displayName,
        bio: user.bio,
        avatar: user.avatar,
        theme: user.theme
      }
    });
  } catch (error) {
    console.error('❌ Erreur PUT /api/social/profile:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/social/follow/:userId
// ── POST /api/social/link-code — Génère un code à 6 chiffres pour lier le
// compte Discord (à appeler depuis l'app, bouton "Lier Discord" dans les
// réglages). Le code expire après 10 minutes et n'est utilisable qu'une fois.
// ──────────────────────────────────────────────────────────────────────────
const pendingDiscordLinks = new Map(); // code -> { userId, expiresAt }

app.post('/api/social/link-code', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    // Un seul code actif par utilisateur : on invalide un éventuel code précédent
    for (const [code, data] of pendingDiscordLinks) {
      if (data.userId === userId) pendingDiscordLinks.delete(code);
    }
    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 chiffres
    pendingDiscordLinks.set(code, { userId, expiresAt: Date.now() + 10 * 60 * 1000 });
    res.json({ code, expiresIn: 600 });
  } catch (err) {
    console.error('❌ Erreur génération code Discord:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /api/social/discord-status — le compte de la session courante a-t-il
// un Discord lié ? Utilisé par le front pour afficher "Compte lié !" à la
// place du bouton, et par le modal pour détecter la confirmation en direct.
app.get('/api/social/discord-status', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const link = await DiscordLinkModel.findOne({ userId }).lean();
    res.json({
      linked: !!link,
      discordId: link?._id || null,
      linkedAt: link?.linkedAt || null
    });
  } catch (err) {
    console.error('❌ Erreur /api/social/discord-status:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── DELETE /api/social/discord-link — délier le compte Discord ──
app.delete('/api/social/discord-link', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    await DiscordLinkModel.deleteOne({ userId });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Erreur suppression lien Discord:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/social/follow/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.session.user.id;

    if (userId === currentUserId) {
      return res.status(400).json({ error: 'Impossible de se suivre soi-même' });
    }

    const [currentUser, targetUser] = await Promise.all([
      UserModel.findById(currentUserId),
      UserModel.findById(userId)
    ]);

    if (!targetUser) return res.status(404).json({ error: 'Utilisateur introuvable' });

    if (currentUser.following.includes(userId)) {
      return res.status(400).json({ error: 'Déjà suivi' });
    }

    currentUser.following.push(userId);
    currentUser.followingCount = currentUser.following.length;

    targetUser.followers.push(currentUserId);
    targetUser.followersCount = targetUser.followers.length;

    await Promise.all([currentUser.save(), targetUser.save()]);

    createNotification(
      userId,
      'follow',
      currentUser.displayName || 'Quelqu\'un',
      'te suit maintenant',
      { actorId: currentUserId }
    ).catch(() => { });

    console.log(`✅ ${currentUser.displayName} suit maintenant ${targetUser.displayName}`);

    res.json({
      success: true,
      followersCount: targetUser.followersCount,
      followingCount: currentUser.followingCount
    });
  } catch (err) {
    console.error('❌ Erreur follow:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/social/unfollow/:userId
app.post('/api/social/unfollow/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.session.user.id;

    const [currentUser, targetUser] = await Promise.all([
      UserModel.findById(currentUserId),
      UserModel.findById(userId)
    ]);

    if (!targetUser) return res.status(404).json({ error: 'Utilisateur introuvable' });

    currentUser.following = currentUser.following.filter(id => id !== userId);
    currentUser.followingCount = currentUser.following.length;

    targetUser.followers = targetUser.followers.filter(id => id !== currentUserId);
    targetUser.followersCount = targetUser.followers.length;

    await Promise.all([currentUser.save(), targetUser.save()]);



    console.log(`✅ ${currentUser.displayName} ne suit plus ${targetUser.displayName}`);

    res.json({
      success: true,
      followersCount: targetUser.followersCount,
      followingCount: currentUser.followingCount
    });
  } catch (err) {
    console.error('❌ Erreur unfollow:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/social/favorite/:postId
app.post('/api/social/favorite/:postId', requireAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const currentUserId = req.session.user.id;

    const user = await UserModel.findById(currentUserId);
    if (!user.favorites.includes(postId)) {
      user.favorites.push(postId);
      await user.save();
    }

    res.json({ success: true, favoritesCount: user.favorites.length });
  } catch (err) {
    console.error('❌ Erreur favorite:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/social/unfavorite/:postId
app.post('/api/social/unfavorite/:postId', requireAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const currentUserId = req.session.user.id;

    const user = await UserModel.findById(currentUserId);
    user.favorites = user.favorites.filter(id => id !== postId);
    await user.save();

    res.json({ success: true, favoritesCount: user.favorites.length });
  } catch (err) {
    console.error('❌ Erreur unfavorite:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/social/favorites
app.get('/api/social/favorites', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.user.id;
    const user = await UserModel.findById(currentUserId);

    const favPosts = await PostModel.find({
      _id: { $in: user.favorites }
    }).sort({ createdAt: -1 }).lean();

    res.json({ posts: favPosts.map(p => ({ ...p, id: p._id })) });
  } catch (err) {
    console.error('❌ Erreur get favorites:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/social/suggestions
app.get('/api/social/suggestions', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.user.id;
    const currentUser = await UserModel.findById(currentUserId);

    const suggestions = await UserModel.find({
      _id: {
        $ne: currentUserId,
        $nin: currentUser.following || []
      },
      isGuest: false
    })
      .select('_id displayName verified bio avatar followersCount')
      .sort({ followersCount: -1, createdAt: -1 })
      .limit(5)
      .lean();

    res.json({ suggestions });
  } catch (err) {
    console.error('❌ Erreur suggestions:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/social/followers/:userId
app.get('/api/social/followers/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await UserModel.findById(userId);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const followers = await UserModel.find({
      _id: { $in: user.followers || [] }
    }).select('_id displayName verified avatar').lean();

    res.json({ followers });
  } catch (err) {
    console.error('❌ Erreur followers:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/social/following/:userId
app.get('/api/social/following/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await UserModel.findById(userId);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const following = await UserModel.find({
      _id: { $in: user.following || [] }
    }).select('_id displayName verified avatar').lean();

    res.json({ following });
  } catch (err) {
    console.error('❌ Erreur following:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/social/feed
app.get('/api/social/feed', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.user.id;
    const currentUser = await UserModel.findById(currentUserId);

    const friendsIds = [...(currentUser.following || []), currentUserId];

    const friendsPosts = await PostModel.find({
      userId: { $in: friendsIds }
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const otherPosts = await PostModel.find({
      userId: { $nin: friendsIds }
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const favorites = currentUser.favorites || [];
    const allPosts = [...friendsPosts, ...otherPosts].map(p => ({
      ...p,
      id: p._id,
      isFavorite: favorites.includes(p._id),
      isFromFriend: friendsIds.includes(p.userId)
    }));

    res.json({ posts: allPosts });
  } catch (err) {
    console.error('❌ Erreur feed:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// ADMIN ROUTES
// ============================================================

function requireAdmin(req, res, next) {
  // Méthode 1 : token JWT admin (nouvelle méthode sécurisée)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwtService.verify(token);
      if (decoded.role === 'admin') {
        return next();
      }
    } catch (err) {
      // token invalide ou expiré
    }
  }

  // Méthode 2 : X-Admin-Secret (rétrocompatibilité)
  const secret = process.env.ADMIN_SECRET;
  if (secret) {
    const provided = req.headers['x-admin-secret'];
    if (provided && provided === secret) {
      return next();
    }
  }

  console.warn('🚫 Tentative d\'accès admin refusée');
  return res.status(403).json({ error: 'Accès refusé' });
}

app.post('/api/admin/posts/pinned', requireAdmin, async (req, res) => {
  try {
    const { text, emoji, color, textColor, pinnedLabel } = req.body;
    if (!text && !emoji) return res.status(400).json({ error: 'Post vide' });

    const cleanText = sanitizeText(String(text || ''));
    const cleanEmoji = sanitizeText(String(emoji || ''));

    const pinnedPost = {
      id: 'pinned_' + Date.now().toString(),
      text: cleanText,
      emoji: cleanEmoji,
      color: String(color || '#000000').slice(0, 20),
      textColor: String(textColor || '#ffffff').slice(0, 20),
      pinnedLabel: String(pinnedLabel || 'Annonce').slice(0, 60),
      pinned: true,
      likes: 0,
      ephemeral: false,
      expiresAt: null,
      createdAt: new Date().toISOString()
    };

    posts.unshift(pinnedPost);
    await persistPost(pinnedPost);
    try { sendSSE('new_post', pinnedPost); } catch (e) { console.error('❌ Erreur SSE:', e); }

    console.log(`📌 [ADMIN] Post épinglé créé: ${pinnedPost.id}`);
    res.status(201).json(pinnedPost);
  } catch (err) {
    console.error('❌ Erreur création post épinglé:', err);
    res.status(400).json({ error: err.message || 'Erreur interne' });
  }
});

app.get('/api/admin/posts/pinned', requireAdmin, (req, res) => {
  res.json(posts.filter(p => p.pinned));
});

app.delete('/api/admin/posts/pinned/:id', requireAdmin, async (req, res) => {
  try {
    const post = posts.find(p => String(p.id) === String(req.params.id) && p.pinned);
    if (!post) return res.status(404).json({ error: 'Post épinglé non trouvé' });

    await unpersistPost(post.id);
    try { sendSSE('post_deleted', { id: post.id }); } catch (e) { console.error('❌ Erreur SSE:', e); }

    console.log(`🗑️  [ADMIN] Post épinglé ${post.id} supprimé`);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Erreur suppression post épinglé:', err);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

app.delete('/api/admin/posts/:id', requireAdmin, async (req, res) => {
  try {
    const post = posts.find(p => String(p.id) === String(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post non trouvé' });

    await unpersistPost(post.id);
    try { sendSSE('post_deleted', { id: post.id }); } catch (e) { console.error('❌ Erreur SSE:', e); }

    console.log(`🗑️  [ADMIN] Post ${post.id} supprimé`);
    res.json({ ok: true, deleted: post.id });
  } catch (err) {
    console.error('❌ Erreur suppression admin:', err);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

app.put('/api/admin/posts/:id', requireAdmin, async (req, res) => {
  try {
    const post = posts.find(p => String(p.id) === String(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post non trouvé' });

    const { text, emoji, color, textColor } = req.body;
    if (text !== undefined) post.text = sanitizeText(String(text));
    if (emoji !== undefined) post.emoji = sanitizeText(String(emoji));
    if (color !== undefined) post.color = String(color).slice(0, 20);
    if (textColor !== undefined) post.textColor = String(textColor).slice(0, 20);
    post.editedAt = new Date().toISOString();

    await persistPost(post);
    try { sendSSE('post_update', post); } catch (e) { console.error('❌ Erreur SSE:', e); }

    console.log(`✏️  [ADMIN] Post ${post.id} modifié`);
    res.json(post);
  } catch (err) {
    console.error('❌ Erreur modification admin:', err);
    res.status(400).json({ error: err.message || 'Erreur interne' });
  }
});

app.get('/api/admin/reports', requireAdmin, (req, res) => {
  try {
    res.json(reports);
  } catch (err) {
    console.error('❌ Erreur récupération reports admin:', err);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await UserModel.find({})
      .select('_id displayName verified avatar isGuest email emailNotifications createdAt followersCount followingCount postsCount bannedUntil bannedReason permanentlyBanned').lean();

    res.json(users.map((u) => ({
      id: u._id,
      displayName: u.displayName,
      verified: u.verified || false,
      avatar: u.avatar,
      isGuest: u.isGuest,
      email: u.email || null,
      emailNotifications: u.emailNotifications || {},
      hasEmailConsent: !!(u.emailNotifications?.announcements || u.emailNotifications?.updates),
      createdAt: u.createdAt,
      followersCount: u.followersCount || 0,
      followingCount: u.followingCount || 0,
      postsCount: u.postsCount || 0,
      bannedUntil: u.bannedUntil,
      bannedReason: u.bannedReason,
      permanentlyBanned: u.permanentlyBanned,
    })));
  } catch (err) {
    console.error('❌ Erreur récupération users admin:', err);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// POST /api/admin/login — Authentification admin sécurisée
// Le mot de passe n'est JAMAIS renvoyé au frontend.
// On compare avec ADMIN_PASSWORD_HASH (sha256 du mot de passe) stocké dans les env vars Render.
// Pour générer le hash : node -e "const c=require('crypto');console.log(c.createHash('sha256').update('VOTRE_MDP').digest('hex'))"
app.post('/api/admin/login', (req, res) => {
  const { id, password } = req.body;

  if (!id || !password) {
    return res.status(400).json({ error: 'Identifiants manquants' });
  }

  // Accepte uniquement l'id "rmladmin"
  if (id !== 'rmladmin') {
    console.warn('🚫 [ADMIN LOGIN] Mauvais identifiant:', id);
    return res.status(403).json({ error: 'Identifiants incorrects' });
  }

  const expectedHash = process.env.ADMIN_PASSWORD_HASH;
  if (!expectedHash) {
    console.error('❌ [ADMIN LOGIN] ADMIN_PASSWORD_HASH non défini dans les variables d\'environnement');
    return res.status(503).json({ error: 'Admin non configuré' });
  }

  const providedHash = crypto.createHash('sha256').update(password).digest('hex');

  if (providedHash !== expectedHash) {
    console.warn('🚫 [ADMIN LOGIN] Mauvais mot de passe pour:', id);
    return res.status(403).json({ error: 'Identifiants incorrects' });
  }

  // Générer un token admin JWT valable 8 heures
  const adminToken = jwtService.sign({ adminId: id, role: 'admin' }, '8h');

  console.log('✅ [ADMIN LOGIN] Connexion admin réussie pour:', id);
  res.json({ token: adminToken });
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await UserModel.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    console.log(`🗑️  [ADMIN] Utilisateur ${req.params.id} supprimé`);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Erreur suppression utilisateur admin:', err);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

app.put('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
  try {
    const { duration, reason, permanent } = req.body;
    const user = await UserModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    if (permanent) {
      user.permanentlyBanned = true;
      user.bannedReason = reason || 'Ban définitif';
      user.bannedUntil = null;
    } else {
      const banDuration = duration || 60; // minutes par défaut
      user.bannedUntil = new Date(Date.now() + banDuration * 60 * 1000);
      user.bannedReason = reason || `Ban temporaire de ${banDuration} minutes`;
      user.permanentlyBanned = false;
    }

    await user.save();
    console.log(`🚫 [ADMIN] Utilisateur ${req.params.id} banni: ${user.bannedReason}`);
    res.json({ ok: true, bannedUntil: user.bannedUntil, permanentlyBanned: user.permanentlyBanned });
  } catch (err) {
    console.error('❌ Erreur ban utilisateur admin:', err);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

app.put('/api/admin/users/:id/unban', requireAdmin, async (req, res) => {
  try {
    const user = await UserModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    user.bannedUntil = null;
    user.permanentlyBanned = false;
    user.bannedReason = '';
    await user.save();

    console.log(`✅ [ADMIN] Utilisateur ${req.params.id} débanni`);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Erreur déban utilisateur admin:', err);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

app.delete('/api/admin/reports/:id', requireAdmin, async (req, res) => {
  try {
    const idx = reports.findIndex(r => r.id == req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Signalement non trouvé' });

    reports.splice(idx, 1);
    await fsPromises.writeFile(reportsFile, JSON.stringify(reports, null, 2));

    console.log(`✅ [ADMIN] Signalement ${req.params.id} supprimé`);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Erreur suppression report admin:', err);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

app.get('/api/maintenance', (req, res) => {
  res.json({ maintenance: !!config.maintenance });
});

app.post('/api/admin/maintenance', requireAdmin, async (req, res) => {
  try {
    const enabled = req.body?.enabled === true || req.body?.enabled === 'true';
    config.maintenance = enabled;
    await saveConfig();
    console.log(`🛠️  [ADMIN] Mode maintenance ${enabled ? 'activé' : 'désactivé'}`);
    res.json({ maintenance: config.maintenance });
  } catch (err) {
    console.error('❌ Erreur mise à jour mode maintenance:', err);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

app.get('/api/admin/status', requireAdmin, (req, res) => {
  const uptime = Math.floor(process.uptime());
  const environment = process.env.RENDER ? 'Render' : 'Local';

  res.json({
    ok: true,
    environment,
    uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`,
    uptimeSeconds: uptime,
    mongodb: {
      connected: mongoReady,
      uri: MONGO_URI ? '✅ Configuré' : '❌ Non configuré',
      status: mongoReady ? '✅ Connecté' : '❌ Déconnecté'
    },
    database: {
      posts: posts.length,
      stories: stories.length,
      reports: reports.length,
      pinned: posts.filter(p => p.pinned).length
    },
    node: {
      version: process.version,
      platform: process.platform,
      memory: {
        used: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
        total: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)} MB`
      }
    },
    api: {
      corsEnabled: true,
      adminSecretConfigured: !!process.env.ADMIN_SECRET,
      rateLimit: '500 req/15min'
    },
    maintenance: !!config.maintenance,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/admin/emergency-restart', requireAdmin, async (req, res) => {
  console.log('🚨 [EMERGENCY] Redémarrage d\'urgence initié par admin');

  try {
    const closedCount = sseClients.length;
    sseClients.forEach(c => {
      try { c.res.end(); } catch (_) { }
    });
    sseClients = [];
    console.log(`✅ [EMERGENCY] ${closedCount} clients SSE fermés`);

    if (MONGO_URI && mongoReady) {
      try {
        await mongoose.connection.db.admin().ping();
        console.log('✅ [EMERGENCY] MongoDB ping OK');
      } catch (err) {
        console.warn('⚠️ [EMERGENCY] MongoDB ping échoué:', err.message);
      }
    }

    res.json({
      ok: true,
      message: 'Redémarrage d\'urgence effectué',
      actions: {
        sseClientsReset: closedCount,
        mongoChecked: !!MONGO_URI,
        timestamp: new Date().toISOString()
      }
    });

    console.log('✅ [EMERGENCY] Redémarrage d\'urgence complété');
  } catch (err) {
    console.error('❌ [EMERGENCY] Erreur:', err.message);
    res.status(500).json({
      error: 'Erreur lors du redémarrage d\'urgence',
      details: err.message
    });
  }
});

app.get('/api/admin/emergency-restart', (req, res) => {
  console.warn('🚫 [EMERGENCY] Tentative GET sur emergency-restart (méthode non autorisée)');
  res.status(405).json({ error: 'Méthode non autorisée - utilisez POST' });
});

// ============================================================
// AUTH ROUTES
// ============================================================
const crypto = require('crypto');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function checkUserBan(user) {
  if (user.permanentlyBanned) {
    return { banned: true, reason: user.bannedReason || 'Ban définitif', permanent: true };
  }
  if (user.bannedUntil && user.bannedUntil > new Date()) {
    return { banned: true, reason: user.bannedReason || 'Ban temporaire', until: user.bannedUntil, permanent: false };
  }
  return { banned: false };
}

// ============================================================
// 2FA — codes OTP éphémères (email) et connexions en attente
// Stockage en mémoire : suffisant car durée de vie de quelques minutes.
// Si tu fais tourner plusieurs instances du serveur (scaling horizontal),
// remplace ça par Redis pour partager l'état entre instances.
// ============================================================
const otpStore = new Map();       // key -> { hash, expiresAt, attempts, meta, lastSentAt }
const pendingLogins = new Map();  // pendingToken -> { userId, method, expiresAt }

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of otpStore) if (val.expiresAt < now) otpStore.delete(key);
  for (const [key, val] of pendingLogins) if (val.expiresAt < now) pendingLogins.delete(key);
}, 5 * 60 * 1000);

function generateOtpCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function storeOtp(key, code, meta = {}, ttlMs = 10 * 60 * 1000) {
  otpStore.set(key, { hash: hashOtp(code), expiresAt: Date.now() + ttlMs, attempts: 0, meta, lastSentAt: Date.now() });
}

function verifyOtp(key, code) {
  const entry = otpStore.get(key);
  if (!entry) return { ok: false, reason: 'expired' };
  if (entry.expiresAt < Date.now()) { otpStore.delete(key); return { ok: false, reason: 'expired' }; }
  if (entry.attempts >= 5) { otpStore.delete(key); return { ok: false, reason: 'too_many_attempts' }; }
  entry.attempts++;
  if (entry.hash !== hashOtp(code)) return { ok: false, reason: 'invalid' };
  otpStore.delete(key);
  return { ok: true, meta: entry.meta };
}

async function sendEmailOtp(user, code) {
  await sendBrevoEmail({
    to: user.email,
    toName: user.displayName,
    subject: 'Ton code de vérification oifeel.',
    html: `<p>Voici ton code de vérification :</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>Ce code expire dans 10 minutes. Si tu n'es pas à l'origine de cette demande, ignore cet email.</p>`
  });
}


app.use("/api/auth", (req, res, next) => {
  console.log("🔐 [Auth] %s %s", req.method, req.path);
  next();
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { displayName, password } = req.body;

    if (!displayName || !password) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    if (!mongoReady) {
      return res.status(503).json({ error: 'Base de données non disponible' });
    }

    const newUser = new UserModel({
      _id: Date.now().toString(),
      displayName,
      password: hashPassword(password),
      createdAt: new Date(),
      lastLogin: new Date()
    });

    await newUser.save();

    req.session.user = {
      id: newUser._id,
      displayName: newUser.displayName,
    };

    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log('✅ User registered:', 'Session ID:', req.sessionID);
    res.json({
      user: {
        id: newUser._id,
        displayName: newUser.displayName,
      }
    });
  } catch (err) {
    console.error('❌ Register error:', err);
    res.status(500).json({ error: 'Erreur inscription' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { displayName, password } = req.body;

    if (!displayName || !password) {
      return res.status(400).json({ error: 'Pseudo et mot de passe requis' });
    }

    if (!mongoReady) {
      return res.status(503).json({ error: 'Base de données non disponible' });
    }

    const user = await UserModel.findOne({
      $or: [
        { displayName: { $regex: new RegExp(`^${displayName}$`, 'i') } }
      ]
    });

    if (!user || user.password !== hashPassword(password)) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    // Vérifier si l'utilisateur est banni
    const banStatus = checkUserBan(user);
    if (banStatus.banned) {
      return res.status(403).json({
        error: 'Compte banni',
        banned: true,
        reason: banStatus.reason,
        until: banStatus.until,
        permanent: banStatus.permanent
      });
    }

    user.lastLogin = new Date();
    user.lastLoginIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || req.socket?.remoteAddress || null;
    user.lastLoginIpAt = new Date();
    await user.save();

    // ── 2FA activé : on ne crée pas de session tout de suite, on demande le code ──
    if (user.twoFactor?.enabled && user.twoFactor?.method) {
      const method = user.twoFactor.method;
      const pendingToken = crypto.randomBytes(24).toString('hex');
      pendingLogins.set(pendingToken, { userId: user._id, method, expiresAt: Date.now() + 10 * 60 * 1000 });

      try {
        if (method === 'email') {
          const code = generateOtpCode();
          storeOtp(`login:${pendingToken}`, code);
          await sendEmailOtp(user, code);
        }
        // méthode 'totp' : rien à envoyer, le code vient de l'appli d'authentification
      } catch (sendErr) {
        console.error('❌ Erreur envoi code 2FA:', sendErr);
        return res.status(500).json({ error: 'Impossible d\'envoyer le code de vérification. Réessaye plus tard.' });
      }

      console.log(`🔐 [2FA] Code requis pour ${user.displayName} via ${method}`);
      return res.json({ requires2FA: true, method, pendingToken });
    }

    req.session.user = {
      id: user._id,
      displayName: user.displayName,
    };

    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log('✅ User logged in:', 'Session ID:', req.sessionID);
    res.json({
      user: {
        id: user._id,
        displayName: user.displayName,
      },
      token: jwtService.sign({ id: user._id }, '7d')
    });
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ error: 'Erreur connexion' });
  }
});

// ── POST /api/auth/login/2fa/verify — Étape 2 de la connexion (code OTP/TOTP) ──
app.post('/api/auth/login/2fa/verify', async (req, res) => {
  try {
    const { pendingToken, code } = req.body;
    if (!pendingToken || !code) {
      return res.status(400).json({ error: 'Code requis' });
    }

    const pending = pendingLogins.get(pendingToken);
    if (!pending || pending.expiresAt < Date.now()) {
      pendingLogins.delete(pendingToken);
      return res.status(400).json({ error: 'Session de connexion expirée, reconnecte-toi.' });
    }

    if (!mongoReady) return res.status(503).json({ error: 'Base de données non disponible' });

    const user = await UserModel.findById(pending.userId).select('+twoFactor.totpSecret');
    if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });

    let valid = false;
    if (pending.method === 'totp') {
      if (totpReady() && user.twoFactor?.totpSecret) {
        const checkResult = await otpVerify({ secret: user.twoFactor.totpSecret, token: String(code).trim() });
        valid = checkResult.valid;
      }
    } else {
      const result = verifyOtp(`login:${pendingToken}`, String(code).trim());
      valid = result.ok;
    }

    if (!valid) {
      return res.status(401).json({ error: 'Code invalide ou expiré' });
    }

    pendingLogins.delete(pendingToken);

    const banStatus = checkUserBan(user);
    if (banStatus.banned) {
      return res.status(403).json({ error: 'Compte banni', banned: true, reason: banStatus.reason, until: banStatus.until, permanent: banStatus.permanent });
    }

    req.session.user = { id: user._id, displayName: user.displayName };
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    console.log('✅ User logged in (2FA):', 'Session ID:', req.sessionID);
    res.json({
      user: { id: user._id, displayName: user.displayName },
      token: jwtService.sign({ id: user._id }, '7d')
    });
  } catch (err) {
    console.error('❌ 2FA verify error:', err);
    res.status(500).json({ error: 'Erreur vérification' });
  }
});

// ── POST /api/auth/login/2fa/resend — Renvoyer le code (email uniquement) ──
app.post('/api/auth/login/2fa/resend', async (req, res) => {
  try {
    const { pendingToken } = req.body;
    const pending = pendingLogins.get(pendingToken);
    if (!pending || pending.expiresAt < Date.now()) {
      return res.status(400).json({ error: 'Session de connexion expirée, reconnecte-toi.' });
    }
    if (pending.method === 'totp') {
      return res.status(400).json({ error: 'Les codes d\'authentificateur se renouvellent automatiquement, rien à renvoyer.' });
    }

    const existing = otpStore.get(`login:${pendingToken}`);
    if (existing && Date.now() - existing.lastSentAt < 30 * 1000) {
      return res.status(429).json({ error: 'Attends quelques secondes avant de redemander un code.' });
    }

    const user = await UserModel.findById(pending.userId);
    if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });

    const code = generateOtpCode();
    storeOtp(`login:${pendingToken}`, code);
    if (pending.method === 'email') await sendEmailOtp(user, code);

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ 2FA resend error:', err);
    res.status(500).json({ error: 'Erreur lors du renvoi du code' });
  }
});

app.post('/api/auth/guest', async (req, res) => {
  try {
    const guestId = 'guest_' + Date.now();

    if (mongoReady) {
      const guestUser = new UserModel({
        _id: guestId,
        displayName: 'Invité',
        password: hashPassword(Math.random().toString()),
        isGuest: true,
        createdAt: new Date(),
        lastLogin: new Date()
      });
      await guestUser.save().catch(() => { });
    }

    req.session.user = { id: guestId, displayName: 'Invité', isGuest: true };

    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log('✅ Guest login:', guestId, 'Session ID:', req.sessionID);
    res.json({
      user: { id: guestId, displayName: 'Invité' },
      token: jwtService.sign({ id: guestId }, '7d')
    });
  } catch (err) {
    console.error('❌ Guest error:', err);
    res.status(500).json({ error: 'Erreur connexion invité' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// ============================================================
// 2FA — gestion (activation / désactivation) depuis les réglages du compte
// Toutes ces routes nécessitent d'être connecté (requireAuth).
// ============================================================

function maskEmail(email) {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

function maskPhone(phone) {
  if (!phone) return null;
  return phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4);
}

// ── GET /api/auth/2fa/status ──
app.get('/api/auth/2fa/status', requireAuth, async (req, res) => {
  try {
    const user = await UserModel.findById(req.session.user.id).lean();
    if (!user) return res.status(401).json({ error: 'Non authentifié' });
    res.json({
      enabled: !!user.twoFactor?.enabled,
      method: user.twoFactor?.method || null,
      email: maskEmail(user.email),
      emailVerified: !!user.twoFactor?.emailVerified,
      phone: maskPhone(user.twoFactor?.phone),
      phoneVerified: !!user.twoFactor?.phoneVerified
    });
  } catch (err) {
    console.error('❌ 2FA status error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── TOTP (Google Authenticator) ──────────────────────────────
app.post('/api/auth/2fa/totp/start', requireAuth, async (req, res) => {
  try {
    if (!totpReady() || !QRCode) {
      return res.status(503).json({ error: 'TOTP indisponible côté serveur (dépendance otplib/qrcode mal installée). Contacte l\'administrateur.' });
    }
    const user = await UserModel.findById(req.session.user.id);
    if (!user) return res.status(401).json({ error: 'Non authentifié' });

    const secret = otpGenerateSecret();
    otpStore.set(`totp-setup:${user._id}`, { hash: null, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0, meta: { secret } });

    const otpauthUrl = otpGenerateURI({ issuer: 'oifeel.', label: user.displayName, secret });
    const qrCode = await QRCode.toDataURL(otpauthUrl);

    res.json({ secret, qrCode });
  } catch (err) {
    console.error('❌ TOTP start error:', err);
    res.status(500).json({ error: 'Erreur lors de la génération du QR code' });
  }
});

app.post('/api/auth/2fa/totp/verify', requireAuth, async (req, res) => {
  try {
    if (!totpReady()) {
      return res.status(503).json({ error: 'TOTP indisponible côté serveur (dépendance otplib mal installée). Contacte l\'administrateur.' });
    }
    const { code } = req.body;
    const pending = otpStore.get(`totp-setup:${req.session.user.id}`);
    if (!pending || pending.expiresAt < Date.now()) {
      return res.status(400).json({ error: 'Session d\'activation expirée, recommence.' });
    }
    const checkResult = await otpVerify({ secret: pending.meta.secret, token: String(code || '').trim() });
    if (!checkResult.valid) {
      return res.status(401).json({ error: 'Code invalide' });
    }

    const user = await UserModel.findById(req.session.user.id);
    if (!user) return res.status(401).json({ error: 'Non authentifié' });

    user.twoFactor = user.twoFactor || {};
    user.twoFactor.totpSecret = pending.meta.secret;
    user.twoFactor.method = 'totp';
    user.twoFactor.enabled = true;
    await user.save();

    otpStore.delete(`totp-setup:${req.session.user.id}`);
    console.log(`🔐 [2FA] TOTP activé pour ${user.displayName}`);
    res.json({ ok: true, method: 'totp' });
  } catch (err) {
    console.error('❌ TOTP verify error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'activation' });
  }
});

// ── Email OTP ─────────────────────────────────────────────────
app.post('/api/auth/2fa/email/start', requireAuth, async (req, res) => {
  try {
    let { email } = req.body;
    const user = await UserModel.findById(req.session.user.id);
    if (!user) return res.status(401).json({ error: 'Non authentifié' });

    email = (email || user.email || '').toLowerCase().trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Adresse email invalide' });
    }

    const code = generateOtpCode();
    storeOtp(`email-setup:${user._id}`, code, { email });
    await sendBrevoEmail({
      to: email,
      toName: user.displayName,
      subject: 'Confirme ton adresse email — oifeel.',
      html: `<p>Voici ton code de confirmation :</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>Ce code expire dans 10 minutes.</p>`
    });

    res.json({ ok: true, sentTo: maskEmail(email) });
  } catch (err) {
    console.error('❌ Email 2FA start error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'envoi du code' });
  }
});

app.post('/api/auth/2fa/email/verify', requireAuth, async (req, res) => {
  try {
    const { code } = req.body;
    const result = verifyOtp(`email-setup:${req.session.user.id}`, String(code || '').trim());
    if (!result.ok) {
      const messages = { expired: 'Code expiré, redemande-en un.', too_many_attempts: 'Trop de tentatives, redemande un code.', invalid: 'Code invalide' };
      return res.status(400).json({ error: messages[result.reason] || 'Code invalide' });
    }

    const user = await UserModel.findById(req.session.user.id);
    if (!user) return res.status(401).json({ error: 'Non authentifié' });

    user.email = result.meta.email;
    user.twoFactor = user.twoFactor || {};
    user.twoFactor.emailVerified = true;
    user.twoFactor.method = 'email';
    user.twoFactor.enabled = true;
    await user.save();

    console.log(`🔐 [2FA] Email activé pour ${user.displayName}`);
    res.json({ ok: true, method: 'email' });
  } catch (err) {
    console.error('❌ Email 2FA verify error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'activation' });
  }
});


// ── Désactivation du 2FA (confirmation par mot de passe) ──────
app.post('/api/auth/2fa/disable', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Mot de passe requis pour désactiver le 2FA' });

    const user = await UserModel.findById(req.session.user.id);
    if (!user) return res.status(401).json({ error: 'Non authentifié' });
    if (user.password !== hashPassword(password)) {
      return res.status(401).json({ error: 'Mot de passe incorrect' });
    }

    user.twoFactor.enabled = false;
    user.twoFactor.method = null;
    await user.save();

    console.log(`🔓 [2FA] Désactivé pour ${user.displayName}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ 2FA disable error:', err);
    res.status(500).json({ error: 'Erreur lors de la désactivation' });
  }
});

// ============================================================
// MESSAGING ROUTES
// ============================================================

function getConversationId(userId1, userId2) {
  return [userId1, userId2].sort().join('_');
}

app.get('/api/conversations', requireAuth, async (req, res) => {
  try {
    if (!mongoReady) {
      return res.status(503).json({ error: 'DB non disponible' });
    }

    const userId = req.session.user.id;

    const conversations = await ConversationModel.find({
      participants: userId
    }).sort({ lastMessageAt: -1 }).lean();

    res.json(conversations);
  } catch (err) {
    console.error('❌ Get conversations error:', err);
    res.status(500).json({ error: 'Erreur récupération conversations' });
  }
});

app.get('/api/conversations/:otherUserId', requireAuth, async (req, res) => {
  try {
    if (!mongoReady) {
      return res.status(503).json({ error: 'DB non disponible' });
    }

    const userId = req.session.user.id;
    const otherUserId = req.params.otherUserId;
    const convId = getConversationId(userId, otherUserId);

    let conversation = await ConversationModel.findById(convId).lean();

    if (!conversation) {
      const otherUser = await UserModel.findById(otherUserId);
      if (!otherUser) {
        return res.status(404).json({ error: 'Utilisateur introuvable' });
      }

      conversation = {
        _id: convId,
        participants: [userId, otherUserId],
        participantNames: {
          [userId]: req.session.user.displayName,
          [otherUserId]: otherUser.displayName
        },
        messages: [],
        lastMessageAt: new Date(),
        updatedAt: new Date()
      };
    }

    res.json(conversation);
  } catch (err) {
    console.error('❌ Get conversation error:', err);
    res.status(500).json({ error: 'Erreur récupération conversation' });
  }
});

app.post('/api/conversations/:otherUserId/messages', requireAuth, async (req, res) => {
  try {
    if (!mongoReady) {
      return res.status(503).json({ error: 'DB non disponible' });
    }

    const userId = req.session.user.id;
    const otherUserId = req.params.otherUserId;
    const { content, sharedPostId, stickerUrl, encrypted } = req.body;
    const safeStickerUrl = typeof stickerUrl === 'string' && stickerUrl.trim() ? stickerUrl.trim() : null;
    const safeContent = typeof content === 'string' ? content.trim() : '';

    if (!safeContent && !sharedPostId && !safeStickerUrl) {
      return res.status(400).json({ error: 'message, sticker ou post requis' });
    }

    const convId = getConversationId(userId, otherUserId);

    let conversation = await ConversationModel.findById(convId);

    if (!conversation) {
      const otherUser = await UserModel.findById(otherUserId);
      if (!otherUser) {
        return res.status(404).json({ error: 'Utilisateur introuvable' });
      }

      conversation = new ConversationModel({
        _id: convId,
        participants: [userId, otherUserId],
        participantNames: new Map([
          [userId, req.session.user.displayName],
          [otherUserId, otherUser.displayName]
        ]),
        messages: []
      });
    }

    const newMessage = {
      senderId: userId,
      senderName: req.session.user.displayName,
      content: safeContent || '',
      encrypted: !!encrypted,
      sharedPostId: sharedPostId || null,
      stickerUrl: safeStickerUrl,
      timestamp: new Date()
    };

    conversation.messages.push(newMessage);
    if (conversation.messages.length > 50) {
      conversation.messages = conversation.messages.slice(-50);
    }

    conversation.lastMessageAt = new Date();
    conversation.updatedAt = new Date();

    await conversation.save();

    await createNotification(otherUserId, 'message',
      `${req.session.user.displayName}`,
      sharedPostId ? 'a partagé un post' : safeStickerUrl ? 'a envoyé un sticker' : safeContent,
      { senderId: userId, conversationId: convId }
    );

    try {
      sendSSE('new_message', {
        conversationId: convId,
        message: newMessage,
        participants: conversation.participants
      });
    } catch (e) {
      console.error('❌ SSE broadcast failed:', e);
    }

    res.json({ message: newMessage, conversation });
  } catch (err) {
    console.error('❌ Send message error:', err);
    res.status(500).json({ error: 'Erreur envoi message' });
  }
});

// ============================================================
// NOTIFICATIONS ROUTES
// ============================================================
const notifClients = new Map();

function pushNotif(userId, notif) {
  const clients = notifClients.get(String(userId));
  if (!clients) return;

  for (const client of [...clients]) {
    try {
      client.write(`data: ${JSON.stringify(notif)}\n\n`);
    } catch (_) {
      clients.delete(client);
    }
  }

  if (clients.size === 0) {
    notifClients.delete(String(userId));
  }
}
async function createNotification(userId, type, title, body, data = {}) {
  if (!mongoReady || !userId) return null;

  try {
    const notification = new NotificationModel({
      _id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId: String(userId),
      type,
      title,
      body,
      data,
      read: false,
      createdAt: new Date()
    });

    await notification.save();

    const payload = {
      id: notification._id,
      _id: notification._id,
      userId: notification.userId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      message: notification.body,
      actorName: notification.title,
      read: notification.read,
      createdAt: notification.createdAt,
      ...notification.data
    };

    pushNotif(userId, payload);

    const user = await UserModel.findById(userId);
    if (user && user.pushTokens && user.pushTokens.length > 0) {
      // TODO: sendPushNotification(user.pushTokens, title, body, data);
    }

    return payload;
  } catch (err) {
    console.error('❌ Create notification error:', err);
    return null;
  }
}

app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    if (!mongoReady) {
      return res.status(503).json({ error: 'DB non disponible' });
    }

    const userId = req.session.user.id;
    const notifications = await NotificationModel.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json(notifications);
  } catch (err) {
    console.error('❌ Get notifications error:', err);
    res.status(500).json({ error: 'Erreur récupération notifications' });
  }
});

app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    if (!mongoReady) {
      return res.status(503).json({ error: 'DB non disponible' });
    }

    const notifId = req.params.id;
    await NotificationModel.findByIdAndUpdate(notifId, { read: true });

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Mark read error:', err);
    res.status(500).json({ error: 'Erreur marquage notification' });
  }
});
// server.cjs
app.get('/api/notifications/stream', requireAuth, (req, res) => {
  const userId = String(req.session?.user?.id || req.user?.id || '');
  if (!userId) return res.status(401).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();

  if (!notifClients.has(userId)) {
    notifClients.set(userId, new Set());
  }

  notifClients.get(userId).add(res);

  res.write(`data: ${JSON.stringify({ type: 'connected', ok: true })}\n\n`);

  const ping = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
  }, 20000);

  req.on('close', () => {
    clearInterval(ping);
    const clients = notifClients.get(userId);
    if (!clients) return;
    clients.delete(res);
    if (clients.size === 0) notifClients.delete(userId);
  });
});
app.post('/api/users/push-token', requireAuth, async (req, res) => {
  try {
    if (!mongoReady) {
      return res.status(503).json({ error: 'DB non disponible' });
    }

    const userId = req.session.user.id;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token requis' });
    }

    await UserModel.findByIdAndUpdate(userId, {
      $addToSet: { pushTokens: token }
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Save push token error:', err);
    res.status(500).json({ error: 'Erreur enregistrement token' });
  }
});

// ============================================================
// E2E ENCRYPTION — Gestion des clés publiques
// ============================================================

// POST /api/users/public-key — Enregistrer sa clé publique ECDH
// Accepte session OU JWT Bearer (pas requireAuth strict pour éviter race condition startup)
app.post('/api/users/public-key', async (req, res) => {
  try {
    // Résoudre l'userId depuis session ou JWT
    const userId = req.session?.user?.id || req.user?.id;
    if (!userId) {
      console.warn('⚠️  POST /users/public-key — non authentifié');
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const { publicKey } = req.body;
    if (!publicKey || typeof publicKey !== 'string') {
      return res.status(400).json({ error: 'Clé publique invalide' });
    }
    if (publicKey.length > 8192) {
      return res.status(400).json({ error: 'Clé publique trop longue' });
    }

    if (!mongoReady) {
      // MongoDB pas prêt → on accepte quand même (le client retentera)
      console.warn('⚠️  POST /users/public-key — MongoDB pas prêt, clé non sauvegardée');
      return res.status(503).json({ error: 'DB non disponible', retryable: true });
    }

    const result = await UserModel.findByIdAndUpdate(
      userId,
      { publicKey },
      { new: true, select: 'publicKey' }
    );

    if (!result) {
      console.warn(`⚠️  POST /users/public-key — user ${userId} introuvable`);
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    console.log(`🔑 Clé E2E enregistrée pour user ${userId}`);
    res.json({ ok: true, registered: true });
  } catch (err) {
    console.error('❌ Erreur lors de l\'enregistrement de la clé publique:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/users/:userId/public-key — Lire la clé publique d'un utilisateur
// Retourne 200 + { publicKey: null } si pas encore enregistrée (pas de 404)
app.get('/api/users/:userId/public-key', async (req, res) => {
  try {
    if (!mongoReady) {
      // Fallback: pas d'erreur, juste null
      return res.json({ publicKey: null, registered: false });
    }

    const user = await UserModel.findById(req.params.userId)
      .select('publicKey')
      .lean();

    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    // Retourner null si pas de clé — le client gèrera gracieusement
    res.json({
      publicKey: user.publicKey || null,
      registered: !!user.publicKey
    });
  } catch (err) {
    console.error('❌ Get public key error:', err);
    res.json({ publicKey: null, registered: false });
  }
});

app.get('/api/users/search', requireAuth, async (req, res) => {
  try {
    if (!mongoReady) {
      return res.status(503).json({ error: 'DB non disponible' });
    }

    const query = req.query.q || '';
    if (query.length < 2) {
      return res.json([]);
    }

    const users = await UserModel.find({
      displayName: { $regex: query, $options: 'i' },
      _id: { $ne: req.session.user.id }
    })
      .select('_id displayName verified')
      .limit(20)
      .lean();

    res.json(users);
  } catch (err) {
    console.error('❌ Search users error:', err);
    res.status(500).json({ error: 'Erreur recherche utilisateurs' });
  }
});

app.get('/api/users/:userId/posts', async (req, res) => {
  try {
    const userId = req.params.userId;
    const userPosts = posts.filter(p => p.userId === userId);
    res.json(userPosts);
  } catch (err) {
    console.error('❌ Get user posts error:', err);
    res.status(500).json({ error: 'Erreur récupération posts' });
  }
});

// ============================================================
// ROUTES V2 — Post unique, vues, réactions, commentaires
// ============================================================

// GET /api/posts/:id — Post unique (pour permalink)
app.get('/api/posts/:id', async (req, res) => {
  const post = posts.find(p => String(p.id) === String(req.params.id));
  if (!post) return res.status(404).json({ error: 'Post non trouvé' });
  const [postWithTheme] = await attachAuthorThemes([post]);
  res.json(sanitizePostForPublic(postWithTheme));
});

// POST /api/posts/:id/view — Incrémenter les vues
app.post('/api/posts/:id/view', async (req, res) => {
  try {
    const post = posts.find(p => String(p.id) === String(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post non trouvé' });

    post.views = (post.views || 0) + 1;

    // Persist en DB en arrière-plan sans bloquer la réponse
    if (mongoReady) {
      PostModel.findByIdAndUpdate(String(post.id), { $inc: { views: 1 } }).catch(() => { });
    }

    res.json({ views: post.views });
  } catch (err) {
    console.error('❌ Erreur lors de l\'incrémentation des vues:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/posts/:id/reactions — Lire les réactions d'un post
app.get('/api/posts/:id/reactions', (req, res) => {
  const post = posts.find(p => String(p.id) === String(req.params.id));
  if (!post) return res.status(404).json({ error: 'Post non trouvé' });

  // reactions est un Map ou objet simple
  const reactions = post.reactions instanceof Map
    ? Object.fromEntries(post.reactions)
    : (post.reactions || {});

  res.json({ reactions });
});

// POST /api/posts/:id/react — Ajouter / changer sa réaction
app.post('/api/posts/:id/react', requireAuth, async (req, res) => {
  try {
    const { type } = req.body;
    const VALID_TYPES = ['heart', 'haha', 'wow', 'sad', 'fire', 'clap'];
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Type de réaction invalide' });
    }

    const post = posts.find(p => String(p.id) === String(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post non trouvé' });

    if (!post.reactions || typeof post.reactions !== 'object') post.reactions = {};
    // Convertir Map Mongoose en objet simple si besoin
    if (post.reactions instanceof Map) {
      post.reactions = Object.fromEntries(post.reactions);
    }

    post.reactions[type] = (post.reactions[type] || 0) + 1;

    // Persist en DB
    if (mongoReady) {
      const updateKey = `reactions.${type}`;
      PostModel.findByIdAndUpdate(String(post.id), { $inc: { [updateKey]: 1 } }).catch(() => { });
    }

    res.json({ reactions: post.reactions });
  } catch (err) {
    console.error('❌ Erreur réaction de post:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/posts/:id/unreact — Retirer sa réaction
app.post('/api/posts/:id/unreact', requireAuth, async (req, res) => {
  try {
    const { type } = req.body;
    const post = posts.find(p => String(p.id) === String(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post non trouvé' });

    if (!post.reactions) post.reactions = {};
    if (post.reactions instanceof Map) post.reactions = Object.fromEntries(post.reactions);

    if (post.reactions[type] > 0) {
      post.reactions[type] = Math.max(0, (post.reactions[type] || 1) - 1);
      if (post.reactions[type] === 0) delete post.reactions[type];

      if (mongoReady) {
        const updateKey = `reactions.${type}`;
        PostModel.findByIdAndUpdate(String(post.id), { $inc: { [updateKey]: -1 } }).catch(() => { });
      }
    }

    res.json({ reactions: post.reactions });
  } catch (err) {
    console.error('❌ unreact error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/posts/:id/comments — Lire les commentaires
app.get('/api/posts/:id/comments', async (req, res) => {
  try {
    const postId = req.params.id;
    const post = posts.find(p => String(p.id) === String(postId));
    if (!post) return res.status(404).json({ error: 'Post non trouvé' });

    if (!mongoReady) {
      return res.json({ comments: [] });
    }

    const comments = await CommentModel.find({ postId: String(postId) })
      .sort({ createdAt: 1 })
      .limit(100)
      .lean();

    res.json({ comments: comments.map(c => ({ ...c, _id: c._id })) });
  } catch (err) {
    console.error('❌ Erreur lors de la récupération des commentaires:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/posts/:id/comments — Ajouter un commentaire
app.post('/api/posts/:id/comments', async (req, res) => {
  try {
    const postId = req.params.id;
    const post = posts.find(p => String(p.id) === String(postId));
    if (!post) return res.status(404).json({ error: 'Post non trouvé' });

    const rawText = String(req.body.text || '').trim();
    if (!rawText) return res.status(400).json({ error: 'Commentaire vide' });
    if (rawText.length > 500) return res.status(400).json({ error: 'Commentaire trop long (max 500)' });

    const cleanText = sanitizeText(rawText);

    // Auteur : session > JWT > body
    const authorId = req.session?.user?.id || req.user?.id || null;
    const author = req.session?.user?.displayName || req.body.author || 'Anonyme';

    const comment = {
      _id: Date.now().toString(),
      postId: String(postId),
      author,
      authorId,
      text: cleanText,
      createdAt: new Date().toISOString()
    };

    if (mongoReady) {
      const doc = new CommentModel(comment);
      await doc.save();
    }

    // Notification au propriétaire du post si connu
    if (post.userId && post.userId !== authorId) {
      // Envoyer SSE notification
      createNotification(
        post.userId,
        'comment',
        author,
        `a commenté : "${cleanText.substring(0, 60)}"`,
        { postId, commentId: comment._id, actorId: authorId }
      ).catch(() => { });
    }

    res.status(201).json({ comment });
  } catch (err) {
    console.error('❌ Erreur commentaire de post:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});


app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});
app.get('/api/users/me', requireAuth, async (req, res) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: 'DB non disponible' });

    const userId = req.session.user.id;
    const user = await UserModel.findById(userId)
      .select('-password -publicKey -pushTokens')
      .lean();

    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    res.json({
      id: user._id,
      displayName: user.displayName,
      email: user.email || null,
      emailNotifications: user.emailNotifications || false,
      bio: user.bio || '',
      avatar: user.avatar || '👤',
      postsCount: user.postsCount || 0,
      followersCount: user.followersCount || 0,
      followingCount: user.followingCount || 0,
      createdAt: user.createdAt,
      isGuest: user.isGuest || false,
      aiPostsPreference: user.aiPostsPreference || 'allow',
      theme: user.theme || { accentColor: '#5f95b9', font: 'default' }
    });
  } catch (err) {
    console.error('❌ Erreur récupération profil:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PATCH /api/users/me/email — Mettre à jour l'e-mail ───────────
app.patch('/api/users/me/email', requireAuth, async (req, res) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: 'DB non disponible' });

    const userId = req.session.user.id;
    const { email, emailNotifications } = req.body;

    // Utiliser $set pour contourner le bug Mongoose où l'assignation directe
    // user.emailNotifications = true (booléen) échoue silencieusement car le
    // schéma attend un objet { announcements, updates }. Mongoose ne lève pas
    // d'erreur mais ne persiste pas le document → email + emailNotifications
    // apparaissent 'undefined' après findById (lu depuis le cache Mongoose).
    const updateFields = {};

    if (email !== undefined) {
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Adresse e-mail invalide' });
      }
      updateFields.email = email || null;
    }

    if (emailNotifications !== undefined) {
      if (typeof emailNotifications === 'boolean') {
        // Frontend envoie un booléen simple → appliquer aux deux sous-champs
        updateFields['emailNotifications.announcements'] = emailNotifications;
        updateFields['emailNotifications.updates'] = emailNotifications;
      } else if (typeof emailNotifications === 'object' && emailNotifications !== null) {
        // Frontend envoie { announcements: bool, updates: bool }
        if (typeof emailNotifications.announcements === 'boolean') {
          updateFields['emailNotifications.announcements'] = emailNotifications.announcements;
        }
        if (typeof emailNotifications.updates === 'boolean') {
          updateFields['emailNotifications.updates'] = emailNotifications.updates;
        }
      }
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    const updated = await UserModel.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true, select: 'email emailNotifications' }
    );

    if (!updated) return res.status(404).json({ error: 'Utilisateur introuvable' });

    console.log(`📧 Email mis à jour pour user ${userId}:`, {
      email: updated.email,
      emailNotifications: updated.emailNotifications
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Erreur mise à jour email:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PATCH /api/users/me/ai-preference — Préférence d'affichage des posts IA ──
app.patch('/api/users/me/ai-preference', requireAuth, async (req, res) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: 'DB non disponible' });

    const userId = req.session.user.id;
    const { preference } = req.body;

    if (!['allow', 'avoid', 'block'].includes(preference)) {
      return res.status(400).json({ error: "Préférence invalide (attendu: allow, avoid ou block)" });
    }

    const updated = await UserModel.findByIdAndUpdate(
      userId,
      { $set: { aiPostsPreference: preference } },
      { new: true, select: 'aiPostsPreference' }
    );

    if (!updated) return res.status(404).json({ error: 'Utilisateur introuvable' });

    res.json({ ok: true, aiPostsPreference: updated.aiPostsPreference });
  } catch (err) {
    console.error('❌ Erreur mise à jour préférence IA:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});


// Mount external routes for user-related endpoints
// (placé APRÈS toutes les routes /api/users/me/* pour éviter le conflit de routing
// qui causait l'erreur CORS sur PATCH /api/users/me/email)
app.use("/api/users", usersRoutes);


// ── PUT /api/auth/change-password — Changer son mot de passe ─────
app.put('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: 'DB non disponible' });

    const userId = req.session.user.id;
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Les deux mots de passe sont requis' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Nouveau mot de passe trop court (6 caractères minimum)' });
    }
    if (oldPassword === newPassword) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit être différent de l\'ancien' });
    }

    const user = await UserModel.findById(userId);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    if (user.isGuest) return res.status(400).json({ error: 'Les comptes invités n\'ont pas de mot de passe' });

    if (user.password !== hashPassword(oldPassword)) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    }

    user.password = hashPassword(newPassword);
    await user.save();

    console.log(`🔑 Mot de passe changé pour user ${userId}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Erreur changement MDP:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});


// ── GET /api/users/me/export — Export RGPD ───────────────────────
app.get('/api/users/me/export', requireAuth, async (req, res) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: 'DB non disponible' });

    const userId = req.session.user.id;

    const [user, userPosts, userComments, userNotifications] = await Promise.all([
      UserModel.findById(userId).select('-password -publicKey -pushTokens').lean(),
      PostModel.find({ userId }).select('-ip -ipLoggedAt').lean(),
      CommentModel.find({ authorId: userId }).lean(),
      NotificationModel.find({ userId }).lean()
    ]);

    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const exportData = {
      exportDate: new Date().toISOString(),
      notice: 'Export RGPD — oifeel. Les adresses IP ne sont pas incluses dans cet export (données de sécurité).',
      user: {
        id: user._id,
        displayName: user.displayName,
        email: user.email || null,
        bio: user.bio,
        avatar: user.avatar,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      },
      posts: userPosts.map(p => ({ ...p, id: p._id })),
      comments: userComments,
      notifications: userNotifications,
      socialStats: {
        followersCount: user.followersCount || 0,
        followingCount: user.followingCount || 0,
        postsCount: user.postsCount || 0
      }
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="oifeel-donnees-${Date.now()}.json"`);
    res.json(exportData);
  } catch (err) {
    console.error('❌ Erreur export données:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});


// ── DELETE /api/auth/account — Supprimer son compte ──────────────
app.delete('/api/auth/account', requireAuth, async (req, res) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: 'DB non disponible' });

    const userId = req.session.user.id;
    const { password } = req.body;

    const user = await UserModel.findById(userId);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    // Vérification du mot de passe (sauf pour les invités)
    if (!user.isGuest) {
      if (!password) {
        return res.status(400).json({ error: 'Mot de passe requis pour confirmer la suppression' });
      }
      if (user.password !== hashPassword(password)) {
        return res.status(401).json({ error: 'Mot de passe incorrect' });
      }
    }

    // Anonymiser les posts (on ne les supprime pas pour garder la cohérence du fil)
    if (mongoReady) {
      await PostModel.updateMany(
        { userId },
        { $set: { userId: null, userName: 'Compte supprimé', anonymous: true, ip: null, ipLoggedAt: null } }
      );
    }
    // Mettre à jour le tableau en mémoire
    posts.forEach(post => {
      if (String(post.userId) === String(userId)) {
        post.userId = null;
        post.userName = 'Compte supprimé';
        post.anonymous = true;
        post.ip = null;
        post.ipLoggedAt = null;
      }
    });

    // Supprimer les notifications, commentaires associés
    await Promise.all([
      NotificationModel.deleteMany({ userId }),
      CommentModel.updateMany({ authorId: userId }, { $set: { author: 'Compte supprimé', authorId: null } })
    ]).catch(() => { });

    // Supprimer l'utilisateur
    await UserModel.findByIdAndDelete(userId);

    // Détruire la session
    req.session.destroy(() => { });

    console.log(`🗑️ Compte supprimé: ${userId}`);
    res.json({ ok: true, message: 'Compte supprimé avec succès' });
  } catch (err) {
    console.error('❌ Erreur suppression compte:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// ── GET /api/auth/google — redirige vers l'écran de connexion Google ──
app.get('/api/auth/google', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state; // protection CSRF

  const url = googleClient.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
    state
  });

  req.session.save(() => res.redirect(url));
});

// ── GET /api/auth/google/callback — Google revient ici avec un code ──
app.get('/api/auth/google/callback', async (req, res) => {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'https://oifeel.netlify.app';
  try {
    const { code, state } = req.query;

    if (!code || state !== req.session.oauthState) {
      return res.redirect(`${FRONTEND_URL}/?authError=invalid_state`);
    }
    delete req.session.oauthState;

    if (!mongoReady) return res.redirect(`${FRONTEND_URL}/?authError=db_unavailable`);

    const { tokens } = await googleClient.getToken(code);
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name } = payload;

    let user = await UserModel.findOne({ googleId });

    if (!user) {
      // Pas encore lié — on regarde si un compte existant a le même email
      user = email ? await UserModel.findOne({ email }) : null;

      if (user) {
        user.googleId = googleId;
      } else {
        user = new UserModel({
          _id: Date.now().toString(),
          displayName: (name || email.split('@')[0]).slice(0, 13),
          password: hashPassword(crypto.randomBytes(32).toString('hex')), // jamais utilisé, comme pour les invités
          email: email || null,
          googleId,
          createdAt: new Date()
        });
      }
    }

    const banStatus = checkUserBan(user);
    if (banStatus.banned) {
      return res.redirect(`${FRONTEND_URL}/?authError=banned`);
    }

    user.lastLogin = new Date();
    user.lastLoginIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || req.socket?.remoteAddress
      || null;
    user.lastLoginIpAt = new Date();
    await user.save();

    req.session.user = { id: user._id, displayName: user.displayName };
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    const token = jwtService.sign({ id: user._id }, '7d');
    res.redirect(`${FRONTEND_URL}/?authToken=${token}`);
  } catch (err) {
    console.error('❌ Google OAuth error:', err);
    res.redirect(`${FRONTEND_URL}/?authError=oauth_failed`);
  }
});

// ── GET /api/admin/posts/:id/ip — Voir l'IP d'un post (admin) ────
app.get('/api/admin/posts/:id/ip', requireAdmin, async (req, res) => {
  try {
    const postId = req.params.id;

    if (mongoReady) {
      const post = await PostModel.findById(postId).select('+ip +ipLoggedAt').lean();
      if (!post) return res.status(404).json({ error: 'Post non trouvé' });

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const expired = post.ipLoggedAt && new Date(post.ipLoggedAt) < thirtyDaysAgo;

      return res.json({
        postId,
        ip: expired ? null : (post.ip || null),
        ipLoggedAt: post.ipLoggedAt || null,
        expired
      });
    }

    // Fallback en mémoire
    const post = posts.find(p => String(p.id) === String(postId));
    if (!post) return res.status(404).json({ error: 'Post non trouvé' });

    res.json({ postId, ip: post.ip || null, ipLoggedAt: post.ipLoggedAt || null, expired: false });
  } catch (err) {
    console.error('❌ Erreur récupération IP admin:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /api/admin/users/:id/ip — Voir l'IP de connexion d'un compte (admin) ──
app.get('/api/admin/users/:id/ip', requireAdmin, async (req, res) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: 'DB non disponible' });

    const userId = req.params.id;
    const user = await UserModel.findById(userId).select('+lastLoginIp +lastLoginIpAt').lean();
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const expired = user.lastLoginIpAt && new Date(user.lastLoginIpAt) < thirtyDaysAgo;

    return res.json({
      userId,
      ip: expired ? null : (user.lastLoginIp || null),
      loggedAt: user.lastLoginIpAt || null,
      expired
    });
  } catch (err) {
    console.error('❌ Erreur récupération IP user admin:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const CATEGORY_META = {
  // Annonces de masse
  feature: { label: 'Nouvelle fonctionnalité', emoji: '🚀', color: '#7c3aed' },
  maintenance: { label: 'Maintenance', emoji: '🛠️', color: '#f59e0b' },
  update: { label: 'Mise à jour', emoji: '🔄', color: '#22c55e' },
  info: { label: 'Information générale', emoji: '📢', color: '#64748b' },
  // Emails individuels
  ban: { label: 'Bannissement', emoji: '🚫', color: '#ef4444' },
  post_removed: { label: 'Post retiré', emoji: '🗑️', color: '#f59e0b' },
  message: { label: 'Message', emoji: '💬', color: '#7c3aed' },
  other: { label: 'Autre', emoji: 'ℹ️', color: '#64748b' }
};

function buildCategoryBanner(category) {
  const meta = CATEGORY_META[category];
  if (!meta) return '';
  return `<div style="display:inline-block;padding:4px 12px;border-radius:100px;background:${meta.color}22;color:${meta.color};border:1px solid ${meta.color}55;font-size:12px;font-weight:600;margin-bottom:14px">${meta.emoji} ${meta.label}</div><br>`;
}

// ── POST /api/admin/send-email — Envoyer un email à un user précis (admin) ───
// Respecte le consentement : n'envoie que si l'utilisateur a un email ET a activé
// au moins une option de notification (emailNotifications.announcements ou updates).
app.post('/api/admin/send-email', requireAdmin, async (req, res) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: 'DB non disponible' });
    const { userId, subject, message, category } = req.body;
    if (!userId || !subject || !message) {
      return res.status(400).json({ error: 'userId, subject et message sont requis' });
    }
    const user = await UserModel.findById(userId).lean();
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    if (!user.email) return res.status(400).json({ error: 'Cet utilisateur n\'a pas d\'adresse email' });
    const hasConsent = user.emailNotifications?.announcements || user.emailNotifications?.updates;
    if (!hasConsent) {
      return res.status(403).json({ error: 'L\'utilisateur n\'a pas activé les notifications email' });
    }

    const banner = buildCategoryBanner(category);
    await sendBrevoEmail({
      to: user.email,
      toName: user.displayName,
      subject,
      html: `${banner}<h2>${subject}</h2><p>${message}</p><hr><small>Message envoyé par l\'administrateur oifeel.</small>`
    });

    console.log(`📧 [ADMIN] Email envoyé à ${user.displayName} (${user.email}) — catégorie: ${category || 'non précisée'}`);
    res.json({ success: true, sentTo: user.email, displayName: user.displayName });
  } catch (err) {
    console.error('❌ Erreur envoi email admin:', err);
    res.status(500).json({ error: 'Erreur lors de l\'envoi: ' + err.message });
  }
});


// ── Envoi d'e-mails via l'API HTTP de Brevo ───────────────────────
// (contourne le blocage des ports SMTP 587/465 sur Render gratuit,
// car ça passe en HTTPS sur le port 443, jamais bloqué)
async function sendBrevoEmail({ to, toName, subject, html }) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: 'oifeel.', email: process.env.BREVO_SENDER_EMAIL },
      to: [{ email: to, name: toName || undefined }],
      subject,
      htmlContent: html
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Brevo API error (${response.status}): ${errText}`);
  }

  return response.json();
}

async function sendMassEmail(users, subject, html) {
  for (const user of users) {
    try {
      await sendBrevoEmail({ to: user.email, toName: user.displayName, subject, html });
    } catch (err) {
      console.error(err);
    }
  }
}


app.post('/api/admin/send-announcement', requireAdmin, async (req, res) => {

  const { subject, message, category } = req.body;

  const users = await UserModel.find({
    "emailNotifications.announcements": true,
    email: { $exists: true, $nin: [null, ""] }
  });

  const banner = buildCategoryBanner(category);

  await sendMassEmail(
    users,
    subject,
    `
        ${banner}
        <h2>${subject}</h2>
        <p>${message}</p>
        `
  );

  res.json({
    success: true,
    sent: users.length
  });
});


app.get("/api/post-of-the-day", async (req, res) => {
  if (req.headers["x-bot-secret"] !== process.env.BOT_SECRET) {
    return res.status(403).json({ error: "interdit!" });
  } else {
    const today = new Date().toISOString().split("T")[0];

    const featured = await db.collection("daily_featured").findOne({
      date: today
    });

    if (!featured) {
      return res.status(404).json({ error: "ce post n'est pas à l'affiche!" });
    }

    const post = posts.find(p => p.id === featured.postId);

    if (!post) {
      return res.status(404).json({ error: "post non trouvé!" });
    }

    res.json(sanitizePostForPublic(post));
  }
});
// ============================================================
// ROUTES BOT DISCORD — toutes protégées par le header x-bot-secret
// (jamais de mot de passe utilisateur transmis via Discord).
// process.env.BOT_SECRET doit être défini côté Render ET dans le bot.
// ============================================================
function requireBotSecret(req, res, next) {
  if (!process.env.BOT_SECRET || req.headers['x-bot-secret'] !== process.env.BOT_SECRET) {
    return res.status(403).json({ error: 'interdit' });
  }
  next();
}

// GET /api/bot/random-post — un post public au hasard
app.get('/api/bot/random-post', requireBotSecret, async (req, res) => {
  try {
    if (!posts.length) return res.status(404).json({ error: 'Aucun post disponible' });
    const post = posts[Math.floor(Math.random() * posts.length)];
    const [withTheme] = await attachAuthorThemes([post]);
    res.json(sanitizePostForPublic(withTheme));
  } catch (err) {
    console.error('❌ Erreur /api/bot/random-post:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/bot/profile/:pseudo — stats d'un compte oifeel. par pseudo
app.get('/api/bot/profile/:pseudo', requireBotSecret, async (req, res) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: 'DB non disponible' });
    const user = await UserModel.findOne({
      displayName: { $regex: new RegExp(`^${req.params.pseudo}$`, 'i') }
    }).lean();
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    res.json({
      id: user._id,
      displayName: user.displayName,
      avatar: user.avatar,
      bio: user.bio,
      postsCount: user.postsCount || 0,
      followersCount: user.followersCount || 0,
      followingCount: user.followingCount || 0,
      createdAt: user.createdAt
    });
  } catch (err) {
    console.error('❌ Erreur /api/bot/profile:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/bot/last-post/:pseudo — dernier post d'un utilisateur
app.get('/api/bot/last-post/:pseudo', requireBotSecret, async (req, res) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: 'DB non disponible' });
    const user = await UserModel.findOne({
      displayName: { $regex: new RegExp(`^${req.params.pseudo}$`, 'i') }
    }).lean();
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const post = posts
      .filter(p => p.userId === user._id && !p.anonymous)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    if (!post) return res.status(404).json({ error: 'Aucun post trouvé pour cet utilisateur' });
    res.json(sanitizePostForPublic(post));
  } catch (err) {
    console.error('❌ Erreur /api/bot/last-post:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/bot/top-posts?period=day|week — classement des posts les plus likés
app.get('/api/bot/top-posts', requireBotSecret, async (req, res) => {
  try {
    const period = req.query.period === 'day' ? 'day' : 'week';
    const windowMs = period === 'day' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const since = Date.now() - windowMs;

    const top = posts
      .filter(p => new Date(p.createdAt).getTime() >= since)
      .slice()
      .sort((a, b) => (b.likes || 0) - (a.likes || 0))
      .slice(0, 10)
      .map(sanitizePostForPublic);

    res.json({ period, posts: top });
  } catch (err) {
    console.error('❌ Erreur /api/bot/top-posts:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/bot/new-posts?since=<timestamp ms> — utilisé par le polling du
// bot pour le pont "nouveau post -> salon Discord"
app.get('/api/bot/new-posts', requireBotSecret, async (req, res) => {
  try {
    const since = parseInt(req.query.since || '0', 10);
    const fresh = posts
      .filter(p => new Date(p.createdAt).getTime() > since)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map(sanitizePostForPublic);
    res.json({ posts: fresh, now: Date.now() });
  } catch (err) {
    console.error('❌ Erreur /api/bot/new-posts:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/bot/stats — stats globales pour /statsapp
app.get('/api/bot/stats', requireBotSecret, async (req, res) => {
  try {
    const totalPosts = posts.length;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const postsToday = posts.filter(p => new Date(p.createdAt) >= today).length;

    let totalUsers = 0, activeToday = 0;
    if (mongoReady) {
      totalUsers = await UserModel.countDocuments();
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      activeToday = await UserModel.countDocuments({ lastLogin: { $gte: dayAgo } });
    }

    res.json({ totalUsers, totalPosts, postsToday, activeToday });
  } catch (err) {
    console.error('❌ Erreur /api/bot/stats:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/bot/link/confirm — { discordId, code } : confirme la liaison
// Discord <-> compte oifeel. à partir du code généré par /api/social/link-code
app.post('/api/bot/link/confirm', requireBotSecret, async (req, res) => {
  try {
    const { discordId, code } = req.body || {};
    if (!discordId || !code) return res.status(400).json({ error: 'discordId et code requis' });

    const pending = pendingDiscordLinks.get(String(code));
    if (!pending || pending.expiresAt < Date.now()) {
      return res.status(400).json({ error: 'Code invalide ou expiré' });
    }

    await DiscordLinkModel.findByIdAndUpdate(
      String(discordId),
      { _id: String(discordId), userId: pending.userId, linkedAt: new Date() },
      { upsert: true }
    );
    pendingDiscordLinks.delete(String(code));

    const user = await UserModel.findById(pending.userId).lean();
    res.json({ success: true, displayName: user?.displayName || null });
  } catch (err) {
    console.error('❌ Erreur /api/bot/link/confirm:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/bot/mood — { discordId, text } : publie un post depuis Discord,
// uniquement si le compte Discord est lié à un compte oifeel.
app.post('/api/bot/mood', requireBotSecret, async (req, res) => {
  try {
    const { discordId, text } = req.body || {};
    if (!discordId || !text) return res.status(400).json({ error: 'discordId et text requis' });

    const link = await DiscordLinkModel.findById(String(discordId)).lean();
    if (!link) return res.status(403).json({ error: 'Compte Discord non lié. Utilise /lier d\'abord.' });

    const user = await UserModel.findById(link.userId).lean();
    if (!user) return res.status(404).json({ error: 'Compte oifeel. introuvable' });

    const cleanText = sanitizeText(String(text).slice(0, 280));
    const newPost = {
      text: `${cleanText} \n- via discord `,
      emoji: '💬',
      color: "#000",
      textColor: "#fff",
      stickerUrl: null,
      track: null,
      anonymous: false,
      id: Date.now().toString(),
      userId: user._id,
      userName: user.displayName,
      likes: 0,
      views: 0,
      reactions: {},
      pinned: false,
      aiGenerated: false,
      ephemeral: false,
      expiresAt: null,
      createdAt: new Date().toISOString(),
      ip: "discord",
      ipLoggedAt: null
    };

    posts.unshift(newPost);
    await persistPost(newPost);
    if (mongoReady) UserModel.findByIdAndUpdate(user._id, { $inc: { postsCount: 1 } }).catch(() => { });
    try { sendSSE('new_post', sanitizePostForPublic(newPost)); } catch (e) { console.error('❌ Erreur SSE:', e); }

    res.status(201).json(sanitizePostForPublic(newPost));
  } catch (err) {
    console.error('❌ Erreur /api/bot/mood:', err);
    res.status(400).json({ error: 'Contenu invalide' });
  }
});

// POST /api/bot/report — { postId, reason } : signalement depuis Discord
app.post('/api/bot/report', requireBotSecret, async (req, res) => {
  try {
    const { postId, reason = '' } = req.body || {};
    const targetPost = posts.find(p => p.id == postId);
    if (!targetPost) return res.status(404).json({ error: 'Post non trouvé' });

    const report = {
      id: Date.now().toString(),
      postId: String(postId),
      reason: 'Signalé via Discord — ' + String(reason).slice(0, 950),
      createdAt: new Date().toISOString()
    };
    reports.unshift(report);
    await fsPromises.writeFile(reportsFile, JSON.stringify(reports, null, 2));
    try { sendSSE('report', report); } catch (e) { console.error('❌ Erreur SSE:', e); }

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Erreur /api/bot/report:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Debug routes
function listRoutes() {
  const routes = [];
  app._router.stack.forEach(m => {
    if (m.route && m.route.path) {
      const methods = Object.keys(m.route.methods).join(',');
      routes.push(`${methods.toUpperCase()} ${m.route.path}`);
    } else if (m.name === 'router' && m.handle && m.handle.stack) {
      m.handle.stack.forEach(r => {
        if (r.route && r.route.path) {
          const methods = Object.keys(r.route.methods).join(',');
          routes.push(`${methods.toUpperCase()} ${r.route.path}`);
        }
      });
    }
  });
  console.log('📡 Routes enregistrées:\n' + routes.join('\n'));
}
listRoutes();
console.log('Routes sociales MongoDB - OK');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Le serveur tourne sur le port ${PORT}`));

module.exports = app;
