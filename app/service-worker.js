const CACHE_NAME = 'oifeel.';
const urlsToCache = [
    '/',
    '/index.html',
    '/styles/main.css',
    '/scripts/app.js',
    '/assets/icons/logo_dark.jpg'
];

self.addEventListener('install', (event) => {
    // Supprime tout cache existant lors de l’installation du nouveau SW
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(cacheNames.map((cache) => caches.delete(cache)));
        })
    );
    self.skipWaiting(); // Force l’activation immédiate du nouveau SW
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim()); // Applique instantanément le nouveau SW
});


self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});