import os
import json
import time
import html
import re
import hashlib

from collections import OrderedDict, Counter
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from html.parser import HTMLParser
from xml.etree import ElementTree as ET


BASE_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

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
PORTS_WINDOW_HOURS = 7 * 24

COLLECTION_DIAGNOSTICS = {"journal": [], "ports": []}
CHANNEL_METADATA_CACHE_FILE = os.path.join(BASE_DIR, "channel_metadata_cache.json")
_CHANNEL_METADATA_CACHE = None

def load_channel_metadata_cache():
    global _CHANNEL_METADATA_CACHE
    if _CHANNEL_METADATA_CACHE is not None:
        return _CHANNEL_METADATA_CACHE
    try:
        with open(CHANNEL_METADATA_CACHE_FILE, encoding="utf-8") as file:
            parsed = json.load(file)
        _CHANNEL_METADATA_CACHE = parsed if isinstance(parsed, dict) else {}
    except (OSError, ValueError, TypeError):
        _CHANNEL_METADATA_CACHE = {}
    return _CHANNEL_METADATA_CACHE

def store_channel_metadata(key, item):
    cache = load_channel_metadata_cache()
    cache[key] = {
        "channelId": item["channelId"],
        "channelTitle": item["channelTitle"],
        "uploads": item["uploads"],
        "savedAt": time.time(),
    }
    try:
        with open(CHANNEL_METADATA_CACHE_FILE, "w", encoding="utf-8") as file:
            json.dump(cache, file, ensure_ascii=False)
    except OSError:
        pass


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
                "channelId": str(item.get("channelId", "")).strip(),
                "onlyShorts": bool(item.get("onlyShorts", False)),
            }
        )

    if not out:
        raise RuntimeError("channels.json não contém canais válidos.")

    return out


def load_ports_channels():
    """Canais exclusivos do painel sobre portes e recompilações."""
    with open("ports_channels.json", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, list) or not data:
        raise RuntimeError("ports_channels.json sem canais válidos.")

    configs = []
    seen = set()

    for item in data:
        name = str(item.get("name", "")).strip()
        handle = str(item.get("handle", "")).strip()
        channel_id = str(item.get("channelId", "")).strip()

        if not name or not (handle or channel_id):
            raise RuntimeError("Entrada inválida de canal de portes.")

        if handle and not handle.startswith("@"):
            handle = "@" + handle

        identity = (channel_id or handle).casefold()
        if identity in seen:
            raise RuntimeError("Canal duplicado em ports_channels.json: " + name)

        seen.add(identity)
        configs.append({
            "name": name,
            "handle": handle,
            "channelId": channel_id,
            "onlyShorts": False,
        })

    return configs


def resolve_channel(key, config):
    fixed_id = config.get("channelId") or ""
    cache_key = fixed_id if fixed_id else None

    # Só reutilizamos metadados de canais com identidade imutável
    # comprovada. Handles podem mudar de dono.
    if cache_key:
        cached = load_channel_metadata_cache().get(cache_key)
        if (
            isinstance(cached, dict)
            and cached.get("channelId") == fixed_id
            and isinstance(cached.get("uploads"), str)
            and cached.get("uploads")
            and isinstance(cached.get("channelTitle"), str)
            and cached.get("channelTitle")
            and 0 <= time.time() - float(cached.get("savedAt", 0)) < 12 * 3600
        ):
            return {**config, **cached}

    lookup = (
        {"id": config["channelId"]}
        if config.get("channelId")
        else {"forHandle": config["handle"]}
    )

    data = yt(
        "channels",
        key,
        part="id,snippet,contentDetails",
        maxResults=1,
        **lookup,
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

    if fixed_id and channel["id"] != fixed_id:
        raise RuntimeError("O ID do canal não corresponde à configuração: " + config["handle"])

    if not fixed_id:
        log("IDENTIDADE JORNAL " + config["handle"] + " | ID="
            + channel["id"] + " | YouTube=" + channel["snippet"]["title"])

    if config.get("name"):
        log(
            "IDENTIDADE PORTES "
            + config["name"] + " "
            + config["handle"] + " | ID="
            + channel["id"] + " | YouTube="
            + channel["snippet"]["title"]
        )

    resolved = {
        **config,
        "channelId": channel["id"],
        "channelTitle": channel["snippet"]["title"],
        "uploads": uploads,
    }
    store_channel_metadata(channel["id"], resolved)
    return resolved


def parse_dt(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def recent_uploads(key, channel, start, now_utc):
    result = []
    token = None
    visited_tokens = set()
    seen_videos = set()
    pages_read = 0

    while True:
        pages_read += 1
        if pages_read > 200:
            raise RuntimeError(
                "Paginação excedeu o limite de segurança: "
                + channel["handle"]
            )

        params = {
            "part": "contentDetails",
            "playlistId": channel["uploads"],
            "maxResults": 50,
        }

        if token:
            params["pageToken"] = token

        data = yt("playlistItems", key, **params)
        items = data.get("items", [])

        if not isinstance(items, list) or not items:
            break

        found_old = False

        for item in items:
            details = item.get("contentDetails") or {}
            video_id = details.get("videoId")
            published = details.get("videoPublishedAt")

            # O ID será usado no HTML e em handlers JS; nunca confiar em
            # identificadores externos fora do formato oficial.
            if (
                not isinstance(video_id, str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id)
                or video_id in seen_videos
                or not isinstance(published, str)
            ):
                continue

            try:
                date = parse_dt(published)
            except (TypeError, ValueError):
                log("Upload com data inválida ignorado: " + video_id)
                continue

            if date < start:
                found_old = True
                continue

            if date > now_utc:
                continue

            seen_videos.add(video_id)

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

        next_token = data.get("nextPageToken")
        if not next_token:
            break

        if next_token == token or next_token in visited_tokens:
            raise RuntimeError(
                "Paginação circular detectada em " + channel["handle"]
            )

        visited_tokens.add(next_token)
        token = next_token

    return result



def recent_youtube_rss(channel, start, now_utc):
    """Recupera publicações omitidas ou atrasadas na playlist de uploads.

    O Atom do canal é consulta pública sem custo de quota de API.
    Cada candidato continua validado pela API de vídeos e pelo ID do canal.
    """
    channel_id = channel["channelId"]

    if not re.fullmatch(r"UC[A-Za-z0-9_-]{22}", channel_id):
        raise RuntimeError("ID de canal inválido para Atom: " + channel["handle"])

    source = get_text(
        "https://www.youtube.com/feeds/videos.xml?channel_id=" + channel_id,
        retries=1,
        timeout=8,
    )
    root = ET.fromstring(source)

    atom = "{http://www.w3.org/2005/Atom}"
    yt_ns = "{http://www.youtube.com/xml/schemas/2015}"
    result = []
    seen = set()

    for entry in root.findall(atom + "entry"):
        video_id = entry.findtext(yt_ns + "videoId")
        entry_channel_id = entry.findtext(yt_ns + "channelId")
        published = entry.findtext(atom + "published")

        if (
            not video_id
            or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id)
            or video_id in seen
            or entry_channel_id != channel_id
            or not published
        ):
            continue

        try:
            date = parse_dt(published)
        except (TypeError, ValueError):
            continue

        if not (start <= date <= now_utc):
            continue

        seen.add(video_id)
        result.append({
            "videoId": video_id,
            "publishedAt": published,
            "publishedDt": date,
            "channelId": channel_id,
            "channelTitle": channel["channelTitle"],
            "channelHandle": channel["handle"],
            "onlyShorts": channel["onlyShorts"],
        })

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


SHORT_CLASSIFICATION_CACHE = {}


def short_confirmed(video_id, video):
    if video_id in SHORT_CLASSIFICATION_CACHE:
        return SHORT_CLASSIFICATION_CACHE[video_id]

    seconds = duration_seconds(
        video.get("contentDetails", {}).get("duration")
    )

    if seconds is None:
        return None

    if seconds > 180:
        SHORT_CLASSIFICATION_CACHE[video_id] = False
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

        if width <= 0 or height <= 0:
            return None

        is_short = width <= height
        SHORT_CLASSIFICATION_CACHE[video_id] = is_short
        return is_short

    except Exception as erro:
        log(f"Short não confirmado ({video_id}): {erro}")
        return None


def collect(key, configs, window_hours=WINDOW_HOURS, strict=True):
    now_local = datetime.now(TZ)
    now_utc = now_local.astimezone(UTC)
    start = now_utc - timedelta(hours=window_hours)

    candidates = {}
    failures = []
    successful_channels = 0
    recent_by_handle = {}
    atom_status = {}

    for config in configs:
        try:
            channel = resolve_channel(key, config)
            # Para o painel, se a playlist falhar o Atom ainda pode
            # recuperar vídeos, sem alterar as regras da coleta principal.
            playlist_error = None

            try:
                uploads = recent_uploads(key, channel, start, now_utc)
            except Exception as error:
                if strict:
                    raise

                playlist_error = error
                uploads = []
                log(
                    f"AVISO: playlist de {config['handle']} indisponível: "
                    f"{error}; consultando o feed Atom."
                )

            # Feed Atom é complementar, não substitui a API oficial.
            # Painel de portes: verificar todos os seis canais, mesmo quando
            # a playlist retorna alguns vídeos, para detectar lacunas.
            if not strict:
                try:
                    rss_videos = recent_youtube_rss(
                        channel, start, now_utc
                    )
                    atom_status[config["handle"]] = True
                    by_id = {video["videoId"]: video for video in uploads}
                    recovered = 0

                    for video in rss_videos:
                        if video["videoId"] not in by_id:
                            by_id[video["videoId"]] = video
                            recovered += 1

                    uploads = list(by_id.values())
                    log(
                        f"AUDITORIA ATOM {config['handle']}: "
                        f"feed={len(rss_videos)}, "
                        f"recuperados={recovered}, "
                        f"total={len(uploads)}"
                    )

                    if recovered:
                        log(
                            f"RECUPERADOS VIA ATOM {config['handle']}: "
                            f"{recovered} vídeo(s) não encontrados na playlist."
                        )

                    if playlist_error is not None:
                        failures.append(
                            f"{config['handle']}: recuperação parcial pelo "
                            "feed Atom; playlist indisponível."
                        )

                except Exception as error:
                    atom_status[config["handle"]] = False
                    log(
                        f"AVISO: feed complementar {config['handle']}: "
                        f"{error}"
                    )

                    if playlist_error is not None:
                        raise RuntimeError(
                            "Playlist e feed Atom indisponíveis: "
                            + str(playlist_error)
                            + " | "
                            + str(error)
                        ) from error

            # "Canal OK" somente depois de consultar a lista de uploads.
            successful_channels += 1
            recent_by_handle[config["handle"]] = len(uploads)

            log(
                "CANAL OK: "
                + channel["channelTitle"]
                + " ["
                + ("SOMENTE SHORTS" if channel["onlyShorts"] else "TODOS")
                + "]"
                + f" | {len(uploads)} uploads nas últimas {window_hours}h"
            )

            for item in uploads:
                candidates[item["videoId"]] = item

        except Exception as erro:
            failures.append(f"{config['handle']}: {erro}")
            log("AVISO: " + config["handle"] + ": " + str(erro))

    if strict and successful_channels == 0:
        raise RuntimeError(
            "Nenhum canal pôde ser consultado. Verifique a API Key."
        )

    if strict and len(failures) > max(3, len(configs) // 4):
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

        # Identifica Shorts também nos canais mistos. Sem essa verificação,
        # "Pular canal hoje" ocultaria Shorts desses canais.
        # Em caso de falha na classificação, is_short=None: o filtro
        # preserva o vídeo para evitar esconder um possível Short.
        is_short = short_confirmed(video_id, video)

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
            and is_short is False
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
                "isShort": is_short,
                "embeddable": bool(
                    video.get("status", {}).get("embeddable", True)
                ),
            }
        )

    accepted.sort(key=lambda item: item["publishedDt"])

    # Auditoria individual: distinguir canal sem publicações, filtragem
    # por Shorts/lives e falhas de coleta sem custos extras de API.
    accepted_counts = Counter(
        video["channelHandle"]
        for video in accepted
    )

    audit = []
    for config in configs:
        handle = config["handle"]
        audit.append({
            "handle": handle,
            "uploads": recent_by_handle.get(handle, 0),
            "included": accepted_counts[handle],
            "atomAvailable": atom_status.get(handle),
            "lastCheckedAt": now_local.isoformat() if handle in recent_by_handle else None,
            "failed": any(issue.startswith(handle + ":") for issue in failures),
        })
        if handle in recent_by_handle:
            log(
                f"RESUMO CANAL {handle}: "
                f"uploads={recent_by_handle[handle]}, "
                f"incluídos={accepted_counts[handle]}"
            )

    COLLECTION_DIAGNOSTICS["journal" if strict else "ports"] = audit
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


def asset_version(relative_path):
    path = os.path.join(
        BASE_DIR,
        relative_path,
    )

    digest = hashlib.sha256()

    with open(path, "rb") as file:
        for chunk in iter(
            lambda: file.read(65536),
            b"",
        ):
            digest.update(chunk)

    return digest.hexdigest()[:12]


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



def player_video_record(video):
    return {
        "id": video["videoId"],
        "title": video["title"],
        "channelTitle": video["channelTitle"],
        "channelHandle": video["channelHandle"],
        "publishedAt": video["publishedDt"].astimezone(TZ).isoformat(),
        "duration": video["durationSeconds"],
        "countForTime": video["countForTime"],
        "isShort": video["isShort"],
        "embeddable": video["embeddable"],
    }


def build_ports_widget(videos, channels, failures):
    """Painel recolhível semelhante ao HearthPwn, sem poluir o Jornal."""
    rows = []
    # Todos os vídeos válidos da janela entram no painel, sem
    # limite global que privilegie os canais mais prolíficos.
    latest = sorted(
        videos,
        key=lambda video: video["publishedDt"],
    )

    for video in latest:
        video_id = html.escape(video["videoId"], quote=True)
        title = html.escape(video["title"])
        channel = html.escape(video["channelTitle"])
        published = html.escape(
            video["publishedDt"].astimezone(TZ).strftime("%d/%m · %H:%M")
        )
        external_note = (
            '<span class="ports-video-note">Abre no YouTube ↗</span>'
            if not video["embeddable"]
            else ""
        )

        rows.append(f"""
<article class="ports-video-item" data-video-id="{video_id}">
<button class="ports-play" type="button"
    onclick="openPortsVideo('{video_id}')">
<img src="https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"
    loading="lazy" alt="">
<span class="ports-video-copy">
<strong>{title}</strong>
<span class="ports-video-details">{channel} · {published}</span>
{external_note}
</span>
</button>
<button class="ports-watch-action" type="button"
    onclick="toggleWatched('{video_id}', 'ports')">
✓ Marcar como visto
</button>
</article>
""")

    if not rows:
        rows.append(
            '<p class="ports-empty">'
            + (
                'Alguns canais não puderam ser verificados. '
                'Consulte o diagnóstico da coleta.'
                if failures else
                'Nenhum vídeo publicado nesses canais nos últimos 7 dias.'
            )
            + '</p>'
        )

    if failures:
        rows.insert(
            0,
            '<p class="ports-source-warning">'
            + str(len(failures))
            + ' canal(is) tiveram coleta parcial ou falha nesta atualização.'
            '</p>'
        )

    count = len(latest)
    label = "vídeo" if count == 1 else "vídeos"
    counts_by_channel = Counter(
        video["channelHandle"].casefold()
        for video in latest
    )

    chips = (
        '<button class="ports-channel-chip" type="button"'
        ' data-channel-handle="" aria-pressed="true"'
        ' onclick="setPortsChannelFilter(this.dataset.channelHandle)">'
        'Todos <strong class="ports-channel-count">'
        + str(count) + '</strong></button>'
        + " ".join(
            '<button class="ports-channel-chip" type="button"'
            ' data-channel-handle="' + html.escape(source["handle"], quote=True)
            + '" aria-pressed="false"'
            ' onclick="setPortsChannelFilter(this.dataset.channelHandle)">'
            + html.escape(source["name"])
            + ' <strong class="ports-channel-count">'
            + str(counts_by_channel.get(source["handle"].casefold(), 0))
            + '</strong></button>'
            for source in channels
        )
    )

    return f"""
<section class="ports-widget" aria-label="Portes, descompilações e recompilações">
<div class="ports-head">
    <div class="ports-heading">
        <span class="widget-kicker">PROJETOS NATIVOS • PC</span>
        <h2>Portes &amp; Recompilações</h2>
        <span class="ports-subtitle">Últimos 7 dias · {count} {label} · lives excluídas</span>
    </div>
    <button class="ports-collapse-toggle" type="button"
        onclick="togglePortsWidget()"
        aria-expanded="true"
        title="Recolher vídeos de portes">
        <span class="ports-collapse-chevron" aria-hidden="true">▾</span>
    </button>
</div>
<div class="ports-content">
    <div class="ports-channel-list" role="group" aria-label="Filtrar vídeos por canal">{chips}</div>
    <div class="ports-filter-toolbar" aria-label="Filtrar vídeos">
        <label class="ports-search-wrap" for="ports-search">
            <span class="ports-field-label">Buscar no painel</span>
            <input id="ports-search" class="ports-search" type="search"
                placeholder="Jogo, assunto ou título…" autocomplete="off"
                oninput="setPortsSearch(this.value)">
        </label>
        <label class="ports-sort-wrap" for="ports-sort">
            <span class="ports-field-label">Ordem</span>
            <select id="ports-sort" class="ports-sort" onchange="setPortsSort(this.value)">
                <option value="newest">Mais recentes</option>
                <option value="oldest">Mais antigos</option>
            </select>
        </label>
        <button id="ports-unwatched-toggle" class="ports-unwatched-toggle"
            type="button" aria-pressed="false"
            onclick="togglePortsUnwatched()">Só não assistidos</button>
    </div>
    <div class="ports-extra-controls">
        <label><input id="ports-relevance" type="checkbox"
            onchange="setPortsRelevance(this.checked)">
            Mostrar apenas vídeos relacionados a portes e recompilações
        </label>
    </div>
    <div class="ports-filter-status">
        <span id="ports-visible-count" aria-live="polite">{count} vídeos nesta seleção</span>
        <button id="ports-clear-filters" class="ports-clear-filters" type="button"
            onclick="resetPortsFilters()" hidden>Limpar filtros</button>
    </div>
    <div class="ports-video-list">
        {"".join(rows)}
        <p class="ports-filter-empty" id="ports-filter-empty" hidden>
            Nenhum vídeo corresponde aos filtros escolhidos.
        </p>
    </div>
    <div class="ports-more-row">
        <button id="ports-show-more" type="button"
            onclick="showMorePorts()" hidden>Mostrar mais vídeos</button>
    </div>
    <div class="ports-bottom">
        <button id="ports-play-selection" class="ports-play-selection"
            type="button" onclick="playPortsSelection()">▶ Assistir seleção</button>
        <div class="ports-progress-area">
            <div class="ports-progress-summary">
                <span id="ports-progress">0 de {count} assistidos</span>
                <span id="ports-progress-percent">0%</span>
            </div>
            <div id="ports-progress-track" class="ports-progress-track" role="progressbar"
                aria-label="Progresso dos vídeos de portes"
                aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <span id="ports-progress-fill"></span>
            </div>
        </div>
    </div>
</div>
</section>
"""


def build_page(videos, now_local, failures, hearthpwn_news=None, ports_videos=None, ports_channels=None, ports_failures=None):
    date = journal_day(now_local)
    updated = now_local.strftime("%d/%m/%Y às %H:%M")
    hearthpwn_html = build_hearthpwn_widget(hearthpwn_news or [])
    ports_videos = ports_videos or []
    ports_html = build_ports_widget(
        ports_videos,
        ports_channels or [],
        ports_failures or [],
    )

    player_videos = [
        player_video_record(video)
        for video in videos
    ]
    ports_player_videos = [
        player_video_record(video)
        for video in ports_videos
    ]

    chapters = OrderedDict()

    for video in videos:
        label = chapter_label(video["publishedDt"], now_local)
        chapters.setdefault(label, []).append(video)

    chapter_html_parts = []

    for chapter_index, (label, chapter_videos) in enumerate(chapters.items()):
        period = (
            label.split(" • ", 1)[1]
            if " • " in label
            else ""
        )

        chapter_icon = {
            "Madrugada": "☾",
            "Manhã": "☀",
            "Tarde": "◐",
            "Noite": "☾",
        }.get(
            period,
            "•",
        )

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
    aria-label="Segure por 2 segundos para alterar o status de assistido"
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

<div class="chapter-heading">
<button
    class="chapter-title"
    type="button"
    onclick="toggleChapter(this.closest('.chapter').dataset.chapterKey)"
>
<span class="chapter-title-text">
<span
    class="chapter-period-icon"
    aria-hidden="true"
>
__CHAPTER_ICON__
</span>
__CHAPTER_LABEL__
<span class="chapter-count">(__CHAPTER_COUNT__)</span>
</span>
<span class="chapter-chevron" aria-hidden="true">▾</span>
</button>
<button
    class="chapter-mark-all"
    type="button"
    onclick="markChapterWatched(this.closest('.chapter').dataset.chapterKey)"
    aria-label="Marcar todos os vídeos de __CHAPTER_LABEL__ como assistidos"
    title="Marcar todos os vídeos deste período como assistidos"
>
✓ Marcar período como visto
</button>
</div>

<div class="list chapter-list">
__CARDS__
</div>

</section>
"""
            .replace("__CHAPTER_INDEX__", str(chapter_index))
            .replace("__CHAPTER_KEY__", html.escape(date + "|" + label, quote=True))
            .replace("__CHAPTER_LABEL__", html.escape(label))
            .replace("__CHAPTER_ICON__", chapter_icon)
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

    template_path = os.path.join(
        BASE_DIR,
        "templates",
        "index.html",
    )

    with open(
        template_path,
        encoding="utf-8",
    ) as file:
        page = file.read()

    page = (
        page
        .replace("__BUILD_VERSION__", html.escape(now_local.isoformat(), quote=True))
        .replace("__SOURCE_AUDIT__", js_json(COLLECTION_DIAGNOSTICS))
        .replace("__DATE__", html.escape(date))
        .replace("__UPDATED__", html.escape(updated))
        .replace("__WARNING__", warning)
        .replace("__HEARTHPWN_WIDGET__", hearthpwn_html)
        .replace("__PORTS_WIDGET__", ports_html)
        .replace("__PORTS_VIDEOS__", js_json(ports_player_videos))
        .replace("__CHAPTERS_HTML__", chapters_html)
        .replace("__PLAYER_VIDEOS__", js_json(player_videos))
        .replace(
            "__STYLE_VERSION__",
            asset_version("assets/style.css"),
        )
        .replace(
            "__CORE_VERSION__",
            asset_version("assets/core.js"),
        )
        .replace(
            "__GESTURES_VERSION__",
            asset_version("assets/gestures.js"),
        )
        .replace(
            "__VIEW_VERSION__",
            asset_version("assets/view.js"),
        )
        .replace(
            "__PLAYER_VERSION__",
            asset_version("assets/player.js"),
        )
        .replace(
            "__MOTION_VERSION__",
            asset_version("assets/motion.js"),
        )
        .replace(
            "__FEATURES_VERSION__",
            asset_version("assets/features.js"),
        )
        .replace(
            "__ENHANCEMENTS_VERSION__",
            asset_version("assets/enhancements.js"),
        )
        .replace(
            "__BOOTSTRAP_VERSION__",
            asset_version("assets/bootstrap.js"),
        )
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

    ports_configs = load_ports_channels()

    try:
        ports_videos, _, ports_failures = collect(
            key,
            ports_configs,
            window_hours=PORTS_WINDOW_HOURS,
            strict=False,
        )
    except Exception as erro:
        # O painel é opcional: não deve derrubar a edição principal.
        log(f"AVISO: painel de portes indisponível: {erro}")
        ports_videos, ports_failures = [], [str(erro)]

    # Não descartar vídeos do painel por coincidirem com outra seção.
    # As listas são independentes e as marcações são por videoId.
    ports_videos.sort(key=lambda video: video["publishedDt"])

    # O status é global por ID, mas estes vídeos têm seu próprio feed.
    for video in ports_videos:
        video["countForTime"] = False

    log(f"Painel de portes: {len(ports_videos)} vídeo(s) novo(s).")
    for video in ports_videos:
        log(
            "PORTS INCLUÍDO: "
            + video["channelTitle"]
            + " | "
            + video["videoId"]
            + " | "
            + video["title"]
        )

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
                ports_videos,
                ports_configs,
                ports_failures,
            )
        )

    log("index.html atualizado.")


if __name__ == "__main__":
    main()
