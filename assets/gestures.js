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
