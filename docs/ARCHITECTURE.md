# Arquitetura do Jornal do Futebol

Este arquivo existe para tornar alterações futuras mais rápidas e seguras.

## Fonte de verdade

- `jornal.py`: coleta dados, aplica regras de negócio, monta fragmentos dinâmicos e gera `index.html`.
- `templates/index.html`: estrutura HTML da página. Não contém lógica de coleta.
- `assets/style.css`: todo o CSS da interface.
- `assets/app.js`: toda a lógica do navegador, player, vistos, retomada, filtros, fullscreen e gestos.
- `channels.json`: lista de canais e regra `onlyShorts`.
- `tests/validate_site.py`: valida estrutura dos arquivos e o HTML final.
- `.github/workflows/jornal.yml`: valida, gera e publica o site.

`index.html` é arquivo gerado. Não deve ser editado manualmente nem versionado.

## Fluxo de publicação

1. O workflow valida Python, JavaScript e os arquivos-fonte.
2. Instala o Argos Translate.
3. Executa `jornal.py`.
4. Valida o `index.html` gerado.
5. Copia HTML, CSS, JS e cache de tradução para `_site`.
6. Publica no GitHub Pages.

Além das execuções externas periódicas, alterações de código em `main` disparam uma execução automática. Isso elimina a necessidade de editar temporariamente o workflow só para publicar uma mudança.

## Cache dos assets

`jornal.py` calcula SHA-256 de `assets/style.css` e `assets/app.js` e inclui os 12 primeiros caracteres na URL:

- `assets/style.css?v=<hash>`
- `assets/app.js?v=<hash>`

Assim, mudanças de CSS/JS chegam ao navegador sem depender de limpeza manual do cache.

## Onde alterar cada coisa

- Visual, tamanhos, espaçamento, responsividade: `assets/style.css`.
- Botões, gestos, player, localStorage, fila, fullscreen: `assets/app.js`.
- Layout/ordem dos blocos fixos da página: `templates/index.html`.
- Cards e conteúdo HTML criado a partir dos vídeos: `jornal.py`.
- Canais monitorados: `channels.json`.
- Regras de publicação: `.github/workflows/jornal.yml`.

## Validação local

```bash
python -m py_compile jornal.py tests/validate_site.py
node --check assets/app.js
python tests/validate_site.py --source-only
```

Depois de gerar o Jornal com uma chave válida:

```bash
python jornal.py
python tests/validate_site.py
```

## Regra para alterações futuras

Antes de publicar uma mudança:

1. alterar somente a camada responsável;
2. preservar os IDs e contratos usados entre HTML e JavaScript;
3. executar as validações;
4. deixar o workflow impedir a publicação se alguma validação falhar.
