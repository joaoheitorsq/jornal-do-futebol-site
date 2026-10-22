function defaultFeatureState() {
    return {
        resumePositions: {},
        deferredByDay: {},
        finishLater: {},
        skippedChannelsByDay: {}
    };
}


function currentJournalKey() {
    return (
        document.body.dataset.journalDate
        ||
        new Date().toISOString().slice(0, 10)
    );
}


function loadFeatureState() {
    const fallback =
        defaultFeatureState();

    try {
        const raw =
            localStorage.getItem(
                FEATURE_STATE_KEY
            );

        if (!raw) {
            return fallback;
        }

        const data =
            JSON.parse(raw);

        if (
            !data
            ||
            typeof data !== 'object'
        ) {
            return fallback;
        }

        return {
            resumePositions:
                data.resumePositions
                &&
                typeof data.resumePositions
                === 'object'
                ? data.resumePositions
                : {},
            deferredByDay:
                data.deferredByDay
                &&
                typeof data.deferredByDay
                === 'object'
                ? data.deferredByDay
                : {},
            finishLater:
                data.finishLater
                &&
                typeof data.finishLater
                === 'object'
                ? data.finishLater
                : {},
            skippedChannelsByDay:
                data.skippedChannelsByDay
                &&
                typeof data.skippedChannelsByDay
                === 'object'
                ? data.skippedChannelsByDay
                : {}
        };
    }
    catch (_) {
        return fallback;
    }
}


function saveFeatureState() {
    try {
        localStorage.setItem(
            FEATURE_STATE_KEY,
            JSON.stringify(
                featureState
                ||
                defaultFeatureState()
            )
        );
    }
    catch (_) {}
}


function loadManualQueue() {
    try {
        const raw =
            sessionStorage.getItem(
                MANUAL_QUEUE_SESSION_KEY
            );

        if (!raw) {
            return [];
        }

        const data =
            JSON.parse(raw);

        return Array.isArray(data)
            ? data.map(String)
            : [];
    }
    catch (_) {
        return [];
    }
}


function saveManualQueue() {
    try {
        sessionStorage.setItem(
            MANUAL_QUEUE_SESSION_KEY,
            JSON.stringify(manualQueue)
        );
    }
    catch (_) {}
}


function uniqueIds(values) {
    const seen =
        new Set();

    return (
        Array.isArray(values)
        ? values
        : []
    )
        .map(String)
        .filter(value => {
            if (
                !value
                ||
                seen.has(value)
            ) {
                return false;
            }

            seen.add(value);
            return true;
        });
}


function deferredIdsToday() {
    if (!featureState) {
        return [];
    }

    const key =
        currentJournalKey();

    return uniqueIds(
        featureState
            .deferredByDay[key]
    );
}


function setDeferredIdsToday(ids) {
    const key =
        currentJournalKey();

    featureState.deferredByDay[key] =
        uniqueIds(ids);

    saveFeatureState();
}


function skippedChannelsToday() {
    if (!featureState) {
        return [];
    }

    const key =
        currentJournalKey();

    return uniqueIds(
        featureState
            .skippedChannelsByDay[key]
    );
}


function setSkippedChannelsToday(channels) {
    const key =
        currentJournalKey();

    featureState
        .skippedChannelsByDay[key] =
        uniqueIds(channels);

    saveFeatureState();
}


function videoIdentityMeta(videoId) {
    const current =
        VIDEOS.find(
            video =>
                video.id === videoId
        );

    if (current) {
        return current;
    }

    if (
        featureState
        &&
        featureState.finishLater[
            videoId
        ]
    ) {
        return featureState.finishLater[
            videoId
        ];
    }

    if (
        resumeState
        &&
        resumeState.videoId
        === videoId
    ) {
        return resumeState;
    }

    return null;
}


function featureVideoMeta(videoId) {
    return videoIdentityMeta(
        videoId
    );
}


function getResumePosition(videoId) {
    if (
        !featureState
        ||
        !videoId
    ) {
        return null;
    }

    const value =
        featureState.resumePositions[
            videoId
        ];

    return (
        value
        &&
        typeof value === 'object'
    )
        ? value
        : null;
}


function getResumeSeconds(videoId) {
    const value =
        getResumePosition(
            videoId
        );

    if (!value) {
        return 0;
    }

    return Math.max(
        0,
        Number(
            value.seconds
            || 0
        )
    );
}


function saveResumePosition(
    videoId,
    data
) {
    if (
        !featureState
        ||
        !videoId
        ||
        !data
    ) {
        return;
    }

    featureState.resumePositions[
        videoId
    ] = {
        ...data,
        videoId:
            String(videoId),
        seconds:
            Math.max(
                0,
                Number(
                    data.seconds
                    || 0
                )
            ),
        savedAt:
            Number(
                data.savedAt
                || Date.now()
            )
    };

    saveFeatureState();
}


function removeResumePosition(videoId) {
    if (
        !featureState
        ||
        !videoId
    ) {
        return;
    }

    delete featureState
        .resumePositions[
            videoId
        ];

    saveFeatureState();
}


function shouldHideVideoForFeatures(
    video
) {
    if (!video) {
        return false;
    }

    // O canal pulado só oculta vídeos normais confirmados.
    // Shorts e uploads de tipo desconhecido continuam disponíveis.
    return video.isShort === false
        &&
        skippedChannelsToday()
            .includes(
                String(
                    video.channelTitle
                    || ''
                )
            );
}


function isDeferred(videoId) {
    return deferredIdsToday()
        .includes(
            String(videoId)
        );
}


function isInManualQueue(videoId) {
    return manualQueue.includes(
        String(videoId)
    );
}


function isFinishLater(videoId) {
    return Boolean(
        featureState
        &&
        featureState.finishLater[
            videoId
        ]
    );
}


function finishLaterItems() {
    if (!featureState) {
        return [];
    }

    return Object
        .values(
            featureState.finishLater
        )
        .filter(item =>
            item
            &&
            item.videoId
            &&
            !isWatched(
                item.videoId
            )
        )
        .sort(
            (a, b) =>
                Number(
                    a.savedAt || 0
                )
                -
                Number(
                    b.savedAt || 0
                )
        );
}


function orderPlaylistWithFeatures(
    baseIds
) {
    const base =
        uniqueIds(baseIds)
        .filter(id =>
            !isWatched(id)
        );

    const carryover =
        finishLaterItems()
        .filter(item =>
            item.embeddable !== false
            &&
            !VIDEOS.some(
                video =>
                    video.id
                    === item.videoId
            )
        )
        .map(item =>
            String(item.videoId)
        )
        .filter(id =>
            !base.includes(id)
        );

    if (
        resumeState
        &&
        resumeOutsideCurrentJournal()
        &&
        resumeState.embeddable !== false
        &&
        !isWatched(
            resumeState.videoId
        )
        &&
        !carryover.includes(
            resumeState.videoId
        )
        &&
        !base.includes(
            resumeState.videoId
        )
    ) {
        carryover.unshift(
            resumeState.videoId
        );
    }

    const pool =
        uniqueIds([
            ...carryover,
            ...base
        ]);

    const manual =
        manualQueue
        .filter(id =>
            pool.includes(id)
            &&
            !isWatched(id)
        );

    const deferred =
        deferredIdsToday();

    const regular =
        pool.filter(id =>
            !manual.includes(id)
            &&
            !deferred.includes(id)
        );

    const later =
        pool.filter(id =>
            !manual.includes(id)
            &&
            deferred.includes(id)
        );

    return uniqueIds([
        ...manual,
        ...regular,
        ...later
    ]);
}


function toggleDeferred(videoId) {
    const id =
        String(videoId || '');

    if (!id) {
        return;
    }

    let ids =
        deferredIdsToday();

    const adding =
        !ids.includes(id);

    if (adding) {
        ids.push(id);
    }
    else {
        ids =
            ids.filter(
                value =>
                    value !== id
            );
    }

    setDeferredIdsToday(ids);
    applyView();

    showUndoToast(
        adding
        ? 'Vídeo enviado para o fim da fila.'
        : 'Vídeo voltou à ordem normal.',
        () => {
            toggleDeferred(id);
        }
    );
}


function toggleManualQueue(videoId) {
    const id =
        String(videoId || '');

    if (!id) {
        return;
    }

    const adding =
        !manualQueue.includes(id);

    if (adding) {
        manualQueue.push(id);
    }
    else {
        manualQueue =
            manualQueue.filter(
                value =>
                    value !== id
            );
    }

    manualQueue =
        uniqueIds(manualQueue);

    saveManualQueue();
    applyView();

    showUndoToast(
        adding
        ? 'Vídeo adicionado à fila desta sessão.'
        : 'Vídeo removido da fila manual.',
        () => {
            toggleManualQueue(id);
        }
    );
}


function clearManualQueue() {
    const previous =
        [...manualQueue];

    manualQueue = [];
    saveManualQueue();
    applyView();

    showUndoToast(
        'Fila manual limpa.',
        () => {
            manualQueue =
                previous;

            saveManualQueue();
            applyView();
        }
    );
}


function metadataSnapshot(videoId) {
    const video =
        videoIdentityMeta(videoId);

    if (!video) {
        return null;
    }

    return {
        videoId:
            String(videoId),
        id:
            String(videoId),
        title:
            String(
                video.title
                || 'Sem título'
            ),
        channelTitle:
            String(
                video.channelTitle
                || ''
            ),
        channelHandle:
            String(
                video.channelHandle
                || ''
            ),
        duration:
            Math.max(
                0,
                Number(
                    video.duration
                    || 0
                )
            ),
        countForTime:
            video.countForTime
            !== false,
        isShort:
            video.isShort === true
            ? true
            : video.isShort === false
                ? false
                : null,
        embeddable:
            video.embeddable
            !== false,
        savedAt:
            Date.now()
    };
}


function toggleFinishLater(videoId) {
    const id =
        String(videoId || '');

    if (!id) {
        return;
    }

    const previous =
        featureState.finishLater[id]
        || null;

    if (previous) {
        delete featureState
            .finishLater[id];

        saveFeatureState();
        applyView();

        showUndoToast(
            'Vídeo removido de “Terminar depois”.',
            () => {
                featureState.finishLater[id] =
                    previous;

                saveFeatureState();
                applyView();
            }
        );

        return;
    }

    const snapshot =
        metadataSnapshot(id);

    if (!snapshot) {
        return;
    }

    const position =
        getResumePosition(id);

    if (position) {
        snapshot.seconds =
            position.seconds;
    }

    featureState.finishLater[id] =
        snapshot;

    saveFeatureState();
    applyView();

    showUndoToast(
        'Vídeo será preservado até você terminar.',
        () => {
            delete featureState
                .finishLater[id];

            saveFeatureState();
            applyView();
        }
    );
}


function skipChannelToday(
    channelTitle
) {
    const channel =
        String(
            channelTitle
            || ''
        );

    if (!channel) {
        return;
    }

    let channels =
        skippedChannelsToday();

    if (
        channels.includes(channel)
    ) {
        return;
    }

    channels.push(channel);
    setSkippedChannelsToday(
        channels
    );

    applyView();
    maybeCelebrateJournalCompletion();

    showUndoToast(
        'Vídeos normais de '
        + channel
        + ' ocultados nesta edição; Shorts preservados.',
        () => {
            setSkippedChannelsToday(
                skippedChannelsToday()
                .filter(
                    value =>
                        value !== channel
                )
            );

            applyView();
            maybeCelebrateJournalCompletion();
        }
    );
}


function restoreSkippedChannels() {
    const previous =
        skippedChannelsToday();

    if (!previous.length) {
        return;
    }

    setSkippedChannelsToday([]);
    applyView();
    maybeCelebrateJournalCompletion();

    showUndoToast(
        'Canais ocultados foram restaurados.',
        () => {
            setSkippedChannelsToday(
                previous
            );

            applyView();
        }
    );
}


function captureWatchedUndoState(
    videoId
) {
    const id =
        String(videoId || '');

    return {
        videoId: id,
        resumePosition:
            getResumePosition(id)
            ? {
                ...getResumePosition(id)
            }
            : null,
        finishLater:
            featureState
            &&
            featureState
                .finishLater[id]
            ? {
                ...featureState
                    .finishLater[id]
            }
            : null,
        deferred:
            isDeferred(id),
        manual:
            isInManualQueue(id)
    };
}


function handleVideoWatched(videoId) {
    const id =
        String(videoId || '');

    if (!id) {
        return;
    }

    removeResumePosition(id);

    if (
        featureState
        &&
        featureState.finishLater[id]
    ) {
        delete featureState
            .finishLater[id];
    }

    setDeferredIdsToday(
        deferredIdsToday()
        .filter(
            value =>
                value !== id
        )
    );

    manualQueue =
        manualQueue.filter(
            value =>
                value !== id
        );

    saveManualQueue();
    saveFeatureState();
}


function offerUndoWatched(
    videoId,
    snapshot
) {
    const id =
        String(videoId || '');

    showUndoToast(
        'Vídeo marcado como visto.',
        () => {
            delete watched[id];
            saveWatched();

            if (
                snapshot
                &&
                snapshot.resumePosition
            ) {
                featureState
                    .resumePositions[id] =
                    snapshot.resumePosition;
            }

            if (
                snapshot
                &&
                snapshot.finishLater
            ) {
                featureState
                    .finishLater[id] =
                    snapshot.finishLater;
            }

            if (
                snapshot
                &&
                snapshot.deferred
            ) {
                setDeferredIdsToday([
                    ...deferredIdsToday(),
                    id
                ]);
            }

            if (
                snapshot
                &&
                snapshot.manual
                &&
                !manualQueue.includes(id)
            ) {
                manualQueue.push(id);
                saveManualQueue();
            }

            saveFeatureState();
            applyView();
            maybeCelebrateJournalCompletion();

            setStatus(
                'Ação desfeita: vídeo voltou a não visto.'
            );
        }
    );
}


let undoTimer = null;


function showUndoToast(
    message,
    callback
) {
    const toast =
        document.getElementById(
            'undo-toast'
        );

    const text =
        document.getElementById(
            'undo-toast-text'
        );

    const button =
        document.getElementById(
            'undo-toast-button'
        );

    if (
        !toast
        ||
        !text
        ||
        !button
    ) {
        return;
    }

    if (undoTimer) {
        clearTimeout(
            undoTimer
        );
    }

    undoAction =
        typeof callback
        === 'function'
        ? callback
        : null;

    text.textContent =
        String(message || '');

    toast.classList.add(
        'show'
    );

    button.hidden =
        !undoAction;

    undoTimer =
        setTimeout(
            dismissUndoToast,
            5200
        );
}


function dismissUndoToast() {
    const toast =
        document.getElementById(
            'undo-toast'
        );

    if (toast) {
        toast.classList.remove(
            'show'
        );
    }

    undoAction = null;

    if (undoTimer) {
        clearTimeout(
            undoTimer
        );

        undoTimer = null;
    }
}


function performUndo() {
    const action =
        undoAction;

    dismissUndoToast();

    if (action) {
        action();
    }
}


function cardProgressRatio(videoId) {
    if (isWatched(videoId)) {
        return 1;
    }

    const meta =
        videoIdentityMeta(
            videoId
        );

    const position =
        getResumePosition(
            videoId
        );

    const duration =
        Math.max(
            0,
            Number(
                meta
                &&
                meta.duration
                || 0
            )
        );

    if (
        !position
        ||
        !duration
    ) {
        return 0;
    }

    return Math.max(
        0,
        Math.min(
            1,
            Number(
                position.seconds
                || 0
            )
            /
            duration
        )
    );
}


function createWatchedCheck() {
    const badge =
        document.createElement(
            'span'
        );

    badge.className =
        'watched-check';

    badge.setAttribute(
        'aria-hidden',
        'true'
    );

    badge.innerHTML =
        '<svg viewBox="0 0 28 28" focusable="false">'
        + '<circle cx="14" cy="14" r="12"></circle>'
        + '<path d="M8.5 14.2l3.4 3.5 7.8-8"></path>'
        + '</svg>';

    return badge;
}


function ensureCardFeatureUI(card) {
    if (
        !card
        ||
        !card.dataset.videoId
    ) {
        return;
    }

    const videoId =
        card.dataset.videoId;

    const thumb =
        card.querySelector(
            '.thumbbox'
        );

    if (
        thumb
        &&
        !thumb.querySelector(
            '.thumb-progress'
        )
    ) {
        const progress =
            document.createElement(
                'span'
            );

        progress.className =
            'thumb-progress';

        progress.innerHTML =
            '<span></span>';

        thumb.appendChild(
            progress
        );
    }

    if (
        thumb
        &&
        !thumb.querySelector(
            '.watched-check'
        )
    ) {
        thumb.appendChild(
            createWatchedCheck()
        );
    }

    let actions =
        card.querySelector(
            '.card-feature-actions'
        );

    if (!actions) {
        actions =
            document.createElement(
                'div'
            );

        actions.className =
            'card-feature-actions';

        const queue =
            document.createElement(
                'button'
            );

        queue.type =
            'button';

        queue.className =
            'feature-action queue-action';

        queue.onclick =
            event => {
                event.stopPropagation();
                toggleManualQueue(
                    videoId
                );
            };

        const defer =
            document.createElement(
                'button'
            );

        defer.type =
            'button';

        defer.className =
            'feature-action defer-action';

        defer.onclick =
            event => {
                event.stopPropagation();
                toggleDeferred(
                    videoId
                );
            };

        const finish =
            document.createElement(
                'button'
            );

        finish.type =
            'button';

        finish.className =
            'feature-action finish-action';

        finish.onclick =
            event => {
                event.stopPropagation();
                toggleFinishLater(
                    videoId
                );
            };

        const skip =
            document.createElement(
                'button'
            );

        skip.type =
            'button';

        skip.className =
            'feature-action skip-channel-action';

        skip.onclick =
            event => {
                event.stopPropagation();

                const meta =
                    videoIdentityMeta(
                        videoId
                    );

                if (
                    meta
                    &&
                    meta.isShort === false
                ) {
                    skipChannelToday(
                        meta.channelTitle
                    );
                }
            };

        actions.append(
            queue,
            defer,
            finish,
            skip
        );

        const watch =
            card.querySelector(
                '.watch-action'
            );

        if (watch) {
            card.insertBefore(
                actions,
                watch
            );
        }
        else {
            card.appendChild(
                actions
            );
        }
    }
}


function featureActionIcon(
    type,
    active = false
) {
    if (type === 'defer') {
        return (
            '<svg class="feature-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
            + '<circle cx="12" cy="12" r="8.2"></circle>'
            + '<path d="M12 7.5v5l3.4 2"></path>'
            + (
                active
                ? '<path class="feature-action-confirm" d="M17.2 5.5l1.5 1.5 2.7-3"></path>'
                : ''
            )
            + '</svg>'
        );
    }

    return (
        '<svg class="feature-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
        + '<path d="M7.2 4.2h9.6a1.7 1.7 0 0 1 1.7 1.7v14l-6.5-4-6.5 4v-14a1.7 1.7 0 0 1 1.7-1.7z"></path>'
        + (
            active
            ? '<path class="feature-action-confirm" d="M9 9.8l2 2 4-4"></path>'
            : ''
        )
        + '</svg>'
    );
}


function setFeatureIconButton(
    button,
    type,
    active,
    label
) {
    if (!button) {
        return;
    }

    button.classList.add(
        'icon-only'
    );

    button.classList.toggle(
        'active',
        active
    );

    button.setAttribute(
        'aria-label',
        label
    );

    button.setAttribute(
        'aria-pressed',
        active
        ? 'true'
        : 'false'
    );

    button.title = label;

    button.innerHTML =
        featureActionIcon(
            type,
            active
        );
}


function updateCardFeatureUI() {
    document
        .querySelectorAll(
            '.card[data-video-id]'
        )
        .forEach(card => {
            ensureCardFeatureUI(
                card
            );

            const id =
                card.dataset.videoId;

            const ratio =
                cardProgressRatio(
                    id
                );

            card.style.setProperty(
                '--video-progress',
                String(ratio)
            );

            card.classList.toggle(
                'partially-watched',
                ratio > 0
                &&
                ratio < 1
            );

            const queue =
                card.querySelector(
                    '.queue-action'
                );

            const defer =
                card.querySelector(
                    '.defer-action'
                );

            const finish =
                card.querySelector(
                    '.finish-action'
                );

            const skip =
                card.querySelector(
                    '.skip-channel-action'
                );

            if (queue) {
                queue.textContent =
                    isInManualQueue(id)
                    ? '✓ Na fila'
                    : '+ Fila';

                queue.classList.toggle(
                    'active',
                    isInManualQueue(id)
                );
            }

            if (defer) {
                const deferred =
                    isDeferred(id);

                setFeatureIconButton(
                    defer,
                    'defer',
                    deferred,
                    deferred
                    ? 'Remover de Ver depois'
                    : 'Ver depois'
                );
            }

            if (finish) {
                const finishingLater =
                    isFinishLater(id);

                setFeatureIconButton(
                    finish,
                    'finish',
                    finishingLater,
                    finishingLater
                    ? 'Remover de Terminar depois'
                    : 'Terminar depois'
                );
            }

            if (skip) {
                const meta =
                    videoIdentityMeta(id);

                // Não oferecer ação de pular em Shorts.
                skip.hidden =
                    !meta
                    ||
                    meta.isShort !== false;

                skip.textContent =
                    'Pular canal hoje';

                skip.title =
                    'Oculta apenas vídeos normais deste canal; Shorts permanecem.';
            }
        });
}


function updateChapterProgress() {
    document
        .querySelectorAll(
            '.chapter'
        )
        .forEach(chapter => {
            const cards =
                Array.from(
                    chapter.querySelectorAll(
                        '.card[data-video-id]'
                    )
                )
                .filter(card => {
                    const meta =
                        currentVideoMeta(
                            card.dataset.videoId
                        );

                    return (
                        typeof shouldHideVideoForFeatures
                        !== 'function'
                        ||
                        !shouldHideVideoForFeatures(
                            meta
                        )
                    );
                });

            const total =
                cards.length;

            const done =
                cards.filter(card =>
                    isWatched(
                        card.dataset.videoId
                    )
                ).length;

            let progress =
                chapter.querySelector(
                    '.chapter-progress'
                );

            if (!progress) {
                progress =
                    document.createElement(
                        'span'
                    );

                progress.className =
                    'chapter-progress';

                const titleText =
                    chapter.querySelector(
                        '.chapter-title-text'
                    );

                if (titleText) {
                    titleText.appendChild(
                        progress
                    );
                }
            }

            if (progress) {
                progress.innerHTML =
                    '<span class="chapter-progress-count">'
                    + String(done)
                    + '/'
                    + String(total)
                    + '</span>'
                    + (
                        total > 0
                        &&
                        done === total
                        ? '<span class="chapter-done">✓ Concluído</span>'
                        : ''
                    );
            }

            const complete =
                total > 0
                &&
                done === total;

            const wasComplete =
                chapter.dataset.complete
                === '1';

            chapter.classList.toggle(
                'chapter-complete',
                complete
            );

            chapter.dataset.complete =
                complete
                ? '1'
                : '0';

            if (
                complete
                &&
                !wasComplete
                &&
                chapter.dataset.progressReady
                === '1'
                &&
                typeof animateChapterComplete
                === 'function'
            ) {
                animateChapterComplete(
                    chapter
                );
            }

            chapter.dataset.progressReady =
                '1';
        });

    updateCurrentChapterHighlight();
}


function updateCurrentChapterHighlight() {
    document
        .querySelectorAll(
            '.chapter'
        )
        .forEach(chapter => {
            chapter.classList.toggle(
                'current-chapter',
                Boolean(
                    chapter.querySelector(
                        '.card.current'
                    )
                )
            );
        });
}


function createCarryoverCard(item) {
    const article =
        document.createElement(
            'article'
        );

    article.className =
        'card carryover-item';

    article.dataset.videoId =
        item.videoId;

    const open =
        document.createElement(
            'button'
        );

    open.className =
        'card-open';

    open.type =
        'button';

    open.onclick =
        () => openVideo(
            item.videoId
        );

    const thumb =
        document.createElement(
            'div'
        );

    thumb.className =
        'thumbbox';

    const image =
        document.createElement(
            'img'
        );

    image.src =
        'https://i.ytimg.com/vi/'
        + encodeURIComponent(
            item.videoId
        )
        + '/mqdefault.jpg';

    image.alt = '';
    image.loading = 'lazy';

    const resumeBadge =
        document.createElement(
            'span'
        );

    resumeBadge.className =
        'resume-badge';

    resumeBadge.textContent =
        '▶ CONTINUAR AQUI';

    const playingBadge =
        document.createElement(
            'span'
        );

    playingBadge.className =
        'playing-badge';

    playingBadge.textContent =
        '▶ AGORA';

    thumb.append(
        image,
        resumeBadge,
        playingBadge
    );

    const info =
        document.createElement(
            'span'
        );

    info.className =
        'card-info';

    const title =
        document.createElement(
            'b'
        );

    title.textContent =
        item.title
        || 'Vídeo pendente';

    const meta =
        document.createElement(
            'em'
        );

    const seconds =
        getResumeSeconds(
            item.videoId
        )
        ||
        Number(
            item.seconds
            || 0
        );

    meta.textContent =
        (
            item.channelTitle
            ? item.channelTitle
                + ' · '
            : ''
        )
        +
        (
            seconds > 0
            ? 'ponto salvo em '
                + formatTime(
                    seconds
                )
            : 'preservado para terminar depois'
        );

    info.append(
        title,
        meta
    );

    open.append(
        thumb,
        info
    );

    const watch =
        document.createElement(
            'button'
        );

    watch.className =
        'watch-action';

    watch.type =
        'button';

    watch.dataset.videoId =
        item.videoId;

    watch.setAttribute(
        'aria-label',
        'Segure por 2 segundos para alterar o status de assistido'
    );

    watch.textContent =
        'Marcar como visto';

    article.append(
        open,
        watch
    );

    return article;
}


function renderFeatureCarryover() {
    const box =
        document.getElementById(
            'carryover'
        );

    const list =
        document.getElementById(
            'carryover-list'
        );

    if (!box || !list) {
        return;
    }

    const items =
        finishLaterItems()
        .filter(item =>
            !VIDEOS.some(
                video =>
                    video.id
                    === item.videoId
            )
        );

    if (
        resumeState
        &&
        resumeOutsideCurrentJournal()
        &&
        !isWatched(
            resumeState.videoId
        )
        &&
        !items.some(
            item =>
                item.videoId
                === resumeState.videoId
        )
    ) {
        items.unshift({
            ...resumeState,
            id:
                resumeState.videoId
        });
    }

    list.replaceChildren(
        ...items.map(
            createCarryoverCard
        )
    );

    box.classList.toggle(
        'hidden',
        items.length === 0
    );

    updateCardFeatureUI();
}


function updateFeatureToolbar() {
    const summary =
        document.getElementById(
            'manual-queue-summary'
        );

    if (summary) {
        summary.textContent =
            manualQueue.length
            ? 'Fila manual: '
                + String(
                    manualQueue.length
                )
            : 'Fila manual vazia';
    }

    const clear =
        document.getElementById(
            'clear-manual-queue'
        );

    if (clear) {
        clear.disabled =
            manualQueue.length === 0;
    }

    const restore =
        document.getElementById(
            'restore-skipped-channels'
        );

    if (restore) {
        const count =
            skippedChannelsToday()
                .length;

        restore.hidden =
            count === 0;

        restore.textContent =
            count
            ? 'Restaurar '
                + String(count)
                + (
                    count === 1
                    ? ' canal'
                    : ' canais'
                )
            : 'Restaurar canais';
    }
}


function updateSessionSummary() {
    const box =
        document.getElementById(
            'session-summary'
        );

    if (!box) {
        return;
    }

    const today =
        new Date();

    const sameDay =
        value => {
            const date =
                new Date(
                    Number(value || 0)
                );

            return (
                date.getFullYear()
                === today.getFullYear()
                &&
                date.getMonth()
                === today.getMonth()
                &&
                date.getDate()
                === today.getDate()
            );
        };

    let completedToday = 0;
    let watchedSeconds = 0;
    let remainingCount = 0;

    for (const video of VIDEOS) {
        const duration =
            Math.max(
                0,
                Number(
                    video.duration
                    || 0
                )
            );

        if (
            watched[video.id]
            &&
            sameDay(
                watched[video.id]
            )
        ) {
            completedToday++;

            if (
                video.countForTime
                !== false
            ) {
                watchedSeconds +=
                    duration;
            }

            continue;
        }

        if (
            !isWatched(video.id)
            &&
            !shouldHideVideoForFeatures(
                video
            )
        ) {
            remainingCount++;
        }

        const position =
            getResumePosition(
                video.id
            );

        if (
            position
            &&
            sameDay(
                position.savedAt
            )
            &&
            video.countForTime
            !== false
        ) {
            watchedSeconds +=
                Math.min(
                    duration,
                    Math.max(
                        0,
                        Number(
                            position.seconds
                            || 0
                        )
                    )
                );
        }
    }

    box.textContent =
        'Hoje: '
        + String(completedToday)
        + (
            completedToday === 1
            ? ' vídeo concluído'
            : ' vídeos concluídos'
        )
        + ' · '
        + formatDurationHuman(
            watchedSeconds
        )
        + ' assistidos'
        + ' · '
        + String(remainingCount)
        + ' restantes';
}


function updateSmartHeader() {
    const progress =
        document.getElementById(
            'smart-header-progress'
        );

    const remaining =
        document.getElementById(
            'smart-header-remaining'
        );

    const headerProgress =
        document.getElementById(
            'header-progress-count'
        );

    const timeRemaining =
        document.getElementById(
            'time-remaining'
        );

    if (
        progress
        &&
        headerProgress
    ) {
        progress.textContent =
            headerProgress.textContent
                .replace(
                    /\s+/g,
                    ' '
                )
                .trim();
    }

    if (
        remaining
        &&
        timeRemaining
    ) {
        remaining.textContent =
            timeRemaining.textContent
            + ' restantes';
    }
}


function initSmartHeader() {
    const header =
        document.querySelector(
            '.journal-header'
        );

    const smart =
        document.getElementById(
            'smart-header'
        );

    if (
        !header
        ||
        !smart
        ||
        typeof IntersectionObserver
        !== 'function'
    ) {
        return;
    }

    const observer =
        new IntersectionObserver(
            entries => {
                const entry =
                    entries[0];

                const show =
                    !entry.isIntersecting;

                smart.classList.toggle(
                    'show',
                    show
                );

                smart.setAttribute(
                    'aria-hidden',
                    show
                    ? 'false'
                    : 'true'
                );
            },
            {
                threshold: 0
            }
        );

    observer.observe(
        header
    );
}


function exportJournalBackup() {
    const storage = {};

    for (
        let index = 0;
        index < localStorage.length;
        index++
    ) {
        const key =
            localStorage.key(
                index
            );

        if (
            key
            &&
            key.startsWith(
                'jornal_do_futebol_'
            )
        ) {
            storage[key] =
                localStorage.getItem(
                    key
                );
        }
    }

    const payload = {
        format:
            'jornal-do-futebol-backup',
        version: 2,
        exportedAt:
            new Date()
                .toISOString(),
        storage,
        session: {
            manualQueue:
                [...manualQueue]
        }
    };

    const blob =
        new Blob(
            [
                JSON.stringify(
                    payload,
                    null,
                    2
                )
            ],
            {
                type:
                    'application/json'
            }
        );

    const url =
        URL.createObjectURL(
            blob
        );

    const link =
        document.createElement(
            'a'
        );

    link.href = url;
    link.download =
        'jornal-do-futebol-backup-'
        + new Date()
            .toISOString()
            .slice(0, 10)
        + '.json';

    document.body.appendChild(
        link
    );

    link.click();
    link.remove();

    setTimeout(
        () => {
            URL.revokeObjectURL(
                url
            );
        },
        0
    );

    setStatus(
        'Backup do Jornal exportado.'
    );
}


function openBackupImport() {
    const input =
        document.getElementById(
            'backup-import'
        );

    if (input) {
        input.click();
    }
}


async function importJournalBackup(
    input
) {
    const file =
        input
        &&
        input.files
        &&
        input.files[0];

    if (!file) {
        return;
    }

    try {
        const payload =
            JSON.parse(
                await file.text()
            );

        if (
            !payload
            ||
            payload.format
            !== 'jornal-do-futebol-backup'
            ||
            !payload.storage
            ||
            typeof payload.storage
            !== 'object'
        ) {
            throw new Error(
                'Arquivo de backup inválido.'
            );
        }

        const existingKeys = [];

        for (
            let index = 0;
            index < localStorage.length;
            index++
        ) {
            const key =
                localStorage.key(
                    index
                );

            if (
                key
                &&
                key.startsWith(
                    'jornal_do_futebol_'
                )
            ) {
                existingKeys.push(
                    key
                );
            }
        }

        existingKeys.forEach(
            key =>
                localStorage.removeItem(
                    key
                )
        );

        for (
            const [
                key,
                value
            ]
            of Object.entries(
                payload.storage
            )
        ) {
            if (
                key.startsWith(
                    'jornal_do_futebol_'
                )
                &&
                typeof value
                === 'string'
            ) {
                localStorage.setItem(
                    key,
                    value
                );
            }
        }

        sessionStorage.removeItem(
            MANUAL_QUEUE_SESSION_KEY
        );

        if (
            payload.session
            &&
            Array.isArray(
                payload.session.manualQueue
            )
        ) {
            sessionStorage.setItem(
                MANUAL_QUEUE_SESSION_KEY,
                JSON.stringify(
                    payload
                        .session
                        .manualQueue
                )
            );
        }

        window.location.reload();
    }
    catch (error) {
        setStatus(
            'Não foi possível restaurar o backup: '
            + (
                error
                &&
                error.message
                ? error.message
                : 'arquivo inválido'
            )
        );
    }
    finally {
        input.value = '';
    }
}


function initializeFeatureUI() {
    initSmartHeader();
    updateFeatureToolbar();
    updateCardFeatureUI();
    updateChapterProgress();
    updateSessionSummary();
    updateSmartHeader();

    if (
        typeof initCardViewportAnimations
        === 'function'
    ) {
        initCardViewportAnimations(
            document
        );
    }
}
