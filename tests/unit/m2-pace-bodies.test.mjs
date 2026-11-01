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

test('[m2.pace.run-then-settle] soldiers run to their places and walk only the last few metres', () => {
  const b = battle();
  const receipt = b.queue.enqueue({ commandId: 'm', type: 'formation_move', formationId: 'ally_loose', target: { x: -3, z: 25 } }, b.state);
  assert.equal(receipt.ok, true);
  // The middle soldier by speed each tick, with how far he still has to go.
  const samples = [];
  for (let i = 0; i < 300; i += 1) {
    tick(b);
    const bySpeed = members(b, 'ally_loose').sort((p, q) => speed(p) - speed(q));
    const u = bySpeed[Math.floor(bySpeed.length / 2)];
    samples.push({ speed: speed(u), left: Math.hypot(u.slotTarget.x - u.position.x, u.slotTarget.z - u.position.z) });
  }
  const far = samples.filter((s) => s.left > 4);
  const near = samples.filter((s) => s.left > 0.1 && s.left < 2.5);
  // Running is 3.2 m/s on foot; the walk clip's pace is about 1.3-1.5.
  assert.ok(far.length > 20 && far.every((s) => s.speed > 3), 'running while far');
  assert.ok(near.length > 0 && near.every((s) => s.speed < 1.6), 'walking at the end');
});

const ride = (ranks) => {
  // One horseman rides at a block of enemy foot, `ranks` deep and six wide, who hold their places.
  const b = battle();
  const horse = members(b, 'ally_column')[0];
  const men = b.state.getUnitIdsStable().map((id) => b.state.getUnit(id)).filter((u) => u.sideId === 'enemy');
  for (const u of b.state.getUnitIdsStable().map((id) => b.state.getUnit(id))) {
    if (u === horse) continue;
    u.position = { x: 100 + Number(u.unitId.slice(-2)) * 2, y: 0, z: 100 };
    u.slotTarget = { x: u.position.x, z: u.position.z };
  }
  let k = 0;
  for (let r = 0; r < ranks; r += 1) for (let c = 0; c < 6; c += 1) {
    const m = men[k++];
    m.position = { x: (c - 2.5) * 0.75, y: 0, z: 5 + r * 0.75 };
    m.previousPosition = { ...m.position };
    m.slotTarget = { x: m.position.x, z: m.position.z };
  }
  horse.position = { x: 0, y: 0, z: -10 };
  horse.previousPosition = { ...horse.position };
  horse.slotTarget = { x: 0, z: 20 };
  b.formation.updateSlots = () => {};
  for (let i = 0; i < 200; i += 1) tick(b);
  return horse.position.z;
};

test('[m2.bodies.horse-trapped] a horse breaks through a line one man deep but is stopped by a block two deep or more', () => {
  assert.ok(ride(1) > 15, 'through a single line');
  assert.ok(ride(2) < 7, 'held by two ranks');
  assert.ok(ride(3) < 7, 'held by three ranks');
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
  // Two men both standing (the shove above left the first with a push's velocity).
  man.position = { x: 10, y: 0, z: 0 };
  man2.position = { x: 10.4, y: 0, z: 0 };
  man.velocity = { x: 0, z: 0 };
  man2.velocity = { x: 0, z: 0 };
  b.grid.rebuild(b.state);
  b.collision.step(b.state, b.grid, 0.05);
  assert.ok(Math.abs((man.position.x - 10) + (man2.position.x - 10.4)) < 1e-9, 'pushed apart by the same amount');
  assert.ok(man2.position.x - man.position.x > 0.69);
});

test('[m2.bodies.comrades-make-way] a soldier on the move goes round a comrade standing in his way', () => {
  const b = battle();
  const runner = members(b, 'ally_loose')[0];
  const stander = members(b, 'ally_loose')[1];
  runner.position = { x: 30, y: 0, z: 0 };
  runner.velocity = { x: 0, z: 3.2 };
  stander.position = { x: 30.05, y: 0, z: 0.5 };
  stander.velocity = { x: 0, z: 0 };
  const before = { ...runner.position };
  b.grid.rebuild(b.state);
  b.collision.step(b.state, b.grid, 0.05);
  // The runner is not pushed back; the stander steps aside, and they part sideways.
  assert.ok(runner.position.z >= before.z - 1e-9, JSON.stringify(runner.position));
  assert.ok(Math.abs(runner.position.x - stander.position.x) > 0.05, JSON.stringify([runner.position, stander.position]));
  assert.ok(Math.hypot(runner.position.x - stander.position.x, runner.position.z - stander.position.z) >= 0.69);
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

test('[m2.bodies.rout-reaches-edge] a whole side ordered to retreat leaves the field, and the battle ends', () => {
  // Fleeing men take no room: if they jostled, the first at the edge would push the rest back from it.
  const b = battle();
  for (const id of ['ally_line', 'ally_column', 'ally_loose']) {
    const r = b.queue.enqueue({ commandId: `retreat_${id}`, type: 'formation_retreat', formationId: id }, b.state);
    assert.equal(r.ok, true);
  }
  let i = 0;
  for (; i < 20 * 60 && !b.outcome; i += 1) tick(b);
  assert.equal(b.outcome, 'ally_retreat', `after ${i / 20} s`);
});

test('[m2.pace.longer-battle] a battle now lasts minutes, not seconds', () => {
  const b = battle({ withAI: true });
  attack(b, 'ally_line', 'enemy_line');
  attack(b, 'ally_column', 'enemy_loose');
  attack(b, 'ally_loose', 'enemy_column');
  let i = 0;
  for (; i < 20 * 600 && !b.outcome; i += 1) tick(b);
  assert.ok(b.outcome, 'the battle ends');
  // About two minutes when every formation is thrown in at once (the owner found 20 s far too short).
  assert.ok(i / 20 >= 90, `ended after ${i / 20} s`);
});
