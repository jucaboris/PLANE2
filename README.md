# Sky Authority (Firebase Multiplayer)

Simulador educacional estático (HTML/CSS/JS + Firebase Realtime Database) para dinâmica presencial com **Mestre** no telão e **Clientes** no celular.

## Modos de acesso
- Mestre: `index.html?master=true`
- Cliente: `index.html?role=pilot|engineer|cabin|copilot`

## Nova dinâmica (v2)
- 3 simulações curtas (uma por modo): **G1**, **G2** e **G3**.
- Cada simulação dura **180 segundos**.
- Não há PIN/senha.

## Papéis
- `pilot`: **Comando**
- `engineer`: **Negociador**
- `cabin`: **Cabine**
- `copilot`: **Esquadrão Antibomba**

## Barras
- Controle de Pânico
- Tempo
- Integridade da Cabine

## Regras por modo
- **G1:** primeiro jogador que executar uma ação vira o único autorizado a executar no restante da simulação.
- **G2:** todos podem decidir tudo; ações repetidas e conflitantes geram punições.
- **G3:** cada papel executa apenas seu domínio.

## Arquivos principais
- `index.html` — interface principal
- `config.js` — parâmetros, ações e efeitos
- `engine.js` — regras de simulação e validação de inputs
- `db.js` — conexão Firebase CDN
- `ui.js` — sincronização tempo real Mestre/Clientes
