// Crossbowmen and horsemen in the 3D battle simulation (m2/M2_UnitKinds.js), run without a screen: the
// same systems in the same order as M2BattleRuntime's fixed tick.
import test from 'node:test';
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
import { M2_UNIT_KINDS } from '../../m2/M2_UnitKinds.js';
import { M2_TECHNICAL_COMBAT_PROFILES, M2_TECHNICAL_SNAPSHOT } from '../../m2/fixtures/m2_technical_fixture_v1.js';

const DT = M2_CONFIG.fixedTickMs / 1000;

function battle() {
  const state = new M2BattleState(M2_TECHNICAL_SNAPSHOT, createCombatProfileCatalog(M2_TECHNICAL_COMBAT_PROFILES));
  const queue = new M2CommandQueue();
  queue.beginBattleEpoch();
  const b = {
    state, queue,
    formation: new M2FormationSystem(),
    movement: new M2MovementSystem({ maxSpeed: M2_CONFIG.unitMaxSpeed, arrivalEpsilon: M2_CONFIG.arrivalEpsilon }),
    grid: new M2SpatialGrid(M2_CONFIG.spatialCellSize),
    combat: new M2CombatSystem(),
    morale: new M2MoraleSystem(),
  };
  b.formation.updateSlots(state);
  state.forEachUnitStable((u) => { u.position.x = u.previousPosition.x = u.slotTarget.x; u.position.z = u.previousPosition.z = u.slotTarget.z; });
  b.grid.rebuild(state);
  return b;
}

function tick(b) {
  const n = b.state.tick + 1;
  const commands = b.queue.drain().commands;
  for (const c of commands) if (c.type.startsWith('formation_')) b.formation.applyCommand(b.state, c);
  b.formation.updateAttackGoals(b.state);
  b.formation.updateSlots(b.state);
  b.movement.step(b.state, DT);
  b.grid.rebuild(b.state);
  const plan = b.combat.prepareTick(b.state, b.grid, commands, DT, n);
  const events = [];
  b.combat.resolveBowLaunch(b.state, commands, n);
  b.combat.resolveCrossbowVolleys(b.state, plan, n);
  b.combat.resolveNonPlayerContactMelee(b.state, plan, events, n);
  b.combat.progressProjectiles(b.state, plan, events);
  const living = b.state.getUnitIdsStable().filter((id) => isM2UnitAlive(b.state.getUnit(id)));
  b.combat.applyDamageEvents(b.state, events);
  const lost = living.filter((id) => !isM2UnitAlive(b.state.getUnit(id))).map((id) => {
    const u = b.state.getUnit(id);
    return { unitId: id, sideId: u.sideId, formationId: u.formationId, position: { x: u.position.x, z: u.position.z } };
  });
  b.morale.step(b.state, { newlyLostThisTick: lost, commands, processingTick: n });
  b.state.markTick(n);
  return events;
}

const attack = (b, formationId, targetFormationId) => {
  const receipt = b.queue.enqueue({ commandId: `attack_${formationId}`, type: 'formation_attack', formationId, targetFormationId }, b.state);
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
};
const members = (b, formationId) => b.state.getFormation(formationId).memberUnitIds.map((id) => b.state.getUnit(id));
const hpOf = (b, side) => b.state.getUnitIdsStable().map((id) => b.state.getUnit(id)).filter((u) => u.sideId === side).reduce((s, u) => s + u.hp, 0);

test('[m2.kinds.assigned] each side has foot soldiers, crossbowmen (the loose formation) and horsemen (the column)', () => {
  const b = battle();
  for (const side of ['ally', 'enemy']) {
    assert.ok(members(b, `${side}_line`).every((u) => u.kindId === 'infantry'));
    assert.ok(members(b, `${side}_loose`).every((u) => u.kindId === 'crossbow'));
    assert.ok(members(b, `${side}_column`).every((u) => u.kindId === 'cavalry'));
  }
  // Horses stand far enough apart not to overlap (a horse is about 2.4 m long).
  const column = members(b, 'ally_column');
  for (let i = 1; i < column.length; i += 1) {
    const gap = Math.hypot(column[i].position.x - column[i - 1].position.x, column[i].position.z - column[i - 1].position.z);
    assert.ok(gap >= 2.5, `gap ${gap}`);
  }
});

test('[m2.kinds.crossbow-volley] crossbowmen ordered to attack keep their distance, shoot bolts that hit, and reload', () => {
  const b = battle();
  const before = hpOf(b, 'enemy');
  // Without an order they hold their fire.
  for (let i = 0; i < 40; i += 1) tick(b);
  assert.equal(b.combat.getObservation(b.state).crossbowLaunchCount, 0);
  attack(b, 'ally_loose', 'enemy_line');
  const launches = [];
  for (let i = 0; i < 400; i += 1) {
    tick(b);
    launches.push(b.combat.getObservation(b.state).crossbowLaunchCount);
  }
  const seen = b.combat.getObservation(b.state);
  assert.ok(seen.crossbowLaunchCount >= 6 * 4, `launches ${seen.crossbowLaunchCount}`);
  assert.ok(seen.projectileHitCount > 0, 'some bolts hit');
  assert.ok(hpOf(b, 'enemy') < before, 'the enemy is hurt');
  // Each crossbowman shoots at most once per reload.
  const shooter = members(b, 'ally_loose')[1];
  assert.ok(seen.crossbowLaunchCount <= 6 * Math.ceil(400 / M2_UNIT_KINDS.crossbow.reloadTicks));
  assert.ok(shooter.attackCooldownTicks <= M2_UNIT_KINDS.crossbow.reloadTicks);
  // Already within range at the start, they shoot from where they stand instead of closing to melee.
  const target = b.state.getFormation('enemy_line').anchor;
  const anchor = b.state.getFormation('ally_loose').anchor;
  assert.ok(Math.hypot(target.x - anchor.x, target.z - anchor.z) > 9, JSON.stringify({ target, anchor }));
});

test('[m2.kinds.crossbow-close-in] crossbowmen ordered to attack a far enemy close only to shooting distance', () => {
  const b = battle();
  const far = b.state.getFormation('enemy_line');
  far.anchor.x = 30;
  far.anchor.z = -30;
  attack(b, 'ally_loose', 'enemy_line');
  for (let i = 0; i < 400; i += 1) tick(b);
  const anchor = b.state.getFormation('ally_loose').anchor;
  const gap = Math.hypot(far.anchor.x - anchor.x, far.anchor.z - anchor.z);
  assert.ok(Math.abs(gap - M2_UNIT_KINDS.crossbow.standOff) < 0.01, `gap ${gap}`);
});

test('[m2.kinds.crossbow-no-friendly-fire] bolts pass their own side and only enemies are hurt', () => {
  const b = battle();
  attack(b, 'ally_loose', 'enemy_line');
  const allyBefore = hpOf(b, 'ally');
  // An ally stands in the line of fire, halfway between a crossbowman and the enemy nearest him.
  const shooter = members(b, 'ally_loose')[1];
  const inTheWay = b.state.getUnit('m2_fixture_ally_02');
  const enemies = b.state.getUnitIdsStable().map((id) => b.state.getUnit(id)).filter((u) => u.sideId === 'enemy');
  const struck = [];
  for (let i = 0; i < 300; i += 1) {
    const near = enemies.filter(isM2UnitActive).sort((p, q) => Math.hypot(p.position.x - shooter.position.x, p.position.z - shooter.position.z)
      - Math.hypot(q.position.x - shooter.position.x, q.position.z - shooter.position.z))[0];
    inTheWay.position.x = (shooter.position.x + near.position.x) / 2;
    inTheWay.position.z = (shooter.position.z + near.position.z) / 2;
    inTheWay.slotTarget = { x: inTheWay.position.x, z: inTheWay.position.z };
    // (Damage between the same side is also refused later, so look at whom each bolt struck, not at hp.)
    for (const e of tick(b)) if (e.sourceUnitId === shooter.unitId) struck.push(b.state.getUnit(e.targetUnitId).sideId);
  }
  assert.ok(struck.length > 0, 'the crossbowman hit someone');
  assert.deepEqual([...new Set(struck)], ['enemy']);
  assert.equal(hpOf(b, 'ally'), allyBefore);
});

test('[m2.kinds.cavalry-charge] horsemen ride faster than men on foot and a blow after a run-up is a charge, once per run-up', () => {
  const b = battle();
  attack(b, 'ally_column', 'enemy_line');
  attack(b, 'ally_line', 'enemy_line');
  let fastest = { cavalry: 0, infantry: 0 };
  const charges = [];
  for (let i = 0; i < 200; i += 1) {
    const events = tick(b);
    for (const u of b.state.getUnitIdsStable().map((id) => b.state.getUnit(id))) {
      if (u.sideId !== 'ally' || !isM2UnitActive(u)) continue;
      const speed = Math.hypot(u.velocity.x, u.velocity.z);
      if (u.kindId in fastest) fastest[u.kindId] = Math.max(fastest[u.kindId], speed);
    }
    for (const e of events) if (b.state.getUnit(e.sourceUnitId).kindId === 'cavalry') charges.push(e.damage);
  }
  assert.ok(fastest.cavalry > fastest.infantry * 1.5, JSON.stringify(fastest));
  assert.ok(b.combat.getObservation(b.state).chargeHitCount > 0, 'a charge landed');
  assert.ok(charges.some((d) => d >= M2_UNIT_KINDS.cavalry.meleeDamage * M2_UNIT_KINDS.cavalry.chargeScale), JSON.stringify(charges));
  // One charge per horseman per run-up: riding on through the enemy does not charge again and again.
  assert.ok(b.combat.getObservation(b.state).chargeHitCount <= members(b, 'ally_column').length, JSON.stringify(charges));
});

test('[m2.kinds.deterministic] the same orders give the same battle, bolt for bolt', () => {
  const run = () => {
    const b = battle();
    attack(b, 'ally_loose', 'enemy_column');
    attack(b, 'ally_column', 'enemy_loose');
    for (let i = 0; i < 300; i += 1) tick(b);
    return JSON.stringify(b.state.getSnapshot());
  };
  assert.equal(run(), run());
});
