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


function animateCardsIn(
    scope = document,
    maxDelay = 420
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
        );

    cards.forEach(
        (card, index) => {
            const delay =
                Math.min(
                    index * 42,
                    maxDelay
                );

            card.classList.remove(
                'card-entering'
            );

            card.style.setProperty(
                '--card-enter-delay',
                String(delay) + 'ms'
            );

            void card.offsetWidth;

            card.classList.add(
                'card-entering'
            );

            setTimeout(
                () => {
                    card.classList.remove(
                        'card-entering'
                    );

                    card.style.removeProperty(
                        '--card-enter-delay'
                    );
                },
                620 + delay
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

    card.classList.remove(
        'just-watched'
    );

    void card.offsetWidth;

    card.classList.add(
        'just-watched'
    );

    setTimeout(
        () => {
            card.classList.remove(
                'just-watched'
            );
        },
        720
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
        progress.classList.remove(
            'completion-pulse'
        );

        void progress.offsetWidth;

        progress.classList.add(
            'completion-pulse'
        );

        setTimeout(
            () => {
                progress.classList.remove(
                    'completion-pulse'
                );
            },
            760
        );
    }

    if (pill) {
        pill.classList.remove(
            'progress-bump'
        );

        void pill.offsetWidth;

        pill.classList.add(
            'progress-bump'
        );

        setTimeout(
            () => {
                pill.classList.remove(
                    'progress-bump'
                );
            },
            520
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

    overlay.classList.remove(
        'show'
    );

    void overlay.offsetWidth;

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
        : 2300
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
        const height =
            list.getBoundingClientRect().height
            ||
            list.scrollHeight;

        chapter.classList.add(
            'chapter-closing'
        );

        const animation =
            list.animate(
                [
                    {
                        height:
                            String(height)
                            + 'px',
                        opacity: 1,
                        transform:
                            'translateY(0)'
                    },
                    {
                        height: '0px',
                        opacity: 0,
                        transform:
                            'translateY(-5px)'
                    }
                ],
                {
                    duration: 240,
                    easing:
                        'cubic-bezier(.4,0,.2,1)'
                }
            );

        motionAnimationRegistry.set(
            list,
            animation
        );

        animation.onfinish =
            () => {
                motionAnimationRegistry.delete(
                    list
                );

                chapter.classList.remove(
                    'chapter-closing'
                );

                applyChapterCollapse();
            };

        return;
    }

    applyChapterCollapse();

    const height =
        list.scrollHeight;

    chapter.classList.add(
        'chapter-opening'
    );

    const animation =
        list.animate(
            [
                {
                    height: '0px',
                    opacity: 0,
                    transform:
                        'translateY(-5px)'
                },
                {
                    height:
                        String(height)
                        + 'px',
                    opacity: 1,
                    transform:
                        'translateY(0)'
                }
            ],
            {
                duration: 290,
                easing:
                    'cubic-bezier(.2,.75,.25,1)'
            }
        );

    motionAnimationRegistry.set(
        list,
        animation
    );

    animation.onfinish =
        () => {
            motionAnimationRegistry.delete(
                list
            );

            chapter.classList.remove(
                'chapter-opening'
            );
        };

    requestAnimationFrame(
        () => {
            animateCardsIn(
                chapter,
                260
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
        const height =
            list.getBoundingClientRect().height
            ||
            list.scrollHeight;

        widget.classList.add(
            'collapsing'
        );

        const animation =
            list.animate(
                [
                    {
                        height:
                            String(height)
                            + 'px',
                        opacity: 1,
                        transform:
                            'translateY(0)'
                    },
                    {
                        height: '0px',
                        opacity: 0,
                        transform:
                            'translateY(-7px)'
                    }
                ],
                {
                    duration: 260,
                    easing:
                        'cubic-bezier(.4,0,.2,1)'
                }
            );

        motionAnimationRegistry.set(
            list,
            animation
        );

        animation.onfinish =
            () => {
                motionAnimationRegistry.delete(
                    list
                );

                widget.classList.remove(
                    'collapsing'
                );

                applyHearthPwnCollapse();
            };

        return;
    }

    applyHearthPwnCollapse();

    const height =
        list.scrollHeight;

    const animation =
        list.animate(
            [
                {
                    height: '0px',
                    opacity: 0,
                    transform:
                        'translateY(-7px)'
                },
                {
                    height:
                        String(height)
                        + 'px',
                    opacity: 1,
                    transform:
                        'translateY(0)'
                }
            ],
            {
                duration: 300,
                easing:
                    'cubic-bezier(.2,.75,.25,1)'
            }
        );

    motionAnimationRegistry.set(
        list,
        animation
    );

    animation.onfinish =
        () => {
            motionAnimationRegistry.delete(
                list
            );
        };
}


function prepareCardViewTransitions() {
    document
        .querySelectorAll(
            '.card[data-video-id]'
        )
        .forEach(
            (card, index) => {
                card.style.viewTransitionName =
                    'journal-card-'
                    + String(index);
            }
        );
}


function runAnimatedViewUpdate(update) {
    if (
        typeof update !== 'function'
    ) {
        return;
    }

    if (
        prefersReducedMotion()
        ||
        typeof document.startViewTransition
        !== 'function'
    ) {
        update();

        requestAnimationFrame(
            () => {
                animateCardsIn(
                    document,
                    180
                );
            }
        );

        return;
    }

    prepareCardViewTransitions();

    const transition =
        document.startViewTransition(
            () => {
                update();
            }
        );

    transition.finished
        .then(
            () => {
                animateCardsIn(
                    document,
                    180
                );
            }
        )
        .catch(
            () => {}
        );
}
