/* Cache apenas de recursos do aplicativo; nenhuma mídia ou API externa. */
const VERSION = 'jornal-shell-v2';
const MAX_ASSET_VERSIONS = 2;
const SHELL = ['./','./index.html','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png','./manifest.webmanifest'];

function canHandleRequest(request, url) {
    if (request.method !== 'GET' || url.origin !== self.location.origin) return false;
    // Não interceptar recursos de outros projetos hospedados no mesmo domínio.
    if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return false;
    if (url.searchParams.has('revision_check')) return false;

    // Somente versões SHA-256 produzidas pelo gerador podem usar query string.
    // Isso impede que parâmetros arbitrários criem infinitas entradas de cache.
    if (url.search && (
        !/\.(css|js)$/.test(url.pathname)
        || url.searchParams.size !== 1
        || !/^[a-f0-9]{12}$/.test(url.searchParams.get('v') || '')
    )) return false;

    return url.pathname.endsWith('/')
        || /\.(html|css|js|svg|png|webmanifest)$/.test(url.pathname);
}

async function storeAndPrune(request, response) {
    const cache = await caches.open(VERSION);
    await cache.put(request, response);

    const url = new URL(request.url);
    if (!url.searchParams.has('v')) return;

    // Preserva as duas versões mais recentes de cada CSS/JS para abas antigas,
    // mas evita crescimento ilimitado ao longo das atualizações de meia hora.
    const versions = (await cache.keys()).filter(entry => {
        const cachedUrl = new URL(entry.url);
        return cachedUrl.pathname === url.pathname
            && cachedUrl.searchParams.has('v');
    });
    const excess = versions.length - MAX_ASSET_VERSIONS;
    if (excess > 0) {
        await Promise.all(versions.slice(0, excess).map(entry => cache.delete(entry)));
    }
}

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
    const url = new URL(request.url);
    if (!canHandleRequest(request, url)) return;

    // Prioriza sempre a rede, inclusive no HTML diário; cache apenas para
    // indisponibilidade temporária. Erro de escrita no cache não bloqueia vídeo.
    event.respondWith(fetch(request).then(response => {
        if (response.ok && response.type === 'basic') {
            event.waitUntil(storeAndPrune(request, response.clone())
                .catch(error => console.warn('Cache local indisponível:', error)));
        }
        return response;
    }).catch(async () => (await caches.match(request)) || Response.error()));
});
