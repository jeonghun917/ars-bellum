// The battle's pace (marching, the charge, the rhythm of blows) and soldiers' bodies (no two in one place),
// in the 3D battle simulation (m2/M2_UnitKinds.js, M2_MovementSystem.js, M2_CollisionSystem.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isM2UnitAlive, isM2UnitActive } from '../../m2/M2_BattleState.js';
import { M2_CONFIG } from '../../m2/M2_Config.js';
import { M2_UNIT_KINDS } from '../../m2/M2_UnitKinds.js';
import { battle, tick, attack, members } from './m2-sim-helpers.mjs';

const speed = (u) => Math.hypot(u.velocity.x, u.velocity.z);
const living = (b) => b.state.getUnitIdsStable().map((id) => b.state.getUnit(id)).filter(isM2UnitAlive);

test('[m2.pace.march] a formation ordered to move marches at a walk, not a run', () => {
  const b = battle();
  const receipt = b.queue.enqueue({ commandId: 'm', type: 'formation_move', formationId: 'ally_column', target: { x: -8, z: 25 } }, b.state);
  assert.equal(receipt.ok, true);
  // The middle speed of the column each tick (a horse shoving through the ally line on its way is pushed
  // about for a moment).
  const seen = [];
  for (let i = 0; i < 100; i += 1) {
    tick(b);
    const speeds = members(b, 'ally_column').map(speed).sort((p, q) => p - q);
    seen.push(speeds[Math.floor(speeds.length / 2)]);
  }
  // A horse walks at about 1.7 m/s (its walking clip); running would be 5.6.
  assert.ok(Math.max(...seen) < 2, `${Math.max(...seen)} m/s`);
  assert.ok(Math.max(...seen) > 1.4, `${Math.max(...seen)} m/s`);
});

test('[m2.pace.charge] attacking soldiers march up and break into a run for the last stretch', () => {
  const b = battle();
  const far = b.state.getFormation('enemy_line');
  far.anchor = { x: 5, z: -35 };
  for (const u of members(b, 'enemy_line')) { u.position.z -= 30; u.previousPosition = { ...u.position }; u.slotTarget = { x: u.position.x, z: u.position.z }; }
  attack(b, 'ally_line', 'enemy_line');
  // The line's middle soldier by speed each tick, until the first blow (on its way it passes through the
  // ally crossbowmen, who are shoved aside, and the enemy crossbowmen shoot at it: neither stops the march).
  const line = () => members(b, 'ally_line').filter((u) => !u.isPlayer && isM2UnitActive(u));
  const samples = [];
  for (let i = 0; i < 900 && !b.events.some((e) => e.damageEventId.startsWith('auto_melee:')); i += 1) {
    tick(b);
    const bySpeed = line().sort((p, q) => speed(p) - speed(q));
    const middle = bySpeed[Math.floor(bySpeed.length / 2)];
    samples.push({ speed: speed(middle), toSlot: Math.hypot(middle.slotTarget.x - middle.position.x, middle.slotTarget.z - middle.position.z) });
  }
  const run = M2_CONFIG.unitMaxSpeed;
  const farOff = samples.filter((s) => s.toSlot > M2_UNIT_KINDS.infantry.chargeDistance + 1 && s.speed > 0);
  const close = samples.filter((s) => s.toSlot < M2_UNIT_KINDS.infantry.chargeDistance - 1 && s.speed > 0);
  assert.ok(farOff.length > 20 && farOff.every((s) => s.speed < run * 0.6), 'marching while far');
  assert.ok(close.length > 5 && close.some((s) => s.speed > run * 0.95), 'running at the end');
});

test('[m2.pace.blow-rhythm] a soldier in a fight strikes about every one and a half seconds', () => {
  const b = battle({ withAI: true });
  attack(b, 'ally_line', 'enemy_line');
  for (let i = 0; i < 600; i += 1) tick(b);
  const bySource = new Map();
  for (const e of b.events) if (e.damageEventId.startsWith('auto_melee:')) {
    const list = bySource.get(e.sourceUnitId) || [];
    list.push(e.tick);
    bySource.set(e.sourceUnitId, list);
  }
  assert.ok(bySource.size > 5);
  // One and a half seconds is 30 ticks at 20 a second.
  for (const [unitId, ticks] of bySource) {
    for (let i = 1; i < ticks.length; i += 1) assert.ok(ticks[i] - ticks[i - 1] >= 30, `${unitId}: ${ticks}`);
  }
});

test('[m2.bodies.no-overlap] in the thick of a fight no two living soldiers stand inside one another', () => {
  const b = battle({ withAI: true });
  attack(b, 'ally_line', 'enemy_line');
  attack(b, 'ally_column', 'enemy_loose');
  let worst = Infinity;
  let pairsChecked = 0;
  for (let i = 0; i < 500; i += 1) {
    tick(b);
    if (i % 10) continue;
    const all = living(b);
    for (let p = 0; p < all.length; p += 1) for (let q = p + 1; q < all.length; q += 1) {
      const gap = Math.hypot(all[p].position.x - all[q].position.x, all[p].position.z - all[q].position.z);
      const room = M2_UNIT_KINDS[all[p].kindId].radius + M2_UNIT_KINDS[all[q].kindId].radius;
      if (gap < room * 1.5) pairsChecked += 1;
      worst = Math.min(worst, gap / room);
    }
  }
  assert.ok(pairsChecked > 20, 'soldiers did come close');
  // A crowd pressed from both sides settles to within a fifth of a body's room each tick (the radius is a
  // little wider than the shoulders, so that still looks like men shoulder to shoulder, not inside each other).
  assert.ok(worst > 0.8, `closest pair at ${worst} of their room`);
});

test('[m2.bodies.horse-shoves] a horse pushes a man aside; two men share the step', () => {
  const b = battle();
  const horse = members(b, 'ally_column')[0];
  const man = members(b, 'ally_loose')[0];
  const man2 = members(b, 'ally_loose')[1];
  for (const u of [horse, man, man2]) u.slotTarget = null;
  horse.position = { x: 0, y: 0, z: 0 };
  man.position = { x: 0.5, y: 0, z: 0 };
  b.grid.rebuild(b.state);
  b.collision.step(b.state, b.grid, 0.05);
  const horseMoved = Math.abs(horse.position.x);
  const manMoved = Math.abs(man.position.x - 0.5);
  assert.ok(manMoved > horseMoved * 4, JSON.stringify({ horseMoved, manMoved }));
  man.position = { x: 10, y: 0, z: 0 };
  man2.position = { x: 10.4, y: 0, z: 0 };
  b.grid.rebuild(b.state);
  b.collision.step(b.state, b.grid, 0.05);
  assert.ok(Math.abs((man.position.x - 10) + (man2.position.x - 10.4)) < 1e-9, 'pushed apart by the same amount');
  assert.ok(man2.position.x - man.position.x > 0.69);
});

test('[m2.bodies.fallen-take-no-room] the fallen lie where they fell and do not push anyone', () => {
  const b = battle();
  const dead = members(b, 'ally_loose')[0];
  const man = members(b, 'ally_loose')[1];
  dead.hp = 0; dead.state = 'incapacitated';
  dead.position = { x: 20, y: 0, z: 20 };
  man.position = { x: 20.2, y: 0, z: 20 };
  b.grid.rebuild(b.state);
  b.collision.step(b.state, b.grid, 0.05);
  assert.deepEqual([dead.position.x, man.position.x], [20, 20.2]);
});

test('[m2.pace.longer-battle] a battle now lasts minutes, not seconds', () => {
  const b = battle({ withAI: true });
  attack(b, 'ally_line', 'enemy_line');
  attack(b, 'ally_column', 'enemy_loose');
  attack(b, 'ally_loose', 'enemy_column');
  let i = 0;
  for (; i < 20 * 600 && !b.outcome; i += 1) tick(b);
  assert.ok(b.outcome, 'the battle ends');
  assert.ok(i / 20 >= 30, `ended after ${i / 20} s`);
});
