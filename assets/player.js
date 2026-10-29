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
        !activePlaylist.length
        &&
        !CURRENT_EMBEDDABLE_IDS.length
        &&
        !PORTS_VIDEOS.some(video => video.embeddable)
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
        CURRENT_EMBEDDABLE_IDS[0]
        ||
        (PORTS_VIDEOS.find(video => video.embeddable) || {}).id;

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
                        applyPreferredSpeed();

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
                                portsPlaybackActive
                                ? 'Ponto salvo no painel de portes. Use Play para continuar.'
                                : 'Ponto anterior carregado. Clique em “Começar jornal” para continuar.'
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

                        if (event.data === YT.PlayerState.PLAYING) {
                            dismissPlaybackError();
                            applyPreferredSpeed();
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

                        handleEnhancedPlaybackError();
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

    const outgoingId =
        currentVideoId();

    if (
        outgoingId
        &&
        activePlaylist[index]
        &&
        outgoingId !== activePlaylist[index]
        &&
        activePlayerSource === (portsPlaybackActive ? 'ports' : 'journal')
    ) {
        saveResume(
            outgoingId,
            currentTime()
        );
    }

    i = index;
    activePlayerSource = portsPlaybackActive ? 'ports' : 'journal';

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

    dismissPlaybackError();
    player.loadVideoById({
        videoId: id,
        startSeconds: resolvedStart
    });
    applyPreferredSpeed();

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
    setPortsPlaybackMode(false);
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

    // O vídeo atual pode ficar fora dos filtros sem interromper a reprodução.
    // Nesse caso, avançar entra na primeira posição da nova seleção.
    if (portsPlaybackActive && !queue.includes(currentId)) {
        return direction > 0 ? (queue[0] || null) : null;
    }

    const catalog = portsPlaybackActive ? PORTS_VIDEOS : VIDEOS;

    const currentIndex =
        catalog.findIndex(
            video => video.id === currentId
        );

    if (currentIndex >= 0) {
        const allowed =
            new Set(queue);

        for (
            let index = currentIndex + direction;
            index >= 0 && index < catalog.length;
            index += direction
        ) {
            const candidate =
                catalog[index].id;

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

    markWatched(current, portsPlaybackActive ? 'ports' : 'journal');

    if (!portsPlaybackActive && typeof handleVideoWatched === 'function') {
        handleVideoWatched(current);
    }

    clearResume(current);
    applyView();

    animateWatchedFeedback(
        current
    );

    if (!portsPlaybackActive) {
        animateJournalProgressCompletion();
    }

    if (portsPlaybackActive) {
        updatePortsVideoUI();
        showUndoToast('Vídeo de portes concluído.', () => {
            delete portsWatched[current];
            savePortsWatched();
            updatePortsVideoUI();
        });
    }
    else if (typeof offerUndoWatched === 'function') {
        offerUndoWatched(current, undoSnapshot);
    }

    if (!portsPlaybackActive) {
        maybeCelebrateJournalCompletion();
    }

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
let fullscreenNextHoldKeyboard = false;


function markCurrentWatchedAndNext() {
    completeCurrentAndAdvance(
        currentVideoId()
    );
}


// Uma única contagem central é compartilhada pelos dois controles.
let fullscreenHoldCountdownOwner = null;


function claimFullscreenHoldCountdown(owner) {
    if (
        fullscreenHoldCountdownOwner !== null
        &&
        fullscreenHoldCountdownOwner !== owner
    ) {
        return false;
    }

    fullscreenHoldCountdownOwner = owner;
    return true;
}


function hideFullscreenHoldCountdown(owner) {
    if (fullscreenHoldCountdownOwner !== owner) {
        return;
    }

    fullscreenHoldCountdownOwner = null;

    const countdown =
        document.getElementById(
            'fullscreen-hold-countdown'
        );

    const number =
        document.getElementById(
            'fullscreen-hold-countdown-number'
        );

    if (countdown) {
        countdown.classList.remove('show');
    }

    if (number) {
        number.textContent = '3';
        number.classList.remove('tick');
    }
}


function showFullscreenHoldCountdown(owner, duration, elapsed) {
    if (fullscreenHoldCountdownOwner !== owner) {
        return;
    }

    const countdown =
        document.getElementById(
            'fullscreen-hold-countdown'
        );

    const number =
        document.getElementById(
            'fullscreen-hold-countdown-number'
        );

    if (countdown) {
        countdown.classList.add('show');
    }

    if (!number) {
        return;
    }

    const remaining =
        Math.max(
            1,
            Math.ceil(
                (duration - elapsed) / 1000
            )
        );

    const nextText = String(remaining);

    if (number.textContent === nextText) {
        return;
    }

    number.textContent = nextText;

    if (
        !prefersReducedMotion()
        &&
        typeof number.animate === 'function'
    ) {
        number.animate(
            [
                {
                    transform: 'scale(1.18)',
                    opacity: .72
                },
                {
                    transform: 'scale(1)',
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


function resetFullscreenNextHoldVisual() {
    const button =
        document.getElementById(
            'fullscreen-next'
        );

    if (button) {
        button.classList.remove(
            'holding',
            'hold-confirmed'
        );

        button.style.setProperty(
            '--hold-scale',
            '0'
        );
    }

    hideFullscreenHoldCountdown('next');
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
    fullscreenNextHoldKeyboard = false;

    resetFullscreenNextHoldVisual();
}


function updateFullscreenNextHoldProgress() {
    const button =
        document.getElementById(
            'fullscreen-next'
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
        String(progress)
    );

    showFullscreenHoldCountdown(
        'next',
        FULLSCREEN_NEXT_HOLD_MS,
        elapsed
    );

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
        !ready
        ||
        !player
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

    // Pressões simultâneas não reiniciam a contagem atual.
    if (fullscreenNextHoldStartedAt || fullscreenNextHoldTriggered) {
        return;
    }

    if (!claimFullscreenHoldCountdown('next')) {
        return;
    }

    event.preventDefault();

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

    if (event.pointerId !== null && event.pointerId !== undefined) {
        try {
            button.setPointerCapture(
                event.pointerId
            );
        }
        catch (_) {}
    }

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

                button.classList.add(
                    'hold-confirmed'
                );

                hideFullscreenHoldCountdown('next');

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
        fullscreenNextHoldKeyboard
        ||
        fullscreenNextHoldPointerId === null
        ||
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
        'keydown',
        event => {
            if (
                event.repeat
                ||
                (event.key !== ' ' && event.key !== 'Enter')
                ||
                fullscreenNextHoldStartedAt
            ) {
                return;
            }

            event.preventDefault();
            beginFullscreenNextHold({
                pointerType: 'keyboard',
                pointerId: null,
                clientX: 0,
                clientY: 0,
                preventDefault() {}
            });

            fullscreenNextHoldKeyboard =
                fullscreenNextHoldStartedAt > 0;
        }
    );

    button.addEventListener(
        'keyup',
        event => {
            if (
                fullscreenNextHoldKeyboard
                &&
                (event.key === ' ' || event.key === 'Enter')
            ) {
                event.preventDefault();
                if (!fullscreenNextHoldTriggered) {
                    cancelFullscreenNextHold();
                }
            }
        }
    );

    button.addEventListener(
        'lostpointercapture',
        () => {
            if (
                !fullscreenNextHoldKeyboard
                &&
                fullscreenNextHoldStartedAt
                &&
                !fullscreenNextHoldTriggered
            ) {
                cancelFullscreenNextHold();
            }
        }
    );

    button.addEventListener('blur', () => {
        if (!fullscreenNextHoldTriggered) {
            cancelFullscreenNextHold();
        }
    });

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


// Avanço de 30 s: controle independente do botão de concluir vídeo.
const FULLSCREEN_SEEK_HOLD_MS = 2000;
const FULLSCREEN_SEEK_MOVE_TOLERANCE = 22;


function initFullscreenSeekForwardHold() {
    const button =
        document.getElementById(
            'fullscreen-seek-forward'
        );

    if (!button) {
        return;
    }

    let timer = null;
    let frame = null;
    let successTimer = null;
    let startedAt = 0;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let active = false;
    let triggered = false;
    let keyboardHold = false;

    function cancelHold() {
        if (timer !== null) {
            clearTimeout(timer);
        }

        if (frame !== null) {
            cancelAnimationFrame(frame);
        }

        if (successTimer !== null) {
            clearTimeout(successTimer);
        }

        timer = null;
        frame = null;
        successTimer = null;
        startedAt = 0;
        pointerId = null;
        active = false;
        triggered = false;
        keyboardHold = false;

        button.classList.remove(
            'holding',
            'seek-confirmed'
        );

        button.style.setProperty(
            '--hold-scale',
            '0'
        );

        hideFullscreenHoldCountdown('seek');
    }

    function showHoldProgress() {
        if (!active || triggered) {
            return;
        }

        const elapsed =
            performance.now() - startedAt;

        const progress =
            Math.min(
                1,
                elapsed / FULLSCREEN_SEEK_HOLD_MS
            );

        button.style.setProperty(
            '--hold-scale',
            String(progress)
        );

        showFullscreenHoldCountdown(
            'seek',
            FULLSCREEN_SEEK_HOLD_MS,
            elapsed
        );

        if (progress < 1) {
            frame = requestAnimationFrame(
                showHoldProgress
            );
        }
    }

    function beginHold() {
        if (
            !isJournalFullscreen()
            ||
            !ready
            ||
            !player
            ||
            active
            ||
            triggered
        ) {
            return false;
        }

        if (!claimFullscreenHoldCountdown('seek')) {
            return false;
        }

        active = true;
        startedAt = performance.now();

        button.classList.add('holding');
        showHoldProgress();

        timer = setTimeout(
            () => {
                if (
                    !active
                    ||
                    !isJournalFullscreen()
                    ||
                    !ready
                    ||
                    !player
                ) {
                    cancelHold();
                    return;
                }

                triggered = true;
                timer = null;

                if (frame !== null) {
                    cancelAnimationFrame(frame);
                    frame = null;
                }

                button.classList.remove('holding');
                button.classList.add('seek-confirmed');
                button.style.setProperty(
                    '--hold-scale',
                    '1'
                );

                hideFullscreenHoldCountdown('seek');

                // Busca temporal somente: não marca como visto.
                seekBy(30);

                successTimer = setTimeout(
                    cancelHold,
                    350
                );
            },
            FULLSCREEN_SEEK_HOLD_MS
        );

        return true;
    }

    button.addEventListener(
        'pointerdown',
        event => {
            if (
                event.pointerType === 'mouse'
                &&
                event.button !== 0
            ) {
                return;
            }

            if (!beginHold()) {
                return;
            }

            event.preventDefault();
            pointerId = event.pointerId;
            startX = event.clientX;
            startY = event.clientY;

            try {
                button.setPointerCapture(
                    event.pointerId
                );
            }
            catch (_) {}
        }
    );

    button.addEventListener(
        'pointermove',
        event => {
            if (
                !active
                ||
                triggered
                ||
                pointerId !== event.pointerId
            ) {
                return;
            }

            if (
                Math.hypot(
                    event.clientX - startX,
                    event.clientY - startY
                ) > FULLSCREEN_SEEK_MOVE_TOLERANCE
            ) {
                cancelHold();
            }
        }
    );

    button.addEventListener(
        'pointerup',
        event => {
            if (
                pointerId === event.pointerId
                &&
                !triggered
            ) {
                cancelHold();
            }
        }
    );

    button.addEventListener(
        'pointercancel',
        event => {
            if (pointerId === event.pointerId) {
                cancelHold();
            }
        }
    );

    button.addEventListener(
        'lostpointercapture',
        () => {
            if (active && !triggered && !keyboardHold) {
                cancelHold();
            }
        }
    );

    button.addEventListener(
        'keydown',
        event => {
            if (
                event.repeat
                ||
                (
                    event.key !== ' '
                    &&
                    event.key !== 'Enter'
                )
            ) {
                return;
            }

            event.preventDefault();

            if (!active && beginHold()) {
                keyboardHold = true;
            }
        }
    );

    button.addEventListener(
        'keyup',
        event => {
            if (
                keyboardHold
                &&
                (event.key === ' ' || event.key === 'Enter')
            ) {
                event.preventDefault();

                if (!triggered) {
                    cancelHold();
                }
            }
        }
    );

    button.addEventListener('blur', cancelHold);
    button.addEventListener(
        'contextmenu',
        event => event.preventDefault()
    );
    button.addEventListener(
        'click',
        event => event.preventDefault()
    );

    // Sair da tela cheia cancela qualquer pressão pendente.
    document.addEventListener(
        'fullscreenchange',
        cancelHold
    );
    document.addEventListener(
        'webkitfullscreenchange',
        cancelHold
    );
}


initFullscreenSeekForwardHold();


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


function openPortsVideo(id) {
    const video = PORTS_VIDEOS.find(item => item.id === id);

    if (!video) {
        return;
    }

    if (video.embeddable === false) {
        window.open(
            'https://www.youtube.com/watch?v=' + encodeURIComponent(id),
            '_blank',
            'noopener'
        );
        return;
    }

    openVideo(id, 'ports');
}


function openVideo(id, source = 'journal') {
    const video =
        metadataForVideo(id);

    if (!video) {
        return;
    }

    // Arquivar o vídeo anterior no histórico de origem antes de mudar
    // de painel, sem contaminar retomadas por IDs compartilhados.
    const incomingPorts = source === 'ports';
    const leavingId = currentVideoId();
    if (ready && leavingId && incomingPorts !== portsPlaybackActive) {
        saveResume(leavingId, currentTime());
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

    setPortsPlaybackMode(incomingPorts);
    rebuildPlaylist();

    let index =
        activePlaylist.indexOf(id);

    if (index < 0 && portsPlaybackActive) {
        // Vídeo salvo fora dos filtros: habilitar o catálogo completo.
        resetPortsFilters();
        index = activePlaylist.indexOf(id);
    }

    if (index < 0 && !portsPlaybackActive) {
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

    if (index < 0 && !portsPlaybackActive && isWatched(id)) {
        // Abrir um visto não deve falhar por ele estar fora da fila
        // automática, que continua priorizando vídeos pendentes.
        activePlaylist = [id, ...activePlaylist.filter(item => item !== id)];
        index = 0;
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
            behavior: typeof prefersReducedMotion === 'function'
                && prefersReducedMotion() ? 'auto' : 'smooth'
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
