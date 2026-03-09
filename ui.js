import { GAME_CONFIG as CFG } from "./config.js";
import {
  makeInitialState,
  resetForNewMode,
  startVotingRound,
  tickVoting,
  submitVote,
  resolveResponsibility,
  getVoteSummaryForResponsibility,
  formatLogForUI,
} from "./engine.js";
import { db, ref, set, onValue, onChildAdded, push, remove } from "./db.js";

const params = new URLSearchParams(window.location.search);
const isMaster = params.get("master") === "true";
const myRole = ["pilot", "engineer", "cabin", "copilot"].includes((params.get("role") || "pilot").toLowerCase())
  ? (params.get("role") || "pilot").toLowerCase()
  : "pilot";

const DB = { gameState: "gameState", phaseInfo: "phaseInfo", inputs: "inputs" };

const RESPONSIBILITIES = Object.keys(CFG.responsibilities);
let state = makeInitialState();
let running = false;
let timer = null;
let selectedResponsibility = isMaster ? "command" : CFG.roles[myRole].responsibility;
let selectedAction = null;
let masterSelectedResponsibility = "command";
let masterSelectedAction = null;

const $ = (id) => document.getElementById(id);
const ui = {
  bootScreen: $("bootScreen"),
  storyScreen: $("storyScreen"),
  gameScreen: $("gameScreen"),
  loadingStatus: $("loadingStatus"),
  startExperienceBtn: $("startExperienceBtn"),
  modeBadge: $("modeBadge"),
  phase: $("phase"),
  round: $("round"),
  timer: $("timer"),
  cockpitTitle: $("cockpitTitle"),
  myRoleImage: $("myRoleImage"),
  myRoleLabel: $("myRoleLabel"),
  modeHint: $("modeHint"),
  roleChoice: $("roleChoice"),
  actionButtons: $("actionButtons"),
  submitBtn: $("submitBtn"),
  startBtn: $("startBtn"),
  resetBtn: $("resetBtn"),
  masterCockpitControls: $("masterCockpitControls"),
  masterVotes: $("masterVotes"),
  masterRespButtons: $("masterRespButtons"),
  masterActionButtons: $("masterActionButtons"),
  masterExecuteBtn: $("masterExecuteBtn"),
  log: $("log"),
  storyGuidance: $("storyGuidance"),
  storyStartBtn: $("storyStartBtn"),
  popup: $("statusPopup"),
  popupTitle: $("popupTitle"),
  popupMessage: $("popupMessage"),
  popupCloseBtn: $("popupCloseBtn"),
};

function show(screenId) {
  [ui.bootScreen, ui.storyScreen, ui.gameScreen].forEach((s) => s?.classList.remove("active"));
  $(screenId)?.classList.add("active");
}

function showPopup(title, message) {
  ui.popupTitle.textContent = title;
  ui.popupMessage.textContent = message;
  ui.popup.classList.add("active");
}

function hidePopup() {
  ui.popup.classList.remove("active");
}

function canRoleVote(role, responsibility) {
  if (state.mode === "G1") return role === "pilot";
  if (state.mode === "G2") return true;
  return CFG.roles[role].responsibility === responsibility;
}

function publishState() {
  return set(ref(db, DB.gameState), JSON.parse(JSON.stringify(state)));
}

function publishPhase() {
  return set(ref(db, DB.phaseInfo), {
    mode: state.mode,
    phase: state.phase,
    round: state.round,
    timeLeft: state.roundInfo.timeLeft,
    waitingForResult: state.waitingForResult,
    gameOver: state.gameOver,
    lastFailure: state.lastFailure ?? null,
  });
}

function modeHint() {
  if (state.mode === "G1") return "G1: apenas COMANDO vota/executa por todas as responsabilidades.";
  if (state.mode === "G2") return "G2: todos votam em todas as responsabilidades.";
  return "G3: cada perfil vota só na própria responsabilidade.";
}

function renderRoleChoice() {
  ui.roleChoice.innerHTML = "";
  const allowed = state.mode === "G2" || (state.mode === "G1" && myRole === "pilot");

  RESPONSIBILITIES.forEach((resp) => {
    const btn = document.createElement("button");
    btn.className = `btn ${selectedResponsibility === resp ? "active" : ""}`;
    btn.textContent = CFG.responsibilities[resp].label;
    btn.disabled = !allowed;
    btn.addEventListener("click", () => {
      selectedResponsibility = resp;
      selectedAction = null;
      render();
    });
    ui.roleChoice.appendChild(btn);
  });
}

function renderActions() {
  ui.actionButtons.innerHTML = "";
  const actions = CFG.responsibilities[selectedResponsibility].actions;

  Object.entries(actions).forEach(([actionId, def]) => {
    const btn = document.createElement("button");
    btn.className = `btn ${selectedAction === actionId ? "active" : ""}`;
    btn.textContent = def.label;
    btn.addEventListener("click", () => {
      selectedAction = actionId;
      renderActions();
    });
    ui.actionButtons.appendChild(btn);
  });
}

function renderMasterVotes() {
  if (!isMaster) {
    ui.masterVotes.parentElement.style.display = "none";
    return;
  }

  const blocks = RESPONSIBILITIES.map((resp) => {
    const summary = getVoteSummaryForResponsibility(state, resp);
    const actions = summary.actions.map((a) => {
      const label = CFG.responsibilities[resp].actions[a.actionId].label;
      return `<div>${label}: <b>${a.votes}</b> votos (${a.pct}%)</div>`;
    }).join("");
    return `<div class="card" style="margin-bottom:8px"><b>${CFG.responsibilities[resp].label}</b><div>${actions || "Sem votos"}</div></div>`;
  }).join("");

  ui.masterVotes.innerHTML = blocks;
}

function renderMasterSelectors() {
  if (!isMaster) return;

  const activeResp = state.roundInfo.activeResponsibility || RESPONSIBILITIES[0];
  if (!RESPONSIBILITIES.includes(masterSelectedResponsibility)) masterSelectedResponsibility = activeResp;

  ui.masterRespButtons.innerHTML = RESPONSIBILITIES.map((resp) => `
    <button class="btn ${masterSelectedResponsibility === resp ? "active" : ""}" data-master-resp="${resp}">${CFG.responsibilities[resp].label}</button>
  `).join("");

  ui.masterRespButtons.querySelectorAll("[data-master-resp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      masterSelectedResponsibility = btn.dataset.masterResp;
      masterSelectedAction = null;
      renderMasterSelectors();
    });
  });

  updateMasterActionOptions();
}

function updateMasterActionOptions() {
  const resp = masterSelectedResponsibility;
  const actions = CFG.responsibilities[resp].actions;
  const summary = getVoteSummaryForResponsibility(state, resp);
  const winner = summary.actions[0]?.actionId || Object.keys(actions)[0];

  if (!masterSelectedAction || !actions[masterSelectedAction]) masterSelectedAction = winner;

  ui.masterActionButtons.innerHTML = Object.entries(actions)
    .map(([id, def]) => `<button class="btn ${masterSelectedAction === id ? "active" : ""}" data-master-action="${id}">${def.label}</button>`)
    .join("");

  ui.masterActionButtons.querySelectorAll("[data-master-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      masterSelectedAction = btn.dataset.masterAction;
      renderMasterSelectors();
    });
  });
}

function render() {
  ui.modeBadge.textContent = state.mode;
  ui.phase.textContent = state.phase;
  ui.round.textContent = String(state.round);
  ui.timer.textContent = String(Math.ceil(state.roundInfo.timeLeft));

  const roleCfg = CFG.roles[myRole];
  ui.myRoleImage.src = roleCfg.image;
  ui.myRoleLabel.textContent = `${roleCfg.label} (${isMaster ? "Mestre" : "Cliente"})`;
  ui.cockpitTitle.textContent = isMaster ? "Cockpit do Mestre" : `Cockpit ${roleCfg.label}`;
  ui.modeHint.textContent = modeHint();

  renderRoleChoice();
  renderActions();
  renderMasterVotes();
  renderMasterSelectors();

  const canVote = canRoleVote(myRole, selectedResponsibility) && state.phase === "VOTING" && !state.gameOver;
  ui.submitBtn.style.display = isMaster ? "none" : "inline-block";
  ui.submitBtn.disabled = !canVote || !selectedAction || state.phase === "RESOLUTION" || state.phase === "END";

  ui.startBtn.style.display = isMaster ? "inline-block" : "none";
  ui.resetBtn.style.display = isMaster ? "inline-block" : "none";

  ui.roleChoice.style.display = isMaster ? "none" : "grid";
  ui.actionButtons.style.display = isMaster ? "none" : "grid";
  ui.masterCockpitControls.style.display = isMaster ? "block" : "none";

  if (isMaster) {
    ui.masterExecuteBtn.disabled = state.phase !== "RESOLUTION" || state.gameOver;
    ui.masterExecuteBtn.textContent = state.phase === "RESOLUTION" ? "Executar responsabilidade" : "Aguardar fim do tempo para executar";
  }

  if (!isMaster && state.waitingForResult && state.phase === "RESOLUTION") {
    showPopup("Ações em progresso", "O tempo de votação acabou. Aguarde o Mestre executar os resultados da rodada.");
  }

  if (state.gameOver && state.lastFailure && isMaster) {
    showPopup("Missão Falhou", state.lastFailure);
  }

  ui.log.innerHTML = state.log.slice(-30).map(formatLogForUI).map((l) => `<div class="${l.cls}">${l.text}</div>`).join("");
}

async function processInput(payload) {
  const result = submitVote(state, payload);
  if (!result.ok) return result;
  await publishState();
  await publishPhase();
  return result;
}

function bindRealtime() {
  onValue(ref(db, DB.gameState), (snap) => {
    const v = snap.val();
    if (!v) return;
    state = v;
    render();
  });

  onValue(ref(db, DB.phaseInfo), (snap) => {
    const v = snap.val();
    if (!v || isMaster) return;
    state.phase = v.phase;
    state.round = v.round;
    state.roundInfo.timeLeft = v.timeLeft;
    state.waitingForResult = !!v.waitingForResult;
    state.gameOver = !!v.gameOver;
    state.lastFailure = v.lastFailure || null;
    state.mode = v.mode || state.mode;
    render();
  });

  if (isMaster) {
    onChildAdded(ref(db, DB.inputs), async (snap) => {
      const val = snap.val();
      if (!val) return;
      await processInput(val);
      await remove(ref(db, `${DB.inputs}/${snap.key}`));
    });
  }
}

async function runTimerLoop() {
  if (!isMaster || running) return;
  running = true;
  startVotingRound(state);
  await publishState();
  await publishPhase();
  render();

  timer = setInterval(async () => {
    tickVoting(state, 1);
    await publishState();
    await publishPhase();
    render();

    if (state.phase !== "VOTING" || state.gameOver) {
      clearInterval(timer);
      timer = null;
      running = false;
    }
  }, 1000);
}

function bindUI() {
  ui.popupCloseBtn.addEventListener("click", hidePopup);
  ui.startExperienceBtn.addEventListener("click", () => show(isMaster ? "storyScreen" : "gameScreen"));

  document.querySelectorAll(".group-pick").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!isMaster) return;
      const mode = btn.dataset.mode;
      resetForNewMode(state, mode);
      selectedResponsibility = mode === "G2" ? "command" : CFG.roles[myRole].responsibility;
      selectedAction = null;
      ui.storyGuidance.textContent = modeHint();
      ui.storyStartBtn.disabled = false;
      document.querySelectorAll(".group-pick").forEach((x) => x.classList.toggle("active", x === btn));
      await publishState();
      await publishPhase();
      render();
    });
  });

  ui.storyStartBtn.addEventListener("click", () => {
    show("gameScreen");
    if (isMaster) runTimerLoop();
  });

  ui.submitBtn.addEventListener("click", async () => {
    if (isMaster || !selectedAction) return;

    if (!canRoleVote(myRole, selectedResponsibility)) {
      showPopup("Bloqueado pelo Comando", "No G1, apenas o Comando pode executar decisões desta rodada.");
      return;
    }

    const payload = {
      playerRole: myRole,
      responsibility: selectedResponsibility,
      actionId: selectedAction,
      sentAt: Date.now(),
    };

    await push(ref(db, DB.inputs), payload);
    showPopup("Voto registrado", "Seu voto foi computado ao vivo no painel do Mestre.");

    render();
  });

  ui.masterExecuteBtn.addEventListener("click", async () => {
    if (!isMaster || state.phase !== "RESOLUTION") return;
    const responsibility = masterSelectedResponsibility;
    const actionId = masterSelectedAction;
    if (!responsibility || !actionId) return;
    const result = resolveResponsibility(state, responsibility, actionId);
    await publishState();
    await publishPhase();
    render();

    if (result.failed) {
      showPopup("Missão Falhou", state.lastFailure || "Falha crítica na execução.");
      return;
    }

    if (state.phase === "VOTING") {
      runTimerLoop();
    }
  });

  ui.startBtn.addEventListener("click", runTimerLoop);

  ui.resetBtn.addEventListener("click", async () => {
    if (!isMaster) return;
    if (timer) clearInterval(timer);
    running = false;
    timer = null;
    resetForNewMode(state, state.mode);
    await remove(ref(db, DB.inputs));
    await publishState();
    await publishPhase();
    render();
  });
}

async function init() {
  bindRealtime();
  bindUI();

  ui.loadingStatus.textContent = "Pronto.";
  ui.startExperienceBtn.disabled = false;

  if (isMaster) {
    resetForNewMode(state, "G1");
    await publishState();
    await publishPhase();
    show("bootScreen");
  } else {
    show("bootScreen");
  }

  render();
}

init().catch((err) => {
  console.error(err);
  ui.loadingStatus.textContent = "Falha ao iniciar.";
});
