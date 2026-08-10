import { M2BattleRuntime } from "./M2_BattleRuntime.js";
import { M2Diagnostics } from "./M2_Diagnostics.js";
import { createCombatProfileCatalog, M2_COMBAT_PROFILE_CONTRACT } from "./M2_CombatProfiles.js";
import { M2_TECHNICAL_COMBAT_PROFILES, M2_TECHNICAL_SNAPSHOT } from "./fixtures/m2_technical_fixture_v1.js";

const elements = {
  canvas: document.getElementById("m2Canvas"),
  status: document.getElementById("m2Status"),
  diagnostics: document.getElementById("m2Diagnostics"),
  start: document.getElementById("m2Start"),
  pause: document.getElementById("m2Pause"),
  restart: document.getElementById("m2Restart"),
  dispose: document.getElementById("m2Dispose")
};

const profileCatalog = createCombatProfileCatalog(M2_TECHNICAL_COMBAT_PROFILES);
let diagnostics = null;
let runtime = null;
let hudTimer = null;

function setStatus(text) {
  if (elements.status) elements.status.textContent = text;
}

function updateHud() {
  if (!diagnostics || !elements.diagnostics) return;
  const runtimeSnapshot = runtime?.getSnapshot();
  const snapshot = diagnostics.getSnapshot();
  elements.diagnostics.textContent = JSON.stringify({
    ...snapshot,
    runtimeUnits: runtimeSnapshot?.activeUnits || 0,
    formations: runtimeSnapshot?.formationCount || 0,
    simulationTick: runtimeSnapshot?.tick || 0,
    combatProfileScope: profileCatalog.sourceScope,
    combatProfiles: profileCatalog.size,
    canonicalCharacterRules: false,
    m9BridgeRequired: true
  }, null, 2);
}

function createRuntime() {
  diagnostics = new M2Diagnostics();
  runtime = new M2BattleRuntime({ canvas: elements.canvas, diagnostics, combatProfiles: profileCatalog });
  const loaded = runtime.loadSnapshot(M2_TECHNICAL_SNAPSHOT);
  if (!loaded.ok) throw new Error(`${loaded.error}:${(loaded.issues || []).join("|")}`);
  setStatus("준비됨 · M2-1/01 · 20v20");
  updateHud();
}

function start() {
  const receipt = runtime.start();
  setStatus(receipt.ok ? "실행 중 · 20v20 simulation core" : receipt.error);
  return receipt;
}

function pause() {
  const receipt = runtime.pause();
  setStatus(receipt.ok ? "일시정지" : receipt.error);
  return receipt;
}

function restart() {
  if (runtime) runtime.dispose();
  createRuntime();
  return start();
}

function dispose() {
  const receipt = runtime ? runtime.dispose() : { ok: true, idempotent: true };
  setStatus("해제됨");
  updateHud();
  return receipt;
}

try {
  createRuntime();

  elements.start?.addEventListener("click", start);
  elements.pause?.addEventListener("click", pause);
  elements.restart?.addEventListener("click", restart);
  elements.dispose?.addEventListener("click", dispose);

  window.ArsM2Battle = Object.freeze({
    loadSnapshot(snapshot) { return runtime.loadSnapshot(snapshot); },
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

  hudTimer = window.setInterval(updateHud, 250);
  window.addEventListener("pagehide", () => {
    if (hudTimer !== null) window.clearInterval(hudTimer);
    if (runtime) runtime.dispose();
  }, { once: true });
  start();
} catch (error) {
  console.error("[ARS BELLUM M2-1/01] bootstrap failed", error);
  if (diagnostics) diagnostics.markError(error);
  setStatus(`초기화 실패: ${String(error.message || error)}`);
  updateHud();
}
