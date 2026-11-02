// The 3D battle simulation without a screen, for the unit tests: the same systems in the same order as
// M2BattleRuntime's fixed tick.
import { m2UpdateVision } from '../../m2/M2_Vision.js';
import assert from 'node:assert/strict';
import { M2_CONFIG } from '../../m2/M2_Config.js';
import { M2BattleState, isM2UnitActive, isM2UnitAlive } from '../../m2/M2_BattleState.js';
import { M2CommandQueue } from '../../m2/M2_CommandQueue.js';
import { M2FormationSystem } from '../../m2/M2_FormationSystem.js';
import { M2MovementSystem } from '../../m2/M2_MovementSystem.js';
import { M2CombatSystem } from '../../m2/M2_CombatSystem.js';
import { M2SpatialGrid } from '../../m2/M2_SpatialGrid.js';
import { M2MoraleSystem } from '../../m2/M2_MoraleSystem.js';
import { createCombatProfileCatalog } from '../../m2/M2_CombatProfiles.js';
import { M2EnemyAI } from '../../m2/M2_EnemyAI.js';
import { M2ResultSystem } from '../../m2/M2_ResultSystem.js';
import { M2CollisionSystem } from '../../m2/M2_CollisionSystem.js';
import { M2PlanSystem, setPlan } from '../../m2/M2_Plans.js';
import { M2_TECHNICAL_COMBAT_PROFILES, M2_TECHNICAL_SNAPSHOT } from '../../m2/fixtures/m2_technical_fixture_v1.js';

const DT = M2_CONFIG.fixedTickMs / 1000;

// A battle with the enemy commander (M2_EnemyAI.js) when withAI is true, and the player's hero carrying
// heroSheet (M2_HeroLoadout.js) and formations' commanders commanderSheets (M2_Commanders.js) when given;
// unitTypes ({ formationId: subtype }) makes formations subtypes (병종, M2_UnitKinds.js), and formations adds
// fields to formations of the snapshot.
export function battle({ withAI = false, heroSheet = null, commanderSheets = null, unitTypes = null, formations = null } = {}) {
  const snapshot = { ...M2_TECHNICAL_SNAPSHOT, ...(heroSheet ? { heroSheet } : {}), ...(commanderSheets ? { commanderSheets } : {}) };
  if (unitTypes) snapshot.formations = snapshot.formations.map((f) => (unitTypes[f.formationId] ? { ...f, unitTypeId: unitTypes[f.formationId] } : f));
  // formations ({ formationId: fields }): more fields for formations of the snapshot (armorId, helmId, pursuit...).
  if (formations) snapshot.formations = snapshot.formations.map((f) => ({ ...f, ...(formations[f.formationId] || {}) }));
  const state = new M2BattleState(snapshot, createCombatProfileCatalog(M2_TECHNICAL_COMBAT_PROFILES));
  const queue = new M2CommandQueue();
  queue.beginBattleEpoch();
  const b = {
    state, queue,
    formation: new M2FormationSystem(),
    movement: new M2MovementSystem({ maxSpeed: M2_CONFIG.unitMaxSpeed, arrivalEpsilon: M2_CONFIG.arrivalEpsilon }),
    grid: new M2SpatialGrid(M2_CONFIG.spatialCellSize),
    combat: new M2CombatSystem(),
    morale: new M2MoraleSystem(),
    ai: withAI ? new M2EnemyAI() : null,
    result: new M2ResultSystem(),
    collision: new M2CollisionSystem(),
    plans: new M2PlanSystem(),
    outcome: null,
    bolts: [],
    events: [],
  };
  b.formation.updateSlots(state);
  state.forEachUnitStable((u) => { if (!u.slotTarget) return; u.position.x = u.previousPosition.x = u.slotTarget.x; u.position.z = u.previousPosition.z = u.slotTarget.z; });
  b.grid.rebuild(state);
  return b;
}

// One fixed tick, the systems in the same order as M2BattleRuntime's #fixedTick.
export function tick(b) {
  const n = b.state.tick + 1;
  const commands = b.queue.drain().commands;
  m2UpdateVision(b.state);
  for (const c of commands) if (c.type.startsWith('formation_')) b.formation.applyCommand(b.state, c);
  for (const c of commands) if (c.type === 'army_set_plan') setPlan(b.state, c.sideId, c.planId, n);
  b.ai?.step(b.state, n);
  b.plans.step(b.state, n);
  b.formation.updateAttackGoals(b.state);
  b.formation.updateSlots(b.state);
  for (const c of commands) if (c.type === 'player_move') b.movement.applyCommand(b.state, c);
  b.movement.step(b.state, DT);
  b.grid.rebuild(b.state);
  b.collision.step(b.state, b.grid, DT);
  const plan = b.combat.prepareTick(b.state, b.grid, commands, DT, n);
  const events = [];
  b.combat.applyBlockCommands(b.state, commands);
  b.combat.resolvePlayerMelee(b.state, commands, plan, events);
  b.combat.resolveBowLaunch(b.state, commands, n);
  b.combat.resolveCrossbowVolleys(b.state, plan, n);
  // Every bolt shot this tick, with whose it is and whom it was aimed at.
  for (const id of b.state.getProjectileIdsStable()) {
    if (!id.startsWith(`bolt:${String(n).padStart(8, '0')}:`)) continue;
    const p = b.state.getProjectile(id);
    b.bolts.push({ tick: n, ownerUnitId: p.ownerUnitId, sideId: p.sideId, aimedAt: b.state.getUnit(p.ownerUnitId).targetUnitId });
  }
  b.combat.resolveNonPlayerContactMelee(b.state, plan, events, n);
  b.combat.progressProjectiles(b.state, plan, events);
  const living = b.state.getUnitIdsStable().filter((id) => isM2UnitAlive(b.state.getUnit(id)));
  b.combat.applyDamageEvents(b.state, events);
  b.events.push(...events.map((e) => ({ ...e, tick: n })));
  const lost = living.filter((id) => !isM2UnitAlive(b.state.getUnit(id))).map((id) => {
    const u = b.state.getUnit(id);
    return { unitId: id, sideId: u.sideId, formationId: u.formationId, position: { x: u.position.x, z: u.position.z } };
  });
  b.morale.step(b.state, { newlyLostThisTick: lost, commands, processingTick: n });
  // How the battle would end (the runtime then stops it; the tests only look).
  b.outcome ||= b.result.evaluate(b.state, { commands });
  b.state.markTick(n);
  return events;
}

export const attack = (b, formationId, targetFormationId) => {
  const receipt = b.queue.enqueue({ commandId: `attack_${formationId}`, type: 'formation_attack', formationId, targetFormationId }, b.state);
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
};
export const members = (b, formationId) => b.state.getFormation(formationId).memberUnitIds.map((id) => b.state.getUnit(id));
export const hpOf = (b, side) => b.state.getUnitIdsStable().map((id) => b.state.getUnit(id)).filter((u) => u.sideId === side).reduce((s, u) => s + u.hp, 0);

