#!/usr/bin/env node
'use strict';

/*
 * Testes de comportamento sem rede/DOM externo:
 * carregam os módulos reais no mesmo contexto de scripts clássicos
 * usado pelo site, com apenas as APIs do navegador simuladas.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const mainVideos = [
    {id: 'AAAAAAAAAAA', title: 'Compartilhado', channelTitle: 'A', embeddable: true},
    {id: 'MMMMMMMMMMM', title: 'Jornal', channelTitle: 'M', embeddable: true}
];
const portsVideos = [
    {id: 'AAAAAAAAAAA', title: 'Compartilhado', channelTitle: 'A', channelHandle: '@a', embeddable: true},
    {id: 'BBBBBBBBBBB', title: 'Portes', channelTitle: 'B', channelHandle: '@b', embeddable: true},
    {id: 'CCCCCCCCCCC', title: 'Portes 2', channelTitle: 'C', channelHandle: '@c', embeddable: true}
];

function storage() {
    const map = new Map();
    return {
        getItem(key) { return map.has(key) ? map.get(key) : null; },
        setItem(key, value) { map.set(key, String(value)); },
        removeItem(key) { map.delete(key); },
        clear() { map.clear(); },
        key(index) { return [...map.keys()][index] || null; },
        get length() { return map.size; }
    };
}

function element(id) {
    const classes = new Set();
    const events = new Map();
    return {
        id,
        dataset: {},
        textContent: '',
        hidden: false,
        style: {setProperty() {}, removeProperty() {}},
        classList: {
            add(...names) { names.forEach(name => classes.add(name)); },
            remove(...names) { names.forEach(name => classes.delete(name)); },
            toggle(name, forced) {
                const enabled = forced === undefined ? !classes.has(name) : forced;
                enabled ? classes.add(name) : classes.delete(name);
                return enabled;
            },
            contains(name) { return classes.has(name); }
        },
        addEventListener(name, handler) {
            events.set(name, [...(events.get(name) || []), handler]);
        },
        emit(name, event) {
            (events.get(name) || []).forEach(handler => handler(event));
        },
        setPointerCapture() {},
        setAttribute() {},
        getAttribute() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; },
        animate() {},
    };
}

const els = new Map();
function byId(id) {
    if (!els.has(id)) els.set(id, element(id));
    return els.get(id);
}
byId('journal-data').textContent = JSON.stringify(mainVideos);
byId('ports-data').textContent = JSON.stringify(portsVideos);

const document = {
    fullscreenElement: null,
    getElementById: byId,
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
};
const window = {
    location: {origin: 'https://example.test'},
    addEventListener() {},
    scrollTo() {},
    open() {},
    matchMedia() {return {matches: true};}
};
let clock = 1000;
let timerNumber = 0;
const timers = new Map();
const ctx = vm.createContext({
    document, window, console,
    localStorage: storage(),
    sessionStorage: storage(),
    URLSearchParams,
    performance: {now: () => clock},
    setInterval() { return 1; },
    setTimeout(fn, ms) { const id = ++timerNumber; timers.set(id, {fn, ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {},
    YT: {PlayerState: {PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5, ENDED: 0}}
});
for (const file of ['assets/core.js', 'assets/view.js', 'assets/player.js', 'assets/motion.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, {
        filename: file
    });
}

function expression(code) { return vm.runInContext(code, ctx); }
const active = () => expression('activePlaylist.slice()');
const mode = () => expression('portsPlaybackActive');

expression('openPortsVideo("AAAAAAAAAAA");');
assert.equal(mode(), true, 'Vídeo compartilhado deve abrir fila de portes quando acionado pelo painel');
assert.deepEqual([...active()], portsVideos.map(video => video.id).reverse());
expression('openVideo("AAAAAAAAAAA");');
assert.equal(mode(), false, 'Mesmo vídeo aberto pelo Jornal precisa voltar à fila principal');
assert.deepEqual([...active()], mainVideos.map(video => video.id));

expression('resumeState = {videoId: "BBBBBBBBBBB", seconds: 42}; setPortsPlaybackMode(true);');
expression('setPortsPlaybackMode(false);');
expression("sessionStorage.setItem(PORTS_PLAYBACK_MODE_KEY, '1'); restorePortsPlaybackMode();");
assert.equal(mode(), true, 'Retomada do painel não restaurou a fila original');
assert.deepEqual([...expression('PORTS_VIDEOS.map(video => video.id)')], portsVideos.map(v => v.id));
expression('rebuildPlaylist();');
assert.deepEqual([...active()], portsVideos.map(video => video.id).reverse());

// Combinações de filtros, busca e ordenação devem afetar só a fila de portes.
expression('portsFilterChannel = "@b"; rebuildPlaylist();');
assert.deepEqual([...active()], ['BBBBBBBBBBB'], 'Filtro de canal deve limitar a fila');

expression('portsFilterChannel = ""; portsOnlyUnwatched = true; watched = {BBBBBBBBBBB: 1}; rebuildPlaylist();');
assert.deepEqual([...active()], ['CCCCCCCCCCC', 'AAAAAAAAAAA'], 'Apenas não vistos deve funcionar na fila');

expression('portsOnlyUnwatched = false; portsSearchQuery = "Portes 2"; rebuildPlaylist();');
assert.deepEqual([...active()], ['CCCCCCCCCCC'], 'Pesquisa deve afetar a fila');

expression('portsSearchQuery = ""; portsSort = "oldest"; rebuildPlaylist();');
assert.deepEqual([...active()], portsVideos.map(video => video.id), 'Ordem antiga deve ser cronológica');

expression('watched = {}; portsSort = "newest"; rebuildPlaylist();');
assert.deepEqual([...active()], portsVideos.map(video => video.id).reverse(), 'Ordem recente deve inverter a fila');

expression('setPortsPlaybackMode(false);');
assert.equal(ctx.sessionStorage.getItem('jornal_do_futebol_ports_playback_mode_v1'), null);

expression('setPortsPlaybackMode(true);');
assert.equal(
    expression('adjacentQueuedVideoId("BBBBBBBBBBB", ["CCCCCCCCCCC"], 1)'),
    'CCCCCCCCCCC',
    'Fila de portes precisa usar a ordem do painel ao procurar próximo'
);

// Gestos de tela cheia com timer virtual: sem reproduzir qualquer vídeo real.
document.fullscreenElement = byId('playerwrap');
ctx.__fakePlayer = {
    getVideoData() { return {video_id: 'BBBBBBBBBBB'}; },
    getPlayerState() { return 1; },
    getCurrentTime() { return 0; },
    getDuration() { return 200; },
    loadVideoById() {},
    seekTo() {}
};
expression('ready = true; player = __fakePlayer;');

function pointer(pointerId) {
    return {
        pointerType: 'touch', pointerId, button: 0,
        clientX: 10, clientY: 10, preventDefault() {}
    };
}

const nextButton = byId('fullscreen-next');
nextButton.emit('pointerdown', pointer(1));
assert.equal(timers.size, 1, 'Segurar próximo precisa criar um timer');
nextButton.emit('pointerdown', pointer(2));
assert.equal(timers.size, 1, 'Segundo dedo não pode reiniciar a pressão de próximo');
nextButton.emit('pointerup', pointer(2));
assert.equal(timers.size, 1, 'Soltar segundo dedo não cancela primeiro');
nextButton.emit('pointerup', pointer(1));
assert.equal(timers.size, 0, 'Soltar dedo principal deve cancelar pressão de próximo');

nextButton.emit('keydown', {repeat: false, key: ' ', preventDefault() {}});
assert.equal(timers.size, 1, 'Teclado deve iniciar pressão de próximo');
nextButton.emit('keyup', {key: ' ', preventDefault() {}});
assert.equal(timers.size, 0, 'Soltar tecla deve cancelar pressão de próximo');

const seekButton = byId('fullscreen-seek-forward');
seekButton.emit('pointerdown', pointer(3));
assert.equal(timers.size, 1, 'Segurar +30 precisa criar timer próprio');
seekButton.emit('pointerdown', pointer(4));
assert.equal(timers.size, 1, 'Segundo dedo não pode reiniciar pressão de +30');
seekButton.emit('pointerup', pointer(4));
assert.equal(timers.size, 1, 'Soltar dedo secundário não cancela +30');
seekButton.emit('pointerup', pointer(3));
assert.equal(timers.size, 0, 'Soltar dedo principal precisa cancelar +30');

assert.equal(byId('fullscreen-hold-countdown').classList.contains('show'), false);
console.log('Testes de filas, retomada, vídeo compartilhado e gestos: OK');
