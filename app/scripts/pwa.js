const API = 'https://moodshare-7dd7.onrender.com/api';
const urlBase64ToUint8Array = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
const authHeaders = () => ({ 'Content-Type': 'application/json', ...(localStorage.getItem('oifeel_token') ? { Authorization: `Bearer ${localStorage.getItem('oifeel_token')}` } : {}) });

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Notifications push indisponibles sur ce navigateur.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Autorisation des notifications refusée.');
  const keyRes = await fetch(`${API}/push/public-key`); const { publicKey } = await keyRes.json();
  if (!publicKey) throw new Error('Les notifications push ne sont pas encore configurées sur le serveur.');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  const res = await fetch(`${API}/push/subscribe`, { method: 'POST', headers: authHeaders(), credentials: 'include', body: JSON.stringify({ subscription: subscription.toJSON() }) });
  if (!res.ok) throw new Error('Impossible d’enregistrer cet appareil.');
  return subscription;
}

async function savePushPreferences() {
  const activity = document.getElementById('browserActivityNotif')?.checked === true;
  const reminder = document.getElementById('browserReminderNotif')?.checked === true;
  const res = await fetch(`${API}/push/preferences`, { method: 'PUT', headers: authHeaders(), credentials: 'include', body: JSON.stringify({ activity, reminder }) });
  if (!res.ok) throw new Error('Préférences non sauvegardées.');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('enableBrowserNotifBtn')?.addEventListener('click', async event => {
    event.preventDefault();
    try { await subscribeToPush(); await savePushPreferences(); window.showMsg?.('browserNotifMsg', 'notifications activées sur cet appareil.', 'success'); }
    catch (error) { window.showMsg?.('browserNotifMsg', error.message, 'error'); }
  });
  ['browserActivityNotif', 'browserReminderNotif'].forEach(id => document.getElementById(id)?.addEventListener('change', () => savePushPreferences().catch(() => {})));
  document.getElementById('testBrowserNotifBtn')?.addEventListener('click', async event => {
    event.preventDefault(); const res = await fetch(`${API}/push/test`, { method: 'POST', headers: authHeaders(), credentials: 'include' });
    window.showMsg?.('browserNotifMsg', res.ok ? 'notification test envoyée.' : (await res.json()).error || 'échec de l’envoi.', res.ok ? 'success' : 'error');
  });
});
