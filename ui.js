import { GAME_CONFIG as CFG } from "./config.js";
import { makeInitialState, resetRoundAccounting, adjustPostStormLimits, submitInput, resolveRound, endRound, changeAirport, formatLogForUI } from "./engine.js";
import { PIN_TABLE } from "./pins.js";
import { db, ref, set, onValue, push, remove } from "./db.js";

const urlParams = new URLSearchParams(window.location.search);
const isMaster = urlParams.get('master') === 'true';
const myRole = urlParams.get('role') || 'pilot';

let state = makeInitialState();
let running = false;
let interval = null;
let selectedRole = isMaster ? "pilot" : myRole;
let selectedAction = null;
let pendingInputs = [];

const $ = (id) => document.getElementById(id);

const storyTexts = {
G1: "G1: Comando Centralizado. APENAS OS PILOTOS têm acesso aos comandos do terminal. Se você é de outra função, GRITE o que precisa ser feito para o Piloto!",
G2: "G2: Acesso Livre (Caos). Todos podem apertar botões. Cuidado: múltiplas ações da mesma área na mesma rodada causam dano crítico de conflito!",
G3: "G3: Domínio Estrito (MBM). O poder está com quem entende do problema. Cada especialista tem acesso apenas aos botões da sua área."
};

const uiScreens = { boot: $("bootScreen"), intro: $("introScreen"), splash: $("splashScreen"), menu: $("menuScreen"), story: $("storyScreen"), game: $("gameScreen"), chars: $("charactersScreen"), inst: $("instructionsScreen"), introVideo: $("introVideo"), audio: $("bgMusic"), audioToggle: $("audioToggle"), zoomOverlay: $("zoomOverlay"), zoomedCharacter: $("zoomedCharacter") };

const ui = { loadingStatus: $("loadingStatus"), startExperienceBtn: $("startExperienceBtn"), modeBadge: $("modeBadge"), startBtn: $("startBtn"), resetBtn: $("resetBtn"), phaseEl: $("phase"), timerEl: $("timer"), actionBtn1: $("actionBtn1"), actionBtn2: $("actionBtn2"), pinInput: $("pinInput"), submitBtn: $("submitBtn"), skipBtn: $("skipBtn"), routeA: $("routeA"), routeB: $("routeB"), roundEl: $("round"), distEl: $("dist"), targetEl: $("target"), inputsRemainingEl: $("inputsRemaining"), stormStateEl: $("stormState"), fuelEl: $("fuel"), engineEl: $("engine"), healthEl: $("health"), fuelBar: $("fuelBar"), engineBar: $("engineBar"), healthBar: $("healthBar"), progressA: $("progressA"), progressB: $("progressB"), planeA: $("planeA"), planeB: $("planeB"), distToA: $("distToA"), distToB: $("distToB"), logEl: $("log"), g1Hint: $("g1Hint"), storyGuidance: $("storyGuidance"), storyStartBtn: $("storyStartBtn"), roundPopup: $("roundPopup"), roundPopupTitle: $("roundPopupTitle"), roundPopupList: $("roundPopupList"), roundPopupBtn: $("roundPopupBtn"), rolePortraits: $("rolePortraits") };

function getBypassPin(role, action) {
const pPin = PIN_TABLE[state.mode]?.pilot;
const myPin = PIN_TABLE[state.mode]?.[role];
if (state.mode === "G1") {
if (action === "normal" || action === "fast") return ${pPin}-${pPin};
if (action === "repair" || action === "protect") return ${pPin}-${PIN_TABLE.G1.engineer};
if (action === "stabilize") return ${pPin}-${PIN_TABLE.G1.cabin};
if (action === "declareEmergency") return ${pPin}-${PIN_TABLE.G1.copilot};
return myPin;
}
return myPin;
}

if (isMaster) {
onValue(ref(db, 'inputs'), (snapshot) => {
pendingInputs = [];
snapshot.forEach(c => pendingInputs.push(c.val()));
});
} else {
onValue(ref(db, 'gameState'), (snapshot) => {
const val = snapshot.val();
if (val) { state = val; render(); }
});
onValue(ref(db, 'phaseInfo'), (snapshot) => {
const val = snapshot.val();
if (val) { ui.phaseEl.textContent = val.phase; ui.timerEl.textContent = val.timer; }
});
}

function showScreen(screenId) {
Object.values(uiScreens).forEach((el) => { if (el && el.tagName === "DIV") el.style.display = "none"; });
if ($(screenId)) $(screenId).style.display = "flex";
}

function labelForAction(actionId) {
const labels = { normal: "Voo normal", fast: "Voo rápido", repair: "Combater Invasão", protect: "Proteger Cabine", stabilize: "Acalmar Pânico", none: "Sem ação", declareEmergency: "Declarar emergência" };
return labels[actionId] || actionId;
}

function populateActions(role) {
const roleToUse = isMaster ? selectedRole : myRole;
const acts = Object.keys(CFG.actions[roleToUse] || {});
selectedAction = acts[0] || null;

[ui.actionBtn1, ui.actionBtn2].forEach((btn, idx) => {
if (!btn) return;
const actionId = acts[idx];
if (!actionId) { btn.style.display = "none"; btn.dataset.actionId = ""; btn.textContent = ""; return; }
btn.style.display = "inline-block"; btn.dataset.actionId = actionId; btn.textContent = labelForAction(actionId).toUpperCase();
});
updateActionButtons();
}

function updateActionButtons() {
[ui.actionBtn1, ui.actionBtn2].forEach((btn) => {
if (!btn || !btn.dataset.actionId) return;
btn.classList.toggle("active", btn.dataset.actionId === selectedAction);
});
}

function setPhase(p) { state.phase = p; ui.phaseEl.textContent = p; }
function setTimer(v) { ui.timerEl.textContent = String(v); }

function renderDistanceMap() {
const aReq = CFG.airports.A.dist; const bReq = CFG.airports.B.dist;
const aDist = state.routeProgress?.A ?? Math.min(state.resources.dist, aReq);
const bDist = state.routeProgress?.B ?? Math.min(state.resources.dist, bReq);
const aProg = Math.max(0, Math.min(100, (aDist / aReq) * 100)); const bProg = Math.max(0, Math.min(100, (bDist / bReq) * 100));
ui.progressA.style.width = ${aProg}%; ui.progressB.style.width = ${bProg}%;
ui.planeA.style.left = calc(${aProg}% - 10px); ui.planeB.style.left = calc(${bProg}% - 10px);
ui.distToA.textContent = String(Math.max(0, aReq - aDist)); ui.distToB.textContent = String(Math.max(0, bReq - bDist));
}

function render() {
ui.modeBadge.textContent = state.mode; ui.roundEl.textContent = state.round; ui.distEl.textContent = state.resources.dist; ui.targetEl.textContent = state.airportTarget; ui.fuelEl.textContent = state.resources.fuel; ui.engineEl.textContent = state.resources.engine; ui.healthEl.textContent = state.resources.health;

const fPct = Math.max(0, Math.min(100, (state.resources.fuel / CFG.resources.initial.fuel) * 100));
const ePct = Math.max(0, Math.min(100, (state.resources.engine / CFG.resources.initial.engine) * 100));
const hPct = Math.max(0, Math.min(100, (state.resources.health / CFG.resources.initial.health) * 100));
ui.fuelBar.style.width = ${fPct}%; ui.engineBar.style.width = ${ePct}%; ui.healthBar.style.width = ${hPct}%;
renderDistanceMap();

const items = state.log.slice(-28).map(formatLogForUI);
ui.logEl.innerHTML = items.map((x) => <div class="${x.cls}">${x.text}</div>).join("");

ui.pinInput.style.display = "none";
if (!isMaster) {
ui.startBtn.style.display = "none";
ui.resetBtn.style.display = "none";
ui.rolePortraits.style.pointerEvents = "none";
const isG1Blocked = (state.mode === "G1" && myRole !== "pilot");
ui.submitBtn.disabled = isG1Blocked || (state.phase === "RESOLVE" || state.phase === "END");
} else {
ui.rolePortraits.querySelectorAll("[data-role]").forEach((btn) => btn.classList.toggle("active", btn.dataset.role === selectedRole));
}
updateActionButtons();
}

function startLoop() {
if (running || !isMaster) return;
running = true;

function runPhase(phaseName, seconds, next) {
setPhase(phaseName);
set(ref(db, 'gameState'), state);
let t = seconds; setTimer(t);

}

function beginRound() {
resetRoundAccounting(state); adjustPostStormLimits(state);
runPhase("STATUS", CFG.timing.phases.STATUS, () => {
runPhase("DELIB", CFG.timing.phases.DELIB, () => {
runPhase("INPUT", CFG.timing.phases.INPUT, () => {
runPhase("RESOLVE", CFG.timing.phases.RESOLVE, () => {

}
beginRound();
}

$("btnIniciar").addEventListener("click", () => showScreen("storyScreen"));
ui.storyStartBtn.addEventListener("click", () => {
showScreen("gameScreen");
if (isMaster && !running) startLoop();
});

document.querySelectorAll(".group-pick").forEach((btn) => {
btn.addEventListener("click", () => {
if (!isMaster) return;
state.mode = btn.dataset.mode;
ui.modeBadge.textContent = state.mode;
ui.storyGuidance.textContent = storyTexts[state.mode];
ui.storyStartBtn.disabled = false;
document.querySelectorAll(".group-pick").forEach(b => b.classList.toggle("active", b.dataset.mode === state.mode));
set(ref(db, 'gameState'), state);
});
});

ui.submitBtn.addEventListener("click", () => {
if (state.phase === "RESOLVE" || state.phase === "END" || !selectedAction) return;
const roleToSubmit = isMaster ? selectedRole : myRole;
const autoPin = getBypassPin(roleToSubmit, selectedAction);
const payload = { role: roleToSubmit, actionId: selectedAction, pin: autoPin, meta: null };

if (isMaster) {
submitInput(state, payload); render();
} else {
push(ref(db, 'inputs'), payload);
const oldText = ui.submitBtn.textContent;
ui.submitBtn.textContent = "ENVIADO!";
setTimeout(() => ui.submitBtn.textContent = oldText, 1500);
}
});

[ui.actionBtn1, ui.actionBtn2].forEach((btn) => {
if (!btn) return;
btn.addEventListener("click", () => {
if (!btn.dataset.actionId) return;
selectedAction = btn.dataset.actionId;
render();
});
});

ui.startBtn.addEventListener("click", () => startLoop());
ui.resetBtn.addEventListener("click", () => {
if (interval) clearInterval(interval); running = false;
state = makeInitialState(); setPhase("STATUS"); setTimer("--");
set(ref(db, 'gameState'), state); remove(ref(db, 'inputs'));
render();
});
ui.roundPopupBtn.addEventListener("click", () => ui.roundPopup.classList.remove("active"));

ui.loadingStatus.textContent = "Pronto."; ui.startExperienceBtn.disabled = false;
ui.startExperienceBtn.addEventListener("click", () => showScreen("splashScreen"));
$("splashScreen").addEventListener("click", () => showScreen("menuScreen"));

populateActions(myRole); render();
