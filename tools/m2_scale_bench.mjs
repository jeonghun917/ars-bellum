// Measures the 3D battle's simulation at scale (M2_SPEC section 11.2: 100 against 100 is measured three times
// in each of three scenarios; nothing has to pass, and no bottleneck is hidden). It runs the same systems in
// the same order as M2BattleRuntime's fixed tick, timing each, without drawing anything: the drawing is
// measured in the browser (tests/browser/m2-scale.spec.mjs), on whatever graphics the machine has.
//
//   node tools/m2_scale_bench.mjs [--per-side 100] [--runs 3] [--seconds 60] [--out test-results/m2-scale-sim.json]
//
// Scenarios:
//   clash   both sides attack at once (frontal push): the armies close and meet head on.
//   plans   both sides fight with battle plans (the ally with anvil and hammer; the enemy commander picks).
//   rout    as clash, then a third of each side is broken (morale 0) once they meet: rout, pursuit of the
//           field and bolts in the air together.
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { M2_CONFIG } from "../m2/M2_Config.js";
import { M2BattleState, isM2UnitAlive } from "../m2/M2_BattleState.js";
import { M2CommandQueue } from "../m2/M2_CommandQueue.js";
import { M2FormationSystem } from "../m2/M2_FormationSystem.js";
import { M2MovementSystem } from "../m2/M2_MovementSystem.js";
import { M2CombatSystem } from "../m2/M2_CombatSystem.js";
import { M2SpatialGrid } from "../m2/M2_SpatialGrid.js";
import { M2MoraleSystem } from "../m2/M2_MoraleSystem.js";
import { M2ResultSystem } from "../m2/M2_ResultSystem.js";
import { M2CollisionSystem } from "../m2/M2_CollisionSystem.js";
import { M2EnemyAI } from "../m2/M2_EnemyAI.js";
import { M2PlanSystem, setPlan } from "../m2/M2_Plans.js";
import { createRenderSnapshot } from "../m2/M2_RenderSnapshot.js";
import { createCombatProfileCatalog } from "../m2/M2_CombatProfiles.js";
import { buildScaleSnapshot, M2_SCALE_COMBAT_PROFILES } from "../m2/fixtures/m2_scale_fixture.js";
import { m2UpdateVision } from "../m2/M2_Vision.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => (value.startsWith("--") ? [...pairs, [value.slice(2), all[i + 1]]] : pairs), []));
const PER_SIDE = Number(args["per-side"] ?? 100);
const RUNS = Number(args.runs ?? 3);
const SECONDS = Number(args.seconds ?? 60);
const OUT = args.out ?? "test-results/m2-scale-sim.json";
const DT = M2_CONFIG.fixedTickMs / 1000;
const SCENARIOS = ["clash", "plans", "rout"];
const PHASES = ["vision", "orders", "formation", "movement", "grid", "collision", "combat_plan", "combat_resolve", "morale_result", "render_snapshot"];

function setup() {
  const catalog = createCombatProfileCatalog(M2_SCALE_COMBAT_PROFILES);
  const state = new M2BattleState(buildScaleSnapshot({ perSide: PER_SIDE }), catalog);
  const b = {
    state,
    queue: new M2CommandQueue(),
    formation: new M2FormationSystem(),
    movement: new M2MovementSystem({ maxSpeed: M2_CONFIG.unitMaxSpeed, arrivalEpsilon: M2_CONFIG.arrivalEpsilon }),
    grid: new M2SpatialGrid(M2_CONFIG.spatialCellSize),
    combat: new M2CombatSystem(),
    morale: new M2MoraleSystem(),
    result: new M2ResultSystem(),
    collision: new M2CollisionSystem(),
    ai: new M2EnemyAI(),
    plans: new M2PlanSystem(),
    outcome: null,
  };
  b.queue.beginBattleEpoch();
  b.formation.updateSlots(state);
  b.grid.rebuild(state);
  return b;
}

// One fixed tick, as M2BattleRuntime#fixedTick, each phase timed into `times` (ms).
function tick(b, times) {
  const n = b.state.tick + 1;
  let t = performance.now();
  const mark = (phase) => { const now = performance.now(); times[phase] = (times[phase] || 0) + (now - t); t = now; };
  const commands = b.queue.drain().commands;
  m2UpdateVision(b.state);
  mark("vision");
  for (const c of commands) if (c.type.startsWith("formation_")) b.formation.applyCommand(b.state, c);
  for (const c of commands) if (c.type === "army_set_plan") setPlan(b.state, c.sideId, c.planId, n);
  b.ai.step(b.state, n);
  b.plans.step(b.state, n);
  mark("orders");
  b.formation.updateAttackGoals(b.state);
  b.formation.updateSlots(b.state);
  mark("formation");
  b.movement.step(b.state, DT);
  mark("movement");
  b.grid.rebuild(b.state);
  mark("grid");
  b.collision.step(b.state, b.grid, DT);
  mark("collision");
  const plan = b.combat.prepareTick(b.state, b.grid, commands, DT, n);
  mark("combat_plan");
  const events = [];
  b.combat.resolveCrossbowVolleys(b.state, plan, n);
  b.combat.resolveNonPlayerContactMelee(b.state, plan, events, n);
  b.combat.progressProjectiles(b.state, plan, events);
  const living = b.state.getUnitIdsStable().filter((id) => isM2UnitAlive(b.state.getUnit(id)));
  b.combat.applyDamageEvents(b.state, events);
  mark("combat_resolve");
  const lost = living.filter((id) => !isM2UnitAlive(b.state.getUnit(id))).map((id) => {
    const u = b.state.getUnit(id);
    return { unitId: id, sideId: u.sideId, formationId: u.formationId, position: { x: u.position.x, z: u.position.z } };
  });
  b.morale.step(b.state, { newlyLostThisTick: lost, commands, processingTick: n });
  b.outcome ||= b.result.evaluate(b.state, { commands });
  mark("morale_result");
  createRenderSnapshot(b.state, { tick: n });
  mark("render_snapshot");
  b.state.markTick(n);
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

function run(scenario) {
  const b = setup();
  const allyFormations = b.state.getFormationIdsStable().filter((id) => b.state.getFormation(id).sideId === "ally");
  if (scenario === "plans") {
    b.queue.enqueue({ commandId: "plan", type: "army_set_plan", planId: "anvil_hammer" }, b.state);
  } else {
    for (const id of allyFormations) b.queue.enqueue({ commandId: `go_${id}`, type: "formation_attack", formationId: id, targetFormationId: id.replace("ally", "enemy") }, b.state);
    // The enemy too goes straight in.
    setPlan(b.state, "enemy", "frontal_push", 0);
  }
  const perTick = [];
  const phaseTotals = {};
  let broken = false;
  let peakProjectiles = 0;
  let peakRouting = 0;
  const ticks = Math.round(SECONDS * 1000 / M2_CONFIG.fixedTickMs);
  for (let i = 0; i < ticks; i += 1) {
    if (scenario === "rout" && !broken && b.combat.getObservation(b.state).attackEventCount > 0) {
      // Once they meet, a third of each side breaks.
      broken = true;
      b.state.forEachUnitStable((u) => { if (Number(u.unitId.slice(-3)) % 3 === 0) u.morale = 0; });
    }
    const times = {};
    const start = performance.now();
    tick(b, times);
    perTick.push(performance.now() - start);
    for (const [k, v] of Object.entries(times)) phaseTotals[k] = (phaseTotals[k] || 0) + v;
    peakProjectiles = Math.max(peakProjectiles, b.state.projectileCount);
    let routing = 0;
    b.state.forEachUnitStable((u) => { if (u.state === "routing") routing += 1; });
    peakRouting = Math.max(peakRouting, routing);
    if (b.outcome) break;
  }
  const sorted = [...perTick].sort((x, y) => x - y);
  const total = perTick.reduce((s, x) => s + x, 0);
  return {
    ticks: perTick.length,
    medianMs: +quantile(sorted, 0.5).toFixed(3),
    p95Ms: +quantile(sorted, 0.95).toFixed(3),
    maxMs: +sorted.at(-1).toFixed(3),
    overBudgetTicks: perTick.filter((x) => x > M2_CONFIG.fixedTickMs).length,
    phaseShare: Object.fromEntries(PHASES.map((p) => [p, +(((phaseTotals[p] || 0) / total) * 100).toFixed(1)])),
    peakProjectiles,
    peakRouting,
    outcome: b.outcome,
  };
}

const report = { format: "ars-bellum-m2-scale-sim/v1", perSide: PER_SIDE, runs: RUNS, secondsEach: SECONDS, budgetMsPerTick: M2_CONFIG.fixedTickMs, node: process.version, scenarios: {} };
for (const scenario of SCENARIOS) {
  report.scenarios[scenario] = [];
  for (let r = 0; r < RUNS; r += 1) report.scenarios[scenario].push(run(scenario));
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
for (const [scenario, runs] of Object.entries(report.scenarios)) {
  for (const r of runs) console.log(`${scenario.padEnd(6)} ticks ${String(r.ticks).padStart(5)}  median ${r.medianMs} ms  p95 ${r.p95Ms} ms  max ${r.maxMs} ms  over ${r.overBudgetTicks}  bolts<=${r.peakProjectiles} routing<=${r.peakRouting}  ${JSON.stringify(r.phaseShare)}`);
}
