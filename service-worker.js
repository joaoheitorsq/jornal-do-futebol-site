/* Cache limitado ao próprio aplicativo. Nunca armazenar mídias ou APIs externas. */
const VERSION = 'jornal-shell-v1';
const SHELL = ['./','./index.html','./assets/icon.svg','./manifest.webmanifest'];
self.addEventListener('install', event => {
    event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL))
        .then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(
        keys.filter(key => key.startsWith('jornal-shell-') && key !== VERSION)
            .map(key => caches.delete(key))
    )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (!url.pathname.endsWith('/') && !/\.(html|css|js|svg|webmanifest)$/.test(url.pathname)) return;
    event.respondWith(fetch(request).then(response => {
        if (response.ok && response.type === 'basic') {
            const cloned = response.clone();
            event.waitUntil(caches.open(VERSION).then(cache => cache.put(request,cloned)));
        }
        return response;
    }).catch(async () => (await caches.match(request)) || Response.error()));
});
