import { M2BattleRuntime } from "./M2_BattleRuntime.js";
import { M2Diagnostics } from "./M2_Diagnostics.js";
import { M2CameraController } from "./M2_CameraController.js";
import { M2InputController } from "./M2_InputController.js";
import { createCombatProfileCatalog, M2_COMBAT_PROFILE_CONTRACT } from "./M2_CombatProfiles.js";
import { M2_TECHNICAL_COMBAT_PROFILES, M2_TECHNICAL_SNAPSHOT } from "./fixtures/m2_technical_fixture_v1.js";

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
  line: document.getElementById("m2Line"),
  column: document.getElementById("m2Column"),
  loose: document.getElementById("m2Loose"),
  time0: document.getElementById("m2Time0"),
  time025: document.getElementById("m2Time025"),
  time05: document.getElementById("m2Time05"),
  time1: document.getElementById("m2Time1"),
  friendlyFormation: document.getElementById("m2FriendlyFormation"),
  enemyFormation: document.getElementById("m2EnemyFormation"),
  virtualStick: document.getElementById("m2VirtualStick")
};

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

function updateHud() {
  if (!diagnostics || !elements.diagnostics) return;
  const runtimeSnapshot = runtime?.getSnapshot();
  const observation = diagnostics.getSnapshot();
  elements.diagnostics.textContent = JSON.stringify({
    ...observation,
    runtimeUnits: runtimeSnapshot?.activeUnits || 0,
    totalUnits: runtimeSnapshot?.totalUnits || 0,
    formations: runtimeSnapshot?.formationCount || 0,
    projectiles: runtimeSnapshot?.activeProjectileCount || 0,
    simulationTick: runtimeSnapshot?.tick || 0,
    combatProfileScope: profileCatalog.sourceScope,
    combatProfiles: profileCatalog.size,
    canonicalCharacterRules: false,
    m9BridgeRequired: true
  }, null, 2);
  if (elements.tactical) elements.tactical.textContent = observation.cameraMode === "tactical" ? "3인칭" : "전술";
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
  const loaded = runtime.loadSnapshot(M2_TECHNICAL_SNAPSHOT);
  if (!loaded.ok) throw new Error(`${loaded.error}:${(loaded.issues || []).join("|")}`);

  cameraController = new M2CameraController();
  inputController = new M2InputController({
    runtime,
    cameraController,
    diagnostics,
    elements
  });
  runtime.attachControllers({ cameraController, inputController });
  setStatus("준비됨 · M2-1/02 · PLAYER COMBAT / CAMERA / INPUT");
  updateHud();
}

function start() {
  const receipt = runtime.start();
  setStatus(receipt.ok ? "실행 중 · M2-1/02 functional slice" : receipt.error);
  return receipt;
}

function pause() {
  const receipt = runtime.pause();
  setStatus(receipt.ok ? "일시정지" : receipt.error);
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
  return receipt;
}

try {
  createRuntime();

  elements.start?.addEventListener("click", start);
  elements.pause?.addEventListener("click", pause);
  elements.restart?.addEventListener("click", restart);
  elements.dispose?.addEventListener("click", dispose);

  window.ArsM2Battle = Object.freeze({
    loadSnapshot,
    start,
    pause,
    setTimeScale(scale) { return runtime.setTimeScale(scale); },
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
  console.error("[ARS BELLUM M2-1/02] bootstrap failed", error);
  if (diagnostics) diagnostics.markError(error);
  setStatus(`초기화 실패: ${String(error.message || error)}`);
  updateHud();
}
