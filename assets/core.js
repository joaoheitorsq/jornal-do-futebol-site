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

let portsPlaybackActive = false;
let portsCollapsed = false;

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

    applyPortsCollapse();
}


function updatePortsVideoUI() {
    const items = document.querySelectorAll(
        '.ports-video-item[data-video-id]'
    );

    let viewed = 0;

    items.forEach(item => {
        const done = isWatched(item.dataset.videoId);

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

    if (progress) {
        progress.textContent =
            viewed + ' de ' + items.length + ' assistidos';
    }
}


function markWatched(videoId) {
    if (!videoId) {
        return;
    }

    watched[videoId] = Date.now();
    saveWatched();
}


function isWatched(videoId) {
    return Boolean(watched[videoId]);
}


function toggleWatched(videoId) {
    if (!videoId) {
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

    if (becameWatched) {
        animateWatchedFeedback(
            videoId
        );

        animateJournalProgressCompletion();

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

    maybeCelebrateJournalCompletion();
}
