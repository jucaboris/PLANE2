import { GAME_CONFIG as CFG } from "./config.js";

const RESPONSIBILITIES = Object.keys(CFG.responsibilities);
const ROLES = Object.keys(CFG.roles);

function now() {
  return Date.now();
}

function clamp(v) {
  return Math.max(CFG.resources.min, Math.min(CFG.resources.max, v));
}

function logLine(state, text, kind = "info") {
  state.log.push({ ts: now(), kind, text });
}

function blankVoteState() {
  const votes = {};
  for (const responsibility of RESPONSIBILITIES) {
    const actionMap = {};
    const actions = CFG.responsibilities[responsibility].actions;
    for (const actionId of Object.keys(actions)) actionMap[actionId] = { total: 0, byRole: {} };
    votes[responsibility] = actionMap;
  }
  return votes;
}

function blankResolved() {
  return RESPONSIBILITIES.reduce((acc, item) => {
    acc[item] = null;
    return acc;
  }, {});
}

const ACTION_INDEX = allActions();

export function makeInitialState() {
  return {
    mode: "G1",
    phase: "IDLE", // IDLE | VOTING | RESOLUTION | END
    round: 1,
    gameOver: false,
    waitingForResult: false,
    resources: { ...CFG.resources.initial },
    roundInfo: {
      durationSec: CFG.roundDurationSec,
      timeLeft: CFG.roundDurationSec,
      g1LockedCommander: null,
      resolved: blankResolved(),
      activeResponsibility: "command",
    },
    votes: blankVoteState(),
    stats: { totalVotes: 0, conflictsG2: 0 },
    log: [],
    lastFailure: null,
  };
}

export function resetForNewMode(state, mode) {
  const fresh = makeInitialState();
  state.mode = mode;
  state.phase = "IDLE";
  state.round = 1;
  state.gameOver = false;
  state.waitingForResult = false;
  state.resources = { ...fresh.resources };
  state.roundInfo = { ...fresh.roundInfo, resolved: blankResolved() };
  state.votes = blankVoteState();
  state.stats = { totalVotes: 0, conflictsG2: 0 };
  state.log = [];
  state.lastFailure = null;
  logLine(state, `Modo ${mode} preparado.`, "warn");
}

export function startVotingRound(state) {
  state.phase = "VOTING";
  state.waitingForResult = false;
  state.roundInfo.timeLeft = CFG.roundDurationSec;
  state.roundInfo.g1LockedCommander = null;
  state.roundInfo.resolved = blankResolved();
  state.roundInfo.activeResponsibility = "command";
  state.votes = blankVoteState();
  logLine(state, `Rodada ${state.round} iniciada para votação (${CFG.roundDurationSec}s).`, "ok");
}

function canVoteForResponsibility(state, playerRole, responsibility) {
  if (!ROLES.includes(playerRole)) return false;
  if (!RESPONSIBILITIES.includes(responsibility)) return false;

  if (state.mode === "G1") {
    if (playerRole !== "pilot") return false;
    return true;
  }

  if (state.mode === "G2") return true;

  return CFG.roles[playerRole].responsibility === responsibility;
}

export function submitVote(state, { playerRole, responsibility, actionId }) {
  if (state.phase !== "VOTING" || state.gameOver) return { ok: false, reason: "Votação inativa" };

  if (!canVoteForResponsibility(state, playerRole, responsibility)) {
    return { ok: false, reason: "blocked_by_command" };
  }

  const respCfg = CFG.responsibilities[responsibility];
  if (!respCfg || !respCfg.actions[actionId]) return { ok: false, reason: "Ação inválida" };

  if (state.mode === "G1" && !state.roundInfo.g1LockedCommander) {
    state.roundInfo.g1LockedCommander = "pilot";
  }

  const bucket = state.votes[responsibility][actionId];
  bucket.total += 1;
  bucket.byRole[playerRole] = (bucket.byRole[playerRole] || 0) + 1;

  state.stats.totalVotes += 1;
  logLine(state, `${CFG.roles[playerRole].label} votou em ${respCfg.actions[actionId].label} (${respCfg.label}).`, "info");
  return { ok: true };
}

export function tickVoting(state, deltaSec = 1) {
  if (state.phase !== "VOTING" || state.gameOver) return;
  state.roundInfo.timeLeft = Math.max(0, state.roundInfo.timeLeft - deltaSec);
  state.resources.tempo = clamp((state.roundInfo.timeLeft / CFG.roundDurationSec) * 100);
  state.resources.panicControl = clamp(state.resources.panicControl - CFG.resources.passiveDrainPerSecond.panicControl * deltaSec);
  state.resources.cabinIntegrity = clamp(state.resources.cabinIntegrity - CFG.resources.passiveDrainPerSecond.cabinIntegrity * deltaSec);

  if (state.resources.panicControl <= 0 || state.resources.cabinIntegrity <= 0) {
    state.phase = "END";
    state.gameOver = true;
    state.lastFailure = "Recursos críticos zerados durante a votação.";
    logLine(state, "💥 Missão falhou por recursos críticos durante votação.", "bad");
    return;
  }

  if (state.roundInfo.timeLeft <= 0) {
    state.phase = "RESOLUTION";
    state.waitingForResult = true;
    logLine(state, "Tempo encerrado. Aguardando execução do Mestre.", "warn");
  }
}

function applyEffect(state, effect) {
  state.resources.panicControl = clamp(state.resources.panicControl + (effect.panicControl || 0));
  state.resources.cabinIntegrity = clamp(state.resources.cabinIntegrity + (effect.cabinIntegrity || 0));
}

export function getVoteSummaryForResponsibility(state, responsibility) {
  const respVotes = state.votes[responsibility] || {};
  const total = Object.values(respVotes).reduce((sum, v) => sum + (v.total || 0), 0);
  const actions = Object.entries(respVotes).map(([actionId, obj]) => ({
    actionId,
    votes: obj.total || 0,
    pct: total > 0 ? Math.round(((obj.total || 0) / total) * 100) : 0,
  }));
  actions.sort((a, b) => b.votes - a.votes);
  return { total, actions };
}

function hasConflictG2(state, responsibility) {
  if (state.mode !== "G2") return false;
  const values = Object.values(state.votes[responsibility] || {});
  const votedActions = values.filter((v) => (v.total || 0) > 0).length;
  return votedActions > 1;
}

export function resolveResponsibility(state, responsibility, actionId) {
  if (state.phase !== "RESOLUTION" || state.gameOver) return { ok: false, reason: "Resolução indisponível" };
  if (!RESPONSIBILITIES.includes(responsibility)) return { ok: false, reason: "Responsabilidade inválida" };
  if (state.roundInfo.resolved[responsibility]) return { ok: false, reason: "Já resolvida" };

  const cfg = CFG.responsibilities[responsibility];
  if (!cfg.actions[actionId]) return { ok: false, reason: "Ação inválida" };

  if (hasConflictG2(state, responsibility)) {
    applyEffect(state, CFG.g2.conflictPenalty);
    state.stats.conflictsG2 += 1;
    logLine(state, `⚠️ Conflito de votos no G2 em ${cfg.label}.`, "warn");
  }

  const correct = cfg.correctAction === actionId;
  const pickedLabel = cfg.actions[actionId].label;

  state.roundInfo.resolved[responsibility] = {
    actionId,
    correct,
    at: now(),
  };

  if (!correct) {
    applyEffect(state, cfg.actions[actionId].failEffect || {});
    state.phase = "END";
    state.gameOver = true;
    state.lastFailure = cfg.failReason;
    logLine(state, `❌ ${cfg.label} executou decisão incorreta (${pickedLabel}). ${cfg.failReason}`, "bad");
    return { ok: true, failed: true };
  }

  applyEffect(state, cfg.actions[actionId].successEffect || {});
  logLine(state, `✅ ${cfg.label} executou decisão correta (${pickedLabel}).`, "ok");

  const pending = RESPONSIBILITIES.find((r) => !state.roundInfo.resolved[r]);
  state.roundInfo.activeResponsibility = pending || null;

  if (!pending) {
    state.waitingForResult = false;
    if (state.round >= CFG.maxRounds) {
      state.phase = "END";
      state.gameOver = true;
      logLine(state, "🏁 Simulação concluída com sucesso em todas as responsabilidades.", "ok");
    } else {
      state.round += 1;
      startVotingRound(state);
    }
  }

  return { ok: true, failed: false };
}

export function formatLogForUI(item) {
  const cls = item.kind === "ok" ? "ok" : item.kind === "warn" ? "warn" : item.kind === "bad" ? "bad" : "";
  return { cls, text: item.text };
}
