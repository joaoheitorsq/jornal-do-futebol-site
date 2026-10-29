migrateStorage();

featureState = loadFeatureState();
manualQueue = loadManualQueue();

watched = loadWatched();
portsWatched = loadPortsWatched();
portsResumePositions = loadPortsResumePositions();
hearthpwnSeen = loadHearthPwnSeen();
hearthpwnCollapsed = loadHearthPwnCollapsed();
portsCollapsed = loadPortsCollapsed();
loadPortsPreferences();
onlyUnwatched = loadUnwatchedMode();
collapsedChapters = loadCollapsedChapters();
miniPlayerCollapsed = loadMiniPlayerCollapsed();
resumeState = loadResume();
restorePortsPlaybackMode();
activePlayerSource = portsPlaybackActive ? 'ports' : 'journal';
initEnhancements();

applyView();
updateHearthPwnSeenUI();
applyHearthPwnCollapse();
applyPortsCollapse();
sortPortsCards();
updatePortsVideoUI();
initializeFeatureUI();
updateExtraDashboard();
applyPortsLimit();

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
