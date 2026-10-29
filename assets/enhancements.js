/* Ferramentas opcionais do Jornal. Sem dependências, com falhas isoladas. */
const ENHANCEMENTS_KEY = 'jornal_do_futebol_enhancements_v1';
const ENHANCEMENT_BACKUP_KEY = 'jornal_do_futebol_last_backup_v1';
let extra = {
    media: 'all', maxDuration: 0, sessionMinutes: 0,
    favorites: [], preferFavorites: false, muted: {},
    portsRelevantOnly: false, portsLimit: 18,
    lastVisit: 0
};
let extraLastVisit = 0;
let portsRelevantOnly = false;
const PORT_RELEVANCE = /\b(port(s|ed|ing)?|decomp(il(a(tion|ção|ções))?)?|recomp(il(a(tion|ção|ções))?)?|native|nativo|emula(dor|ção|tion)?|rpcs3|shadps4|ryujinx|yuzu|switch|playstation|ps[345]|xenia|zelda|mario|god of war|pcsx2|dolphin|release|compila(ção|tion))\b/i;

function safeExtraSave() {
    try { localStorage.setItem(ENHANCEMENTS_KEY, JSON.stringify(extra)); } catch (_) {}
}
function safeExtraLoad() {
    try {
        const raw = JSON.parse(localStorage.getItem(ENHANCEMENTS_KEY) || '{}');
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
        extra.media = ['all','shorts','normal'].includes(raw.media) ? raw.media : 'all';
        extra.maxDuration = [0,300,600,1200,1800].includes(raw.maxDuration) ? raw.maxDuration : 0;
        extra.sessionMinutes = [0,15,30,60].includes(raw.sessionMinutes) ? raw.sessionMinutes : 0;
        extra.favorites = Array.isArray(raw.favorites) ? raw.favorites.filter(x => typeof x === 'string').slice(0,100) : [];
        extra.preferFavorites = raw.preferFavorites === true;
        extra.muted = raw.muted && typeof raw.muted === 'object' && !Array.isArray(raw.muted) ? raw.muted : {};
        extra.portsRelevantOnly = raw.portsRelevantOnly === true;
        extra.lastVisit = Number.isFinite(raw.lastVisit) ? Math.max(0, raw.lastVisit) : 0;
    } catch (_) {}
}
function isRelevantPortVideo(video) {
    return PORT_RELEVANCE.test((video.title || '') + ' ' + (video.channelTitle || ''));
}
function extraVisibleVideo(video) {
    if (!video) return false;
    if (extra.media === 'shorts' && video.isShort !== true) return false;
    if (extra.media === 'normal' && video.isShort !== false) return false;
    if (extra.maxDuration && (!video.duration || Number(video.duration) > extra.maxDuration)) return false;
    if (extra.sessionMinutes && !quickSessionIds().has(video.id)) return false;
    return true;
}
function quickSessionIds() {
    const ids = new Set();
    if (!extra.sessionMinutes) return ids;
    const limit = extra.sessionMinutes * 60;
    let total = 0;
    VIDEOS.forEach(v => {
        if (isWatched(v.id) || v.embeddable === false || !v.duration || v.countForTime === false) return;
        if (extra.media === 'shorts' && v.isShort !== true) return;
        if (extra.media === 'normal' && v.isShort !== false) return;
        if (extra.maxDuration && v.duration > extra.maxDuration) return;
        if (typeof shouldHideVideoForFeatures === 'function' && shouldHideVideoForFeatures(v)) return;
        const length = Math.max(0, Number(v.duration));
        if (total + length <= limit) { ids.add(v.id); total += length; }
    });
    return ids;
}
function isExtraMuted(video) {
    if (!video) return false;
    const until = Number(extra.muted[String(video.channelTitle || '')] || 0);
    return Number.isFinite(until) && until > Date.now();
}
// Preserva os filtros prévios e o comportamento dos atalhos do Jornal.
const originalVideoMatchesSearch = videoMatchesSearch;
videoMatchesSearch = function(video) {
    return originalVideoMatchesSearch(video) && extraVisibleVideo(video);
};
const originalShouldHideVideoForFeatures = shouldHideVideoForFeatures;
shouldHideVideoForFeatures = function(video) {
    return originalShouldHideVideoForFeatures(video) || isExtraMuted(video);
};
const originalOrderPlaylistWithFeatures = orderPlaylistWithFeatures;
orderPlaylistWithFeatures = function(baseIds) {
    const original = originalOrderPlaylistWithFeatures(baseIds);
    if (!extra.preferFavorites || !extra.favorites.length) return original;
    const favorites = new Set(extra.favorites);
    // Preserva a fila manual e o restante da ordem, sem duplicar IDs.
    const manual = original.filter(id => manualQueue.includes(id));
    const remainder = original.filter(id => !manual.includes(id));
    const isFavorite = id => {
        const meta = metadataForVideo(id);
        return meta && favorites.has(String(meta.channelTitle || ''));
    };
    return [...manual, ...remainder.filter(isFavorite), ...remainder.filter(id => !isFavorite(id))];
};
function setExtraSetting(name, value) {
    if (name === 'media' && ['all','shorts','normal'].includes(value)) extra.media = value;
    if (name === 'duration') extra.maxDuration = [0,300,600,1200,1800].includes(Number(value)) ? Number(value) : 0;
    if (name === 'session') extra.sessionMinutes = [0,15,30,60].includes(Number(value)) ? Number(value) : 0;
    if (name === 'favorite-priority') extra.preferFavorites = Boolean(value);
    safeExtraSave();
    applyView();
    updateExtraDashboard();
}
function toggleChannelFavorite() {
    const control = document.getElementById('favorite-channel');
    const channel = control && control.value;
    if (!channel) return;
    extra.favorites = extra.favorites.includes(channel)
        ? extra.favorites.filter(x => x !== channel)
        : [...extra.favorites, channel];
    safeExtraSave();
    updateExtraDashboard();
    applyView();
}
function muteChosenChannel() {
    const channel = document.getElementById('mute-channel')?.value;
    const hours = Number(document.getElementById('mute-duration')?.value || 0);
    if (!channel || ![2,24,168].includes(hours)) return;
    extra.muted[channel] = Date.now() + hours * 3600000;
    safeExtraSave();
    applyView();
    updateExtraDashboard();
}
function clearMutedChannels() {
    extra.muted = {};
    safeExtraSave();
    applyView();
    updateExtraDashboard();
}
function setPortsRelevance(value) {
    extra.portsRelevantOnly = Boolean(value);
    portsRelevantOnly = extra.portsRelevantOnly;
    safeExtraSave();
    updatePortsFilters(true);
    updateExtraDashboard();
}
function resetProgressivePorts() {
    extra.portsLimit = 18;
    applyPortsLimit();
}
function showMorePorts() {
    extra.portsLimit += 18;
    applyPortsLimit();
}
function applyPortsLimit() {
    const cards = Array.from(document.querySelectorAll('.ports-video-item[data-video-id]'));
    let count = 0;
    cards.forEach(card => {
        if (!card.hidden) count++;
        card.classList.toggle('ports-limited', !card.hidden && count > extra.portsLimit);
    });
    const button = document.getElementById('ports-show-more');
    if (button) {
        button.hidden = count <= extra.portsLimit;
        button.textContent = 'Mostrar mais vídeos (' + Math.max(0,count-extra.portsLimit) + ' restantes)';
    }
}
function renderChannelProgress() {
    const box = document.getElementById('channel-progress-details');
    if (!box) return;
    const byName = new Map();
    VIDEOS.forEach(v => {
        const name = String(v.channelTitle || 'Sem canal');
        const row = byName.get(name) || {name, total:0, done:0};
        row.total += 1;
        if (isWatched(v.id)) row.done += 1;
        byName.set(name,row);
    });
    const portsByName = new Map();
    PORTS_VIDEOS.forEach(v => {
        const name = String(v.channelTitle || 'Sem canal');
        const row = portsByName.get(name) || {name, total:0, done:0};
        row.total += 1;
        if (portsIsWatched(v.id)) row.done += 1;
        portsByName.set(name,row);
    });
    box.replaceChildren();
    for (const [heading, group] of [['Jornal',byName],['Portes',portsByName]]) {
        const title = document.createElement('h4');
        title.textContent = heading; box.appendChild(title);
        for (const row of [...group.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))) {
            const item = document.createElement('div');
            item.className = 'extra-channel-stat';
            const name = document.createElement('span');
            name.textContent = row.name;
            const count = document.createElement('strong');
            count.textContent = row.done + ' / ' + row.total;
            item.append(name,count);
            box.appendChild(item);
        }
    }
}
function renderSourceAudit() {
    const box = document.getElementById('source-audit-details');
    const tag = document.getElementById('source-audit-data');
    if (!box || !tag) return;
    let data;
    try { data = JSON.parse(tag.textContent || '{}'); } catch (_) { return; }
    box.replaceChildren();
    for (const key of ['journal','ports']) {
        const heading = document.createElement('h4');
        heading.textContent = key === 'ports' ? 'Painel de portes' : 'Jornal principal';
        box.appendChild(heading);
        const items = Array.isArray(data[key]) ? data[key] : [];
        for (const row of items) {
            const item = document.createElement('div');
            item.className = 'extra-channel-stat';
            const name = document.createElement('span');
            name.textContent = row.handle || '';
            const status = document.createElement('strong');
            status.textContent = row.failed ? 'Falha ou coleta parcial'
                : String(row.included || 0) + ' vídeos';
            if (row.atomAvailable === false) {
                status.textContent += ' · Atom indisponível';
            }
            if (row.lastCheckedAt) {
                status.title = 'Última consulta válida: '
                    + new Date(row.lastCheckedAt).toLocaleString('pt-BR');
            }
            item.append(name,status);
            box.appendChild(item);
        }
    }
}
function updateQueueInsights() {
    const box = document.getElementById('queue-insights');
    if (!box) return;
    const current = currentVideoId();
    const start = Math.max(0,activePlaylist.indexOf(current) + 1);
    const ids = activePlaylist.slice(start);
    const minutes = ids.reduce((sum,id) => {
        const v = metadataForVideo(id);
        return sum + Math.max(0,Number(v?.duration || 0));
    },0);
    box.textContent = ids.length + ' próximos vídeos · '
        + formatDurationHuman(minutes) + ' de duração aproximada';
}
function updateExtraDashboard() {
    const $ = id => document.getElementById(id);
    if ($('extra-media')) $('extra-media').value = extra.media;
    if ($('extra-duration')) $('extra-duration').value = String(extra.maxDuration);
    if ($('extra-session')) $('extra-session').value = String(extra.sessionMinutes);
    if ($('extra-favorite-priority')) $('extra-favorite-priority').checked = extra.preferFavorites;
    if ($('ports-relevance')) $('ports-relevance').checked = portsRelevantOnly;
    const channel = $('favorite-channel')?.value;
    if ($('favorite-toggle')) $('favorite-toggle').textContent =
        channel && extra.favorites.includes(channel) ? '★ Remover favorito' : '☆ Favoritar canal';
    const active = Object.entries(extra.muted).filter(([name,t]) => Number(t) > Date.now());
    if ($('muted-status')) $('muted-status').textContent =
        active.length + ' canal(is) silenciado(s) temporariamente';
    updateQueueInsights();
    if ($('channel-progress-wrapper')?.open) renderChannelProgress();
}
function fillChannelOptions() {
    const channels = [...new Set(VIDEOS.map(v => v.channelTitle).filter(Boolean))]
        .sort((a,b)=>a.localeCompare(b,'pt-BR'));
    for (const id of ['favorite-channel','mute-channel']) {
        const select = document.getElementById(id);
        if (!select) continue;
        select.replaceChildren();
        for (const name of channels) {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        }
    }
}
function markNewVideos() {
    const last = extraLastVisit;
    if (!last) return;
    document.querySelectorAll('.card[data-video-id], .ports-video-item[data-video-id]').forEach(card => {
        const meta = metadataForVideo(card.dataset.videoId);
        if (!meta || !meta.publishedAt || Date.parse(meta.publishedAt) <= last) return;
        if (card.querySelector('.extra-new-badge')) return;
        const label = document.createElement('span');
        label.className = 'extra-new-badge';
        label.textContent = 'NOVO';
        const container = card.querySelector('.card-info, .ports-video-copy');
        if (container) container.appendChild(label);
    });
}
function saveScrollPosition() {
    try {
        sessionStorage.setItem('jornal_do_futebol_scroll_v1',JSON.stringify({
            day: document.body.dataset.journalDate, y: window.scrollY,
            savedAt: Date.now()
        }));
    } catch (_) {}
}
function restoreScrollPosition() {
    try {
        const item = JSON.parse(sessionStorage.getItem('jornal_do_futebol_scroll_v1') || 'null');
        if (!item || item.day !== document.body.dataset.journalDate ||
            Date.now() - item.savedAt > 6 * 3600000 || !Number.isFinite(item.y)) return;
        requestAnimationFrame(() => window.scrollTo({top:Math.max(0,item.y), behavior:'auto'}));
    } catch (_) {}
}
function dismissUpdateNotice() {
    const box = document.getElementById('update-notice');
    if (box) box.hidden = true;
}
function checkJournalUpdate() {
    if (document.hidden || typeof fetch !== 'function') return;
    const local = document.querySelector('meta[name="journal-version"]')?.content;
    fetch(location.pathname + '?revision_check=' + Date.now(), {
        cache: 'no-store', credentials:'same-origin'
    }).then(res => res.ok ? res.text() : '').then(html => {
        if (!html) return;
        const match = html.match(/<meta name="journal-version" content="([^"]+)">/);
        if (!match || match[1] === local) return;
        const box = document.getElementById('update-notice');
        if (box) box.hidden = false;
    }).catch(()=>{});
}
function setPreferredSpeed(value) {
    const rate = Number(value);
    if (![1,1.25,1.5,2].includes(rate)) return;
    try { localStorage.setItem('jornal_do_futebol_playback_rate_v1',String(rate)); }
    catch (_) {}
    applyPreferredSpeed();
}
function applyPreferredSpeed() {
    if (!player || !ready || typeof player.setPlaybackRate !== 'function') return;
    let preferred=1;
    try { preferred=Number(localStorage.getItem('jornal_do_futebol_playback_rate_v1')||1); }
    catch (_) {}
    const allowed = typeof player.getAvailablePlaybackRates === 'function'
        ? player.getAvailablePlaybackRates() : [1];
    if (!Array.isArray(allowed) || !allowed.includes(preferred)) preferred=1;
    try { player.setPlaybackRate(preferred); } catch (_) {}
}
const originalExportJournalBackup = exportJournalBackup;
exportJournalBackup = function() {
    originalExportJournalBackup();
    try { localStorage.setItem(ENHANCEMENT_BACKUP_KEY,String(Date.now())); } catch (_) {}
    updateBackupReminder();
};
function updateBackupReminder() {
    const el = document.getElementById('backup-reminder');
    if (!el) return;
    let last=0;
    try { last=Number(localStorage.getItem(ENHANCEMENT_BACKUP_KEY)||0); } catch (_) {}
    el.hidden = Boolean(last && Date.now() - last < 30 * 86400000);
}
const playbackErrors = new Map();
function handleEnhancedPlaybackError() {
    const id = currentVideoId();
    if (!id) { setStatus('Não foi possível carregar o player.'); return; }
    const tries = (playbackErrors.get(id)||0)+1;
    playbackErrors.set(id,tries);
    const box = document.getElementById('player-error-actions');
    const link = document.getElementById('player-error-link');
    if (box) box.hidden = false;
    if (link) link.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(id);
    setStatus('Vídeo indisponível no player. Use Abrir no YouTube ou Próximo.');
}
function dismissPlaybackError() {
    const el=document.getElementById('player-error-actions');
    if(el) el.hidden=true;
}
function initEnhancements() {
    safeExtraLoad();
    extraLastVisit = extra.lastVisit;
    extra.lastVisit = Date.now();
    // A primeira visita não deve marcar todos os uploads como NOVO.
    portsRelevantOnly = extra.portsRelevantOnly;
    extra.muted = Object.fromEntries(Object.entries(extra.muted)
        .filter(([k,v])=>typeof k==='string' && Number.isFinite(Number(v)) && Number(v)>Date.now()));
    safeExtraSave();
    fillChannelOptions();
    const playbackRate=document.getElementById('playback-rate');
    if (playbackRate) {
        try {playbackRate.value=localStorage.getItem('jornal_do_futebol_playback_rate_v1')||'1';}
        catch (_) {}
    }
    document.getElementById('favorite-channel')?.addEventListener('change', updateExtraDashboard);
    document.getElementById('channel-progress-details')?.addEventListener('toggle',renderChannelProgress);
    document.getElementById('source-audit-details')?.addEventListener('toggle',renderSourceAudit);
    window.addEventListener('pagehide',saveScrollPosition);
    window.addEventListener('scroll',()=>{
        if (!initEnhancements.scrollScheduled) {
            initEnhancements.scrollScheduled=true;
            setTimeout(()=>{saveScrollPosition();initEnhancements.scrollScheduled=false;},500);
        }
    },{passive:true});
    restoreScrollPosition();
    markNewVideos();
    updateExtraDashboard();
    updateBackupReminder();
    if (typeof setInterval === 'function') setInterval(checkJournalUpdate,15*60*1000);
    if ('serviceWorker' in navigator && location.protocol==='https:') {
        navigator.serviceWorker.register('service-worker.js').catch(()=>{});
    }
}
