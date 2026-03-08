export const GAME_CONFIG = {
  version: "3.0.0",
  roundDurationSec: 120,
  maxRounds: 3,

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
        rearArrest: {
          label: "Prisão pela retaguarda",
          successEffect: { panicControl: +12, cabinIntegrity: +8 },
          failEffect: { panicControl: -40, cabinIntegrity: -30 },
        },
        taser: {
          label: "Atingir com taser",
          successEffect: { panicControl: -10, cabinIntegrity: -20 },
          failEffect: { panicControl: -60, cabinIntegrity: -70 },
        },
      },
      correctAction: "rearArrest",
      failReason: "O terrorista apertou involuntariamente o detonador após o taser.",
    },
    negotiator: {
      label: "Negociador",
      actions: {
        technicalNegotiation: {
          label: "Negociação técnica",
          successEffect: { panicControl: +4, cabinIntegrity: +2 },
          failEffect: { panicControl: -20, cabinIntegrity: -15 },
        },
        emotionalNegotiation: {
          label: "Negociação emocional",
          successEffect: { panicControl: +14, cabinIntegrity: +6 },
          failEffect: { panicControl: -20, cabinIntegrity: -15 },
        },
      },
      correctAction: "emotionalNegotiation",
      failReason: "O terrorista ignorou a negociação técnica; o vínculo emocional era a chave.",
    },
    cabin: {
      label: "Cabine",
      actions: {
        hide: {
          label: "Esconder passageiros",
          successEffect: { panicControl: -8, cabinIntegrity: -10 },
          failEffect: { panicControl: -25, cabinIntegrity: -25 },
        },
        calmPassengers: {
          label: "Manter passageiros calmos",
          successEffect: { panicControl: +12, cabinIntegrity: +5 },
          failEffect: { panicControl: -25, cabinIntegrity: -25 },
        },
      },
      correctAction: "calmPassengers",
      failReason: "Movimentação brusca alertou o terrorista.",
    },
    bomb: {
      label: "Esquadrão Antibomba",
      actions: {
        cutBlackWire: {
          label: "Cortar fio preto",
          successEffect: { panicControl: -80, cabinIntegrity: -100 },
          failEffect: { panicControl: -80, cabinIntegrity: -100 },
        },
        cutRedWire: {
          label: "Cortar fio vermelho",
          successEffect: { panicControl: +18, cabinIntegrity: +20 },
          failEffect: { panicControl: -80, cabinIntegrity: -100 },
        },
      },
      correctAction: "cutRedWire",
      failReason: "Fio preto detonou o explosivo deste dispositivo.",
    },
  },

  resources: {
    initial: { panicControl: 60, tempo: 100, cabinIntegrity: 65 },
    min: 0,
    max: 100,
    passiveDrainPerSecond: { panicControl: 0.1, cabinIntegrity: 0.08 },
  },

  g2: {
    conflictPenalty: { panicControl: -6, cabinIntegrity: -6 },
  },
};
