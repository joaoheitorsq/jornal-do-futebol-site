# Arquitetura do Jornal do Futebol

Este documento é o mapa para alterações futuras. A regra principal é mexer apenas no módulo responsável pelo comportamento desejado.

## Fonte de verdade

- `jornal.py`: coleta dados, regras do YouTube/HearthPwn, criação dos cards e geração de `index.html`.
- `templates/index.html`: estrutura fixa da página e ordem de carregamento dos módulos.
- `assets/style.css`: visual e responsividade.
- `assets/core.js`: dados globais, estado base, armazenamento principal, vistos e HearthPwn.
- `assets/gestures.js`: proteção por toque longo e gestos dos botões da lista.
- `assets/view.js`: capítulos, busca, retomada, fila, tempos, filtros e mini-player.
- `assets/player.js`: transporte, YouTube Player, navegação, fullscreen e avanço protegido.
- `assets/motion.js`: animações otimizadas para compositor e observação da viewport.
- `assets/features.js`: fila manual, adiar, terminar depois, backup, progresso por vídeo, sessão, undo, marcação em lote de períodos e controles avançados.
- `assets/enhancements.js`: personalização, filtros extras, favoritos, silenciamento, diagnóstico e carregamento progressivo de portes.
- `assets/bootstrap.js`: inicialização do estado e carregamento da API do YouTube. Deve ser o último módulo.
- `channels.json`: canais e regra `onlyShorts`.
- `ports_channels.json`: canais do painel independente de portes.
- `service-worker.js` e `manifest.webmanifest`: cache restrito ao projeto e instalação PWA.
- `tests/validate_site.py`: contrato estrutural do projeto.
- `.github/workflows/jornal.yml`: valida, gera e publica.

`index.html` é gerado. Não deve ser editado ou versionado manualmente.

## Ordem dos JavaScript

A ordem é um contrato:

1. `core.js`
2. `gestures.js`
3. `view.js`
4. `player.js`
5. `motion.js`
6. `features.js`
7. `enhancements.js`
8. `bootstrap.js`

Os arquivos são scripts clássicos e compartilham o mesmo estado global. Todos usam `defer`, para permitir download paralelo sem bloquear o parser, mas a execução permanece na ordem declarada. O `bootstrap.js` inicializa os dados somente depois que todas as funções já foram carregadas. A ordem e o atributo `defer` são verificados no validador.

## Armazenamento local

O Jornal possui `CURRENT_STORAGE_SCHEMA` e `migrateStorage()`.

Quando uma alteração futura exigir mudar o formato dos dados em `localStorage`:

1. aumentar `CURRENT_STORAGE_SCHEMA`;
2. adicionar a migração correspondente no `switch` de `migrateStorage()`;
3. preservar os dados antigos sempre que possível;
4. nunca resolver incompatibilidades apagando silenciosamente o progresso.

O esquema atual é a versão 2. As marcações e posições de retomada do painel de portes ficam em chaves próprias, com migração única do histórico antigo. Não misturar novos assistidos de portes com os do Jornal principal.

## Fluxo de publicação

1. Push relevante em `main` ou `workflow_dispatch`.
2. Compilação sintática do Python.
3. `node --check` em todos os arquivos `assets/*.js`.
4. Testes Node de reprodução/filas e cache do service worker.
5. Validação estrutural dos fontes.
6. Preparação opcional do Argos Translate.
7. Execução de `jornal.py`.
8. Validação do HTML final.
9. Smoke test real no Chromium em eventos de `push` (não em `workflow_dispatch`).
10. Cópia dos assets para `_site`.
11. Publicação no GitHub Pages.

O cron externo de 30 minutos continua usando `workflow_dispatch`. Alterações relevantes em código também publicam automaticamente por `push`. Execuções antigas são canceladas quando uma versão mais nova entra na mesma fila, evitando gastar tempo publicando código já ultrapassado.

## Cache

Cada CSS e cada módulo JavaScript recebe um hash SHA-256 de 12 caracteres na URL. O service worker prefere a rede, armazena apenas recursos do próprio escopo do projeto e mantém no máximo duas versões de cada CSS/JS, eliminando as variantes anteriores. URLs com consultas arbitrárias e checagens de revisão não entram no cache. A atualização do service worker para `jornal-shell-v2` descarta o cache da versão anterior sem tocar no `localStorage`.

## Desempenho da interface e verificação de atualizações

- Os metadados dos vídeos ativos são indexados em `JOURNAL_VIDEO_BY_ID` e `PORTS_VIDEO_BY_ID` no `assets/core.js`; consultas de card, retomada e ações usam esses índices, mantendo o Jornal como fonte prioritária nos IDs compartilhados.
- `jornal.py` gera `revision.json` com o **mesmo** valor da meta `journal-version` do HTML. Esse arquivo é publicado no mesmo artefato do site e não é versionado no Git.
- `checkJournalUpdate()` solicita somente `revision.json?revision_check=...` a cada 15 minutos enquanto a aba está visível, com `cache: no-store`. Ao voltar à aba, consulta novamente quando transcorrido pelo menos um minuto desde a última verificação. Não voltar a baixar o HTML completo para esta comparação.
- O transporte evita reescrever controles a cada 500 ms quando a aba está oculta ou o player ainda não inicializou.
- `tests/validate_site.py` exige que JSON e HTML representem a mesma edição, e `tests/browser_smoke.cjs` testa a leitura do JSON em Chromium.
- Alterações devem preservar os testes de fila, históricos independentes, retomada, toque longo e PWA.


## Onde alterar

- Aparência e responsividade: `assets/style.css`.
- Toques longos e gestos da lista: `assets/gestures.js`.
- Player, fullscreen, próximo e anterior: `assets/player.js`.
- Busca, fila, cards visuais, mini-player e retomada: `assets/view.js`.
- Estado, vistos, HearthPwn e migração do armazenamento: `assets/core.js`.
- Recursos avançados, backup e estado por vídeo: `assets/features.js`.
- Filtros de personalização, favoritos, silenciamento e paginação de portes: `assets/enhancements.js`.
- Animações e microinterações: `assets/motion.js`.
- Inicialização e carregamento da API do YouTube: `assets/bootstrap.js`.
- Estrutura fixa do HTML: `templates/index.html`.
- Conteúdo dinâmico dos cards e coleta: `jornal.py`.
- Canais do Jornal: `channels.json`.
- Canais de portes: `ports_channels.json`.
- Cache e PWA: `service-worker.js` e `manifest.webmanifest`.

## Validação local

```bash
python -m py_compile jornal.py tests/validate_site.py
for file in assets/*.js; do node --check "$file"; done
node tests/runtime_playback.cjs
node tests/service_worker_cache.cjs
python tests/validate_site.py --source-only
```

Depois de gerar o Jornal com uma chave válida:

```bash
python jornal.py
python tests/validate_site.py
```

## Regra para alterações futuras

Antes de publicar:

1. alterar apenas o módulo responsável;
2. preservar IDs e contratos entre HTML e JavaScript;
3. se o formato de dados mudar, criar uma migração;
4. deixar os validadores rodarem;
5. não contornar uma falha do validador só para publicar.


## Recursos avançados da interface

O pacote avançado mantém as seguintes regras:

- cada vídeo pode ter seu próprio ponto de retomada;
- "Ver depois" apenas muda a ordem da edição atual;
- a fila manual usa `sessionStorage` e não altera a ordem original;
- "Terminar depois" persiste metadados em `localStorage` para sobreviver à janela de 24 h;
- "Pular canal hoje" oculta somente vídeos normais confirmados na edição; Shorts (inclusive em canais mistos) e vídeos com formato indeterminado permanecem visíveis;
- o campo `isShort` (true/false/null) é gerado em `jornal.py` e usado pelo filtro em `features.js`;
- backup/restauração exporta apenas chaves do próprio Jornal;
- cards entram com `IntersectionObserver`, somente ao chegar à viewport;
- animações contínuas devem priorizar `transform` e `opacity`;
- o mini-player permanece sem animações de entrada, saída, resize ou morph;
- o contrato de z-index do mini-player deve ser preservado.


## Protocolo de segurança dos cards

Todo elemento `button` dentro de `.card` exige pressão contínua de pelo menos 2 segundos para executar sua ação. Isso inclui abrir o vídeo, marcar como visto/não visto, fila manual, Ver depois, Terminar depois e Pular canal por hoje.

O bloqueio é feito em fase de captura de `click`, portanto novos botões adicionados futuramente dentro de um card também ficam protegidos automaticamente. Movimento acima da tolerância cancela a ação para preservar a rolagem no celular. Teclado também exige manter Espaço ou Enter pelo mesmo período.


## Regra permanente para animações

Toda animação nova do Jornal deve ser implementada com meta de fluidez de 60 FPS. Sempre que possível, movimento contínuo deve usar apenas `transform` e `opacity`, preferencialmente via compositor/WAAPI, evitando animar `width`, `height`, `top`, `left`, `filter`, `backdrop-filter` ou `box-shadow`. Reflows forçados durante animações também devem ser evitados.

Ao concluir com sucesso qualquer pressão de 2 segundos em um botão de card, o Jornal mostra um ✓ animado no canto superior esquerdo. Esse feedback reutiliza um único elemento e anima somente `transform` e `opacity`.

## Avanço de 30 segundos em tela cheia

- `fullscreen-seek-forward` aparece somente na tela cheia própria de `#playerwrap`: em **retrato (vertical)**, fica à esquerda do botão de concluir/avançar vídeo; em **paisagem (horizontal)**, fica imediatamente acima dele, com a mesma margem direita.
- Pressão contínua por **2 segundos** avança 30 segundos com `seekBy(30)`; soltar antes, arrastar ou sair da tela cheia cancela o gesto. Teclado (Espaço/Enter) também exige pressão contínua.
- O botão não marca o vídeo como assistido diretamente. O botão existente `fullscreen-next` continua exigindo **3 segundos** e mantém sua ação original de concluir e ir para o próximo.
- A contagem regressiva gigante central (`fullscreen-hold-countdown`) é compartilhada: **3 → 2 → 1** ao concluir/avançar vídeo e **2 → 1** ao avançar 30 segundos. Soltar antes do prazo ou sair da tela cheia esconde a contagem. Os dois botões não conseguem ocupar essa contagem ao mesmo tempo.
- Ambos usam ícones SVG integrados ao HTML e a mesma base visual de controles do `assets/style.css`, com borda discreta, acabamento translúcido e barra de progresso por `transform: scaleX` (variável `--hold-scale`). O botão de concluir troca temporariamente o SVG por um ✓ após a confirmação, sem destruir/recriar o conteúdo HTML. Em paisagem e retrato, tamanho, distância e margens dos dois botões são definidos por variáveis CSS, incluindo ajuste para telas estreitas. O mini-player não é alterado.



## Painel exclusivo de portes, descompilações e recompilações

- `ports_channels.json` contém os canais sixwp, RetroJão, Emuladores Brasil, Senhor Linguica, bummy e Teaser Games; novos canais podem ser adicionados nesse JSON.
- O `jornal.py` reutiliza a consulta de uploads e de detalhes pela API oficial do YouTube. A seção tem janela independente de **7 dias** e mostra **todos os vídeos válidos encontrados**, em ordem cronológica, sem teto compartilhado de 24 que excluía canais menos frequentes. Os vídeos de um canal não eliminam os de outro; lives continuam excluídas.
- Consultas a essa seção são opcionais: falha em um ou mais canais não derruba a edição principal, e aparece um aviso na seção.
- Visualmente a seção herda a linguagem do HearthPwn, tem listagem de vídeos com miniaturas, estado de visto e recolhimento persistido em `jornal_do_futebol_ports_collapsed_v1`.
- A lista de portes **não possui rolagem interna nem altura máxima**: `ports-video-list` permanece em fluxo natural (`overflow: visible`), de modo que arrastar sobre qualquer vídeo movimenta a página inteira. Não reintroduzir `overflow-y: auto` ou `overscroll-behavior: contain` nessa lista.
- Os cartões utilizam miniaturas dimensionadas com CSS Grid, títulos e metadados legíveis, estados atuais/assistidos, chips de canais e ajuste responsivo para telas pequenas.
- O bloco `ports-data` contém `PORTS_VIDEOS`, independente da lista principal `VIDEOS`. O botão de reproduzir usa `openPortsVideo` e a fila específica da seção no player existente; **Começar jornal** volta à fila principal.
- Vídeos do painel não alteram duração, progresso e total da lista principal. Assistidos de portes usam `jornal_do_futebol_ports_watched_v1`, com retomada e posições próprias; o histórico principal utiliza `jornal_do_futebol_watched_v1`. Não há sincronização automática entre dispositivos. A configuração das fontes fica em `ports_channels.json`.

- O canal bummy está fixado por ID de canal imutável, além do handle, para evitar ambiguidades de identificação. Na seção de portes, cada canal também consulta o feed Atom oficial do YouTube como fonte complementar sem gasto de cota da Data API; apenas IDs cuja autoria seja validada pela API entram no painel. As mensagens `RECUPERADOS VIA ATOM` mostram vídeos omitidos pela playlist.
- A coleta produz linhas `RESUMO CANAL @handle: uploads=N, incluídos=M` para **todos os canais** com consulta de uploads bem-sucedida; ausência de publicação e exclusão por filtros ficam diagnosticáveis. O cabeçalho exibe o total de vídeos de cada fonte nos chips. Uma alteração em `ports_channels.json` também dispara o workflow no `push`.


## Auditoria de integridade e regressão — 28/10/2026

- **Retomada entre painéis:** `setPortsPlaybackMode` guarda em `sessionStorage` a fila de portes; ao atualizar a página, ela só é recuperada quando o ponto salvo ainda pertence ao painel e está pendente. `openVideo(id, source)` distingue explicitamente a origem: mesmo se um ID existir nas duas listas, o player usa a fila correta. O botão **Começar jornal** sempre volta à lista principal.
- **Navegação:** a fila de próximos/anteriores usa o catálogo da seção selecionada, e as ações da seção de portes não disparam efeitos de conclusão do Jornal de futebol.
- **Controles de tela cheia:** ambos continuam exigindo toque longo (3 s para concluir, 2 s para avançar 30 s). Toques extras não reiniciam a pressão; a tecla Espaço/Enter também aciona o botão de concluir e soltar ou perder foco cancela a operação.
- **Backup seguro:** validação de estrutura/tamanho antes da escrita, cópia do estado existente e tentativa de reversão integral se o navegador recusar a restauração. Não se altera o esquema local de versão 2.
- **Coleta defensiva:** IDs de vídeo são validados antes de chegar aos handlers HTML, datas inválidas são ignoradas, vídeos repetidos na mesma playlist são deduplicados e a paginação circular é detectada.
- **Sobreposição legítima:** um mesmo upload pode estar nas listas de futebol e portes, com filas e status de visto independentes por painel. A validação verifica duplicatas **dentro** de cada lista, não proíbe IDs presentes em ambas.
- **Testes automatizados:** o CI executa validação Python de fonte e HTML gerado, verificação de sintaxe de todos os módulos JS e `tests/runtime_playback.cjs` (filas, vídeo compartilhado, retomada e gestos), além de simulações locais de respostas inesperadas da API.


## Filtros, reprodução e animações do painel de portes

- Chips interativos **Todos / por canal** com `aria-pressed` e contagens por canal; pesquisa de títulos, toggle **Só não assistidos**, ordenação **Mais recentes / Mais antigos**, atalho **Assistir seleção** (prioriza o primeiro reproduzível ainda não visto) e botão para limpar filtros.
- Preferências de canal, ordem e ocultação de assistidos salvas em `jornal_do_futebol_ports_preferences_v1`. Pesquisa é temporária e filtros de canais retirados da configuração não são restaurados.
- `filteredPortsVideos()` alimenta tanto os cartões visíveis quanto a fila de portes. A fila do futebol nunca é filtrada por essa seleção. Se o vídeo atual ficar oculto, avançar leva ao primeiro vídeo correspondente. Abrir um vídeo salvo pode limpar os filtros que o ocultavam.
- A barra de progresso usa **todos** os vídeos do painel, independentemente da filtragem, por `transform: scaleX`. Entrada de novos itens e recolhimento usam exclusivamente `transform` e `opacity`, com limite de oito animações simultâneas e respeito a movimento reduzido.
- **Não reintroduzir rolagem interna:** permanece `overflow: visible`, `touch-action: pan-y` e altura natural da lista, incluindo no celular.


## Auditoria completa das seis fontes de portes

- Cada canal do painel tem seu **channelId** oficial e imutável (`UC...`) declarado em `ports_channels.json`; o identificador `@handle` permanece como rótulo e chave de filtro, não como única fonte de identidade. Novas entradas devem seguir o mesmo padrão.
- `resolve_channel` usa `channels.list(id=...)` para recuperar dados do canal correto; o processo informa no log a correspondência entre nome, handle, título do YouTube e ID auditado.
- **Toda** fonte é comparada com o Atom oficial a cada ciclo, mesmo quando a playlist tem vídeos; cada candidato de ambas as origens deve passar pela verificação de `snippet.channelId` da API. É registrado `AUDITORIA ATOM @handle` com contagem por fonte, recuperados e total; `RESUMO CANAL` informa quais vídeos sobreviveram aos filtros.
- No painel opcional, falha da playlist **não elimina o canal** quando o Atom funciona: nesse caso o painel continua com recuperação parcial e registra aviso explícito de que a playlist ficou indisponível. Falha simultânea das duas fontes sinaliza o canal indisponível, preservando os demais e sem derrubar o Jornal do Futebol.
- Os testes geram falha se algum dos seis canais não tiver ID permanente válido e único, e simulam queda da playlist para os seis canais simultaneamente. A coleta de futebol (modo estrito) permanece sem mudanças de tolerância a falhas.

## Auditoria de estabilidade — 28/10/2026

- O denominador do progresso de vídeos acompanha os vídeos elegíveis após pular canais temporariamente, como já acontece no numerador e na estimativa de tempo.
- A localização do ponto salvo de um vídeo temporariamente oculto pelos filtros limpa os filtros do painel de portes antes de rolar a página. Para o Jornal, limpa busca e a opção de não assistidos; canais pulados explicitamente precisam ser restaurados pelo usuário.
- Abrir manualmente um vídeo **já visto** no Jornal permite revisitá-lo sem incluir todos os vistos na fila de reprodução automática.
- Uma classificação de Short já confirmada é reutilizada na mesma geração para vídeos duplicados entre feeds; respostas inválidas ou consultas com erro não são armazenadas como verdade.
- A rolagem de retomada respeita a preferência do sistema por movimento reduzido.

## Proteções de atualização contínua

- A instalação opcional do Argos Translate tem limite de **7 minutos** e tentativas curtas de download: se indisponível, o site continua gerando e publicando as notícias, que podem aparecer sem tradução nova.
- Os testes impedem reversão acidental da regra **somente Shorts** para o canal @CortesdoFlowSportClub.
- O HTML gerado é testado para confirmar que **todos** os vídeos do painel de portes estão marcados com `countForTime = false`; tempo e progresso principais continuam derivados de `VIDEOS`.
