#!/usr/bin/env python3
"""Regressões de segurança sem rede: HTML de terceiros e JSON incorporado."""
import json
import sys
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import jornal


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    # Validar a URL depois da resolução, jamais apenas o escaping de HTML.
    valid = (
        "https://www.hearthpwn.com/news/segura",
        "https://hearthpwn.com/news/segura",
        "/news/segura",
        "//www.hearthpwn.com/news/segura",
    )
    for url in valid:
        result = jornal.safe_hearthpwn_url(url)
        require(result is not None and result.startswith("https://"),
                "Link HTTPS legítimo rejeitado: " + url)

    invalid = (
        "javascript:alert(1)", "javascript:/news/evil",
        "data:text/html,/news/x", "http://www.hearthpwn.com/news/x",
        "https://evil.example/news/x",
        "//evil.example/news/x",
        "https://www.hearthpwn.com.evil.example/news/x",
        "https://www.hearthpwn.com@evil.example/news/x",
        "https://www.hearthpwn.com:444/news/x",
        "file:///news/x",
        "https://www.hearthpwn.com/news/x\nContent-Type:evil",
    )
    for url in invalid:
        require(jornal.safe_hearthpwn_url(url) is None,
                "Link inseguro aceito: " + repr(url))

    # Envenenamento de feed não pode virar hyperlink executável no site.
    rss = """<rss><channel>
        <item><title>Segura</title><link>https://www.hearthpwn.com/news/segura</link></item>
        <item><title>Maliciosa</title><link>javascript:alert(1)</link></item>
        <item><title>Externa</title><link>https://evil.example/news/evil</link></item>
    </channel></rss>"""
    parsed = jornal.parse_hearthpwn_rss(rss)
    require(len(parsed) == 1 and parsed[0]["title"] == "Segura",
            "O parser aceitou links externos indevidos")

    parser = jornal.HearthPwnHomeParser()
    parser.feed(
        '<h2><a href="javascript:/news/attack">Não</a></h2>'
        '<h2><a href="/news/ok">Sim</a></h2>'
    )
    require(len(parser.items) == 1 and parser.items[0]["title"] == "Sim",
            "O parser da homepage aceitou link executável")

    dangerous = [{
        "title": "<img src=x onerror=alert(1)>",
        "url": "javascript:alert(1)",
        "summary": "conteúdo", "published": "",
    }]
    require(jornal.build_hearthpwn_widget(dangerous) == "",
            "O widget não descartou todas as fontes inseguras")

    safe_news = [{
        "title": "<script>alert(1)</script>",
        "url": "/news/ok",
        "summary": '<img src=x onerror="alert(1)">',
        "published": "",
    }]
    rendered = jornal.build_hearthpwn_widget(safe_news)
    require('href="https://www.hearthpwn.com/news/ok"' in rendered,
            "O widget não normalizou o link legítimo")
    require("<script>alert(1)</script>" not in rendered
            and "<img src=x onerror" not in rendered,
            "Conteúdo externo não foi escapado no HTML")

    # Dados da API vão dentro de script type=application/json.
    malicious = '</script><script>alert("x")</script>&'
    embedded = jornal.js_json({"title": malicious})
    require("<" not in embedded and ">" not in embedded and "&" not in embedded,
            "JSON incorporado permite encerramento do elemento script")
    require(json.loads(embedded)["title"] == malicious,
            "Escaping seguro corrompeu o conteúdo JSON")

    # A coleta não deve aceitar respostas externas ilimitadas.
    require(jornal.read_limited(BytesIO(b"abc"), 3) == b"abc",
            "Limite de resposta rejeitou um corpo legítimo")
    try:
        jornal.read_limited(BytesIO(b"abcd"), 3)
    except ValueError:
        pass
    else:
        raise AssertionError("Uma resposta externa excessiva foi aceita")

    print("Segurança: URL, RSS, HTML, JSON e limites de payload OK.")


if __name__ == "__main__":
    main()
