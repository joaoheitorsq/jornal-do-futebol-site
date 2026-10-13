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

let player = null;
let ready = false;
let activePlaylist = [];
let i = 0;
let resumeState = null;
let watched = loadWatched();
let hearthpwnSeen = loadHearthPwnSeen();
let hearthpwnCollapsed = loadHearthPwnCollapsed();
let onlyUnwatched = loadUnwatchedMode();
let collapsedChapters = loadCollapsedChapters();
let miniPlayerCollapsed = loadMiniPlayerCollapsed();
let searchQuery = '';
let transportDragging = false;


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
    applyHearthPwnCollapse();
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

    if (isWatched(videoId)) {
        delete watched[videoId];
        saveWatched();
        setStatus('Vídeo marcado como não visto.');
    }
    else {
        markWatched(videoId);

        if (
            resumeState
            &&
            resumeState.videoId === videoId
        ) {
            clearResume(videoId);
        }

        setStatus('Vídeo marcado como visto.');
    }

    applyView();
}


const WATCH_ACTION_HOLD_MS = 2000;
const WATCH_ACTION_MOVE_TOLERANCE = 18;

let watchActionHoldTimer = null;
let watchActionHoldButton = null;
let watchActionHoldPointerId = null;
let watchActionHoldStartX = 0;
let watchActionHoldStartY = 0;
let watchActionHoldTriggered = false;


function cancelWatchActionHold() {
    if (watchActionHoldTimer) {
        clearTimeout(
            watchActionHoldTimer
        );
    }

    if (watchActionHoldButton) {
        watchActionHoldButton.classList.remove(
            'holding'
        );
    }

    watchActionHoldTimer = null;
    watchActionHoldButton = null;
    watchActionHoldPointerId = null;
    watchActionHoldStartX = 0;
    watchActionHoldStartY = 0;
    watchActionHoldTriggered = false;
}


function beginWatchActionHold(event) {
    const button =
        event.target.closest(
            '.watch-action[data-video-id]'
        );

    if (!button) {
        return;
    }

    if (
        event.pointerType === 'mouse'
        &&
        event.button !== 0
    ) {
        return;
    }

    cancelWatchActionHold();

    watchActionHoldButton = button;
    watchActionHoldPointerId =
        event.pointerId;

    watchActionHoldStartX =
        event.clientX;

    watchActionHoldStartY =
        event.clientY;

    watchActionHoldTriggered = false;

    button.classList.add(
        'holding'
    );

    watchActionHoldTimer =
        setTimeout(
            () => {
                if (
                    !watchActionHoldButton
                    ||
                    watchActionHoldTriggered
                ) {
                    return;
                }

                const videoId =
                    watchActionHoldButton
                        .dataset.videoId;

                watchActionHoldTriggered = true;

                toggleWatched(
                    videoId
                );

                cancelWatchActionHold();
            },
            WATCH_ACTION_HOLD_MS
        );
}


function moveWatchActionHold(event) {
    if (
        !watchActionHoldButton
        ||
        watchActionHoldPointerId === null
        ||
        event.pointerId !== watchActionHoldPointerId
        ||
        watchActionHoldTriggered
    ) {
        return;
    }

    const distance =
        Math.hypot(
            event.clientX
            - watchActionHoldStartX,
            event.clientY
            - watchActionHoldStartY
        );

    if (
        distance
        >
        WATCH_ACTION_MOVE_TOLERANCE
    ) {
        cancelWatchActionHold();
    }
}


function endWatchActionHold(event) {
    if (
        watchActionHoldPointerId !== null
        &&
        event.pointerId !== watchActionHoldPointerId
    ) {
        return;
    }

    if (!watchActionHoldTriggered) {
        cancelWatchActionHold();
    }
}


document.addEventListener(
    'pointerdown',
    beginWatchActionHold
);


document.addEventListener(
    'pointermove',
    moveWatchActionHold,
    {passive: true}
);


document.addEventListener(
    'pointerup',
    endWatchActionHold
);


document.addEventListener(
    'pointercancel',
    endWatchActionHold
);


document.addEventListener(
    'click',
    event => {
        if (
            event.target.closest(
                '.watch-action[data-video-id]'
            )
        ) {
            event.preventDefault();
        }
    }
);


function loadCollapsedChapters() {
    try {
        const raw = localStorage.getItem(
            COLLAPSED_CHAPTERS_KEY
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


function saveCollapsedChapters() {
    try {
        localStorage.setItem(
            COLLAPSED_CHAPTERS_KEY,
            JSON.stringify(collapsedChapters)
        );
    }
    catch (_) {}
}


function applyChapterCollapse() {
    document
        .querySelectorAll('.chapter')
        .forEach(chapter => {
            const key = chapter.dataset.chapterKey || '';
            const collapsed = Boolean(
                collapsedChapters[key]
            );

            chapter.classList.toggle(
                'collapsed',
                collapsed
            );

            const chevron = chapter.querySelector(
                '.chapter-chevron'
            );

            if (chevron) {
                chevron.textContent = collapsed ? '▸' : '▾';
            }
        });
}


function toggleChapter(key) {
    if (!key) {
        return;
    }

    if (collapsedChapters[key]) {
        delete collapsedChapters[key];
    }
    else {
        collapsedChapters[key] = true;
    }

    saveCollapsedChapters();
    applyChapterCollapse();
}


function normalizeSearch(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('pt-BR')
        .trim();
}


function videoMatchesSearch(video) {
    if (!searchQuery) {
        return true;
    }

    if (!video) {
        return false;
    }

    const haystack = normalizeSearch(
        (video.title || '')
        + ' '
        + (video.channelTitle || '')
    );

    return haystack.includes(searchQuery);
}


function onSearchInput(value) {
    searchQuery = normalizeSearch(value);
    applyView();
}


function loadUnwatchedMode() {
    try {
        return (
            localStorage.getItem(
                UNWATCHED_MODE_KEY
            )
            === '1'
        );
    }
    catch (_) {
        return false;
    }
}


function saveUnwatchedMode() {
    try {
        localStorage.setItem(
            UNWATCHED_MODE_KEY,
            onlyUnwatched ? '1' : '0'
        );
    }
    catch (_) {}
}


function loadResume() {
    try {
        const raw =
            localStorage.getItem(
                RESUME_KEY
            );

        if (!raw) {
            return null;
        }

        const data = JSON.parse(raw);

        if (
            !data
            ||
            !data.videoId
        ) {
            localStorage.removeItem(
                RESUME_KEY
            );
            return null;
        }

        return {
            videoId: String(data.videoId),
            seconds: Math.max(
                0,
                Number(data.seconds || 0)
            ),
            title: String(
                data.title
                || 'Vídeo anterior em andamento'
            ),
            channelTitle: String(
                data.channelTitle
                || ''
            ),
            duration: Math.max(
                0,
                Number(data.duration || 0)
            ),
            countForTime:
                data.countForTime !== false,
            embeddable:
                data.embeddable !== false,
            savedAt: Number(
                data.savedAt || 0
            )
        };
    }
    catch (_) {
        return null;
    }
}

function currentVideoMeta(videoId) {
    return VIDEOS.find(
        video => video.id === videoId
    ) || null;
}


function resumeOutsideCurrentJournal() {
    return Boolean(
        resumeState
        &&
        !VIDEOS.some(
            video => video.id === resumeState.videoId
        )
    );
}


function metadataForVideo(videoId) {
    const current =
        currentVideoMeta(videoId);

    if (current) {
        return current;
    }

    if (
        resumeState
        &&
        resumeState.videoId === videoId
    ) {
        return resumeState;
    }

    return null;
}


function saveResume(
    videoId,
    seconds
) {
    if (!videoId) {
        return;
    }

    if (isWatched(videoId)) {
        return;
    }

    const meta =
        metadataForVideo(videoId);

    let playerTitle = '';

    if (!meta && player && ready) {
        try {
            const data = player.getVideoData();
            playerTitle = data && data.title
                ? String(data.title)
                : '';
        }
        catch (_) {}
    }

    const data = {
        videoId: String(videoId),
        seconds: Math.max(
            0,
            Number(seconds || 0)
        ),
        title:
            meta && meta.title
            ? String(meta.title)
            : (
                playerTitle
                || 'Vídeo anterior em andamento'
            ),
        channelTitle:
            meta && meta.channelTitle
            ? String(meta.channelTitle)
            : '',
        duration: Math.max(
            0,
            Number(
                meta && meta.duration
                ? meta.duration
                : 0
            )
        ),
        countForTime:
            meta
            ? meta.countForTime !== false
            : true,
        embeddable:
            meta
            ? meta.embeddable !== false
            : true,
        savedAt: Date.now()
    };

    try {
        localStorage.setItem(
            RESUME_KEY,
            JSON.stringify(data)
        );
    }
    catch (_) {}

    resumeState = data;
    renderCarryover();
    showResumeCard(videoId);
    updateTimeStats();
    updateResumeJumpButton();
}


function clearResume(videoId = null) {
    if (
        videoId
        &&
        resumeState
        &&
        resumeState.videoId !== videoId
    ) {
        return;
    }

    try {
        localStorage.removeItem(
            RESUME_KEY
        );
    }
    catch (_) {}

    resumeState = null;
    renderCarryover();
    showResumeCard(null);
    updateTimeStats();
    updateResumeJumpButton();
}

function currentTime() {
    if (!player || !ready) {
        return 0;
    }

    try {
        return Number(
            player.getCurrentTime()
        ) || 0;
    }
    catch (_) {
        return 0;
    }
}


function currentVideoId() {
    if (!player || !ready) {
        return null;
    }

    try {
        const data =
            player.getVideoData();

        return (
            data
            &&
            data.video_id
        ) || null;
    }
    catch (_) {
        return null;
    }
}


function formatTime(totalSeconds) {
    totalSeconds = Math.max(
        0,
        Math.floor(
            Number(totalSeconds || 0)
        )
    );

    const hours = Math.floor(
        totalSeconds / 3600
    );

    const minutes = Math.floor(
        (totalSeconds % 3600) / 60
    );

    const seconds =
        totalSeconds % 60;

    if (hours > 0) {
        return (
            String(hours)
            + ':'
            + String(minutes)
                .padStart(2, '0')
            + ':'
            + String(seconds)
                .padStart(2, '0')
        );
    }

    return (
        String(minutes)
        + ':'
        + String(seconds)
            .padStart(2, '0')
    );
}


function formatDurationHuman(totalSeconds) {
    totalSeconds = Math.max(
        0,
        Math.round(
            Number(totalSeconds || 0)
        )
    );

    const hours = Math.floor(
        totalSeconds / 3600
    );

    const minutes = Math.floor(
        (totalSeconds % 3600) / 60
    );

    if (hours > 0) {
        return (
            hours
            + 'h '
            + String(minutes).padStart(2, '0')
            + 'min'
        );
    }

    if (minutes > 0) {
        return minutes + 'min';
    }

    return totalSeconds + 's';
}


function updateTimeStats() {
    let total = 0;
    let consumed = 0;

    const playingId =
        currentVideoId();

    for (const video of VIDEOS) {
        if (
            !video.countForTime
            ||
            !video.duration
        ) {
            continue;
        }

        const duration = Math.max(
            0,
            Number(video.duration || 0)
        );

        total += duration;

        if (isWatched(video.id)) {
            consumed += duration;
            continue;
        }

        let partial = 0;

        if (
            playingId
            &&
            playingId === video.id
        ) {
            partial = currentTime();
        }
        else if (
            resumeState
            &&
            resumeState.videoId === video.id
        ) {
            partial = resumeState.seconds;
        }

        consumed += Math.min(
            duration,
            Math.max(0, partial)
        );
    }

    consumed = Math.min(
        total,
        consumed
    );

    const remaining = Math.max(
        0,
        total - consumed
    );

    document.getElementById(
        'time-total'
    ).textContent =
        formatDurationHuman(total);

    document.getElementById(
        'time-watched'
    ).textContent =
        formatDurationHuman(consumed);

    document.getElementById(
        'time-remaining'
    ).textContent =
        formatDurationHuman(remaining);
}


function renderCarryover() {
    const box =
        document.getElementById(
            'carryover'
        );

    const card =
        document.getElementById(
            'carryover-card'
        );

    const openButton =
        document.getElementById(
            'carryover-open'
        );

    const watchButton =
        document.getElementById(
            'carryover-watch-toggle'
        );

    if (
        !resumeState
        ||
        !resumeOutsideCurrentJournal()
        ||
        isWatched(resumeState.videoId)
        ||
        resumeState.embeddable === false
    ) {
        box.classList.add('hidden');
        card.removeAttribute(
            'data-video-id'
        );
        openButton.onclick = null;
        watchButton.onclick = null;
        watchButton.removeAttribute(
            'data-video-id'
        );
        return;
    }

    box.classList.remove('hidden');

    card.dataset.videoId =
        resumeState.videoId;

    openButton.onclick = () =>
        openVideo(
            resumeState.videoId
        );

    watchButton.dataset.videoId =
        resumeState.videoId;

    watchButton.onclick = null;

    document.getElementById(
        'carryover-title'
    ).textContent =
        resumeState.title
        || 'Vídeo anterior em andamento';

    document.getElementById(
        'carryover-channel'
    ).textContent =
        (
            resumeState.channelTitle
            ? resumeState.channelTitle + ' · '
            : ''
        )
        + 'ponto salvo em '
        + formatTime(
            resumeState.seconds
        );

    document.getElementById(
        'carryover-thumb'
    ).src =
        'https://i.ytimg.com/vi/'
        + encodeURIComponent(
            resumeState.videoId
        )
        + '/mqdefault.jpg';
}


function showResumeCard(videoId) {
    document
        .querySelectorAll('.card')
        .forEach(card => {
            card.classList.toggle(
                'resume',
                card.dataset.videoId
                === videoId
            );
        });
}


function showCurrentCard(videoId) {
    document
        .querySelectorAll('.card')
        .forEach(card => {
            card.classList.toggle(
                'current',
                card.dataset.videoId
                === videoId
            );
        });
}


function showResumeInfo() {
    const box =
        document.getElementById(
            'resume-info'
        );

    if (!resumeState) {
        box.classList.remove('show');
        return;
    }

    const index =
        activePlaylist.indexOf(
            resumeState.videoId
        );

    if (resumeOutsideCurrentJournal()) {
        box.textContent =
            '▶ Você parou em um vídeo que já saiu das últimas 24 horas — ponto salvo em '
            + formatTime(
                resumeState.seconds
            )
            + '. Ele ficará disponível aqui até você terminar.';

        box.classList.add('show');
        return;
    }

    if (index < 0) {
        box.classList.remove('show');
        return;
    }

    box.textContent =
        '▶ Você parou no vídeo '
        + (index + 1)
        + ' de '
        + activePlaylist.length
        + ' — ponto salvo em '
        + formatTime(
            resumeState.seconds
        )
        + '.';

    box.classList.add('show');
}


function setStatus(text) {
    document
        .getElementById('status')
        .textContent = text;
}


function rebuildPlaylist() {
    activePlaylist =
        VIDEOS
            .filter(video =>
                video.embeddable
                &&
                (
                    !onlyUnwatched
                    ||
                    !isWatched(video.id)
                )
                &&
                videoMatchesSearch(video)
            )
            .map(video => video.id);

    if (
        resumeState
        &&
        resumeOutsideCurrentJournal()
        &&
        resumeState.embeddable !== false
        &&
        !isWatched(resumeState.videoId)
    ) {
        activePlaylist.unshift(
            resumeState.videoId
        );
    }

    const current =
        currentVideoId();

    if (
        current
        &&
        activePlaylist.includes(current)
    ) {
        i = activePlaylist.indexOf(
            current
        );
    }
    else if (
        resumeState
        &&
        activePlaylist.includes(
            resumeState.videoId
        )
    ) {
        i = activePlaylist.indexOf(
            resumeState.videoId
        );
    }
    else {
        i = 0;
    }
}


function updateWatchButtons() {
    document
        .querySelectorAll(
            '.watch-action[data-video-id]'
        )
        .forEach(button => {
            const videoId =
                button.dataset.videoId;

            const done =
                isWatched(videoId);

            button.classList.toggle(
                'watched',
                done
            );

            button.textContent =
                done
                ? '↶ Marcar como não visto'
                : '✓ Marcar como visto';
        });
}


function updateResumeJumpButton() {
    const button =
        document.getElementById(
            'resume-jump'
        );

    if (!button) {
        return;
    }

    button.disabled = Boolean(
        !resumeState
        ||
        isWatched(
            resumeState.videoId
        )
    );
}


function renderQueueButton(
    button,
    videoId,
    label
) {
    if (!button) {
        return;
    }

    const video =
        metadataForVideo(videoId);

    if (!video) {
        button.hidden = true;
        button.onclick = null;
        return;
    }

    button.hidden = false;
    button.onclick = () =>
        openVideo(videoId);

    const image =
        document.createElement('img');

    image.src =
        'https://i.ytimg.com/vi/'
        + encodeURIComponent(videoId)
        + '/mqdefault.jpg';

    image.alt = '';
    image.loading = 'lazy';

    const text =
        document.createElement('span');

    const labelEl =
        document.createElement('small');

    labelEl.textContent = label;

    const title =
        document.createElement('strong');

    title.textContent =
        video.title || 'Sem título';

    const meta =
        document.createElement('small');

    meta.textContent =
        video.channelTitle || '';

    text.append(
        labelEl,
        title,
        meta
    );

    const duration =
        document.createElement('span');

    duration.className =
        'next-duration';

    duration.textContent =
        video.duration
        ? formatTime(video.duration)
        : '';

    button.replaceChildren(
        image,
        text,
        duration
    );
}


function updateUpNext(
    currentOverride = null
) {
    const box =
        document.getElementById(
            'up-next'
        );

    const firstButton =
        document.getElementById(
            'up-next-first'
        );

    const secondButton =
        document.getElementById(
            'up-next-second'
        );

    if (!box) {
        return;
    }

    let current =
        currentOverride
        ||
        currentVideoId();

    if (
        !current
        &&
        resumeState
        &&
        activePlaylist.includes(
            resumeState.videoId
        )
    ) {
        current =
            resumeState.videoId;
    }

    let startIndex = 0;

    if (
        current
        &&
        activePlaylist.includes(current)
    ) {
        startIndex =
            activePlaylist.indexOf(current)
            + 1;
    }

    const first =
        activePlaylist[startIndex]
        ||
        null;

    const second =
        activePlaylist[startIndex + 1]
        ||
        null;

    renderQueueButton(
        firstButton,
        first,
        'A seguir'
    );

    renderQueueButton(
        secondButton,
        second,
        'Depois'
    );

    box.classList.toggle(
        'empty',
        !first
    );

    const title =
        box.querySelector(
            '.up-next-title'
        );

    if (title) {
        title.textContent =
            first
            ? 'Fila'
            : 'Fila — fim do Jornal';
    }
}


function goToResume() {
    if (
        !resumeState
        ||
        isWatched(resumeState.videoId)
    ) {
        setStatus(
            'Não há um ponto pendente para localizar.'
        );
        return;
    }

    renderCarryover();

    let target =
        Array.from(
            document.querySelectorAll(
                '.card[data-video-id]'
            )
        ).find(card =>
            card.dataset.videoId
            ===
            resumeState.videoId
        );

    if (!target) {
        searchQuery = '';

        const search =
            document.getElementById(
                'video-search'
            );

        if (search) {
            search.value = '';
        }

        applyView();

        target =
            Array.from(
                document.querySelectorAll(
                    '.card[data-video-id]'
                )
            ).find(card =>
                card.dataset.videoId
                ===
                resumeState.videoId
            );
    }

    if (!target) {
        setStatus(
            'O vídeo salvo não está disponível nesta página.'
        );
        return;
    }

    const chapter =
        target.closest('.chapter');

    if (chapter) {
        const key =
            chapter.dataset.chapterKey;

        if (
            key
            &&
            collapsedChapters[key]
        ) {
            delete collapsedChapters[key];
            saveCollapsedChapters();
            applyChapterCollapse();
        }
    }

    target.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });
}


function applyView() {
    let visibleCount = 0;

    document
        .querySelectorAll('.chapter .card')
        .forEach(card => {
            const videoId =
                card.dataset.videoId;

            const video =
                currentVideoMeta(videoId);

            const hidden =
                (
                    onlyUnwatched
                    &&
                    isWatched(videoId)
                )
                ||
                !videoMatchesSearch(video);

            card.classList.toggle(
                'hidden',
                hidden
            );

            if (!hidden) {
                visibleCount++;
            }
        });

    document
        .querySelectorAll('.chapter')
        .forEach(chapter => {
            const visibleCards =
                chapter.querySelectorAll(
                    '.card:not(.hidden)'
                ).length;

            chapter.classList.toggle(
                'hidden',
                visibleCards === 0
            );

            const count =
                chapter.querySelector(
                    '.chapter-count'
                );

            if (count) {
                count.textContent =
                    '(' + visibleCards + ')';
            }
        });

    const toggle =
        document.getElementById(
            'unwatched-toggle'
        );

    toggle.classList.toggle(
        'active',
        onlyUnwatched
    );

    toggle.textContent =
        onlyUnwatched
        ? '✓ Só o que ainda não vi'
        : 'Só o que ainda não vi';

    let info =
        'Exibindo '
        + visibleCount
        + ' de '
        + VIDEOS.length
        + ' vídeos.';

    if (searchQuery) {
        info += ' Busca ativa.';
    }

    document
        .getElementById('toolbar-info')
        .textContent = info;

    const emptyBox =
        document.getElementById(
            'no-unwatched'
        );

    if (visibleCount === 0) {
        if (searchQuery) {
            emptyBox.textContent =
                'Nenhum vídeo corresponde à busca.';
        }
        else if (onlyUnwatched) {
            emptyBox.textContent =
                'Você já concluiu todos os vídeos disponíveis deste Jornal.';
        }
        else {
            emptyBox.textContent =
                'Nenhum vídeo disponível.';
        }
    }

    emptyBox.classList.toggle(
        'show',
        visibleCount === 0
    );

    applyChapterCollapse();
    renderCarryover();
    rebuildPlaylist();
    updateWatchButtons();
    showResumeInfo();
    updateTimeStats();
    updateResumeJumpButton();
    updateUpNext();
}


function toggleUnwatchedMode() {
    onlyUnwatched =
        !onlyUnwatched;

    saveUnwatchedMode();
    applyView();
}


function loadMiniPlayerCollapsed() {
    try {
        return (
            localStorage.getItem(
                MINI_PLAYER_COLLAPSED_KEY
            )
            === '1'
        );
    }
    catch (_) {
        return false;
    }
}


function saveMiniPlayerCollapsed() {
    try {
        localStorage.setItem(
            MINI_PLAYER_COLLAPSED_KEY,
            miniPlayerCollapsed ? '1' : '0'
        );
    }
    catch (_) {}
}


function updateMiniPlayerButton() {
    const button =
        document.getElementById(
            'mini-player-toggle'
        );

    if (!button) {
        return;
    }

    button.textContent =
        miniPlayerCollapsed
        ? '▶ Mostrar player'
        : '— Minimizar';

    button.setAttribute(
        'aria-label',
        miniPlayerCollapsed
        ? 'Restaurar player flutuante'
        : 'Minimizar player flutuante'
    );
}


function toggleMiniPlayerSize() {
    miniPlayerCollapsed =
        !miniPlayerCollapsed;

    saveMiniPlayerCollapsed();
    updateMiniPlayer();
}


function updateMiniPlayer() {
    const section =
        document.getElementById(
            'player-section'
        );

    const wrap =
        document.getElementById(
            'playerwrap'
        );

    if (!section || !wrap) {
        return;
    }

    const shouldFloat =
        section.getBoundingClientRect().bottom < 0;

    section.classList.toggle(
        'floating',
        shouldFloat
    );

    wrap.classList.toggle(
        'mini-player',
        shouldFloat
    );

    wrap.classList.toggle(
        'minimized',
        shouldFloat
        && miniPlayerCollapsed
    );

    updateMiniPlayerButton();
}


window.addEventListener(
    'scroll',
    updateMiniPlayer,
    {passive: true}
);

window.addEventListener(
    'resize',
    updateMiniPlayer
);


const tag =
document.createElement('script');

tag.src =
'https://www.youtube.com/iframe_api';

document.head.appendChild(tag);


resumeState = loadResume();

applyView();
updateHearthPwnSeenUI();
applyHearthPwnCollapse();

if (resumeState) {
    showResumeCard(
        resumeState.videoId
    );
}


function formatPlayerTime(seconds) {
    seconds = Math.max(
        0,
        Math.floor(Number(seconds || 0))
    );

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return (
            String(hours)
            + ':'
            + String(minutes).padStart(2, '0')
            + ':'
            + String(secs).padStart(2, '0')
        );
    }

    return (
        String(minutes)
        + ':'
        + String(secs).padStart(2, '0')
    );
}


function updateTransport() {
    const progress =
        document.getElementById(
            'journal-progress'
        );

    const clock =
        document.getElementById(
            'journal-clock'
        );

    const playPause =
        document.getElementById(
            'journal-play-pause'
        );

    if (
        !progress
        || !clock
        || !playPause
    ) {
        return;
    }

    if (!player || !ready) {
        progress.value = '0';
        clock.textContent = '0:00 / 0:00';
        playPause.textContent = '▶ Play';
        return;
    }

    try {
        const duration =
            Number(player.getDuration() || 0);

        const current =
            Number(player.getCurrentTime() || 0);

        if (!transportDragging) {
            progress.value =
                duration > 0
                ? String(
                    Math.round(
                        Math.min(1, current / duration)
                        * 1000
                    )
                )
                : '0';
        }

        clock.textContent =
            formatPlayerTime(current)
            + ' / '
            + formatPlayerTime(duration);

        const state =
            player.getPlayerState();

        playPause.textContent =
            state === YT.PlayerState.PLAYING
            ? '⏸ Pausar'
            : '▶ Play';
    }
    catch (_) {}
}


function togglePlayerPlayback() {
    if (!player || !ready) {
        return;
    }

    try {
        const state =
            player.getPlayerState();

        if (state === YT.PlayerState.PLAYING) {
            player.pauseVideo();
        }
        else {
            player.playVideo();
        }
    }
    catch (_) {}
}


function seekBy(seconds) {
    if (!player || !ready) {
        return;
    }

    try {
        const duration =
            Number(player.getDuration() || 0);

        const current =
            Number(player.getCurrentTime() || 0);

        const target = Math.max(
            0,
            duration > 0
                ? Math.min(duration, current + seconds)
                : current + seconds
        );

        player.seekTo(target, true);
        updateTransport();
    }
    catch (_) {}
}


function previewSeek(value) {
    transportDragging = true;

    if (!player || !ready) {
        return;
    }

    try {
        const duration =
            Number(player.getDuration() || 0);

        const target =
            duration * (Number(value || 0) / 1000);

        const clock =
            document.getElementById(
                'journal-clock'
            );

        if (clock) {
            clock.textContent =
                formatPlayerTime(target)
                + ' / '
                + formatPlayerTime(duration);
        }
    }
    catch (_) {}
}


function commitSeek(value) {
    if (!player || !ready) {
        transportDragging = false;
        return;
    }

    try {
        const duration =
            Number(player.getDuration() || 0);

        const target =
            duration * (Number(value || 0) / 1000);

        player.seekTo(target, true);
    }
    catch (_) {}

    transportDragging = false;
    updateTransport();
}


setInterval(
    updateTransport,
    500
);


function standardEmbedUrl(videoId) {
    const params =
        new URLSearchParams({
            enablejsapi: '1',
            controls: '1',
            playsinline: '1',
            rel: '0',
            fs: '1',
            origin: window.location.origin
        });

    return (
        'https://www.youtube.com/embed/'
        + encodeURIComponent(videoId)
        + '?'
        + params.toString()
    );
}


function onYouTubeIframeAPIReady() {
    if (
        !CURRENT_EMBEDDABLE_IDS.length
        &&
        !(
            resumeState
            &&
            resumeState.embeddable !== false
        )
    ) {
        setStatus(
            'Nenhum vídeo reproduzível no player.'
        );
        return;
    }

    let initialId =
        activePlaylist[0]
        ||
        CURRENT_EMBEDDABLE_IDS[0];

    if (
        resumeState
        &&
        activePlaylist.includes(
            resumeState.videoId
        )
    ) {
        initialId =
            resumeState.videoId;
    }

    /*
     * IMPORTANTE:
     * Todo conteúdo, inclusive Shorts, é carregado
     * pelo endpoint padrão /embed/VIDEO_ID.
     * A rota /shorts/ é usada apenas no Python
     * para identificar se um upload é Short.
     */
    const slot =
        document.getElementById(
            'player-slot'
        );

    const iframe =
        document.createElement(
            'iframe'
        );

    iframe.id =
        'youtube-standard-player';

    iframe.src =
        standardEmbedUrl(
            initialId
        );

    iframe.title =
        'Player do YouTube';

    iframe.allow =
        'accelerometer; autoplay; clipboard-write; '
        + 'encrypted-media; gyroscope; picture-in-picture; web-share';

    iframe.allowFullscreen = true;

    iframe.referrerPolicy =
        'strict-origin-when-cross-origin';

    slot.replaceChildren(
        iframe
    );

    player =
    new YT.Player(
        'youtube-standard-player',
        {
            events: {
                onReady:
                    () => {
                        ready = true;
                        rebuildPlaylist();
                        updateTransport();

                        if (
                            resumeState
                            &&
                            activePlaylist.includes(
                                resumeState.videoId
                            )
                        ) {
                            i =
                                activePlaylist.indexOf(
                                    resumeState.videoId
                                );

                            player.cueVideoById({
                                videoId:
                                    resumeState.videoId,
                                startSeconds:
                                    resumeState.seconds
                            });

                            setStatus(
                                'Ponto anterior carregado. '
                                +
                                'Clique em “Começar jornal” '
                                +
                                'para continuar.'
                            );

                            showResumeInfo();
                        }
                    },

                onStateChange:
                    event => {
                        const id =
                            currentVideoId();

                        updateTransport();

                        if (
                            completionAdvanceInProgress
                            &&
                            id
                            &&
                            id !== completionAdvanceVideoId
                            &&
                            event.data
                            !== YT.PlayerState.ENDED
                        ) {
                            completionAdvanceInProgress = false;
                            completionAdvanceVideoId = null;
                        }

                        if (
                            event.data
                            ===
                            YT.PlayerState.PLAYING
                        ) {
                            if (id) {
                                if (
                                    activePlaylist.includes(id)
                                ) {
                                    i =
                                        activePlaylist.indexOf(id);
                                }

                                showCurrentCard(id);

                                saveResume(
                                    id,
                                    currentTime()
                                );

                                showResumeInfo();
                                updateUpNext(id);
                            }
                        }

                        if (
                            event.data
                            ===
                            YT.PlayerState.PAUSED
                        ) {
                            if (id) {
                                saveResume(
                                    id,
                                    currentTime()
                                );

                                showResumeInfo();
                            }
                        }

                        if (
                            event.data
                            ===
                            YT.PlayerState.ENDED
                        ) {
                            completeCurrentAndAdvance(
                                id
                            );
                        }
                    },

                onError:
                    () => {
                        completionAdvanceInProgress = false;
                        completionAdvanceVideoId = null;

                        setStatus(
                            'Vídeo indisponível aqui; pulando...'
                        );

                        setTimeout(
                            next,
                            700
                        );
                    }
            }
        }
    );
}


setInterval(
    () => {
        if (!player || !ready) {
            return;
        }

        try {
            if (
                player.getPlayerState()
                !==
                YT.PlayerState.PLAYING
            ) {
                return;
            }

            const id =
                currentVideoId();

            if (id) {
                saveResume(
                    id,
                    currentTime()
                );
            }
        }
        catch (_) {}
    },
    5000
);


function play(
    index,
    startSeconds = 0
) {
    if (
        !activePlaylist.length
        ||
        !ready
    ) {
        setStatus(
            'Nenhum vídeo reproduzível neste modo.'
        );
        return;
    }

    if (
        index < 0
        ||
        index >= activePlaylist.length
    ) {
        return;
    }

    i = index;

    const id =
        activePlaylist[i];

    player.loadVideoById({
        videoId: id,
        startSeconds: Math.max(
            0,
            Number(startSeconds || 0)
        )
    });

    showCurrentCard(id);

    saveResume(
        id,
        startSeconds
    );

    showResumeInfo();
    updateUpNext(id);

    setStatus(
        'Reproduzindo '
        + (i + 1)
        + ' de '
        + activePlaylist.length
    );
}


function start() {
    rebuildPlaylist();

    if (!activePlaylist.length) {
        setStatus(
            'Nenhum vídeo reproduzível neste modo.'
        );
        return;
    }

    if (
        resumeState
        &&
        activePlaylist.includes(
            resumeState.videoId
        )
    ) {
        const index =
            activePlaylist.indexOf(
                resumeState.videoId
            );

        play(
            index,
            resumeState.seconds
        );
        return;
    }

    play(0);
}


let completionAdvanceInProgress = false;
let completionAdvanceVideoId = null;


function adjacentQueuedVideoId(
    currentId,
    queue,
    direction = 1
) {
    if (!Array.isArray(queue) || !queue.length) {
        return null;
    }

    const directIndex =
        queue.indexOf(currentId);

    if (directIndex >= 0) {
        const targetIndex =
            directIndex + direction;

        return (
            targetIndex >= 0
            &&
            targetIndex < queue.length
        )
            ? queue[targetIndex]
            : null;
    }

    const currentIndex =
        VIDEOS.findIndex(
            video => video.id === currentId
        );

    if (currentIndex >= 0) {
        const allowed =
            new Set(queue);

        for (
            let index = currentIndex + direction;
            index >= 0 && index < VIDEOS.length;
            index += direction
        ) {
            const candidate =
                VIDEOS[index].id;

            if (allowed.has(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    /*
     * Um carryover fica logicamente antes dos vídeos
     * do Jornal atual. Se ele já saiu da fila, o
     * próximo válido é o primeiro item restante.
     */
    return direction > 0
        ? (queue[0] || null)
        : null;
}


function completeCurrentAndAdvance(
    videoId = null
) {
    if (completionAdvanceInProgress) {
        return;
    }

    const current =
        videoId
        ||
        currentVideoId();

    if (!current) {
        setStatus(
            'Nenhum vídeo está sendo reproduzido.'
        );
        return;
    }

    rebuildPlaylist();

    const queueBefore =
        [...activePlaylist];

    const nextId =
        adjacentQueuedVideoId(
            current,
            queueBefore,
            1
        );

    completionAdvanceInProgress = true;
    completionAdvanceVideoId = current;

    markWatched(current);
    clearResume(current);
    applyView();

    if (nextId) {
        let nextIndex =
            activePlaylist.indexOf(nextId);

        if (nextIndex < 0) {
            rebuildPlaylist();
            nextIndex =
                activePlaylist.indexOf(nextId);
        }

        if (nextIndex >= 0) {
            play(nextIndex);
            return;
        }
    }

    completionAdvanceInProgress = false;
    completionAdvanceVideoId = null;

    setStatus(
        'Vídeo marcado como visto. Fim do Jornal.'
    );
}


function journalFullscreenElement() {
    return (
        document.fullscreenElement
        ||
        document.webkitFullscreenElement
        ||
        null
    );
}


function isJournalFullscreen() {
    const wrap =
        document.getElementById(
            'playerwrap'
        );

    return Boolean(
        wrap
        &&
        journalFullscreenElement() === wrap
    );
}


function updateJournalFullscreenButton() {
    const button =
        document.getElementById(
            'journal-fullscreen-toggle'
        );

    if (!button) {
        return;
    }

    button.textContent =
        isJournalFullscreen()
        ? '↙ Sair da tela cheia'
        : '⛶ Tela cheia do Jornal';
}


async function toggleJournalFullscreen() {
    const wrap =
        document.getElementById(
            'playerwrap'
        );

    if (!wrap) {
        return;
    }

    try {
        if (isJournalFullscreen()) {
            if (document.exitFullscreen) {
                await document.exitFullscreen();
            }
            else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }

            return;
        }

        if (wrap.requestFullscreen) {
            await wrap.requestFullscreen();
        }
        else if (wrap.webkitRequestFullscreen) {
            wrap.webkitRequestFullscreen();
        }
        else {
            setStatus(
                'Este navegador não permite tela cheia do Jornal.'
            );
        }
    }
    catch (_) {
        setStatus(
            'Não foi possível abrir a tela cheia do Jornal.'
        );
    }
}


const FULLSCREEN_NEXT_HOLD_MS = 3000;
const FULLSCREEN_NEXT_MOVE_TOLERANCE = 22;

let fullscreenNextHoldTimer = null;
let fullscreenNextHoldFrame = null;
let fullscreenNextHoldStartedAt = 0;
let fullscreenNextHoldPointerId = null;
let fullscreenNextHoldStartX = 0;
let fullscreenNextHoldStartY = 0;
let fullscreenNextHoldTriggered = false;


function markCurrentWatchedAndNext() {
    completeCurrentAndAdvance(
        currentVideoId()
    );
}


function resetFullscreenNextHoldVisual() {
    const button =
        document.getElementById(
            'fullscreen-next'
        );

    const countdown =
        document.getElementById(
            'fullscreen-hold-countdown'
        );

    const countdownNumber =
        document.getElementById(
            'fullscreen-hold-countdown-number'
        );

    if (button) {
        button.classList.remove(
            'holding'
        );

        button.style.setProperty(
            '--hold-progress',
            '0%'
        );

        button.textContent =
            '⏭';
    }

    if (countdown) {
        countdown.classList.remove(
            'show'
        );
    }

    if (countdownNumber) {
        countdownNumber.textContent =
            '3';

        countdownNumber.classList.remove(
            'tick'
        );
    }
}


function cancelFullscreenNextHold() {
    if (fullscreenNextHoldTimer) {
        clearTimeout(
            fullscreenNextHoldTimer
        );
    }

    if (fullscreenNextHoldFrame) {
        cancelAnimationFrame(
            fullscreenNextHoldFrame
        );
    }

    fullscreenNextHoldTimer = null;
    fullscreenNextHoldFrame = null;
    fullscreenNextHoldStartedAt = 0;
    fullscreenNextHoldPointerId = null;
    fullscreenNextHoldTriggered = false;

    resetFullscreenNextHoldVisual();
}


function updateFullscreenNextHoldProgress() {
    const button =
        document.getElementById(
            'fullscreen-next'
        );

    const countdown =
        document.getElementById(
            'fullscreen-hold-countdown'
        );

    const countdownNumber =
        document.getElementById(
            'fullscreen-hold-countdown-number'
        );

    if (
        !button
        ||
        !fullscreenNextHoldStartedAt
        ||
        fullscreenNextHoldTriggered
    ) {
        return;
    }

    const elapsed =
        performance.now()
        - fullscreenNextHoldStartedAt;

    const progress =
        Math.min(
            1,
            elapsed / FULLSCREEN_NEXT_HOLD_MS
        );

    button.style.setProperty(
        '--hold-progress',
        String(
            Math.round(progress * 100)
        ) + '%'
    );

    if (countdown) {
        countdown.classList.add(
            'show'
        );
    }

    if (countdownNumber) {
        const remaining =
            Math.max(
                1,
                Math.ceil(
                    (
                        FULLSCREEN_NEXT_HOLD_MS
                        - elapsed
                    )
                    / 1000
                )
            );

        const nextText =
            String(remaining);

        if (
            countdownNumber.textContent
            !== nextText
        ) {
            countdownNumber.textContent =
                nextText;

            countdownNumber.classList.remove(
                'tick'
            );

            void countdownNumber.offsetWidth;

            countdownNumber.classList.add(
                'tick'
            );
        }
    }

    if (progress < 1) {
        fullscreenNextHoldFrame =
            requestAnimationFrame(
                updateFullscreenNextHoldProgress
            );
    }
}


function beginFullscreenNextHold(event) {
    if (
        !isJournalFullscreen()
        ||
        completionAdvanceInProgress
    ) {
        return;
    }

    if (
        event.pointerType === 'mouse'
        &&
        event.button !== 0
    ) {
        return;
    }

    const button =
        document.getElementById(
            'fullscreen-next'
        );

    if (!button) {
        return;
    }

    event.preventDefault();

    cancelFullscreenNextHold();

    fullscreenNextHoldPointerId =
        event.pointerId;

    fullscreenNextHoldStartX =
        event.clientX;

    fullscreenNextHoldStartY =
        event.clientY;

    fullscreenNextHoldStartedAt =
        performance.now();

    fullscreenNextHoldTriggered = false;

    button.classList.add(
        'holding'
    );

    try {
        button.setPointerCapture(
            event.pointerId
        );
    }
    catch (_) {}

    updateFullscreenNextHoldProgress();

    fullscreenNextHoldTimer =
        setTimeout(
            () => {
                fullscreenNextHoldTriggered = true;

                if (fullscreenNextHoldFrame) {
                    cancelAnimationFrame(
                        fullscreenNextHoldFrame
                    );
                }

                fullscreenNextHoldFrame = null;
                fullscreenNextHoldTimer = null;

                button.style.setProperty(
                    '--hold-progress',
                    '100%'
                );

                button.textContent =
                    '✓';

                const countdown =
                    document.getElementById(
                        'fullscreen-hold-countdown'
                    );

                if (countdown) {
                    countdown.classList.remove(
                        'show'
                    );
                }

                markCurrentWatchedAndNext();

                setTimeout(
                    cancelFullscreenNextHold,
                    350
                );
            },
            FULLSCREEN_NEXT_HOLD_MS
        );
}


function moveFullscreenNextHold(event) {
    if (
        fullscreenNextHoldPointerId === null
        ||
        event.pointerId !== fullscreenNextHoldPointerId
        ||
        fullscreenNextHoldTriggered
    ) {
        return;
    }

    const deltaX =
        event.clientX
        - fullscreenNextHoldStartX;

    const deltaY =
        event.clientY
        - fullscreenNextHoldStartY;

    const distance =
        Math.hypot(
            deltaX,
            deltaY
        );

    if (
        distance
        >
        FULLSCREEN_NEXT_MOVE_TOLERANCE
    ) {
        cancelFullscreenNextHold();
    }
}


function endFullscreenNextHold(event) {
    if (
        fullscreenNextHoldPointerId !== null
        &&
        event.pointerId !== fullscreenNextHoldPointerId
    ) {
        return;
    }

    if (!fullscreenNextHoldTriggered) {
        cancelFullscreenNextHold();
    }
}


function initFullscreenNextHold() {
    const button =
        document.getElementById(
            'fullscreen-next'
        );

    if (!button) {
        return;
    }

    button.addEventListener(
        'pointerdown',
        beginFullscreenNextHold
    );

    button.addEventListener(
        'pointermove',
        moveFullscreenNextHold
    );

    button.addEventListener(
        'pointerup',
        endFullscreenNextHold
    );

    button.addEventListener(
        'pointercancel',
        endFullscreenNextHold
    );

    button.addEventListener(
        'contextmenu',
        event => event.preventDefault()
    );

    button.addEventListener(
        'click',
        event => event.preventDefault()
    );
}


initFullscreenNextHold();


document.addEventListener(
    'fullscreenchange',
    () => {
        cancelFullscreenNextHold();
        updateJournalFullscreenButton();
    }
);


document.addEventListener(
    'webkitfullscreenchange',
    () => {
        cancelFullscreenNextHold();
        updateJournalFullscreenButton();
    }
);


function next() {
    rebuildPlaylist();

    if (!activePlaylist.length) {
        setStatus(
            'Fim do Jornal.'
        );
        return;
    }

    const current =
        currentVideoId();

    if (current) {
        const nextId =
            adjacentQueuedVideoId(
                current,
                activePlaylist,
                1
            );

        if (!nextId) {
            setStatus(
                'Fim do Jornal.'
            );
            return;
        }

        const nextIndex =
            activePlaylist.indexOf(nextId);

        if (nextIndex >= 0) {
            play(nextIndex);
        }

        return;
    }

    const nextIndex = i + 1;

    if (
        nextIndex >= activePlaylist.length
    ) {
        setStatus(
            'Fim do Jornal.'
        );
        return;
    }

    play(nextIndex);
}


function prev() {
    rebuildPlaylist();

    if (!activePlaylist.length) {
        return;
    }

    const current =
        currentVideoId();

    if (current) {
        const previousId =
            adjacentQueuedVideoId(
                current,
                activePlaylist,
                -1
            );

        if (!previousId) {
            setStatus(
                'Você está no primeiro vídeo.'
            );
            return;
        }

        const previousIndex =
            activePlaylist.indexOf(
                previousId
            );

        if (previousIndex >= 0) {
            play(previousIndex);
        }

        return;
    }

    if (i <= 0) {
        setStatus(
            'Você está no primeiro vídeo.'
        );
        return;
    }

    play(i - 1);
}


function openVideo(id) {
    const video =
        metadataForVideo(id);

    if (!video) {
        return;
    }

    if (video.embeddable === false) {
        window.open(
            'https://www.youtube.com/watch?v='
            + encodeURIComponent(id),
            '_blank',
            'noopener'
        );
        return;
    }

    rebuildPlaylist();

    let index =
        activePlaylist.indexOf(id);

    if (index < 0) {
        onlyUnwatched = false;
        searchQuery = '';
        saveUnwatchedMode();

        const search =
            document.getElementById(
                'video-search'
            );

        if (search) {
            search.value = '';
        }

        applyView();
        index =
            activePlaylist.indexOf(id);
    }

    if (index >= 0) {
        play(index);

        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    }
}


function saveBeforeLeaving() {
    const id =
        currentVideoId();

    if (id) {
        saveResume(
            id,
            currentTime()
        );
    }
}


window.addEventListener(
    'beforeunload',
    saveBeforeLeaving
);


document.addEventListener(
    'visibilitychange',
    () => {
        if (document.hidden) {
            saveBeforeLeaving();
        }
    }
);
