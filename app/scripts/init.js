

import { attachReactions } from './reaction.js';
import { attachComments } from './comments.js';
import { initCreatorExtras } from './creator-extras.js';
import { initFeedExtras } from './feed-extras.js';

// ─── initV2() : appelé UNE FOIS après chargement du feed ─────
export async function initV2() {

    // 1. Améliorations du créateur de post
    initCreatorExtras();

    // 2. Feed : tri, vue, mood du jour, infinite scroll
    initFeedExtras();

    // 5. Attacher réactions + commentaires à tous les posts existants
    document.querySelectorAll('.post[data-id]').forEach(postEl => {
        attachV2ToPost(postEl, postEl.dataset.id);
    });

    // 6. Observer les nouveaux posts ajoutés dynamiquement (SSE / repost)
    _observeNewPosts();
}

// ─── attachV2ToPost() : appelé dans displayMood() ─────────────
export function attachV2ToPost(postEl, postId) {
    if (!postEl || !postId) return;
    // Petit délai pour laisser le DOM se stabiliser
    requestAnimationFrame(() => {
        attachReactions(postEl, postId);
        attachComments(postEl, postId);
    });
}

// ─── Observer les nouveaux posts (SSE / pagination) ──────────
function _observeNewPosts() {
    const wall = document.getElementById('moodWall');
    if (!wall) return;

    new MutationObserver(mutations => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                if (node.classList?.contains('post') && node.dataset?.id) {
                    attachV2ToPost(node, node.dataset.id);
                }
                // Au cas où le post est enveloppé dans un div
                node.querySelectorAll?.('.post[data-id]').forEach(p => {
                    attachV2ToPost(p, p.dataset.id);
                });
            });
        });
    }).observe(wall, { childList: true, subtree: false });
}



async function _getCurrentUserId() {
    try {
        const token = localStorage.getItem('moodshare_token');
        if (!token) return null;
        const res = await fetch('https://moodshare-7dd7.onrender.com/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include'
        });
        if (res.ok) {
            const data = await res.json();
            return (data.user || data)?.id || (data.user || data)?._id || null;
        }
    } catch { }
    return null;
}