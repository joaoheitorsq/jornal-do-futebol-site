# Auditoria de segurança e regressões — outubro de 2026

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
