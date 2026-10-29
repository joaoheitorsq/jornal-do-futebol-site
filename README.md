# Jornal do Futebol

Jornal pessoal gerado automaticamente e publicado no GitHub Pages.

A estrutura do projeto, o mapa de arquivos e o procedimento seguro para alterações estão em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).


## Recursos avançados

O Jornal mantém a sequência principal de vídeos do mais antigo ao mais recente, mostra Shorts no player padrão e coleta portes em um painel independente. As seguintes ferramentas são opcionais:

- Marcadores NOVO desde a última visita, aviso de edição recente e restauração da posição de scroll
- Filtros de Shorts/normais e duração, sessões rápidas de 15/30/60 minutos
- Favoritos com fila prioritária opcional, silenciamento por 2 h/24 h/7 dias
- Velocidade de vídeo de 1× a 2×, resumo da fila e progresso por canal
- Painel de portes com relevância temática, carregamento progressivo e contagem independente de assistidos
- Diagnóstico por fonte e aviso de backup; PWA instalável para tela inicial
- IDs permanentes para todos os canais, cache de metadados, testes de regressão no Chromium

**Privacidade:** os históricos e preferências ficam em `localStorage` do próprio navegador. A aplicação não tem backend de usuários. Use o botão **Exportar backup** regularmente.

Para detalhes de segurança e limitações conhecidas, consulte `docs/SECURITY_AUDIT.md`.
