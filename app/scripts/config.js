// config.js — constantes partagées par analytics.js, share.js et pwa.js
// (app.js garde sa propre constante API_BASE : on ne la touche pas)

// Backend (Render)
export const API_BASE = 'https://moodshare-7dd7.onrender.com';

// Liens publics des posts : ils ouvrent directement le permalink dans l'app.
export const SHARE_BASE = 'https://oifeel.netlify.app/app/';

export function shareLink(postId) {
    return `${SHARE_BASE}#post-${encodeURIComponent(postId)}`;
}

export function authHeaders(extra = {}) {
    const token = localStorage.getItem('oifeel_token');
    return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
