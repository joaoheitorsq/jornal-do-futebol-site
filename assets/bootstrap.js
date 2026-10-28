migrateStorage();

featureState = loadFeatureState();
manualQueue = loadManualQueue();

watched = loadWatched();
hearthpwnSeen = loadHearthPwnSeen();
hearthpwnCollapsed = loadHearthPwnCollapsed();
portsCollapsed = loadPortsCollapsed();
onlyUnwatched = loadUnwatchedMode();
collapsedChapters = loadCollapsedChapters();
miniPlayerCollapsed = loadMiniPlayerCollapsed();
resumeState = loadResume();

applyView();
updateHearthPwnSeenUI();
applyHearthPwnCollapse();
applyPortsCollapse();
initializeFeatureUI();

if (resumeState) {
    showResumeCard(
        resumeState.videoId
    );
}

const youtubeApiTag =
    document.createElement('script');

youtubeApiTag.src =
    'https://www.youtube.com/iframe_api';

document.head.appendChild(
    youtubeApiTag
);
