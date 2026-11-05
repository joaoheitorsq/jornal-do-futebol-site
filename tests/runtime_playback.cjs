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
        removeAttribute() {},
        getAttribute() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; },
        append() {},
        replaceChildren(...children) { this.children = children; },
        remove() {},
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
    body: {dataset: {journalDate: '04/11/2026'}},
    fullscreenElement: null,
    getElementById: byId,
    createElement(tag) { return element(tag); },
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
for (const file of ['assets/core.js', 'assets/view.js', 'assets/player.js', 'assets/motion.js', 'assets/features.js', 'assets/enhancements.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, {
        filename: file
    });
}

function expression(code) { return vm.runInContext(code, ctx); }
const active = () => expression('activePlaylist.slice()');
const mode = () => expression('portsPlaybackActive');

// Backups incompatíveis são rejeitados antes de qualquer escrita destrutiva.
assert.doesNotThrow(() => expression(
    'validateJournalBackupEntries([[WATCHED_KEY, JSON.stringify({AAAAAAAAAAA:1})]])'
));
assert.doesNotThrow(() => expression(
    'validateJournalBackupEntries([[RESUME_KEY, JSON.stringify({videoId:"AAAAAAAAAAA",seconds:42})]])'
));
assert.throws(() => expression(
    'validateJournalBackupEntries([[WATCHED_KEY, "not-json"]])'
), /JSON inválido/);
assert.throws(() => expression(
    'validateJournalBackupEntries([[FEATURE_STATE_KEY, JSON.stringify({resumePositions:[]})]])'
), /Estado de recursos inválido/);
assert.throws(() => expression(
    'validateJournalBackupEntries([[RESUME_KEY, JSON.stringify({videoId:"invalid!"})]])'
), /Ponto de retomada inválido/);
assert.throws(() => expression(
    'validateJournalBackupEntries([["jornal_do_futebol_unknown_payload", "value"]])'
), /chaves reconhecidas/);

// "constructor" tem 11 caracteres e é um possível ID da API.
// Em objetos comuns, herda uma função mesmo quando o vídeo nunca foi visto.
expression('featureState = defaultFeatureState(); watched = {}; portsWatched = {}; portsResumePositions = {};');
assert.equal(expression('isWatched("constructor")'), false);
assert.equal(expression('portsIsWatched("constructor")'), false);
assert.equal(expression('isFinishLater("constructor")'), false);
assert.equal(expression('getResumePosition("constructor")'), null);
assert.equal(expression('metadataForVideo("constructor")'), null);
assert.equal(expression('portsResumeSeconds("constructor")'), 0);

// Índices fixos devem preservar a origem e a precedência no mesmo ID.
assert.equal(expression('JOURNAL_VIDEO_BY_ID.size'), mainVideos.length);
assert.equal(expression('PORTS_VIDEO_BY_ID.size'), portsVideos.length);
assert.equal(expression('currentVideoMeta("AAAAAAAAAAA").title'), 'Compartilhado');
assert.equal(expression('currentVideoMeta("BBBBBBBBBBB").channelHandle'), '@b');
assert.equal(expression('currentVideoMeta("ZZZZZZZZZZZ")'), null);
assert.equal(expression('videoIdentityMeta("MMMMMMMMMMM").channelTitle'), 'M');

expression('openPortsVideo("AAAAAAAAAAA");');
assert.equal(expression('pendingPlaybackRequest.source'),'ports',
    'Pedido de reprodução antes de carregar o YouTube perdeu sua origem');
assert.equal(mode(), true, 'Vídeo compartilhado deve abrir fila de portes quando acionado pelo painel');
assert.deepEqual([...active()], portsVideos.map(video => video.id).reverse());
expression('openVideo("AAAAAAAAAAA");');
assert.equal(expression('pendingPlaybackRequest.source'),'journal',
    'Pedido de reprodução do Jornal não substituiu o pedido anterior');
assert.equal(mode(), false, 'Mesmo vídeo aberto pelo Jornal precisa voltar à fila principal');
assert.deepEqual([...active()], mainVideos.map(video => video.id));

ctx.localStorage.setItem('jornal_do_futebol_ports_resume_v1', JSON.stringify({videoId:'BBBBBBBBBBB',seconds:42}));
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

expression('portsFilterChannel = ""; portsOnlyUnwatched = true; portsWatched = {BBBBBBBBBBB: 1}; rebuildPlaylist();');
assert.deepEqual([...active()], ['CCCCCCCCCCC', 'AAAAAAAAAAA'], 'Apenas não vistos deve funcionar na fila');

expression('portsOnlyUnwatched = false; portsSearchQuery = "Portes 2"; rebuildPlaylist();');
assert.deepEqual([...active()], ['CCCCCCCCCCC'], 'Pesquisa deve afetar a fila');

expression('portsSearchQuery = ""; portsSort = "oldest"; rebuildPlaylist();');
assert.deepEqual([...active()], portsVideos.map(video => video.id), 'Ordem antiga deve ser cronológica');

expression('portsWatched = {}; portsSort = "newest"; rebuildPlaylist();');
assert.deepEqual([...active()], portsVideos.map(video => video.id).reverse(), 'Ordem recente deve inverter a fila');

expression('setPortsPlaybackMode(false);');
assert.equal(ctx.sessionStorage.getItem('jornal_do_futebol_ports_playback_mode_v1'), null);

expression('setPortsPlaybackMode(true);');
assert.equal(
    expression('adjacentQueuedVideoId("BBBBBBBBBBB", ["CCCCCCCCCCC"], 1)'),
    'CCCCCCCCCCC',
    'Fila de portes precisa usar a ordem do painel ao procurar próximo'
);

// Vídeos vistos não entram na fila automática, mas devem abrir ao clicar.
expression('setPortsPlaybackMode(false); watched = {AAAAAAAAAAA: 1}; onlyUnwatched = false;');
expression('rebuildPlaylist();');
assert.deepEqual([...active()], ['MMMMMMMMMMM'], 'Fila padrão não deve repetir vistos');
expression('openVideo("AAAAAAAAAAA");');
assert.equal(mode(), false, 'Revisita não deve entrar no modo de portes');
assert.deepEqual([...active()], ['AAAAAAAAAAA', 'MMMMMMMMMMM'],
    'Clicar em visto deve reproduzir esse vídeo e manter a sequência');
expression('watched = {};');

// Isolamento: um vídeo presente nos dois painéis não deve mudar o Jornal.
expression('watched = {AAAAAAAAAAA: 123}; portsWatched = {};');
expression('markWatched("AAAAAAAAAAA", "ports");');
assert.equal(expression('watched.AAAAAAAAAAA'), 123,
    'Conclusão do painel de portes alterou o Jornal');
assert.equal(expression('portsWatched.AAAAAAAAAAA') > 0, true,
    'Conclusão de portes não foi registrada separadamente');
expression('setPortsPlaybackMode(true);');
expression('portsResumePositions = {};');
assert.equal(expression('portsResumeSeconds("AAAAAAAAAAA")'),0);
expression('portsResumePositions["AAAAAAAAAAA"]={seconds:32};');
assert.equal(expression('getResumeSeconds("AAAAAAAAAAA")'),32,
    'Retomada de portes não foi isolada');
expression('setPortsPlaybackMode(false);');
assert.equal(expression('getResumeSeconds("AAAAAAAAAAA")'),0,
    'Retomada de portes vazou para o futebol');
// Mesmo com vídeo já visto no futebol, a retomada de portes é independente.
expression('watched = {AAAAAAAAAAA: 111}; portsWatched = {}; setPortsPlaybackMode(true);');
expression('saveResume("AAAAAAAAAAA", 27);');
assert.equal(expression('portsResumePositions.AAAAAAAAAAA.seconds'), 27,
    'Vídeo visto no futebol bloqueou a retomada de portes');
assert.equal(expression('watched.AAAAAAAAAAA'), 111,
    'Retomada de portes alterou o Jornal');
expression('setPortsPlaybackMode(false); watched = {}; portsWatched = {};');

// Desfazer marcações no painel deve restaurar também a retomada.
expression('portsWatched = {}; portsResumePositions = {BBBBBBBBBBB: {seconds: 33}};');
expression('toggleWatched("BBBBBBBBBBB", "ports");');
assert.equal(expression('portsIsWatched("BBBBBBBBBBB")'), true);
assert.equal(expression('portsResumePositions.BBBBBBBBBBB'), undefined);
expression('performUndo();');
assert.equal(expression('portsIsWatched("BBBBBBBBBBB")'), false);
assert.equal(expression('portsResumePositions.BBBBBBBBBBB.seconds'), 33,
    'Desfazer perdeu o ponto de retomada de portes');
expression('portsFilterChannel = "@b"; portsRelevantOnly = true;');
expression('extra.portsRelevantOnly = true; resetPortsFilters();');
assert.equal(expression('portsFilterChannel'), '');
assert.equal(expression('portsRelevantOnly'), false);
assert.equal(expression('extra.portsRelevantOnly'), false);

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

// O Short nunca deve ativar uma URL /shorts/ para reprodução.
assert.equal(new URL(expression('standardEmbedUrl("S1234567890")')).pathname,
    '/embed/S1234567890');
assert.equal(new URL(expression('standardEmbedUrl("MMMMMMMMMMM")')).pathname,
    '/embed/MMMMMMMMMMM');
assert.equal(new URL(expression('standardEmbedUrl("S1234567890")')).searchParams.get('controls'),
    '1');
assert.equal(expression('standardWatchUrl("S1234567890")'),
    'https://www.youtube.com/watch?v=S1234567890');
assert.equal(expression('standardWatchUrl("S1234567890", 73.9)'),
    'https://www.youtube.com/watch?v=S1234567890&t=73s');
assert.equal(expression('standardWatchUrl("invalid id")'), null,
    'IDs inválidos não podem formar URLs externas');

let pausedForExternal = 0;
ctx.__fakePlayer.pauseVideo = () => { pausedForExternal++; };
ctx.__fakePlayer.getCurrentTime = () => 43.8;
expression('pendingPlaybackRequest = null; activePlaylist = ["BBBBBBBBBBB"]; i = 0;');
expression('updateStandardWatchLink("BBBBBBBBBBB");');
assert.equal(byId('youtube-standard-watch-link').hidden, false);
assert.equal(byId('youtube-standard-watch-link').href,
    'https://www.youtube.com/watch?v=BBBBBBBBBBB');
expression('openStandardWatchAtCurrentTime();');
assert.equal(byId('youtube-standard-watch-link').href,
    'https://www.youtube.com/watch?v=BBBBBBBBBBB&t=43s');
assert.equal(pausedForExternal, 1,
    'Abrir o player externo deve pausar o player interno');
assert.equal(expression('portsIsWatched("BBBBBBBBBBB")'), false,
    'Abrir no YouTube não pode concluir vídeo nem alterar progresso');

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
// A API pode estar disponível sem criar iframe. A primeira reprodução
// deve montar um único iframe oficial e consumir o pedido pendente.
expression('player = null; ready = false; pendingPlaybackRequest = null; youtubeIframeApiLoaded = false; youtubePlayerCreating = false;');
expression('portsPlaybackActive = false; activePlaylist = ["MMMMMMMMMMM"]; i = 0; resumeState = {videoId: "MMMMMMMMMMM", seconds: 37, embeddable: true};');
expression('refreshPlayerPreview();');
assert.equal(byId('journal-player-preview').dataset.videoId, 'MMMMMMMMMMM');
assert.match(byId('journal-player-preview-image').src, /\/MMMMMMMMMMM\/hqdefault\.jpg$/);
let playerCreations = 0;
let createdPlayerEvents = null;
let loadedAt = null;
ctx.YT.Player = function(id, options) {
    playerCreations++;
    createdPlayerEvents = options.events;
    assert.equal(id, 'youtube-standard-player');
    return {
        getVideoData() { return {video_id:'MMMMMMMMMMM'}; },
        getPlayerState() { return 2; },
        getCurrentTime() { return 0; },
        getDuration() { return 50; },
        loadVideoById(options) { loadedAt = options.startSeconds; },
        cueVideoById() {},
        pauseVideo() {}
    };
};
expression('onYouTubeIframeAPIReady();');
assert.equal(playerCreations, 0, 'API pronta não deve criar iframe antes do clique');
expression('playPreviewVideo();');
assert.equal(playerCreations, 1, 'Clique deve criar o player do YouTube uma vez');
assert.equal(expression('pendingPlaybackRequest.id'), 'MMMMMMMMMMM');
assert.equal(expression('pendingPlaybackRequest.startSeconds'), 37,
    'Retomada inicial perdeu os segundos enquanto o iframe carregava');
assert.match(byId('player-slot').children[0].src,
    /^https:\/\/www\.youtube\.com\/embed\/MMMMMMMMMMM\?/);
assert.equal(expression('youtubePlayerCreating'), true);
expression('ensureYouTubePlayer();');
assert.equal(playerCreations, 1, 'Múltiplas solicitações não podem recriar o player');
assert.ok(createdPlayerEvents && createdPlayerEvents.onReady);
createdPlayerEvents.onReady();
assert.equal(expression('pendingPlaybackRequest'), null);
assert.equal(expression('ready'), true, 'Primeiro vídeo não iniciou depois do iframe ficar pronto');
assert.equal(loadedAt, 37, 'O player não retomou os 37 segundos salvos');

console.log('Testes de filas, retomada, vídeo compartilhado e gestos: OK');
