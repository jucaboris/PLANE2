import { GAME_CONFIG as CFG } from "./config.js";
import { PIN_TABLE } from "./pins.js";

const ROLES = ["pilot", "engineer", "cabin", "copilot"];

function now() { return Date.now(); }
function clampMin(v, min) { return v < min ? min : v; }

function logLine(state, text, kind = "info") {
  state.log.push({ ts: now(), kind, text, round: state.round });
}

export function makeInitialState() {
  return {
    mode: "G3", airportTarget: "A", round: 1, phase: "STATUS",
    resources: { ...CFG.resources.initial },
    emergency: { declared: false, declaredRound: null },
    storm: { startsAtRound: CFG.storm.startsAtRound, active: false },
    current: { inputSeconds: CFG.timing.phases.INPUT, maxInputs: Infinity },
    stats: { conflictsThisRound: 0, conflictsTotal: 0, routeChangesTotal: 0, inputsAcceptedThisRound: 0 },
    inputBuffer: [], acceptedInputs: [],
    g1: { pilotUnlocked: false, authorizedRoles: new Set(), maxAuthorizedRoles: CFG.modes.G1.maxAuthorizedRolesPerRound },
    g2: { routeChangesThisRound: 0, roleInputCountsThisRound: { pilot: 0, engineer: 0, cabin: 0, copilot: 0 } },
    roundAnnulled: false, gameOver: false, landed: false, log: [], _routeChangedThisRound: false,
  };
}

function isStormActive(state) { return state.round >= state.storm.startsAtRound; }

export function adjustPostStormLimits(state) {
  state.storm.active = isStormActive(state);
  if (state.storm.active) {
    state.current.maxInputs = CFG.storm.postStormMaxInputs;
    state.current.inputSeconds = CFG.timing.postStorm.inputSeconds;
  } else {
    state.current.maxInputs = Infinity;
    state.current.inputSeconds = CFG.timing.phases.INPUT;
  }
}

function getTick(state) { return isStormActive(state) ? CFG.resources.tick.storm : CFG.resources.tick.normal; }

function landingRequirement(state) {
  if (state.airportTarget === "A") {
    const bonus = state.emergency.declared ? CFG.emergency.airportABonus.engineMinMinus : 0;
    return { type: "engine", value: CFG.airports.A.landing.min - bonus, dist: CFG.airports.A.dist };
  }
  return { type: "fuel", value: CFG.airports.B.landing.min, dist: CFG.airports.B.dist };
}

function canAcceptMoreInputs(state) { return state.stats.inputsAcceptedThisRound < state.current.maxInputs; }

export function resetRoundAccounting(state) {
  state.stats.conflictsThisRound = 0; state.stats.inputsAcceptedThisRound = 0;
  state.acceptedInputs = []; state.inputBuffer = []; state.roundAnnulled = false;
  state.g1.pilotUnlocked = false; state.g1.authorizedRoles = new Set();
  state.g2.routeChangesThisRound = 0; state.g2.roleInputCountsThisRound = { pilot: 0, engineer: 0, cabin: 0, copilot: 0 };
  state._routeChangedThisRound = false;
}

export function changeAirport(state, newTarget) {
  // Permite mudar de rota enquanto a rodada não estiver sendo resolvida
  if (state.phase === "RESOLVE" || state.phase === "END") return { ok: false, reason: "Processando rodada" };
  if (newTarget !== "A" && newTarget !== "B") return { ok: false, reason: "Aeroporto inválido" };
  if (newTarget === state.airportTarget) return { ok: true, reason: "Sem mudança" };

  state.airportTarget = newTarget;
  state.resources.fuel -= CFG.routeChange.fuelCost;
  state.stats.routeChangesTotal += 1;
  if (state.mode === "G2") state.g2.routeChangesThisRound += 1;
  state._routeChangedThisRound = true;
  logLine(state, `↪️ Troca de rota: -${CFG.routeChange.fuelCost} combustível (novo alvo ${newTarget})`, "warn");
  return { ok: true };
}

function isPinValid(mode, role, pin) {
  const expected = PIN_TABLE?.[mode]?.[role];
  return expected === pin;
}

function parseCombinedPin(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.includes("-")) {
    const [p, r] = s.split("-").map(x => x.trim());
    if (p?.length === 4 && r?.length === 4) return { pilotPin: p, rolePin: r };
    return null;
  }
  const digits = s.replace(/\D/g, "");
  if (digits.length === 8) return { pilotPin: digits.slice(0, 4), rolePin: digits.slice(4) };
  return null;
}

function isRoleActionAllowed(role, actionId) { return !!CFG.actions?.[role]?.[actionId]; }

function acceptRoleInput(state, { role, actionId, meta }) {
  state.acceptedInputs.push({ ts: now(), role, actionId, meta, round: state.round, mode: state.mode });
  state.stats.inputsAcceptedThisRound += 1;
  if (state.mode === "G2") state.g2.roleInputCountsThisRound[role] = (state.g2.roleInputCountsThisRound[role] || 0) + 1;
  logLine(state, `✅ Input aceito: ${role} → ${actionId}`, "ok");
}

function submitG1Combined(state, { role, combinedPin, actionId }) {
  const parsed = parseCombinedPin(combinedPin);
  if (!parsed) { logLine(state, "❌ PIN inválido (use PPPP-RRRR)", "bad"); return { ok: false }; }
  if (!isPinValid("G1", "pilot", parsed.pilotPin)) { logLine(state, "❌ PIN piloto inválido", "bad"); return { ok: false }; }
  state.g1.pilotUnlocked = true;

  if (role === "pilot") {
    if (!isPinValid("G1", "pilot", parsed.rolePin)) { logLine(state, "❌ Piloto: use PPPP-PPPP", "bad"); return { ok: false }; }
    acceptRoleInput(state, { role: "pilot", actionId, meta: null });
    return { ok: true };
  }

  if (!isPinValid("G1", role, parsed.rolePin)) { logLine(state, `❌ PIN ${role} inválido`, "bad"); return { ok: false }; }
  if (!state.g1.authorizedRoles.has(role)) {
    if (state.g1.authorizedRoles.size >= state.g1.maxAuthorizedRoles) { logLine(state, "⛔ Limite autorizações", "bad"); return { ok: false }; }
    state.g1.authorizedRoles.add(role);
  }

  if (role === "copilot" && actionId === "declareEmergency") { state.resources.fuel -= CFG.modes.G1.emergencyOverhead.fuelPenalty; }
  acceptRoleInput(state, { role, actionId, meta: null });
  return { ok: true };
}

export function submitInput(state, payload) {
  const { role, pin, actionId, meta } = payload || {};
  state.inputBuffer.push({ ts: now(), round: state.round, mode: state.mode, role, pin, actionId, meta });

  if (state.gameOver) return { ok: false, reason: "Jogo encerrado" };
  // REMOVIDA A TRAVA DE FASE: agora aceita em qualquer fase, exceto quando estiver processando
  if (state.phase === "RESOLVE" || state.phase === "END") return { ok: false, reason: "Processando" }; 
  if (!ROLES.includes(role)) return { ok: false, reason: "Role inválido" };
  if (!canAcceptMoreInputs(state)) return { ok: false, reason: "Limite inputs" };

  if (meta?.airportChangeTo) { const rc = changeAirport(state, meta.airportChangeTo); if (!rc.ok) return rc; }
  if (state.mode === "G1") return submitG1Combined(state, { role, combinedPin: pin, actionId });

  const pinStr = String(pin || "");
  if (!isPinValid(state.mode, role, pinStr)) { logLine(state, `❌ PIN inválido (${role})`, "bad"); return { ok: false, reason: "PIN inválido" }; }

  if (state.mode === "G3" && !isRoleActionAllowed(role, actionId)) {
    logLine(state, `⛔ Ação não permitida para ${role} (G3)`, "bad"); return { ok: false };
  }

  acceptRoleInput(state, { role, actionId, meta });
  return { ok: true };
}

export function detectConflictsG2(state) {
  let conflicts = 0;
  for (const r of ROLES) { if ((state.g2.roleInputCountsThisRound[r] || 0) >= 2) conflicts += 1; }
  if (CFG.routeChange.g2ConflictIfMultipleInSameRound && (state.g2.routeChangesThisRound || 0) >= 2) conflicts += 1;
  return conflicts;
}

function applyConflictPenaltyG2(state, conflicts) {
  if (conflicts <= 0) return;
  state.stats.conflictsThisRound = conflicts; state.stats.conflictsTotal += conflicts;
  const table = CFG.modes.G2.conflictRules.penalties;
  const row = table.find(x => x.conflicts === Math.min(conflicts, 3)) || table[table.length - 1];

  if (row.annulRoundActions) { state.roundAnnulled = true; logLine(state, "⚠️ Rodada anulada (G2)", "bad"); return; }
  if (row.fuel) state.resources.fuel -= row.fuel;
  if (row.engine) state.resources.engine -= row.engine;
}

function findLatestInput(state, role) { const arr = state.acceptedInputs.filter(x => x.role === role); return arr.length ? arr[arr.length - 1] : null; }

function applyTick(state, engineerChoice) {
  const tick = getTick(state);
  let engineTick = tick.engine;
  if (engineerChoice === "protect") engineTick = Math.max(0, engineTick - CFG.actions.engineer.protect.engineTickReduce);
  state.resources.fuel -= tick.fuel; state.resources.engine -= engineTick; state.resources.health -= tick.health;
  logLine(state, `TICK: -${tick.fuel} fuel, -${engineTick} eng, -${tick.health} hp`);
}

function applyRoleActions(state) {
  const cop = findLatestInput(state, "copilot");
  if (cop && cop.actionId === "declareEmergency") {
    if (state.round <= CFG.emergency.deadlineRound) { state.emergency.declared = true; logLine(state, "📡 Emergência declarada", "ok"); }
  }
  const pil = findLatestInput(state, "pilot");
  if (pil && CFG.actions.pilot[pil.actionId]) {
    const a = CFG.actions.pilot[pil.actionId];
    state.resources.dist += a.advance; state.resources.fuel -= a.fuelExtra;
  }
  const eng = findLatestInput(state, "engineer");
  if (eng && CFG.actions.engineer[eng.actionId]) {
    const a = CFG.actions.engineer[eng.actionId];
    state.resources.engine += a.engineDelta; state.resources.fuel -= a.fuelExtra;
  }
  const cab = findLatestInput(state, "cabin");
  if (cab && CFG.actions.cabin[cab.actionId]) { state.resources.health += CFG.actions.cabin[cab.actionId].healthDelta; }
}

function checkEndConditions(state) {
  // G3: Proteção divina contra queda por recursos e vitória automática se bater a distância
  if (state.mode === "G3") {
    if (state.resources.fuel < 1) state.resources.fuel = 1;
    if (state.resources.engine < 1) state.resources.engine = 1;
    if (state.resources.health < 1) state.resources.health = 1;
  }

  if (state.resources.fuel <= 0 || state.resources.engine <= 0 || state.resources.health <= 0) {
    state.gameOver = true; state.landed = false; state.phase = "END";
    logLine(state, "💥 QUEDA: recursos zerados.", "bad"); return;
  }

  const req = landingRequirement(state);
  if (state.resources.dist >= req.dist) {
    if (state.mode === "G3") {
      state.gameOver = true; state.landed = true; state.phase = "END";
      logLine(state, `🛬 SUCESSO ABSOLUTO (G3) no Alvo ${state.airportTarget}!`, "ok"); return;
    }
    
    if ((req.type === "engine" && state.resources.engine >= req.value) || (req.type === "fuel" && state.resources.fuel >= req.value)) {
      state.gameOver = true; state.landed = true; state.phase = "END"; logLine(state, "🛬 POUSO BEM SUCEDIDO!", "ok");
    } else {
      state.gameOver = true; state.landed = false; state.phase = "END"; logLine(state, "💥 FALHA NO POUSO (Falta de recursos).", "bad");
    }
  }
}

export function resolveRound(state) {
  state.phase = "RESOLVE"; state.storm.active = isStormActive(state);
  if (state.mode === "G2") applyConflictPenaltyG2(state, detectConflictsG2(state));
  const eng = findLatestInput(state, "engineer");
  applyTick(state, eng?.actionId ?? null);
  if (state.mode === "G1" && state._routeChangedThisRound && CFG.modes.G1.routeChangeOverhead.consumesFullRoundAction) {
    checkEndConditions(state); return;
  }
  if (state.mode === "G2" && state.roundAnnulled) { checkEndConditions(state); return; }
  applyRoleActions(state);
  state.resources.fuel = clampMin(state.resources.fuel, -99);
  state.resources.engine = clampMin(state.resources.engine, -99);
  state.resources.health = clampMin(state.resources.health, -99);
  checkEndConditions(state);
}

export function endRound(state) {
  if (state.gameOver) return;
  state.round += 1;
  if (state.round > CFG.roundsMax) {
    state.gameOver = true; state.phase = "END";
    if (state.mode === "G3") {
      state.landed = true; logLine(state, "🛬 FIM DA JORNADA: SUCESSO (G3)!", "ok"); // G3 ganha mesmo por tempo
    } else {
      state.landed = false; logLine(state, "⏹️ Encerrado: limite de rodadas (Sem pouso).", "bad");
    }
    return;
  }
  state.phase = "STATUS";
}

export function formatLogForUI(item) {
  const cls = item.kind === "ok" ? "ok" : item.kind === "warn" ? "warn" : item.kind === "bad" ? "bad" : "";
  return { cls, text: item.text };

}
