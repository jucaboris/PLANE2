import { GAME_CONFIG as CFG } from "./config.js";

const ROLES = ["pilot", "engineer", "cabin", "copilot"];

function now() {
  return Date.now();
}

function clamp(value) {
  return Math.max(CFG.resources.min, Math.min(CFG.resources.max, value));
}

function logLine(state, text, kind = "info") {
  state.log.push({ ts: now(), kind, text });
}

function allActions() {
  const out = {};
  for (const role of ROLES) {
    for (const [actionId, def] of Object.entries(CFG.actions[role] || {})) {
      out[actionId] = { ...def, role };
    }
  }
  return out;
}

const ACTION_INDEX = allActions();

export function makeInitialState() {
  return {
    mode: "G1",
    phase: "IDLE",
    gameOver: false,
    resources: { ...CFG.resources.initial },
    simulation: {
      durationSec: CFG.simulationDurationSec,
      timeLeft: CFG.simulationDurationSec,
      g1CommanderRole: null,
    },
    stats: {
      actionsByRole: { pilot: 0, engineer: 0, cabin: 0, copilot: 0 },
      actionsById: {},
      conflicts: 0,
    },
    log: [],
  };
}

export function resetSimulation(state, mode = state.mode) {
  const fresh = makeInitialState();
  state.mode = mode;
  state.phase = "READY";
  state.gameOver = false;
  state.resources = { ...fresh.resources };
  state.simulation = { ...fresh.simulation };
  state.stats = { ...fresh.stats, actionsByRole: { ...fresh.stats.actionsByRole }, actionsById: {} };
  state.log = [];
  logLine(state, `Simulação ${mode} preparada.`, "warn");
}

export function startSimulation(state) {
  if (state.phase === "RUNNING") return;
  state.phase = "RUNNING";
  state.gameOver = false;
  logLine(state, `Simulação ${state.mode} iniciada.`, "ok");
}

function applyEffects(state, effects) {
  if (effects.panicControl) state.resources.panicControl = clamp(state.resources.panicControl + effects.panicControl);
  if (effects.cabinIntegrity) state.resources.cabinIntegrity = clamp(state.resources.cabinIntegrity + effects.cabinIntegrity);
}

function actionAllowedInMode(state, playerRole, actingRole, actionId) {
  if (!ROLES.includes(playerRole) || !ROLES.includes(actingRole)) return false;
  if (!ACTION_INDEX[actionId]) return false;

  if (state.mode === "G1") {
    if (!state.simulation.g1CommanderRole) return true;
    return playerRole === state.simulation.g1CommanderRole;
  }

  if (state.mode === "G2") {
    return true;
  }

  return playerRole === actingRole && ACTION_INDEX[actionId].role === actingRole;
}

function applyG2Penalties(state, actionId) {
  const count = (state.stats.actionsById[actionId] || 0) + 1;
  if (count > 1) {
    applyEffects(state, CFG.g2.repeatPenalty);
    logLine(state, "⚠️ Punição por repetição de ação no G2.", "bad");
    state.stats.conflicts += 1;
  }

  for (const [a, b] of CFG.g2.conflictPairs) {
    const hasA = (state.stats.actionsById[a] || 0) > 0 || a === actionId;
    const hasB = (state.stats.actionsById[b] || 0) > 0 || b === actionId;
    if (hasA && hasB) {
      applyEffects(state, CFG.g2.conflictPenalty);
      logLine(state, `⚠️ Conflito detectado (${a} x ${b}) no G2.`, "bad");
      state.stats.conflicts += 1;
      break;
    }
  }
}

export function submitInput(state, payload) {
  if (state.phase !== "RUNNING" || state.gameOver) return { ok: false, reason: "Simulação inativa" };

  const { playerRole, actingRole, actionId } = payload || {};

  if (!actionAllowedInMode(state, playerRole, actingRole, actionId)) {
    logLine(state, "⛔ Ação não permitida para o modo/papel atual.", "bad");
    return { ok: false, reason: "Não permitido" };
  }

  if (state.mode === "G1" && !state.simulation.g1CommanderRole) {
    state.simulation.g1CommanderRole = playerRole;
    logLine(state, `🔒 G1: ${CFG.roles[playerRole]} assumiu o comando de execução.`, "warn");
  }

  const actionDef = ACTION_INDEX[actionId];
  if (!actionDef) return { ok: false, reason: "Ação inválida" };

  if (state.mode === "G2") applyG2Penalties(state, actionId);

  applyEffects(state, actionDef.effects || {});

  state.stats.actionsByRole[actingRole] = (state.stats.actionsByRole[actingRole] || 0) + 1;
  state.stats.actionsById[actionId] = (state.stats.actionsById[actionId] || 0) + 1;

  logLine(
    state,
    `✅ ${CFG.roles[playerRole]} executou "${actionDef.label}" (${CFG.roles[actingRole]}).`,
    "ok"
  );

  return { ok: true };
}

export function tickSimulation(state, deltaSeconds = 1) {
  if (state.phase !== "RUNNING" || state.gameOver) return;

  state.simulation.timeLeft = Math.max(0, state.simulation.timeLeft - deltaSeconds);

  state.resources.tempo = clamp((state.simulation.timeLeft / state.simulation.durationSec) * 100);
  state.resources.panicControl = clamp(state.resources.panicControl - CFG.resources.passiveDrainPerSecond.panicControl * deltaSeconds);
  state.resources.cabinIntegrity = clamp(state.resources.cabinIntegrity - CFG.resources.passiveDrainPerSecond.cabinIntegrity * deltaSeconds);

  if (state.resources.panicControl <= 0 || state.resources.cabinIntegrity <= 0) {
    state.gameOver = true;
    state.phase = "END";
    logLine(state, "💥 Falha da missão: recursos críticos zerados.", "bad");
    return;
  }

  if (state.simulation.timeLeft <= 0) {
    state.gameOver = true;
    state.phase = "END";
    logLine(state, "🏁 Simulação encerrada pelo tempo.", "warn");
  }
}

export function getRoleActions(role) {
  return Object.entries(CFG.actions[role] || {}).map(([id, def]) => ({ id, label: def.label }));
}

export function getAllActionsByRole() {
  return ROLES.reduce((acc, role) => {
    acc[role] = getRoleActions(role);
    return acc;
  }, {});
}

export function formatLogForUI(item) {
  const cls = item.kind === "ok" ? "ok" : item.kind === "warn" ? "warn" : item.kind === "bad" ? "bad" : "";
  return { cls, text: item.text };
}
