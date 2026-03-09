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
const MODE_ORDER = ["G1", "G2", "G3"];
const ACTION_CONTEXT = {
  command: "Conter ameaça principal",
  negotiator: "Reduzir risco por negociação",
  cabin: "Estabilizar os passageiros",
  bomb: "Neutralizar o explosivo",
};
let state = makeInitialState();
let running = false;
let timer = null;
let selectedResponsibility = CFG.roles[myRole].responsibility;
let selectedAction = null;
let masterSelectedResponsibility = "command";
let masterSelectedAction = null;
let introShownInRound = false;

const OBJECTIVES_TEXT = `\
G1 — Hierarquia total:
- Apenas o Comando vota e define todas as responsabilidades.
- Objetivo: testar decisões centralizadas sob pressão.

G2 — Decisão coletiva:
- Todos podem votar em todas as responsabilidades.
- Objetivo: avaliar coordenação e reduzir conflitos entre visões diferentes.

G3 — Especialização:
- Cada personagem vota apenas na própria responsabilidade.
- Objetivo: consolidar autonomia técnica de cada papel.

Missão de sucesso:
Executar corretamente, em sequência:
1) Conter ameaça principal
2) Reduzir risco por negociação
3) Estabilizar os passageiros
4) Neutralizar o explosivo.`;

const INSTRUCTIONS_TEXT = `\
Boas práticas por personagem:

Comando:
- Priorização: impedir ação imediata do agressor.
- Evite ações de alto impacto sem confirmação do contexto.

Negociador:
- Busque reduzir impulso e tensão emocional do agressor.
- Mantenha linguagem clara, calma e sem confronto.

Cabine:
- Foque em estabilidade e previsibilidade dos passageiros.
- Evite movimentação brusca e ordens contraditórias.

Esquadrão Antibomba:
- Só execute procedimento com validação técnica.
- Evite ação por tentativa e erro em dispositivo ativo.

Mestre:
- Execute cada responsabilidade no painel após votação.
- Em erro: a missão falha e o motivo é exibido.
- Em acerto: siga para a próxima responsabilidade até concluir as quatro.`;

const STORYTELLING_TEXT = `\
Um voo comercial entrou em estado crítico.
Há uma ameaça ativa na aeronave, passageiros em pânico e indícios de explosivo a bordo.

Seu time precisa agir em cadeia, sem rupturas:
- Comando contém a ameaça principal.
- Negociador reduz risco por negociação.
- Cabine estabiliza os passageiros.
- Esquadrão Antibomba neutraliza o explosivo.

Cada decisão pode salvar ou encerrar a missão. Mantenham coordenação total.`;

const $ = (id) => document.getElementById(id);
const ui = {
  bootScreen: $("bootScreen"),
  gameScreen: $("gameScreen"),
  loadingStatus: $("loadingStatus"),
  startExperienceBtn: $("startExperienceBtn"),
  objectivesBtn: $("objectivesBtn"),
  instructionsBtn: $("instructionsBtn"),
  modeBadge: $("modeBadge"),
  phase: $("phase"),
  round: $("round"),
  timer: $("timer"),
  cockpitTitle: $("cockpitTitle"),
  myRoleImage: $("myRoleImage"),
  myRoleLabel: $("myRoleLabel"),
  modeHint: $("modeHint"),
  characterChoiceLabel: $("characterChoiceLabel"),
  actionChoiceLabel: $("actionChoiceLabel"),
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
  masterEndTimeBtn: $("masterEndTimeBtn"),
  masterNextModeBtn: $("masterNextModeBtn"),
  log: $("log"),
  popup: $("statusPopup"),
  popupTitle: $("popupTitle"),
  popupMessage: $("popupMessage"),
  popupCloseBtn: $("popupCloseBtn"),
};

function show(screenId) {
  [ui.bootScreen, ui.gameScreen].forEach((s) => s?.classList.remove("active"));
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
    btn.textContent = ACTION_CONTEXT[resp] || CFG.responsibilities[resp].label;
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
    const actions = summary.actions
      .map((a) => {
        const label = CFG.responsibilities[resp].actions[a.actionId].label;
        return `<div>${label}: <b>${a.votes}</b> votos (${a.pct}%)</div>`;
      })
      .join("");

    return `<div class="card" style="margin-bottom:8px"><b>Personagem: ${CFG.responsibilities[resp].label}</b><div><small>Ação: ${ACTION_CONTEXT[resp]}</small></div><div>${actions || "Sem votos"}</div></div>`;
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
  ui.myRoleLabel.textContent = isMaster ? "Mestre (controle da rodada)" : `${roleCfg.label} (Personagem)`;
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
  ui.characterChoiceLabel.style.display = isMaster ? "none" : "block";
  ui.actionChoiceLabel.style.display = isMaster ? "none" : "block";
  ui.masterCockpitControls.style.display = isMaster ? "block" : "none";

  if (isMaster) {
    ui.masterExecuteBtn.disabled = state.gameOver;
    ui.masterExecuteBtn.textContent = "Executar tarefa";
    if (ui.masterEndTimeBtn) ui.masterEndTimeBtn.disabled = state.phase !== "VOTING" || state.gameOver;
    if (ui.masterNextModeBtn) ui.masterNextModeBtn.disabled = state.phase === "VOTING";
  }

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

async function startRoundWithStorytelling() {
  if (!isMaster || running || state.phase === "VOTING") return;
  if (!introShownInRound) {
    showPopup("Briefing da Missão", STORYTELLING_TEXT);
    introShownInRound = true;
  }
  await runTimerLoop();
}

async function forceEndVotingNow() {
  if (!isMaster || state.phase !== "VOTING") return;
  tickVoting(state, state.roundInfo.timeLeft || 0);
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  running = false;
  await publishState();
  await publishPhase();
  render();
}

async function nextMode() {
  if (!isMaster || state.phase === "VOTING") return;
  const idx = MODE_ORDER.indexOf(state.mode);
  const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  running = false;
  resetForNewMode(state, next);
  introShownInRound = false;
  masterSelectedResponsibility = "command";
  masterSelectedAction = null;
  await remove(ref(db, DB.inputs));
  await publishState();
  await publishPhase();
  render();
}

function bindUI() {
  ui.popupCloseBtn.addEventListener("click", hidePopup);
  ui.startExperienceBtn.addEventListener("click", () => show("gameScreen"));
  ui.objectivesBtn?.addEventListener("click", () => showPopup("Objetivos", OBJECTIVES_TEXT));
  ui.instructionsBtn?.addEventListener("click", () => showPopup("Instruções", INSTRUCTIONS_TEXT));

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
    if (!result.ok) {
      showPopup("Execução indisponível", result.reason || "A ação não pôde ser executada neste momento.");
      return;
    }
    await publishState();
    await publishPhase();
    render();

    if (result.failed) {
      showPopup("Missão Falhou", state.lastFailure || "Falha crítica na execução.");
      return;
    }

    if (result.completedAllResponsibilities) {
      showPopup("Missão Concluída", "Todas as responsabilidades foram executadas com sucesso: ameaça contida, negociação bem-sucedida, passageiros estabilizados e explosivo neutralizado.");
    } else {
      showPopup("Ação correta", "Execução validada com sucesso. Prossiga para a próxima responsabilidade.");
    }

    if (state.phase === "VOTING") runTimerLoop();
  });

  ui.masterEndTimeBtn?.addEventListener("click", forceEndVotingNow);
  ui.masterNextModeBtn?.addEventListener("click", nextMode);
  ui.startBtn.addEventListener("click", startRoundWithStorytelling);

  ui.resetBtn.addEventListener("click", async () => {
    if (!isMaster) return;
    if (timer) clearInterval(timer);
    running = false;
    timer = null;
    resetForNewMode(state, state.mode);
    introShownInRound = false;
    masterSelectedResponsibility = "command";
    masterSelectedAction = null;
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
  }

  show("bootScreen");
  render();
}

init().catch((err) => {
  console.error(err);
  ui.loadingStatus.textContent = "Falha ao iniciar.";
});
