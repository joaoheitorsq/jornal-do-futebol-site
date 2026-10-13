const motionAnimationRegistry =
    new WeakMap();

let journalCompletionCelebrated = false;


function prefersReducedMotion() {
    return Boolean(
        window.matchMedia
        &&
        window.matchMedia(
            '(prefers-reduced-motion: reduce)'
        ).matches
    );
}


function stopMotionAnimation(element) {
    const animation =
        motionAnimationRegistry.get(
            element
        );

    if (animation) {
        try {
            animation.cancel();
        }
        catch (_) {}

        motionAnimationRegistry.delete(
            element
        );
    }
}


function runCompositorAnimation(
    element,
    keyframes,
    options,
    onFinish = null
) {
    if (
        !element
        ||
        prefersReducedMotion()
        ||
        typeof element.animate
        !== 'function'
    ) {
        if (
            typeof onFinish
            === 'function'
        ) {
            onFinish();
        }

        return null;
    }

    stopMotionAnimation(element);

    element.style.willChange =
        'transform, opacity';

    const animation =
        element.animate(
            keyframes,
            options
        );

    motionAnimationRegistry.set(
        element,
        animation
    );

    const finish =
        () => {
            if (
                motionAnimationRegistry.get(
                    element
                )
                === animation
            ) {
                motionAnimationRegistry.delete(
                    element
                );
            }

            element.style.removeProperty(
                'will-change'
            );

            if (
                typeof onFinish
                === 'function'
            ) {
                onFinish();
            }
        };

    animation.onfinish = finish;

    animation.oncancel =
        () => {
            if (
                motionAnimationRegistry.get(
                    element
                )
                === animation
            ) {
                motionAnimationRegistry.delete(
                    element
                );
            }

            element.style.removeProperty(
                'will-change'
            );
        };

    return animation;
}


function animateCardsIn(
    scope = document,
    maxDelay = 180
) {
    if (prefersReducedMotion()) {
        return;
    }

    const cards =
        Array.from(
            scope.querySelectorAll(
                '.card:not(.hidden)'
            )
        )
        .filter(card =>
            !card.closest(
                '.chapter.collapsed'
            )
        )
        .slice(0, 16);

    cards.forEach(
        (card, index) => {
            const delay =
                Math.min(
                    index * 24,
                    maxDelay
                );

            runCompositorAnimation(
                card,
                [
                    {
                        opacity: 0,
                        transform:
                            'translate3d(0, 9px, 0) scale(.99)'
                    },
                    {
                        opacity: 1,
                        transform:
                            'translate3d(0, 0, 0) scale(1)'
                    }
                ],
                {
                    duration: 260,
                    delay,
                    easing:
                        'cubic-bezier(.2,.72,.25,1)',
                    fill: 'both'
                }
            );
        }
    );
}


function animateWatchedFeedback(videoId) {
    if (
        prefersReducedMotion()
        ||
        !videoId
    ) {
        return;
    }

    const card =
        Array.from(
            document.querySelectorAll(
                '.card[data-video-id]'
            )
        )
        .find(item =>
            item.dataset.videoId
            === videoId
        );

    if (
        !card
        ||
        card.classList.contains(
            'hidden'
        )
    ) {
        return;
    }

    card.classList.add(
        'just-watched'
    );

    runCompositorAnimation(
        card,
        [
            {
                transform:
                    'translate3d(0,0,0) scale(1)'
            },
            {
                transform:
                    'translate3d(0,0,0) scale(.992)'
            },
            {
                transform:
                    'translate3d(0,0,0) scale(1)'
            }
        ],
        {
            duration: 420,
            easing:
                'cubic-bezier(.2,.78,.25,1)'
        },
        () => {
            card.classList.remove(
                'just-watched'
            );
        }
    );
}


function animateJournalProgressCompletion() {
    if (prefersReducedMotion()) {
        return;
    }

    const progress =
        document.getElementById(
            'time-progress'
        );

    const pill =
        document.getElementById(
            'header-progress-count'
        );

    if (progress) {
        runCompositorAnimation(
            progress,
            [
                {
                    transform:
                        'translate3d(0,0,0) scaleY(1)'
                },
                {
                    transform:
                        'translate3d(0,0,0) scaleY(1.45)'
                },
                {
                    transform:
                        'translate3d(0,0,0) scaleY(1)'
                }
            ],
            {
                duration: 360,
                easing:
                    'cubic-bezier(.2,.8,.2,1)'
            }
        );
    }

    if (pill) {
        runCompositorAnimation(
            pill,
            [
                {
                    transform:
                        'translate3d(0,0,0) scale(1)'
                },
                {
                    transform:
                        'translate3d(0,0,0) scale(1.06)'
                },
                {
                    transform:
                        'translate3d(0,0,0) scale(1)'
                }
            ],
            {
                duration: 320,
                easing:
                    'cubic-bezier(.2,.8,.2,1)'
            }
        );
    }
}


function maybeCelebrateJournalCompletion() {
    const complete =
        VIDEOS.length > 0
        &&
        VIDEOS.every(
            video =>
                isWatched(video.id)
        );

    if (!complete) {
        journalCompletionCelebrated = false;
        return;
    }

    if (journalCompletionCelebrated) {
        return;
    }

    journalCompletionCelebrated = true;

    const overlay =
        document.getElementById(
            'journal-complete-animation'
        );

    if (!overlay) {
        return;
    }

    overlay.classList.add(
        'show'
    );

    overlay.setAttribute(
        'aria-hidden',
        'false'
    );

    setTimeout(
        () => {
            overlay.classList.remove(
                'show'
            );

            overlay.setAttribute(
                'aria-hidden',
                'true'
            );
        },
        prefersReducedMotion()
        ? 500
        : 2100
    );
}


function animateChapterToggle(
    chapter,
    collapse
) {
    if (!chapter) {
        applyChapterCollapse();
        return;
    }

    const list =
        chapter.querySelector(
            '.chapter-list'
        );

    if (
        !list
        ||
        prefersReducedMotion()
        ||
        typeof list.animate
        !== 'function'
    ) {
        applyChapterCollapse();
        return;
    }

    stopMotionAnimation(list);

    if (collapse) {
        chapter.classList.add(
            'chapter-closing'
        );

        runCompositorAnimation(
            list,
            [
                {
                    opacity: 1,
                    transform:
                        'translate3d(0,0,0)'
                },
                {
                    opacity: 0,
                    transform:
                        'translate3d(0,-6px,0)'
                }
            ],
            {
                duration: 190,
                easing:
                    'cubic-bezier(.4,0,.2,1)'
            },
            () => {
                chapter.classList.remove(
                    'chapter-closing'
                );

                applyChapterCollapse();
            }
        );

        return;
    }

    applyChapterCollapse();

    chapter.classList.add(
        'chapter-opening'
    );

    runCompositorAnimation(
        list,
        [
            {
                opacity: 0,
                transform:
                    'translate3d(0,-6px,0)'
            },
            {
                opacity: 1,
                transform:
                    'translate3d(0,0,0)'
            }
        ],
        {
            duration: 220,
            easing:
                'cubic-bezier(.2,.72,.25,1)'
        },
        () => {
            chapter.classList.remove(
                'chapter-opening'
            );
        }
    );

    requestAnimationFrame(
        () => {
            animateCardsIn(
                chapter,
                120
            );
        }
    );
}


function animateHearthPwnCollapse(
    collapse
) {
    const widget =
        document.querySelector(
            '.hearthpwn-widget'
        );

    const list =
        widget
        ? widget.querySelector(
            '.hearthpwn-news-list'
        )
        : null;

    if (
        !widget
        ||
        !list
        ||
        prefersReducedMotion()
        ||
        typeof list.animate
        !== 'function'
    ) {
        applyHearthPwnCollapse();
        return;
    }

    stopMotionAnimation(list);

    if (collapse) {
        widget.classList.add(
            'collapsing'
        );

        runCompositorAnimation(
            list,
            [
                {
                    opacity: 1,
                    transform:
                        'translate3d(0,0,0)'
                },
                {
                    opacity: 0,
                    transform:
                        'translate3d(0,-6px,0)'
                }
            ],
            {
                duration: 190,
                easing:
                    'cubic-bezier(.4,0,.2,1)'
            },
            () => {
                widget.classList.remove(
                    'collapsing'
                );

                applyHearthPwnCollapse();
            }
        );

        return;
    }

    applyHearthPwnCollapse();

    runCompositorAnimation(
        list,
        [
            {
                opacity: 0,
                transform:
                    'translate3d(0,-6px,0)'
            },
            {
                opacity: 1,
                transform:
                    'translate3d(0,0,0)'
            }
        ],
        {
            duration: 220,
            easing:
                'cubic-bezier(.2,.72,.25,1)'
        }
    );
}


function runAnimatedViewUpdate(update) {
    if (
        typeof update !== 'function'
    ) {
        return;
    }

    update();

    requestAnimationFrame(
        () => {
            animateCardsIn(
                document,
                100
            );
        }
    );
}
