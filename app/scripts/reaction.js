// ============================================================
// reactions.js — Système de réactions émoji
// Remplace le simple ❤️ par 6 réactions au survol
// API (optionnelle) : POST /api/posts/:id/react { type }
//                    GET  /api/posts/:id/reactions
// ============================================================

const API = 'https://moodshare-7dd7.onrender.com/api';

export const REACTIONS = [
    { type: 'heart', emoji: '❤️', label: "J'aime" },
    { type: 'haha', emoji: '😂', label: 'Haha' },
    { type: 'wow', emoji: '😮', label: 'Wow' },
    { type: 'sad', emoji: '😢', label: 'Triste' },
    { type: 'fire', emoji: '🔥', label: 'Feu' },
    { type: 'clap', emoji: '👏', label: 'Bravo' },


];

// ─── Point d'entrée ──────────────────────────────────────────
export function attachReactions(postEl, postId) {
    const likeBtn = postEl.querySelector('.likebtn');
    if (!likeBtn || postEl.dataset.reactionsAttached) return;
    postEl.dataset.reactionsAttached = 'true';

    // Wrapper autour du bouton like
    const wrapper = document.createElement('div');
    wrapper.className = 'rwrapper';
    likeBtn.parentNode.insertBefore(wrapper, likeBtn);
    wrapper.appendChild(likeBtn);

    // Popup réactions
    const popup = document.createElement('div');
    popup.className = 'rpopup';
    popup.setAttribute('role', 'tooltip');
    popup.innerHTML = REACTIONS.map(r =>
        `<button class="rbtn" data-type="${r.type}" title="${r.label}" aria-label="${r.label}">
            <span class="remoji">${r.emoji}</span>
            <span class="rlabel">${r.label}</span>
         </button>`
    ).join('');
    wrapper.appendChild(popup);

    // Barre de compteurs sous le like
    const bar = document.createElement('div');
    bar.className = 'rbar';
    bar.dataset.pid = postId;
    likeBtn.insertAdjacentElement('afterend', bar);

    // Charger les réactions existantes
    _loadReactions(postId, bar);

    // ─── Affichage popup ────────────────────────────────────
    let hideTimer;
    const show = () => { clearTimeout(hideTimer); popup.classList.add('rvisible'); };
    const hide = (delay = 280) => { hideTimer = setTimeout(() => popup.classList.remove('rvisible'), delay); };

    wrapper.addEventListener('mouseenter', show);
    wrapper.addEventListener('mouseleave', () => hide());
    popup.addEventListener('mouseenter', show);
    popup.addEventListener('mouseleave', () => hide());

    // Long press mobile
    let pressTimer;
    likeBtn.addEventListener('touchstart', (e) => {
        pressTimer = setTimeout(() => { e.preventDefault(); show(); }, 400);
    }, { passive: false });
    likeBtn.addEventListener('touchend', () => clearTimeout(pressTimer));

    // Tap rapide = reaction "heart" par défaut (comportement like classique)
    likeBtn.addEventListener('click', (e) => {
        if (popup.classList.contains('rvisible')) return;
        _handleReaction(postId, 'heart', bar, postEl);
    });

    // Clic sur une réaction
    popup.querySelectorAll('.rbtn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            hide(0);
            _handleReaction(postId, btn.dataset.type, bar, postEl);
        });
    });

    // Restaurer réaction locale
    const myReaction = _getMyReaction(postId);
    if (myReaction) _applyReactionToBtn(likeBtn, myReaction);
}

// ─── Toggle réaction ─────────────────────────────────────────
async function _handleReaction(postId, type, bar, postEl) {
    const likeBtn = postEl.querySelector('.likebtn');
    const current = _getMyReaction(postId);
    const removing = current === type;

    // Mise à jour locale optimiste
    if (removing) {
        _setMyReaction(postId, null);
        _resetBtn(likeBtn);
        _adjustLocalCount(postId, type, -1);
    } else {
        if (current) _adjustLocalCount(postId, current, -1);
        _setMyReaction(postId, type);
        _applyReactionToBtn(likeBtn, type);
        _adjustLocalCount(postId, type, +1);

        // Animation pop
        likeBtn.classList.add('rpop');
        setTimeout(() => likeBtn.classList.remove('rpop'), 400);
    }

    // Mettre à jour la barre localement
    _renderBar(bar, _getLocalCounts(postId));

    // Appel API (gracieux)
    try {
        const url = removing
            ? `${API}/posts/${postId}/unreact`
            : `${API}/posts/${postId}/react`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ type })
        });
        if (res.ok) {
            const data = await res.json();
            if (data.reactions) _renderBar(bar, data.reactions);
        }
    } catch (_) { /* API indisponible — localStorage suffit */ }
}

// ─── Chargement depuis API ───────────────────────────────────
async function _loadReactions(postId, bar) {
    try {
        const res = await fetch(`${API}/posts/${postId}/reactions`);
        if (res.ok) {
            const data = await res.json();
            if (data.reactions && Object.keys(data.reactions).length > 0) {
                _setLocalCounts(postId, data.reactions);
                _renderBar(bar, data.reactions);
                return;
            }
        }
    } catch (_) { }
    // Fallback localStorage
    const local = _getLocalCounts(postId);
    if (Object.keys(local).length) _renderBar(bar, local);
}

// ─── Rendu barre de compteurs ────────────────────────────────
function _renderBar(bar, reactions) {
    bar.innerHTML = '';
    const entries = REACTIONS.filter(r => (reactions[r.type] || 0) > 0);
    if (!entries.length) return;

    entries.forEach(r => {
        const chip = document.createElement('button');
        chip.className = 'rchip';
        chip.dataset.type = r.type;
        chip.innerHTML = `${r.emoji}<span>${reactions[r.type]}</span>`;
        bar.appendChild(chip);
    });
}

// ─── Visuel bouton like ──────────────────────────────────────
function _applyReactionToBtn(btn, type) {
    const r = REACTIONS.find(x => x.type === type);
    if (!r) return;
    btn.classList.add('liked', `ractive-${type}`);

    const svg = btn.querySelector('svg');
    if (svg) {
        if (!btn.dataset.svgBak) btn.dataset.svgBak = svg.outerHTML;
        const span = document.createElement('span');
        span.className = 'ractive-emoji';
        span.textContent = r.emoji;
        svg.replaceWith(span);
    }
}

function _resetBtn(btn) {
    btn.classList.remove('liked', ...REACTIONS.map(r => `ractive-${r.type}`));
    const span = btn.querySelector('.ractive-emoji');
    if (span && btn.dataset.svgBak) {
        const t = document.createElement('div');
        t.innerHTML = btn.dataset.svgBak;
        span.replaceWith(t.firstChild);
    }
}

// ─── Persistance locale ──────────────────────────────────────
function _getMyReaction(pid) {
    try { return JSON.parse(localStorage.getItem('my_reactions') || '{}')[pid] || null; }
    catch { return null; }
}
function _setMyReaction(pid, type) {
    try {
        const d = JSON.parse(localStorage.getItem('my_reactions') || '{}');
        if (type) d[pid] = type; else delete d[pid];
        localStorage.setItem('my_reactions', JSON.stringify(d));
    } catch { }
}
function _getLocalCounts(pid) {
    try { return JSON.parse(localStorage.getItem(`rc_${pid}`) || '{}'); }
    catch { return {}; }
}
function _setLocalCounts(pid, data) {
    try { localStorage.setItem(`rc_${pid}`, JSON.stringify(data)); } catch { }
}
function _adjustLocalCount(pid, type, delta) {
    const d = _getLocalCounts(pid);
    d[type] = Math.max(0, (d[type] || 0) + delta);
    _setLocalCounts(pid, d);
}