// playlist-sheet.js — fenêtre "playlist Musibox" : on écoute les extraits sans quitter oifeel.,
// et un gros bouton ouvre la playlist complète dans Musibox.
//
// Tout est construit avec textContent / createElement : rien venant d'un post n'est interprété comme du HTML.
import { API_BASE } from './config.js';

// Le lien n'est accepté que s'il s'agit d'une URL https "…/playlist/…" (jamais de javascript:).
export function safePlaylistUrl(raw) {
    try {
        const u = new URL(raw);
        return u.protocol === 'https:' && u.pathname.startsWith('/playlist/') ? u.href : null;
    } catch (_) { return null; }
}

const COVER_RE = /^https:\/\/[a-z0-9.-]+\.dzcdn\.net\//i;
const safeCover = (src) => (typeof src === 'string' && COVER_RE.test(src) ? src : '');

export function playlistMeta(pl, tr = {}) {
    const mins = Math.max(1, Math.round((Number(pl.durationSec) || 0) / 60));
    return `${Number(pl.count) || 0} ${tr.playlist_songs || 'titres'} · ${mins} min`;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function mosaic(covers) {
    const box = el('div', 'pl-mosaic');
    const list = (covers || []).map(safeCover).filter(Boolean);
    for (let i = 0; i < 4; i++) {
        const src = list.length ? list[i % list.length] : '';
        if (src) { const img = el('img'); img.src = src; img.alt = ''; img.loading = 'lazy'; box.append(img); }
        else box.append(el('span', 'pl-mosaic-empty'));
    }
    return box;
}

/**
 * @param {object} pl    { name, count, durationSec, covers, tracks:[{trackId,title,artist,cover}], url, expiresAt }
 * @param {{stopOthers?:()=>void, notify?:(type:string,msg:string)=>void, translations?:object, author?:string}} opts
 */
export function openPlaylistSheet(pl, opts = {}) {
    if (document.getElementById('playlistSheet')) return;
    const { stopOthers = () => { }, notify = () => { }, translations: tr = {}, author = '' } = opts;
    const link = safePlaylistUrl(pl.url);
    const tracks = Array.isArray(pl.tracks) ? pl.tracks : [];
    const expired = !!(pl.expiresAt && new Date(pl.expiresAt).getTime() <= Date.now());
    const previouslyFocused = document.activeElement;

    const overlay = el('div', 'oh-overlay pl-overlay');
    overlay.id = 'playlistSheet';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', pl.name || 'playlist');

    const panel = el('div', 'oh-panel pl-panel');
    const closeBtn = el('button', 'oh-close', '×');
    closeBtn.type = 'button'; closeBtn.setAttribute('aria-label', tr.close || 'fermer');

    // en-tête : mosaïque + infos
    const head = el('div', 'pl-head');
    const info = el('div', 'pl-info');
    info.append(el('span', 'pl-kicker', 'playlist · Musibox'), el('h2', 'pl-name', pl.name || 'Playlist'), el('span', 'pl-meta', playlistMeta(pl, tr)));
    if (author) info.append(el('span', 'pl-author', `${tr.playlist_by || 'partagée par'} ${author}`));
    head.append(mosaic(pl.covers), info);

    // actions
    const actions = el('div', 'pl-actions');
    const playAllBtn = el('button', 'oh-btn oh-btn--primary', `▶ ${tr.playlist_play_all || 'tout écouter'}`);
    playAllBtn.type = 'button';
    playAllBtn.hidden = !tracks.length;
    actions.append(playAllBtn);
    if (link && !expired) {
        const open = el('a', 'oh-btn pl-btn-secondary', `${tr.playlist_open || 'ouvrir dans Musibox'} ↗`);
        open.href = link; open.target = '_blank'; open.rel = 'noopener noreferrer';
        actions.append(open);
        const copy = el('button', 'oh-btn pl-btn-secondary', tr.playlist_copy || 'copier le lien');
        copy.type = 'button';
        copy.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(link); notify('success', 'lien copié'); }
            catch (_) { window.prompt('copie ce lien :', link); }
        });
        actions.append(copy);
    }

    // titres
    const list = el('ul', 'pl-tracks');
    const rows = [];
    tracks.forEach((t, i) => {
        const li = el('li', 'pl-track');
        const cover = el('img', 'pl-track-cover'); cover.alt = ''; cover.loading = 'lazy';
        const src = safeCover(t.cover); if (src) cover.src = src;
        const text = el('div', 'pl-track-text');
        text.append(el('span', 'pl-track-title', t.title || '—'), el('span', 'pl-track-artist', t.artist || ''));
        const btn = el('button', 'pl-track-play'); btn.type = 'button';
        btn.setAttribute('aria-label', `${tr.playlist_listen || 'écouter'} ${t.title || ''}`);
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        btn.addEventListener('click', () => { playAll = false; current === i ? stopAudio() : playIndex(i); });
        li.append(cover, text, btn);
        list.append(li); rows.push(li);
    });

    const more = Math.max(0, (Number(pl.count) || 0) - tracks.length);
    const foot = el('p', 'pl-foot');
    foot.textContent = !tracks.length
        ? (tr.playlist_open_to_listen || 'ouvre la playlist dans Musibox pour l’écouter.')
        : more > 0 ? `+ ${more} ${tr.playlist_more || 'autres titres dans Musibox'} · extraits de 30 s` : 'extraits de 30 s';
    if (expired) foot.textContent += ' · ' + (tr.playlist_expired || 'le lien a expiré');

    panel.append(closeBtn, head, actions);
    if (tracks.length) panel.append(list);
    panel.append(foot);
    overlay.append(panel);
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => overlay.classList.add('open'));

    // ─── lecture des extraits ───
    let audio = null, current = -1, playAll = false, closed = false;

    async function previewUrl(t) {
        const res = await fetch(`${API_BASE}/api/music/preview/${encodeURIComponent(t.trackId)}`);
        if (!res.ok) throw new Error('preview');
        const data = await res.json();
        if (!data.preview) throw new Error('preview');
        return data.preview;
    }
    function paint() {
        rows.forEach((r, i) => r.classList.toggle('playing', i === current));
        playAllBtn.textContent = playAll && current >= 0 ? `❚❚ ${tr.playlist_pause || 'pause'}` : `▶ ${tr.playlist_play_all || 'tout écouter'}`;
    }
    function stopAudio() {
        if (audio) { audio.pause(); audio = null; }
        current = -1; playAll = false; paint();
    }
    async function playIndex(i) {
        if (closed) return;
        if (audio) { audio.pause(); audio = null; }
        stopOthers();
        current = i; paint();
        try {
            const url = await previewUrl(tracks[i]);
            if (closed || current !== i) return; // un autre clic a pris le relais
            audio = new Audio(url);
            audio.addEventListener('ended', () => { playAll && i + 1 < tracks.length ? playIndex(i + 1) : stopAudio(); });
            await audio.play();
        } catch (_) {
            if (closed || current !== i) return;
            if (playAll && i + 1 < tracks.length) return playIndex(i + 1); // extrait indisponible : on passe au suivant
            notify('error', tr.fb_music_unavailable || 'extrait indisponible');
            stopAudio();
        }
    }
    playAllBtn.addEventListener('click', () => {
        if (playAll && current >= 0) return stopAudio();
        playAll = true; playIndex(0);
    });

    // ─── fermeture ───
    function close() {
        if (closed) return;
        closed = true;
        stopAudio();
        document.removeEventListener('keydown', onKey);
        overlay.classList.remove('open');
        document.body.style.overflow = '';
        setTimeout(() => overlay.remove(), 220);
        if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    closeBtn.addEventListener('click', close);
    (tracks.length ? playAllBtn : closeBtn).focus();
}
