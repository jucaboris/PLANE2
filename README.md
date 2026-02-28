# Decision Rights Simulator (GitHub Pages)

Jogo estático (HTML/CSS/JS) para simular **arquiteturas de direitos de decisão** (MBM/PBM) usando um modelo híbrido:

- **Tela = Central de Comando** (inputs, timer, log, métricas)
- **Cards impressos = conhecimento exclusivo + PINs por rodada**

## Rodar local
Abra `index.html` no navegador (recomendado usar Live Server no VSCode para ESModules).

## Publicar no GitHub Pages
- Coloque os arquivos na raiz do repositório
- Settings → Pages → Deploy from branch → main → /(root)

## Modos
- **G1**: apenas piloto digita e usa **PIN combinado** `PPPP-RRRR` (piloto + responsável). Limite 2 autorizações por rodada.
- **G2**: qualquer papel digita seu PIN; conflito é detectado e penaliza.
- **G3**: cada papel só decide no seu domínio; sem penalidade estrutural.

## Tempestade (para 10 rodadas)
Config padrão inicia na **rodada 6** e limita inputs para 2.

## Arquivos
- `index.html` — UI (central)
- `config.js` — parâmetros do jogo
- `pins.js` — tabela de PINs
- `engine.js` — regras do jogo / validação / resolução
- `ui.js` — fase/timer, handlers e render  
