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


API = "https://www.googleapis.com/youtube/v3"
OEMBED = "https://www.youtube.com/oembed"

TZ = ZoneInfo("America/Fortaleza")
UTC = ZoneInfo("UTC")

RESET_HOUR = 4
WINDOW_HOURS = 24

MAX_RETRIES = 5

RETRYABLE = {
    429,
    500,
    502,
    503,
    504
}


def log(msg):

    print(
        f"[{datetime.now(TZ):%H:%M:%S}] {msg}",
        flush=True
    )


def get_json(
    url,
    params=None,
    retries=MAX_RETRIES
):

    if params:

        url += (
            "&" if "?" in url else "?"
        ) + urlencode(params)


    last = None


    for attempt in range(
        1,
        retries + 1
    ):

        try:

            req = Request(
                url,
                headers={
                    "User-Agent":
                        "JornalDoFutebol/1.0",

                    "Accept":
                        "application/json"
                }
            )


            with urlopen(
                req,
                timeout=25
            ) as response:

                return json.loads(
                    response
                    .read()
                    .decode("utf-8")
                )


        except HTTPError as erro:

            body = ""

            try:

                body = (
                    erro
                    .read()
                    .decode(
                        "utf-8",
                        errors="replace"
                    )
                )

            except Exception:

                pass


            last = RuntimeError(
                f"HTTP {erro.code}: "
                f"{body[:400]}"
            )


            if (
                erro.code
                not in RETRYABLE
                or
                attempt == retries
            ):

                raise last


        except (
            URLError,
            TimeoutError,
            ConnectionError
        ) as erro:

            last = erro


            if attempt == retries:

                raise


        wait = min(
            2 ** attempt,
            30
        )


        log(
            "Falha temporária; "
            f"nova tentativa em {wait}s "
            f"({attempt}/{retries})."
        )


        time.sleep(wait)


    raise (
        last
        or RuntimeError(
            "Falha de rede desconhecida."
        )
    )


def yt(
    resource,
    key,
    **params
):

    params["key"] = key


    return get_json(
        f"{API}/{resource}",
        params
    )


def load_channels():

    with open(
        "channels.json",
        encoding="utf-8"
    ) as file:

        raw = json.load(file)


    out = []

    seen = set()


    for item in raw:

        handle = str(
            item.get(
                "handle",
                ""
            )
        ).strip()


        if not handle:

            continue


        if not handle.startswith("@"):

            handle = "@" + handle


        if (
            handle.casefold()
            in seen
        ):

            continue


        seen.add(
            handle.casefold()
        )


        out.append({

            "handle":
                handle,

            "onlyShorts":
                bool(
                    item.get(
                        "onlyShorts",
                        False
                    )
                )

        })


    if not out:

        raise RuntimeError(
            "channels.json não contém "
            "canais válidos."
        )


    return out


def resolve_channel(
    key,
    config
):

    data = yt(

        "channels",

        key,

        part=
            "id,snippet,contentDetails",

        forHandle=
            config["handle"],

        maxResults=1

    )


    if not data.get("items"):

        raise RuntimeError(
            "Canal não encontrado: "
            + config["handle"]
        )


    channel = data["items"][0]


    uploads = (
        channel
        .get(
            "contentDetails",
            {}
        )
        .get(
            "relatedPlaylists",
            {}
        )
        .get(
            "uploads"
        )
    )


    if not uploads:

        raise RuntimeError(
            "Uploads não encontrados: "
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
            uploads

    }


def parse_dt(value):

    return datetime.fromisoformat(
        value.replace(
            "Z",
            "+00:00"
        )
    )


def recent_uploads(
    key,
    channel,
    start,
    now_utc
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
                50

        }


        if token:

            params[
                "pageToken"
            ] = token


        data = yt(
            "playlistItems",
            key,
            **params
        )


        items = data.get(
            "items",
            []
        )


        if not items:

            break


        found_old = False


        for item in items:

            details = item.get(
                "contentDetails",
                {}
            )


            video_id = details.get(
                "videoId"
            )


            published = details.get(
                "videoPublishedAt"
            )


            if (
                not video_id
                or
                not published
            ):

                continue


            date = parse_dt(
                published
            )


            if date < start:

                found_old = True

                continue


            if date > now_utc:

                continue


            result.append({

                "videoId":
                    video_id,

                "publishedAt":
                    published,

                "publishedDt":
                    date,

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
                    ]

            })


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
    size=50
):

    for i in range(
        0,
        len(sequence),
        size
    ):

        yield sequence[
            i:i + size
        ]


def duration_seconds(
    value
):

    match = re.fullmatch(

        r"P(?:(\d+)D)?T"
        r"(?:(\d+)H)?"
        r"(?:(\d+)M)?"
        r"(?:(\d+)S)?",

        value or ""

    )


    if not match:

        return None


    days, hours, minutes, seconds = [

        int(
            value or 0
        )

        for value
        in match.groups()

    ]


    return (

        days * 86400

        +

        hours * 3600

        +

        minutes * 60

        +

        seconds

    )


def short_confirmed(
    video_id,
    video
):

    seconds = duration_seconds(

        video
        .get(
            "contentDetails",
            {}
        )
        .get(
            "duration"
        )

    )


    if (
        seconds is None
        or
        seconds > 180
    ):

        return False


    try:

        data = get_json(

            OEMBED,

            {

                "url":
                    "https://www.youtube.com/"
                    "watch?v="
                    + video_id,

                "format":
                    "json"

            },

            retries=3

        )


        width = int(
            data.get(
                "width",
                0
            )
        )


        height = int(
            data.get(
                "height",
                0
            )
        )


        return (

            width > 0

            and

            height > 0

            and

            width <= height

        )


    except Exception as erro:

        log(
            "Short não confirmado "
            f"({video_id}): "
            f"{erro}"
        )


        return False


def collect(
    key,
    configs
):

    now_local = datetime.now(
        TZ
    )


    now_utc = (
        now_local
        .astimezone(
            UTC
        )
    )


    start = (

        now_utc

        -

        timedelta(
            hours=
                WINDOW_HOURS
        )

    )


    candidates = {}

    failures = []

    successful_channels = 0


    for config in configs:

        try:

            channel = resolve_channel(
                key,
                config
            )


            successful_channels += 1


            log(

                "CANAL OK: "

                +

                channel[
                    "channelTitle"
                ]

                +

                " ["

                +

                (
                    "SOMENTE SHORTS"

                    if
                    channel[
                        "onlyShorts"
                    ]

                    else

                    "TODOS"
                )

                +

                "]"

            )


            uploads = recent_uploads(

                key,

                channel,

                start,

                now_utc

            )


            for item in uploads:

                candidates[
                    item["videoId"]
                ] = item


        except Exception as erro:

            failures.append(

                f"{config['handle']}: "
                f"{erro}"

            )


            log(

                "AVISO: "

                +

                config[
                    "handle"
                ]

                +

                ": "

                +

                str(erro)

            )


    if successful_channels == 0:

        raise RuntimeError(

            "Nenhum canal pôde ser "
            "consultado. "
            "Verifique a API Key."

        )


    if (

        len(failures)

        >

        max(
            3,
            len(configs) // 4
        )

    ):

        raise RuntimeError(

            "Muitos canais falharam; "
            "preservando o site anterior."

        )


    details = {}


    ids = list(
        candidates
    )


    for batch in chunks(
        ids
    ):

        data = yt(

            "videos",

            key,

            part=
                "snippet,"
                "contentDetails,"
                "liveStreamingDetails,"
                "status",

            id=
                ",".join(batch),

            maxResults=50

        )


        for video in data.get(
            "items",
            []
        ):

            details[
                video["id"]
            ] = video


    accepted = []


    for (
        video_id,
        candidate
    ) in candidates.items():

        video = details.get(
            video_id
        )


        if not video:

            continue


        snippet = video.get(
            "snippet",
            {}
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


        # Exclui lives futuras,
        # atuais e encerradas.
        if video.get(
            "liveStreamingDetails"
        ):

            log(

                "LIVE EXCLUÍDA: "

                +

                snippet.get(
                    "title",
                    video_id
                )

            )


            continue


        # Nos canais onlyShorts=true,
        # somente Shorts confirmados entram.
        if (

            candidate[
                "onlyShorts"
            ]

            and

            not short_confirmed(
                video_id,
                video
            )

        ):

            log(

                "NÃO ENTROU — "
                "SOMENTE SHORTS: "

                +

                snippet.get(
                    "title",
                    video_id
                )

            )


            continue


        accepted.append({

            "videoId":
                video_id,

            "title":
                snippet.get(
                    "title",
                    "Sem título"
                ),

            "channelTitle":
                snippet.get(

                    "channelTitle",

                    candidate[
                        "channelTitle"
                    ]

                ),

            "publishedDt":
                candidate[
                    "publishedDt"
                ],

            "embeddable":
                bool(

                    video
                    .get(
                        "status",
                        {}
                    )
                    .get(
                        "embeddable",
                        True
                    )

                )

        })


    accepted.sort(
        key=lambda item:
            item[
                "publishedDt"
            ]
    )


    return (
        accepted,
        now_local,
        failures
    )


def journal_day(
    now_local
):

    if (
        now_local.hour
        >=
        RESET_HOUR
    ):

        reference = (
            now_local
        )


    else:

        reference = (

            now_local

            -

            timedelta(
                days=1
            )

        )


    return reference.strftime(
        "%d/%m/%Y"
    )


def js_json(
    obj
):

    return (

        json.dumps(
            obj,
            ensure_ascii=False
        )

        .replace(
            "<",
            "\\u003c"
        )

        .replace(
            ">",
            "\\u003e"
        )

        .replace(
            "&",
            "\\u0026"
        )

    )


def build_page(
    videos,
    now_local,
    failures
):

    date = journal_day(
        now_local
    )


    updated = now_local.strftime(
        "%d/%m/%Y às %H:%M"
    )


    player_ids = [

        video[
            "videoId"
        ]

        for video
        in videos

        if video[
            "embeddable"
        ]

    ]


    cards = []


    for video in videos:

        published = (

            video[
                "publishedDt"
            ]

            .astimezone(
                TZ
            )

            .strftime(
                "%H:%M"
            )

        )


        badge = ""


        if not video[
            "embeddable"
        ]:

            badge = (

                "<small>"
                "Não incorporável — "
                "abre no YouTube"
                "</small>"

            )


        cards.append(

            f'''

<button
    class="card"
    onclick="openVideo('{html.escape(video["videoId"])}')"
>

<img
    src="https://i.ytimg.com/vi/{html.escape(video["videoId"])}/mqdefault.jpg"
    alt=""
    loading="lazy"
>

<span>

<b>
{html.escape(video["title"])}
</b>

<em>
{html.escape(video["channelTitle"])}
 ·
{published}
</em>

{badge}

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

            +

            str(
                len(failures)
            )

            +

            ' canal(is) falharam '
            'nesta atualização; '
            'serão tentados novamente.'

            '</p>'

        )


    return f'''<!doctype html>

<html lang="pt-BR">

<head>

<meta charset="utf-8">

<meta
    name="viewport"
    content="width=device-width,initial-scale=1"
>

<title>
Jornal do Futebol — {date}
</title>

<style>

* {{
    box-sizing: border-box;
}}

body {{
    margin: 0;
    background: #0f1115;
    color: #f2f3f5;
    font:
        15px
        system-ui,
        -apple-system,
        Segoe UI,
        sans-serif;
}}

main {{
    max-width: 1050px;
    margin: auto;
    padding: 24px 14px 50px;
}}

h1 {{
    margin: 0;
    font-size:
        clamp(
            26px,
            5vw,
            40px
        );
}}

.meta,
em,
small {{
    color: #aeb4bd;
    font-style: normal;
}}

.playerbox,
.card {{
    background: #181b22;
    border:
        1px solid
        #303641;
    border-radius: 14px;
}}

.playerbox {{
    padding: 12px;
    margin: 20px 0;
}}

#playerwrap {{
    aspect-ratio:
        16 / 9;
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

#status {{
    color: #aeb4bd;
    margin-top: 9px;
}}

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
    color: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
}}

.card img {{
    width: 150px;
    aspect-ratio:
        16 / 9;
    object-fit: cover;
}}

.card span {{
    padding:
        10px
        12px
        10px
        0;

    display: grid;
    gap: 5px;
    align-content: center;
}}

.card b {{
    line-height: 1.25;
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

@media (
    max-width: 600px
) {{

    .card {{
        grid-template-columns:
            110px 1fr;
    }}

    .card img {{
        width: 110px;
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

<button onclick="next()">
Próximo ⏭
</button>

</div>


<div id="status">
Clique em “Começar jornal”
para reproduzir em ordem cronológica.
</div>

</section>


{warning}


<h2>
Vídeos ({len(videos)})
</h2>


<section class="list">

{cards_html}

</section>

</main>


<script>

const playlist =
{js_json(player_ids)};

let i = 0;

let player = null;

let ready = false;


const tag =
document.createElement(
    'script'
);

tag.src =
'https://www.youtube.com/iframe_api';

document.head.appendChild(
    tag
);


function setStatus(
    text
) {{

    document
        .getElementById(
            'status'
        )
        .textContent =
            text;

}}


function onYouTubeIframeAPIReady() {{

    if (
        !playlist.length
    ) {{

        setStatus(
            'Nenhum vídeo reproduzível no player.'
        );

        return;

    }}


    player =
    new YT.Player(

        'player',

        {{

            videoId:
                playlist[0],

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
                    () =>
                        ready = true,

                onStateChange:
                    event => {{

                        if (
                            event.data
                            ===
                            YT.PlayerState.ENDED
                        ) {{

                            next();

                        }}

                    }},

                onError:
                    () => {{

                        setStatus(
                            'Vídeo indisponível aqui; pulando...'
                        );

                        setTimeout(
                            next,
                            700
                        );

                    }}

            }}

        }}

    );

}}


function play(
    index
) {{

    if (
        !playlist.length
        ||
        !ready
    ) {{

        return;

    }}


    i =
        (
            index
            +
            playlist.length
        )
        %
        playlist.length;


    player.loadVideoById(
        playlist[i]
    );


    setStatus(

        'Reproduzindo '

        +

        (i + 1)

        +

        ' de '

        +

        playlist.length

    );

}}


function start() {{

    play(i);

}}


function next() {{

    play(
        i + 1
    );

}}


function prev() {{

    play(
        i - 1
    );

}}


function openVideo(
    id
) {{

    const index =
        playlist.indexOf(
            id
        );


    if (
        index >= 0
    ) {{

        play(
            index
        );


        scrollTo({{

            top: 0,

            behavior:
                'smooth'

        }});


        return;

    }}


    window.open(

        'https://www.youtube.com/watch?v='
        +
        encodeURIComponent(
            id
        ),

        '_blank',

        'noopener'

    );

}}

</script>

</body>

</html>
'''


def main():

    key = os.environ.get(
        "YOUTUBE_API_KEY",
        ""
    ).strip()


    if not key:

        raise RuntimeError(
            "Secret YOUTUBE_API_KEY ausente."
        )


    channels = load_channels()


    log(
        f"{len(channels)} "
        "canais carregados."
    )


    videos, now_local, failures = (
        collect(
            key,
            channels
        )
    )


    log(
        f"{len(videos)} "
        "vídeos válidos encontrados."
    )


    with open(

        "index.html",

        "w",

        encoding="utf-8",

        newline="\n"

    ) as file:

        file.write(

            build_page(
                videos,
                now_local,
                failures
            )

        )


    log(
        "index.html atualizado."
    )


if __name__ == "__main__":

    main()
