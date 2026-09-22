// config.js — constantes partagées par analytics.js, share.js et pwa.js
// (app.js garde sa propre constante API_BASE : on ne la touche pas)

// Backend (Render)
export const API_BASE = 'https://moodshare-7dd7.onrender.com';

// Base des liens de partage "…/p/<id>" (page OG servie par le backend).
// Plus tard, si tu ajoutes la règle Netlify  /p/*  →  Render  (voir LISEZMOI),
// mets ici  location.origin  pour avoir des liens à ton nom de domaine.
export const SHARE_BASE = API_BASE;

export function shareLink(postId) {
    return `${SHARE_BASE}/p/${encodeURIComponent(postId)}`;
}

export function authHeaders(extra = {}) {
    const token = localStorage.getItem('oifeel_token');
    return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
