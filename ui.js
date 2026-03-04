import { GAME_CONFIG as CFG } from "./config.js";
import { makeInitialState, resetRoundAccounting, adjustPostStormLimits, submitInput, resolveRound, endRound, changeAirport, formatLogForUI } from "./engine.js";

let state = makeInitialState();
let running = false;
let interval = null;

const $ = (id) => document.getElementById(id);

// Novos controles de tela e áudio
const uiScreens = {
  splash: $("splashScreen"),
  menu: $("menuScreen"),
  game: $("gameScreen"),
  chars: $("charactersScreen"),
  inst: $("instructionsScreen"),
  audio: $("bgMusic")
};

const ui = {
  modeSelect: $("modeSelect"), airportSelect: $("airportSelect"),
  startBtn: $("startBtn"), resetBtn: $("resetBtn"),
  phaseEl: $("phase"), timerEl: $("timer"),
  roleSelect: $("roleSelect"), actionSelect: $("actionSelect"), pinInput: $("pinInput"),
  submitBtn: $("submitBtn"), skipBtn: $("skipBtn"),
  routeA: $("routeA"), routeB: $("routeB"),
  roundEl: $("round"), distEl: $("dist"), targetEl: $("target"), inputsRemainingEl: $("inputsRemaining"),
  fuelEl: $("fuel"), engineEl: $("engine"), healthEl: $("health"),
  fuelBar: $("fuelBar"), engineBar: $("engineBar"), healthBar: $("healthBar"),
  blip: $("blip"), logEl: $("log"), g1Hint: $("g1Hint"),
};

// Navegação entre telas
function showScreen(screenId) {
  Object.values(uiScreens).forEach(el => { if(el && el.tagName === "DIV") el.style.display = "none"; });
  if($(screenId)) $(screenId).style.display = "flex";
}

$("splashScreen").addEventListener("click", () => {
  uiScreens.audio.play().catch(e => console.log("Áudio bloqueado pelo navegador", e));
  showScreen("menuScreen");
});

$("btnIniciar").addEventListener("click", () => showScreen("gameScreen"));
$("btnPersonagens").addEventListener("click", () => showScreen("charactersScreen"));
$("btnInstrucoes").addEventListener("click", () => showScreen("instructionsScreen"));
$("btnSair").addEventListener("click", () => showScreen("splashScreen"));
document.querySelectorAll(".btnVoltar").forEach(btn => btn.addEventListener("click", () => showScreen("menuScreen")));

function populateActions(role) {
  const acts = Object.keys(CFG.actions[role] || {});
  ui.actionSelect.innerHTML = acts.map(a => `<option value="${a}">${a}</option>`).join("");
}

function setPhase(p) { state.phase = p; ui.phaseEl.textContent = p; }
function setTimer(v) { ui.timerEl.textContent = String(v); }

// Botões sempre ativos a menos que o jogo esteja calculando o round (RESOLVE) ou acabado (END)
function enableRouteButtons(on) {
  ui.routeA.disabled = !on; ui.routeB.disabled = !on;
  ui.airportSelect.disabled = !on; ui.skipBtn.disabled = !on; ui.submitBtn.disabled = !on;
}

function updateActionHintsByMode() {
  ui.g1Hint.textContent = state.mode === "G1" ? "G1: Piloto digita PPPP-RRRR." : "";
}

function render() {
  ui.roundEl.textContent = state.round; ui.distEl.textContent = state.resources.dist; ui.targetEl.textContent = state.airportTarget;
  ui.fuelEl.textContent = state.resources.fuel; ui.engineEl.textContent = state.resources.engine; ui.healthEl.textContent = state.resources.health;

  const max = state.current.maxInputs;
  ui.inputsRemainingEl.textContent = (max === Infinity) ? "∞" : String(Math.max(0, max - state.stats.inputsAcceptedThisRound));

  const fPct = Math.max(0, Math.min(100, (state.resources.fuel / CFG.resources.initial.fuel) * 100));
  const ePct = Math.max(0, Math.min(100, (state.resources.engine / CFG.resources.initial.engine) * 100));
  const hPct = Math.max(0, Math.min(100, (state.resources.health / CFG.resources.initial.health) * 100));
  ui.fuelBar.style.width = fPct + "%"; ui.engineBar.style.width = ePct + "%"; ui.healthBar.style.width = hPct + "%";

  const req = (state.airportTarget === "A") ? CFG.airports.A.dist : CFG.airports.B.dist;
  const prog = Math.max(0, Math.min(1, state.resources.dist / req));
  ui.blip.style.left = (18 + prog * 360) + "px"; ui.blip.style.top = (72 + Math.sin(prog * Math.PI * 2) * 16) + "px";

  const items = state.log.slice(-28).map(formatLogForUI);
  ui.logEl.innerHTML = items.map(x => `<div class="${x.cls}">${x.text}</div>`).join("");
  updateActionHintsByMode();
  enableRouteButtons(state.phase !== "RESOLVE" && state.phase !== "END");
}

function stopLoop() { running = false; if (interval) { clearInterval(interval); interval = null; } }

function startLoop() {
  if (running) return;
  running = true;

  function runPhase(phaseName, seconds, next) {
    setPhase(phaseName); render();
    let t = seconds; setTimer(t);
    interval = setInterval(() => {
      t -= 1; setTimer(t);
      if (t <= 0) { clearInterval(interval); interval = null; next(); }
    }, 1000);
  }

  function beginRound() {
    resetRoundAccounting(state); adjustPostStormLimits(state); ui.airportSelect.value = state.airportTarget;
    runPhase("STATUS", CFG.timing.phases.STATUS, () => {
      runPhase("DELIB", CFG.timing.phases.DELIB, () => {
        runPhase("INPUT", CFG.timing.phases.INPUT, () => {
          runPhase("RESOLVE", CFG.timing.phases.RESOLVE, () => {
            resolveRound(state); endRound(state);
            if (state.gameOver) { setPhase("END"); render(); stopLoop(); return; }
            beginRound();
          });
        });
      });
    });
  }
  beginRound();
}

ui.modeSelect.addEventListener("change", () => { state.mode = ui.modeSelect.value; render(); });
ui.startBtn.addEventListener("click", () => startLoop());
ui.resetBtn.addEventListener("click", () => {
  stopLoop(); state = makeInitialState(); state.mode = ui.modeSelect.value;
  setPhase("STATUS"); setTimer("--"); populateActions(ui.roleSelect.value); render();
});

ui.roleSelect.addEventListener("change", () => populateActions(ui.roleSelect.value));

ui.submitBtn.addEventListener("click", () => {
  if (state.phase === "RESOLVE" || state.phase === "END") return;
  submitInput(state, { role: ui.roleSelect.value, actionId: ui.actionSelect.value, pin: ui.pinInput.value.trim(), meta: null });
  ui.pinInput.value = ""; render();
});

ui.skipBtn.addEventListener("click", () => {
  if (state.phase === "RESOLVE" || state.phase === "END") return;
  const role = ui.roleSelect.value;
  const actionId = role === "cabin" ? "none" : role === "copilot" ? "none" : role === "pilot" ? "normal" : "protect";
  submitInput(state, { role, actionId, pin: ui.pinInput.value.trim(), meta: null });
  ui.pinInput.value = ""; render();
});

ui.routeA.addEventListener("click", () => { if (state.phase !== "RESOLVE" && state.phase !== "END") changeAirport(state, "A"); ui.airportSelect.value = "A"; render(); });
ui.routeB.addEventListener("click", () => { if (state.phase !== "RESOLVE" && state.phase !== "END") changeAirport(state, "B"); ui.airportSelect.value = "B"; render(); });
ui.airportSelect.addEventListener("change", () => { if (state.phase !== "RESOLVE" && state.phase !== "END") changeAirport(state, ui.airportSelect.value); render(); });

populateActions(ui.roleSelect.value); setPhase("STATUS"); setTimer("--"); render();  engineEl: $("engine"),
  healthEl: $("health"),

  fuelBar: $("fuelBar"),
  engineBar: $("engineBar"),
  healthBar: $("healthBar"),

  blip: $("blip"),
  logEl: $("log"),
  g1Hint: $("g1Hint"),
};

function populateActions(role) {
  const acts = Object.keys(CFG.actions[role] || {});
  ui.actionSelect.innerHTML = acts.map(a => `<option value="${a}">${a}</option>`).join("");
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
  ui.airportSelect.disabled = !on;
  ui.skipBtn.disabled = !on;
}

function updateActionHintsByMode() {
  if (state.mode === "G1") {
    ui.g1Hint.textContent = "G1: Piloto digita PIN combinado PPPP-RRRR. Para ação do piloto: PPPP-PPPP. Você escolhe o PAPEL da ação no seletor.";
  } else {
    ui.g1Hint.textContent = "";
  }
}

function render() {
  ui.roundEl.textContent = state.round;
  ui.distEl.textContent = state.resources.dist;
  ui.targetEl.textContent = state.airportTarget;

  ui.fuelEl.textContent = state.resources.fuel;
  ui.engineEl.textContent = state.resources.engine;
  ui.healthEl.textContent = state.resources.health;

  const max = state.current.maxInputs;
  const rem = (max === Infinity) ? "∞" : String(Math.max(0, max - state.stats.inputsAcceptedThisRound));
  ui.inputsRemainingEl.textContent = rem;

  const fuelPct = Math.max(0, Math.min(100, (state.resources.fuel / CFG.resources.initial.fuel) * 100));
  const engPct  = Math.max(0, Math.min(100, (state.resources.engine / CFG.resources.initial.engine) * 100));
  const hpPct   = Math.max(0, Math.min(100, (state.resources.health / CFG.resources.initial.health) * 100));
  ui.fuelBar.style.width = fuelPct + "%";
  ui.engineBar.style.width = engPct + "%";
  ui.healthBar.style.width = hpPct + "%";

  const req = (state.airportTarget === "A") ? CFG.airports.A.dist : CFG.airports.B.dist;
  const prog = Math.max(0, Math.min(1, state.resources.dist / req));
  ui.blip.style.left = (18 + prog * 360) + "px";
  ui.blip.style.top = (72 + Math.sin(prog * Math.PI * 2) * 16) + "px";

  const items = state.log.slice(-28).map(formatLogForUI);
  ui.logEl.innerHTML = items.map(x => `<div class="${x.cls}">${x.text}</div>`).join("");

  updateActionHintsByMode();
  enableRouteButtons(state.phase === "INPUT");
}

function stopLoop() {
  running = false;
  if (interval) { clearInterval(interval); interval = null; }
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
      }
    }, 1000);
  }

  function beginRound() {
    resetRoundAccounting(state);
    adjustPostStormLimits(state);
    ui.airportSelect.value = state.airportTarget;

    runPhase("STATUS", CFG.timing.phases.STATUS, () => {
      runPhase("DELIB", CFG.timing.phases.DELIB, () => {
        runPhase("INPUT", state.current.inputSeconds, () => {
          runPhase("RESOLVE", CFG.timing.phases.RESOLVE, () => {
            resolveRound(state);
            endRound(state);

            if (state.gameOver) {
              setPhase("END");
              render();
              stopLoop();
              return;
            }

            beginRound();
          });
        });
      });
    });
  }

  beginRound();
}

// Events
ui.modeSelect.addEventListener("change", () => {
  state.mode = ui.modeSelect.value;
  render();
});

ui.startBtn.addEventListener("click", () => startLoop());

ui.resetBtn.addEventListener("click", () => {
  stopLoop();
  state = makeInitialState();
  state.mode = ui.modeSelect.value;
  setPhase("STATUS");
  setTimer("--");
  populateActions(ui.roleSelect.value);
  render();
});

ui.roleSelect.addEventListener("change", () => populateActions(ui.roleSelect.value));

ui.submitBtn.addEventListener("click", () => {
  if (state.phase !== "INPUT") return;

  const role = ui.roleSelect.value;
  const actionId = ui.actionSelect.value;
  const pin = ui.pinInput.value.trim();

  submitInput(state, { role, actionId, pin, meta: null });

  ui.pinInput.value = "";
  render();
});

ui.skipBtn.addEventListener("click", () => {
  if (state.phase !== "INPUT") return;

  const role = ui.roleSelect.value;
  const actionId =
    role === "cabin" ? "none" :
    role === "copilot" ? "none" :
    role === "pilot" ? "normal" :
    "protect";

  const pin = ui.pinInput.value.trim();
  submitInput(state, { role, actionId, pin, meta: null });

  ui.pinInput.value = "";
  render();
});

ui.routeA.addEventListener("click", () => {
  if (state.phase !== "INPUT") return;
  changeAirport(state, "A");
  ui.airportSelect.value = "A";
  render();
});

ui.routeB.addEventListener("click", () => {
  if (state.phase !== "INPUT") return;
  changeAirport(state, "B");
  ui.airportSelect.value = "B";
  render();
});

ui.airportSelect.addEventListener("change", () => {
  if (state.phase !== "INPUT") return;
  changeAirport(state, ui.airportSelect.value);
  render();
});

// Init
populateActions(ui.roleSelect.value);
setPhase("STATUS");
setTimer("--");
render();
