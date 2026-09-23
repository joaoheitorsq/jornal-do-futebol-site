import os
import json
import time
import html
import re

from collections import OrderedDict
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from html.parser import HTMLParser
from xml.etree import ElementTree as ET


API = "https://www.googleapis.com/youtube/v3"
OEMBED = "https://www.youtube.com/oembed"
HEARTHPWN_RSS = "https://www.hearthpwn.com/news.rss"
HEARTHPWN_HOME = "https://www.hearthpwn.com/"
HEARTHPWN_LIMIT = 5

TRANSLATION_CACHE_FILE = "hearthpwn_translation_cache.json"
PUBLIC_TRANSLATION_CACHE_URL = (
    "https://joaoheitorsq.github.io/"
    "jornal-do-futebol-site/"
    "hearthpwn_translation_cache.json"
)
TRANSLATION_CACHE_MAX_ITEMS = 300

TZ = ZoneInfo("America/Fortaleza")
UTC = ZoneInfo("UTC")

RESET_HOUR = 4
WINDOW_HOURS = 24

MAX_RETRIES = 5
RETRYABLE = {429, 500, 502, 503, 504}

# Regra de tempo: Shorts desses canais contam normalmente,
# mas vídeos normais não entram no tempo total/assistido/restante.
TIME_EXCLUDED_NORMAL_HANDLES = {
    "@cortesdoflowsportclub",
    "@nohandsgamer",
}


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
                    "User-Agent": "JornalDoFutebol/1.6",
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



def get_text(url, retries=3, timeout=12):
    last = None

    for attempt in range(1, retries + 1):
        try:
            req = Request(
                url,
                headers={
                    "User-Agent": "JornalDoFutebol/1.6",
                    "Accept": "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
                },
            )

            with urlopen(req, timeout=timeout) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                return response.read().decode(charset, errors="replace")

        except HTTPError as erro:
            last = RuntimeError(f"HTTP {erro.code}")
            if erro.code not in RETRYABLE or attempt == retries:
                raise last

        except (URLError, TimeoutError, ConnectionError) as erro:
            last = erro
            if attempt == retries:
                raise

        time.sleep(min(attempt, 2))

    raise last or RuntimeError("Falha de rede desconhecida.")


class HearthPwnHomeParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_h2 = False
        self.current_href = None
        self.current_text = []
        self.items = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)

        if tag.lower() == "h2":
            self.in_h2 = True

        if self.in_h2 and tag.lower() == "a":
            href = attrs.get("href", "")
            if "/news/" in href:
                self.current_href = href
                self.current_text = []

    def handle_data(self, data):
        if self.current_href is not None:
            self.current_text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self.current_href is not None:
            title = " ".join("".join(self.current_text).split())
            if title:
                self.items.append(
                    {
                        "title": title,
                        "url": urljoin(HEARTHPWN_HOME, self.current_href),
                        "summary": "",
                        "published": "",
                    }
                )
            self.current_href = None
            self.current_text = []

        if tag.lower() == "h2":
            self.in_h2 = False


def clean_html_text(value):
    if not value:
        return ""

    text = re.sub(r"<[^>]+>", " ", value)
    text = html.unescape(text)
    return " ".join(text.split())


def format_hearthpwn_date(value):
    if not value:
        return ""

    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        local = parsed.astimezone(TZ)
        return local.strftime("%d/%m · %H:%M")
    except Exception:
        return ""


def parse_hearthpwn_rss(source):
    root = ET.fromstring(source)
    items = []
    seen = set()

    for item in root.findall(".//item"):
        title = clean_html_text(item.findtext("title") or "")
        link = (item.findtext("link") or "").strip()
        description = clean_html_text(item.findtext("description") or "")
        published = format_hearthpwn_date(item.findtext("pubDate") or "")

        if not title or not link or link in seen:
            continue

        seen.add(link)

        if len(description) > 180:
            description = description[:177].rstrip() + "..."

        items.append(
            {
                "title": title,
                "url": link,
                "summary": description,
                "published": published,
            }
        )

        if len(items) >= HEARTHPWN_LIMIT:
            break

    return items


def fetch_hearthpwn_news():
    try:
        rss = get_text(HEARTHPWN_RSS, retries=2, timeout=10)
        items = parse_hearthpwn_rss(rss)
        if items:
            log(f"HearthPwn RSS OK: {len(items)} notícia(s).")
            return items
        raise RuntimeError("RSS sem notícias utilizáveis.")
    except Exception as erro:
        log(f"AVISO HearthPwn RSS: {erro}")

    try:
        source = get_text(HEARTHPWN_HOME, retries=2, timeout=10)
        parser = HearthPwnHomeParser()
        parser.feed(source)

        items = []
        seen = set()

        for item in parser.items:
            if item["url"] in seen:
                continue
            seen.add(item["url"])
            items.append(item)
            if len(items) >= HEARTHPWN_LIMIT:
                break

        if items:
            log(f"HearthPwn homepage OK: {len(items)} notícia(s).")
            return items

        raise RuntimeError("Homepage sem notícias utilizáveis.")

    except Exception as erro:
        log(
            "AVISO: HearthPwn indisponível nesta atualização; "
            f"widget será ocultado. Motivo: {erro}"
        )
        return []



def empty_translation_cache():
    return {
        "version": 1,
        "items": {},
    }


def normalize_translation_cache(data):
    if not isinstance(data, dict):
        return empty_translation_cache()

    items = data.get("items")

    if not isinstance(items, dict):
        items = {}

    return {
        "version": 1,
        "items": items,
    }


def load_translation_cache():
    try:
        with open(
            TRANSLATION_CACHE_FILE,
            encoding="utf-8",
        ) as file:
            data = normalize_translation_cache(
                json.load(file)
            )

        log(
            "Cache de traduções local carregado: "
            f"{len(data['items'])} item(ns)."
        )

        return data

    except FileNotFoundError:
        pass

    except Exception as erro:
        log(
            "AVISO: cache local de traduções inválido: "
            f"{erro}"
        )

    try:
        data = normalize_translation_cache(
            get_json(
                (
                    PUBLIC_TRANSLATION_CACHE_URL
                    + "?v="
                    + str(int(time.time()))
                ),
                retries=2,
            )
        )

        log(
            "Cache de traduções do GitHub Pages carregado: "
            f"{len(data['items'])} item(ns)."
        )

        return data

    except Exception as erro:
        log(
            "Cache de traduções ainda não disponível; "
            f"começando vazio. Motivo: {erro}"
        )

        return empty_translation_cache()


def prune_translation_cache(cache):
    items = cache.get("items", {})

    if len(items) <= TRANSLATION_CACHE_MAX_ITEMS:
        return

    ordered = sorted(
        items.items(),
        key=lambda pair: (
            pair[1].get(
                "translatedAt",
                "",
            )
            if isinstance(pair[1], dict)
            else ""
        ),
        reverse=True,
    )

    cache["items"] = dict(
        ordered[
            :TRANSLATION_CACHE_MAX_ITEMS
        ]
    )


def save_translation_cache(cache):
    prune_translation_cache(cache)

    with open(
        TRANSLATION_CACHE_FILE,
        "w",
        encoding="utf-8",
        newline="\n",
    ) as file:
        json.dump(
            cache,
            file,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )

        file.write("\n")



def normalize_ptbr_text(value):
    """Aplica pequenas trocas de vocabulário para aproximar PT de PT-BR."""
    if not value:
        return ""

    replacements = [
        (r"\bficheiros\b", "arquivos"),
        (r"\bficheiro\b", "arquivo"),
        (r"\bFicheiros\b", "Arquivos"),
        (r"\bFicheiro\b", "Arquivo"),
        (r"\butilizadores\b", "usuários"),
        (r"\butilizador\b", "usuário"),
        (r"\bUtilizadores\b", "Usuários"),
        (r"\bUtilizador\b", "Usuário"),
        (r"\becrãs\b", "telas"),
        (r"\becrã\b", "tela"),
        (r"\bEcrãs\b", "Telas"),
        (r"\bEcrã\b", "Tela"),
        (r"\bequipas\b", "equipes"),
        (r"\bequipa\b", "equipe"),
        (r"\bEquipas\b", "Equipes"),
        (r"\bEquipa\b", "Equipe"),
        (r"\btelemóveis\b", "celulares"),
        (r"\btelemóvel\b", "celular"),
        (r"\bTelemóveis\b", "Celulares"),
        (r"\bTelemóvel\b", "Celular"),
    ]

    result = value

    for pattern, replacement in replacements:
        result = re.sub(pattern, replacement, result)

    return " ".join(result.split())


def get_argos_translator():
    """
    Retorna o módulo de tradução do Argos pronto para EN -> PT.

    O modelo é instalado apenas quando ainda não existe no diretório
    configurado por ARGOS_PACKAGE_DIR. Qualquer falha aqui é opcional:
    o Jornal continua funcionando e o HearthPwn permanece em inglês.
    """
    try:
        import argostranslate.package as argos_package
        import argostranslate.translate as argos_translate
    except Exception as erro:
        log(
            "AVISO: Argos Translate não está disponível; "
            "HearthPwn continuará em inglês. "
            f"Motivo: {erro}"
        )
        return None

    try:
        installed = argos_package.get_installed_packages()

        has_model = any(
            getattr(pkg, "from_code", None) == "en"
            and getattr(pkg, "to_code", None) == "pt"
            for pkg in installed
        )

        if not has_model:
            log(
                "Modelo Argos EN → PT ainda não instalado; "
                "baixando uma vez para o cache do workflow."
            )

            argos_package.update_package_index()
            available = argos_package.get_available_packages()

            package_to_install = next(
                (
                    pkg
                    for pkg in available
                    if pkg.from_code == "en"
                    and pkg.to_code == "pt"
                ),
                None,
            )

            if package_to_install is None:
                raise RuntimeError(
                    "Modelo Argos EN → PT não encontrado."
                )

            argos_package.install_from_path(
                package_to_install.download()
            )

            log("Modelo Argos EN → PT instalado.")
        else:
            log("Modelo Argos EN → PT carregado do cache.")

        # Teste leve para confirmar que o modelo ficou utilizável.
        probe = argos_translate.translate(
            "News",
            "en",
            "pt",
        )

        if not probe:
            raise RuntimeError(
                "Argos não retornou tradução no teste."
            )

        return argos_translate

    except Exception as erro:
        log(
            "AVISO: não foi possível preparar o Argos Translate; "
            "HearthPwn continuará em inglês. "
            f"Motivo: {erro}"
        )
        return None


def translate_local_ptbr(text, translator):
    if not text:
        return ""

    translated = translator.translate(
        text,
        "en",
        "pt",
    )

    translated = clean_html_text(translated)
    translated = normalize_ptbr_text(translated)

    if not translated:
        raise RuntimeError(
            "Argos retornou tradução vazia."
        )

    return translated


def translate_hearthpwn_news(news_items):
    if not news_items:
        cache = load_translation_cache()
        save_translation_cache(cache)
        return []

    cache = load_translation_cache()
    cache_items = cache["items"]

    result = []
    pending = []

    for item in news_items:
        original = dict(item)

        url = str(original.get("url", ""))
        title = str(original.get("title", ""))
        summary = str(original.get("summary", ""))

        cached = cache_items.get(url)

        if (
            isinstance(cached, dict)
            and cached.get("sourceTitle") == title
            and cached.get("sourceSummary") == summary
            and cached.get("titlePtBr")
        ):
            translated_item = dict(original)
            translated_item["title"] = cached["titlePtBr"]
            translated_item["summary"] = cached.get(
                "summaryPtBr",
                "",
            )
            translated_item["translated"] = True

            result.append(translated_item)
            continue

        translated_item = dict(original)
        translated_item["translated"] = False
        result.append(translated_item)

        pending.append(
            {
                "resultIndex": len(result) - 1,
                "url": url,
                "title": title,
                "summary": summary,
            }
        )

    if not pending:
        log(
            "HearthPwn: todas as notícias vieram "
            "do cache de tradução."
        )
        save_translation_cache(cache)
        return result

    translator = get_argos_translator()

    if translator is None:
        save_translation_cache(cache)
        return result

    translated_count = 0

    for pending_item in pending:
        result_index = pending_item["resultIndex"]

        try:
            translated_title = translate_local_ptbr(
                pending_item["title"],
                translator,
            )

            translated_summary = (
                translate_local_ptbr(
                    pending_item["summary"],
                    translator,
                )
                if pending_item["summary"]
                else ""
            )

            result[result_index]["title"] = translated_title
            result[result_index]["summary"] = translated_summary
            result[result_index]["translated"] = True

            cache_items[pending_item["url"]] = {
                "sourceTitle": pending_item["title"],
                "sourceSummary": pending_item["summary"],
                "titlePtBr": translated_title,
                "summaryPtBr": translated_summary,
                "translatedAt": datetime.now(UTC).isoformat(),
                "engine": "argos-en-pt",
            }

            translated_count += 1

        except Exception as erro:
            log(
                "AVISO: falha traduzindo uma notícia do HearthPwn; "
                "ela permanecerá em inglês nesta atualização. "
                f"Motivo: {erro}"
            )

    if translated_count:
        log(
            "HearthPwn traduzido localmente: "
            f"{translated_count} notícia(s) nova(s)."
        )

    save_translation_cache(cache)
    return result

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
                    "channelHandle": channel["handle"],
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

        duration = duration_seconds(
            video.get("contentDetails", {}).get("duration")
        )

        if duration is None:
            duration = 0

        handle_key = candidate["channelHandle"].casefold()

        # Só precisamos confirmar o formato Short quando isso afeta
        # alguma regra: canais onlyShorts ou as duas exceções de tempo.
        needs_short_check = (
            candidate["onlyShorts"]
            or handle_key in TIME_EXCLUDED_NORMAL_HANDLES
        )

        is_short = (
            short_confirmed(video_id, video)
            if needs_short_check
            else False
        )

        if candidate["onlyShorts"] and not is_short:
            log(
                "NÃO ENTROU — SOMENTE SHORTS: "
                + snippet.get("title", video_id)
            )
            continue

        # Exceção pedida: vídeos NORMAIS desses dois canais não contam
        # no tempo. Shorts desses mesmos canais continuam contando.
        count_for_time = not (
            handle_key in TIME_EXCLUDED_NORMAL_HANDLES
            and not is_short
        )

        accepted.append(
            {
                "videoId": video_id,
                "title": snippet.get("title", "Sem título"),
                "channelTitle": snippet.get(
                    "channelTitle",
                    candidate["channelTitle"],
                ),
                "channelHandle": candidate["channelHandle"],
                "publishedDt": candidate["publishedDt"],
                "durationSeconds": duration,
                "countForTime": count_for_time,
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


def build_hearthpwn_widget(news_items):
    if not news_items:
        return ""

    rows = []

    translated_count = sum(
        1
        for item in news_items[:HEARTHPWN_LIMIT]
        if item.get("translated")
    )

    translation_note = (
        '<span class="translation-note">'
        'Traduzido automaticamente para PT-BR'
        '</span>'
        if translated_count
        else ""
    )

    for item in news_items[:HEARTHPWN_LIMIT]:
        title = html.escape(item.get("title", "Sem título"))
        url = html.escape(item.get("url", HEARTHPWN_HOME), quote=True)
        summary = html.escape(item.get("summary", ""))
        published = html.escape(item.get("published", ""))

        meta = (
            f'<span class="hearthpwn-date">{published}</span>'
            if published
            else ""
        )

        summary_html = (
            f'<p>{summary}</p>'
            if summary
            else ""
        )

        rows.append(
            f'''
<article
    class="hearthpwn-news-item"
    data-news-key="{url}"
>

<a
    class="hearthpwn-news-link"
    href="{url}"
    target="_blank"
    rel="noopener noreferrer"
    onclick="markHearthPwnSeen(this.closest('.hearthpwn-news-item').dataset.newsKey)"
>

<div class="hearthpwn-news-main">
<strong>{title}</strong>
{summary_html}
</div>

<div class="hearthpwn-news-meta">
{meta}
<span class="hearthpwn-seen-badge">✓ VISTO</span>
</div>

</a>

<button
    class="hearthpwn-watch-action"
    type="button"
    onclick="toggleHearthPwnSeen(this.closest('.hearthpwn-news-item').dataset.newsKey)"
>
✓ Marcar como visto
</button>

</article>
'''
        )

    return (
        '''
<section class="hearthpwn-widget" aria-label="Últimas notícias do HearthPwn">

<div class="hearthpwn-head">
<div>
<span class="widget-kicker">HEARTHSTONE</span>
<h2>🔥 Últimas do HearthPwn</h2>
__TRANSLATION_NOTE__
</div>

<div class="hearthpwn-head-actions">

<a
    class="hearthpwn-open"
    href="https://www.hearthpwn.com/"
    target="_blank"
    rel="noopener noreferrer"
>
Abrir HearthPwn ↗
</a>

<button
    class="hearthpwn-collapse-toggle"
    type="button"
    onclick="toggleHearthPwnWidget()"
    aria-expanded="true"
    title="Recolher notícias do HearthPwn"
>
<span class="hearthpwn-collapse-chevron" aria-hidden="true">▾</span>
</button>

</div>
</div>

<div class="hearthpwn-news-list">
'''
        + "\n".join(rows)
        + '''
</div>

</section>
'''
    ).replace(
        "__TRANSLATION_NOTE__",
        translation_note,
    )


def build_page(videos, now_local, failures, hearthpwn_news=None):
    date = journal_day(now_local)
    updated = now_local.strftime("%d/%m/%Y às %H:%M")
    hearthpwn_html = build_hearthpwn_widget(hearthpwn_news or [])

    player_videos = [
        {
            "id": video["videoId"],
            "title": video["title"],
            "channelTitle": video["channelTitle"],
            "duration": video["durationSeconds"],
            "countForTime": video["countForTime"],
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
<article
    class="card"
    data-video-id="__VIDEO_ID__"
>

<button
    class="card-open"
    type="button"
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

<button
    class="watch-action"
    type="button"
    data-video-id="__VIDEO_ID__"
    onclick="toggleWatched('__VIDEO_ID__')"
>
Marcar como visto
</button>

</article>
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
<section
    class="chapter"
    data-chapter="__CHAPTER_INDEX__"
    data-chapter-key="__CHAPTER_KEY__"
>

<button
    class="chapter-title"
    type="button"
    onclick="toggleChapter(this.closest('.chapter').dataset.chapterKey)"
>
<span class="chapter-title-text">
__CHAPTER_LABEL__
<span class="chapter-count">(__CHAPTER_COUNT__)</span>
</span>
<span class="chapter-chevron" aria-hidden="true">▾</span>
</button>

<div class="list chapter-list">
__CARDS__
</div>

</section>
"""
            .replace("__CHAPTER_INDEX__", str(chapter_index))
            .replace("__CHAPTER_KEY__", html.escape(date + "|" + label, quote=True))
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

#player-slot,
#youtube-standard-player {
    width: 100%;
    height: 100%;
}

#youtube-standard-player {
    display: block;
    border: 0;
}

#player-spacer {
    display: none;
    aspect-ratio: 16 / 9;
}

#playerwrap.mini-player {
    position: fixed;
    right: 18px;
    bottom: 18px;
    width: min(460px, 42vw);
    z-index: 1000;
    border: 1px solid #46505e;
    box-shadow: 0 16px 48px rgba(0, 0, 0, .55);
}

.playerbox.floating #player-spacer {
    display: block;
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

.journal-transport {
    display: grid;
    grid-template-columns: auto auto auto minmax(120px, 1fr) auto;
    gap: 8px;
    align-items: center;
    margin-top: 10px;
    padding: 9px;
    background: #12151b;
    border: 1px solid #303641;
    border-radius: 10px;
}

.journal-transport button {
    background: #242933;
    color: white;
    border: 1px solid #3a414d;
    border-radius: 8px;
    padding: 8px 10px;
    cursor: pointer;
    white-space: nowrap;
}

.journal-progress {
    width: 100%;
    min-width: 0;
    cursor: pointer;
}

.journal-clock {
    color: #c4cad3;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    font-size: 13px;
}

@media (max-width: 650px) {
    .journal-transport {
        grid-template-columns: auto auto auto 1fr;
    }

    .journal-clock {
        grid-column: 1 / -1;
        text-align: right;
    }
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

.up-next {
    margin-top: 12px;
    border-top: 1px solid #303641;
    padding-top: 11px;
}

.up-next-title {
    color: #aeb4bd;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: .04em;
    text-transform: uppercase;
    margin-bottom: 7px;
}

.next-row {
    display: grid;
    grid-template-columns: 84px 1fr auto;
    gap: 9px;
    align-items: center;
    width: 100%;
    padding: 6px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
}

.next-row:hover {
    background: #20242c;
}

.next-row + .next-row {
    margin-top: 4px;
}

.next-row img {
    width: 84px;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 7px;
    background: #000;
}

.next-row strong,
.next-row span {
    display: block;
}

.next-row small {
    display: block;
    margin-top: 3px;
}

.next-duration {
    color: #aeb4bd;
    font-size: 12px;
    white-space: nowrap;
}

.up-next.empty .next-row {
    display: none;
}

.time-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 9px;
    margin: 14px 0 4px;
}

.time-stat {
    background: #181b22;
    border: 1px solid #303641;
    border-radius: 11px;
    padding: 10px 12px;
}

.time-stat span {
    display: block;
    color: #8f98a4;
    font-size: 12px;
    margin-bottom: 3px;
}

.time-stat strong {
    font-size: 17px;
}

.time-note {
    color: #7f8893;
    font-size: 12px;
    margin-top: 7px;
}

.carryover {
    margin: 22px 0 6px;
    padding: 13px;
    border: 1px solid #7c5b27;
    border-radius: 12px;
    background: #211c14;
}

.carryover.hidden {
    display: none;
}

.carryover h2 {
    margin: 0 0 4px;
    font-size: 19px;
}

.carryover p {
    margin: 0 0 10px;
    color: #c7b58d;
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

.search-box {
    flex: 1 1 260px;
    min-width: 210px;
    max-width: 420px;
    background: #181b22;
    color: #f2f3f5;
    border: 1px solid #3a414d;
    border-radius: 9px;
    padding: 9px 11px;
    font: inherit;
}

.search-box::placeholder {
    color: #747d89;
}

#resume-jump:disabled {
    opacity: .45;
    cursor: default;
}

.chapter {
    margin-top: 24px;
}

.chapter.hidden {
    display: none;
}

.chapter-title {
    width: 100%;
    margin: 0 0 10px;
    padding: 5px 2px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 20px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    text-align: left;
    cursor: pointer;
}

.chapter-title-text {
    display: inline-flex;
    align-items: baseline;
    gap: 7px;
}

.chapter-chevron {
    color: #8f98a4;
    font-size: 18px;
}

.chapter.collapsed .chapter-list {
    display: none;
}

.chapter.collapsed .chapter-chevron {
    transform: rotate(-90deg);
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
    position: relative;
    padding: 0;
    width: 100%;
    color: inherit;
    text-align: left;
    overflow: hidden;
    transition:
        border-color .15s,
        background .15s,
        box-shadow .15s,
        opacity .15s;
}

.card-open {
    display: grid;
    grid-template-columns:
        150px 1fr;
    gap: 12px;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
}

.watch-action {
    position: absolute;
    right: 10px;
    bottom: 8px;
    z-index: 2;
    border: 1px solid #46505e;
    border-radius: 8px;
    background: #252b34;
    color: #dce2ea;
    padding: 5px 8px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
}

.watch-action.watched {
    background: #26382d;
    border-color: #466b52;
    color: #bfe2c7;
}

.watch-action.standalone {
    position: static;
    margin-top: 9px;
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
        40px
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

.hearthpwn-widget {
    margin: 22px 0 8px;
    background: #181b22;
    border: 1px solid #303641;
    border-radius: 14px;
    overflow: hidden;
}

.hearthpwn-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 14px 15px 10px;
}

.hearthpwn-head h2 {
    margin: 2px 0 0;
    font-size: 20px;
}

.widget-kicker {
    color: #f2b84b;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .12em;
}

.hearthpwn-head-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.hearthpwn-open {
    color: #a9cfff;
    text-decoration: none;
    white-space: nowrap;
    font-size: 13px;
}

.hearthpwn-collapse-toggle {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    padding: 0;
    background: #242933;
    color: #dce3ed;
    border: 1px solid #3a414d;
    border-radius: 9px;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
}

.hearthpwn-collapse-toggle:hover {
    background: #2c323e;
}

.hearthpwn-collapse-chevron {
    display: block;
    transform: translateY(-1px);
}

.hearthpwn-widget.collapsed
.hearthpwn-news-list {
    display: none;
}

.hearthpwn-widget.collapsed
.hearthpwn-head {
    padding-bottom: 14px;
}

.translation-note {
    display: block;
    margin-top: 5px;
    color: #8993a0;
    font-size: 11px;
}

.hearthpwn-news-list {
    border-top: 1px solid #303641;
}

.hearthpwn-news-item {
    color: inherit;
    transition:
        background .15s,
        opacity .15s;
}

.hearthpwn-news-item + .hearthpwn-news-item {
    border-top: 1px solid #272d36;
}

.hearthpwn-news-item:hover {
    background: #1e222a;
}

.hearthpwn-news-item.seen {
    background: #14171c;
}

.hearthpwn-news-link {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    padding: 12px 15px 8px;
    color: inherit;
    text-decoration: none;
}

.hearthpwn-news-item.seen
.hearthpwn-news-main {
    opacity: .58;
}

.hearthpwn-news-main strong {
    display: block;
    line-height: 1.3;
}

.hearthpwn-news-main p {
    margin: 4px 0 0;
    color: #9da6b2;
    font-size: 13px;
    line-height: 1.35;
}

.hearthpwn-news-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 5px;
}

.hearthpwn-date {
    color: #808996;
    font-size: 12px;
    white-space: nowrap;
}

.hearthpwn-seen-badge {
    display: none;
    color: #7fd09a;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .05em;
}

.hearthpwn-news-item.seen
.hearthpwn-seen-badge {
    display: inline;
}

.hearthpwn-watch-action {
    margin: 0 15px 12px;
    padding: 7px 10px;
    background: #242933;
    color: #d8dee8;
    border: 1px solid #3a414d;
    border-radius: 8px;
    cursor: pointer;
    font-size: 12px;
}

.hearthpwn-watch-action:hover {
    background: #2c323e;
}

.hearthpwn-watch-action.seen {
    color: #9da6b2;
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

    .time-summary {
        grid-template-columns: 1fr;
    }

    .card-open {
        grid-template-columns:
            110px 1fr;
    }

    #playerwrap.mini-player {
        right: 8px;
        bottom: 8px;
        width: calc(100vw - 16px);
    }

    .hearthpwn-news-link {
        grid-template-columns: 1fr;
        gap: 5px;
    }

    .hearthpwn-news-meta {
        align-items: flex-start;
    }

    .hearthpwn-date {
        white-space: normal;
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

<section class="time-summary" aria-label="Tempo do Jornal">

<div class="time-stat">
<span>Tempo total considerado</span>
<strong id="time-total">—</strong>
</div>

<div class="time-stat">
<span>Assistido</span>
<strong id="time-watched">—</strong>
</div>

<div class="time-stat">
<span>Restante</span>
<strong id="time-remaining">—</strong>
</div>

</section>

<div class="time-note">
Vídeos normais de Cortes do Flow Sport Club e NoHandsGamer não entram nesses tempos; Shorts desses canais entram normalmente.
</div>

<section id="player-section" class="playerbox">

<div id="player-spacer"></div>

<div id="playerwrap">
<div id="player-slot"></div>
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

<div class="journal-transport" aria-label="Controles do Jornal">

<button type="button" onclick="seekBy(-10)">
↶ 10s
</button>

<button
    id="journal-play-pause"
    type="button"
    onclick="togglePlayerPlayback()"
>
▶ Play
</button>

<button type="button" onclick="seekBy(10)">
10s ↷
</button>

<input
    id="journal-progress"
    class="journal-progress"
    type="range"
    min="0"
    max="1000"
    value="0"
    step="1"
    aria-label="Posição do vídeo"
    oninput="previewSeek(this.value)"
    onchange="commitSeek(this.value)"
>

<span id="journal-clock" class="journal-clock">
0:00 / 0:00
</span>

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

<section id="up-next" class="up-next">
<div class="up-next-title">Fila</div>
<button id="up-next-first" class="next-row" type="button"></button>
<button id="up-next-second" class="next-row" type="button"></button>
</section>

</section>

__WARNING__

__HEARTHPWN_WIDGET__

<section
    id="carryover"
    class="carryover hidden"
>

<h2>Continuação pendente</h2>

<p>
Este vídeo saiu das últimas 24 horas, mas foi mantido até você terminar de assistir.
</p>

<article
    id="carryover-card"
    class="card"
>

<button
    id="carryover-open"
    class="card-open"
    type="button"
>

<div class="thumbbox">

<img
    id="carryover-thumb"
    src=""
    alt=""
>

<span class="resume-badge">
▶ CONTINUAR AQUI
</span>

<span class="playing-badge">
▶ AGORA
</span>

</div>

<span class="card-info">
<b id="carryover-title">Vídeo anterior</b>
<em id="carryover-channel"></em>
</span>

</button>

<button
    id="carryover-watch-toggle"
    class="watch-action"
    type="button"
>
Marcar como visto
</button>

</article>

</section>

<div class="toolbar">

<button
    id="unwatched-toggle"
    class="view-toggle"
    onclick="toggleUnwatchedMode()"
>
Só o que ainda não vi
</button>

<button
    id="resume-jump"
    class="view-toggle"
    type="button"
    onclick="goToResume()"
>
↳ Ir para onde parei
</button>

<input
    id="video-search"
    class="search-box"
    type="search"
    placeholder="Buscar vídeo ou canal..."
    autocomplete="off"
    oninput="onSearchInput(this.value)"
>

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

const CURRENT_EMBEDDABLE_IDS =
VIDEOS
    .filter(video => video.embeddable)
    .map(video => video.id);

const RESUME_KEY =
'jornal_do_futebol_resume_v1';

const WATCHED_KEY =
'jornal_do_futebol_watched_v1';

const HEARTHPWN_SEEN_KEY =
'jornal_do_futebol_hearthpwn_seen_v1';

const HEARTHPWN_COLLAPSED_KEY =
'jornal_do_futebol_hearthpwn_collapsed_v1';

const UNWATCHED_MODE_KEY =
'jornal_do_futebol_only_unwatched_v1';

const COLLAPSED_CHAPTERS_KEY =
'jornal_do_futebol_collapsed_chapters_v1';

let player = null;
let ready = false;
let activePlaylist = [];
let i = 0;
let resumeState = null;
let watched = loadWatched();
let hearthpwnSeen = loadHearthPwnSeen();
let hearthpwnCollapsed = loadHearthPwnCollapsed();
let onlyUnwatched = loadUnwatchedMode();
let collapsedChapters = loadCollapsedChapters();
let searchQuery = '';
let transportDragging = false;


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


function loadHearthPwnSeen() {
    try {
        const raw =
            localStorage.getItem(
                HEARTHPWN_SEEN_KEY
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


function saveHearthPwnSeen() {
    try {
        localStorage.setItem(
            HEARTHPWN_SEEN_KEY,
            JSON.stringify(hearthpwnSeen)
        );
    }
    catch (_) {}
}


function loadHearthPwnCollapsed() {
    try {
        return (
            localStorage.getItem(
                HEARTHPWN_COLLAPSED_KEY
            )
            === '1'
        );
    }
    catch (_) {
        return false;
    }
}


function saveHearthPwnCollapsed() {
    try {
        localStorage.setItem(
            HEARTHPWN_COLLAPSED_KEY,
            hearthpwnCollapsed ? '1' : '0'
        );
    }
    catch (_) {}
}


function applyHearthPwnCollapse() {
    const widget =
        document.querySelector(
            '.hearthpwn-widget'
        );

    if (!widget) {
        return;
    }

    widget.classList.toggle(
        'collapsed',
        hearthpwnCollapsed
    );

    const button =
        widget.querySelector(
            '.hearthpwn-collapse-toggle'
        );

    const chevron =
        widget.querySelector(
            '.hearthpwn-collapse-chevron'
        );

    if (button) {
        button.setAttribute(
            'aria-expanded',
            hearthpwnCollapsed ? 'false' : 'true'
        );

        button.title =
            hearthpwnCollapsed
            ? 'Expandir notícias do HearthPwn'
            : 'Recolher notícias do HearthPwn';
    }

    if (chevron) {
        chevron.textContent =
            hearthpwnCollapsed
            ? '▸'
            : '▾';
    }
}


function toggleHearthPwnWidget() {
    hearthpwnCollapsed =
        !hearthpwnCollapsed;

    saveHearthPwnCollapsed();
    applyHearthPwnCollapse();
}


function isHearthPwnSeen(newsKey) {
    return Boolean(
        newsKey
        &&
        hearthpwnSeen[newsKey]
    );
}


function updateHearthPwnSeenUI() {
    document
        .querySelectorAll(
            '.hearthpwn-news-item[data-news-key]'
        )
        .forEach(item => {
            const newsKey =
                item.dataset.newsKey;

            const seen =
                isHearthPwnSeen(newsKey);

            item.classList.toggle(
                'seen',
                seen
            );

            const button =
                item.querySelector(
                    '.hearthpwn-watch-action'
                );

            if (button) {
                button.classList.toggle(
                    'seen',
                    seen
                );

                button.textContent =
                    seen
                    ? '↶ Marcar como não visto'
                    : '✓ Marcar como visto';
            }
        });
}


function markHearthPwnSeen(newsKey) {
    if (!newsKey) {
        return;
    }

    hearthpwnSeen[newsKey] =
        Date.now();

    saveHearthPwnSeen();
    updateHearthPwnSeenUI();
}


function toggleHearthPwnSeen(newsKey) {
    if (!newsKey) {
        return;
    }

    if (isHearthPwnSeen(newsKey)) {
        delete hearthpwnSeen[newsKey];
    }
    else {
        hearthpwnSeen[newsKey] =
            Date.now();
    }

    saveHearthPwnSeen();
    updateHearthPwnSeenUI();
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


function toggleWatched(videoId) {
    if (!videoId) {
        return;
    }

    if (isWatched(videoId)) {
        delete watched[videoId];
        saveWatched();
        setStatus('Vídeo marcado como não visto.');
    }
    else {
        markWatched(videoId);

        if (
            resumeState
            &&
            resumeState.videoId === videoId
        ) {
            clearResume(videoId);
        }

        setStatus('Vídeo marcado como visto.');
    }

    applyView();
}


function loadCollapsedChapters() {
    try {
        const raw = localStorage.getItem(
            COLLAPSED_CHAPTERS_KEY
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


function saveCollapsedChapters() {
    try {
        localStorage.setItem(
            COLLAPSED_CHAPTERS_KEY,
            JSON.stringify(collapsedChapters)
        );
    }
    catch (_) {}
}


function applyChapterCollapse() {
    document
        .querySelectorAll('.chapter')
        .forEach(chapter => {
            const key = chapter.dataset.chapterKey || '';
            const collapsed = Boolean(
                collapsedChapters[key]
            );

            chapter.classList.toggle(
                'collapsed',
                collapsed
            );

            const chevron = chapter.querySelector(
                '.chapter-chevron'
            );

            if (chevron) {
                chevron.textContent = collapsed ? '▸' : '▾';
            }
        });
}


function toggleChapter(key) {
    if (!key) {
        return;
    }

    if (collapsedChapters[key]) {
        delete collapsedChapters[key];
    }
    else {
        collapsedChapters[key] = true;
    }

    saveCollapsedChapters();
    applyChapterCollapse();
}


function normalizeSearch(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('pt-BR')
        .trim();
}


function videoMatchesSearch(video) {
    if (!searchQuery) {
        return true;
    }

    if (!video) {
        return false;
    }

    const haystack = normalizeSearch(
        (video.title || '')
        + ' '
        + (video.channelTitle || '')
    );

    return haystack.includes(searchQuery);
}


function onSearchInput(value) {
    searchQuery = normalizeSearch(value);
    applyView();
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
        ) {
            localStorage.removeItem(
                RESUME_KEY
            );
            return null;
        }

        return {
            videoId: String(data.videoId),
            seconds: Math.max(
                0,
                Number(data.seconds || 0)
            ),
            title: String(
                data.title
                || 'Vídeo anterior em andamento'
            ),
            channelTitle: String(
                data.channelTitle
                || ''
            ),
            duration: Math.max(
                0,
                Number(data.duration || 0)
            ),
            countForTime:
                data.countForTime !== false,
            embeddable:
                data.embeddable !== false,
            savedAt: Number(
                data.savedAt || 0
            )
        };
    }
    catch (_) {
        return null;
    }
}

function currentVideoMeta(videoId) {
    return VIDEOS.find(
        video => video.id === videoId
    ) || null;
}


function resumeOutsideCurrentJournal() {
    return Boolean(
        resumeState
        &&
        !VIDEOS.some(
            video => video.id === resumeState.videoId
        )
    );
}


function metadataForVideo(videoId) {
    const current =
        currentVideoMeta(videoId);

    if (current) {
        return current;
    }

    if (
        resumeState
        &&
        resumeState.videoId === videoId
    ) {
        return resumeState;
    }

    return null;
}


function saveResume(
    videoId,
    seconds
) {
    if (!videoId) {
        return;
    }

    if (isWatched(videoId)) {
        return;
    }

    const meta =
        metadataForVideo(videoId);

    let playerTitle = '';

    if (!meta && player && ready) {
        try {
            const data = player.getVideoData();
            playerTitle = data && data.title
                ? String(data.title)
                : '';
        }
        catch (_) {}
    }

    const data = {
        videoId: String(videoId),
        seconds: Math.max(
            0,
            Number(seconds || 0)
        ),
        title:
            meta && meta.title
            ? String(meta.title)
            : (
                playerTitle
                || 'Vídeo anterior em andamento'
            ),
        channelTitle:
            meta && meta.channelTitle
            ? String(meta.channelTitle)
            : '',
        duration: Math.max(
            0,
            Number(
                meta && meta.duration
                ? meta.duration
                : 0
            )
        ),
        countForTime:
            meta
            ? meta.countForTime !== false
            : true,
        embeddable:
            meta
            ? meta.embeddable !== false
            : true,
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
    renderCarryover();
    showResumeCard(videoId);
    updateTimeStats();
    updateResumeJumpButton();
}


function clearResume(videoId = null) {
    if (
        videoId
        &&
        resumeState
        &&
        resumeState.videoId !== videoId
    ) {
        return;
    }

    try {
        localStorage.removeItem(
            RESUME_KEY
        );
    }
    catch (_) {}

    resumeState = null;
    renderCarryover();
    showResumeCard(null);
    updateTimeStats();
    updateResumeJumpButton();
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


function formatDurationHuman(totalSeconds) {
    totalSeconds = Math.max(
        0,
        Math.round(
            Number(totalSeconds || 0)
        )
    );

    const hours = Math.floor(
        totalSeconds / 3600
    );

    const minutes = Math.floor(
        (totalSeconds % 3600) / 60
    );

    if (hours > 0) {
        return (
            hours
            + 'h '
            + String(minutes).padStart(2, '0')
            + 'min'
        );
    }

    if (minutes > 0) {
        return minutes + 'min';
    }

    return totalSeconds + 's';
}


function updateTimeStats() {
    let total = 0;
    let consumed = 0;

    const playingId =
        currentVideoId();

    for (const video of VIDEOS) {
        if (
            !video.countForTime
            ||
            !video.duration
        ) {
            continue;
        }

        const duration = Math.max(
            0,
            Number(video.duration || 0)
        );

        total += duration;

        if (isWatched(video.id)) {
            consumed += duration;
            continue;
        }

        let partial = 0;

        if (
            playingId
            &&
            playingId === video.id
        ) {
            partial = currentTime();
        }
        else if (
            resumeState
            &&
            resumeState.videoId === video.id
        ) {
            partial = resumeState.seconds;
        }

        consumed += Math.min(
            duration,
            Math.max(0, partial)
        );
    }

    consumed = Math.min(
        total,
        consumed
    );

    const remaining = Math.max(
        0,
        total - consumed
    );

    document.getElementById(
        'time-total'
    ).textContent =
        formatDurationHuman(total);

    document.getElementById(
        'time-watched'
    ).textContent =
        formatDurationHuman(consumed);

    document.getElementById(
        'time-remaining'
    ).textContent =
        formatDurationHuman(remaining);
}


function renderCarryover() {
    const box =
        document.getElementById(
            'carryover'
        );

    const card =
        document.getElementById(
            'carryover-card'
        );

    const openButton =
        document.getElementById(
            'carryover-open'
        );

    const watchButton =
        document.getElementById(
            'carryover-watch-toggle'
        );

    if (
        !resumeState
        ||
        !resumeOutsideCurrentJournal()
        ||
        isWatched(resumeState.videoId)
        ||
        resumeState.embeddable === false
    ) {
        box.classList.add('hidden');
        card.removeAttribute(
            'data-video-id'
        );
        openButton.onclick = null;
        watchButton.onclick = null;
        watchButton.removeAttribute(
            'data-video-id'
        );
        return;
    }

    box.classList.remove('hidden');

    card.dataset.videoId =
        resumeState.videoId;

    openButton.onclick = () =>
        openVideo(
            resumeState.videoId
        );

    watchButton.dataset.videoId =
        resumeState.videoId;

    watchButton.onclick = () =>
        toggleWatched(
            resumeState.videoId
        );

    document.getElementById(
        'carryover-title'
    ).textContent =
        resumeState.title
        || 'Vídeo anterior em andamento';

    document.getElementById(
        'carryover-channel'
    ).textContent =
        (
            resumeState.channelTitle
            ? resumeState.channelTitle + ' · '
            : ''
        )
        + 'ponto salvo em '
        + formatTime(
            resumeState.seconds
        );

    document.getElementById(
        'carryover-thumb'
    ).src =
        'https://i.ytimg.com/vi/'
        + encodeURIComponent(
            resumeState.videoId
        )
        + '/mqdefault.jpg';
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

    if (resumeOutsideCurrentJournal()) {
        box.textContent =
            '▶ Você parou em um vídeo que já saiu das últimas 24 horas — ponto salvo em '
            + formatTime(
                resumeState.seconds
            )
            + '. Ele ficará disponível aqui até você terminar.';

        box.classList.add('show');
        return;
    }

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
                &&
                videoMatchesSearch(video)
            )
            .map(video => video.id);

    if (
        resumeState
        &&
        resumeOutsideCurrentJournal()
        &&
        resumeState.embeddable !== false
        &&
        !isWatched(resumeState.videoId)
    ) {
        activePlaylist.unshift(
            resumeState.videoId
        );
    }

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


function updateWatchButtons() {
    document
        .querySelectorAll(
            '.watch-action[data-video-id]'
        )
        .forEach(button => {
            const videoId =
                button.dataset.videoId;

            const done =
                isWatched(videoId);

            button.classList.toggle(
                'watched',
                done
            );

            button.textContent =
                done
                ? '↶ Marcar como não visto'
                : '✓ Marcar como visto';
        });
}


function updateResumeJumpButton() {
    const button =
        document.getElementById(
            'resume-jump'
        );

    if (!button) {
        return;
    }

    button.disabled = Boolean(
        !resumeState
        ||
        isWatched(
            resumeState.videoId
        )
    );
}


function renderQueueButton(
    button,
    videoId,
    label
) {
    if (!button) {
        return;
    }

    const video =
        metadataForVideo(videoId);

    if (!video) {
        button.hidden = true;
        button.onclick = null;
        return;
    }

    button.hidden = false;
    button.onclick = () =>
        openVideo(videoId);

    const image =
        document.createElement('img');

    image.src =
        'https://i.ytimg.com/vi/'
        + encodeURIComponent(videoId)
        + '/mqdefault.jpg';

    image.alt = '';
    image.loading = 'lazy';

    const text =
        document.createElement('span');

    const labelEl =
        document.createElement('small');

    labelEl.textContent = label;

    const title =
        document.createElement('strong');

    title.textContent =
        video.title || 'Sem título';

    const meta =
        document.createElement('small');

    meta.textContent =
        video.channelTitle || '';

    text.append(
        labelEl,
        title,
        meta
    );

    const duration =
        document.createElement('span');

    duration.className =
        'next-duration';

    duration.textContent =
        video.duration
        ? formatTime(video.duration)
        : '';

    button.replaceChildren(
        image,
        text,
        duration
    );
}


function updateUpNext(
    currentOverride = null
) {
    const box =
        document.getElementById(
            'up-next'
        );

    const firstButton =
        document.getElementById(
            'up-next-first'
        );

    const secondButton =
        document.getElementById(
            'up-next-second'
        );

    if (!box) {
        return;
    }

    let current =
        currentOverride
        ||
        currentVideoId();

    if (
        !current
        &&
        resumeState
        &&
        activePlaylist.includes(
            resumeState.videoId
        )
    ) {
        current =
            resumeState.videoId;
    }

    let startIndex = 0;

    if (
        current
        &&
        activePlaylist.includes(current)
    ) {
        startIndex =
            activePlaylist.indexOf(current)
            + 1;
    }

    const first =
        activePlaylist[startIndex]
        ||
        null;

    const second =
        activePlaylist[startIndex + 1]
        ||
        null;

    renderQueueButton(
        firstButton,
        first,
        'A seguir'
    );

    renderQueueButton(
        secondButton,
        second,
        'Depois'
    );

    box.classList.toggle(
        'empty',
        !first
    );

    const title =
        box.querySelector(
            '.up-next-title'
        );

    if (title) {
        title.textContent =
            first
            ? 'Fila'
            : 'Fila — fim do Jornal';
    }
}


function goToResume() {
    if (
        !resumeState
        ||
        isWatched(resumeState.videoId)
    ) {
        setStatus(
            'Não há um ponto pendente para localizar.'
        );
        return;
    }

    renderCarryover();

    let target =
        Array.from(
            document.querySelectorAll(
                '.card[data-video-id]'
            )
        ).find(card =>
            card.dataset.videoId
            ===
            resumeState.videoId
        );

    if (!target) {
        searchQuery = '';

        const search =
            document.getElementById(
                'video-search'
            );

        if (search) {
            search.value = '';
        }

        applyView();

        target =
            Array.from(
                document.querySelectorAll(
                    '.card[data-video-id]'
                )
            ).find(card =>
                card.dataset.videoId
                ===
                resumeState.videoId
            );
    }

    if (!target) {
        setStatus(
            'O vídeo salvo não está disponível nesta página.'
        );
        return;
    }

    const chapter =
        target.closest('.chapter');

    if (chapter) {
        const key =
            chapter.dataset.chapterKey;

        if (
            key
            &&
            collapsedChapters[key]
        ) {
            delete collapsedChapters[key];
            saveCollapsedChapters();
            applyChapterCollapse();
        }
    }

    target.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });
}


function applyView() {
    let visibleCount = 0;

    document
        .querySelectorAll('.chapter .card')
        .forEach(card => {
            const videoId =
                card.dataset.videoId;

            const video =
                currentVideoMeta(videoId);

            const hidden =
                (
                    onlyUnwatched
                    &&
                    isWatched(videoId)
                )
                ||
                !videoMatchesSearch(video);

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

    let info =
        'Exibindo '
        + visibleCount
        + ' de '
        + VIDEOS.length
        + ' vídeos.';

    if (searchQuery) {
        info += ' Busca ativa.';
    }

    document
        .getElementById('toolbar-info')
        .textContent = info;

    const emptyBox =
        document.getElementById(
            'no-unwatched'
        );

    if (visibleCount === 0) {
        if (searchQuery) {
            emptyBox.textContent =
                'Nenhum vídeo corresponde à busca.';
        }
        else if (onlyUnwatched) {
            emptyBox.textContent =
                'Você já concluiu todos os vídeos disponíveis deste Jornal.';
        }
        else {
            emptyBox.textContent =
                'Nenhum vídeo disponível.';
        }
    }

    emptyBox.classList.toggle(
        'show',
        visibleCount === 0
    );

    applyChapterCollapse();
    renderCarryover();
    rebuildPlaylist();
    updateWatchButtons();
    showResumeInfo();
    updateTimeStats();
    updateResumeJumpButton();
    updateUpNext();
}


function toggleUnwatchedMode() {
    onlyUnwatched =
        !onlyUnwatched;

    saveUnwatchedMode();
    applyView();
}


function updateMiniPlayer() {
    const section =
        document.getElementById(
            'player-section'
        );

    const wrap =
        document.getElementById(
            'playerwrap'
        );

    if (!section || !wrap) {
        return;
    }

    const shouldFloat =
        section.getBoundingClientRect().bottom < 0;

    section.classList.toggle(
        'floating',
        shouldFloat
    );

    wrap.classList.toggle(
        'mini-player',
        shouldFloat
    );
}


window.addEventListener(
    'scroll',
    updateMiniPlayer,
    {passive: true}
);

window.addEventListener(
    'resize',
    updateMiniPlayer
);


const tag =
document.createElement('script');

tag.src =
'https://www.youtube.com/iframe_api';

document.head.appendChild(tag);


resumeState = loadResume();

applyView();
updateHearthPwnSeenUI();
applyHearthPwnCollapse();

if (resumeState) {
    showResumeCard(
        resumeState.videoId
    );
}


function formatPlayerTime(seconds) {
    seconds = Math.max(
        0,
        Math.floor(Number(seconds || 0))
    );

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return (
            String(hours)
            + ':'
            + String(minutes).padStart(2, '0')
            + ':'
            + String(secs).padStart(2, '0')
        );
    }

    return (
        String(minutes)
        + ':'
        + String(secs).padStart(2, '0')
    );
}


function updateTransport() {
    const progress =
        document.getElementById(
            'journal-progress'
        );

    const clock =
        document.getElementById(
            'journal-clock'
        );

    const playPause =
        document.getElementById(
            'journal-play-pause'
        );

    if (
        !progress
        || !clock
        || !playPause
    ) {
        return;
    }

    if (!player || !ready) {
        progress.value = '0';
        clock.textContent = '0:00 / 0:00';
        playPause.textContent = '▶ Play';
        return;
    }

    try {
        const duration =
            Number(player.getDuration() || 0);

        const current =
            Number(player.getCurrentTime() || 0);

        if (!transportDragging) {
            progress.value =
                duration > 0
                ? String(
                    Math.round(
                        Math.min(1, current / duration)
                        * 1000
                    )
                )
                : '0';
        }

        clock.textContent =
            formatPlayerTime(current)
            + ' / '
            + formatPlayerTime(duration);

        const state =
            player.getPlayerState();

        playPause.textContent =
            state === YT.PlayerState.PLAYING
            ? '⏸ Pausar'
            : '▶ Play';
    }
    catch (_) {}
}


function togglePlayerPlayback() {
    if (!player || !ready) {
        return;
    }

    try {
        const state =
            player.getPlayerState();

        if (state === YT.PlayerState.PLAYING) {
            player.pauseVideo();
        }
        else {
            player.playVideo();
        }
    }
    catch (_) {}
}


function seekBy(seconds) {
    if (!player || !ready) {
        return;
    }

    try {
        const duration =
            Number(player.getDuration() || 0);

        const current =
            Number(player.getCurrentTime() || 0);

        const target = Math.max(
            0,
            duration > 0
                ? Math.min(duration, current + seconds)
                : current + seconds
        );

        player.seekTo(target, true);
        updateTransport();
    }
    catch (_) {}
}


function previewSeek(value) {
    transportDragging = true;

    if (!player || !ready) {
        return;
    }

    try {
        const duration =
            Number(player.getDuration() || 0);

        const target =
            duration * (Number(value || 0) / 1000);

        const clock =
            document.getElementById(
                'journal-clock'
            );

        if (clock) {
            clock.textContent =
                formatPlayerTime(target)
                + ' / '
                + formatPlayerTime(duration);
        }
    }
    catch (_) {}
}


function commitSeek(value) {
    if (!player || !ready) {
        transportDragging = false;
        return;
    }

    try {
        const duration =
            Number(player.getDuration() || 0);

        const target =
            duration * (Number(value || 0) / 1000);

        player.seekTo(target, true);
    }
    catch (_) {}

    transportDragging = false;
    updateTransport();
}


setInterval(
    updateTransport,
    500
);


function standardEmbedUrl(videoId) {
    const params =
        new URLSearchParams({
            enablejsapi: '1',
            controls: '1',
            playsinline: '1',
            rel: '0',
            fs: '1',
            origin: window.location.origin
        });

    return (
        'https://www.youtube.com/embed/'
        + encodeURIComponent(videoId)
        + '?'
        + params.toString()
    );
}


function onYouTubeIframeAPIReady() {
    if (
        !CURRENT_EMBEDDABLE_IDS.length
        &&
        !(
            resumeState
            &&
            resumeState.embeddable !== false
        )
    ) {
        setStatus(
            'Nenhum vídeo reproduzível no player.'
        );
        return;
    }

    let initialId =
        activePlaylist[0]
        ||
        CURRENT_EMBEDDABLE_IDS[0];

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

    /*
     * IMPORTANTE:
     * Todo conteúdo, inclusive Shorts, é carregado
     * pelo endpoint padrão /embed/VIDEO_ID.
     * A rota /shorts/ é usada apenas no Python
     * para identificar se um upload é Short.
     */
    const slot =
        document.getElementById(
            'player-slot'
        );

    const iframe =
        document.createElement(
            'iframe'
        );

    iframe.id =
        'youtube-standard-player';

    iframe.src =
        standardEmbedUrl(
            initialId
        );

    iframe.title =
        'Player do YouTube';

    iframe.allow =
        'accelerometer; autoplay; clipboard-write; '
        + 'encrypted-media; gyroscope; picture-in-picture; web-share';

    iframe.allowFullscreen = true;

    iframe.referrerPolicy =
        'strict-origin-when-cross-origin';

    slot.replaceChildren(
        iframe
    );

    player =
    new YT.Player(
        'youtube-standard-player',
        {
            events: {
                onReady:
                    () => {
                        ready = true;
                        rebuildPlaylist();
                        updateTransport();

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

                        updateTransport();

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
                                updateUpNext(id);
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

                            const wasCarryover =
                                Boolean(
                                    id
                                    &&
                                    !currentVideoMeta(id)
                                );

                            if (id) {
                                markWatched(id);
                                clearResume(id);
                            }

                            if (
                                onlyUnwatched
                                ||
                                wasCarryover
                            ) {
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
    updateUpNext(id);

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
        metadataForVideo(id);

    if (!video) {
        return;
    }

    if (video.embeddable === false) {
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
        searchQuery = '';
        saveUnwatchedMode();

        const search =
            document.getElementById(
                'video-search'
            );

        if (search) {
            search.value = '';
        }

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
        .replace("__HEARTHPWN_WIDGET__", hearthpwn_html)
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

    hearthpwn_news = fetch_hearthpwn_news()

    hearthpwn_news = translate_hearthpwn_news(
        hearthpwn_news,
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
                hearthpwn_news,
            )
        )

    log("index.html atualizado.")


if __name__ == "__main__":
    main()
