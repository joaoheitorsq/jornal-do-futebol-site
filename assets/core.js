const journalDataElement =
    document.getElementById(
        'journal-data'
    );

const VIDEOS =
    JSON.parse(
        journalDataElement
        ? journalDataElement.textContent
        : '[]'
    );

const portsDataElement =
    document.getElementById('ports-data');

const PORTS_VIDEOS = JSON.parse(
    portsDataElement
    ? portsDataElement.textContent
    : '[]'
);

const PORTS_COLLAPSED_KEY =
    'jornal_do_futebol_ports_collapsed_v1';

const PORTS_PLAYBACK_MODE_KEY =
    'jornal_do_futebol_ports_playback_mode_v1';

const PORTS_WATCHED_KEY = 'jornal_do_futebol_ports_watched_v1';
const PORTS_RESUME_KEY = 'jornal_do_futebol_ports_resume_v1';
const PORTS_POSITIONS_KEY = 'jornal_do_futebol_ports_resume_positions_v1';
let portsResumePositions = {};

function loadPortsResume() {
    try {
        const data = JSON.parse(localStorage.getItem(PORTS_RESUME_KEY) || 'null');
        return data && typeof data.videoId === 'string' && !portsIsWatched(data.videoId)
            ? data : null;
    } catch (_) { return null; }
}
function loadPortsResumePositions() {
    try {
        const data = JSON.parse(localStorage.getItem(PORTS_POSITIONS_KEY) || '{}');
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (_) { return {}; }
}
function savePortsResumePositions() {
    try { localStorage.setItem(PORTS_POSITIONS_KEY, JSON.stringify(portsResumePositions)); }
    catch (_) {}
}
function portsResumeSeconds(id) {
    const data = portsResumePositions[id];
    return Math.max(0,Number(data?.seconds || 0));
}
let portsWatched = {};

function loadPortsWatched() {
    try {
        const saved = localStorage.getItem(PORTS_WATCHED_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed : {};
        }
        // Migração única: preservar os assistidos antigos antes de separar
        // definitivamente os dois históricos.
        const initial = {};
        PORTS_VIDEOS.forEach(video => {
            if (watched[video.id]) initial[video.id] = watched[video.id];
        });
        localStorage.setItem(PORTS_WATCHED_KEY, JSON.stringify(initial));
        return initial;
    }
    catch (_) { return {}; }
}

function savePortsWatched() {
    try { localStorage.setItem(PORTS_WATCHED_KEY, JSON.stringify(portsWatched)); }
    catch (_) {}
}

function portsIsWatched(id) { return Boolean(portsWatched[id]); }

let portsPlaybackActive = false;
let portsCollapsed = false;

// Preferências independentes do Jornal de Futebol.
const PORTS_PREFERENCES_KEY = 'jornal_do_futebol_ports_preferences_v1';
let portsFilterChannel = '';
let portsSearchQuery = '';
let portsOnlyUnwatched = false;
let portsSort = 'newest';

const CURRENT_EMBEDDABLE_IDS =
VIDEOS
    .filter(video => video.embeddable)
    .map(video => video.id);

const RESUME_KEY =
'jornal_do_futebol_resume_v1';

const WATCHED_KEY =
'jornal_do_futebol_watched_v1';

const HEARTHPWN_SEEN_KEY =
'jornal_do_futebol_hearthpwn_seen_v1';

const HEARTHPWN_COLLAPSED_KEY =
'jornal_do_futebol_hearthpwn_collapsed_v1';

const UNWATCHED_MODE_KEY =
'jornal_do_futebol_only_unwatched_v1';

const COLLAPSED_CHAPTERS_KEY =
'jornal_do_futebol_collapsed_chapters_v1';

const MINI_PLAYER_COLLAPSED_KEY =
'jornal_do_futebol_mini_player_collapsed_v1';

const FEATURE_STATE_KEY =
'jornal_do_futebol_features_v2';

const MANUAL_QUEUE_SESSION_KEY =
'jornal_do_futebol_manual_queue_v1';

const STORAGE_SCHEMA_KEY =
'jornal_do_futebol_storage_schema';

const CURRENT_STORAGE_SCHEMA = 2;

let player = null;
let ready = false;
let activePlaylist = [];
let i = 0;
let resumeState = null;
let watched = {};
let hearthpwnSeen = {};
let hearthpwnCollapsed = false;
let onlyUnwatched = false;
let collapsedChapters = {};
let miniPlayerCollapsed = false;
let searchQuery = '';
let transportDragging = false;
let featureState = null;
let manualQueue = [];
let undoAction = null;


function migrateStorage() {
    try {
        const raw =
            localStorage.getItem(
                STORAGE_SCHEMA_KEY
            );

        let version =
            raw === null
            ? 0
            : Number(raw);

        if (
            !Number.isInteger(version)
            ||
            version < 0
        ) {
            version = 0;
        }

        if (
            version
            >
            CURRENT_STORAGE_SCHEMA
        ) {
            console.warn(
                'Dados do Jornal usam uma versão mais nova do armazenamento.'
            );
            return;
        }

        while (
            version
            <
            CURRENT_STORAGE_SCHEMA
        ) {
            switch (version) {
                case 0:
                    /*
                     * A versão 1 formaliza as chaves
                     * existentes sem alterar os dados.
                     */
                    version = 1;
                    break;

                case 1:
                    /*
                     * A versão 2 introduz estado expandido.
                     * O último ponto de retomada legado é
                     * copiado para o mapa por vídeo.
                     */
                    try {
                        const legacyRaw =
                            localStorage.getItem(
                                RESUME_KEY
                            );

                        const existingRaw =
                            localStorage.getItem(
                                FEATURE_STATE_KEY
                            );

                        const existing =
                            existingRaw
                            ? JSON.parse(existingRaw)
                            : {};

                        const legacy =
                            legacyRaw
                            ? JSON.parse(legacyRaw)
                            : null;

                        if (
                            legacy
                            &&
                            legacy.videoId
                        ) {
                            existing.resumePositions =
                                existing.resumePositions
                                &&
                                typeof existing.resumePositions
                                === 'object'
                                ? existing.resumePositions
                                : {};

                            existing.resumePositions[
                                String(legacy.videoId)
                            ] = legacy;
                        }

                        localStorage.setItem(
                            FEATURE_STATE_KEY,
                            JSON.stringify(existing)
                        );
                    }
                    catch (_) {}

                    version = 2;
                    break;

                default:
                    throw new Error(
                        'Migração desconhecida: '
                        + String(version)
                    );
            }
        }

        localStorage.setItem(
            STORAGE_SCHEMA_KEY,
            String(version)
        );
    }
    catch (error) {
        console.warn(
            'Falha ao migrar dados locais do Jornal.',
            error
        );
    }
}


function loadWatched() {
    try {
        const raw =
            localStorage.getItem(
                WATCHED_KEY
            );

        if (!raw) {
            return {};
        }

        const data = JSON.parse(raw);
        return data && typeof data === 'object'
            ? data
            : {};
    }
    catch (_) {
        return {};
    }
}


function saveWatched() {
    try {
        localStorage.setItem(
            WATCHED_KEY,
            JSON.stringify(watched)
        );
    }
    catch (_) {}
}


function loadHearthPwnSeen() {
    try {
        const raw =
            localStorage.getItem(
                HEARTHPWN_SEEN_KEY
            );

        if (!raw) {
            return {};
        }

        const data = JSON.parse(raw);
        return data && typeof data === 'object'
            ? data
            : {};
    }
    catch (_) {
        return {};
    }
}


function saveHearthPwnSeen() {
    try {
        localStorage.setItem(
            HEARTHPWN_SEEN_KEY,
            JSON.stringify(hearthpwnSeen)
        );
    }
    catch (_) {}
}


function loadHearthPwnCollapsed() {
    try {
        return (
            localStorage.getItem(
                HEARTHPWN_COLLAPSED_KEY
            )
            === '1'
        );
    }
    catch (_) {
        return false;
    }
}


function saveHearthPwnCollapsed() {
    try {
        localStorage.setItem(
            HEARTHPWN_COLLAPSED_KEY,
            hearthpwnCollapsed ? '1' : '0'
        );
    }
    catch (_) {}
}


function applyHearthPwnCollapse() {
    const widget =
        document.querySelector(
            '.hearthpwn-widget'
        );

    if (!widget) {
        return;
    }

    widget.classList.toggle(
        'collapsed',
        hearthpwnCollapsed
    );

    const button =
        widget.querySelector(
            '.hearthpwn-collapse-toggle'
        );

    const chevron =
        widget.querySelector(
            '.hearthpwn-collapse-chevron'
        );

    if (button) {
        button.setAttribute(
            'aria-expanded',
            hearthpwnCollapsed ? 'false' : 'true'
        );

        button.title =
            hearthpwnCollapsed
            ? 'Expandir notícias do HearthPwn'
            : 'Recolher notícias do HearthPwn';
    }

    if (chevron) {
        chevron.textContent =
            hearthpwnCollapsed
            ? '▸'
            : '▾';
    }
}


function toggleHearthPwnWidget() {
    hearthpwnCollapsed =
        !hearthpwnCollapsed;

    saveHearthPwnCollapsed();

    animateHearthPwnCollapse(
        hearthpwnCollapsed
    );
}


function isHearthPwnSeen(newsKey) {
    return Boolean(
        newsKey
        &&
        hearthpwnSeen[newsKey]
    );
}


function updateHearthPwnSeenUI() {
    document
        .querySelectorAll(
            '.hearthpwn-news-item[data-news-key]'
        )
        .forEach(item => {
            const newsKey =
                item.dataset.newsKey;

            const seen =
                isHearthPwnSeen(newsKey);

            item.classList.toggle(
                'seen',
                seen
            );

            const button =
                item.querySelector(
                    '.hearthpwn-watch-action'
                );

            if (button) {
                button.classList.toggle(
                    'seen',
                    seen
                );

                button.textContent =
                    seen
                    ? '↶ Marcar como não visto'
                    : '✓ Marcar como visto';
            }
        });
}


function markHearthPwnSeen(newsKey) {
    if (!newsKey) {
        return;
    }

    hearthpwnSeen[newsKey] =
        Date.now();

    saveHearthPwnSeen();
    updateHearthPwnSeenUI();
}


function toggleHearthPwnSeen(newsKey) {
    if (!newsKey) {
        return;
    }

    if (isHearthPwnSeen(newsKey)) {
        delete hearthpwnSeen[newsKey];
    }
    else {
        hearthpwnSeen[newsKey] =
            Date.now();
    }

    saveHearthPwnSeen();
    updateHearthPwnSeenUI();
}



function setPortsPlaybackMode(enabled) {
    const next = Boolean(enabled);
    if (portsPlaybackActive !== next) {
        resumeState = next ? loadPortsResume() : loadResume();
    }
    portsPlaybackActive = next;

    try {
        if (portsPlaybackActive) {
            sessionStorage.setItem(PORTS_PLAYBACK_MODE_KEY, '1');
        }
        else {
            sessionStorage.removeItem(PORTS_PLAYBACK_MODE_KEY);
        }
    }
    catch (_) {}
}


function restorePortsPlaybackMode() {
    const portsResume = loadPortsResume();
    const resumeId = portsResume && portsResume.videoId;
    const valid = Boolean(
        resumeId
        &&
        PORTS_VIDEOS.some(
            video => video.id === resumeId && video.embeddable !== false
        )
        &&
        !isWatched(resumeId)
    );

    try {
        const stored = sessionStorage.getItem(PORTS_PLAYBACK_MODE_KEY);
        if (valid && stored === '1') {
            portsPlaybackActive = true;
            resumeState = portsResume;
            return;
        }
    }
    catch (_) {}

    setPortsPlaybackMode(false);
}


function loadPortsCollapsed() {
    try {
        return localStorage.getItem(PORTS_COLLAPSED_KEY) === '1';
    }
    catch (_) {
        return false;
    }
}


function applyPortsCollapse() {
    const widget = document.querySelector('.ports-widget');

    if (!widget) {
        return;
    }

    widget.classList.toggle('collapsed', portsCollapsed);

    const toggle = widget.querySelector('.ports-collapse-toggle');
    if (toggle) {
        toggle.setAttribute('aria-expanded', portsCollapsed ? 'false' : 'true');
        toggle.title = portsCollapsed
            ? 'Expandir vídeos de portes'
            : 'Recolher vídeos de portes';
    }

    const chevron = widget.querySelector('.ports-collapse-chevron');
    if (chevron) {
        chevron.textContent = portsCollapsed ? '▸' : '▾';
    }
}


function togglePortsWidget() {
    portsCollapsed = !portsCollapsed;

    try {
        localStorage.setItem(PORTS_COLLAPSED_KEY, portsCollapsed ? '1' : '0');
    }
    catch (_) {}

    if (typeof animatePortsCollapse === 'function') {
        animatePortsCollapse(portsCollapsed);
    }
    else {
        applyPortsCollapse();
    }
}


function loadPortsPreferences() {
    try {
        const data = JSON.parse(
            localStorage.getItem(PORTS_PREFERENCES_KEY) || '{}'
        );
        if (!data || typeof data !== 'object') return;

        const channel = String(data.channel || '');
        const available = Array.from(
            document.querySelectorAll('.ports-channel-chip[data-channel-handle]')
        ).some(button => button.dataset.channelHandle === channel);

        portsFilterChannel = available ? channel : '';
        portsOnlyUnwatched = data.unwatched === true;
        portsSort = data.sort === 'oldest' ? 'oldest' : 'newest';
    }
    catch (_) {
        portsFilterChannel = '';
        portsOnlyUnwatched = false;
        portsSort = 'newest';
    }
}


function savePortsPreferences() {
    try {
        localStorage.setItem(PORTS_PREFERENCES_KEY, JSON.stringify({
            channel: portsFilterChannel,
            unwatched: portsOnlyUnwatched,
            sort: portsSort
        }));
    }
    catch (_) {}
}


function filteredPortsVideos() {
    const search = normalizeSearch(portsSearchQuery);
    const selected = PORTS_VIDEOS.filter(video =>
        (!portsFilterChannel ||
            String(video.channelHandle || '').toLowerCase() === portsFilterChannel.toLowerCase())
        &&
        (typeof portsRelevantOnly === 'undefined' || !portsRelevantOnly ||
            isRelevantPortVideo(video))
        &&
        (!search ||
            normalizeSearch((video.title || '') + ' ' + (video.channelTitle || '')).includes(search))
        &&
        (!portsOnlyUnwatched || !portsIsWatched(video.id))
    );

    return portsSort === 'newest' ? selected.reverse() : selected;
}


function sortPortsCards() {
    const list = document.querySelector('.ports-video-list');
    if (!list) return;

    const cards = new Map(
        Array.from(list.querySelectorAll('.ports-video-item[data-video-id]'))
            .map(card => [card.dataset.videoId, card])
    );

    const ordered = portsSort === 'newest'
        ? PORTS_VIDEOS.slice().reverse()
        : PORTS_VIDEOS;

    ordered.forEach(video => {
        const card = cards.get(video.id);
        if (card) list.appendChild(card);
    });
}


function updatePortsFilters(animate = false) {
    const widget = document.querySelector('.ports-widget');
    if (!widget) return;

    const selected = filteredPortsVideos();
    const ids = new Set(selected.map(video => video.id));
    const shown = [];

    widget.querySelectorAll('.ports-video-item[data-video-id]')
        .forEach(card => {
            const wasHidden = card.hidden;
            card.hidden = !ids.has(card.dataset.videoId);
            if (!card.hidden && wasHidden) shown.push(card);
        });

    widget.querySelectorAll('.ports-channel-chip[data-channel-handle]')
        .forEach(button => {
            const active = button.dataset.channelHandle === portsFilterChannel;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

    const search = document.getElementById('ports-search');
    if (search && search.value !== portsSearchQuery) search.value = portsSearchQuery;

    const sort = document.getElementById('ports-sort');
    if (sort && sort.value !== portsSort) sort.value = portsSort;

    const toggle = document.getElementById('ports-unwatched-toggle');
    if (toggle) {
        toggle.classList.toggle('active', portsOnlyUnwatched);
        toggle.setAttribute('aria-pressed', portsOnlyUnwatched ? 'true' : 'false');
    }

    const count = document.getElementById('ports-visible-count');
    if (count) count.textContent =
        selected.length + ' de ' + PORTS_VIDEOS.length + ' vídeos exibidos';

    const empty = document.getElementById('ports-filter-empty');
    if (empty) empty.hidden = selected.length !== 0 || PORTS_VIDEOS.length === 0;

    const clear = document.getElementById('ports-clear-filters');
    if (clear) clear.hidden = !(
        portsFilterChannel || portsSearchQuery ||
        portsOnlyUnwatched || portsSort !== 'newest'
    );

    const play = document.getElementById('ports-play-selection');
    if (play) play.disabled = !selected.some(video => video.embeddable !== false);

    if (animate && shown.length && typeof animatePortsFilteredCards === 'function') {
        animatePortsFilteredCards(shown);
    }

    if (typeof applyPortsLimit === 'function') applyPortsLimit();

    if (portsPlaybackActive) {
        rebuildPlaylist();
        updateUpNext();
    }
}


function setPortsChannelFilter(channel) {
    portsFilterChannel = String(channel || '');
    savePortsPreferences();
    if (typeof resetProgressivePorts === 'function') resetProgressivePorts();
    updatePortsFilters(true);
}


function setPortsSearch(query) {
    portsSearchQuery = String(query || '');
    if (typeof resetProgressivePorts === 'function') resetProgressivePorts();
    updatePortsFilters(true);
}


function setPortsSort(sort) {
    portsSort = sort === 'oldest' ? 'oldest' : 'newest';
    savePortsPreferences();
    sortPortsCards();
    updatePortsFilters();

    if (typeof animatePortsFilteredCards === 'function') {
        const cards = Array.from(
            document.querySelectorAll('.ports-video-item[data-video-id]')
        ).filter(card => !card.hidden);

        animatePortsFilteredCards(cards);
    }
}


function togglePortsUnwatched() {
    portsOnlyUnwatched = !portsOnlyUnwatched;
    savePortsPreferences();
    if (typeof resetProgressivePorts === 'function') resetProgressivePorts();
    updatePortsFilters(true);
}


function resetPortsFilters() {
    portsFilterChannel = '';
    portsSearchQuery = '';
    portsOnlyUnwatched = false;
    portsSort = 'newest';
    savePortsPreferences();
    sortPortsCards();
    updatePortsFilters(true);
}


function playPortsSelection() {
    const selected = filteredPortsVideos();
    const video = selected.find(item =>
        item.embeddable !== false && !portsIsWatched(item.id)
    ) || selected.find(item => item.embeddable !== false);

    if (video) openPortsVideo(video.id);
}


function updatePortsVideoUI() {
    const items = document.querySelectorAll(
        '.ports-video-item[data-video-id]'
    );

    let viewed = 0;

    items.forEach(item => {
        const done = portsIsWatched(item.dataset.videoId);

        if (done) {
            viewed += 1;
        }

        item.classList.toggle('seen', done);

        const button = item.querySelector('.ports-watch-action');
        if (button) {
            button.textContent = done
                ? '↶ Marcar como não visto'
                : '✓ Marcar como visto';

            button.setAttribute('aria-pressed', done ? 'true' : 'false');
        }
    });

    const progress = document.getElementById('ports-progress');
    if (progress) progress.textContent =
        viewed + ' de ' + items.length + ' assistidos';

    const percent = items.length ? Math.round(viewed * 100 / items.length) : 0;
    const label = document.getElementById('ports-progress-percent');
    if (label) label.textContent = percent + '%';

    const track = document.getElementById('ports-progress-track');
    if (track) track.setAttribute('aria-valuenow', String(percent));

    const fill = document.getElementById('ports-progress-fill');
    if (fill) fill.style.setProperty('--ports-progress-ratio', String(percent / 100));

    updatePortsFilters();
}


function markWatched(videoId, source = 'journal') {
    if (!videoId) return;

    if (source === 'ports') {
        portsWatched[videoId] = Date.now();
        savePortsWatched();
        return;
    }

    watched[videoId] = Date.now();
    saveWatched();
}


function isWatched(videoId) {
    return Boolean(watched[videoId]);
}


function toggleWatched(videoId, source = 'journal') {
    if (!videoId) return;

    if (source === 'ports') {
        const before = portsIsWatched(videoId);
        if (before) delete portsWatched[videoId];
        else {
            portsWatched[videoId] = Date.now();
            delete portsResumePositions[videoId];
            savePortsResumePositions();
            try {
                const saved = JSON.parse(localStorage.getItem(PORTS_RESUME_KEY) || 'null');
                if (saved?.videoId === videoId) localStorage.removeItem(PORTS_RESUME_KEY);
            } catch (_) {}
        }

        savePortsWatched();
        updatePortsVideoUI();
        if (portsPlaybackActive) rebuildPlaylist();

        showUndoToast(before ? 'Vídeo de portes marcado como não visto.'
            : 'Vídeo de portes marcado como visto.', () => {
            if (before) portsWatched[videoId] = Date.now();
            else delete portsWatched[videoId];
            savePortsWatched();
            updatePortsVideoUI();
            if (portsPlaybackActive) rebuildPlaylist();
        });
        return;
    }

    const becameWatched =
        !isWatched(videoId);

    const undoSnapshot =
        typeof captureWatchedUndoState
        === 'function'
        ? captureWatchedUndoState(
            videoId
        )
        : null;

    if (!becameWatched) {
        delete watched[videoId];
        saveWatched();
        setStatus('Vídeo marcado como não visto.');
    }
    else {
        markWatched(videoId);

        if (
            typeof handleVideoWatched
            === 'function'
        ) {
            handleVideoWatched(
                videoId
            );
        }

        clearResume(videoId);

        setStatus('Vídeo marcado como visto.');
    }

    applyView();

    const affectsMainJournal = VIDEOS.some(video => video.id === videoId);

    if (becameWatched) {
        animateWatchedFeedback(
            videoId
        );

        if (affectsMainJournal && !portsPlaybackActive) {
            animateJournalProgressCompletion();
        }

        if (
            typeof offerUndoWatched
            === 'function'
        ) {
            offerUndoWatched(
                videoId,
                undoSnapshot
            );
        }
    }

    if (affectsMainJournal && !portsPlaybackActive) {
        maybeCelebrateJournalCompletion();
    }
}
