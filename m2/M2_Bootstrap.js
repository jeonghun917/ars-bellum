import { M2BattleRuntime } from "./M2_BattleRuntime.js";
import { M2Diagnostics } from "./M2_Diagnostics.js";
import { M2CameraController } from "./M2_CameraController.js";
import { M2InputController } from "./M2_InputController.js";
import { createCombatProfileCatalog, M2_COMBAT_PROFILE_CONTRACT } from "./M2_CombatProfiles.js";
import { M2_TECHNICAL_COMBAT_PROFILES, M2_TECHNICAL_SNAPSHOT } from "./fixtures/m2_technical_fixture_v1.js";
import { buildScaleSnapshot } from "./fixtures/m2_scale_fixture.js";

// m2_prototype.html?scale=100: a battle of that many a side (20 to 100), to see how the battle copes on a
// phone or any machine (the diagnostics panel, ?debug, shows its frame rate). ?mixed: a battle of subtypes
// (병종: shield-bearers, pikemen, longbowmen, heavy and light horse...), 40 a side unless ?scale says otherwise.
// Without either, the 20-a-side fixture.
const PARAMS = new URLSearchParams(window.location.search);
const SCALE = Number(PARAMS.get("scale"));
const SCALED = Number.isInteger(SCALE) && SCALE >= 20 && SCALE <= 100;
const MIXED = PARAMS.has("mixed");
const LAUNCH_SNAPSHOT = SCALED || MIXED ? buildScaleSnapshot({ perSide: SCALED ? SCALE : 40, mixed: MIXED }) : M2_TECHNICAL_SNAPSHOT;
import { useSoldierModels } from "./M2_RendererThree.js";
import { loadSoldierModels } from "./M2_SoldierModels.js";

const elements = {
  canvas: document.getElementById("m2Canvas"),
  status: document.getElementById("m2Status"),
  diagnostics: document.getElementById("m2Diagnostics"),
  start: document.getElementById("m2Start"),
  pause: document.getElementById("m2Pause"),
  restart: document.getElementById("m2Restart"),
  dispose: document.getElementById("m2Dispose"),
  attack: document.getElementById("m2Attack"),
  block: document.getElementById("m2Block"),
  bow: document.getElementById("m2Bow"),
  tactical: document.getElementById("m2Tactical"),
  attackOrder: document.getElementById("m2AttackOrder"),
  rally: document.getElementById("m2Rally"),
  retreat: document.getElementById("m2Retreat"),
  line: document.getElementById("m2Line"),
  column: document.getElementById("m2Column"),
  loose: document.getElementById("m2Loose"),
  shieldWall: document.getElementById("m2ShieldWall"),
  wedge: document.getElementById("m2Wedge"),
  circle: document.getElementById("m2Circle"),
  tactic: document.getElementById("m2Tactic"),
  plan: document.getElementById("m2Plan"),
  time0: document.getElementById("m2Time0"),
  time025: document.getElementById("m2Time025"),
  time05: document.getElementById("m2Time05"),
  time1: document.getElementById("m2Time1"),
  friendlyFormation: document.getElementById("m2FriendlyFormation"),
  enemyFormation: document.getElementById("m2EnemyFormation"),
  virtualStick: document.getElementById("m2VirtualStick"),
  moraleAlly: document.getElementById("m2MoraleAlly"),
  moraleEnemy: document.getElementById("m2MoraleEnemy"),
  routingAlly: document.getElementById("m2RoutingAlly"),
  routingEnemy: document.getElementById("m2RoutingEnemy"),
  result: document.getElementById("m2Result"),
  tacticalPanel: document.getElementById("m2TacticalPanel"),
  panelToggle: document.getElementById("m2PanelToggle"),
  summaryAlly: document.getElementById("m2SummaryAlly"),
  summaryEnemy: document.getElementById("m2SummaryEnemy"),
  debugToggle: document.getElementById("m2DebugToggle")
};

// Small screens: the command panel would cover the battle, so it starts folded to one line.
const SMALL_SCREEN = "(max-width: 760px), (max-height: 500px)";

const profileCatalog = createCombatProfileCatalog(M2_TECHNICAL_COMBAT_PROFILES);
let diagnostics = null;
let runtime = null;
let cameraController = null;
let inputController = null;
let hudTimer = null;
let pagehideBound = false;

function setStatus(text) {
  if (elements.status) elements.status.textContent = text;
}

function setCommandControlsDisabled(disabled) {
  for (const element of [
    elements.attack, elements.block, elements.bow, elements.attackOrder,
    elements.line, elements.column, elements.loose, elements.shieldWall, elements.wedge, elements.circle, elements.rally, elements.retreat
  ]) {
    if (element) element.disabled = Boolean(disabled);
  }
}

function updateHud() {
  if (!diagnostics || !elements.diagnostics) return;
  const runtimeSnapshot = runtime?.getSnapshot();
  const result = runtime?.getResult() || null;
  const observation = diagnostics.getSnapshot();
  elements.diagnostics.textContent = JSON.stringify({
    ...observation,
    runtimeUnits: runtimeSnapshot?.activeUnits || 0,
    totalUnits: runtimeSnapshot?.totalUnits || 0,
    formations: runtimeSnapshot?.formationCount || 0,
    projectiles: runtimeSnapshot?.activeProjectileCount || 0,
    simulationTick: runtimeSnapshot?.tick || 0,
    battleResult: result,
    combatProfileScope: profileCatalog.sourceScope,
    combatProfiles: profileCatalog.size,
    canonicalCharacterRules: false,
    canonicalMoraleBalance: false,
    m9BridgeRequired: true
  }, null, 2);
  if (elements.tactical) elements.tactical.textContent = observation.cameraMode === "tactical" ? "3인칭" : "전술";
  if (elements.summaryAlly) elements.summaryAlly.textContent = String(Math.round(observation.moraleSummary?.ally ?? 0));
  if (elements.summaryEnemy) elements.summaryEnemy.textContent = String(Math.round(observation.moraleSummary?.enemy ?? 0));
  if (result && elements.status && elements.status.textContent === "전투 중") setStatus("전투 끝");
  if (elements.moraleAlly) elements.moraleAlly.textContent = String(observation.moraleSummary?.ally ?? 0);
  if (elements.moraleEnemy) elements.moraleEnemy.textContent = String(observation.moraleSummary?.enemy ?? 0);
  if (elements.routingAlly) elements.routingAlly.textContent = String(observation.routingCounts?.ally ?? 0);
  if (elements.routingEnemy) elements.routingEnemy.textContent = String(observation.routingCounts?.enemy ?? 0);
  if (elements.result) elements.result.textContent = result?.outcome || "—";
  setCommandControlsDisabled(result !== null);
}

function setPanelCollapsed(collapsed) {
  if (!elements.tacticalPanel) return;
  elements.tacticalPanel.classList.toggle("is-collapsed", collapsed);
  elements.panelToggle?.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

// The diagnostics panel is for development: hidden unless asked for (button, or ?debug in the address).
function setDiagnosticsVisible(visible) {
  if (elements.diagnostics) elements.diagnostics.hidden = !visible;
  elements.debugToggle?.setAttribute("aria-pressed", visible ? "true" : "false");
}

function destroyControllers() {
  if (inputController) inputController.dispose();
  if (cameraController) cameraController.dispose();
  inputController = null;
  cameraController = null;
}

function createRuntime() {
  diagnostics = new M2Diagnostics();
  runtime = new M2BattleRuntime({ canvas: elements.canvas, diagnostics, combatProfiles: profileCatalog });
  const loaded = runtime.loadSnapshot(LAUNCH_SNAPSHOT);
  if (!loaded.ok) throw new Error(`${loaded.error}:${(loaded.issues || []).join("|")}`);

  cameraController = new M2CameraController();
  inputController = new M2InputController({
    runtime,
    cameraController,
    diagnostics,
    elements
  });
  runtime.attachControllers({ cameraController, inputController });
  setStatus("준비됨");
  updateHud();
}

function start() {
  const receipt = runtime.start();
  setStatus(receipt.ok ? "전투 중" : receipt.error);
  updateHud();
  return receipt;
}

function pause() {
  const receipt = runtime.pause();
  setStatus(receipt.ok ? (runtime.getResult() ? "종료됨" : "일시정지") : receipt.error);
  updateHud();
  return receipt;
}

function restart() {
  destroyControllers();
  if (runtime) runtime.dispose();
  createRuntime();
  return start();
}

function dispose() {
  destroyControllers();
  const receipt = runtime ? runtime.dispose() : { ok: true, idempotent: true };
  setStatus("해제됨");
  updateHud();
  return receipt;
}

function loadSnapshot(snapshot) {
  const receipt = runtime.loadSnapshot(snapshot);
  if (receipt.ok) inputController?.refreshFormationLists();
  updateHud();
  return receipt;
}

// The Blender soldiers are loaded before the battle is built. If they cannot be loaded the battle still
// runs, with the simple box soldiers.
try {
  useSoldierModels(await loadSoldierModels());
} catch (error) {
  console.warn("[ARS BELLUM] soldier models not loaded; using box soldiers", error);
}

try {
  createRuntime();

  elements.start?.addEventListener("click", start);
  elements.pause?.addEventListener("click", pause);
  elements.restart?.addEventListener("click", restart);
  elements.dispose?.addEventListener("click", dispose);
  elements.panelToggle?.addEventListener("click", () => setPanelCollapsed(!elements.tacticalPanel.classList.contains("is-collapsed")));
  elements.debugToggle?.addEventListener("click", () => setDiagnosticsVisible(elements.diagnostics?.hidden ?? false));
  setPanelCollapsed(window.matchMedia?.(SMALL_SCREEN).matches ?? false);
  setDiagnosticsVisible(new URLSearchParams(window.location.search).has("debug"));

  window.ArsM2Battle = Object.freeze({
    loadSnapshot,
    start,
    pause,
    setTimeScale(scale) { const receipt = runtime.setTimeScale(scale); updateHud(); return receipt; },
    issueCommand(command) { return runtime.issueCommand(command); },
    getSnapshot() { return runtime.getSnapshot(); },
    getResult() { return runtime.getResult(); },
    dispose
  });

  window.ArsM2Diagnostics = Object.freeze({
    run() {
      return Object.freeze({
        ok: diagnostics.getSnapshot().lastError === null,
        runtime: diagnostics.getSnapshot(),
        combatProfileContract: M2_COMBAT_PROFILE_CONTRACT,
        profiles: profileCatalog.list()
      });
    },
    getSnapshot() { return diagnostics.getSnapshot(); }
  });

  hudTimer = window.setInterval(updateHud, 200);
  if (!pagehideBound) {
    pagehideBound = true;
    window.addEventListener("pagehide", () => {
      if (hudTimer !== null) window.clearInterval(hudTimer);
      dispose();
    }, { once: true });
  }
  start();
} catch (error) {
  console.error("[ARS BELLUM M2-1/03] bootstrap failed", error);
  if (diagnostics) diagnostics.markError(error);
  setStatus(`초기화 실패: ${String(error.message || error)}`);
  updateHud();
}
