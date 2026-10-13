# Módulos JavaScript

Ordem obrigatória de carregamento:

1. `core.js`
2. `gestures.js`
3. `view.js`
4. `player.js`
5. `motion.js`
6. `features.js`
7. `bootstrap.js`

Use o módulo correspondente ao tipo de mudança. Não volte a concentrar toda a lógica em um único `app.js`.

O estado compartilhado é inicializado em `bootstrap.js`, depois que os módulos de funções já foram carregados.


- `motion.js`: animações leves, IntersectionObserver e microinterações.
- `features.js`: fila manual, ver depois, terminar depois, backup, undo, progresso por vídeo, sessão e controles avançados.
- O mini-player não deve receber animações de entrada, saída, resize ou morph.
