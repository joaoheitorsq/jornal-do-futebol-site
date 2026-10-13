function setPlayerLoading(isLoading) {
    const loading =
        document.getElementById(
            'player-loading'
        );

    if (!loading) {
        return;
    }

    loading.classList.toggle(
        'show',
        Boolean(isLoading)
    );

    const wrap =
        document.getElementById(
            'playerwrap'
        );

    if (wrap) {
        wrap.classList.toggle(
            'switching-video',
            Boolean(isLoading)
        );
    }

    loading.setAttribute(
        'aria-hidden',
        isLoading
        ? 'false'
        : 'true'
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
        setPlayerLoading(false);
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
                        setPlayerLoading(false);
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
                            event.data
                            ===
                            YT.PlayerState.BUFFERING
                        ) {
                            setPlayerLoading(true);
                        }
                        else if (
                            event.data
                            === YT.PlayerState.PLAYING
                            ||
                            event.data
                            === YT.PlayerState.PAUSED
                            ||
                            event.data
                            === YT.PlayerState.CUED
                            ||
                            event.data
                            === YT.PlayerState.ENDED
                        ) {
                            setPlayerLoading(false);
                        }

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
                        setPlayerLoading(false);
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
    startSeconds = null
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

    const resolvedStart =
        startSeconds === null
        &&
        typeof getResumeSeconds
        === 'function'
        ? getResumeSeconds(id)
        : Math.max(
            0,
            Number(
                startSeconds || 0
            )
        );

    setPlayerLoading(true);

    player.loadVideoById({
        videoId: id,
        startSeconds:
            resolvedStart
    });

    showCurrentCard(id);

    saveResume(
        id,
        resolvedStart
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

    const undoSnapshot =
        typeof captureWatchedUndoState
        === 'function'
        ? captureWatchedUndoState(
            current
        )
        : null;

    markWatched(current);

    if (
        typeof handleVideoWatched
        === 'function'
    ) {
        handleVideoWatched(
            current
        );
    }

    clearResume(current);
    applyView();

    animateWatchedFeedback(
        current
    );

    animateJournalProgressCompletion();

    if (
        typeof offerUndoWatched
        === 'function'
    ) {
        offerUndoWatched(
            current,
            undoSnapshot
        );
    }

    maybeCelebrateJournalCompletion();

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
            '--hold-scale',
            '0'
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
        '--hold-scale',
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

            if (
                !prefersReducedMotion()
                &&
                typeof countdownNumber.animate
                === 'function'
            ) {
                countdownNumber.animate(
                    [
                        {
                            transform:
                                'scale(1.18)',
                            opacity: .72
                        },
                        {
                            transform:
                                'scale(1)',
                            opacity: .96
                        }
                    ],
                    {
                        duration: 180,
                        easing: 'ease-out'
                    }
                );
            }
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
                    '--hold-scale',
                    '1'
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
        play(
            index,
            typeof getResumeSeconds
            === 'function'
            ? getResumeSeconds(id)
            : 0
        );

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
