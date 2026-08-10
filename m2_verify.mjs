import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { M2_CONFIG } from "./m2/M2_Config.js";
import {
  M2_MELEE_DEFINITION,
  M2_BLOCK_DEFINITION,
  M2_BOW_DEFINITION,
  M2_PROJECTILE_DEFINITION,
  M2_FORMATION_ATTACK_DEFINITION
} from "./m2/M2_Definitions.js";
import { M2BattleState, isM2UnitActive } from "./m2/M2_BattleState.js";
import { M2CommandQueue } from "./m2/M2_CommandQueue.js";
import { M2FormationSystem, calculateFormationSlots } from "./m2/M2_FormationSystem.js";
import { M2MovementSystem } from "./m2/M2_MovementSystem.js";
import { M2CombatSystem, M2_COMBAT_INTERNALS_FOR_TEST } from "./m2/M2_CombatSystem.js";
import { M2SpatialGrid } from "./m2/M2_SpatialGrid.js";
import { createRenderSnapshot } from "./m2/M2_RenderSnapshot.js";
import { createCombatProfileCatalog } from "./m2/M2_CombatProfiles.js";
import { M2_TECHNICAL_COMBAT_PROFILES, M2_TECHNICAL_SNAPSHOT } from "./m2/fixtures/m2_technical_fixture_v1.js";

const root = process.cwd();
const failures = [];
const checks = {};
const catalog = createCombatProfileCatalog(M2_TECHNICAL_COMBAT_PROFILES);

function fail(name, detail) {
  failures.push(`${name}:${detail}`);
  checks[name] = { status: "FAIL", detail };
}

function pass(name, detail = null) {
  checks[name] = { status: "PASS", ...(detail === null ? {} : { detail }) };
}

function assertCheck(name, condition, detail = "assertion_failed") {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function gitBlobSha(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return crypto.createHash("sha1").update(header).update(bytes).digest("hex");
}

const required = [
  "m2_prototype.html", "m2_prototype.css",
  "m2/M2_Bootstrap.js", "m2/M2_Config.js", "m2/M2_Definitions.js",
  "m2/M2_CombatProfiles.js", "m2/M2_BattleSnapshot.js", "m2/M2_BattleState.js",
  "m2/M2_CommandQueue.js", "m2/M2_SpatialGrid.js", "m2/M2_FormationSystem.js",
  "m2/M2_MovementSystem.js", "m2/M2_CombatSystem.js", "m2/M2_RenderSnapshot.js",
  "m2/M2_RendererThree.js", "m2/M2_CameraController.js", "m2/M2_InputController.js",
  "m2/M2_Diagnostics.js", "m2/fixtures/m2_technical_fixture_v1.js",
  "m2_verify.mjs"
];

const missing = required.filter((relative) => !fs.existsSync(path.join(root, relative)));
assertCheck("M21-02-STATIC-003", missing.length === 0, { missing });

const moduleFiles = [];
function collectModules(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectModules(absolute);
    else if (entry.isFile() && entry.name.endsWith(".js")) moduleFiles.push(absolute);
  }
}
collectModules(path.join(root, "m2"));

let syntaxPass = 0;
const remoteImports = [];
const forbiddenReferences = [];
const rawAnimationFrameCalls = [];
const forbiddenTokens = ["GameClock", "ArsSimulationTime", "localStorage", "ArsSaveService", "ArsGameState"];
for (const absolute of moduleFiles.sort()) {
  const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
  const source = fs.readFileSync(absolute, "utf8");
  const syntax = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: source, encoding: "utf8" });
  if (syntax.status === 0) syntaxPass += 1;
  else fail("M21-02-STATIC-002", `${relative}:${syntax.stderr || syntax.stdout}`);
  for (const match of source.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)) {
    if (/^(?:https?:)?\/\//i.test(match[1])) remoteImports.push(`${relative}:${match[1]}`);
  }
  if (/requestAnimationFrame\s*\(/.test(source)) rawAnimationFrameCalls.push(relative);
  for (const token of forbiddenTokens) if (source.includes(token)) forbiddenReferences.push(`${relative}:${token}`);
}
if (!checks["M21-02-STATIC-002"]) pass("M21-02-STATIC-002", { syntaxPass, moduleCount: moduleFiles.length });
assertCheck("M21-02-STATIC-005", remoteImports.length === 0, { remoteImports });
assertCheck("M21-02-STATIC-006", rawAnimationFrameCalls.length === 0, { rawAnimationFrameCalls });
assertCheck("M21-02-STATIC-007", forbiddenReferences.length === 0, { forbiddenReferences });

const bootstrap = fs.readFileSync(path.join(root, "m2/M2_Bootstrap.js"), "utf8");
const globals = [...bootstrap.matchAll(/window\.(ArsM2[A-Za-z0-9_]*)\s*=/g)].map((m) => m[1]).sort();
assertCheck("M21-02-STATIC-008", JSON.stringify(globals) === JSON.stringify(["ArsM2Battle","ArsM2Diagnostics"]), { globals });

const html = fs.readFileSync(path.join(root, "m2_prototype.html"), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((m)=>m[1]);
assertCheck("M21-02-STATIC-011", scripts.length === 1 && scripts[0] === "m2/M2_Bootstrap.js", { scripts });
const workflowSource = fs.readFileSync(path.join(root, ".github/workflows/m2-verify.yml"), "utf8");
const b013Start = workflowSource.indexOf("// B013:");
const b014Start = workflowSource.indexOf("// B014:");
const b013Source = b013Start >= 0 && b014Start > b013Start ? workflowSource.slice(b013Start, b014Start) : "";
assertCheck(
  "LI-M2102-003-B013-TOUCH",
  b013Source.includes('pointerId: 803, pointerType: "touch"') &&
  !b013Source.includes('pointerId: 803, pointerType: "mouse"') &&
  workflowSource.includes('src="/m2_prototype.html"'),
  {
    touchRightDrag: b013Source.includes('pointerId: 803, pointerType: "touch"'),
    mouseRightDragAbsent: !b013Source.includes('pointerId: 803, pointerType: "mouse"'),
    actualPrototypeIframe: workflowSource.includes('src="/m2_prototype.html"')
  }
);

const protectedHashes = {
  "m2/M2_BattleSnapshot.js": "d0deb6bfc75065e7e03395c53eaaf81835411bb9",
  "m2/M2_CombatProfiles.js": "564cf45d895edbc01eb599cc29bf95e7139982f9",
  "m2/M2_SpatialGrid.js": "28f8ac08f2a3cac6e5f0935b5960da4a74ed47bd",
  "m2/fixtures/m2_technical_fixture_v1.js": "255dc1ebbd7779cfb6f9cac54e90cbe38eaeb84a"
};
const protectedHashResults = {};
for (const [relative, expected] of Object.entries(protectedHashes)) {
  const bytes = fs.readFileSync(path.join(root, relative));
  const actual = gitBlobSha(bytes);
  protectedHashResults[relative] = { expected, actual, pass: actual === expected };
}
assertCheck("PROTECTED_SOURCE_HASHES", Object.values(protectedHashResults).every((v)=>v.pass), protectedHashResults);

assertCheck(
  "EXACT_TEMPORARY_DEFINITIONS",
  M2_MELEE_DEFINITION.range === 1.6 &&
  M2_MELEE_DEFINITION.facingArcDegrees === 120 &&
  M2_MELEE_DEFINITION.cooldownTicks === 10 &&
  M2_MELEE_DEFINITION.baseDamage === 10 &&
  M2_BLOCK_DEFINITION.frontArcDegrees === 120 &&
  M2_BLOCK_DEFINITION.damageMultiplier === 0.4 &&
  M2_BOW_DEFINITION.cooldownTicks === 16 &&
  M2_BOW_DEFINITION.baseDamage === 12 &&
  M2_PROJECTILE_DEFINITION.speed === 12 &&
  M2_PROJECTILE_DEFINITION.maxRange === 22 &&
  M2_PROJECTILE_DEFINITION.hitRadius === 0.35 &&
  M2_PROJECTILE_DEFINITION.maxActive === 64 &&
  M2_FORMATION_ATTACK_DEFINITION.attackStopRange === 1.8,
  {
    melee: M2_MELEE_DEFINITION,
    block: M2_BLOCK_DEFINITION,
    bow: M2_BOW_DEFINITION,
    projectile: M2_PROJECTILE_DEFINITION,
    formationAttack: M2_FORMATION_ATTACK_DEFINITION
  }
);

function makeContext() {
  const state = new M2BattleState(M2_TECHNICAL_SNAPSHOT, catalog);
  const queue = new M2CommandQueue();
  queue.beginBattleEpoch();
  const formation = new M2FormationSystem();
  const movement = new M2MovementSystem({ maxSpeed: M2_CONFIG.unitMaxSpeed, arrivalEpsilon: M2_CONFIG.arrivalEpsilon });
  const grid = new M2SpatialGrid(M2_CONFIG.spatialCellSize);
  const combat = new M2CombatSystem();
  formation.updateSlots(state);
  grid.rebuild(state);
  return { state, queue, formation, movement, grid, combat, staleDropped: 0 };
}

function runTick(ctx, activeRevision = null) {
  const processingTick = ctx.state.tick + 1;
  const drained = ctx.queue.drain(activeRevision);
  ctx.staleDropped += drained.staleDropped;
  const commands = drained.commands;

  for (const command of commands) if (command.type.startsWith("formation_")) ctx.formation.applyCommand(ctx.state, command);
  ctx.formation.updateAttackGoals(ctx.state);
  ctx.formation.updateSlots(ctx.state);

  for (const command of commands) if (command.type === "player_move") ctx.movement.applyCommand(ctx.state, command);
  ctx.movement.step(ctx.state, M2_CONFIG.fixedTickMs / 1000);
  ctx.grid.rebuild(ctx.state);

  const candidatePlan = ctx.combat.prepareTick(
    ctx.state,
    ctx.grid,
    commands,
    M2_CONFIG.fixedTickMs / 1000
  );

  const damageEvents = [];
  ctx.combat.applyBlockCommands(ctx.state, commands);
  ctx.combat.resolvePlayerMelee(ctx.state, commands, candidatePlan, damageEvents);
  ctx.combat.resolveBowLaunch(ctx.state, commands, processingTick);
  ctx.combat.resolveNonPlayerContactMelee(ctx.state, candidatePlan, damageEvents, processingTick);
  ctx.combat.progressProjectiles(ctx.state, candidatePlan, damageEvents);
  const damageReceipts = ctx.combat.applyDamageEvents(ctx.state, damageEvents);
  const renderSnapshot = createRenderSnapshot(ctx.state, { tick: processingTick });
  ctx.state.markTick(processingTick);
  return { processingTick, commands, candidatePlan, damageEvents, damageReceipts, renderSnapshot, drained };
}

function placeUnit(state, unitId, x, z, heading = null) {
  const unit = state.getUnit(unitId);
  unit.position.x = x; unit.position.z = z;
  unit.previousPosition.x = x; unit.previousPosition.z = z;
  if (heading !== null) unit.heading = heading;
  unit.slotTarget = { x, z };
}

function enqueue(ctx, command) {
  return ctx.queue.enqueue(command, ctx.state);
}

// LI-M2102-001: attack_target approach authority is target formation.anchor, not active-member centroid.
{
  const ctx = makeContext();
  const source = ctx.state.getFormation("ally_line");
  const target = ctx.state.getFormation("enemy_line");
  source.anchor.x = 0; source.anchor.z = 0;
  target.anchor.x = 10; target.anchor.z = 0;
  for (const unitId of target.memberUnitIds) placeUnit(ctx.state, unitId, 20, 0, Math.PI);
  source.order = { type:"attack_target", target:null, targetFormationId:target.formationId, commandId:"li_anchor_probe" };
  ctx.formation.updateAttackGoals(ctx.state);
  assertCheck(
    "LI-M2102-001-ANCHOR-AUTHORITY",
    Math.abs(source.anchor.x - 8.2) <= 1e-9 && Math.abs(source.anchor.z) <= 1e-9,
    { sourceAnchor:clone(source.anchor), targetAnchor:clone(target.anchor), displacedTargetMemberX:20, requiredX:8.2 }
  );
}

// LI-M2102-002: source-level phase conformance. All spatial queries belong to prepareTick candidate collection;
// phase-6 resolution methods consume candidatePlan and perform no queryNearby calls.
{
  const runtimeSource = fs.readFileSync(path.join(root, "m2/M2_BattleRuntime.js"), "utf8");
  const combatSource = fs.readFileSync(path.join(root, "m2/M2_CombatSystem.js"), "utf8");
  const phase4 = runtimeSource.indexOf("this.#spatialGrid.rebuild(this.#battleState)");
  const phase5 = runtimeSource.indexOf("const candidatePlan = this.#combatSystem.prepareTick");
  const phase6Player = runtimeSource.indexOf("resolvePlayerMelee(this.#battleState, commands, candidatePlan");
  const phase6Npc = runtimeSource.indexOf("resolveNonPlayerContactMelee(this.#battleState, candidatePlan");
  const phase6Projectile = runtimeSource.indexOf("progressProjectiles(this.#battleState, candidatePlan");
  const prepareStart = combatSource.indexOf("prepareTick(battleState, spatialGrid, commands, deltaSeconds)");
  const applyBlockStart = combatSource.indexOf("applyBlockCommands(battleState, commands)");
  const prepareBody = combatSource.slice(prepareStart, applyBlockStart);
  const playerResolveStart = combatSource.indexOf("resolvePlayerMelee(");
  const bowStart = combatSource.indexOf("resolveBowLaunch(");
  const npcResolveStart = combatSource.indexOf("resolveNonPlayerContactMelee(");
  const projectileResolveStart = combatSource.indexOf("progressProjectiles(");
  const damageStart = combatSource.indexOf("applyDamageEvents(");
  const playerResolveBody = combatSource.slice(playerResolveStart, bowStart);
  const npcResolveBody = combatSource.slice(npcResolveStart, projectileResolveStart);
  const projectileResolveBody = combatSource.slice(projectileResolveStart, damageStart);
  assertCheck(
    "LI-M2102-002-PHASE-ORDER",
    phase4 >= 0 && phase5 > phase4 &&
    phase6Player > phase5 && phase6Npc > phase6Player && phase6Projectile > phase6Npc &&
    prepareBody.includes("collectMeleeCandidateFacts(") &&
    prepareBody.includes("collectContactCandidateFacts(") &&
    prepareBody.includes("collectProjectileStepFacts(") &&
    (combatSource.match(/spatialGrid\.queryNearby\(/g) || []).length === 3 &&
    !playerResolveBody.includes("queryNearby(") &&
    !npcResolveBody.includes("queryNearby(") &&
    !projectileResolveBody.includes("queryNearby("),
    {
      phase4, phase5, phase6Player, phase6Npc, phase6Projectile,
      phase5CallsMeleeCollector:prepareBody.includes("collectMeleeCandidateFacts("),
      phase5CallsContactCollector:prepareBody.includes("collectContactCandidateFacts("),
      phase5CallsProjectileCollector:prepareBody.includes("collectProjectileStepFacts("),
      spatialQueryCallCount:(combatSource.match(/spatialGrid\.queryNearby\(/g) || []).length,
      playerResolveHasSpatialQuery:playerResolveBody.includes("queryNearby("),
      npcResolveHasSpatialQuery:npcResolveBody.includes("queryNearby("),
      projectileResolveHasSpatialQuery:projectileResolveBody.includes("queryNearby(")
    }
  );
}

// SIM-001
{
  const ctx = makeContext();
  assertCheck("M21-02-SIM-001", ctx.state.unitCount === 40, { unitCount: ctx.state.unitCount });
}

// SIM-002
{
  const ctx = makeContext();
  const id = ctx.state.playerCharacterId;
  const before = clone(ctx.state.getUnit(id).position);
  enqueue(ctx, { commandId:"sim_move_001", type:"player_move", actorUnitId:id, move:{x:1,z:0} });
  const beforeTick = clone(ctx.state.getUnit(id).position);
  runTick(ctx);
  const after = clone(ctx.state.getUnit(id).position);
  assertCheck("M21-02-SIM-002", JSON.stringify(before)===JSON.stringify(beforeTick) && after.x > before.x, { before, after });
}

// SIM-003 melee valid
{
  const ctx = makeContext();
  const player = ctx.state.getUnit(ctx.state.playerCharacterId);
  const enemy = ctx.state.getUnit("m2_fixture_enemy_01");
  placeUnit(ctx.state, player.unitId, 0, 0, 0);
  placeUnit(ctx.state, enemy.unitId, 0, 1, Math.PI);
  ctx.grid.rebuild(ctx.state);
  const before = enemy.hp;
  enqueue(ctx, { commandId:"sim_melee_001", type:"player_melee_attack", actorUnitId:player.unitId, aimHeading:0 });
  runTick(ctx);
  assertCheck("M21-02-SIM-003", enemy.hp === before - 10, { before, after: enemy.hp });
}

// SIM-004 cooldown
{
  const ctx = makeContext();
  const player = ctx.state.getUnit(ctx.state.playerCharacterId);
  const enemy = ctx.state.getUnit("m2_fixture_enemy_01");
  placeUnit(ctx.state, player.unitId, 0, 0, 0);
  placeUnit(ctx.state, enemy.unitId, 0, 1, Math.PI);
  ctx.grid.rebuild(ctx.state);
  enqueue(ctx, { commandId:"sim_cd_001", type:"player_melee_attack", actorUnitId:player.unitId, aimHeading:0 });
  runTick(ctx);
  const afterFirst = enemy.hp;
  enqueue(ctx, { commandId:"sim_cd_002", type:"player_melee_attack", actorUnitId:player.unitId, aimHeading:0 });
  runTick(ctx);
  assertCheck("M21-02-SIM-004", enemy.hp === afterFirst && player.attackCooldownTicks === 9, { hp:enemy.hp, cooldown:player.attackCooldownTicks });
}

// SIM-005 duplicate damage
{
  const ctx = makeContext();
  const target = ctx.state.getUnit("m2_fixture_enemy_01");
  const event = { damageEventId:"melee:dup:test", sourceUnitId:ctx.state.playerCharacterId, targetUnitId:target.unitId, damage:10 };
  const first = ctx.state.applyDamageEvent(event);
  const hp = target.hp;
  const second = ctx.state.applyDamageEvent(event);
  assertCheck("M21-02-SIM-005", first.damage===10 && second.idempotent===true && target.hp===hp, { first, second });
}

// SIM-006 friendly fire
{
  const ctx = makeContext();
  const ally = ctx.state.getUnit("m2_fixture_ally_02");
  const before = ally.hp;
  const receipts = ctx.combat.applyDamageEvents(ctx.state, [{
    damageEventId:"friendly:test", sourceUnitId:ctx.state.playerCharacterId, targetUnitId:ally.unitId, damage:10
  }]);
  assertCheck("M21-02-SIM-006", ally.hp===before && receipts[0].friendlyFireRejected===true, receipts[0]);
}

// SIM-007 block
{
  const ctx = makeContext();
  const target = ctx.state.getUnit(ctx.state.playerCharacterId);
  placeUnit(ctx.state, target.unitId, 0, 0, 0);
  target.blocking = false;
  const unblocked = M2_COMBAT_INTERNALS_FOR_TEST.damageAfterBlock(target, {x:0,z:1}, 10);
  target.blocking = true;
  const front = M2_COMBAT_INTERNALS_FOR_TEST.damageAfterBlock(target, {x:0,z:1}, 10);
  const rear = M2_COMBAT_INTERNALS_FOR_TEST.damageAfterBlock(target, {x:0,z:-1}, 10);
  assertCheck("M21-02-SIM-007", unblocked===10 && front===4 && rear===10, { unblocked, front, rear, authoritative:"unit.blocking" });
}

// SIM-008 bow launch + deterministic seed
{
  const ctxA = makeContext();
  const ctxB = makeContext();
  const playerA = ctxA.state.getUnit(ctxA.state.playerCharacterId);
  const playerB = ctxB.state.getUnit(ctxB.state.playerCharacterId);
  placeUnit(ctxA.state, playerA.unitId, 0, 0, 0);
  placeUnit(ctxB.state, playerB.unitId, 0, 0, 0);
  const cmd={ commandId:"sim_bow_001", type:"player_bow_fire", actorUnitId:playerA.unitId, aimHeading:0 };
  enqueue(ctxA,cmd); enqueue(ctxB,{...cmd,actorUnitId:playerB.unitId});
  const before=ctxA.state.projectileCount;
  runTick(ctxA); runTick(ctxB);
  const pa=ctxA.state.getProjectile("projectile:sim_bow_001");
  const pb=ctxB.state.getProjectile("projectile:sim_bow_001");
  assertCheck("M21-02-SIM-008", before===0 && pa && pb && pa.launchSeed===pb.launchSeed, { launchSeed:pa?.launchSeed, projectileCount:ctxA.state.projectileCount });
}

// SIM-009 projectile hit/progression
{
  const ctx = makeContext();
  const player=ctx.state.getUnit(ctx.state.playerCharacterId);
  const enemy=ctx.state.getUnit("m2_fixture_enemy_01");
  placeUnit(ctx.state,player.unitId,0,0,0);
  placeUnit(ctx.state,enemy.unitId,0,0.45,Math.PI);
  ctx.grid.rebuild(ctx.state);
  const before=enemy.hp;
  enqueue(ctx,{commandId:"sim_arrow_hit",type:"player_bow_fire",actorUnitId:player.unitId,aimHeading:0});
  runTick(ctx);
  assertCheck("M21-02-SIM-009", enemy.hp < before && ctx.state.getProjectile("projectile:sim_arrow_hit")===null, { before, after:enemy.hp });
}

// SIM-010 projectile duplicate damage
{
  const ctx=makeContext();
  const target=ctx.state.getUnit("m2_fixture_enemy_01");
  const event={damageEventId:"projectile:projectile:test:"+target.unitId,sourceUnitId:ctx.state.playerCharacterId,targetUnitId:target.unitId,damage:12};
  const first=ctx.state.applyDamageEvent(event); const hp=target.hp; const second=ctx.state.applyDamageEvent(event);
  assertCheck("M21-02-SIM-010", first.damage===12 && second.idempotent===true && target.hp===hp, {first,second});
}

// SIM-011 projectile cap
{
  const ctx=makeContext();
  const player=ctx.state.getUnit(ctx.state.playerCharacterId);
  for(let i=0;i<M2_PROJECTILE_DEFINITION.maxActive;i+=1){
    ctx.state.addProjectile({
      projectileId:`projectile:cap_${String(i).padStart(2,"0")}`, projectileTypeId:"m2_test_arrow",
      ownerUnitId:player.unitId, sideId:player.sideId, launchSeed:i,
      position:{x:100+i,y:1,z:100}, previousPosition:{x:100+i,y:1,z:100},
      direction:{x:1,z:0}, speed:12, remainingRange:22, damage:12, revision:0
    });
  }
  enqueue(ctx,{commandId:"sim_cap_extra",type:"player_bow_fire",actorUnitId:player.unitId,aimHeading:0});
  runTick(ctx);
  const obs=ctx.combat.getObservation(ctx.state);
  assertCheck("M21-02-SIM-011", obs.projectileOverflowCount===1 && obs.projectileLaunchCount===0, obs);
}

// SIM-012 formation attack
{
  const ctx=makeContext();
  const formation=ctx.state.getFormation("ally_line");
  const before=clone(formation.order);
  enqueue(ctx,{commandId:"sim_form_attack",type:"formation_attack",formationId:"ally_line",targetFormationId:"enemy_line"});
  const preTick=clone(formation.order);
  runTick(ctx);
  const dist=Math.hypot(
    ctx.state.getFormation("enemy_line").anchor.x-formation.anchor.x,
    ctx.state.getFormation("enemy_line").anchor.z-formation.anchor.z
  );
  assertCheck("M21-02-SIM-012", before.type==="hold" && preTick.type==="hold" && formation.order.type==="attack_target" && formation.order.targetFormationId==="enemy_line" && dist>=1.79, {order:formation.order,distance:dist});
}

// SIM-013 formation types reproducible
{
  let ok=true; const details={};
  for(const type of ["line","column","loose"]){
    const one=makeContext(); const two=makeContext();
    enqueue(one,{commandId:`type_${type}_1`,type:"formation_set_type",formationId:"ally_line",formationTypeId:type});
    enqueue(two,{commandId:`type_${type}_1`,type:"formation_set_type",formationId:"ally_line",formationTypeId:type});
    runTick(one); runTick(two);
    const slots1=one.state.getFormation("ally_line").memberUnitIds.sort().map(id=>({id,target:one.state.getUnit(id).slotTarget}));
    const slots2=two.state.getFormation("ally_line").memberUnitIds.sort().map(id=>({id,target:two.state.getUnit(id).slotTarget}));
    details[type]=slots1;
    if(JSON.stringify(slots1)!==JSON.stringify(slots2) || one.state.getFormation("ally_line").formationTypeId!==type) ok=false;
  }
  assertCheck("M21-02-SIM-013",ok,details);
}

// SIM-014 stale revision
{
  const ctx=makeContext();
  const player=ctx.state.getUnit(ctx.state.playerCharacterId);
  const before=clone(player.position);
  enqueue(ctx,{commandId:"stale_3",type:"player_move",inputContextRevision:3,actorUnitId:player.unitId,move:{x:1,z:0}});
  runTick(ctx,4);
  assertCheck("M21-02-SIM-014",ctx.staleDropped===1 && JSON.stringify(before)===JSON.stringify(player.position),{staleDropped:ctx.staleDropped});
}

// SIM-015 reproducibility
function deterministicTrace() {
  const ctx=makeContext();
  const player=ctx.state.getUnit(ctx.state.playerCharacterId);
  placeUnit(ctx.state,player.unitId,0,0,0);
  const enemy=ctx.state.getUnit("m2_fixture_enemy_01");
  placeUnit(ctx.state,enemy.unitId,0,1,Math.PI);
  ctx.grid.rebuild(ctx.state);
  enqueue(ctx,{commandId:"trace_move",type:"player_move",actorUnitId:player.unitId,move:{x:0.5,z:0}});
  runTick(ctx);
  player.directMoveIntent={x:0,z:0};
  enqueue(ctx,{commandId:"trace_melee",type:"player_melee_attack",actorUnitId:player.unitId,aimHeading:0});
  runTick(ctx);
  enqueue(ctx,{commandId:"trace_type",type:"formation_set_type",formationId:"ally_line",formationTypeId:"column"});
  runTick(ctx);
  const s=ctx.state.getSnapshot(), o=ctx.combat.getObservation(ctx.state);
  return {
    units:s.units.map(u=>({unitId:u.unitId,hp:u.hp,state:u.state,position:u.position})),
    formations:s.formations.map(f=>({formationId:f.formationId,formationTypeId:f.formationTypeId,order:f.order})),
    projectiles:s.projectiles,
    projectileLaunchCount:o.projectileLaunchCount,
    projectileHitCount:o.projectileHitCount,
    appliedDamageEventCount:s.appliedDamageEventCount
  };
}
{
  const a=deterministicTrace(),b=deterministicTrace();
  assertCheck("M21-02-SIM-015",JSON.stringify(a)===JSON.stringify(b),{equal:JSON.stringify(a)===JSON.stringify(b)});
}

// SIM-016 incapacitated exclusion
{
  const ctx=makeContext();
  const unit=ctx.state.getUnit("m2_fixture_ally_02");
  unit.hp=0; unit.state="incapacitated"; unit.directMoveIntent={x:1,z:0};
  const before=clone(unit.position);
  ctx.formation.updateSlots(ctx.state); ctx.movement.step(ctx.state,0.05); ctx.grid.rebuild(ctx.state);
  const slots=calculateFormationSlots(ctx.state.getFormation(unit.formationId),ctx.state.getActiveFormationMemberIds(ctx.state.getFormation(unit.formationId)));
  assertCheck("M21-02-SIM-016",JSON.stringify(before)===JSON.stringify(unit.position) && !slots.has(unit.unitId) && !isM2UnitActive(unit),{before,after:unit.position,activeSlot:slots.has(unit.unitId)});
}

// SIM-017 projectile tie-break
function tieBreakTarget(){
  const ctx=makeContext();
  const player=ctx.state.getUnit(ctx.state.playerCharacterId);
  placeUnit(ctx.state,player.unitId,0,0,0);
  const a=ctx.state.getUnit("m2_fixture_enemy_01");
  const b=ctx.state.getUnit("m2_fixture_enemy_02");
  placeUnit(ctx.state,a.unitId,0,0.4,Math.PI);
  placeUnit(ctx.state,b.unitId,0,0.4,Math.PI);
  ctx.grid.rebuild(ctx.state);
  ctx.state.addProjectile({
    projectileId:"projectile:tie",projectileTypeId:"m2_test_arrow",ownerUnitId:player.unitId,sideId:"ally",launchSeed:1,
    position:{x:0,y:1,z:0},previousPosition:{x:0,y:1,z:0},direction:{x:0,z:1},speed:12,remainingRange:22,damage:12,revision:0
  });
  const plan=ctx.combat.prepareTick(ctx.state,ctx.grid,[],0.05);
  const damage=[]; ctx.combat.progressProjectiles(ctx.state,plan,damage);
  return damage[0]?.targetUnitId||null;
}
{
  const a=tieBreakTarget(),b=tieBreakTarget();
  assertCheck("M21-02-SIM-017",a==="m2_fixture_enemy_01" && a===b,{selected:a,repeat:b});
}

// SIM-018 command epoch
{
  const ctx=makeContext();
  const cmd={commandId:"cmd_epoch_001",type:"formation_hold",formationId:"ally_line"};
  const first=enqueue(ctx,cmd); const dup=enqueue(ctx,cmd);
  // context switch does not reset seen
  ctx.queue.drain(4);
  const afterContext=enqueue(ctx,cmd);
  // failed load would not call beginBattleEpoch; still duplicate
  const afterFailedLoad=enqueue(ctx,cmd);
  ctx.queue.beginBattleEpoch();
  const newEpoch=enqueue(ctx,cmd);
  assertCheck("M21-02-SIM-018",first.queued===true&&dup.idempotent===true&&afterContext.idempotent===true&&afterFailedLoad.idempotent===true&&newEpoch.queued===true,{first,dup,afterContext,afterFailedLoad,newEpoch});
}

// SIM-019 cooldown exact phase
{
  const ctx=makeContext();
  const player=ctx.state.getUnit(ctx.state.playerCharacterId);
  const enemy=ctx.state.getUnit("m2_fixture_enemy_01");
  placeUnit(ctx.state,player.unitId,0,0,0); placeUnit(ctx.state,enemy.unitId,0,1,Math.PI); ctx.grid.rebuild(ctx.state);
  enqueue(ctx,{commandId:"cdloc_1",type:"player_melee_attack",actorUnitId:player.unitId,aimHeading:0});
  runTick(ctx);
  const attackTick=player.attackCooldownTicks;
  runTick(ctx);
  const nextTick=player.attackCooldownTicks;
  assertCheck("M21-02-SIM-019",attackTick===10&&nextTick===9,{attackTick,nextTick});
}

const result = {
  status: failures.length ? "FAIL" : "PASS",
  phase: "M2-1/02",
  requiredFiles: required.length,
  esmSyntaxPass: syntaxPass,
  publicApis: globals,
  remoteImports,
  forbiddenReferences,
  rawAnimationFrameCalls,
  protectedHashResults,
  checks,
  failureCount: failures.length,
  failures
};

fs.writeFileSync(path.join(root, "m2_verification_result.json"), JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));
process.exit(failures.length ? 1 : 0);
