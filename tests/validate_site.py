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
    "fullscreen-next",
    "journal-fullscreen-toggle",
    "journal-progress",
    "journal-play-pause",
    "status",
    "up-next",
    "video-search",
    "header-progress-count",
    "player-loading",
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


def validate_sources():
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
        and "fullscreen-seek-icon" in template
        and "const FULLSCREEN_SEEK_HOLD_MS = 2000;" in javascript
        and "function initFullscreenSeekForwardHold()" in javascript
        and "FULLSCREEN_SEEK_MOVE_TOLERANCE" in javascript
        and "seekBy(30);" in javascript
        and "#playerwrap:fullscreen .fullscreen-seek-forward" in css
        and "--seek-hold-percent" in css,
        "Botão de avançar 30 s com pressão contínua de 2 s está ausente.",
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
