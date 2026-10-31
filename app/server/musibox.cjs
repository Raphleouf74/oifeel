'use strict';
/**
 * services/musibox.cjs — playlists Musibox attachées à un post.
 *
 * Principe : le serveur ne fait JAMAIS confiance aux infos envoyées par le navigateur.
 * Il reçoit seulement l'identifiant du lien de partage (…/playlist/XXXXXXX), demande lui-même
 * la playlist à Musibox, puis enregistre un "instantané" vérifié (nom, durée, pochettes, premiers
 * titres). Résultat : un lien fort (la playlist existe vraiment) et des aperçus fiables.
 *
 * Variables d'environnement :
 *   MUSIBOX_API  URL du serveur Musibox, ex. https://musibox.onrender.com   (active la vérification)
 *   MUSIBOX_URL  URL publique de l'app Musibox (défaut https://musibox.netlify.app)
 */
const rateLimit = require('express-rate-limit');

const MUSIBOX_URL = (process.env.MUSIBOX_URL || 'https://musibox.netlify.app').replace(/\/+$/, '');
const MUSIBOX_API = (process.env.MUSIBOX_API || '').replace(/\/+$/, '');
const ID_RE = /^[A-Za-z0-9]{4,16}$/;
const CDN_RE = /^https:\/\/[a-z0-9.-]+\.dzcdn\.net\//i; // pochettes Deezer uniquement

const enabled = () => !!MUSIBOX_API;
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const clean = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
const isCover = (u) => typeof u === 'string' && u.length < 500 && CDN_RE.test(u);

function allowedHosts() {
  const hosts = new Set();
  for (const u of [MUSIBOX_URL, MUSIBOX_API]) { try { hosts.add(new URL(u).hostname); } catch (_) { } }
  return hosts;
}

// "https://musibox.netlify.app/playlist/abc1234" ou "abc1234"  →  "abc1234" (sinon null)
function parseShareId(input) {
  const s = String(input || '').trim();
  if (ID_RE.test(s)) return s;
  try {
    const u = new URL(s);
    const m = u.pathname.match(/^\/playlist\/([A-Za-z0-9]{4,16})\/?$/);
    if (u.protocol === 'https:' && m && allowedHosts().has(u.hostname)) return m[1];
  } catch (_) { }
  return null;
}

const cache = new Map(); // shareId -> { at, snap }
const CACHE_TTL = 60 * 1000;

async function snapshot(shareId) {
  if (!ID_RE.test(shareId)) throw fail(400, 'playlist_invalid', 'Lien Musibox invalide.');
  const hit = cache.get(shareId);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.snap;

  let res;
  try {
    res = await fetch(`${MUSIBOX_API}/api/playlists/${shareId}/open`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000)
    });
  } catch (_) { throw fail(503, 'playlist_unreachable', 'Musibox ne répond pas pour le moment. Réessaie dans un instant.'); }

  if (res.status === 401) throw fail(400, 'playlist_locked', 'Cette playlist est protégée par un mot de passe. Crée un lien sans mot de passe pour la publier.');
  if (res.status === 404) throw fail(404, 'playlist_gone', 'Cette playlist est introuvable ou a expiré.');
  if (!res.ok) throw fail(503, 'playlist_unreachable', 'Musibox ne répond pas pour le moment. Réessaie dans un instant.');

  const data = await res.json().catch(() => ({}));
  const tracks = (Array.isArray(data.tracks) ? data.tracks : []).filter((t) => t && /^\d+$/.test(String(t.id)));
  if (!tracks.length) throw fail(404, 'playlist_empty', 'Cette playlist est vide.');

  const covers = [];
  for (const t of tracks) {
    if (covers.length >= 4) break;
    if (isCover(t.cover) && !covers.includes(t.cover)) covers.push(t.cover);
  }
  const snap = {
    shareId,
    name: clean(data.name || 'Playlist', 40) || 'Playlist',
    count: Math.min(tracks.length, 100),
    durationSec: Math.min(86400, tracks.reduce((s, t) => s + (parseInt(t.duration, 10) || 0), 0)),
    covers,
    tracks: tracks.slice(0, 8).map((t) => ({
      trackId: String(t.id), title: clean(t.title, 80), artist: clean(t.artist, 80), cover: isCover(t.cover) ? t.cover : null
    })),
    url: `${MUSIBOX_URL}/playlist/${shareId}`, // reconstruit ici, jamais pris du navigateur
    expiresAt: data.expiresAt || null
  };
  cache.set(shareId, { at: Date.now(), snap });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return snap;
}

// Utilisé à la création d'un post. `legacy` = ancienne validation (si MUSIBOX_API n'est pas configuré).
async function buildFromBody(pl, legacy) {
  if (!pl || typeof pl !== 'object') return null;
  if (!enabled()) return legacy ? legacy(pl) : null;
  const id = parseShareId(pl.shareId || pl.url);
  if (!id) throw fail(400, 'playlist_invalid', 'Lien Musibox invalide.');
  return snapshot(id);
}

// GET /api/playlists/resolve?url=…  → aperçu pour le compositeur (avant de publier)
function registerRoutes(app) {
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
  app.get('/api/playlists/resolve', limiter, async (req, res) => {
    try {
      if (!enabled()) return res.status(503).json({ error: 'Les playlists Musibox ne sont pas activées sur ce serveur.', code: 'playlist_disabled' });
      const id = parseShareId(req.query.url);
      if (!id) return res.status(400).json({ error: 'Colle un lien Musibox (…/playlist/xxxx).', code: 'playlist_invalid' });
      res.set('Cache-Control', 'no-store');
      res.json(await snapshot(id));
    } catch (e) {
      if (!e.status) console.error('❌ [MUSIBOX] resolve:', e);
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Erreur interne.', code: e.code || 'playlist_error' });
    }
  });
}

module.exports = { enabled, parseShareId, snapshot, buildFromBody, registerRoutes, MUSIBOX_URL };
