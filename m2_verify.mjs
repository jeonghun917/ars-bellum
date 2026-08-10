import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];
const result = {
  phase: "M2-1/01",
  requiredFiles: 0,
  esmSyntaxPass: 0,
  vendorHashPass: 0,
  remoteImports: [],
  forbiddenReferences: [],
  rawAnimationFrameCalls: [],
  publicApis: [],
  htmlModuleScripts: [],
  trackedRunResults: [],
  simulation: null
};

function fail(message) {
  failures.push(message);
  console.error(`FAIL: ${message}`);
}

const required = [
  "m2_prototype.html",
  "m2_prototype.css",
  "m2/M2_Bootstrap.js",
  "m2/M2_Config.js",
  "m2/M2_CombatProfiles.js",
  "m2/M2_BattleSnapshot.js",
  "m2/M2_BattleState.js",
  "m2/M2_CommandQueue.js",
  "m2/M2_SpatialGrid.js",
  "m2/M2_FormationSystem.js",
  "m2/M2_MovementSystem.js",
  "m2/M2_RenderSnapshot.js",
  "m2/M2_Diagnostics.js",
  "m2/M2_RendererThree.js",
  "m2/M2_BattleRuntime.js",
  "m2/fixtures/m2_technical_fixture_v1.js",
  "vendor/three/r184/three.module.min.js",
  "vendor/three/r184/three.core.min.js",
  "vendor/three/r184/LICENSE",
  "vendor/three/r184/MANIFEST.json"
];

for (const relative of required) {
  if (fs.existsSync(path.join(root, relative))) result.requiredFiles += 1;
  else fail(`required file missing: ${relative}`);
}

const moduleFiles = [];
function collectModules(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectModules(absolute);
    else if (entry.isFile() && entry.name.endsWith(".js")) moduleFiles.push(absolute);
  }
}
const m2Directory = path.join(root, "m2");
if (fs.existsSync(m2Directory)) collectModules(m2Directory);

const importPatterns = [
  /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
  /import\s*\(\s*["']([^"']+)["']\s*\)/g
];
const forbiddenTokens = ["GameClock", "ArsSimulationTime", "localStorage", "ArsSaveService", "ArsGameState"];

for (const absolute of moduleFiles.sort()) {
  const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
  const source = fs.readFileSync(absolute, "utf8");
  const syntax = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    input: source,
    encoding: "utf8"
  });
  if (syntax.status === 0) result.esmSyntaxPass += 1;
  else fail(`ESM syntax error: ${relative}\n${syntax.stderr || syntax.stdout}`);

  for (const pattern of importPatterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (/^(?:https?:)?\/\//i.test(specifier)) {
        result.remoteImports.push(`${relative}:${specifier}`);
        fail(`remote import forbidden: ${relative}:${specifier}`);
      }
    }
  }

  if (/requestAnimationFrame\s*\(/.test(source)) {
    result.rawAnimationFrameCalls.push(relative);
    fail(`raw requestAnimationFrame forbidden: ${relative}`);
  }

  for (const token of forbiddenTokens) {
    if (source.includes(token)) {
      result.forbiddenReferences.push(`${relative}:${token}`);
      fail(`forbidden reference: ${relative}:${token}`);
    }
  }
}

const runtimePath = path.join(root, "m2/M2_BattleRuntime.js");
const runtimeSource = fs.existsSync(runtimePath) ? fs.readFileSync(runtimePath, "utf8") : "";
if (!runtimeSource.includes("setAnimationLoop(this.#boundFrame)")) fail("animation owner start contract missing");
if (!runtimeSource.includes("setAnimationLoop(null)")) fail("animation owner dispose contract missing");
if (!runtimeSource.includes("this.#commandQueue.drain()")) fail("fixed-tick command drain contract missing");
if (!runtimeSource.includes("this.#formationSystem.updateSlots")) fail("formation tick contract missing");
if (!runtimeSource.includes("this.#movementSystem.step")) fail("movement tick contract missing");
if (!runtimeSource.includes("this.#spatialGrid.rebuild")) fail("spatial grid tick contract missing");
if (!runtimeSource.includes("createRenderSnapshot")) fail("render snapshot boundary missing");

for (const absolute of moduleFiles) {
  const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
  if (!["m2/M2_BattleRuntime.js", "m2/M2_RendererThree.js"].includes(relative)) {
    const source = fs.readFileSync(absolute, "utf8");
    if (source.includes("setAnimationLoop")) fail(`animation owner duplicate: ${relative}`);
  }
}

const htmlPath = path.join(root, "m2_prototype.html");
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const tags = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>\s*<\/script>/gi)].map((match) => match[0]);
  const scripts = tags.map((tag) => ({
    src: tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || null,
    type: tag.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] || null
  }));
  result.htmlModuleScripts = scripts.map((entry) => entry.src);
  if (scripts.length !== 1 || scripts[0].src !== "m2/M2_Bootstrap.js" || scripts[0].type !== "module") {
    fail("m2_prototype.html must load exactly one M2_Bootstrap module");
  }
  for (const forbidden of ["GameClock.js", "SimTime.js", "Campaign.js", "main.js", "BattleEngine.js", "Renderer.js", "index.html"]) {
    if (html.includes(forbidden)) fail(`M2 entry forbidden runtime load: ${forbidden}`);
  }
}

const bootstrapPath = path.join(root, "m2/M2_Bootstrap.js");
if (fs.existsSync(bootstrapPath)) {
  const source = fs.readFileSync(bootstrapPath, "utf8");
  const apiNames = [...source.matchAll(/window\.(ArsM2[A-Za-z0-9_]*)\s*=/g)].map((match) => match[1]).sort();
  result.publicApis = apiNames;
  if (JSON.stringify(apiNames) !== JSON.stringify(["ArsM2Battle", "ArsM2Diagnostics"])) {
    fail(`public API mismatch: ${apiNames.join(",")}`);
  }
}

const manifestPath = path.join(root, "vendor/three/r184/MANIFEST.json");
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.release !== "r184" || manifest.packageVersion !== "0.184.0" || manifest.runtimeNetworkImport !== false) {
    fail("Three.js vendor manifest metadata mismatch");
  }
  for (const record of manifest.files || []) {
    const absolute = path.join(root, "vendor/three/r184", record.path);
    if (!fs.existsSync(absolute)) {
      fail(`vendor manifest file missing: ${record.path}`);
      continue;
    }
    const bytes = fs.readFileSync(absolute);
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (digest !== record.sha256 || bytes.length !== record.size) fail(`vendor hash/size mismatch: ${record.path}`);
    else result.vendorHashPass += 1;
  }
}

const trackedCheck = spawnSync("git", [
  "ls-files", "--",
  "m2_ci_browser_verification_result.json",
  "m2_ci_m1_verification_result.json",
  "m2_ci_verification_result.json"
], { cwd: root, encoding: "utf8" });
if (trackedCheck.status === 0) {
  result.trackedRunResults = trackedCheck.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).sort();
  if (result.trackedRunResults.length) fail(`tracked run-result evidence prohibited: ${result.trackedRunResults.join(",")}`);
} else {
  fail(`git ls-files failed: ${trackedCheck.stderr || trackedCheck.stdout}`);
}

const simulationScript = String.raw`
import { createCombatProfileCatalog } from "./m2/M2_CombatProfiles.js";
import { M2_TECHNICAL_COMBAT_PROFILES, M2_TECHNICAL_SNAPSHOT } from "./m2/fixtures/m2_technical_fixture_v1.js";
import { validateBattleLaunchSnapshot } from "./m2/M2_BattleSnapshot.js";
import { M2BattleState } from "./m2/M2_BattleState.js";
import { M2CommandQueue } from "./m2/M2_CommandQueue.js";
import { M2FormationSystem, calculateFormationSlots } from "./m2/M2_FormationSystem.js";
import { M2MovementSystem } from "./m2/M2_MovementSystem.js";
import { M2SpatialGrid } from "./m2/M2_SpatialGrid.js";
import { createRenderSnapshot } from "./m2/M2_RenderSnapshot.js";
import { M2_CONFIG } from "./m2/M2_Config.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const catalog = createCombatProfileCatalog(M2_TECHNICAL_COMBAT_PROFILES);
const validation = validateBattleLaunchSnapshot(M2_TECHNICAL_SNAPSHOT, catalog);
assert(validation.ok, "launch_snapshot_invalid");

function makeState() {
  return new M2BattleState(validation.snapshot, catalog);
}

function makeSystems() {
  return {
    formation: new M2FormationSystem(),
    movement: new M2MovementSystem({
      maxSpeed: M2_CONFIG.unitMaxSpeed,
      arrivalEpsilon: M2_CONFIG.arrivalEpsilon
    }),
    grid: new M2SpatialGrid(M2_CONFIG.spatialCellSize)
  };
}

const state = makeState();
assert(state.unitCount === 40, "unit_count_not_40");
assert(state.formationCount >= 4, "formation_count_below_4");

const formationTypes = new Set(
  state.getFormationIdsStable().map((formationId) => state.getFormation(formationId).formationTypeId)
);
for (const requiredType of ["line", "column", "loose"]) {
  assert(formationTypes.has(requiredType), "formation_type_missing:" + requiredType);
}
for (const formationId of state.getFormationIdsStable()) {
  const formation = state.getFormation(formationId);
  assert(
    calculateFormationSlots(formation).size === formation.memberUnitIds.length,
    "formation_slot_count_mismatch:" + formationId
  );
}

const systems = makeSystems();
systems.formation.updateSlots(state);
systems.grid.rebuild(state);
assert(systems.grid.membershipCount === 40, "spatial_membership_not_40");

const commandQueue = new M2CommandQueue();
const formation = state.getFormation("ally_line");
const observedUnitId = [...formation.memberUnitIds].sort()[0];
const before = { ...state.getUnit(observedUnitId).position };
const initialOrder = state.getFormation("ally_line").order.type;

const firstReceipt = commandQueue.enqueue({
  commandId: "cmd_001",
  type: "formation_move",
  formationId: "ally_line",
  target: { x: 6, z: -2 }
}, state);
const duplicateReceipt = commandQueue.enqueue({
  commandId: "cmd_001",
  type: "formation_move",
  formationId: "ally_line",
  target: { x: 6, z: -2 }
}, state);

assert(firstReceipt.ok && firstReceipt.queued && !firstReceipt.idempotent, "command_first_receipt_invalid");
assert(duplicateReceipt.ok && !duplicateReceipt.queued && duplicateReceipt.idempotent, "command_duplicate_not_idempotent");
assert(state.getFormation("ally_line").order.type === initialOrder, "command_applied_before_tick_boundary");

for (const command of commandQueue.drain()) systems.formation.applyCommand(state, command);
systems.formation.updateSlots(state);
systems.movement.step(state, M2_CONFIG.fixedTickMs / 1000);
systems.grid.rebuild(state);
state.markTick();

const after = state.getUnit(observedUnitId).position;
assert(Math.hypot(after.x - before.x, after.z - before.z) > 0, "formation_move_did_not_move");
assert(state.getFormation("ally_line").order.type === "move", "command_not_applied_at_tick_boundary");

const renderSnapshot = createRenderSnapshot(state);
assert(renderSnapshot.activeUnits === 40 && renderSnapshot.units.length === 40, "render_snapshot_not_40");

const nearby = systems.grid.queryNearby(after.x, after.z, 20);
assert(JSON.stringify(nearby) === JSON.stringify([...nearby].sort()), "spatial_query_not_deterministic");

function deterministicRun() {
  const runState = makeState();
  const runSystems = makeSystems();
  const queue = new M2CommandQueue();
  runSystems.formation.updateSlots(runState);
  runSystems.grid.rebuild(runState);
  queue.enqueue({
    commandId: "cmd_001",
    type: "formation_move",
    formationId: "ally_line",
    target: { x: 6, z: -2 }
  }, runState);

  for (let tick = 0; tick < 24; tick += 1) {
    for (const command of queue.drain()) runSystems.formation.applyCommand(runState, command);
    runSystems.formation.updateSlots(runState);
    runSystems.movement.step(runState, M2_CONFIG.fixedTickMs / 1000);
    runSystems.grid.rebuild(runState);
    runState.markTick();
  }

  return JSON.stringify(
    runState.getSnapshot().units.map((unit) => [
      unit.unitId,
      unit.position.x,
      unit.position.z,
      unit.velocity.x,
      unit.velocity.z,
      unit.state,
      unit.revision
    ])
  );
}

assert(deterministicRun() === deterministicRun(), "determinism_mismatch");

console.log(JSON.stringify({
  status: "PASS",
  unitCount: state.unitCount,
  formationCount: state.formationCount,
  formationTypes: [...formationTypes].sort(),
  commandIdempotency: "PASS",
  fixedTickCommandApplication: "PASS",
  deterministicMovement: "PASS",
  spatialGridMembership: systems.grid.membershipCount,
  renderSnapshotUnits: renderSnapshot.activeUnits
}));
`;

const simulation = spawnSync(process.execPath, [
  "--experimental-default-type=module",
  "--input-type=module"
], {
  input: simulationScript,
  cwd: root,
  encoding: "utf8"
});
if (simulation.status !== 0) {
  fail(`simulation verification failed:\n${simulation.stderr || simulation.stdout}`);
} else {
  try {
    result.simulation = JSON.parse(simulation.stdout.trim());
  } catch (error) {
    fail(`simulation verification output invalid: ${error.message}`);
  }
}

const summary = {
  status: failures.length === 0 ? "PASS" : "FAIL",
  ...result,
  failureCount: failures.length,
  failures
};
fs.writeFileSync(path.join(root, "m2_verification_result.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
