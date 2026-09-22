/* sw.js — service worker de oifeel.
 * - Hors-ligne "raisonnable" : réseau d'abord, copie en cache en secours (les mises à jour
 *   du site arrivent donc tout de suite, sans fichiers versionnés).
 * - Ne touche JAMAIS à l'API (autre domaine) ni à l'admin.
 * - Reçoit les notifications push et ouvre le bon écran au clic.
 * Placé à la RACINE du site pour contrôler toutes les pages.
 */
const CACHE = 'oifeel-v1';
const ICON = '/app/assets/icons/icon-192.png';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['/', ICON]).catch(() => { }))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // API, polices, CDN : intacts
  if (url.pathname === '/sw.js' || url.pathname === '/version.json' || url.pathname.startsWith('/admin')) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === 'basic') {
        const copy = fresh.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => { });
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('/');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});

// ─── notifications push ──────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = { body: event.data ? event.data.text() : '' }; }

  event.waitUntil(self.registration.showNotification(data.title || 'oifeel.', {
    body: data.body || '',
    icon: ICON,
    badge: ICON,
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // on n'ouvre que des URLs de notre propre site
  let target = self.location.origin + '/';
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
    if (u.origin === self.location.origin) target = u.href;
  } catch (_) { }

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        try { w.postMessage({ type: 'open-url', url: target }); } catch (_) { }
        try { await w.focus(); } catch (_) { /* certaines plateformes refusent : le message est déjà parti */ }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
