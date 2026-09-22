'use strict';
/**
 * services/analytics.cjs — statistiques d'usage minimalistes, sans données perso.
 *
 * Ce qui est stocké : uniquement des COMPTEURS par jour et par événement
 * (ex. { "2026-09-19": { visit: 42, guest_login: 17, post_created: 9 } }).
 * Aucune IP, aucun identifiant, aucun cookie, aucun user-agent : rien qui
 * permette de reconnaître une personne. Une "visite" = une session de navigation
 * (le client n'envoie l'événement qu'une fois par onglet ouvert).
 *
 * Routes :
 *   POST /api/track                     (public, limité)  { event, source? }
 *   GET  /api/admin/analytics?days=30   (admin)
 */
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

// Liste blanche : tout le reste est ignoré silencieusement.
const EVENTS = new Set([
  'visit',
  'guest_login', 'register', 'login',
  'post_created', 'story_created',
  'share_open', 'share_native', 'share_download', 'share_link',
  'pwa_installed',
  'push_prompt_shown', 'push_enabled', 'push_denied'
]);

// Canaux d'acquisition reconnus (compteur "src_<canal>" incrémenté avec "visit").
const SOURCES = new Set([
  'direct', 'tiktok', 'instagram', 'discord', 'reddit', 'x', 'whatsapp',
  'snapchat', 'youtube', 'google', 'facebook', 'threads', 'share', 'pwa', 'other'
]);

// Jour calendaire en heure de Paris (YYYY-MM-DD), pour que "aujourd'hui" ait un sens.
function parisDay(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(date);
}

function register(app, { requireAdmin, isMongoReady }) {
  const schema = new mongoose.Schema({
    _id: { type: String },                       // "YYYY-MM-DD"
    events: { type: Map, of: Number, default: {} }
  }, { _id: false, versionKey: false });

  const AnalyticsDay = mongoose.models.AnalyticsDay || mongoose.model('AnalyticsDay', schema);

  const trackLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false
  });

  app.post('/api/track', trackLimiter, (req, res) => {
    // On répond tout de suite : le tracking ne doit jamais ralentir ni casser l'app.
    res.status(204).end();
    try {
      if (!isMongoReady()) return;
      const { event, source } = req.body || {};
      if (typeof event !== 'string' || !EVENTS.has(event)) return;

      const inc = { [`events.${event}`]: 1 };
      if (event === 'visit' && typeof source === 'string' && SOURCES.has(source)) {
        inc[`events.src_${source}`] = 1;
      }
      AnalyticsDay.updateOne({ _id: parisDay() }, { $inc: inc }, { upsert: true }).catch(() => { });
    } catch (_) { /* jamais bloquant */ }
  });

  app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
    try {
      if (!isMongoReady()) return res.status(503).json({ error: 'DB non disponible' });
      const days = Math.min(90, Math.max(1, parseInt(req.query.days || '30', 10) || 30));
      const since = parisDay(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));
      const rows = await AnalyticsDay.find({ _id: { $gte: since } }).sort({ _id: 1 }).lean();
      res.json({
        days: rows.map(r => ({ date: r._id, events: r.events || {} })),
        knownEvents: [...EVENTS],
        knownSources: [...SOURCES]
      });
    } catch (err) {
      console.error('❌ [ANALYTICS] lecture:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });
}

module.exports = { register, parisDay, EVENTS, SOURCES };
