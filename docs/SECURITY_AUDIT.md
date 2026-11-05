# Auditoria técnica e de segurança — 04/11/2026 (America/Fortaleza)

## Escopo e método — duas passagens

Revisão de `jornal.py`, listas de canais, geração HTML/JSON, oito módulos
JavaScript, template/CSS, backup/importação, cache PWA, workflow GitHub
Actions e testes. Primeira passagem: detecção de falhas e redução das
superfícies de ataque. Segunda passagem: verificações de regressão, leitura
das correções e confirmação de geração e publicação no GitHub Actions.

Esta auditoria é de **melhor esforço**, não uma certificação de ausência de
vulnerabilidades. Nenhum teste local reproduz todas as respostas possíveis
do YouTube nem a UI de mídia incorporada em todos os celulares.

### Correções implementadas

1. **Links externos:** HearthPwn RSS/homepage validam *após a resolução*
   o esquema HTTPS, host exato e porta. Bloqueiam `javascript:`, `data:`,
   domínio falso, userinfo, caracteres de controle e redirecionamentos
   explícitos a outros domínios. O renderer descarta também URLs inválidas.
2. **Injeção HTML e JSON:** preservados `html.escape` dos campos externos
   e `js_json` que escapa `<`, `>` e `&`. Um teste adversarial novo cobre
   fechamento de `</script>`, payloads HTML e links não confiáveis.
3. **HTTP externo:** leituras passam a ter limites de 16 MiB (JSON/API)
   e 8 MiB (HTML/feeds). Mensagens HTTP não despejam mais corpos externos
   potencialmente contendo dados sensíveis nos logs.
4. **Segredo de API:** `YOUTUBE_API_KEY` é removido do ambiente do
   processo depois de coletar futebol e portes, antes de carregar o
   tradutor de terceiros.
5. **GitHub Actions:** o job de geração possui apenas `contents: read`.
   Só o job de deploy recebe `pages: write`, `id-token: write` e
   `actions: read` para selecionar artefatos. As sete ações próprias
   do GitHub foram fixadas por SHA completo, evitando alterações
   inesperadas de tags mutáveis.
6. **Publicação:** preservado identificador de artefato por execução e
   tentativa, com seleção do mais recente para prevenir duplicidade em
   `Re-run all jobs`.
7. **PWA offline:** versão `jornal-shell-v3`. Falhas no precache abortam
   a nova instalação sem ativá-la ou destruir o último worker funcional.
   Teste de instalação offline e de atualização normal incluído.
8. **Backups:** antes de remover qualquer chave local, o importador
   rejeita JSON inválido, arrays em mapas, estrutura incompatível,
   retomadas com IDs ilegais e arquivos sem chaves reconhecidas.
   A rotina de rollback existente é mantida em caso de falha de escrita.
9. **Armazenamento:** getters rejeitam segundos não finitos e coleções
   incompatíveis. A fila manual aceita apenas IDs oficiais de vídeo,
   com limite de entradas; objetos corrompidos voltam a estados seguros.
10. **Colisão de propriedades:** leitura de históricos, `finishLater`,
    retomadas e snapshots exige propriedades próprias via `Object.hasOwn`.
    Testes incluem `constructor`, um valor de 11 caracteres que pode
    existir como ID e era tratado erroneamente como registro herdado.
11. **CSP inicial:** política por meta bloqueia `object-src`, `base-uri`
    e postagens de formulário para destinos externos, sem interferir nos
    handlers inline existentes. Adicionada política de referrer.
12. **Testes:** `tests/security_regression.py` + regressões Node,
    validações estáticas e smoke test Chromium no caminho de push.

### Riscos residuais e ações manuais relevantes

- **Branch `main` não protegida:** constatado via metadados da API do
  GitHub em 04/11/2026. Ativar **Settings → Rules → Rulesets** ou
  proteção da branch; exigir revisão/checks antes de alterações. A
  conexão atual não permite modificar essas regras administrativas.
- **Segredo do YouTube:** em Google Cloud, restringir a chave usada no
  Actions à YouTube Data API v3 e ajustar cotas. Não inserir chave no
  código, README, capturas de tela ou URLs públicas.
- **CSP estrita:** o projeto ainda usa handlers HTML inline. Uma CSP sem
  `unsafe-inline` exigiria refatoração de todos os handlers e testes
  abrangentes. A meta CSP atual é defesa parcial, não uma política
  contra todo XSS.
- **Dependências externas:** as actions foram fixadas por commit e a
  versão direta do Argos é fixada, mas a cadeia transitiva de pacotes
  continua sujeita a vulnerabilidades futuras e exige atualização
  controlada.
- **Serviços externos:** quedas da API/Atom, quota do YouTube, bloqueios
  de incorporação e a identidade visual interna do Shorts não são
  controláveis pelo site. Os testes Chromium bloqueiam mídia externa.
- **Histórico local:** marcações e retomadas residem no dispositivo.
  Limpar dados do navegador ou desinstalar PWA pode destruí-los; fazer
  backup periódico, guardado fora do aparelho.
- **Garantia:** ausência de falhas nos testes não prova ausência de
  falhas em todas as configurações, navegadores ou dados futuros.

---

# Histórico: auditoria de segurança — outubro de 2026

## Superfícies revisadas

- `jornal.py`: autenticação de API via secret no workflow, validação de IDs, filtros de lives/Shorts, escaping de título e atributos HTML, escaping de JSON embutido, separação de fontes e tratamento de exceções
- `channels.json` e `ports_channels.json`: channel IDs imutáveis, handles preservados, sem duplicatas, regra somente Shorts para Cortes do Flow Sport Club
- `assets/`: isolamento entre a lista principal e portes, métricas e retomadas, armazenamento local, desfazer, favoritos, filtros, velocidade, player e gestos
- `tests/`: testes sem rede no Node/Python e teste real no Chromium em viewport móvel e desktop
- `service-worker.js`: respostas externas NÃO são colocadas em cache; apenas GET de recursos estáticos e HTML da mesma origem, com bypass para consultas periódicas de revisão
- GitHub Actions: build testado antes de publicar; instalador opcional Argos Translate com timeout, cache de metadados do YouTube por ID oficial e validação do HTML final

## Invariantes protegidos

1. O tempo e o progresso do Jornal principal são computados somente com `VIDEOS`. Portes usam `PORTS_VIDEOS` e não contam para o tempo.
2. Os assistidos de portes usam a chave `jornal_do_futebol_ports_watched_v1`. Há migração única de marcações antigas; marcações novas NÃO contaminam o futebol.
3. Posições e último ponto de reprodução são armazenados em chaves separadas, com troca de modo preservando o contexto do vídeo anterior.
4. A fila do Jornal preserva seu ordenamento por padrão; filtros e prioridades opcionais só atuam se ativados.
5. O carregamento progressivo do painel não introduz scroll interno; os vídeos não desaparecem do backend, somente da tela até o usuário pedir mais.
6. Os 56 canais do Jornal e seis canais de portes têm IDs fixos validados pelo próprio YouTube; novos canais devem ser verificados antes de adicionados.
7. Funções opcionais nunca devem apagar ou sobrescrever sem autorização os históricos do usuário nem exigir instalação de software no aparelho.

## Limitações externas e verificações humanas

- O feed Atom público do YouTube retornou HTTP 404 para alguns ou todos os canais de portes em uma execução auditada. O pipeline continua usando a playlist de uploads da API oficial. Caso playlist e Atom falhem juntos, essa fonte poderá aparecer incompleta; o diagnóstico exibe essa limitação em vez de afirmar cobertura plena.
- A API do YouTube não disponibiliza flag direta e inequívoca de Shorts em `videos.list`. O detector faz confirmação adicional por duração e formato de incorporação; vídeos incertos não entram em canais configurados **somente Shorts**. Não é correto prometer identificação perfeita em todos os uploads.
- Testes de Chromium bloqueiam requisições de mídia do YouTube para garantir determinismo. A interação real do player em celular e permissões de instalação do PWA ainda requerem validação manual.
- O progresso, preferências e backups residem no navegador; desinstalar o PWA ou limpar o armazenamento local pode apagá-los. Backup exportado permanece necessário.

## Regra de publicação

Toda alteração de código deve passar por verificações de Python, Node, regressões funcionais, validação de HTML gerado e, em push de código, smoke test no Chromium. GitHub Pages deve publicar apenas se os testes concluírem com sucesso.

## Revisão funcional dos controles — 29/10/2026

Foram identificadas e corrigidas regressões reais na interface e no modo de reprodução:

- O botão **Marcar como visto** do painel de portes era gerado sem o argumento `'ports'`. O clique real modificava o histórico do Jornal em vez do histórico independente de portes. O HTML e o teste no Chromium agora validam o handler correto e a separação de tempo e progresso.
- A opção **Limpar filtros** passou a restaurar também o filtro de relevância, inclusive o checkbox e sua persistência local.
- Os controles adicionais de relevância e **Mostrar mais vídeos** agora ficam dentro da área recolhível de portes, não permanecendo na tela com o painel fechado.
- O contador distingue vídeos realmente visíveis na tela dos correspondentes à pesquisa/filtros ainda escondidos por carregamento progressivo.
- O botão **Ir para onde parei** respeita o painel de origem quando um vídeo existe em ambos, e revela automaticamente cartões além do limite progressivo.
- O recurso **Desfazer** a marcação de portes restaura o ponto de retomada que existia antes da ação.
- Solicitações de reprodução antes de o iframe do YouTube ficar pronto são conservadas e executadas quando ele iniciar; o usuário recebe status de preparação, não uma falsa mensagem de lista vazia.
- Os avisos de fim da fila distinguem Jornal e portes, e a opção **Começar jornal** salva previamente a retomada de portes quando troca de modo.
- O estado de progresso por canal é recalculado quando a seção detalhada está aberta, inclusive para marcações feitas no painel de portes.
- Testes reais em Chromium incluem cliques em botões gerados, desfazer, filtros, ordenação, paginação, modo recolhido e seleção antes de o player estar pronto.

**Limitações de cobertura:** os testes não conseguem verificar reprodução real de mídia incorporada pelo YouTube, nem garantir o comportamento de todos os navegadores móveis. O Chromium faz testes de fluxo com o iframe externo bloqueado, enquanto a coleta real segue protegida pelos testes do backend.
