import os
import json
import time
import html
import re

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


# ==========================================================
# CONFIGURAÇÃO
# ==========================================================

API = "https://www.googleapis.com/youtube/v3"

OEMBED = "https://www.youtube.com/oembed"

TZ = ZoneInfo("America/Fortaleza")

UTC = ZoneInfo("UTC")

RESET_HOUR = 4

WINDOW_HOURS = 24

MAX_RETRIES = 5

RETRYABLE_HTTP_CODES = {
    429,
    500,
    502,
    503,
    504,
}


# ==========================================================
# LOG
# ==========================================================

def log(message):

    print(
        f"[{datetime.now(TZ):%H:%M:%S}] {message}",
        flush=True,
    )


# ==========================================================
# HTTP / RETRY
# ==========================================================

def get_json(
    url,
    params=None,
    retries=MAX_RETRIES,
):

    if params:

        separator = (
            "&"
            if "?" in url
            else "?"
        )

        url += (
            separator
            + urlencode(params)
        )

    last_error = None

    for attempt in range(
        1,
        retries + 1,
    ):

        try:

            request = Request(
                url,
                headers={
                    "User-Agent":
                        "JornalDoFutebol/2.0",

                    "Accept":
                        "application/json",
                },
            )

            with urlopen(
                request,
                timeout=25,
            ) as response:

                return json.loads(
                    response
                    .read()
                    .decode("utf-8")
                )

        except HTTPError as error:

            body = ""

            try:

                body = (
                    error
                    .read()
                    .decode(
                        "utf-8",
                        errors="replace",
                    )
                )

            except Exception:
                pass

            last_error = RuntimeError(
                f"HTTP {error.code}: "
                f"{body[:500]}"
            )

            if (
                error.code
                not in RETRYABLE_HTTP_CODES
                or
                attempt == retries
            ):

                raise last_error

        except (
            URLError,
            TimeoutError,
            ConnectionError,
        ) as error:

            last_error = error

            if attempt == retries:
                raise

        wait_seconds = min(
            2 ** attempt,
            30,
        )

        log(
            "Falha temporária; "
            f"tentativa {attempt}/{retries}. "
            f"Aguardando {wait_seconds}s."
        )

        time.sleep(
            wait_seconds
        )

    raise (
        last_error
        or RuntimeError(
            "Falha HTTP desconhecida."
        )
    )


def yt(
    resource,
    api_key,
    **params,
):

    params["key"] = api_key

    return get_json(
        f"{API}/{resource}",
        params,
    )


# ==========================================================
# CANAIS
# ==========================================================

def load_channels():

    with open(
        "channels.json",
        encoding="utf-8",
    ) as file:

        raw = json.load(file)

    channels = []

    seen = set()

    for item in raw:

        handle = str(
            item.get(
                "handle",
                "",
            )
        ).strip()

        if not handle:
            continue

        if not handle.startswith("@"):
            handle = "@" + handle

        normalized = (
            handle.casefold()
        )

        if normalized in seen:
            continue

        seen.add(
            normalized
        )

        channels.append(
            {
                "handle":
                    handle,

                "onlyShorts":
                    bool(
                        item.get(
                            "onlyShorts",
                            False,
                        )
                    ),
            }
        )

    if not channels:

        raise RuntimeError(
            "channels.json não contém "
            "nenhum canal válido."
        )

    return channels


def resolve_channel(
    api_key,
    config,
):

    data = yt(
        "channels",
        api_key,

        part=
            "id,snippet,contentDetails",

        forHandle=
            config["handle"],

        maxResults=1,
    )

    items = data.get(
        "items",
        [],
    )

    if not items:

        raise RuntimeError(
            "Canal não encontrado: "
            + config["handle"]
        )

    channel = items[0]

    uploads = (
        channel
        .get(
            "contentDetails",
            {},
        )
        .get(
            "relatedPlaylists",
            {},
        )
        .get(
            "uploads"
        )
    )

    if not uploads:

        raise RuntimeError(
            "Playlist de uploads "
            "não encontrada: "
            + config["handle"]
        )

    return {
        **config,

        "channelId":
            channel["id"],

        "channelTitle":
            channel[
                "snippet"
            ]["title"],

        "uploads":
            uploads,
    }


# ==========================================================
# DATAS
# ==========================================================

def parse_dt(value):

    return datetime.fromisoformat(
        value.replace(
            "Z",
            "+00:00",
        )
    )


def journal_day(
    now_local,
):

    if (
        now_local.hour
        >= RESET_HOUR
    ):

        reference = now_local

    else:

        reference = (
            now_local
            - timedelta(days=1)
        )

    return reference.strftime(
        "%d/%m/%Y"
    )


# ==========================================================
# UPLOADS RECENTES
# ==========================================================

def recent_uploads(
    api_key,
    channel,
    start,
    now_utc,
):

    result = []

    token = None

    while True:

        params = {
            "part":
                "contentDetails",

            "playlistId":
                channel["uploads"],

            "maxResults":
                50,
        }

        if token:

            params[
                "pageToken"
            ] = token

        data = yt(
            "playlistItems",
            api_key,
            **params,
        )

        items = data.get(
            "items",
            [],
        )

        if not items:
            break

        found_old = False

        for item in items:

            details = item.get(
                "contentDetails",
                {},
            )

            video_id = details.get(
                "videoId"
            )

            published_at = details.get(
                "videoPublishedAt"
            )

            if (
                not video_id
                or
                not published_at
            ):
                continue

            published_dt = parse_dt(
                published_at
            )

            if published_dt < start:

                found_old = True

                continue

            if published_dt > now_utc:
                continue

            result.append(
                {
                    "videoId":
                        video_id,

                    "publishedAt":
                        published_at,

                    "publishedDt":
                        published_dt,

                    "channelId":
                        channel[
                            "channelId"
                        ],

                    "channelTitle":
                        channel[
                            "channelTitle"
                        ],

                    "onlyShorts":
                        channel[
                            "onlyShorts"
                        ],
                }
            )

        if found_old:
            break

        token = data.get(
            "nextPageToken"
        )

        if not token:
            break

    return result


def chunks(
    sequence,
    size=50,
):

    for index in range(
        0,
        len(sequence),
        size,
    ):

        yield sequence[
            index:index + size
        ]


# ==========================================================
# DURAÇÃO
# ==========================================================

def duration_seconds(
    value,
):

    match = re.fullmatch(
        r"P(?:(\d+)D)?T"
        r"(?:(\d+)H)?"
        r"(?:(\d+)M)?"
        r"(?:(\d+)S)?",
        value or "",
    )

    if not match:
        return None

    days, hours, minutes, seconds = [
        int(part or 0)
        for part
        in match.groups()
    ]

    return (
        days * 86400
        + hours * 3600
        + minutes * 60
        + seconds
    )


# ==========================================================
# DETECÇÃO DE SHORTS
# ==========================================================

def short_confirmed(
    video_id,
    video,
):

    duration = duration_seconds(
        video
        .get(
            "contentDetails",
            {},
        )
        .get(
            "duration"
        )
    )

    # Shorts modernos podem ter até 3 minutos.
    if (
        duration is None
        or
        duration > 180
    ):

        return False

    try:

        data = get_json(
            OEMBED,
            {
                "url":
                    "https://www.youtube.com/"
                    "shorts/"
                    + video_id,

                "format":
                    "json",
            },
            retries=3,
        )

        width = int(
            data.get(
                "width",
                0,
            )
        )

        height = int(
            data.get(
                "height",
                0,
            )
        )

        return (
            width > 0
            and
            height > 0
            and
            width <= height
        )

    except Exception as error:

        log(
            "Short não pôde ser "
            f"confirmado ({video_id}): "
            f"{error}"
        )

        return False


# ==========================================================
# COLETA / FILTROS
# ==========================================================

def collect(
    api_key,
    configs,
):

    now_local = datetime.now(
        TZ
    )

    now_utc = (
        now_local
        .astimezone(UTC)
    )

    start = (
        now_utc
        - timedelta(
            hours=WINDOW_HOURS
        )
    )

    candidates = {}

    failures = []

    successful_channels = 0

    for config in configs:

        try:

            channel = resolve_channel(
                api_key,
                config,
            )

            successful_channels += 1

            log(
                "CANAL OK: "
                + channel[
                    "channelTitle"
                ]
                + " ["
                + (
                    "SOMENTE SHORTS"
                    if channel[
                        "onlyShorts"
                    ]
                    else
                    "TODOS"
                )
                + "]"
            )

            uploads = recent_uploads(
                api_key,
                channel,
                start,
                now_utc,
            )

            for item in uploads:

                candidates[
                    item["videoId"]
                ] = item

        except Exception as error:

            failures.append(
                f"{config['handle']}: "
                f"{error}"
            )

            log(
                "AVISO: "
                + config["handle"]
                + " → "
                + str(error)
            )

    if successful_channels == 0:

        raise RuntimeError(
            "Nenhum canal pôde "
            "ser consultado."
        )

    if (
        len(failures)
        >
        max(
            3,
            len(configs) // 4,
        )
    ):

        raise RuntimeError(
            "Muitos canais falharam. "
            "O site anterior será preservado."
        )

    details = {}

    ids = list(
        candidates
    )

    for batch in chunks(ids):

        data = yt(
            "videos",
            api_key,

            part=
                "snippet,"
                "contentDetails,"
                "liveStreamingDetails,"
                "status",

            id=
                ",".join(batch),

            maxResults=50,
        )

        for video in data.get(
            "items",
            [],
        ):

            details[
                video["id"]
            ] = video

    accepted = []

    for (
        video_id,
        candidate,
    ) in candidates.items():

        video = details.get(
            video_id
        )

        if not video:
            continue

        snippet = video.get(
            "snippet",
            {},
        )

        if (
            snippet.get(
                "channelId"
            )
            !=
            candidate[
                "channelId"
            ]
        ):
            continue

        # --------------------------------------------------
        # EXCLUI TODAS AS LIVES
        #
        # futura
        # acontecendo
        # encerrada
        # --------------------------------------------------

        if (
            "liveStreamingDetails"
            in video
        ):

            log(
                "LIVE EXCLUÍDA: "
                + snippet.get(
                    "title",
                    video_id,
                )
            )

            continue

        # --------------------------------------------------
        # CLASSIFICA SHORT / VÍDEO NORMAL
        # --------------------------------------------------

        is_short = short_confirmed(
            video_id,
            video,
        )

        # --------------------------------------------------
        # CANAIS SOMENTE SHORTS
        # --------------------------------------------------

        if (
            candidate[
                "onlyShorts"
            ]
            and
            not is_short
        ):

            log(
                "NÃO ENTROU — "
                "CANAL SOMENTE SHORTS: "
                + snippet.get(
                    "title",
                    video_id,
                )
            )

            continue

        accepted.append(
            {
                "videoId":
                    video_id,

                "title":
                    snippet.get(
                        "title",
                        "Sem título",
                    ),

                "channelTitle":
                    snippet.get(
                        "channelTitle",
                        candidate[
                            "channelTitle"
                        ],
                    ),

                "publishedDt":
                    candidate[
                        "publishedDt"
                    ],

                "isShort":
                    is_short,

                "embeddable":
                    bool(
                        video
                        .get(
                            "status",
                            {},
                        )
                        .get(
                            "embeddable",
                            True,
                        )
                    ),
            }
        )

    # Mais antigo → mais novo.
    accepted.sort(
        key=lambda item:
            item["publishedDt"]
    )

    return (
        accepted,
        now_local,
        failures,
    )


# ==========================================================
# JSON SEGURO PARA HTML
# ==========================================================

def js_json(
    obj,
):

    return (
        json.dumps(
            obj,
            ensure_ascii=False,
        )
        .replace(
            "<",
            "\\u003c",
        )
        .replace(
            ">",
            "\\u003e",
        )
        .replace(
            "&",
            "\\u0026",
        )
    )


# ==========================================================
# GERAÇÃO DA PÁGINA
# ==========================================================

def build_page(
    videos,
    now_local,
    failures,
):

    date = journal_day(
        now_local
    )

    updated = (
        now_local
        .strftime(
            "%d/%m/%Y às %H:%M"
        )
    )

    version = (
        now_local
        .isoformat()
    )

    normal_count = sum(
        1
        for video in videos
        if not video["isShort"]
    )

    shorts_count = sum(
        1
        for video in videos
        if video["isShort"]
    )

    video_data = []

    cards = []

    for video in videos:

        video_id = video[
            "videoId"
        ]

        published = (
            video[
                "publishedDt"
            ]
            .astimezone(TZ)
            .strftime("%H:%M")
        )

        video_type = (
            "short"
            if video["isShort"]
            else "normal"
        )

        type_label = (
            "SHORT"
            if video["isShort"]
            else "VÍDEO"
        )

        video_data.append(
            {
                "id":
                    video_id,

                "title":
                    video["title"],

                "channel":
                    video[
                        "channelTitle"
                    ],

                "time":
                    published,

                "type":
                    video_type,

                "embeddable":
                    video[
                        "embeddable"
                    ],
            }
        )

        non_embeddable = ""

        if not video[
            "embeddable"
        ]:

            non_embeddable = (
                '<span class="external-note">'
                'Abre no YouTube'
                '</span>'
            )

        cards.append(
            f'''
<button
    class="card"
    data-video-id="{html.escape(video_id)}"
    data-type="{video_type}"
    onclick="openVideo('{html.escape(video_id)}')"
>

    <div class="thumb-wrap">

        <img
            src="https://i.ytimg.com/vi/{html.escape(video_id)}/mqdefault.jpg"
            alt=""
            loading="lazy"
        >

        <span class="type-badge {video_type}">
            {type_label}
        </span>

        <span
            class="watched-eye"
            title="Assistido por completo"
        >
            👁️
        </span>

        <span class="new-badge">
            NOVO
        </span>

    </div>

    <span class="card-info">

        <b>
            {html.escape(video["title"])}
        </b>

        <em>
            {html.escape(video["channelTitle"])}
            ·
            {published}
        </em>

        {non_embeddable}

    </span>

</button>
'''
        )

    cards_html = (
        "\n".join(cards)
    )

    if not cards_html:

        cards_html = (
            '<p class="empty">'
            'Nenhum vídeo válido '
            'nas últimas 24 horas.'
            '</p>'
        )

    warning = ""

    if failures:

        warning = (
            '<p class="warn">'
            f'{len(failures)} canal(is) '
            'falharam nesta atualização. '
            'Eles serão consultados novamente '
            'na próxima execução.'
            '</p>'
        )

    data_payload = {
        "version":
            version,

        "generatedAt":
            updated,

        "videos":
            video_data,
    }

    return f'''<!doctype html>

<html lang="pt-BR">

<head>

<meta charset="utf-8">

<meta
    name="viewport"
    content="width=device-width,initial-scale=1"
>

<meta
    name="journal-version"
    content="{html.escape(version)}"
>

<title>
Jornal do Futebol — {date}
</title>

<style>

* {{
    box-sizing: border-box;
}}

html {{
    scroll-behavior: smooth;
}}

body {{
    margin: 0;
    background: #0f1115;
    color: #f2f3f5;

    font:
        15px
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
}}

button {{
    font: inherit;
}}

main {{
    max-width: 1050px;
    margin: auto;
    padding: 24px 14px 60px;
}}

h1 {{
    margin: 0;

    font-size:
        clamp(
            27px,
            5vw,
            40px
        );
}}

.meta {{
    color: #aeb4bd;
    margin-top: 4px;
}}


/* ======================================================
   AVISO DE NOVA VERSÃO
   ====================================================== */

.update-banner {{
    position: sticky;
    top: 10px;
    z-index: 999;

    display: none;

    align-items: center;
    justify-content: space-between;
    gap: 12px;

    margin: 14px 0;

    padding: 12px 14px;

    background: #17375e;

    border:
        1px solid
        #3176bc;

    border-radius: 12px;

    box-shadow:
        0 8px 30px
        rgba(0, 0, 0, .35);
}}

.update-banner.show {{
    display: flex;
}}

.update-banner button {{
    flex-shrink: 0;

    border: 0;
    border-radius: 9px;

    padding: 9px 13px;

    cursor: pointer;

    background: #fff;
    color: #111;
    font-weight: 700;
}}


/* ======================================================
   CONTADORES
   ====================================================== */

.stats {{
    display: flex;
    flex-wrap: wrap;
    gap: 8px;

    margin: 15px 0;
}}

.stat {{
    background: #181b22;

    border:
        1px solid
        #303641;

    border-radius: 999px;

    padding: 7px 11px;

    color: #d8dce2;
}}

.stat strong {{
    color: white;
}}


/* ======================================================
   PLAYER
   ====================================================== */

.playerbox {{
    background: #181b22;

    border:
        1px solid
        #303641;

    border-radius: 14px;

    padding: 12px;

    margin: 18px 0;
}}

#playerwrap {{
    aspect-ratio: 16 / 9;

    background: #000;

    border-radius: 10px;

    overflow: hidden;
}}

#player {{
    width: 100%;
    height: 100%;
}}

.controls {{
    display: flex;
    gap: 8px;
    flex-wrap: wrap;

    margin-top: 10px;
}}

.controls button {{
    background: #242933;
    color: white;

    border:
        1px solid
        #3a414d;

    border-radius: 9px;

    padding: 9px 12px;

    cursor: pointer;
}}

.controls button:hover {{
    background: #303642;
}}

#status {{
    color: #aeb4bd;
    margin-top: 9px;
}}


/* ======================================================
   FILTROS
   ====================================================== */

.filters {{
    display: flex;
    flex-wrap: wrap;
    gap: 8px;

    margin:
        18px 0
        12px;
}}

.filter-button {{
    border:
        1px solid
        #3a414d;

    background: #181b22;
    color: #d8dce2;

    padding: 8px 12px;

    border-radius: 999px;

    cursor: pointer;
}}

.filter-button.active {{
    background: #f2f3f5;
    color: #111;

    border-color:
        #f2f3f5;

    font-weight: 700;
}}

.results-info {{
    color: #aeb4bd;
    margin-bottom: 10px;
}}


/* ======================================================
   LISTA
   ====================================================== */

.list {{
    display: grid;
    gap: 9px;
}}

.card {{
    display: grid;

    grid-template-columns:
        150px 1fr;

    gap: 12px;

    padding: 0;

    width: 100%;

    background: #181b22;
    color: inherit;

    border:
        1px solid
        #303641;

    border-radius: 14px;

    text-align: left;

    cursor: pointer;

    overflow: hidden;
}}

.card:hover {{
    background: #1e222a;
}}

.card.hidden {{
    display: none;
}}

.card.playing {{
    border-color: #5a9ee2;

    box-shadow:
        0 0 0 1px
        #5a9ee2;
}}

.card.watched {{
    opacity: .72;
}}

.thumb-wrap {{
    position: relative;

    width: 150px;

    aspect-ratio: 16 / 9;

    overflow: hidden;

    background: #000;
}}

.thumb-wrap img {{
    width: 100%;
    height: 100%;

    object-fit: cover;
}}

.card-info {{
    padding:
        10px
        12px
        10px
        0;

    display: grid;

    gap: 5px;

    align-content: center;
}}

.card-info b {{
    line-height: 1.28;
}}

.card-info em {{
    color: #aeb4bd;
    font-style: normal;
}}

.type-badge {{
    position: absolute;

    left: 6px;
    bottom: 6px;

    padding: 3px 6px;

    border-radius: 6px;

    font-size: 10px;
    font-weight: 800;

    background:
        rgba(
            0,
            0,
            0,
            .78
        );

    color: white;
}}

.type-badge.short {{
    background:
        rgba(
            197,
            38,
            60,
            .90
        );
}}

.watched-eye {{
    display: none;

    position: absolute;

    top: 6px;
    right: 6px;

    padding: 4px 6px;

    border-radius: 999px;

    background:
        rgba(
            0,
            0,
            0,
            .80
        );

    font-size: 16px;
}}

.card.watched
.watched-eye {{
    display: block;
}}

.new-badge {{
    display: none;

    position: absolute;

    top: 6px;
    left: 6px;

    padding: 4px 6px;

    border-radius: 6px;

    background: #1f8f4d;

    color: white;

    font-size: 10px;

    font-weight: 900;
}}

.card.new-video
.new-badge {{
    display: block;
}}

.external-note {{
    color: #e5b85c;
    font-size: 12px;
}}

.warn {{
    background: #292411;

    border:
        1px solid
        #665b27;

    padding: 10px;

    border-radius: 9px;

    color: #eadc9b;
}}

.empty {{
    color: #aeb4bd;
}}


/* ======================================================
   MOBILE
   ====================================================== */

@media (
    max-width: 600px
) {{

    main {{
        padding:
            18px
            10px
            50px;
    }}

    .card {{
        grid-template-columns:
            110px 1fr;
    }}

    .thumb-wrap {{
        width: 110px;
    }}

    .card-info {{
        padding:
            8px
            9px
            8px
            0;
    }}

    .update-banner {{
        align-items:
            flex-start;

        flex-direction:
            column;
    }}

}}

</style>

</head>


<body>

<main>


<h1>
⚽ Jornal do Futebol — {date}
</h1>


<div class="meta">

Últimas 24 horas
 ·
antigo → novo
 ·
atualizado em {updated}

</div>


<div
    id="update-banner"
    class="update-banner"
>

    <span id="update-message">
        🔔 Há uma versão mais recente do Jornal.
    </span>

    <button
        onclick="location.reload()"
    >
        Atualizar agora
    </button>

</div>


<div class="stats">

    <span class="stat">
        Total:
        <strong>
            {len(videos)}
        </strong>
    </span>

    <span class="stat">
        Novos:
        <strong id="new-count">
            0
        </strong>
    </span>

    <span class="stat">
        Assistidos:
        <strong id="watched-count">
            0
        </strong>
    </span>

</div>


<section class="playerbox">

    <div id="playerwrap">

        <div id="player"></div>

    </div>


    <div class="controls">

        <button onclick="start()">
            ▶ Começar jornal
        </button>

        <button onclick="prev()">
            ⏮ Anterior
        </button>

        <button onclick="next(false)">
            Próximo ⏭
        </button>

    </div>


    <div id="status">

        Clique em
        “Começar jornal”
        para reproduzir
        em ordem cronológica.

    </div>

</section>


{warning}


<div class="filters">

    <button
        class="filter-button active"
        data-filter="all"
        onclick="setFilter('all')"
    >
        Todos ({len(videos)})
    </button>

    <button
        class="filter-button"
        data-filter="normal"
        onclick="setFilter('normal')"
    >
        Vídeos ({normal_count})
    </button>

    <button
        class="filter-button"
        data-filter="short"
        onclick="setFilter('short')"
    >
        Shorts ({shorts_count})
    </button>

</div>


<div
    id="results-info"
    class="results-info"
>
    Exibindo {len(videos)} vídeos.
</div>


<section
    id="video-list"
    class="list"
>

{cards_html}

</section>


<script
    id="journal-data"
    type="application/json"
>
{js_json(data_payload)}
</script>


</main>


<script>

/*
==========================================================
 DADOS DO JORNAL
==========================================================
*/

const JOURNAL =
JSON.parse(

    document
        .getElementById(
            'journal-data'
        )
        .textContent

);


const CURRENT_VERSION =
JOURNAL.version;


const VIDEOS =
JOURNAL.videos;


const CURRENT_IDS =
VIDEOS.map(
    video => video.id
);


const CURRENT_ID_SET =
new Set(
    CURRENT_IDS
);


/*
==========================================================
 STORAGE
==========================================================
*/

const STORAGE = {{

    WATCHED:
        'jdf_watched_v2',

    LAST_SEEN:
        'jdf_last_seen_v2',

    FILTER:
        'jdf_filter_v2'

}};


/*
==========================================================
 HELPERS DE STORAGE
==========================================================
*/

function loadJSON(
    key,
    fallback
) {{

    try {{

        const raw =
            localStorage
                .getItem(key);


        if (!raw) {{
            return fallback;
        }}


        return JSON.parse(
            raw
        );

    }}
    catch (_) {{

        return fallback;

    }}

}}


function saveJSON(
    key,
    value
) {{

    try {{

        localStorage.setItem(

            key,

            JSON.stringify(
                value
            )

        );

    }}
    catch (_) {{}}

}}


/*
==========================================================
 VÍDEOS NOVOS
==========================================================

 "Novo" =
 existe no Jornal atual,
 mas não existia na última
 versão que você abriu.

 Na primeira utilização não
 marcamos todos como novos.
==========================================================
*/

const PREVIOUS_IDS =
loadJSON(
    STORAGE.LAST_SEEN,
    []
);


const previousSet =
new Set(
    PREVIOUS_IDS
);


let NEW_IDS =
new Set();


if (
    PREVIOUS_IDS.length > 0
) {{

    for (
        const id
        of CURRENT_IDS
    ) {{

        if (
            !previousSet.has(id)
        ) {{

            NEW_IDS.add(id);

        }}

    }}

}


/*
 * Depois de calcular,
 * esta versão passa a ser
 * a referência da próxima visita.
 */
saveJSON(
    STORAGE.LAST_SEEN,
    CURRENT_IDS
);


/*
==========================================================
 ASSISTIDOS
==========================================================
*/

let watched =
loadJSON(
    STORAGE.WATCHED,
    {{}}
);


/*
 * Remove registros com mais
 * de 180 dias.
 */
function pruneWatched() {{

    const limit =
        Date.now()
        -
        180
        * 24
        * 60
        * 60
        * 1000;


    for (
        const id
        in watched
    ) {{

        if (
            Number(
                watched[id]
            )
            <
            limit
        ) {{

            delete watched[id];

        }}

    }}


    saveJSON(
        STORAGE.WATCHED,
        watched
    );

}}


pruneWatched();


function markWatched(
    id
) {{

    watched[id] =
        Date.now();


    saveJSON(
        STORAGE.WATCHED,
        watched
    );


    refreshCardStates();

}}


/*
==========================================================
 ESTADO VISUAL DOS CARDS
==========================================================
*/

function refreshCardStates() {{

    let watchedInJournal = 0;


    document
        .querySelectorAll(
            '.card'
        )
        .forEach(card => {{

            const id =
                card.dataset.videoId;


            const isWatched =
                Boolean(
                    watched[id]
                );


            card.classList.toggle(
                'watched',
                isWatched
            );


            card.classList.toggle(
                'new-video',
                NEW_IDS.has(id)
            );


            if (isWatched) {{

                watchedInJournal++;

            }}

        });


    document
        .getElementById(
            'new-count'
        )
        .textContent =
            NEW_IDS.size;


    document
        .getElementById(
            'watched-count'
        )
        .textContent =
            watchedInJournal;

}}


refreshCardStates();


/*
==========================================================
 FILTROS
==========================================================
*/

let currentFilter =
localStorage.getItem(
    STORAGE.FILTER
)
||
'all';


if (
    ![
        'all',
        'normal',
        'short'
    ].includes(
        currentFilter
    )
) {{

    currentFilter =
        'all';

}}


function matchesFilter(
    video
) {{

    if (
        currentFilter
        ===
        'all'
    ) {{

        return true;

    }}


    return (
        video.type
        ===
        currentFilter
    );

}}


function filteredVideos() {{

    return VIDEOS.filter(
        matchesFilter
    );

}}


let activePlaylist = [];

let currentIndex = 0;


function rebuildPlaylist() {{

    activePlaylist =
        filteredVideos()
        .filter(
            video =>
                video.embeddable
        )
        .map(
            video =>
                video.id
        );


    const currentVideoId =
        getCurrentVideoId();


    if (
        currentVideoId
        &&
        activePlaylist.includes(
            currentVideoId
        )
    ) {{

        currentIndex =
            activePlaylist.indexOf(
                currentVideoId
            );

    }}
    else {{

        currentIndex = 0;

    }}

}}


function setFilter(
    filter
) {{

    currentFilter =
        filter;


    localStorage.setItem(
        STORAGE.FILTER,
        filter
    );


    document
        .querySelectorAll(
            '.filter-button'
        )
        .forEach(button => {{

            button
                .classList
                .toggle(
                    'active',
                    button.dataset.filter
                    ===
                    filter
                );

        });


    let visible = 0;


    document
        .querySelectorAll(
            '.card'
        )
        .forEach(card => {{

            const shouldShow =
                (
                    filter
                    ===
                    'all'
                )
                ||
                (
                    card.dataset.type
                    ===
                    filter
                );


            card.classList.toggle(
                'hidden',
                !shouldShow
            );


            if (shouldShow) {{

                visible++;

            }}

        });


    document
        .getElementById(
            'results-info'
        )
        .textContent =
            'Exibindo '
            + visible
            + (
                visible === 1
                ? ' vídeo.'
                : ' vídeos.'
            );


    rebuildPlaylist();

}}


/*
==========================================================
 PLAYER
==========================================================
*/

let player = null;

let playerReady = false;


function getCurrentVideoId() {{

    if (
        !player
        ||
        !playerReady
    ) {{

        return null;

    }}


    try {{

        const data =
            player.getVideoData();


        return (
            data
            &&
            data.video_id
        )
        ||
        null;

    }}
    catch (_) {{

        return null;

    }}

}}


function setStatus(
    message
) {{

    document
        .getElementById(
            'status'
        )
        .textContent =
            message;

}}


function highlightPlaying(
    id
) {{

    document
        .querySelectorAll(
            '.card'
        )
        .forEach(card => {{

            card
                .classList
                .toggle(
                    'playing',
                    card.dataset.videoId
                    ===
                    id
                );

        });

}}


const youtubeScript =
document.createElement(
    'script'
);


youtubeScript.src =
'https://www.youtube.com/iframe_api';


document.head.appendChild(
    youtubeScript
);


function onYouTubeIframeAPIReady() {{

    if (
        VIDEOS.length === 0
    ) {{

        setStatus(
            'Nenhum vídeo disponível.'
        );

        return;

    }}


    const firstEmbeddable =
        VIDEOS.find(
            video =>
                video.embeddable
        );


    if (!firstEmbeddable) {{

        setStatus(
            'Nenhum vídeo pode ser '
            + 'reproduzido dentro da página.'
        );

        return;

    }}


    player =
    new YT.Player(

        'player',

        {{

            videoId:
                firstEmbeddable.id,

            width:
                '100%',

            height:
                '100%',

            playerVars: {{

                rel: 0,

                playsinline: 1

            }},

            events: {{

                onReady:
                    () => {{

                        playerReady = true;

                        rebuildPlaylist();

                    }},


                onStateChange:
                    event => {{

                        if (
                            event.data
                            ===
                            YT.PlayerState.PLAYING
                        ) {{

                            const id =
                                getCurrentVideoId();


                            if (id) {{

                                highlightPlaying(
                                    id
                                );

                            }}

                        }}


                        if (
                            event.data
                            ===
                            YT.PlayerState.ENDED
                        ) {{

                            const id =
                                getCurrentVideoId();


                            if (id) {{

                                /*
                                 * Só recebe 👁️ quando
                                 * realmente chega ao fim.
                                 */
                                markWatched(
                                    id
                                );

                            }}


                            next(true);

                        }}

                    }},


                onError:
                    () => {{

                        setStatus(
                            'Vídeo indisponível '
                            + 'no player. Pulando...'
                        );


                        setTimeout(
                            () =>
                                next(true),
                            800
                        );

                    }}

            }}

        }}

    );

}}


function playIndex(
    index
) {{

    if (
        !playerReady
        ||
        activePlaylist.length === 0
    ) {{

        setStatus(
            'Nenhum vídeo reproduzível '
            + 'neste filtro.'
        );

        return;

    }}


    if (
        index < 0
        ||
        index >=
        activePlaylist.length
    ) {{

        return;

    }}


    currentIndex =
        index;


    const id =
        activePlaylist[
            currentIndex
        ];


    player.loadVideoById(
        id
    );


    highlightPlaying(
        id
    );


    setStatus(

        'Reproduzindo '

        +

        (currentIndex + 1)

        +

        ' de '

        +

        activePlaylist.length

    );

}}


function start() {{

    rebuildPlaylist();


    if (
        activePlaylist.length === 0
    ) {{

        setStatus(
            'Nenhum vídeo reproduzível '
            + 'neste filtro.'
        );

        return;

    }}


    const current =
        getCurrentVideoId();


    if (
        current
        &&
        activePlaylist.includes(
            current
        )
    ) {{

        currentIndex =
            activePlaylist.indexOf(
                current
            );

    }}
    else {{

        currentIndex = 0;

    }}


    playIndex(
        currentIndex
    );

}}


function next(
    automatic = false
) {{

    rebuildPlaylist();


    const current =
        getCurrentVideoId();


    if (
        current
        &&
        activePlaylist.includes(
            current
        )
    ) {{

        currentIndex =
            activePlaylist.indexOf(
                current
            );

    }}


    const nextIndex =
        currentIndex + 1;


    if (
        nextIndex
        >=
        activePlaylist.length
    ) {{

        setStatus(
            automatic
            ?
            'Fim do Jornal.'
            :
            'Você chegou ao último vídeo.'
        );

        return;

    }}


    playIndex(
        nextIndex
    );

}}


function prev() {{

    rebuildPlaylist();


    const current =
        getCurrentVideoId();


    if (
        current
        &&
        activePlaylist.includes(
            current
        )
    ) {{

        currentIndex =
            activePlaylist.indexOf(
                current
            );

    }}


    if (
        currentIndex <= 0
    ) {{

        setStatus(
            'Você está no primeiro vídeo.'
        );

        return;

    }}


    playIndex(
        currentIndex - 1
    );

}}


function openVideo(
    id
) {{

    const video =
        VIDEOS.find(
            item =>
                item.id === id
        );


    if (!video) {{
        return;
    }}


    if (
        !video.embeddable
    ) {{

        window.open(

            'https://www.youtube.com/watch?v='
            +
            encodeURIComponent(id),

            '_blank',

            'noopener'

        );


        return;

    }}


    rebuildPlaylist();


    const index =
        activePlaylist.indexOf(
            id
        );


    if (
        index >= 0
    ) {{

        playIndex(
            index
        );


        window.scrollTo({{

            top: 0,

            behavior:
                'smooth'

        }});

    }}

}}


/*
==========================================================
 AVISO DE NOVA VERSÃO
==========================================================

 A página NÃO recarrega sozinha.

 A cada 2 minutos apenas verifica
 se o GitHub Pages publicou uma
 versão mais recente.

 Se houver, aparece um aviso.
==========================================================
*/

async function checkForUpdate() {{

    try {{

        const url =
            new URL(
                window.location.href
            );


        url.searchParams.set(
            '_check',
            Date.now()
        );


        const response =
            await fetch(
                url.toString(),
                {{
                    cache:
                        'no-store'
                }}
            );


        if (!response.ok) {{
            return;
        }}


        const text =
            await response.text();


        const documentCopy =
            new DOMParser()
            .parseFromString(
                text,
                'text/html'
            );


        const meta =
            documentCopy
            .querySelector(
                'meta[name="journal-version"]'
            );


        if (!meta) {{
            return;
        }}


        const remoteVersion =
            meta.content;


        if (
            !remoteVersion
            ||
            remoteVersion
            ===
            CURRENT_VERSION
        ) {{

            return;

        }}


        let newSinceOpen = 0;


        const dataElement =
            documentCopy
            .getElementById(
                'journal-data'
            );


        if (dataElement) {{

            try {{

                const remoteData =
                    JSON.parse(
                        dataElement
                            .textContent
                    );


                const remoteIds =
                    remoteData.videos
                    .map(
                        video =>
                            video.id
                    );


                newSinceOpen =
                    remoteIds
                    .filter(
                        id =>
                            !CURRENT_ID_SET
                                .has(id)
                    )
                    .length;

            }}
            catch (_) {{}}

        }}


        const banner =
            document
            .getElementById(
                'update-banner'
            );


        const message =
            document
            .getElementById(
                'update-message'
            );


        if (
            newSinceOpen > 0
        ) {{

            message.textContent =

                '🔔 Há uma versão mais recente '
                + 'do Jornal — '
                + newSinceOpen
                + (
                    newSinceOpen === 1
                    ?
                    ' vídeo novo.'
                    :
                    ' vídeos novos.'
                );

        }}
        else {{

            message.textContent =
                '🔔 Há uma versão mais recente '
                + 'do Jornal.';

        }}


        banner.classList.add(
            'show'
        );

    }}
    catch (_) {{

        /*
         * Uma falha nesta verificação
         * não interfere no player.
         */

    }}

}}


/*
 * Verifica a cada 2 minutos.
 */
setInterval(
    checkForUpdate,
    2 * 60 * 1000
);


/*
 * Primeira verificação depois
 * de 30 segundos.
 */
setTimeout(
    checkForUpdate,
    30 * 1000
);


/*
==========================================================
 INICIALIZA FILTRO
==========================================================
*/

setFilter(
    currentFilter
);

</script>

</body>

</html>
'''


# ==========================================================
# MAIN
# ==========================================================

def main():

    api_key = os.environ.get(
        "YOUTUBE_API_KEY",
        "",
    ).strip()

    if not api_key:

        raise RuntimeError(
            "Secret YOUTUBE_API_KEY ausente."
        )

    channels = load_channels()

    log(
        f"{len(channels)} "
        "canais carregados."
    )

    (
        videos,
        now_local,
        failures,
    ) = collect(
        api_key,
        channels,
    )

    log(
        f"{len(videos)} "
        "vídeos válidos encontrados."
    )

    with open(
        "index.html",
        "w",
        encoding="utf-8",
        newline="\n",
    ) as file:

        file.write(
            build_page(
                videos,
                now_local,
                failures,
            )
        )

    log(
        "index.html atualizado."
    )


if __name__ == "__main__":

    main()
