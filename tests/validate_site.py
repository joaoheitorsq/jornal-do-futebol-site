#!/usr/bin/env python3

import argparse
import json
import re
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

JS_FILES = [
    "assets/core.js",
    "assets/gestures.js",
    "assets/view.js",
    "assets/player.js",
    "assets/motion.js",
    "assets/features.js",
    "assets/bootstrap.js",
]

ASSET_VERSIONS = {
    "assets/style.css": "__STYLE_VERSION__",
    "assets/core.js": "__CORE_VERSION__",
    "assets/gestures.js": "__GESTURES_VERSION__",
    "assets/view.js": "__VIEW_VERSION__",
    "assets/player.js": "__PLAYER_VERSION__",
    "assets/motion.js": "__MOTION_VERSION__",
    "assets/features.js": "__FEATURES_VERSION__",
    "assets/bootstrap.js": "__BOOTSTRAP_VERSION__",
}

KNOWN_PLACEHOLDERS = {
    "__DATE__",
    "__UPDATED__",
    "__WARNING__",
    "__HEARTHPWN_WIDGET__",
    "__PORTS_WIDGET__",
    "__PORTS_VIDEOS__",
    "__CHAPTERS_HTML__",
    "__PLAYER_VIDEOS__",
    *ASSET_VERSIONS.values(),
}

REQUIRED_APP_FUNCTIONS = {
    "openVideo",
    "start",
    "next",
    "prev",
    "toggleWatched",
    "toggleUnwatchedMode",
    "toggleJournalFullscreen",
    "markCurrentWatchedAndNext",
    "beginWatchActionHold",
    "beginCardButtonHold",
    "activateHeldCardButton",
    "blockUnprotectedCardClick",
    "beginFullscreenNextHold",
    "migrateStorage",
    "setPlayerLoading",
    "animateCardsIn",
    "animateWatchedFeedback",
    "animateChapterToggle",
    "animateHearthPwnCollapse",
    "runAnimatedViewUpdate",
    "maybeCelebrateJournalCompletion",
    "loadFeatureState",
    "toggleDeferred",
    "toggleManualQueue",
    "toggleFinishLater",
    "skipChannelToday",
    "exportJournalBackup",
    "importJournalBackup",
    "showUndoToast",
    "initializeFeatureUI",
    "getResumeSeconds",
    "orderPlaylistWithFeatures",
    "updateChapterProgress",
    "initCardViewportAnimations",
    "animateQueueAdvance",
    "animateNumberChange",
    "animateChapterComplete",
    "animateCardHoldSuccessFeedback",
    "performUndo",
}

REQUIRED_HTML_IDS = {
    "player-section",
    "playerwrap",
    "player-slot",
    "ports-data",
    "ports-progress",
    "fullscreen-next",
    "journal-fullscreen-toggle",
    "journal-progress",
    "journal-play-pause",
    "status",
    "up-next",
    "video-search",
    "header-progress-count",
    "journal-complete-animation",
    "session-summary",
    "carryover-list",
    "smart-header",
    "undo-toast",
    "backup-import",
    "card-hold-success",
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def read_text(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


def read_javascript():
    parts = []

    for relative_path in JS_FILES:
        content = read_text(relative_path)

        require(
            content.strip(),
            f"{relative_path} está vazio.",
        )

        parts.append(content)

    return "\n\n".join(parts)


def declared_functions(javascript):
    return re.findall(
        r"\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(",
        javascript,
    )


def validate_channels():
    data = json.loads(
        read_text("channels.json")
    )

    require(
        isinstance(data, list) and data,
        "channels.json deve ser uma lista não vazia.",
    )

    seen = set()

    for index, item in enumerate(
        data,
        start=1,
    ):
        require(
            isinstance(item, dict),
            f"Entrada {index} de channels.json não é um objeto.",
        )

        handle = item.get("handle")
        only_shorts = item.get("onlyShorts")

        require(
            isinstance(handle, str)
            and handle.strip(),
            f"Entrada {index} sem handle válido.",
        )

        require(
            isinstance(only_shorts, bool),
            f"Entrada {index} sem onlyShorts booleano.",
        )

        normalized = handle.strip().casefold()

        require(
            normalized not in seen,
            f"Handle duplicado: {handle}",
        )

        seen.add(normalized)


def validate_ports_channels():
    channels = json.loads(read_text("ports_channels.json"))
    required = {
        "sixwp", "RetroJão", "Emuladores Brasil",
        "Senhor Linguica", "bummy", "Teaser Games",
    }

    require(
        isinstance(channels, list) and len(channels) >= 6,
        "Lista de canais de portes deve conter pelo menos seis fontes.",
    )

    actual = {item.get("name") for item in channels}
    require(
        required.issubset(actual) and len(actual) == len(channels),
        "Fontes iniciais ausentes ou nomes duplicados na seção de portes.",
    )

    identities = set()
    for channel in channels:
        require(
            isinstance(channel.get("handle"), str)
            and channel["handle"].startswith("@")
            and channel.get("onlyShorts") is False,
            "Canal de portes sem handle válido ou com restrição indevida.",
        )
        identity = (channel.get("channelId") or channel["handle"]).casefold()
        require(identity not in identities, "Fonte duplicada em ports_channels.json.")
        identities.add(identity)


def validate_sources():
    validate_ports_channels()
    validate_channels()

    javascript = read_javascript()
    css = read_text("assets/style.css")
    template = read_text("templates/index.html")
    backend = read_text("jornal.py")

    require(
        css.strip(),
        "assets/style.css está vazio.",
    )

    require(
        "--z-floating-player:" in css
        and ".playerbox.floating {" in css
        and "z-index: var(--z-floating-player);" in css,
        "Contrato de camada do mini-player está ausente.",
    )

    require(
        "animation: none !important;" in css
        and "#playerwrap.mini-player" in css,
        "Mini-player voltou a receber animações.",
    )

    require(
        "PORTS_WINDOW_HOURS = 7 * 24" in backend
        and "PORTS_VIDEO_LIMIT" not in backend
        and "RESUMO CANAL" in backend
        and "recent_by_handle" in backend
        and "ports_videos.sort(" in backend
        and 'class="ports-channel-count"' in backend
        and ".ports-channel-count" in css
        and "ports_channels.json" in read_text(".github/workflows/jornal.yml")
        and "def load_ports_channels():" in backend
        and "def build_ports_widget(" in backend
        and '__PORTS_VIDEOS__' in template
        and '__PORTS_WIDGET__' in template
        and 'id="ports-data"' in template
        and "const PORTS_VIDEOS =" in javascript
        and "function openPortsVideo(id)" in javascript
        and "function togglePortsWidget()" in javascript
        and "function updatePortsVideoUI()" in javascript
        and "if (portsPlaybackActive)" in javascript
        and "portsPlaybackActive = true;" in javascript
        and "portsPlaybackActive = false;" in javascript
        and ".ports-widget" in css
        and ".ports-video-item" in css,
        "Seção independente de portes não foi integrada completamente.",
    )

    # Regressão: o painel não pode voltar a prender a rolagem da página.
    ports_list_css = re.search(
        r"\.ports-video-list\s*\{([^}]*)\}",
        css,
        flags=re.S,
    )
    require(
        ports_list_css is not None
        and "max-height: none;" in ports_list_css.group(1)
        and "overflow: visible;" in ports_list_css.group(1)
        and "overscroll-behavior: auto;" in ports_list_css.group(1)
        and "touch-action: pan-y;" in ports_list_css.group(1)
        and "overflow-y: auto" not in ports_list_css.group(1)
        and "overscroll-behavior: contain" not in ports_list_css.group(1),
        "A lista de portes voltou a capturar a rolagem vertical.",
    )

    require(
        ".ports-heading .widget-kicker" in css
        and ".ports-play img" in css
        and ".ports-video-item.seen" in css
        and ".ports-progress-summary" in css
        and "@media (max-width: 600px)" in css,
        "Identidade visual ou responsividade do painel de portes incompleta.",
    )

    # Cobertura sem rede: mais de 24 vídeos, distribuídos entre seis
    # canais, nunca podem ser eliminados por um teto global.
    import jornal
    from datetime import datetime, timedelta, timezone

    sample_channels = json.loads(read_text("ports_channels.json"))
    reference_time = datetime(2026, 10, 28, tzinfo=timezone.utc)
    sample_videos = []
    for index in range(48):
        channel = sample_channels[index % len(sample_channels)]
        sample_videos.append({
            "videoId": f"TEST_VIDEO_{index:03d}",
            "title": f"Vídeo de teste {index}",
            "channelTitle": channel["name"],
            "channelHandle": channel["handle"],
            "publishedDt": reference_time - timedelta(hours=index),
            "embeddable": True,
        })

    sample_widget = jornal.build_ports_widget(
        sample_videos,
        sample_channels,
        [],
    )
    require(
        sample_widget.count('class="ports-video-item"') == len(sample_videos)
        and sample_widget.count('class="ports-channel-count"') == len(sample_channels)
        and "48 vídeos" in sample_widget,
        "O painel de portes perdeu vídeos de algum canal por limite global.",
    )

    require(
        "const CURRENT_STORAGE_SCHEMA = 2;" in javascript,
        "Schema avançado de armazenamento não está na versão 2.",
    )

    require(
        "IntersectionObserver" in javascript
        and "initCardViewportAnimations" in javascript,
        "Animação por viewport está ausente.",
    )

    require(
        "jornal-do-futebol-backup" in javascript
        and "FEATURE_STATE_KEY" in javascript,
        "Backup ou estado avançado está ausente.",
    )

    require(
        "const CARD_ACTION_HOLD_MS = 2000;" in javascript
        and "'.card button'" in javascript
        and "blockUnprotectedCardClick" in javascript
        and "activateHeldCardButton" in javascript,
        "Protocolo universal de 2 segundos dos cards está ausente.",
    )

    require(
        'id="fullscreen-seek-forward"' in template
        and 'class="fullscreen-next fullscreen-seek-forward"' in template
        and 'class="fullscreen-action-icon fullscreen-seek-icon"' in template
        and 'class="fullscreen-action-icon fullscreen-next-icon"' in template
        and "fullscreen-hold-confirmation" in template
        and "const FULLSCREEN_SEEK_HOLD_MS = 2000;" in javascript
        and "const FULLSCREEN_NEXT_HOLD_MS = 3000;" in javascript
        and "function initFullscreenSeekForwardHold()" in javascript
        and "FULLSCREEN_SEEK_MOVE_TOLERANCE" in javascript
        and "seekBy(30);" in javascript
        and "markCurrentWatchedAndNext();" in javascript
        and "button.classList.add(" in javascript
        and "'hold-confirmed'" in javascript
        and "'--hold-scale'" in javascript
        and "#playerwrap:fullscreen .fullscreen-seek-forward" in css
        and ".fullscreen-action-icon" in css,
        "Botão de avançar 30 s com pressão contínua de 2 s está ausente.",
    )

    require(
        "function claimFullscreenHoldCountdown(owner)" in javascript
        and "function hideFullscreenHoldCountdown(owner)" in javascript
        and "function showFullscreenHoldCountdown(owner, duration, elapsed)" in javascript
        and "fullscreenHoldCountdownOwner" in javascript
        and "'next',\n        FULLSCREEN_NEXT_HOLD_MS" in javascript
        and "'seek',\n            FULLSCREEN_SEEK_HOLD_MS" in javascript
        and "hideFullscreenHoldCountdown('seek');" in javascript
        and "hideFullscreenHoldCountdown('next');" in javascript
        and 'id="fullscreen-hold-countdown"' in template
        and 'id="fullscreen-hold-countdown-number"' in template
        and ".fullscreen-hold-countdown-number" in css,
        "Contagem regressiva gigante compartilhada entre 3 s e 2 s ausente.",
    )

    require(
        "@media (orientation: landscape)" in css
        and "--fullscreen-action-edge: 14px;" in css
        and "--fullscreen-action-size: 48px;" in css
        and "--fullscreen-action-gap: 10px;" in css
        and "--fullscreen-action-edge: 10px;" in css
        and "--fullscreen-action-size: 46px;" in css
        and "right: calc(" in css
        and "bottom: calc(" in css
        and "right: var(--fullscreen-action-edge);" in css,
        "O botão +30 s precisa ficar acima em paisagem e ao lado em retrato.",
    )

    require(
        "CARD SAFETY PROTOCOL" in css
        and ".card button.holding::after" in css,
        "Feedback visual do protocolo de segurança dos cards está ausente.",
    )

    require(
        "function featureActionIcon(" in javascript
        and "function setFeatureIconButton(" in javascript
        and "'defer'" in javascript
        and "'finish'" in javascript,
        "Ícones dos botões Ver depois/Terminar depois estão ausentes.",
    )

    require(
        ".feature-action.icon-only" in css
        and "user-select: none;" in css,
        "Proteção contra seleção nos botões de ícone está ausente.",
    )

    require(
        "animateCardHoldSuccessFeedback" in javascript
        and 'id="card-hold-success"' in template
        and "CARD HOLD SUCCESS" in css,
        "Feedback global de sucesso do toque longo está ausente.",
    )

    require(
        "feedback.animate(" in javascript
        and "'transform, opacity'" in javascript,
        "Feedback de sucesso deve usar animação otimizada por transform/opacity.",
    )

    require(
        not (ROOT / "assets/app.js").exists(),
        "assets/app.js é legado e não deve voltar ao projeto.",
    )

    require(
        "__PLAYER_VIDEOS__" not in javascript,
        "JavaScript não pode conter dados dinâmicos do Jornal.",
    )

    require(
        "is_short = short_confirmed(video_id, video)" in backend
        and '"isShort": is_short' in backend
        and '"isShort": video["isShort"]' in backend
        and "video.isShort === false" in javascript
        and "skip.hidden =" in javascript,
        "Pular canal hoje deve ocultar só vídeos normais, nunca Shorts.",
    )

    function_names = declared_functions(
        javascript
    )

    duplicates = sorted(
        name
        for name, count
        in Counter(function_names).items()
        if count > 1
    )

    require(
        not duplicates,
        "Funções JavaScript duplicadas entre módulos: "
        + ", ".join(duplicates),
    )

    available = set(function_names)

    for function_name in REQUIRED_APP_FUNCTIONS:
        require(
            function_name in available,
            f"Função obrigatória ausente: {function_name}",
        )

    positions = []

    for relative_path in JS_FILES:
        placeholder = ASSET_VERSIONS[
            relative_path
        ]

        reference = (
            relative_path
            + "?v="
            + placeholder
        )

        require(
            reference in template,
            f"Template não referencia {relative_path} com versão.",
        )

        positions.append(
            template.index(reference)
        )

        require(
            f'asset_version("{relative_path}")'
            in backend,
            f"Backend não versiona {relative_path}.",
        )

    require(
        positions == sorted(positions),
        "Ordem dos módulos JavaScript no template foi alterada.",
    )

    require(
        "assets/style.css?v=__STYLE_VERSION__"
        in template,
        "Template não referencia o CSS versionado.",
    )

    require(
        'asset_version("assets/style.css")'
        in backend,
        "Backend não versiona style.css.",
    )

    require(
        'id="journal-data"' in template,
        "Template não contém journal-data.",
    )

    require(
        'id="player-loading"' not in template
        and "player-loading-spinner" not in template
        and "Carregando vídeo" not in template
        and ".player-loading" not in css
        and ".switching-video" not in css
        and "player-loading-spin" not in css,
        "Tela estética de carregamento do player foi reintroduzida.",
    )

    require(
        "CURRENT_STORAGE_SCHEMA"
        in javascript
        and "migrateStorage();"
        in javascript,
        "Migração do armazenamento local está ausente.",
    )

    handlers = set(
        re.findall(
            r'on(?:click|input|change)="([A-Za-z_$][\w$]*)\s*\(',
            template + "\n" + backend,
        )
    )

    for handler in handlers:
        require(
            handler in available,
            f"Handler HTML sem função correspondente: {handler}",
        )


def validate_generated():
    index_path = ROOT / "index.html"

    require(
        index_path.exists(),
        "index.html não foi gerado.",
    )

    html = index_path.read_text(
        encoding="utf-8"
    )

    javascript = read_javascript()
    available = set(
        declared_functions(javascript)
    )

    unresolved = [
        token
        for token in KNOWN_PLACEHOLDERS
        if token in html
    ]

    require(
        not unresolved,
        "Placeholders não resolvidos no HTML: "
        + ", ".join(sorted(unresolved)),
    )

    for relative_path in ASSET_VERSIONS:
        pattern = (
            re.escape(relative_path)
            + r"\?v=[0-9a-f]{12}"
        )

        require(
            re.search(pattern, html),
            f"index.html não contém versão válida de {relative_path}.",
        )

    match = re.search(
        r'<script\s+id="journal-data"\s+type="application/json"\s*>'
        r'(.*?)'
        r'</script>',
        html,
        flags=re.S,
    )

    require(
        match is not None,
        "Bloco journal-data não encontrado no HTML gerado.",
    )

    videos = json.loads(
        match.group(1).strip()
        or "[]"
    )

    require(
        isinstance(videos, list),
        "journal-data deve conter uma lista JSON.",
    )

    for video in videos:
        require(
            isinstance(video, dict)
            and "isShort" in video
            and (
                video["isShort"] is None
                or isinstance(video["isShort"], bool)
            ),
            "Cada vídeo precisa declarar isShort como true/false/null.",
        )

    ports_match = re.search(
        r'<script\s+id="ports-data"\s+type="application/json"\s*>(.*?)</script>',
        html,
        flags=re.S,
    )
    require(ports_match is not None, "ports-data ausente do HTML final.")
    ports_videos = json.loads(ports_match.group(1).strip() or "[]")
    require(isinstance(ports_videos, list), "ports-data não é lista.")

    main_ids = {video["id"] for video in videos}
    ports_ids = {video["id"] for video in ports_videos}

    require(
        len(ports_ids) == len(ports_videos)
        and not main_ids.intersection(ports_ids),
        "Vídeos de portes duplicados ou misturados ao Jornal principal.",
    )
    for video in ports_videos:
        require(
            isinstance(video, dict)
            and isinstance(video.get("id"), str)
            and "isShort" in video
            and (video["isShort"] is None or isinstance(video["isShort"], bool)),
            "Vídeo do painel de portes inválido.",
        )

    ids = re.findall(
        r'(?<![\\w-])id="([^"]+)"',
        html,
    )

    duplicate_ids = sorted(
        value
        for value, count
        in Counter(ids).items()
        if count > 1
    )

    require(
        not duplicate_ids,
        "IDs HTML duplicados: "
        + ", ".join(duplicate_ids),
    )

    html_ids = set(ids)

    for required_id in REQUIRED_HTML_IDS:
        require(
            required_id in html_ids,
            f"ID obrigatório ausente: {required_id}",
        )

    handlers = set(
        re.findall(
            r'on(?:click|input|change)="([A-Za-z_$][\w$]*)\s*\(',
            html,
        )
    )

    for handler in handlers:
        require(
            handler in available,
            f"Handler gerado sem função JavaScript: {handler}",
        )


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--source-only",
        action="store_true",
        help="Valida somente os arquivos-fonte, sem exigir index.html.",
    )

    args = parser.parse_args()

    validate_sources()

    if not args.source_only:
        validate_generated()

    print(
        "Validação do Jornal concluída com sucesso."
    )


if __name__ == "__main__":
    main()
