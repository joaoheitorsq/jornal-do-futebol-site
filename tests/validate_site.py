#!/usr/bin/env python3

import argparse
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

KNOWN_PLACEHOLDERS = {
    "__DATE__",
    "__UPDATED__",
    "__WARNING__",
    "__HEARTHPWN_WIDGET__",
    "__CHAPTERS_HTML__",
    "__PLAYER_VIDEOS__",
    "__STYLE_VERSION__",
    "__APP_VERSION__",
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
    "beginFullscreenNextHold",
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
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def read_text(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


def validate_channels():
    data = json.loads(read_text("channels.json"))

    require(
        isinstance(data, list) and data,
        "channels.json deve ser uma lista não vazia.",
    )

    seen = set()

    for index, item in enumerate(data, start=1):
        require(
            isinstance(item, dict),
            f"Entrada {index} de channels.json não é um objeto.",
        )

        handle = item.get("handle")
        only_shorts = item.get("onlyShorts")

        require(
            isinstance(handle, str) and handle.strip(),
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

    app = read_text("assets/app.js")
    css = read_text("assets/style.css")
    template = read_text("templates/index.html")
    backend = read_text("jornal.py")

    require(app.strip(), "assets/app.js está vazio.")
    require(css.strip(), "assets/style.css está vazio.")

    require(
        "__PLAYER_VIDEOS__" not in app,
        "app.js não pode conter dados dinâmicos do Jornal.",
    )

    for function_name in REQUIRED_APP_FUNCTIONS:
        pattern = (
            r"\b(?:async\s+)?function\s+"
            + re.escape(function_name)
            + r"\s*\("
        )
        require(
            re.search(pattern, app),
            f"Função obrigatória ausente em app.js: {function_name}",
        )

    require(
        "assets/style.css?v=__STYLE_VERSION__" in template,
        "Template não referencia o CSS versionado.",
    )
    require(
        "assets/app.js?v=__APP_VERSION__" in template,
        "Template não referencia o JS versionado.",
    )
    require(
        'id="journal-data"' in template,
        "Template não contém journal-data.",
    )

    require(
        'asset_version("assets/style.css")' in backend,
        "Backend não versiona style.css.",
    )
    require(
        'asset_version("assets/app.js")' in backend,
        "Backend não versiona app.js.",
    )

    handlers = set(
        re.findall(
            r'on(?:click|input|change)="([A-Za-z_$][\w$]*)\s*\(',
            template + "\n" + backend,
        )
    )

    for handler in handlers:
        pattern = (
            r"\b(?:async\s+)?function\s+"
            + re.escape(handler)
            + r"\s*\("
        )
        require(
            re.search(pattern, app),
            f"Handler HTML sem função correspondente em app.js: {handler}",
        )


def validate_generated():
    index_path = ROOT / "index.html"

    require(
        index_path.exists(),
        "index.html não foi gerado.",
    )

    html = index_path.read_text(encoding="utf-8")
    app = read_text("assets/app.js")

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

    require(
        re.search(
            r'assets/style\.css\?v=[0-9a-f]{12}',
            html,
        ),
        "index.html não contém versão válida do CSS.",
    )

    require(
        re.search(
            r'assets/app\.js\?v=[0-9a-f]{12}',
            html,
        ),
        "index.html não contém versão válida do JS.",
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

    videos = json.loads(match.group(1).strip() or "[]")

    require(
        isinstance(videos, list),
        "journal-data deve conter uma lista JSON.",
    )

    ids = re.findall(r'\bid="([^"]+)"', html)
    duplicates = sorted(
        value
        for value in set(ids)
        if ids.count(value) > 1
    )

    require(
        not duplicates,
        "IDs HTML duplicados: " + ", ".join(duplicates),
    )

    html_ids = set(ids)

    for required_id in REQUIRED_HTML_IDS:
        require(
            required_id in html_ids,
            f"ID obrigatório ausente no HTML: {required_id}",
        )

    handlers = set(
        re.findall(
            r'on(?:click|input|change)="([A-Za-z_$][\w$]*)\s*\(',
            html,
        )
    )

    for handler in handlers:
        pattern = (
            r"\b(?:async\s+)?function\s+"
            + re.escape(handler)
            + r"\s*\("
        )
        require(
            re.search(pattern, app),
            f"Handler gerado sem função em app.js: {handler}",
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

    print("Validação do Jornal concluída com sucesso.")


if __name__ == "__main__":
    main()
