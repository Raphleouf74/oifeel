'use strict';
/**
 * services/share-cards.cjs — liens de partage avec aperçu (Open Graph) + carte image.
 *
 * Pourquoi : oifeel. est une app à page unique (SPA), donc un lien "…/#post-123" n'a
 * aucun aperçu sur WhatsApp / Discord / Insta / iMessage. Ici, chaque post a une page
 * de partage servie par le backend :
 *
 *   GET /p/:id            → HTML minimal avec les balises og:/twitter: du post,
 *                           puis redirection immédiate vers l'app (#post-<id>)
 *   GET /p/:id/card.png   → image 1200×630 aux couleurs du post (texte + musique)
 *
 * La génération d'image utilise @napi-rs/canvas. Si le module n'est pas installé,
 * l'aperçu retombe proprement sur l'image par défaut (rien ne casse).
 *
 * Confidentialité : posts anonymes → jamais de nom d'auteur ; posts éphémères expirés
 * → 404 ; pages marquées noindex (pas d'indexation Google des ressentis).
 */
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

let canvasLib = null;
try {
  canvasLib = require('@napi-rs/canvas');
  const fontPath = path.join(__dirname, '..', 'assets', 'fonts', 'Fredoka-Medium.ttf');
  if (fs.existsSync(fontPath)) {
    canvasLib.GlobalFonts.registerFromPath(fontPath, 'Fredoka');
  } else {
    console.warn('ℹ️ [SHARE] police assets/fonts/Fredoka-Medium.ttf introuvable — police système utilisée.');
  }
} catch (e) {
  console.warn('ℹ️ [SHARE] @napi-rs/canvas absent — les liens partagés utiliseront l\'image par défaut. (npm i @napi-rs/canvas)');
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HEX_RE = /#[0-9a-fA-F]{6}\b/g;
const CARD_W = 1200;
const CARD_H = 630;
const FONT = '"Fredoka", "Poppins", "DejaVu Sans", sans-serif';

// ─── utilitaires ─────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// sanitizeText() du serveur stocke < et > sous forme d'entités : on les remet en texte brut
// pour le dessin de l'image, puis on échappe proprement pour le HTML.
function plain(s) {
  return String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function truncate(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

function parseColors(value) {
  const found = String(value || '').match(HEX_RE);
  return found && found.length ? found : ['#5f95b9'];
}

function hexToRgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000; // même formule que getBrightness() côté front
}

function shade(hex, amount) { // amount -1..1
  const [r, g, b] = hexToRgb(hex).map(v => {
    const t = amount < 0 ? 0 : 255;
    return Math.round(v + (t - v) * Math.abs(amount));
  });
  return `rgb(${r},${g},${b})`;
}

function pickTextColor(post, colors) {
  if (typeof post.textColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(post.textColor)) return post.textColor;
  const avg = colors.reduce((a, c) => a + luminance(c), 0) / colors.length;
  return avg < 128 ? '#ffffff' : '#000000';
}

function isExpired(post) {
  return !!(post.expiresAt && new Date(post.expiresAt).getTime() <= Date.now());
}

function authorLabel(post) {
  if (post.anonymous || !post.userName || post.userName === 'Anonyme') return null;
  return String(post.userName);
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapLines(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

function fitEllipsis(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxWidth) text = text.slice(0, -1);
  return text.trimEnd() + '…';
}

// ─── dessin de la carte (fonction pure : ctx + données) ──────

function drawCard(ctx, W, H, post) {
  const colors = parseColors(post.color);
  const fg = pickTextColor(post, colors);
  const fgIsLight = luminance(fg) > 128;

  // fond : dégradé du post (ou léger dégradé de la couleur unie)
  const g = ctx.createLinearGradient(0, 0, W, H);
  if (colors.length === 1) {
    g.addColorStop(0, shade(colors[0], 0.12));
    g.addColorStop(1, shade(colors[0], -0.2));
  } else {
    colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // deux grands cercles translucides : donnent du relief sans dépendre d'un emoji
  ctx.fillStyle = fgIsLight ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
  ctx.beginPath(); ctx.arc(W - 120, 90, 300, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(120, H + 40, 220, 0, Math.PI * 2); ctx.fill();

  const padX = 90;
  const soft = fgIsLight ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.6)';

  // marque
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = fg;
  ctx.font = `44px ${FONT}`;
  ctx.fillText('oifeel.', padX, 92);

  // texte du post : on réduit la taille jusqu'à ce que ça tienne
  const text = truncate(plain(post.text), 220) || '…';
  const maxW = W - padX * 2;
  const zoneTop = 130, zoneBottom = H - 150;
  let size = 84, lines = [];
  for (; size >= 34; size -= 4) {
    ctx.font = `${size}px ${FONT}`;
    lines = wrapLines(ctx, text, maxW);
    if (lines.length * size * 1.22 <= zoneBottom - zoneTop) break;
  }
  const lh = size * 1.22;
  const blockH = lines.length * lh;
  let y = zoneTop + (zoneBottom - zoneTop - blockH) / 2 + size * 0.9;
  ctx.fillStyle = fg;
  ctx.font = `${size}px ${FONT}`;
  for (const l of lines) { ctx.fillText(l, padX, y); y += lh; }

  // pied : musique (pilule) + auteur
  const footY = H - 62;
  const author = authorLabel(post);
  let cursorX = padX;

  if (post.track && (post.track.title || post.track.artist)) {
    const label = [post.track.title, post.track.artist].filter(Boolean).join(' — ');
    ctx.font = `28px ${FONT}`;
    const maxPill = W - padX * 2 - (author ? 260 : 0);
    const shown = fitEllipsis(ctx, label, maxPill - 90);
    const pillW = ctx.measureText(shown).width + 90;
    ctx.fillStyle = fgIsLight ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)';
    roundedRect(ctx, cursorX, footY - 38, pillW, 56, 28); ctx.fill();
    // petit disque vinyle
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(cursorX + 34, footY - 10, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fgIsLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.arc(cursorX + 34, footY - 10, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fg;
    ctx.fillText(shown, cursorX + 62, footY);
    cursorX += pillW + 24;
  }

  if (author) {
    ctx.font = `30px ${FONT}`;
    ctx.fillStyle = soft;
    ctx.textAlign = 'right';
    ctx.fillText(fitEllipsis(ctx, author, 260), W - padX, footY);
    ctx.textAlign = 'left';
  }
}

// ─── cache mémoire léger (les cartes coûtent du CPU) ─────────
const CACHE_MAX = 80;
const CACHE_TTL = 15 * 60 * 1000;
const cache = new Map(); // key -> { buf, at }
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) { cache.delete(key); return null; }
  return hit.buf;
}
function cacheSet(key, buf) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { buf, at: Date.now() });
}

async function renderCardPng(post) {
  const canvas = canvasLib.createCanvas(CARD_W, CARD_H);
  drawCard(canvas.getContext('2d'), CARD_W, CARD_H, post);
  return canvas.encode('png');
}

// ─── routes ──────────────────────────────────────────────────

function register(app, { getPosts, siteUrl }) {
  const SITE = String(siteUrl || 'https://oifeel.netlify.app').replace(/\/+$/, '');
  const DEFAULT_IMG = `${SITE}/app/assets/og-default.png`;

  const pageLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
  const cardLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

  const baseUrl = (req) => (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const findPost = (id) => getPosts().find(p => String(p.id) === id);

  function renderHtml({ title, description, pageUrl, image, alt, themeColor, target, status }) {
    return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(pageUrl)}">
<meta property="og:site_name" content="oifeel.">
<meta property="og:type" content="article">
<meta property="og:locale" content="fr_FR">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${CARD_W}">
<meta property="og:image:height" content="${CARD_H}">
<meta property="og:image:alt" content="${esc(alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="theme-color" content="${esc(themeColor)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:#111;color:#fff;font:16px/1.5 system-ui,sans-serif;text-align:center}a{color:#5f95b9}</style>
</head>
<body>
<p>Ouverture de oifeel.…<br><a href="${esc(target)}">continuer</a></p>
</body>
</html>`;
  }

  app.get('/p/:id', pageLimiter, (req, res) => {
    const id = req.params.id;
    const post = ID_RE.test(id) ? findPost(id) : null;

    res.set('Content-Type', 'text/html; charset=utf-8');

    if (!post || isExpired(post)) {
      return res.status(404).send(renderHtml({
        title: 'oifeel. — ce post n\'existe plus',
        description: 'partage ton ressenti sur oifeel. — personne ne juge ici.',
        pageUrl: `${baseUrl(req)}/p/${encodeURIComponent(id)}`,
        image: DEFAULT_IMG,
        alt: 'oifeel.',
        themeColor: '#111111',
        target: `${SITE}/?utm_source=share`
      }));
    }

    const author = authorLabel(post);
    const emoji = String(post.emoji || '').slice(0, 8);
    const title = `${emoji ? emoji + ' ' : ''}${author || 'Quelqu\'un'} partage son ressenti`;
    let description = truncate(plain(post.text), 200);
    if (post.track && post.track.title) {
      description += ` — ${truncate([post.track.title, post.track.artist].filter(Boolean).join(' · '), 80)}`;
    }
    const colors = parseColors(post.color);

    res.set('Cache-Control', 'public, max-age=300');
    res.send(renderHtml({
      title,
      description,
      pageUrl: `${baseUrl(req)}/p/${encodeURIComponent(id)}`,
      image: `${baseUrl(req)}/p/${encodeURIComponent(id)}/card.png`,
      alt: truncate(plain(post.text), 120),
      themeColor: colors[0],
      target: `${SITE}/?utm_source=share#post-${encodeURIComponent(id)}`
    }));
  });

  app.get('/p/:id/card.png', cardLimiter, async (req, res) => {
    const id = req.params.id;
    const post = ID_RE.test(id) ? findPost(id) : null;

    // Pas de moteur d'image, post inconnu ou expiré → image par défaut
    if (!canvasLib || !post || isExpired(post)) return res.redirect(302, DEFAULT_IMG);

    try {
      const key = `${id}:${post.editedAt || ''}:${post.color}:${post.text}`;
      let buf = cacheGet(key);
      if (!buf) { buf = await renderCardPng(post); cacheSet(key, buf); }
      res.set({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
        // helmet met CORP: same-origin par défaut ; les aperçus ont besoin de cross-origin
        'Cross-Origin-Resource-Policy': 'cross-origin'
      });
      res.send(buf);
    } catch (err) {
      console.error('❌ [SHARE] rendu carte:', err);
      res.redirect(302, DEFAULT_IMG);
    }
  });
}

module.exports = { register, drawCard, renderCardPng: (post) => renderCardPng(post), _internals: { parseColors, esc, plain } };
