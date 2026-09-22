// share.js — partage d'un post : image "story" (1080×1920) + lien avec aperçu.
//
// L'image est dessinée dans le navigateur (canvas) : les emojis s'affichent donc avec
// la police d'emoji de l'appareil, sans aucune dépendance serveur.
// Sur mobile, la feuille de partage native s'ouvre avec l'image (Insta, WhatsApp, Snap…).
import { track } from './analytics.js';
import { shareLink } from './config.js';

const W = 1080;
const H = 1920;
const FONT = '"Fredoka", system-ui, sans-serif';
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const HEX_RE = /#[0-9a-fA-F]{6}\b/g;

// ─── couleurs ────────────────────────────────────────────────

function parseColors(value) {
    const found = String(value || '').match(HEX_RE);
    return found && found.length ? found : ['#5f95b9'];
}
function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function luminance(hex) { const [r, g, b] = rgb(hex); return (r * 299 + g * 587 + b * 114) / 1000; }
function shade(hex, amt) {
    const t = amt < 0 ? 0 : 255;
    const [r, g, b] = rgb(hex).map(v => Math.round(v + (t - v) * Math.abs(amt)));
    return `rgb(${r},${g},${b})`;
}
function pickTextColor(mood, colors) {
    if (typeof mood.textColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(mood.textColor)) return mood.textColor;
    const avg = colors.reduce((a, c) => a + luminance(c), 0) / colors.length;
    return avg < 128 ? '#ffffff' : '#000000';
}

// ─── dessin ──────────────────────────────────────────────────

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
    const lines = [];
    for (const para of text.split(/\n+/)) {
        let line = '';
        for (const word of para.split(/\s+/).filter(Boolean)) {
            const test = line ? line + ' ' + word : word;
            if (ctx.measureText(test).width <= maxWidth || !line) line = test;
            else { lines.push(line); line = word; }
        }
        if (line) lines.push(line);
    }
    return lines;
}

function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > maxWidth) text = text.slice(0, -1);
    return text.trimEnd() + '…';
}

// Pochette : on tente en CORS ; si le CDN ne l'autorise pas (ou est lent), on s'en passe.
function loadImage(src, timeoutMs = 2500) {
    return new Promise((resolve) => {
        if (!src) return resolve(null);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timer = setTimeout(() => resolve(null), timeoutMs);
        img.onload = () => { clearTimeout(timer); resolve(img); };
        img.onerror = () => { clearTimeout(timer); resolve(null); };
        img.src = src;
    });
}

export async function renderStoryCanvas(mood) {
    try { await document.fonts.load('500 80px Fredoka'); } catch (_) { /* police système en secours */ }

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const colors = parseColors(mood.color);
    const fg = pickTextColor(mood, colors);
    const light = luminance(fg) > 128;
    const soft = light ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.6)';

    // fond
    const g = ctx.createLinearGradient(0, 0, W * 0.45, H);
    if (colors.length === 1) {
        g.addColorStop(0, shade(colors[0], 0.12));
        g.addColorStop(1, shade(colors[0], -0.22));
    } else {
        colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = light ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
    ctx.beginPath(); ctx.arc(W - 60, 260, 420, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(100, H - 200, 380, 0, Math.PI * 2); ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // marque
    ctx.fillStyle = fg;
    ctx.font = `500 60px ${FONT}`;
    ctx.fillText('oifeel.', W / 2, 150);

    // emoji
    if (mood.emoji) {
        ctx.font = `250px ${EMOJI_FONT}`;
        ctx.fillStyle = '#000'; // ignoré pour les emojis couleur
        ctx.fillText(String(mood.emoji).slice(0, 8), W / 2, 500);
    }

    // texte (taille auto)
    const text = String(mood.text || '').trim().slice(0, 240) || '…';
    const padX = 96;
    const zoneTop = 700, zoneBottom = 1480;
    let size = 100, lines = [];
    for (; size >= 44; size -= 4) {
        ctx.font = `500 ${size}px ${FONT}`;
        lines = wrapLines(ctx, text, W - padX * 2);
        if (lines.length * size * 1.25 <= zoneBottom - zoneTop) break;
    }
    const lh = size * 1.25;
    let y = zoneTop + (zoneBottom - zoneTop - lines.length * lh) / 2 + lh / 2;
    ctx.fillStyle = fg;
    ctx.font = `500 ${size}px ${FONT}`;
    for (const l of lines) { ctx.fillText(l, W / 2, y); y += lh; }

    // musique
    const tr = mood.track;
    if (tr && (tr.title || tr.artist)) {
        const cover = await loadImage(tr.cover);
        const label = [tr.title, tr.artist].filter(Boolean).join(' — ');
        ctx.font = `500 36px ${FONT}`;
        const shown = fitText(ctx, label, 700);
        const textW = ctx.measureText(shown).width;
        const pillW = textW + 64 + 96;
        const pillH = 92;
        const px = (W - pillW) / 2;
        const py = 1580 - pillH / 2;
        ctx.fillStyle = light ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.13)';
        roundedRect(ctx, px, py, pillW, pillH, pillH / 2); ctx.fill();

        const cx = px + 24 + 34, cy = 1580;
        if (cover) {
            ctx.save();
            ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.clip();
            ctx.drawImage(cover, cx - 34, cy - 34, 68, 68);
            ctx.restore();
        } else {
            ctx.fillStyle = fg;
            ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = light ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.7)';
            ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = fg;
        ctx.textAlign = 'left';
        ctx.fillText(shown, px + 24 + 68 + 20, cy + 2);
        ctx.textAlign = 'center';
    }

    // auteur (jamais pour un post anonyme)
    const name = mood.userName && mood.userName !== 'Anonyme' && !mood.anonymous ? String(mood.userName) : '';
    if (name) {
        ctx.fillStyle = soft;
        ctx.font = `500 38px ${FONT}`;
        ctx.fillText(fitText(ctx, name, 800), W / 2, 1712);
    }

    // pied
    ctx.fillStyle = soft;
    ctx.font = `500 34px ${FONT}`;
    ctx.fillText(`partage ton ressenti · ${location.host}`, W / 2, 1826);

    return canvas;
}

function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob')), 'image/png');
    });
}

// ─── feuille de partage ──────────────────────────────────────

/**
 * @param {object} mood  { id, text, emoji, color, textColor, track, userName, anonymous }
 * @param {{notify?: (type:string, message:string)=>void}} opts
 */
export function openShareSheet(mood, opts = {}) {
    if (document.getElementById('shareSheet')) return;
    const notify = opts.notify || (() => { });
    const link = shareLink(mood.id);
    const previouslyFocused = document.activeElement;
    track('share_open');

    const overlay = document.createElement('div');
    overlay.id = 'shareSheet';
    overlay.className = 'oh-overlay share-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'partager ce post');
    overlay.innerHTML = `
        <div class="oh-panel share-panel">
            <button type="button" class="oh-close" data-share-close aria-label="fermer">×</button>
            <h2 class="share-title">partager ce post</h2>
            <div class="share-preview" data-share-preview>
                <span class="share-loading">création de l'image…</span>
            </div>
            <div class="share-actions">
                <button type="button" class="oh-btn oh-btn--primary" data-share-native disabled>partager</button>
                <button type="button" class="oh-btn share-btn-secondary" data-share-download disabled>enregistrer l'image</button>
                <button type="button" class="oh-btn share-btn-secondary" data-share-link>copier le lien</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => overlay.classList.add('open'));

    const $ = (sel) => overlay.querySelector(sel);
    const previewBox = $('[data-share-preview]');
    const nativeBtn = $('[data-share-native]');
    const downloadBtn = $('[data-share-download]');
    const linkBtn = $('[data-share-link]');
    let blob = null;
    let closed = false;

    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey);
        overlay.classList.remove('open');
        document.body.style.overflow = '';
        setTimeout(() => overlay.remove(), 220);
        if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    $('[data-share-close]').addEventListener('click', close);

    if (!navigator.share) nativeBtn.hidden = true;

    // 1) image
    renderStoryCanvas(mood).then(async (canvas) => {
        if (closed) return;
        canvas.className = 'share-canvas';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'aperçu de l\'image à partager');
        previewBox.replaceChildren(canvas);
        blob = await canvasToBlob(canvas);
        nativeBtn.disabled = false;
        downloadBtn.disabled = false;
        nativeBtn.focus();
    }).catch((err) => {
        console.error('Image de partage:', err);
        previewBox.innerHTML = '<span class="share-loading">impossible de créer l\'image — tu peux copier le lien.</span>';
    });

    // 2) actions
    nativeBtn.addEventListener('click', async () => {
        const text = String(mood.text || '').slice(0, 140);
        const data = { title: 'oifeel.', text, url: link };
        try {
            if (blob) {
                const file = new File([blob], `oifeel-${mood.id}.png`, { type: 'image/png' });
                if (navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
            }
            await navigator.share(data);
            track('share_native');
            close();
        } catch (err) {
            if (err && err.name !== 'AbortError') notify('error', 'le partage a échoué — essaie « enregistrer l\'image »');
        }
    });

    downloadBtn.addEventListener('click', () => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `oifeel-${mood.id}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        track('share_download');
        notify('success', 'image enregistrée');
    });

    linkBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(link);
            notify('success', 'lien copié');
        } catch (_) {
            window.prompt('copie ce lien :', link);
        }
        track('share_link');
    });
}
