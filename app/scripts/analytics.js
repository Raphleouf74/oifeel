// Mesure uniquement des événements agrégés ; aucun identifiant n'est envoyé.
const analyticsApi = 'https://moodshare-7dd7.onrender.com/api/analytics/event';
const params = new URLSearchParams(location.search);
const knownSource = ['tiktok', 'discord', 'instagram', 'share'].includes(params.get('src')) ? params.get('src') : (document.referrer ? 'other' : 'direct');
export function track(event, source = knownSource) {
  if (!['visit', 'guest', 'signup', 'post', 'share', 'install'].includes(event)) return;
  fetch(analyticsApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, source }), keepalive: true }).catch(() => {});
}
track('visit');
window.oifeelTrack = track;
