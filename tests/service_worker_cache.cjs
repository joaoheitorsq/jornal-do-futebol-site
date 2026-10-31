#!/usr/bin/env node
'use strict';
// Simula a Cache API sem rede para verificar limites e isolamento do PWA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const origin = 'https://example.github.io';
const scope = origin + '/jornal-do-futebol-site/';
const handlers = {};
const stores = new Map();
let offline = false;

function response(body) {
    return {
        ok: true, type: 'basic', body,
        clone() { return response(body); }
    };
}

function urlOf(request) {
    return typeof request === 'string' ? request : request.url;
}

async function openCache(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return {
        async addAll(paths) {
            for (const part of paths) {
                entries.set(new URL(part, scope).href, response(part));
            }
        },
        async put(request, value) { entries.set(urlOf(request), value); },
        async keys() { return [...entries.keys()].map(url => ({url})); },
        async delete(request) { return entries.delete(urlOf(request)); }
    };
}

const caches = {
    open: openCache,
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(request) {
        for (const entries of stores.values()) {
            if (entries.has(urlOf(request))) return entries.get(urlOf(request));
        }
        return undefined;
    }
};

vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../service-worker.js'), 'utf8'),
    {
        self: {
            location: {origin},
            registration: {scope},
            addEventListener(name, handler) { handlers[name] = handler; },
            skipWaiting: async () => {},
            clients: {claim: async () => {}}
        },
        caches, URL, console,
        fetch: async request => {
            if (offline) throw new Error('Rede indisponível');
            return response(urlOf(request));
        },
        Response: {error() { return {offline: true}; }}
    },
    {filename: 'service-worker.js'}
);

async function lifecycle(name) {
    const pending = [];
    handlers[name]({waitUntil(promise) { pending.push(promise); }});
    await Promise.all(pending);
}

async function request(url, method = 'GET') {
    const pending = [];
    let result;
    handlers.fetch({
        request: {url, method},
        respondWith(promise) { result = promise; },
        waitUntil(promise) { pending.push(promise); }
    });
    if (!result) return null;
    const answer = await result;
    await Promise.all(pending);
    return answer;
}

(async () => {
    stores.set('jornal-shell-v1', new Map([['obsolete', response('old')]]));
    await lifecycle('install');
    await lifecycle('activate');
    assert.equal(stores.has('jornal-shell-v1'), false, 'Cache antigo não foi removido');
    assert.equal(stores.has('jornal-shell-v2'), true, 'Nova versão não foi criada');

    const asset = scope + 'assets/core.js?v=';
    const ids = ['111111111111', '222222222222', '333333333333'];
    for (const id of ids) {
        const result = await request(asset + id);
        assert.equal(result.body, asset + id, 'Versão válida não carregou da rede');
    }

    const stored = [...stores.get('jornal-shell-v2').keys()]
        .filter(url => url.startsWith(asset));
    assert.equal(stored.length, 2, 'Cache de JS cresceu sem limite');
    assert.equal(stored.includes(asset + ids[0]), false, 'Versão mais antiga permaneceu');
    assert.equal(stored.includes(asset + ids[2]), true, 'Versão atual foi removida');

    offline = true;
    assert.equal((await request(asset + ids[2])).body, asset + ids[2],
        'Modo offline não recuperou a versão válida');
    offline = false;

    assert.equal(await request(asset + '333333333333&foo=1'), null,
        'Parâmetros arbitrários foram interceptados');
    assert.equal(await request(scope + '?revision_check=123'), null,
        'Checagem de revisão não pode ser armazenada');
    assert.equal(await request(origin + '/outro-site/assets/core.js?v=333333333333'), null,
        'Site fora do escopo foi interceptado');
    assert.equal(await request('https://www.youtube.com/watch?v=abc'), null,
        'Recurso externo foi interceptado');
    assert.equal(await request(scope + 'assets/core.js?v=333333333333', 'POST'), null,
        'Requisição não-GET foi interceptada');
    assert.equal(await request(scope + 'data.json'), null,
        'Resposta de API/JSON não deve ser interceptada');

    console.log('Service worker: limite de versões, isolamento e fallback offline OK.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
