# Sky Authority v3

Dinâmica multiplayer em tempo real (Firebase RTDB) com **Mestre** no telão e **múltiplos celulares por perfil**.

## URLs
- Mestre: `index.html?master=true`
- Comando: `index.html?role=pilot`
- Negociador: `index.html?role=engineer`
- Cabine: `index.html?role=cabin`
- Esquadrão Antibomba: `index.html?role=copilot`

## Regras implementadas
- Rodadas de **2 minutos**.
- Votação ao vivo por responsabilidade: Comando, Negociador, Cabine, Esquadrão Antibomba.
- Mestre vê percentual/votos em tempo real por ação e executa responsabilidade por responsabilidade.
- Falha imediata se Mestre executar ação incorreta em qualquer responsabilidade.
- G1: apenas Comando vota/executa por todas as responsabilidades (demais bloqueados com popup).
- G2: todos votam em todas as responsabilidades (punição por conflito quando há voto em ações opostas da mesma responsabilidade).
- G3: cada perfil vota apenas na própria responsabilidade.
- Ao fim do tempo de votação, clientes recebem popup "ações em progresso" até o Mestre concluir.

## Decisões corretas
- Comando: **Prisão pela retaguarda**.
- Negociador: **Negociação emocional**.
- Cabine: **Manter passageiros calmos**.
- Esquadrão Antibomba: **Cortar fio vermelho**.
