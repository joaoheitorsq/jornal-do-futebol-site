const CARD_ACTION_HOLD_MS = 2000;
const CARD_ACTION_MOVE_TOLERANCE = 18;

let watchActionHoldTimer = null;
let watchActionHoldFrame = null;
let watchActionHoldStartedAt = 0;
let watchActionHoldButton = null;
let watchActionHoldPointerId = null;
let watchActionHoldStartX = 0;
let watchActionHoldStartY = 0;
let watchActionHoldTriggered = false;
let cardHoldActivationButton = null;


function cardButtonFromEvent(event) {
    if (
        !event
        ||
        !event.target
        ||
        typeof event.target.closest
        !== 'function'
    ) {
        return null;
    }

    const button =
        event.target.closest(
            '.card button'
        );

    if (
        !button
        ||
        button.disabled
    ) {
        return null;
    }

    return button;
}


function resetCardHoldVisual(button) {
    if (!button) {
        return;
    }

    button.classList.remove(
        'holding'
    );

    button.style.setProperty(
        '--hold-scale',
        '0'
    );
}


function cancelWatchActionHold() {
    if (watchActionHoldTimer) {
        clearTimeout(
            watchActionHoldTimer
        );
    }

    if (watchActionHoldFrame) {
        cancelAnimationFrame(
            watchActionHoldFrame
        );
    }

    resetCardHoldVisual(
        watchActionHoldButton
    );

    watchActionHoldTimer = null;
    watchActionHoldFrame = null;
    watchActionHoldStartedAt = 0;
    watchActionHoldButton = null;
    watchActionHoldPointerId = null;
    watchActionHoldStartX = 0;
    watchActionHoldStartY = 0;
    watchActionHoldTriggered = false;
}


function updateWatchActionHoldProgress() {
    if (
        !watchActionHoldButton
        ||
        !watchActionHoldStartedAt
        ||
        watchActionHoldTriggered
    ) {
        return;
    }

    const elapsed =
        performance.now()
        - watchActionHoldStartedAt;

    const progress =
        Math.min(
            1,
            elapsed / CARD_ACTION_HOLD_MS
        );

    watchActionHoldButton.style.setProperty(
        '--hold-scale',
        String(progress)
    );

    if (progress < 1) {
        watchActionHoldFrame =
            requestAnimationFrame(
                updateWatchActionHoldProgress
            );
    }
}


function activateHeldCardButton(button) {
    if (
        !button
        ||
        button.disabled
    ) {
        return;
    }

    /*
     * O botão de status não possui onclick próprio:
     * ele é acionado diretamente depois dos 2 segundos.
     */
    if (
        button.matches(
            '.watch-action[data-video-id]'
        )
    ) {
        toggleWatched(
            button.dataset.videoId
        );
        return;
    }

    /*
     * Os demais botões dos cards já possuem seus handlers
     * normais (inline ou atribuídos por features.js).
     * Liberamos exatamente UM click sintético, somente após
     * o protocolo de segurança ter sido cumprido.
     */
    cardHoldActivationButton =
        button;

    try {
        button.click();
    }
    finally {
        cardHoldActivationButton =
            null;
    }
}


function completeCardButtonHold() {
    const button =
        watchActionHoldButton;

    if (
        !button
        ||
        watchActionHoldTriggered
    ) {
        return;
    }

    watchActionHoldTriggered = true;

    button.style.setProperty(
        '--hold-scale',
        '1'
    );

    button.classList.add(
        'hold-confirmed'
    );

    if (watchActionHoldFrame) {
        cancelAnimationFrame(
            watchActionHoldFrame
        );

        watchActionHoldFrame = null;
    }

    watchActionHoldTimer = null;

    activateHeldCardButton(
        button
    );

    if (
        typeof animateCardHoldSuccessFeedback
        === 'function'
    ) {
        animateCardHoldSuccessFeedback();
    }

    setTimeout(
        () => {
            button.classList.remove(
                'hold-confirmed'
            );

            if (
                watchActionHoldButton
                === button
            ) {
                cancelWatchActionHold();
            }
            else {
                resetCardHoldVisual(
                    button
                );
            }
        },
        160
    );
}


function beginCardButtonHold(
    button,
    pointerId = null,
    startX = 0,
    startY = 0
) {
    if (
        !button
        ||
        button.disabled
    ) {
        return;
    }

    cancelWatchActionHold();

    watchActionHoldButton =
        button;

    watchActionHoldPointerId =
        pointerId;

    watchActionHoldStartX =
        startX;

    watchActionHoldStartY =
        startY;

    watchActionHoldTriggered =
        false;

    button.classList.add(
        'holding'
    );

    button.style.setProperty(
        '--hold-scale',
        '0'
    );

    watchActionHoldStartedAt =
        performance.now();

    updateWatchActionHoldProgress();

    watchActionHoldTimer =
        setTimeout(
            completeCardButtonHold,
            CARD_ACTION_HOLD_MS
        );
}


/*
 * Mantemos este nome por compatibilidade com o contrato
 * estrutural antigo, mas agora ele protege TODOS os botões
 * dentro de .card, não apenas "Marcar como visto".
 */
function beginWatchActionHold(event) {
    const button =
        cardButtonFromEvent(
            event
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

    beginCardButtonHold(
        button,
        event.pointerId,
        event.clientX,
        event.clientY
    );

    try {
        button.setPointerCapture(
            event.pointerId
        );
    }
    catch (_) {}
}


function moveWatchActionHold(event) {
    if (
        !watchActionHoldButton
        ||
        watchActionHoldPointerId === null
        ||
        event.pointerId
        !== watchActionHoldPointerId
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
        CARD_ACTION_MOVE_TOLERANCE
    ) {
        cancelWatchActionHold();
    }
}


function endWatchActionHold(event) {
    if (
        watchActionHoldPointerId !== null
        &&
        event.pointerId
        !== watchActionHoldPointerId
    ) {
        return;
    }

    cancelWatchActionHold();
}


function beginCardKeyboardHold(event) {
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

    const button =
        cardButtonFromEvent(
            event
        );

    if (!button) {
        return;
    }

    event.preventDefault();

    beginCardButtonHold(
        button
    );
}


function endCardKeyboardHold(event) {
    if (
        event.key !== ' '
        &&
        event.key !== 'Enter'
    ) {
        return;
    }

    if (!watchActionHoldButton) {
        return;
    }

    event.preventDefault();
    cancelWatchActionHold();
}


function blockUnprotectedCardClick(event) {
    const button =
        cardButtonFromEvent(
            event
        );

    if (!button) {
        return;
    }

    if (
        button
        === cardHoldActivationButton
    ) {
        return;
    }

    /*
     * Qualquer tap/click normal é bloqueado em fase de captura.
     * Portanto um handler inline, onclick dinâmico ou listener
     * futuro também fica sujeito ao mesmo mínimo de 2 segundos.
     */
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}


function blockCardContextMenu(event) {
    if (
        cardButtonFromEvent(
            event
        )
    ) {
        event.preventDefault();
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
    'keydown',
    beginCardKeyboardHold
);


document.addEventListener(
    'keyup',
    endCardKeyboardHold
);


/*
 * Captura é proposital: bloqueia inclusive onclick inline antes
 * que ele alcance o próprio botão.
 */
document.addEventListener(
    'click',
    blockUnprotectedCardClick,
    true
);


document.addEventListener(
    'contextmenu',
    blockCardContextMenu
);
