import { GAME_CONFIG as CFG } from "./config.js";
import { makeInitialState, resetRoundAccounting, adjustPostStormLimits, submitInput, resolveRound, endRound, changeAirport, formatLogForUI } from "./engine.js";

let state = makeInitialState();
let running = false;
let interval = null;
let pendingNextRound = null;
let selectedRole = "pilot";
let selectedAction = null;

const $ = (id) => document.getElementById(id);

const storyTexts = {
  G1: "G1: só o Piloto digita no terminal. Para executar outra função use PIN combinado (PPPP-RRRR). Foque em coordenação e ordem.",
  G2: "G2: todos podem digitar, mas conflito pune fortemente. Evitem ações repetidas por função e trocas múltiplas de rota.",
  G3: "G3: cada papel atua no seu domínio com segurança. Planejem as rodadas por especialidade e acelerem a distância com consistência."
};

const uiScreens = {
  splash: $("splashScreen"),
  menu: $("menuScreen"),
  story: $("storyScreen"),
  game: $("gameScreen"),
  chars: $("charactersScreen"),
  inst: $("instructionsScreen"),
  audio: $("bgMusic"),
  audioToggle: $("audioToggle"),
  zoomOverlay: $("zoomOverlay"),
  zoomedCharacter: $("zoomedCharacter")
};

const ui = {
  modeBadge: $("modeBadge"),
  startBtn: $("startBtn"),
  resetBtn: $("resetBtn"),
  phaseEl: $("phase"),
  timerEl: $("timer"),
  actionBtn1: $("actionBtn1"),
  actionBtn2: $("actionBtn2"),
  pinInput: $("pinInput"),
  submitBtn: $("submitBtn"),
  skipBtn: $("skipBtn"),
  routeA: $("routeA"),
  routeB: $("routeB"),
  roundEl: $("round"),
  distEl: $("dist"),
  targetEl: $("target"),
  inputsRemainingEl: $("inputsRemaining"),
  stormStateEl: $("stormState"),
  fuelEl: $("fuel"),
  engineEl: $("engine"),
  healthEl: $("health"),
  fuelBar: $("fuelBar"),
  engineBar: $("engineBar"),
  healthBar: $("healthBar"),
  progressA: $("progressA"),
  progressB: $("progressB"),
  planeA: $("planeA"),
  planeB: $("planeB"),
  distToA: $("distToA"),
  distToB: $("distToB"),
  logEl: $("log"),
  g1Hint: $("g1Hint"),
  storyGuidance: $("storyGuidance"),
  storyStartBtn: $("storyStartBtn"),
  roundPopup: $("roundPopup"),
  roundPopupTitle: $("roundPopupTitle"),
  roundPopupList: $("roundPopupList"),
  roundPopupBtn: $("roundPopupBtn"),
  rolePortraits: $("rolePortraits")
};

function showScreen(screenId) {
  Object.values(uiScreens).forEach((el) => {
    if (el && el.tagName === "DIV") el.style.display = "none";
  });
  if ($(screenId)) $(screenId).style.display = "flex";
}

function updateAudioToggleUI() {
  if (!uiScreens.audio || !uiScreens.audioToggle) return;
  const muted = uiScreens.audio.muted;
  uiScreens.audioToggle.textContent = muted ? "🔇" : "🔊";
  uiScreens.audioToggle.title = muted ? "Ativar música" : "Silenciar música";
  uiScreens.audioToggle.setAttribute("aria-label", uiScreens.audioToggle.title);
}

function setupCharacterZoom() {
  if (!uiScreens.zoomOverlay || !uiScreens.zoomedCharacter) return;
  document.querySelectorAll(".char-card img").forEach((img) => {
    img.addEventListener("dblclick", () => {
      uiScreens.zoomedCharacter.src = img.src;
      uiScreens.zoomedCharacter.alt = img.alt || "Imagem ampliada";
      uiScreens.zoomOverlay.classList.add("active");
      uiScreens.zoomOverlay.setAttribute("aria-hidden", "false");
    });
  });

  uiScreens.zoomOverlay.addEventListener("click", () => {
    uiScreens.zoomOverlay.classList.remove("active");
    uiScreens.zoomOverlay.setAttribute("aria-hidden", "true");
    uiScreens.zoomedCharacter.src = "";
  });
}

function labelForAction(actionId) {
  const labels = {
    normal: "Voo normal",
    fast: "Voo rápido",
    repair: "Reparar motor",
    protect: "Proteger motor",
    stabilize: "Estabilizar cabine",
    none: "Sem ação",
    declareEmergency: "Declarar emergência"
  };
  return labels[actionId] || actionId;
}

function populateActions(role) {
  const acts = Object.keys(CFG.actions[role] || {});
    selectedAction = acts[0] || null;

  [ui.actionBtn1, ui.actionBtn2].forEach((btn, idx) => {
    if (!btn) return;
    const actionId = acts[idx];
    if (!actionId) {
      btn.style.display = "none";
      btn.dataset.actionId = "";
      btn.textContent = "";
      return;
    }
    btn.style.display = "inline-block";
    btn.dataset.actionId = actionId;
    btn.textContent = labelForAction(actionId).toUpperCase();
  });

  updateActionButtons();
}

function updateActionButtons() {
  [ui.actionBtn1, ui.actionBtn2].forEach((btn) => {
    if (!btn || !btn.dataset.actionId) return;
    btn.classList.toggle("active", btn.dataset.actionId === selectedAction);
  });
}

function setPhase(p) {
  state.phase = p;
  ui.phaseEl.textContent = p;
}

function setTimer(v) {
  ui.timerEl.textContent = String(v);
}


function enableRouteButtons(on) {
  ui.routeA.disabled = !on;
  ui.routeB.disabled = !on;
  ui.skipBtn.disabled = !on;
  ui.submitBtn.disabled = !on;
}

function updateActionHintsByMode() {
  ui.g1Hint.textContent = state.mode === "G1" ? "G1: Piloto digita PPPP-RRRR." : "";
}

function updatePortraitSelection() {
  if (!ui.rolePortraits) return;
  ui.rolePortraits.querySelectorAll("[data-role]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.role === selectedRole);
  });
}

function renderDistanceMap() {
  const aReq = CFG.airports.A.dist;
  const bReq = CFG.airports.B.dist;
  const aDist = state.routeProgress?.A ?? Math.min(state.resources.dist, aReq);
  const bDist = state.routeProgress?.B ?? Math.min(state.resources.dist, bReq);

  const aProg = Math.max(0, Math.min(100, (aDist / aReq) * 100));
  const bProg = Math.max(0, Math.min(100, (bDist / bReq) * 100));

  ui.progressA.style.width = `${aProg}%`;
  ui.progressB.style.width = `${bProg}%`;
  ui.planeA.style.left = `calc(${aProg}% - 10px)`;
  ui.planeB.style.left = `calc(${bProg}% - 10px)`;
  ui.distToA.textContent = String(Math.max(0, aReq - aDist));
  ui.distToB.textContent = String(Math.max(0, bReq - bDist));
}

function showRoundPopup(beforeRound) {
  const fuelDelta = state.resources.fuel - beforeRound.fuel;
  const engDelta = state.resources.engine - beforeRound.engine;
  const hltDelta = state.resources.health - beforeRound.health;
  const distDelta = state.resources.dist - beforeRound.dist;

  ui.roundPopupTitle.textContent = state.gameOver ? "FIM DE JOGO" : `RESUMO DA RODADA ${beforeRound.round}`;
  ui.roundPopupList.innerHTML = [
    `Distância: ${beforeRound.dist} → ${state.resources.dist} (${distDelta >= 0 ? "+" : ""}${distDelta})`,
    `Combustível: ${beforeRound.fuel} → ${state.resources.fuel} (${fuelDelta >= 0 ? "+" : ""}${fuelDelta})`,
    `Motor: ${beforeRound.engine} → ${state.resources.engine} (${engDelta >= 0 ? "+" : ""}${engDelta})`,
    `Saúde: ${beforeRound.health} → ${state.resources.health} (${hltDelta >= 0 ? "+" : ""}${hltDelta})`
  ].map((txt) => `<li>${txt}</li>`).join("");
  ui.roundPopup.classList.add("active");
}

function render() {
  ui.modeBadge.textContent = state.mode;
  ui.roundEl.textContent = state.round;
  ui.distEl.textContent = state.resources.dist;
  ui.targetEl.textContent = state.airportTarget;
  ui.fuelEl.textContent = state.resources.fuel;
  ui.engineEl.textContent = state.resources.engine;
  ui.healthEl.textContent = state.resources.health;
  if (ui.stormStateEl) {
    ui.stormStateEl.textContent = state.storm.active ? "Tempestade" : "Normal";
  }
  
  const max = state.current.maxInputs;
  ui.inputsRemainingEl.textContent = max === Infinity ? "∞" : String(Math.max(0, max - state.stats.inputsAcceptedThisRound));
  
  const fPct = Math.max(0, Math.min(100, (state.resources.fuel / CFG.resources.initial.fuel) * 100));
  const ePct = Math.max(0, Math.min(100, (state.resources.engine / CFG.resources.initial.engine) * 100));
  const hPct = Math.max(0, Math.min(100, (state.resources.health / CFG.resources.initial.health) * 100));
  ui.fuelBar.style.width = `${fPct}%`;
  ui.engineBar.style.width = `${ePct}%`;
  ui.healthBar.style.width = `${hPct}%`;
  
  renderDistanceMap();
  
  const items = state.log.slice(-28).map(formatLogForUI);
  ui.logEl.innerHTML = items.map((x) => `<div class="${x.cls}">${x.text}</div>`).join("");
  updateActionHintsByMode();
  updatePortraitSelection();
  updateActionButtons();
  enableRouteButtons(state.phase !== "RESOLVE" && state.phase !== "END");
}

function enterMenuFromSplash() {
  if (uiScreens.audio) {
    uiScreens.audio.play().catch((e) => console.log("Áudio bloqueado", e));
  }
  showScreen("menuScreen");
}

function stopLoop() {
  running = false;
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
function startLoop() {
  if (running) return;
  running = true;

  function runPhase(phaseName, seconds, next) {
 setPhase(phaseName);
    render();
    let t = seconds;
    setTimer(t);
    interval = setInterval(() => {
     t -= 1;
      setTimer(t);
      if (t <= 0) {
        clearInterval(interval);
        interval = null;
        next();
      }    }, 1000);
  }

  function beginRound() {
    resetRoundAccounting(state);
    adjustPostStormLimits(state);

    runPhase("STATUS", CFG.timing.phases.STATUS, () => {
      runPhase("DELIB", CFG.timing.phases.DELIB, () => {
        runPhase("INPUT", CFG.timing.phases.INPUT, () => {
          runPhase("RESOLVE", CFG.timing.phases.RESOLVE, () => {
            const beforeRound = {
              round: state.round,
              fuel: state.resources.fuel,
              engine: state.resources.engine,
              health: state.resources.health,
              dist: state.resources.dist
            };

            resolveRound(state);
            endRound(state);
            render();
            showRoundPopup(beforeRound);

            if (state.gameOver) {
              setPhase("END");
              render();
              stopLoop();
              return;
            }

            setTimeout(() => {
              ui.roundPopup.classList.remove("active");
            }, 2200);

            beginRound();
          });
        });
      });
    });
  }
  
  beginRound();
}

function pickStoryMode(mode) {
  state.mode = mode;
  ui.modeBadge.textContent = mode;
  if (ui.storyGuidance) ui.storyGuidance.textContent = storyTexts[mode];
  if (ui.storyStartBtn) ui.storyStartBtn.disabled = false;
  document.querySelectorAll(".group-pick").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
}

if (uiScreens.audioToggle) {
  uiScreens.audioToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!uiScreens.audio) return;
    uiScreens.audio.muted = !uiScreens.audio.muted;
    if (!uiScreens.audio.muted && uiScreens.audio.paused) {
      uiScreens.audio.play().catch(() => {});
    }
    updateAudioToggleUI();
  });
}

if (uiScreens.splash) {
  uiScreens.splash.tabIndex = 0;
  uiScreens.splash.addEventListener("click", enterMenuFromSplash);
  uiScreens.splash.addEventListener("touchend", enterMenuFromSplash);
  uiScreens.splash.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") enterMenuFromSplash();
  });
}

$("btnIniciar").addEventListener("click", () => showScreen("storyScreen"));
$("btnPersonagens").addEventListener("click", () => showScreen("charactersScreen"));
$("btnInstrucoes").addEventListener("click", () => showScreen("instructionsScreen"));
$("btnSair").addEventListener("click", () => showScreen("splashScreen"));

document.querySelectorAll(".btnVoltar").forEach((btn) => {
  btn.addEventListener("click", () => showScreen("menuScreen"));
});

document.querySelectorAll(".group-pick").forEach((btn) => {
  btn.addEventListener("click", () => pickStoryMode(btn.dataset.mode));
});

if (ui.rolePortraits) {
  ui.rolePortraits.querySelectorAll("[data-role]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedRole = btn.dataset.role;
      populateActions(selectedRole);
      render();
    });
  });
}

ui.storyStartBtn.addEventListener("click", () => {
  showScreen("gameScreen");
  if (!running) startLoop();
});

ui.roundPopupBtn.addEventListener("click", () => {
  ui.roundPopup.classList.remove("active")
});

ui.startBtn.addEventListener("click", () => startLoop());
ui.resetBtn.addEventListener("click", () => {
 stopLoop();
  state = makeInitialState();
  setPhase("STATUS");
  setTimer("--");
  selectedRole = "pilot";
  populateActions(selectedRole);
  pickStoryMode(state.mode);
  render();
});

ui.submitBtn.addEventListener("click", () => {
    if (state.phase === "RESOLVE" || state.phase === "END" || !selectedAction) return;
  submitInput(state, { role: selectedRole, actionId: selectedAction, pin: ui.pinInput.value.trim(), meta: null });
  ui.pinInput.value = "";
  render();
});

ui.skipBtn.addEventListener("click", () => {
  if (state.phase === "RESOLVE" || state.phase === "END") return;
 const role = selectedRole;
  const actionId = role === "cabin" ? "none" : role === "copilot" ? "none" : role === "pilot" ? "normal" : "protect";
  submitInput(state, { role, actionId, pin: ui.pinInput.value.trim(), meta: null });
  ui.pinInput.value = "";
  render();
});
  
[ui.actionBtn1, ui.actionBtn2].forEach((btn) => {
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (!btn.dataset.actionId) return;
    selectedAction = btn.dataset.actionId;
    render();
  });
});

ui.routeA.addEventListener("click", () => {
  if (state.phase !== "RESOLVE" && state.phase !== "END") changeAirport(state, "A");
  render();
});

ui.routeB.addEventListener("click", () => {
  if (state.phase !== "RESOLVE" && state.phase !== "END") changeAirport(state, "B");
  render();
});
setupCharacterZoom();
updateAudioToggleUI();
populateActions(selectedRole);
setPhase("STATUS");
setTimer("--");
pickStoryMode(state.mode);
render();
