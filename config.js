export const GAME_CONFIG = {
  version: "1.0.0",
  roundsMax: 10,

  timing: {
    roundSeconds: 45,
    phases: { STATUS: 5, DELIB: 25, INPUT: 12, RESOLVE: 3 },
    postStorm: { inputSeconds: 8 },
  },

  resources: {
    initial: { fuel: 18, engine: 10, health: 10, dist: 0 },
    tick: {
      normal: { fuel: 1, engine: 1, health: 1 },
      storm:  { fuel: 2, engine: 2, health: 1 },
    },
  },

  storm: {
    startsAtRound: 6,
    postStormMaxInputs: 2,
  },

  airports: {
    A: { dist: 8, landing: { type: "engine", min: 3 } },
    B: { dist: 14, landing: { type: "fuel", min: 4 } },
  },

  emergency: {
    deadlineRound: 5,
    airportABonus: { engineMinMinus: 1 },
  },

  routeChange: {
    fuelCost: 2,
    countsAs: "action",
    g2ConflictIfMultipleInSameRound: true,
  },

  actions: {
    pilot: {
      normal: { advance: 1, fuelExtra: 0 },
      fast:   { advance: 2, fuelExtra: 1 },
    },
    engineer: {
      repair:  { engineDelta: 2, fuelExtra: 1, engineTickReduce: 0 },
      protect: { engineDelta: 0, fuelExtra: 1, engineTickReduce: 1 },
    },
    cabin: {
      stabilize: { healthDelta: 2 },
      none:      { healthDelta: 0 },
    },
    copilot: {
      declareEmergency: {},
      none: {},
    },
  },

  modes: {
    G1: {
      pilotOnlyTyping: true,
      combinedPin: { format: "PPPP-RRRR", acceptNoDash: true },
      maxAuthorizedRolesPerRound: 2,
      emergencyOverhead: { fuelPenalty: 1, consumesAuthorizationSlot: true },
      routeChangeOverhead: { consumesFullRoundAction: true },
    },

    G2: {
      seatRotation: true,
      conflictRules: {
        detect: {
          multipleInputsSameRole: true,
          multipleRouteChangesSameRound: true,
        },
        penalties: [
          { conflicts: 1, fuel: 1, engine: 0, annulRoundActions: false },
          { conflicts: 2, fuel: 2, engine: 1, annulRoundActions: false },
          { conflicts: 3, fuel: 0, engine: 0, annulRoundActions: true },
        ],
      },
    },

    G3: {
      seatRotation: true,
      strictDomain: true,
      postStormMaxInputs: 2,
    },
  },
};
