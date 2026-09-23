import os
import json
import time
import html
import re

from collections import OrderedDict
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
RETRYABLE = {429, 500, 502, 503, 504}


def log(msg):
    print(f"[{datetime.now(TZ):%H:%M:%S}] {msg}", flush=True)


def get_json(url, params=None, retries=MAX_RETRIES):
    if params:
        url += ("&" if "?" in url else "?") + urlencode(params)

    last = None

    for attempt in range(1, retries + 1):
        try:
            req = Request(
                url,
                headers={
                    "User-Agent": "JornalDoFutebol/1.2",
                    "Accept": "application/json",
                },
            )

            with urlopen(req, timeout=25) as response:
                return json.loads(response.read().decode("utf-8"))

        except HTTPError as erro:
            body = ""
            try:
                body = erro.read().decode("utf-8", errors="replace")
            except Exception:
                pass

            last = RuntimeError(f"HTTP {erro.code}: {body[:400]}")

            if erro.code not in RETRYABLE or attempt == retries:
                raise last

        except (URLError, TimeoutError, ConnectionError) as erro:
            last = erro
            if attempt == retries:
                raise

        wait = min(2 ** attempt, 30)
        log(
            "Falha temporária; "
            f"nova tentativa em {wait}s "
            f"({attempt}/{retries})."
        )
        time.sleep(wait)

    raise last or RuntimeError("Falha de rede desconhecida.")


def yt(resource, key, **params):
    params["key"] = key
    return get_json(f"{API}/{resource}", params)


def load_channels():
    with open("channels.json", encoding="utf-8") as file:
        raw = json.load(file)

    out = []
    seen = set()

    for item in raw:
        handle = str(item.get("handle", "")).strip()

        if not handle:
            continue

        if not handle.startswith("@"):
            handle = "@" + handle

        if handle.casefold() in seen:
            continue

        seen.add(handle.casefold())
        out.append(
            {
                "handle": handle,
                "onlyShorts": bool(item.get("onlyShorts", False)),
            }
        )

    if not out:
        raise RuntimeError("channels.json não contém canais válidos.")

    return out


def resolve_channel(key, config):
    data = yt(
        "channels",
        key,
        part="id,snippet,contentDetails",
        forHandle=config["handle"],
        maxResults=1,
    )

    if not data.get("items"):
        raise RuntimeError("Canal não encontrado: " + config["handle"])

    channel = data["items"][0]
    uploads = (
        channel.get("contentDetails", {})
        .get("relatedPlaylists", {})
        .get("uploads")
    )

    if not uploads:
        raise RuntimeError("Uploads não encontrados: " + config["handle"])

    return {
        **config,
        "channelId": channel["id"],
        "channelTitle": channel["snippet"]["title"],
        "uploads": uploads,
    }


def parse_dt(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def recent_uploads(key, channel, start, now_utc):
    result = []
    token = None

    while True:
        params = {
            "part": "contentDetails",
            "playlistId": channel["uploads"],
            "maxResults": 50,
        }

        if token:
            params["pageToken"] = token

        data = yt("playlistItems", key, **params)
        items = data.get("items", [])

        if not items:
            break

        found_old = False

        for item in items:
            details = item.get("contentDetails", {})
            video_id = details.get("videoId")
            published = details.get("videoPublishedAt")

            if not video_id or not published:
                continue

            date = parse_dt(published)

            if date < start:
                found_old = True
                continue

            if date > now_utc:
                continue

            result.append(
                {
                    "videoId": video_id,
                    "publishedAt": published,
                    "publishedDt": date,
                    "channelId": channel["channelId"],
                    "channelTitle": channel["channelTitle"],
                    "onlyShorts": channel["onlyShorts"],
                }
            )

        if found_old:
            break

        token = data.get("nextPageToken")
        if not token:
            break

    return result


def chunks(sequence, size=50):
    for i in range(0, len(sequence), size):
        yield sequence[i:i + size]


def duration_seconds(value):
    match = re.fullmatch(
        r"P(?:(\d+)D)?T"
        r"(?:(\d+)H)?"
        r"(?:(\d+)M)?"
        r"(?:(\d+)S)?",
        value or "",
    )

    if not match:
        return None

    days, hours, minutes, seconds = [int(value or 0) for value in match.groups()]

    return (
        days * 86400
        + hours * 3600
        + minutes * 60
        + seconds
    )


def short_confirmed(video_id, video):
    seconds = duration_seconds(
        video.get("contentDetails", {}).get("duration")
    )

    if seconds is None or seconds > 180:
        return False

    try:
        data = get_json(
            OEMBED,
            {
                "url": "https://www.youtube.com/shorts/" + video_id,
                "format": "json",
            },
            retries=3,
        )

        width = int(data.get("width", 0))
        height = int(data.get("height", 0))

        return width > 0 and height > 0 and width <= height

    except Exception as erro:
        log(f"Short não confirmado ({video_id}): {erro}")
        return False


def collect(key, configs):
    now_local = datetime.now(TZ)
    now_utc = now_local.astimezone(UTC)
    start = now_utc - timedelta(hours=WINDOW_HOURS)

    candidates = {}
    failures = []
    successful_channels = 0

    for config in configs:
        try:
            channel = resolve_channel(key, config)
            successful_channels += 1

            log(
                "CANAL OK: "
                + channel["channelTitle"]
                + " ["
                + ("SOMENTE SHORTS" if channel["onlyShorts"] else "TODOS")
                + "]"
            )

            uploads = recent_uploads(key, channel, start, now_utc)

            for item in uploads:
                candidates[item["videoId"]] = item

        except Exception as erro:
            failures.append(f"{config['handle']}: {erro}")
            log("AVISO: " + config["handle"] + ": " + str(erro))

    if successful_channels == 0:
        raise RuntimeError(
            "Nenhum canal pôde ser consultado. Verifique a API Key."
        )

    if len(failures) > max(3, len(configs) // 4):
        raise RuntimeError(
            "Muitos canais falharam; preservando o site anterior."
        )

    details = {}
    ids = list(candidates)

    for batch in chunks(ids):
        data = yt(
            "videos",
            key,
            part="snippet,contentDetails,liveStreamingDetails,status",
            id=",".join(batch),
            maxResults=50,
        )

        for video in data.get("items", []):
            details[video["id"]] = video

    accepted = []

    for video_id, candidate in candidates.items():
        video = details.get(video_id)

        if not video:
            continue

        snippet = video.get("snippet", {})

        if snippet.get("channelId") != candidate["channelId"]:
            continue

        if video.get("liveStreamingDetails"):
            log("LIVE EXCLUÍDA: " + snippet.get("title", video_id))
            continue

        if candidate["onlyShorts"] and not short_confirmed(video_id, video):
            log(
                "NÃO ENTROU — SOMENTE SHORTS: "
                + snippet.get("title", video_id)
            )
            continue

        accepted.append(
            {
                "videoId": video_id,
                "title": snippet.get("title", "Sem título"),
                "channelTitle": snippet.get(
                    "channelTitle",
                    candidate["channelTitle"],
                ),
                "publishedDt": candidate["publishedDt"],
                "embeddable": bool(
                    video.get("status", {}).get("embeddable", True)
                ),
            }
        )

    accepted.sort(key=lambda item: item["publishedDt"])

    return accepted, now_local, failures


def journal_day(now_local):
    reference = (
        now_local
        if now_local.hour >= RESET_HOUR
        else now_local - timedelta(days=1)
    )

    return reference.strftime("%d/%m/%Y")


def js_json(obj):
    return (
        json.dumps(obj, ensure_ascii=False)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
    )


def chapter_label(video_dt, now_local):
    local_dt = video_dt.astimezone(TZ)

    today = now_local.date()
    yesterday = today - timedelta(days=1)

    if local_dt.date() == today:
        day_label = "Hoje"
    elif local_dt.date() == yesterday:
        day_label = "Ontem"
    else:
        day_label = local_dt.strftime("%d/%m")

    hour = local_dt.hour

    if 0 <= hour < 6:
        period = "Madrugada"
    elif 6 <= hour < 12:
        period = "Manhã"
    elif 12 <= hour < 18:
        period = "Tarde"
    else:
        period = "Noite"

    return f"{day_label} • {period}"


def build_page(videos, now_local, failures):
    date = journal_day(now_local)
    updated = now_local.strftime("%d/%m/%Y às %H:%M")

    player_videos = [
        {
            "id": video["videoId"],
            "embeddable": video["embeddable"],
        }
        for video in videos
    ]

    chapters = OrderedDict()

    for video in videos:
        label = chapter_label(video["publishedDt"], now_local)
        chapters.setdefault(label, []).append(video)

    chapter_html_parts = []

    for chapter_index, (label, chapter_videos) in enumerate(chapters.items()):
        cards = []

        for video in chapter_videos:
            published = (
                video["publishedDt"]
                .astimezone(TZ)
                .strftime("%H:%M")
            )

            badge = ""

            if not video["embeddable"]:
                badge = (
                    "<small>"
                    "Não incorporável — abre no YouTube"
                    "</small>"
                )

            video_id = html.escape(video["videoId"])
            title = html.escape(video["title"])
            channel_title = html.escape(video["channelTitle"])

            card = """
<button
    class="card"
    data-video-id="__VIDEO_ID__"
    onclick="openVideo('__VIDEO_ID__')"
>

<div class="thumbbox">

<img
    src="https://i.ytimg.com/vi/__VIDEO_ID__/mqdefault.jpg"
    alt=""
    loading="lazy"
>

<span class="resume-badge">
▶ CONTINUAR AQUI
</span>

<span class="playing-badge">
▶ AGORA
</span>

</div>

<span class="card-info">

<b>__TITLE__</b>

<em>
__CHANNEL_TITLE__ · __PUBLISHED__
</em>

__BADGE__

</span>

</button>
"""

            card = (
                card
                .replace("__VIDEO_ID__", video_id)
                .replace("__TITLE__", title)
                .replace("__CHANNEL_TITLE__", channel_title)
                .replace("__PUBLISHED__", published)
                .replace("__BADGE__", badge)
            )

            cards.append(card)

        chapter_html_parts.append(
            """
<section class="chapter" data-chapter="__CHAPTER_INDEX__">

<h2 class="chapter-title">
__CHAPTER_LABEL__
<span class="chapter-count">(__CHAPTER_COUNT__)</span>
</h2>

<div class="list">
__CARDS__
</div>

</section>
"""
            .replace("__CHAPTER_INDEX__", str(chapter_index))
            .replace("__CHAPTER_LABEL__", html.escape(label))
            .replace("__CHAPTER_COUNT__", str(len(chapter_videos)))
            .replace("__CARDS__", "\n".join(cards))
        )

    chapters_html = "\n".join(chapter_html_parts)

    if not chapters_html:
        chapters_html = (
            '<p class="empty">'
            'Nenhum vídeo válido nas últimas 24 horas.'
            '</p>'
        )

    warning = ""

    if failures:
        warning = (
            '<p class="warn">'
            + str(len(failures))
            + ' canal(is) falharam nesta atualização; '
            'serão tentados novamente.'
            '</p>'
        )

    page = r'''<!doctype html>

<html lang="pt-BR">

<head>

<meta charset="utf-8">

<meta
    name="viewport"
    content="width=device-width,initial-scale=1"
>

<title>
Jornal do Futebol — __DATE__
</title>

<style>

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    background: #0f1115;
    color: #f2f3f5;
    font:
        15px
        system-ui,
        -apple-system,
        Segoe UI,
        sans-serif;
}

main {
    max-width: 1050px;
    margin: auto;
    padding: 24px 14px 50px;
}

h1 {
    margin: 0;
    font-size:
        clamp(
            26px,
            5vw,
            40px
        );
}

.meta,
em,
small {
    color: #aeb4bd;
    font-style: normal;
}

.playerbox,
.card {
    background: #181b22;
    border:
        1px solid
        #303641;
    border-radius: 14px;
}

.playerbox {
    padding: 12px;
    margin: 20px 0;
}

#playerwrap {
    aspect-ratio: 16 / 9;
    background: #000;
    border-radius: 10px;
    overflow: hidden;
}

#player {
    width: 100%;
    height: 100%;
}

.controls {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 10px;
}

.controls button,
.view-toggle {
    background: #242933;
    color: white;
    border:
        1px solid
        #3a414d;
    border-radius: 9px;
    padding: 9px 12px;
    cursor: pointer;
}

.view-toggle.active {
    background: #f2f3f5;
    color: #111;
    border-color: #f2f3f5;
    font-weight: 700;
}

#status {
    color: #aeb4bd;
    margin-top: 9px;
}

.resume-info {
    display: none;
    margin-top: 10px;
    padding: 9px 11px;
    border-radius: 9px;
    background: #222a34;
    border:
        1px solid
        #47586d;
    color: #e5ebf2;
}

.resume-info.show {
    display: block;
}

.toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin: 22px 0 6px;
}

.toolbar-info {
    color: #aeb4bd;
}

.chapter {
    margin-top: 24px;
}

.chapter.hidden {
    display: none;
}

.chapter-title {
    margin: 0 0 10px;
    font-size: 20px;
    display: flex;
    align-items: baseline;
    gap: 7px;
}

.chapter-count {
    color: #88919c;
    font-size: 14px;
    font-weight: 500;
}

.list {
    display: grid;
    gap: 9px;
}

.card {
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
    transition:
        border-color .15s,
        background .15s,
        box-shadow .15s,
        opacity .15s;
}

.card:hover {
    background: #1e222a;
}

.card.hidden {
    display: none;
}

.card.current {
    border-color: #67a9ff;
    box-shadow:
        0 0 0 1px
        #67a9ff;
}

.card.resume:not(.current) {
    border-color: #d99d43;
    box-shadow:
        0 0 0 1px
        rgba(
            217,
            157,
            67,
            .45
        );
}

.thumbbox {
    position: relative;
    width: 150px;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    background: #000;
}

.thumbbox img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.card-info {
    padding:
        10px
        12px
        10px
        0;
    display: grid;
    gap: 5px;
    align-content: center;
}

.card b {
    line-height: 1.25;
}

.resume-badge,
.playing-badge {
    display: none;
    position: absolute;
    left: 6px;
    bottom: 6px;
    padding: 4px 7px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 800;
    color: white;
}

.resume-badge {
    background:
        rgba(
            181,
            115,
            26,
            .94
        );
}

.playing-badge {
    background:
        rgba(
            32,
            115,
            205,
            .95
        );
}

.card.resume:not(.current)
.resume-badge {
    display: block;
}

.card.current
.playing-badge {
    display: block;
}

.warn {
    background: #292411;
    border:
        1px solid
        #665b27;
    padding: 10px;
    border-radius: 9px;
    color: #eadc9b;
}

.empty,
.no-unwatched {
    color: #aeb4bd;
}

.no-unwatched {
    display: none;
    padding: 18px 0;
}

.no-unwatched.show {
    display: block;
}

@media (
    max-width: 600px
) {

    .card {
        grid-template-columns:
            110px 1fr;
    }

    .thumbbox {
        width: 110px;
    }
}

</style>

</head>

<body>

<main>

<h1>
⚽ Jornal do Futebol — __DATE__
</h1>

<div class="meta">
Últimas 24 horas
 ·
antigo → novo
 ·
atualizado em __UPDATED__
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

<div
    id="resume-info"
    class="resume-info"
>
</div>

</section>

__WARNING__

<div class="toolbar">

<button
    id="unwatched-toggle"
    class="view-toggle"
    onclick="toggleUnwatchedMode()"
>
Só o que ainda não vi
</button>

<span
    id="toolbar-info"
    class="toolbar-info"
>
</span>

</div>

<div
    id="no-unwatched"
    class="no-unwatched"
>
Você já concluiu todos os vídeos disponíveis deste Jornal.
</div>

__CHAPTERS_HTML__

</main>

<script>

const VIDEOS =
__PLAYER_VIDEOS__;

const ALL_EMBEDDABLE_IDS =
VIDEOS
    .filter(video => video.embeddable)
    .map(video => video.id);

const RESUME_KEY =
'jornal_do_futebol_resume_v1';

const WATCHED_KEY =
'jornal_do_futebol_watched_v1';

const UNWATCHED_MODE_KEY =
'jornal_do_futebol_only_unwatched_v1';

let player = null;
let ready = false;
let activePlaylist = [];
let i = 0;
let resumeState = null;
let watched = loadWatched();
let onlyUnwatched = loadUnwatchedMode();


function loadWatched() {
    try {
        const raw =
            localStorage.getItem(
                WATCHED_KEY
            );

        if (!raw) {
            return {};
        }

        const data = JSON.parse(raw);
        return data && typeof data === 'object'
            ? data
            : {};
    }
    catch (_) {
        return {};
    }
}


function saveWatched() {
    try {
        localStorage.setItem(
            WATCHED_KEY,
            JSON.stringify(watched)
        );
    }
    catch (_) {}
}


function markWatched(videoId) {
    if (!videoId) {
        return;
    }

    watched[videoId] = Date.now();
    saveWatched();
}


function isWatched(videoId) {
    return Boolean(watched[videoId]);
}


function loadUnwatchedMode() {
    try {
        return (
            localStorage.getItem(
                UNWATCHED_MODE_KEY
            )
            === '1'
        );
    }
    catch (_) {
        return false;
    }
}


function saveUnwatchedMode() {
    try {
        localStorage.setItem(
            UNWATCHED_MODE_KEY,
            onlyUnwatched ? '1' : '0'
        );
    }
    catch (_) {}
}


function loadResume() {
    try {
        const raw =
            localStorage.getItem(
                RESUME_KEY
            );

        if (!raw) {
            return null;
        }

        const data = JSON.parse(raw);

        if (
            !data
            ||
            !data.videoId
            ||
            !ALL_EMBEDDABLE_IDS.includes(
                data.videoId
            )
        ) {
            localStorage.removeItem(
                RESUME_KEY
            );

            return null;
        }

        return {
            videoId: data.videoId,
            seconds: Math.max(
                0,
                Number(data.seconds || 0)
            )
        };
    }
    catch (_) {
        return null;
    }
}


function saveResume(
    videoId,
    seconds
) {
    if (
        !videoId
        ||
        !ALL_EMBEDDABLE_IDS.includes(
            videoId
        )
    ) {
        return;
    }

    const data = {
        videoId: videoId,
        seconds: Math.max(
            0,
            Number(seconds || 0)
        ),
        savedAt: Date.now()
    };

    try {
        localStorage.setItem(
            RESUME_KEY,
            JSON.stringify(data)
        );
    }
    catch (_) {}

    resumeState = data;
    showResumeCard(videoId);
}


function currentTime() {
    if (!player || !ready) {
        return 0;
    }

    try {
        return Number(
            player.getCurrentTime()
        ) || 0;
    }
    catch (_) {
        return 0;
    }
}


function currentVideoId() {
    if (!player || !ready) {
        return null;
    }

    try {
        const data =
            player.getVideoData();

        return (
            data
            &&
            data.video_id
        ) || null;
    }
    catch (_) {
        return null;
    }
}


function formatTime(totalSeconds) {
    totalSeconds = Math.max(
        0,
        Math.floor(
            Number(totalSeconds || 0)
        )
    );

    const hours = Math.floor(
        totalSeconds / 3600
    );

    const minutes = Math.floor(
        (totalSeconds % 3600) / 60
    );

    const seconds =
        totalSeconds % 60;

    if (hours > 0) {
        return (
            String(hours)
            + ':'
            + String(minutes)
                .padStart(2, '0')
            + ':'
            + String(seconds)
                .padStart(2, '0')
        );
    }

    return (
        String(minutes)
        + ':'
        + String(seconds)
            .padStart(2, '0')
    );
}


function showResumeCard(videoId) {
    document
        .querySelectorAll('.card')
        .forEach(card => {
            card.classList.toggle(
                'resume',
                card.dataset.videoId
                === videoId
            );
        });
}


function showCurrentCard(videoId) {
    document
        .querySelectorAll('.card')
        .forEach(card => {
            card.classList.toggle(
                'current',
                card.dataset.videoId
                === videoId
            );
        });
}


function showResumeInfo() {
    const box =
        document.getElementById(
            'resume-info'
        );

    if (!resumeState) {
        box.classList.remove('show');
        return;
    }

    const index =
        activePlaylist.indexOf(
            resumeState.videoId
        );

    if (index < 0) {
        box.classList.remove('show');
        return;
    }

    box.textContent =
        '▶ Você parou no vídeo '
        + (index + 1)
        + ' de '
        + activePlaylist.length
        + ' — ponto salvo em '
        + formatTime(
            resumeState.seconds
        )
        + '.';

    box.classList.add('show');
}


function setStatus(text) {
    document
        .getElementById('status')
        .textContent = text;
}


function rebuildPlaylist() {
    activePlaylist =
        VIDEOS
            .filter(video =>
                video.embeddable
                &&
                (
                    !onlyUnwatched
                    ||
                    !isWatched(video.id)
                )
            )
            .map(video => video.id);

    const current =
        currentVideoId();

    if (
        current
        &&
        activePlaylist.includes(current)
    ) {
        i = activePlaylist.indexOf(
            current
        );
    }
    else if (
        resumeState
        &&
        activePlaylist.includes(
            resumeState.videoId
        )
    ) {
        i = activePlaylist.indexOf(
            resumeState.videoId
        );
    }
    else {
        i = 0;
    }
}


function applyView() {
    let visibleCount = 0;

    document
        .querySelectorAll('.card')
        .forEach(card => {
            const hidden =
                onlyUnwatched
                &&
                isWatched(
                    card.dataset.videoId
                );

            card.classList.toggle(
                'hidden',
                hidden
            );

            if (!hidden) {
                visibleCount++;
            }
        });

    document
        .querySelectorAll('.chapter')
        .forEach(chapter => {
            const visibleCards =
                chapter.querySelectorAll(
                    '.card:not(.hidden)'
                ).length;

            chapter.classList.toggle(
                'hidden',
                visibleCards === 0
            );

            const count =
                chapter.querySelector(
                    '.chapter-count'
                );

            if (count) {
                count.textContent =
                    '(' + visibleCards + ')';
            }
        });

    const toggle =
        document.getElementById(
            'unwatched-toggle'
        );

    toggle.classList.toggle(
        'active',
        onlyUnwatched
    );

    toggle.textContent =
        onlyUnwatched
        ? '✓ Só o que ainda não vi'
        : 'Só o que ainda não vi';

    document
        .getElementById('toolbar-info')
        .textContent =
            'Exibindo '
            + visibleCount
            + ' de '
            + VIDEOS.length
            + ' vídeos.';

    document
        .getElementById('no-unwatched')
        .classList.toggle(
            'show',
            visibleCount === 0
        );

    rebuildPlaylist();
    showResumeInfo();
}


function toggleUnwatchedMode() {
    onlyUnwatched =
        !onlyUnwatched;

    saveUnwatchedMode();
    applyView();
}


const tag =
document.createElement('script');

tag.src =
'https://www.youtube.com/iframe_api';

document.head.appendChild(tag);


resumeState = loadResume();

if (resumeState) {
    showResumeCard(
        resumeState.videoId
    );
}

applyView();


function onYouTubeIframeAPIReady() {
    if (!ALL_EMBEDDABLE_IDS.length) {
        setStatus(
            'Nenhum vídeo reproduzível no player.'
        );
        return;
    }

    let initialId =
        activePlaylist[0]
        ||
        ALL_EMBEDDABLE_IDS[0];

    if (
        resumeState
        &&
        activePlaylist.includes(
            resumeState.videoId
        )
    ) {
        initialId =
            resumeState.videoId;
    }

    player =
    new YT.Player(
        'player',
        {
            videoId: initialId,
            width: '100%',
            height: '100%',

            playerVars: {
                rel: 0,
                playsinline: 1
            },

            events: {
                onReady:
                    () => {
                        ready = true;
                        rebuildPlaylist();

                        if (
                            resumeState
                            &&
                            activePlaylist.includes(
                                resumeState.videoId
                            )
                        ) {
                            i =
                                activePlaylist.indexOf(
                                    resumeState.videoId
                                );

                            player.cueVideoById({
                                videoId:
                                    resumeState.videoId,
                                startSeconds:
                                    resumeState.seconds
                            });

                            setStatus(
                                'Ponto anterior carregado. '
                                +
                                'Clique em “Começar jornal” '
                                +
                                'para continuar.'
                            );

                            showResumeInfo();
                        }
                    },

                onStateChange:
                    event => {
                        const id =
                            currentVideoId();

                        if (
                            event.data
                            ===
                            YT.PlayerState.PLAYING
                        ) {
                            if (id) {
                                if (
                                    activePlaylist.includes(id)
                                ) {
                                    i =
                                        activePlaylist.indexOf(id);
                                }

                                showCurrentCard(id);

                                saveResume(
                                    id,
                                    currentTime()
                                );

                                showResumeInfo();
                            }
                        }

                        if (
                            event.data
                            ===
                            YT.PlayerState.PAUSED
                        ) {
                            if (id) {
                                saveResume(
                                    id,
                                    currentTime()
                                );

                                showResumeInfo();
                            }
                        }

                        if (
                            event.data
                            ===
                            YT.PlayerState.ENDED
                        ) {
                            const oldIndex =
                                id
                                ? activePlaylist.indexOf(id)
                                : -1;

                            if (id) {
                                markWatched(id);
                            }

                            if (onlyUnwatched) {
                                applyView();

                                if (
                                    oldIndex >= 0
                                    &&
                                    oldIndex < activePlaylist.length
                                ) {
                                    play(oldIndex);
                                }
                                else {
                                    setStatus(
                                        'Fim do Jornal.'
                                    );
                                }
                            }
                            else {
                                applyView();
                                next();
                            }
                        }
                    },

                onError:
                    () => {
                        setStatus(
                            'Vídeo indisponível aqui; pulando...'
                        );

                        setTimeout(
                            next,
                            700
                        );
                    }
            }
        }
    );
}


setInterval(
    () => {
        if (!player || !ready) {
            return;
        }

        try {
            if (
                player.getPlayerState()
                !==
                YT.PlayerState.PLAYING
            ) {
                return;
            }

            const id =
                currentVideoId();

            if (id) {
                saveResume(
                    id,
                    currentTime()
                );
            }
        }
        catch (_) {}
    },
    5000
);


function play(
    index,
    startSeconds = 0
) {
    if (
        !activePlaylist.length
        ||
        !ready
    ) {
        setStatus(
            'Nenhum vídeo reproduzível neste modo.'
        );
        return;
    }

    if (
        index < 0
        ||
        index >= activePlaylist.length
    ) {
        return;
    }

    i = index;

    const id =
        activePlaylist[i];

    player.loadVideoById({
        videoId: id,
        startSeconds: Math.max(
            0,
            Number(startSeconds || 0)
        )
    });

    showCurrentCard(id);

    saveResume(
        id,
        startSeconds
    );

    showResumeInfo();

    setStatus(
        'Reproduzindo '
        + (i + 1)
        + ' de '
        + activePlaylist.length
    );
}


function start() {
    rebuildPlaylist();

    if (!activePlaylist.length) {
        setStatus(
            'Nenhum vídeo reproduzível neste modo.'
        );
        return;
    }

    if (
        resumeState
        &&
        activePlaylist.includes(
            resumeState.videoId
        )
    ) {
        const index =
            activePlaylist.indexOf(
                resumeState.videoId
            );

        play(
            index,
            resumeState.seconds
        );
        return;
    }

    play(0);
}


function next() {
    rebuildPlaylist();

    if (!activePlaylist.length) {
        setStatus(
            'Fim do Jornal.'
        );
        return;
    }

    const current =
        currentVideoId();

    if (
        current
        &&
        activePlaylist.includes(current)
    ) {
        i =
            activePlaylist.indexOf(current);
    }

    const nextIndex = i + 1;

    if (
        nextIndex >= activePlaylist.length
    ) {
        setStatus(
            'Fim do Jornal.'
        );
        return;
    }

    play(nextIndex);
}


function prev() {
    rebuildPlaylist();

    if (!activePlaylist.length) {
        return;
    }

    const current =
        currentVideoId();

    if (
        current
        &&
        activePlaylist.includes(current)
    ) {
        i =
            activePlaylist.indexOf(current);
    }

    if (i <= 0) {
        setStatus(
            'Você está no primeiro vídeo.'
        );
        return;
    }

    play(i - 1);
}


function openVideo(id) {
    const video =
        VIDEOS.find(
            item => item.id === id
        );

    if (!video) {
        return;
    }

    if (!video.embeddable) {
        window.open(
            'https://www.youtube.com/watch?v='
            + encodeURIComponent(id),
            '_blank',
            'noopener'
        );
        return;
    }

    rebuildPlaylist();

    let index =
        activePlaylist.indexOf(id);

    if (index < 0) {
        onlyUnwatched = false;
        saveUnwatchedMode();
        applyView();
        index =
            activePlaylist.indexOf(id);
    }

    if (index >= 0) {
        play(index);

        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    }
}


function saveBeforeLeaving() {
    const id =
        currentVideoId();

    if (id) {
        saveResume(
            id,
            currentTime()
        );
    }
}


window.addEventListener(
    'beforeunload',
    saveBeforeLeaving
);


document.addEventListener(
    'visibilitychange',
    () => {
        if (document.hidden) {
            saveBeforeLeaving();
        }
    }
);

</script>

</body>

</html>
'''

    page = (
        page
        .replace("__DATE__", html.escape(date))
        .replace("__UPDATED__", html.escape(updated))
        .replace("__WARNING__", warning)
        .replace("__CHAPTERS_HTML__", chapters_html)
        .replace("__PLAYER_VIDEOS__", js_json(player_videos))
    )

    return page


def main():
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()

    if not key:
        raise RuntimeError("Secret YOUTUBE_API_KEY ausente.")

    channels = load_channels()
    log(f"{len(channels)} canais carregados.")

    videos, now_local, failures = collect(
        key,
        channels,
    )

    log(f"{len(videos)} vídeos válidos encontrados.")

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

    log("index.html atualizado.")


if __name__ == "__main__":
    main()
