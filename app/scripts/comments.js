// ============================================================
// comments.js — Système de commentaires inline
// API : GET  /api/posts/:id/comments
//       POST /api/posts/:id/comments { text, author }
// ============================================================

const API = 'https://moodshare-7dd7.onrender.com/api';
const COMMENTS_PER_PAGE = 3;

// ─── Point d'entrée ──────────────────────────────────────────
export function attachComments(postEl, postId) {
    if (postEl.dataset.commentsAttached) return;
    postEl.dataset.commentsAttached = 'true';

    // Bouton toggle commentaires
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'ctoggle';
    toggleBtn.innerHTML = `<span class="cicon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-square-more-icon lucide-message-square-more"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M12 11h.01"/><path d="M16 11h.01"/><path d="M8 11h.01"/></svg></span><span class="ccount">0</span>`;
    toggleBtn.title = 'Commentaires';

    // Insérer dans la barre d'actions
    const actionBar = postEl.querySelector('.post-actions');
    if (actionBar) {
        actionBar.insertBefore(toggleBtn, actionBar.firstChild);
    } else {
        const buttons = postEl.querySelector('.buttons');
        if (buttons) buttons.appendChild(toggleBtn);
    }

    // Section commentaires (cachée par défaut)
    const section = document.createElement('div');
    section.className = 'csection';
    section.style.display = 'none';
    section.innerHTML = `
        <div class="clist"></div>
        <div class="cmore-wrap" style="display:none">
            <button class="cmore-btn">Voir plus de commentaires</button>
        </div>
        <div class="cinput-wrap">
            <textarea class="cinput" placeholder="Écrire un commentaire..." rows="1" maxlength="500"></textarea>
            <button class="csend" title="Envoyer" aria-label="Envoyer">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
            </button>
        </div>
    `;
    postEl.appendChild(section);

    let allComments = [];
    let showCount = COMMENTS_PER_PAGE;
    let open = false;

    // Charger le compte initial sans ouvrir
    _fetchComments(postId).then(comments => {
        allComments = comments;
        _updateCount(toggleBtn, allComments.length);
    });

    // ─── Toggle ─────────────────────────────────────────────
    toggleBtn.addEventListener('click', () => {
        open = !open;
        section.style.display = open ? 'block' : 'none';
        toggleBtn.classList.toggle('copen', open);
        if (open) {
            showCount = COMMENTS_PER_PAGE;
            _render(section, allComments, showCount);
            section.querySelector('.cinput').focus();
        }
    });

    // ─── Voir plus ──────────────────────────────────────────
    section.querySelector('.cmore-btn').addEventListener('click', () => {
        showCount += COMMENTS_PER_PAGE;
        _render(section, allComments, showCount);
    });

    // ─── Envoi commentaire ──────────────────────────────────
    const input = section.querySelector('.cinput');
    const sendBtn = section.querySelector('.csend');

    const send = async () => {
        const text = input.value.trim();
        if (!text) return;

        // Récupérer le nom depuis localStorage
        const profile = _getProfile();

        // Optimistic
        const tempComment = {
            _id: `temp_${Date.now()}`,
            text,
            author: profile.displayName || 'Tu',
            createdAt: new Date().toISOString(),
            pending: true
        };
        allComments.push(tempComment);
        _updateCount(toggleBtn, allComments.length);
        _render(section, allComments, showCount + 99);
        input.value = '';
        input.style.height = '';

        // API
        try {
            const res = await fetch(`${API}/posts/${postId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ text, author: profile.displayName || 'Anonyme' })
            });
            if (res.ok) {
                const saved = await res.json();
                // Remplacer le temp par le vrai
                const idx = allComments.findIndex(c => c._id === tempComment._id);
                if (idx >= 0) allComments[idx] = saved.comment || { ...tempComment, pending: false };
            } else {
                // Conserver en local quand même
                tempComment.pending = false;
            }
        } catch (_) {
            tempComment.pending = false;
        }

        // Sauvegarder localement
        _saveLocalComments(postId, allComments);
        _render(section, allComments, showCount + 99);
    };

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    // Auto-resize textarea
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
}

// ─── Rendu liste commentaires ────────────────────────────────
function _render(section, comments, maxShow) {
    const list = section.querySelector('.clist');
    const moreWrap = section.querySelector('.cmore-wrap');

    list.innerHTML = '';

    const shown = comments.slice(0, maxShow);
    shown.forEach(c => {
        const el = document.createElement('div');
        el.className = `ccomment${c.pending ? ' cpending' : ''}`;

        const date = c.createdAt ? new Date(c.createdAt).toLocaleString('fr-FR', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        }) : '';

        const initial = (c.author || '?')[0].toUpperCase();
        const hue = _strHue(c.author || '?');

        el.innerHTML = `
            <div class="cavatar" style="background:hsl(${hue},60%,45%)">${initial}</div>
            <div class="cbody">
                <div class="cmeta">
                    <span class="cauthor">${_esc(c.author || 'Anonyme')}</span>
                    <span class="cdate">${date}</span>
                    ${c.pending ? '<span class="csending">Envoi…</span>' : ''}
                </div>
                <p class="ctext">${_esc(c.text)}</p>
            </div>
        `;
        list.appendChild(el);
    });

    // Bouton "voir plus"
    const hasMore = comments.length > maxShow;
    moreWrap.style.display = hasMore ? 'block' : 'none';
    if (hasMore) {
        section.querySelector('.cmore-btn').textContent =
            `Voir ${comments.length - maxShow} commentaire(s) de plus`;
    }
}

// ─── Fetch depuis API + fallback localStorage ────────────────
async function _fetchComments(postId) {
    try {
        const res = await fetch(`${API}/posts/${postId}/comments`);
        if (res.ok) {
            const data = await res.json();
            const comments = data.comments || data || [];
            _saveLocalComments(postId, comments);
            return comments;
        }
    } catch (_) { }
    return _loadLocalComments(postId);
}

function _updateCount(btn, count) {
    const span = btn.querySelector('.ccount');
    if (span) span.textContent = count > 0 ? count : '';
}

// ─── LocalStorage ───────────────────────────────────────────
function _saveLocalComments(pid, data) {
    try { localStorage.setItem(`comments_${pid}`, JSON.stringify(data)); } catch { }
}
function _loadLocalComments(pid) {
    try { return JSON.parse(localStorage.getItem(`comments_${pid}`) || '[]'); } catch { return []; }
}
function _getProfile() {
    try { return JSON.parse(localStorage.getItem('moodshare_profile') || '{}'); } catch { return {}; }
}

// ─── Utilitaires ────────────────────────────────────────────
function _esc(t) {
    const d = document.createElement('div'); d.textContent = t; return d.innerHTML;
}
function _strHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    return Math.abs(h) % 360;
}