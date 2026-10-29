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

    const chapter =
        Array.from(
            document.querySelectorAll(
                '.chapter'
            )
        )
        .find(item =>
            item.dataset.chapterKey
            === key
        );

    const collapse =
        !Boolean(
            collapsedChapters[key]
        );

    if (collapse) {
        collapsedChapters[key] = true;
    }
    else {
        delete collapsedChapters[key];
    }

    saveCollapsedChapters();

    animateChapterToggle(
        chapter,
        collapse
    );
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
    searchQuery =
        normalizeSearch(value);

    runAnimatedViewUpdate(
        applyView
    );
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
    ) || PORTS_VIDEOS.find(
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
        &&
        !PORTS_VIDEOS.some(
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
        typeof featureVideoMeta
        === 'function'
    ) {
        const featureMeta =
            featureVideoMeta(
                videoId
            );

        if (featureMeta) {
            return featureMeta;
        }
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

    if (portsPlaybackActive ? portsIsWatched(videoId) : isWatched(videoId)) {
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

    if (portsPlaybackActive) {
        data.countForTime = false;
        const portsMeta = PORTS_VIDEOS.find(v => v.id === videoId);
        if (portsMeta) {
            data.title = portsMeta.title || data.title;
            data.channelTitle = portsMeta.channelTitle || data.channelTitle;
            data.duration = Number(portsMeta.duration || data.duration);
        }
        try {
            localStorage.setItem(PORTS_RESUME_KEY, JSON.stringify(data));
        } catch (_) {}
        portsResumePositions[videoId] = {
            seconds: data.seconds,
            savedAt: Date.now()
        };
        savePortsResumePositions();
        resumeState = data;
        showResumeCard(videoId);
        updateResumeJumpButton();
        return;
    }

    try {
        localStorage.setItem(
            RESUME_KEY,
            JSON.stringify(data)
        );
    }
    catch (_) {}

    resumeState = data;

    if (
        typeof saveResumePosition
        === 'function'
    ) {
        saveResumePosition(
            videoId,
            data
        );
    }

    renderCarryover();
    showResumeCard(videoId);

    if (
        typeof updateCardFeatureUI
        === 'function'
    ) {
        updateCardFeatureUI();
    }

    updateTimeStats();
    updateResumeJumpButton();
}


function clearResume(videoId = null) {
    if (portsPlaybackActive) {
        if (videoId) delete portsResumePositions[videoId];
        else portsResumePositions = {};
        savePortsResumePositions();
        if (!videoId || (resumeState && resumeState.videoId === videoId)) {
            try { localStorage.removeItem(PORTS_RESUME_KEY); } catch (_) {}
            resumeState = null;
        }
        showResumeCard(resumeState ? resumeState.videoId : null);
        updateResumeJumpButton();
        return;
    }

    if (
        videoId
        &&
        typeof removeResumePosition
        === 'function'
    ) {
        removeResumePosition(
            videoId
        );
    }

    const clearsPrimary =
        !videoId
        ||
        !resumeState
        ||
        resumeState.videoId
        === videoId;

    if (!clearsPrimary) {
        updateTimeStats();
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

    const progressVideos =
        VIDEOS.filter(
            video =>
                typeof shouldHideVideoForFeatures
                !== 'function'
                ||
                !shouldHideVideoForFeatures(
                    video
                )
        );

    const watchedCount =
        progressVideos.reduce(
            (count, video) =>
                count
                + (
                    isWatched(video.id)
                    ? 1
                    : 0
                ),
            0
        );

    const watchedNumber =
        document.getElementById(
            'header-progress-watched'
        );

    const totalNumber =
        document.getElementById(
            'header-progress-total'
        );

    if (watchedNumber) {
        if (
            typeof animateNumberChange
            === 'function'
        ) {
            animateNumberChange(
                watchedNumber,
                watchedCount
            );
        }
        else {
            watchedNumber.textContent =
                String(watchedCount);
        }
    }

    if (totalNumber) {
        // Usar o mesmo conjunto filtrado no numerador e no denominador.
        totalNumber.textContent =
            String(progressVideos.length);
    }

    const playingId =
        portsPlaybackActive ? null : currentVideoId();

    for (const video of progressVideos) {
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
            typeof getResumeSeconds
            === 'function'
        ) {
            const storedPosition = getResumePosition(video.id);
            partial = storedPosition ? Math.max(0, Number(storedPosition.seconds || 0)) : 0;
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

    const percent =
        total > 0
        ? Math.round(
            (consumed / total) * 100
        )
        : 0;

    const progress =
        document.getElementById(
            'time-progress'
        );

    const progressBar =
        document.getElementById(
            'time-progress-bar'
        );

    if (progress) {
        progress.setAttribute(
            'aria-valuenow',
            String(percent)
        );

        progress.classList.toggle(
            'complete',
            total > 0
            &&
            percent >= 100
        );
    }

    if (progressBar) {
        progressBar.style.setProperty(
            '--progress-ratio',
            String(
                Math.max(
                    0,
                    Math.min(
                        1,
                        percent / 100
                    )
                )
            )
        );
    }

    if (
        typeof updateSessionSummary
        === 'function'
    ) {
        updateSessionSummary();
    }

    if (
        typeof updateSmartHeader
        === 'function'
    ) {
        updateSmartHeader();
    }
}


function renderCarryover() {
    if (
        typeof renderFeatureCarryover
        === 'function'
    ) {
        renderFeatureCarryover();
    }
}

function showResumeCard(videoId) {
    document
        .querySelectorAll('.card, .ports-video-item')
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
        .querySelectorAll('.card, .ports-video-item')
        .forEach(card => {
            card.classList.toggle(
                'current',
                card.dataset.videoId
                === videoId
            );
        });

    if (
        typeof updateCurrentChapterHighlight
        === 'function'
    ) {
        updateCurrentChapterHighlight();
    }
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
        (portsPlaybackActive ? '▶ Portes: vídeo ' : '▶ Você parou no vídeo ')
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
    if (portsPlaybackActive) {
        activePlaylist = filteredPortsVideos()
            .filter(video => video.embeddable)
            .map(video => video.id);

        const current = currentVideoId();

        if (current && activePlaylist.includes(current)) {
            i = activePlaylist.indexOf(current);
        }
        else if (
            resumeState
            &&
            activePlaylist.includes(resumeState.videoId)
        ) {
            i = activePlaylist.indexOf(resumeState.videoId);
        }
        else {
            i = 0;
        }

        return;
    }

    const basePlaylist =
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
                &&
                (
                    typeof shouldHideVideoForFeatures
                    !== 'function'
                    ||
                    !shouldHideVideoForFeatures(
                        video
                    )
                )
            )
            .map(video => video.id);

    activePlaylist =
        typeof orderPlaylistWithFeatures
        === 'function'
        ? orderPlaylistWithFeatures(
            basePlaylist
        )
        : basePlaylist;

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

            const card =
                button.closest(
                    '.card'
                );

            if (card) {
                card.classList.toggle(
                    'watched',
                    done
                );
            }

            button.textContent =
                done
                ? '↶ Marcar como não visto'
                : '✓ Marcar como visto';
        });

    updatePortsVideoUI();

    if (
        typeof updateCardFeatureUI
        === 'function'
    ) {
        updateCardFeatureUI();
    }
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
        (portsPlaybackActive
            ? portsIsWatched(resumeState.videoId)
            : isWatched(resumeState.videoId))
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
        delete button.dataset.videoId;
        return;
    }

    button.hidden = false;
    button.dataset.videoId =
        videoId;

    button.classList.toggle(
        'primary-next',
        label === 'PRÓXIMO'
    );

    button.onclick = () =>
        portsPlaybackActive
        &&
        PORTS_VIDEOS.some(video => video.id === videoId)
        ? openPortsVideo(videoId)
        : openVideo(videoId);

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

    const previousFirst =
        box.dataset.firstVideo
        || '';

    renderQueueButton(
        firstButton,
        first,
        'PRÓXIMO'
    );

    renderQueueButton(
        secondButton,
        second,
        'DEPOIS'
    );

    box.dataset.firstVideo =
        first || '';

    if (
        first
        &&
        first !== previousFirst
        &&
        typeof animateQueueAdvance
        === 'function'
    ) {
        animateQueueAdvance(
            firstButton,
            secondButton
        );
    }

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
        (portsPlaybackActive
            ? portsIsWatched(resumeState.videoId)
            : isWatched(resumeState.videoId))
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
                '.card[data-video-id], .ports-video-item[data-video-id]'
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
                    '.card[data-video-id], .ports-video-item[data-video-id]'
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

    const portsWidget = target.closest('.ports-widget');

    // Um vídeo pode existir no DOM, porém estar invisível por filtros.
    if (portsWidget && target.hidden) {
        resetPortsFilters();
    }

    if (!portsWidget && target.classList.contains('hidden')) {
        searchQuery = '';
        onlyUnwatched = false;
        saveUnwatchedMode();

        const search = document.getElementById('video-search');
        if (search) {
            search.value = '';
        }

        applyView();

        if (target.classList.contains('hidden')) {
            setStatus(
                'Esse vídeo está oculto por um canal pulado hoje. '
                + 'Restaure o canal para retomar.'
            );
            return;
        }
    }

    if (portsWidget && portsCollapsed) {
        portsCollapsed = false;

        try {
            localStorage.setItem(PORTS_COLLAPSED_KEY, '0');
        }
        catch (_) {}

        applyPortsCollapse();
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
        behavior: typeof prefersReducedMotion === 'function'
            && prefersReducedMotion() ? 'auto' : 'smooth',
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
                !videoMatchesSearch(video)
                ||
                (
                    typeof shouldHideVideoForFeatures
                    === 'function'
                    &&
                    shouldHideVideoForFeatures(
                        video
                    )
                );

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
    if (typeof updateExtraDashboard === 'function') updateExtraDashboard();

    if (
        typeof updateFeatureToolbar
        === 'function'
    ) {
        updateFeatureToolbar();
    }

    if (
        typeof updateChapterProgress
        === 'function'
    ) {
        updateChapterProgress();
    }

    if (
        typeof updateSessionSummary
        === 'function'
    ) {
        updateSessionSummary();
    }

    if (
        typeof updateSmartHeader
        === 'function'
    ) {
        updateSmartHeader();
    }

    if (
        typeof observeAnimatedCards
        === 'function'
    ) {
        observeAnimatedCards(
            document
        );
    }
}


function toggleUnwatchedMode() {
    onlyUnwatched =
        !onlyUnwatched;

    saveUnwatchedMode();

    runAnimatedViewUpdate(
        applyView
    );
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

    const shouldMinimize =
        shouldFloat
        &&
        miniPlayerCollapsed;

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
        shouldMinimize
    );

    updateMiniPlayerButton();
}


let miniPlayerFrame = null;


function scheduleMiniPlayerUpdate() {
    if (miniPlayerFrame !== null) {
        return;
    }

    miniPlayerFrame =
        requestAnimationFrame(
            () => {
                miniPlayerFrame = null;
                updateMiniPlayer();
            }
        );
}


window.addEventListener(
    'scroll',
    scheduleMiniPlayerUpdate,
    {passive: true}
);

window.addEventListener(
    'resize',
    scheduleMiniPlayerUpdate
);
