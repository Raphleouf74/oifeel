'use strict';
/**
 * services/webpush.cjs — notifications push Web (PWA) + rappel quotidien.
 *
 * Variables d'environnement (à définir sur Render) :
 *   VAPID_PUBLIC_KEY   clé publique  (générée avec : npx web-push generate-vapid-keys)
 *   VAPID_PRIVATE_KEY  clé privée    (à garder secrète)
 *   VAPID_SUBJECT      "mailto:ton@email.com" (ou l'URL du site) — recommandé
 *
 * Sans ces variables (ou sans le paquet `web-push`), tout ce module se désactive
 * proprement : les routes répondent { enabled:false } et l'interface masque les réglages.
 *
 * Routes :
 *   GET   /api/push/public-key
 *   GET   /api/push/status          (auth)  → réglages + nb d'appareils
 *   POST  /api/push/subscribe       (auth)  { subscription, dailyReminder? }
 *   POST  /api/push/unsubscribe     (auth)  { endpoint }
 *   PATCH /api/push/preferences     (auth)  { social?, dailyReminder? }
 *   POST  /api/push/posted          (auth)  → évite le rappel du soir si on a déjà posté
 *   POST  /api/push/test            (auth)  → notification de test à soi-même
 */
const rateLimit = require('express-rate-limit');
const { parisDay } = require('./analytics.cjs');

let webpush = null;
try { webpush = require('web-push'); } catch (e) {
  console.warn('ℹ️ [PUSH] paquet web-push absent — push désactivé. (npm i web-push)');
}

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';

const REMINDERS = [
  { title: 'Comment tu te sens ce soir ? 🌙', body: 'Une couleur, un emoji, une chanson : deux minutes pour poser ta journée.' },
  { title: 'Ta journée en une couleur ?', body: 'Partage ton ressenti sur oifeel. — personne ne juge ici 🤝' },
  { title: 'Un petit moment pour toi', body: 'Dis ce que tu ressens, même en trois mots.' },
  { title: 'Quelle chanson colle à ton humeur ?', body: 'Ajoute-la à ton post du soir 🎧' },
  { title: 'Pause ressenti 🫶', body: 'Comment s\'est passée ta journée ?' },
  { title: 'Et là, maintenant, ça va ?', body: 'Ton humeur du moment t\'attend sur oifeel.' }
];

// anti-spam : délai minimum entre deux push du même type pour un même utilisateur
const THROTTLE_MS = { like: 10 * 60 * 1000, comment: 30 * 1000, follow: 30 * 1000, message: 5 * 1000 };
const lastSent = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [k, t] of lastSent) if (t < cutoff) lastSent.delete(k);
}, 10 * 60 * 1000).unref();

function clip(s, n) {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function validSubscription(sub) {
  return !!(sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length <= 600
    && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string'
    && sub.keys.p256dh.length <= 200 && sub.keys.auth.length <= 100);
}

function register(app, { UserModel, requireAuth, isMongoReady, cron, siteUrl }) {
  const SITE = String(siteUrl || 'https://oifeel.netlify.app').replace(/\/+$/, '');
  const enabled = !!(webpush && PUBLIC_KEY && PRIVATE_KEY);

  if (enabled) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || SITE, PUBLIC_KEY, PRIVATE_KEY);
    console.log('🔔 [PUSH] Web Push activé');
  } else {
    console.log('🔕 [PUSH] désactivé (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY manquantes ou paquet web-push absent)');
  }

  const uid = (req) => String(req.session?.user?.id || req.user?.id || '');
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

  // ── envoi ────────────────────────────────────────────────
  /**
   * @param {string} userId
   * @param {{title:string, body:string, url?:string, tag?:string}} payload
   * @param {{pref?:'social'|'dailyReminder'}} opts  réglage à respecter
   * @returns {Promise<number>} nombre d'appareils atteints
   */
  async function sendPushToUser(userId, payload, opts = {}) {
    if (!enabled || !isMongoReady() || !userId) return 0;
    const user = await UserModel.findById(String(userId))
      .select('+pushSubscriptions pushPrefs').lean();
    if (!user || !user.pushSubscriptions || !user.pushSubscriptions.length) return 0;

    const prefs = user.pushPrefs || {};
    if (opts.pref === 'social' && prefs.social === false) return 0;
    if (opts.pref === 'dailyReminder' && prefs.dailyReminder !== true) return 0;

    const body = JSON.stringify({
      title: clip(payload.title, 80),
      body: clip(payload.body, 160),
      url: payload.url || SITE + '/',
      tag: payload.tag || undefined
    });

    let sent = 0;
    const dead = [];
    await Promise.all(user.pushSubscriptions.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
          body,
          { TTL: 60 * 60 * 12, urgency: 'normal' }
        );
        sent++;
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) dead.push(s.endpoint);
        else console.warn('⚠️ [PUSH] envoi échoué:', err && (err.statusCode || err.message));
      }
    }));

    if (dead.length) {
      UserModel.updateOne({ _id: String(userId) }, { $pull: { pushSubscriptions: { endpoint: { $in: dead } } } })
        .catch(() => { });
    }
    return sent;
  }

  /**
   * À appeler depuis createNotification() : transforme une notification interne
   * (like, commentaire, follow, message) en push. Ne jette jamais d'erreur.
   */
  function pushForNotification(userId, type, title, body, data = {}) {
    try {
      if (!enabled) return;
      const key = `${userId}:${type}`;
      const wait = THROTTLE_MS[type] ?? 30 * 1000;
      const now = Date.now();
      if (now - (lastSent.get(key) || 0) < wait) return;
      lastSent.set(key, now);

      let text = body;
      let url = SITE + '/';
      let tag = type;
      if (type === 'message') {
        // Les messages sont chiffrés de bout en bout : on ne met JAMAIS leur contenu dans un push.
        text = body === 'a partagé un post' ? body : 't\'a envoyé un message';
        tag = `msg-${data.conversationId || data.senderId || ''}`;
      } else if (data.postId) {
        url = `${SITE}/#post-${encodeURIComponent(data.postId)}`;
        tag = `${type}-${data.postId}`;
      }
      sendPushToUser(userId, { title, body: text, url, tag }, { pref: 'social' }).catch(() => { });
    } catch (_) { /* jamais bloquant */ }
  }

  // ── routes ───────────────────────────────────────────────
  app.get('/api/push/public-key', (req, res) => {
    res.json(enabled ? { enabled: true, publicKey: PUBLIC_KEY } : { enabled: false });
  });

  app.get('/api/push/status', requireAuth, limiter, async (req, res) => {
    try {
      if (!enabled || !isMongoReady()) return res.json({ enabled: false });
      const user = await UserModel.findById(uid(req)).select('+pushSubscriptions pushPrefs').lean();
      res.json({
        enabled: true,
        devices: (user?.pushSubscriptions || []).length,
        social: user?.pushPrefs?.social !== false,
        dailyReminder: user?.pushPrefs?.dailyReminder === true
      });
    } catch (err) {
      console.error('❌ [PUSH] status:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/push/subscribe', requireAuth, limiter, async (req, res) => {
    try {
      if (!enabled) return res.status(503).json({ error: 'Push indisponible' });
      if (!isMongoReady()) return res.status(503).json({ error: 'DB non disponible' });
      const { subscription, dailyReminder } = req.body || {};
      if (!validSubscription(subscription)) return res.status(400).json({ error: 'Abonnement invalide' });

      const userId = uid(req);
      const sub = {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        createdAt: new Date()
      };
      // on remplace un éventuel abonnement identique, puis on garde les 5 plus récents
      await UserModel.updateOne({ _id: userId }, { $pull: { pushSubscriptions: { endpoint: sub.endpoint } } });
      const $set = { 'pushPrefs.social': true };
      if (typeof dailyReminder === 'boolean') $set['pushPrefs.dailyReminder'] = dailyReminder;
      await UserModel.updateOne(
        { _id: userId },
        { $push: { pushSubscriptions: { $each: [sub], $slice: -5 } }, $set }
      );
      res.json({ ok: true });
    } catch (err) {
      console.error('❌ [PUSH] subscribe:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/push/unsubscribe', requireAuth, limiter, async (req, res) => {
    try {
      if (!isMongoReady()) return res.status(503).json({ error: 'DB non disponible' });
      const endpoint = req.body && req.body.endpoint;
      if (typeof endpoint !== 'string') return res.status(400).json({ error: 'endpoint requis' });
      await UserModel.updateOne({ _id: uid(req) }, { $pull: { pushSubscriptions: { endpoint } } });
      res.json({ ok: true });
    } catch (err) {
      console.error('❌ [PUSH] unsubscribe:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.patch('/api/push/preferences', requireAuth, limiter, async (req, res) => {
    try {
      if (!isMongoReady()) return res.status(503).json({ error: 'DB non disponible' });
      const { social, dailyReminder } = req.body || {};
      const $set = {};
      if (typeof social === 'boolean') $set['pushPrefs.social'] = social;
      if (typeof dailyReminder === 'boolean') $set['pushPrefs.dailyReminder'] = dailyReminder;
      if (!Object.keys($set).length) return res.status(400).json({ error: 'Rien à modifier' });
      await UserModel.updateOne({ _id: uid(req) }, { $set });
      res.json({ ok: true });
    } catch (err) {
      console.error('❌ [PUSH] preferences:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/push/posted', requireAuth, limiter, async (req, res) => {
    try {
      if (isMongoReady()) await UserModel.updateOne({ _id: uid(req) }, { $set: { lastPostAt: new Date() } });
      res.json({ ok: true });
    } catch (_) { res.json({ ok: true }); }
  });

  app.post('/api/push/test', requireAuth, rateLimit({ windowMs: 30 * 1000, max: 1, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
    try {
      if (!enabled) return res.status(503).json({ error: 'Push indisponible' });
      const sent = await sendPushToUser(uid(req), {
        title: 'oifeel.',
        body: 'Les notifications fonctionnent 🎉',
        url: SITE + '/',
        tag: 'test'
      });
      res.json({ ok: true, sent });
    } catch (err) {
      console.error('❌ [PUSH] test:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ── rappel quotidien (opt-in) ────────────────────────────
  async function runDailyReminder() {
    if (!enabled || !isMongoReady()) return;
    try {
      const today = parisDay();
      const users = await UserModel.find({
        'pushPrefs.dailyReminder': true,
        'pushSubscriptions.0': { $exists: true }
      }).select('_id lastPostAt').lean();

      const dayIndex = Math.floor(Date.now() / 86400000);
      const msg = REMINDERS[dayIndex % REMINDERS.length];
      const targets = users.filter(u => !(u.lastPostAt && parisDay(new Date(u.lastPostAt)) === today));

      let sent = 0;
      for (let i = 0; i < targets.length; i += 20) { // par paquets de 20
        const results = await Promise.allSettled(targets.slice(i, i + 20).map(u =>
          sendPushToUser(u._id, { ...msg, url: SITE + '/#create', tag: 'daily' }, { pref: 'dailyReminder' })
        ));
        sent += results.filter(r => r.status === 'fulfilled' && r.value > 0).length;
      }
      console.log(`🔔 [PUSH] rappel quotidien : ${sent}/${targets.length} utilisateur(s) notifié(s)`);
    } catch (err) {
      console.error('❌ [PUSH] rappel quotidien:', err);
    }
  }

  if (enabled && cron) {
    // 19h à Paris. Attention : le serveur doit être réveillé à cette heure (voir ping UptimeRobot).
    cron.schedule('0 19 * * *', runDailyReminder, { timezone: 'Europe/Paris' });
  }

  return { enabled, sendPushToUser, pushForNotification, runDailyReminder };
}

module.exports = { register };
