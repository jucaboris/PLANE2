export const GAME_CONFIG = {
  version: "3.0.0",
  roundDurationSec: 120,
  maxRounds: 1,

  roles: {
    pilot: { label: "Comando", image: "terminal-pilot.png", responsibility: "command" },
    engineer: { label: "Negociador", image: "terminal-engineer.png", responsibility: "negotiator" },
    cabin: { label: "Cabine", image: "terminal-cabin.png", responsibility: "cabin" },
    copilot: { label: "Esquadrão Antibomba", image: "terminal-copilot.png", responsibility: "bomb" },
  },

  responsibilities: {
    command: {
      label: "Comando",
      actions: {
        rearArrest: { label: "Prisão pela retaguarda" },
        taser: { label: "Atingir com taser" },
      },
      correctAction: "rearArrest",
      failReason: "O terrorista apertou involuntariamente o detonador após o taser.",
    },
    negotiator: {
      label: "Negociador",
      actions: {
        technicalNegotiation: { label: "Negociação técnica" },
        emotionalNegotiation: { label: "Negociação emocional" },
      },
      correctAction: "emotionalNegotiation",
      failReason: "O terrorista ignorou a negociação técnica; o vínculo emocional era a chave.",
    },
    cabin: {
      label: "Cabine",
      actions: {
        hide: { label: "Esconder passageiros" },
        calmPassengers: { label: "Manter passageiros calmos" },
      },
      correctAction: "calmPassengers",
      failReason: "Movimentação brusca alertou o terrorista.",
    },
    bomb: {
      label: "Esquadrão Antibomba",
      actions: {
        cutBlackWire: { label: "Cortar fio preto" },
        cutRedWire: { label: "Cortar fio vermelho" },
      },
      correctAction: "cutRedWire",
      failReason: "Fio preto detonou o explosivo deste dispositivo.",
    },
  },
};
