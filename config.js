export const GAME_CONFIG = {
  version: "2.0.0",
  simulationDurationSec: 180,

  resources: {
    initial: {
      panicControl: 70,
      tempo: 100,
      cabinIntegrity: 70,
    },
    min: 0,
    max: 100,
    passiveDrainPerSecond: {
      panicControl: 0.08,
      cabinIntegrity: 0.06,
    },
  },

  roles: {
    pilot: "Comando",
    engineer: "Negociador",
    cabin: "Cabine",
    copilot: "Esquadrão Antibomba",
  },

  actions: {
    pilot: {
      rearArrest: { label: "Prisão pela retaguarda", effects: { panicControl: 8, cabinIntegrity: 2 } },
      taser: { label: "Atingir com taser", effects: { panicControl: 4, cabinIntegrity: -6 } },
    },
    engineer: {
      technicalNegotiation: { label: "Negociação técnica", effects: { panicControl: 6, cabinIntegrity: 1 } },
      emotionalNegotiation: { label: "Negociação emocional", effects: { panicControl: 10, cabinIntegrity: -2 } },
    },
    cabin: {
      hide: { label: "Esconder passageiros", effects: { panicControl: -2, cabinIntegrity: 7 } },
      calmPassengers: { label: "Manter passageiros calmos", effects: { panicControl: 9, cabinIntegrity: 0 } },
    },
    copilot: {
      cutBlackWire: { label: "Cortar fio preto", effects: { panicControl: 5, cabinIntegrity: 5 } },
      cutRedWire: { label: "Cortar fio vermelho", effects: { panicControl: -8, cabinIntegrity: -12 } },
    },
  },

  g2: {
    repeatPenalty: { panicControl: -4, cabinIntegrity: -4 },
    conflictPenalty: { panicControl: -6, cabinIntegrity: -6 },
    conflictPairs: [
      ["rearArrest", "taser"],
      ["technicalNegotiation", "emotionalNegotiation"],
      ["hide", "calmPassengers"],
      ["cutBlackWire", "cutRedWire"],
    ],
  },
};
