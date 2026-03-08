import { GAME_CONFIG as CFG } from "./config.js";
import {
  makeInitialState,
  resetSimulation,
  startSimulation,
  tickSimulation,
  submitInput,
  getRoleActions,
  getAllActionsByRole,
  formatLogForUI,
} from "./engine.js";
import { db, ref, set, onValue, onChildAdded, push, remove } from "./db.js";

const urlParams = new URLSearchParams(window.location.search);
const isMaster = urlParams.get("master") === "true";
const roleFromUrl = (urlParams.get("role") || "pilot").toLowerCase();
const VALID_ROLES = ["pilot", "engineer", "cabin", "copilot"];
const myRole = VALID_ROLES.includes(roleFromUrl) ? roleFromUrl : "pilot";

const DB_PATHS = { gameState: "gameState", phaseInfo: "phaseInfo", inputs: "inputs" };

let state = makeInitialState();
let selectedRole = isMaster ? "pilot" : myRole;
let selectedAction = null;
let running = false;
let interval = null;

const ROLE_NAMES = CFG.roles;
const ALL_ACTIONS_BY_ROLE = getAllActionsByRole();

const $ = (id) => document.getElementById(id);

const ui = {
  loadingStatus: $("loadingStatus"),
  startExperienceBtn: $("startExperienceBtn"),
  modeBadge: $("modeBadge"),
  startBtn: $("startBtn"),
  resetBtn: $("resetBtn"),
  phaseEl: $("phase"),
  timerEl: $("timer"),
  actionBtn1: $("actionBtn1"),
  actionBtn2: $("actionBtn2"),
  submitBtn: $("submitBtn"),
  skipBtn: $("skipBtn"),
  routeA: $("routeA"),
  routeB: $("routeB"),
  roundEl: $("round"),
  distEl: $("dist"),
  targetEl: $("target"),
  inputsRemainingEl: $("inputsRemaining"),
  fuelEl: $("fuel"),
  engineEl: $("engine"),
  healthEl: $("health"),
  fuelBar: $("fuelBar"),
  engineBar: $("engineBar"),
  healthBar: $("healthBar"),
  logEl: $("log"),
  g1Hint: $("g1Hint"),
  storyGuidance: $("storyGuidance"),
  storyStartBtn: $("storyStartBtn"),
  rolePortraits: $("rolePortraits"),
};

function showScreen(screenId) {
  ["bootScreen", "introScreen", "splashScreen", "menuScreen", "storyScreen", "gameScreen", "charactersScreen", "instructionsScreen"].forEach((id) => {
    const el = $(id);
    if (el) el.style.display = "none";
  });
  const t = $(screenId);
  if (t) t.style.display = "flex";
}

function serializeState(s) {
  return JSON.parse(JSON.stringify(s));
}

async function publishState() {
  await set(ref(db, DB_PATHS.gameState), serializeState(state));
}

async function publishPhaseInfo() {
  await set(ref(db, DB_PATHS.phaseInfo), {
    mode: state.mode,
    phase: state.phase,
    timer: state.simulation.timeLeft,
    g1CommanderRole: state.simulation.g1CommanderRole,
  });
}

function normalizeState(raw) {
  const base = makeInitialState();
  return {
    ...base,
    ...raw,
    resources: { ...base.resources, ...(raw?.resources || {}) },
    simulation: { ...base.simulation, ...(raw?.simulation || {}) },
    stats: {
      ...base.stats,
      ...(raw?.stats || {}),
      actionsByRole: { ...base.stats.actionsByRole, ...(raw?.stats?.actionsByRole || {}) },
      actionsById: { ...(raw?.stats?.actionsById || {}) },
    },
    log: Array.isArray(raw?.log) ? raw.log : [],
  };
}

function getActionsForCurrentContext() {
  if (state.mode === "G2") {
    const role = selectedRole;
    return ALL_ACTIONS_BY_ROLE[role] || [];
  }

  const role = isMaster ? selectedRole : myRole;
  return getRoleActions(role);
}

function populateActions() {
  const actions = getActionsForCurrentContext();
  if (!actions.some((a) => a.id === selectedAction)) selectedAction = actions[0]?.id || null;

  [ui.actionBtn1, ui.actionBtn2].forEach((btn, i) => {
    if (!btn) return;
    const a = actions[i];
    if (!a) {
      btn.style.display = "none";
      btn.dataset.actionId = "";
      return;
    }
    btn.style.display = "inline-block";
    btn.dataset.actionId = a.id;
    btn.textContent = a.label.toUpperCase();
    btn.classList.toggle("active", selectedAction === a.id);
  });
}

function canClientExecute() {
  if (isMaster) return true;
  if (state.phase !== "RUNNING") return false;

  if (state.mode === "G1") {
    if (!state.simulation.g1CommanderRole) return true;
    return state.simulation.g1CommanderRole === myRole;
  }

  if (state.mode === "G2") return true;
  return selectedRole === myRole;
}

function render() {
  if (ui.modeBadge) ui.modeBadge.textContent = state.mode;
  if (ui.phaseEl) ui.phaseEl.textContent = state.phase;
  if (ui.timerEl) ui.timerEl.textContent = String(Math.ceil(state.simulation.timeLeft));

  if (ui.roundEl) ui.roundEl.textContent = "1";
  if (ui.distEl) ui.distEl.textContent = "--";
  if (ui.targetEl) ui.targetEl.textContent = "MISSÃO";
  if (ui.inputsRemainingEl) ui.inputsRemainingEl.textContent = "LIVRE";

  if (ui.fuelEl) ui.fuelEl.textContent = `${Math.round(state.resources.panicControl)}`;
  if (ui.engineEl) ui.engineEl.textContent = `${Math.round(state.resources.tempo)}`;
  if (ui.healthEl) ui.healthEl.textContent = `${Math.round(state.resources.cabinIntegrity)}`;

  if (ui.fuelBar) ui.fuelBar.style.width = `${state.resources.panicControl}%`;
  if (ui.engineBar) ui.engineBar.style.width = `${state.resources.tempo}%`;
  if (ui.healthBar) ui.healthBar.style.width = `${state.resources.cabinIntegrity}%`;

  if (ui.logEl) {
    ui.logEl.innerHTML = state.log
      .slice(-28)
      .map(formatLogForUI)
      .map((x) => `<div class="${x.cls}">${x.text}</div>`)
      .join("");
  }

  if (ui.g1Hint) {
    if (state.mode === "G1") {
      const commander = state.simulation.g1CommanderRole ? ROLE_NAMES[state.simulation.g1CommanderRole] : "aguardando primeiro comando";
      ui.g1Hint.textContent = `G1: somente o primeiro papel que executar assume o terminal. Atual: ${commander}.`;
    } else if (state.mode === "G2") {
      ui.g1Hint.textContent = "G2: todos podem decidir tudo. Ações repetidas/conflitantes geram punição.";
    } else {
      ui.g1Hint.textContent = "G3: cada papel decide apenas seu domínio técnico.";
    }
  }

  if (ui.startBtn) ui.startBtn.style.display = isMaster ? "inline-block" : "none";
  if (ui.resetBtn) ui.resetBtn.style.display = isMaster ? "inline-block" : "none";

  if (ui.routeA) ui.routeA.style.display = "none";
  if (ui.routeB) ui.routeB.style.display = "none";
  if (ui.skipBtn) ui.skipBtn.style.display = "none";

  if (ui.rolePortraits) {
    ui.rolePortraits.querySelectorAll("[data-role]").forEach((btn) => {
      const role = btn.dataset.role;
      let canSelect = isMaster;
      if (!isMaster && state.mode === "G2") canSelect = true;
      if (!isMaster && state.mode === "G3") canSelect = false;
      if (!isMaster && state.mode === "G1") canSelect = false;

      if (!isMaster && state.mode !== "G2") selectedRole = myRole;

      btn.disabled = !canSelect;
      btn.style.pointerEvents = canSelect ? "auto" : "none";
      btn.classList.toggle("active", role === (state.mode === "G2" ? selectedRole : (isMaster ? selectedRole : myRole)));
    });
  }

  populateActions();

  if (ui.submitBtn) ui.submitBtn.disabled = !canClientExecute() || !selectedAction;
}

async function processIncomingInput(payload) {
  const result = submitInput(state, payload);
  if (result.ok) {
    await publishState();
    await publishPhaseInfo();
  }
}

function bindRealtime() {
  onValue(ref(db, DB_PATHS.gameState), (snapshot) => {
    const v = snapshot.val();
    if (!v) return;
    state = normalizeState(v);
    render();
  });

  onValue(ref(db, DB_PATHS.phaseInfo), (snapshot) => {
    const v = snapshot.val();
    if (!v) return;
    if (!isMaster) {
      if (typeof v.phase === "string") state.phase = v.phase;
      if (v.g1CommanderRole !== undefined) state.simulation.g1CommanderRole = v.g1CommanderRole;
      if (typeof v.timer === "number") state.simulation.timeLeft = v.timer;
      if (typeof v.mode === "string") state.mode = v.mode;
      render();
    }
  });

  if (isMaster) {
    onChildAdded(ref(db, DB_PATHS.inputs), async (snap) => {
      const val = snap.val();
      if (!val || typeof val !== "object") return;
      await processIncomingInput(val);
      await remove(ref(db, `${DB_PATHS.inputs}/${snap.key}`));
    });
  }
}

async function runMasterTimer() {
  if (running) return;
  running = true;
  startSimulation(state);
  await publishState();
  await publishPhaseInfo();
  render();

  interval = setInterval(async () => {
    tickSimulation(state, 1);
    render();
    await publishState();
    await publishPhaseInfo();

    if (state.phase === "END" || state.gameOver) {
      clearInterval(interval);
      interval = null;
      running = false;
    }
  }, 1000);
}

function bindUI() {
  $("btnIniciar")?.addEventListener("click", () => showScreen("storyScreen"));
  $("btnPersonagens")?.addEventListener("click", () => showScreen("charactersScreen"));
  $("btnInstrucoes")?.addEventListener("click", () => showScreen("instructionsScreen"));
  $("btnSair")?.addEventListener("click", () => showScreen("splashScreen"));
  $("splashScreen")?.addEventListener("click", () => showScreen("menuScreen"));
  ui.startExperienceBtn?.addEventListener("click", () => showScreen("splashScreen"));

  document.querySelectorAll(".btnVoltar").forEach((b) => b.addEventListener("click", () => showScreen("menuScreen")));

  document.querySelectorAll(".group-pick").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!isMaster) return;
      const mode = btn.dataset.mode || "G1";
      resetSimulation(state, mode);
      if (ui.storyGuidance) {
        ui.storyGuidance.textContent = mode === "G1"
          ? "G1: primeiro jogador que executar trava o terminal para seu papel." : mode === "G2"
            ? "G2: todos controlam tudo; conflitos geram punições." : "G3: domínio estrito por responsabilidade.";
      }
      ui.storyStartBtn.disabled = false;
      document.querySelectorAll(".group-pick").forEach((x) => x.classList.toggle("active", x.dataset.mode === mode));
      await publishState();
      await publishPhaseInfo();
      render();
    });
  });

  ui.storyStartBtn?.addEventListener("click", () => {
    showScreen("gameScreen");
    if (isMaster) runMasterTimer();
  });

  [ui.actionBtn1, ui.actionBtn2].forEach((btn) => {
    btn?.addEventListener("click", () => {
      const id = btn.dataset.actionId;
      if (!id) return;
      selectedAction = id;
      populateActions();
    });
  });

  ui.rolePortraits?.querySelectorAll("[data-role]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const role = btn.dataset.role;
      if (!role) return;
      if (!isMaster && state.mode !== "G2") return;
      selectedRole = role;
      selectedAction = null;
      render();
    });
  });

  ui.submitBtn?.addEventListener("click", async () => {
    if (!selectedAction || !canClientExecute()) return;

    const payload = {
      playerRole: isMaster ? selectedRole : myRole,
      actingRole: state.mode === "G2" ? selectedRole : (isMaster ? selectedRole : myRole),
      actionId: selectedAction,
      sentAt: Date.now(),
    };

    if (isMaster) {
      await processIncomingInput(payload);
      render();
      return;
    }

    await push(ref(db, DB_PATHS.inputs), payload);
    const txt = ui.submitBtn.textContent;
    ui.submitBtn.textContent = "ENVIADO";
    setTimeout(() => { ui.submitBtn.textContent = txt; }, 700);
  });

  ui.startBtn?.addEventListener("click", () => {
    if (isMaster) runMasterTimer();
  });

  ui.resetBtn?.addEventListener("click", async () => {
    if (!isMaster) return;
    if (interval) clearInterval(interval);
    interval = null;
    running = false;
    resetSimulation(state, state.mode);
    await remove(ref(db, DB_PATHS.inputs));
    await publishState();
    await publishPhaseInfo();
    render();
  });
}

async function init() {
  bindRealtime();
  bindUI();

  if (ui.loadingStatus) ui.loadingStatus.textContent = "Pronto.";
  if (ui.startExperienceBtn) {
    ui.startExperienceBtn.disabled = false;
    ui.startExperienceBtn.textContent = "INICIAR EXPERIÊNCIA";
  }

  if (isMaster) {
    showScreen("bootScreen");
    resetSimulation(state, "G1");
    await publishState();
    await publishPhaseInfo();
  } else {
    showScreen("gameScreen");
  }

  render();
}

init().catch((err) => {
  console.error(err);
  if (ui.loadingStatus) ui.loadingStatus.textContent = "Falha ao iniciar.";
});
