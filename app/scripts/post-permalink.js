// post-permalink.js
// Gère la navigation directe vers un post via le hash #post-{id}
// Usage : importer ce fichier et appeler initPermalinks() après le chargement des posts

const API = 'https://moodshare-7dd7.onrender.com/api';

// ============================================================
// POINT D'ENTRÉE PRINCIPAL
// ============================================================

/**
 * À appeler UNE FOIS après que les posts sont chargés dans le DOM.
 * Gère le hash initial ET les changements de hash ultérieurs.
 */
export function initPermalinks() {
    // Lecture du hash à l'arrivée sur la page
    handleHash(window.location.hash);

    // Écoute les changements (retour arrière, navigation)
    window.addEventListener('hashchange', () => handleHash(window.location.hash));
}

// ============================================================
// LECTURE DU HASH
// ============================================================

function handleHash(hash) {
    if (!hash || !hash.startsWith('#post-')) return;

    const postId = hash.replace('#post-', '').trim();
    if (!postId) return;

    openPostModal(postId);
}

// ============================================================
// MODAL POST PERMALINK
// ============================================================

/**
 * Ouvre la modale d'un post.
 * Exporté pour être appelé au clic depuis displayMood() dans app.js.
 */
export async function openPostModal(postId) {
    // Évite les doublons
    if (document.getElementById('permalink-modal')) return;

    // Chercher d'abord dans le DOM
    const postEl = document.querySelector(`.post[data-id="${postId}"]`);

    let mood = null;

    if (postEl) {
        // Extraire les données depuis le DOM existant
        mood = extractMoodFromEl(postEl, postId);
    } else {
        // Pas trouvé dans le DOM → fetch direct API
        try {
            const res = await fetch(`${API}/posts/${postId}`);
            if (!res.ok) {
                showPermalinkError(postId);
                return;
            }
            mood = await res.json();
        } catch (err) {
            console.error('❌ Permalink fetch error:', err);
            showPermalinkError(postId);
            return;
        }
    }

    renderModal(mood, postId, postEl);
}

// ============================================================
// EXTRACTION DES DONNÉES DEPUIS LE DOM
// ============================================================

function extractMoodFromEl(postEl, postId) {
    const emoji = postEl.querySelector('.post-emoji')?.textContent || '';
    const text = postEl.querySelector('.post-text')?.textContent || '';
    const bg = postEl.querySelector('.post-content')?.style.background || '';
    const likeCount = postEl.querySelector('.like-count')?.textContent || '0';
    const dateText = postEl.querySelector('.postdate')?.textContent?.replace('Créé le ', '') || '';
    const stickerSrc = postEl.querySelector('.post-sticker')?.src || null;
    const isEphemeral = postEl.classList.contains('ephemeral');

    return {
        id: postId,
        emoji,
        text,
        color: bg,
        likes: parseInt(likeCount, 10) || 0,
        createdAt: dateText,
        stickerUrl: stickerSrc,
        ephemeral: isEphemeral
    };
}

// ============================================================
// RENDU DU MODAL
// ============================================================

function renderModal(mood, postId, postEl) {
    const overlay = document.createElement('div');
    overlay.id = 'permalink-modal';
    overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.85);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: plFadeIn 0.25s ease;
        padding: 16px;
        box-sizing: border-box;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
        background: var(--bg-secondary, #b6b6b6);
        border-radius: 5px;
        padding: 32px 28px 28px;
        width: 80%;
        height: 90%;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-evenly;
        position: relative;
        box-shadow: 0 16px 48px rgba(0,0,0,0.6);
        animation: plSlideUp 0.3s ease;
        box-sizing: border-box;
    `;


    // ---- Bouton fermer ----
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
        position: absolute;
        top: 14px;
        right: 14px;
        background: rgba(255,255,255,0.08);
        border: none;
        color: #aaa;
        font-size: 1rem;
        width: 32px;
        height: 32px;
        border-radius: 5px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s, color 0.2s;
    `;
    closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.background = 'rgba(255,255,255,0.15)';
        closeBtn.style.color = '#fff';
    });
    closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.background = 'rgba(255,255,255,0.08)';
        closeBtn.style.color = '#aaa';
    });

    // ---- Carte post ----
    const card = document.createElement('div');
    card.style.cssText = `
        background: ${mood.color || '#222'};
        border-radius: 5px;
        padding: 28px 24px;
        text-align: center;
        min-height: 160px;
        display: flex;
        width: 95%;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin-bottom: 20px;
        position: relative;
        overflow: hidden;
    `;

    // Calcul couleur texte auto
    const textColor = mood.textColor || getAutoTextColor(mood.color || '#222');

    if (mood.emoji) {
        const emojiEl = document.createElement('span');
        emojiEl.textContent = mood.emoji;
        emojiEl.style.cssText = `font-size: 3rem; line-height: 1; color: ${textColor};`;
        card.appendChild(emojiEl);
    }

    if (mood.text) {
        const textEl = document.createElement('p');
        textEl.textContent = mood.text;
        textEl.style.cssText = `
            margin: 0;
            font-size: 1.05rem;
            line-height: 1.5;
            color: ${textColor};
            word-break: break-word;
        `;
        card.appendChild(textEl);
    }

    if (mood.stickerUrl) {
        const stickerImg = document.createElement('img');
        stickerImg.src = mood.stickerUrl;
        stickerImg.alt = 'Sticker';
        stickerImg.style.cssText = 'max-width: 160px; max-height: 120px; border-radius: 5px;';
        card.appendChild(stickerImg);
    }

    if (mood.ephemeral) {
        const ephLabel = document.createElement('span');
        ephLabel.textContent = '⏳ Message éphémère';
        ephLabel.style.cssText = `
            font-size: 0.75rem;
            color: ${textColor};
            opacity: 0.7;
            margin-top: 4px;
        `;
        card.appendChild(ephLabel);
    }

    // ---- Métadonnées ----
    const meta = document.createElement('div');
    meta.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 2.5rem;
        color: #888;
        margin-bottom: 20px;
        width: 95%;
        flex-wrap: wrap;
        gap: 8px;
    `;

    const likesBadge = document.createElement('span');
    likesBadge.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: #e57;
        font-weight: 600;
    `;
    likesBadge.innerHTML = `❤️ ${mood.likes || 0} like${(mood.likes || 0) !== 1 ? 's' : ''}`;

    const dateBadge = document.createElement('span');
    if (mood.createdAt) {
        // Si c'est déjà une string formatée (depuis DOM), l'afficher tel quel
        // Si c'est une date ISO (depuis API), la formatter
        let dateStr = mood.createdAt;
        if (dateStr.includes('T') || dateStr.includes('Z')) {
            dateStr = new Date(dateStr).toLocaleString('fr-FR', {
                year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        }
        dateBadge.textContent = '📅 ' + dateStr;
    }

    meta.appendChild(likesBadge);
    if (mood.createdAt) meta.appendChild(dateBadge);

    // ---- Actions ----
    const actions = document.createElement('div');
    actions.style.cssText = `
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
    `;

    // Bouton "Voir dans le fil"
    const goToFeedBtn = document.createElement('button');
    goToFeedBtn.textContent = '📋 Voir dans le fil';
    goToFeedBtn.style.cssText = btnStyle('#2a2a2a', '#fff', '1px solid #444');
    goToFeedBtn.addEventListener('click', () => {
        closeModal(overlay);
        // Activer l'onglet Home si nécessaire
        const home = document.getElementById('home');
        if (home) home.click();

        // Scroll vers le post avec un léger délai
        setTimeout(() => {
            const target = document.querySelector(`.post[data-id="${postId}"]`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Flash highlight
                target.style.transition = 'box-shadow 0.3s';
                target.style.boxShadow = '0 0 0 13px #d31313, 0 0 20px rgba(255, 13, 106, 0.4)';
                setTimeout(() => { target.style.boxShadow = ''; }, 2200);
            }
        }, 300);
    });

    // Bouton "Copier le lien"
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '🔗 Copier le lien';
    copyBtn.style.cssText = btnStyle('linear-gradient(135deg,#667eea,#764ba2)', '#fff');
    copyBtn.addEventListener('click', async () => {
        const url = `${location.origin}${location.pathname}#post-${postId}`;
        try {
            await navigator.clipboard.writeText(url);
            copyBtn.textContent = '✅ Copié !';
            setTimeout(() => copyBtn.textContent = '🔗 Copier le lien', 2000);
        } catch {
            prompt('Copie ce lien :', url);
        }
    });

    actions.appendChild(goToFeedBtn);
    actions.appendChild(copyBtn);

    // ---- Assembly ----
    panel.appendChild(closeBtn);
    panel.appendChild(card);
    panel.appendChild(meta);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // ---- Fermeture ----
    function close() { closeModal(overlay); }

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });

    injectPermalinkStyles();
}

// ============================================================
// FERMETURE MODALE + NETTOYAGE HASH
// ============================================================

function closeModal(overlay) {
    overlay.style.animation = 'plFadeOut 0.2s ease forwards';
    setTimeout(() => {
        overlay.remove();
        // Retirer le hash sans recharger la page
        history.replaceState(null, '', location.pathname + location.search);
    }, 200);
}

// ============================================================
// ERREUR : post introuvable
// ============================================================

function showPermalinkError(postId) {
    const overlay = document.createElement('div');
    overlay.id = 'permalink-modal';
    overlay.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.85);
        backdrop-filter: blur(6px);
        z-index: 99999;
        display: flex; align-items: center; justify-content: center;
        padding: 16px; box-sizing: border-box;
        animation: plFadeIn 0.25s ease;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
        background: var(--bg-secondary, #1a1a1a);
        border-radius: 5px; padding: 40px 28px; max-width: 380px; width: 100%;
        text-align: center; box-shadow: 0 16px 48px rgba(0,0,0,0.6);
        animation: plSlideUp 0.3s ease;
    `;
    panel.innerHTML = `
        <div style="font-size:3rem;margin-bottom:16px">🔍</div>
        <h3 style="margin:0 0 8px;font-size:1.2rem">Post introuvable</h3>
        <p style="color:#888;margin:0 0 24px;font-size:0.9rem">
            Ce post n'existe plus ou le lien est invalide.
        </p>
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Fermer';
    closeBtn.style.cssText = btnStyle('linear-gradient(135deg,#667eea,#764ba2)', '#fff');
    closeBtn.addEventListener('click', () => closeModal(overlay));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });

    panel.appendChild(closeBtn);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    injectPermalinkStyles();
}

// ============================================================
// STYLES ANIMATIONS
// ============================================================

let stylesInjected = false;
function injectPermalinkStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.textContent = `
        @keyframes plFadeIn {
            from { opacity: 0; }
            to   { opacity: 1; }
        }
        @keyframes plFadeOut {
            from { opacity: 1; }
            to   { opacity: 0; }
        }
        @keyframes plSlideUp {
            from { opacity: 0; transform: translateY(24px) scale(0.97); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        #permalink-modal::-webkit-scrollbar { display: none; }
    `;
    document.head.appendChild(style);
}

// ============================================================
// UTILITAIRES
// ============================================================

function getAutoTextColor(hexOrColor) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = hexOrColor;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 128 ? '#1a1a1a' : '#ffffff';
    } catch {
        return '#ffffff';
    }
}

function btnStyle(bg, color, border = 'none') {
    return `
        flex: 1;
        min-width: 130px;
        padding: 11px 18px;
        border-radius: 5px;
        border: ${border};
        background: ${bg};
        color: ${color};
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.2s, transform 0.15s;
        white-space: nowrap;
    `;
}