// analytics.js — compteurs d'usage anonymes (voir services/analytics.cjs côté serveur)
//
// Aucune donnée personnelle : on envoie seulement le NOM d'un événement (et, pour la
// visite, le canal d'origine). Pas de cookie, pas d'identifiant, pas de suivi entre sessions.
// Respecte "Do Not Track" et ne compte rien en local (localhost).
import { API_BASE } from './config.js';

// En local on ne compte rien, sauf si tu tapes dans la console :  localStorage.oifeel_track_local = '1'
const isLocal = /^(localhost|127\.|192\.168\.|\[::1\])/.test(location.hostname)
    && localStorage.getItem('oifeel_track_local') !== '1';
const dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1';

export function track(event, source) {
    if (isLocal || dnt) return;
    try {
        fetch(`${API_BASE}/api/track`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(source ? { event, source } : { event }),
            keepalive: true,
            credentials: 'omit'
        }).catch(() => { });
    } catch (_) { /* jamais bloquant */ }
}

// D'où vient la visite ? (?utm_source=tiktok dans le lien en bio > referrer > direct)
export function detectSource() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const params = new URLSearchParams(location.search);
    let raw = (params.get('utm_source') || params.get('src') || '').toLowerCase().trim();

    if (!raw && document.referrer) {
        try {
            const host = new URL(document.referrer).hostname.toLowerCase();
            if (host !== location.hostname) raw = host;
        } catch (_) { }
    }
    if (!raw) return standalone ? 'pwa' : 'direct';

    const map = [
        ['tiktok', 'tiktok'], ['instagram', 'instagram'], ['discord', 'discord'],
        ['reddit', 'reddit'], ['whatsapp', 'whatsapp'], ['wa.me', 'whatsapp'],
        ['snapchat', 'snapchat'], ['youtube', 'youtube'], ['youtu.be', 'youtube'],
        ['facebook', 'facebook'], ['fb.com', 'facebook'], ['threads', 'threads'],
        ['twitter', 'x'], ['t.co', 'x'], ['x.com', 'x'], ['google', 'google'],
        ['share', 'share'], ['pwa', 'pwa']
    ];
    for (const [needle, name] of map) if (raw.includes(needle)) return name;
    return 'other';
}

// Une seule "visite" par onglet ouvert (sessionStorage), pas à chaque rechargement.
export function trackVisitOnce() {
    try {
        if (sessionStorage.getItem('oifeel_visit_tracked')) return;
        sessionStorage.setItem('oifeel_visit_tracked', '1');
    } catch (_) { /* stockage bloqué : on compte quand même */ }
    track('visit', detectSource());
}
