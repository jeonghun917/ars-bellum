// Crossbowmen and horsemen in the 3D battle simulation (m2/M2_UnitKinds.js), run without a screen: the
// same systems in the same order as M2BattleRuntime's fixed tick.
import test from 'node:test';
import assert from 'node:assert/strict';
import { M2_UNIT_KINDS } from '../../m2/M2_UnitKinds.js';
import { isM2UnitActive } from '../../m2/M2_BattleState.js';
import { battle, tick, attack, members, hpOf } from './m2-sim-helpers.mjs';

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
  const allyBolts = b.bolts.filter((bolt) => bolt.sideId === 'ally').length;
  assert.ok(allyBolts >= 6 * 4, `launches ${allyBolts}`);
  assert.ok(seen.projectileHitCount > 0, 'some bolts hit');
  assert.ok(hpOf(b, 'enemy') < before, 'the enemy is hurt');
  // Each crossbowman shoots at most once per reload.
  const shooter = members(b, 'ally_loose')[1];
  assert.ok(allyBolts <= 6 * Math.ceil(400 / M2_UNIT_KINDS.crossbow.reloadTicks));
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
  // (The enemy crossbowmen shoot back at the attackers, so the allies do get hurt: but never by their own.)
  assert.ok(b.events.every((e) => b.state.getUnit(e.sourceUnitId).sideId !== b.state.getUnit(e.targetUnitId).sideId));
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
