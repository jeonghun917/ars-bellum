// Sight, the fog of war (m2/M2_Vision.js; the owner, 2026-11-02: an enemy out of sight is left faded where he
// was last seen, sight by distance only, shared by the whole side).
import test from 'node:test';
import assert from 'node:assert/strict';
import { battle, tick, attack, members } from './m2-sim-helpers.mjs';
import { m2KnownCentre, m2LastSeen, m2Sees, m2UpdateVision } from '../../m2/M2_Vision.js';
import { mayStrike, pursuitTarget } from '../../m2/M2_Pursuit.js';
import { chargeTarget } from '../../m2/M2_MovementSystem.js';
import { createRenderSnapshot } from '../../m2/M2_RenderSnapshot.js';
import { M2_UNIT_KINDS, M2_UNIT_TYPES } from '../../m2/M2_UnitKinds.js';

const everyone = (b) => b.state.getUnitIdsStable().map((id) => b.state.getUnit(id));
const put = (u, x, z) => { u.position = { x, y: 0, z }; u.previousPosition = { ...u.position }; u.slotTarget = { x, z }; };
// Every unit out of the way, each far from every other (so nobody sees anybody), but those named.
const clear = (b, keep) => everyone(b).forEach((u, i) => { if (!keep.includes(u)) put(u, (i % 2 ? 1 : -1) * (400 + i * 60), 400 + i * 60); });
const centreOf = (list) => ({ x: list.reduce((s, u) => s + u.position.x, 0) / list.length, z: list.reduce((s, u) => s + u.position.z, 0) / list.length });

test('[m2.vision.range] a side sees an enemy within any of its men\'s sight, foot 20 m, skirmishers 45, horse 28; the dead see nothing', () => {
  assert.deepEqual([M2_UNIT_KINDS.infantry.visionRange, M2_UNIT_KINDS.crossbow.visionRange, M2_UNIT_KINDS.cavalry.visionRange, M2_UNIT_TYPES.skirmisher.visionRange], [20, 24, 28, 45]);
  const b = battle();
  const watcher = members(b, 'ally_line')[1];
  const rider = members(b, 'ally_column')[1];
  const [near, far, beyond] = members(b, 'enemy_line');
  clear(b, [watcher, rider, near, far, beyond]);
  put(watcher, 0, 0);
  put(near, 0, 19.5);
  put(far, 0, 21);
  put(rider, 100, 0);
  put(beyond, 100, 27.5);
  m2UpdateVision(b.state);
  const sees = (u) => m2Sees(b.state, 'ally', u);
  assert.deepEqual([sees(near), sees(far), sees(beyond)], [true, false, true]);
  // The enemy sees with its own men's eyes: the near man sees the watcher; nobody of it is near the rider.
  assert.equal(m2Sees(b.state, 'enemy', watcher), true);
  assert.equal(m2Sees(b.state, 'enemy', rider), false);
  // A skirmisher sees further, and what he sees the whole side sees.
  watcher.unitTypeId = 'skirmisher';
  m2UpdateVision(b.state);
  assert.equal(sees(far), true);
  // The fallen see nothing.
  watcher.hp = 0;
  watcher.state = 'dead';
  m2UpdateVision(b.state);
  assert.deepEqual([sees(near), sees(far), sees(beyond)], [false, false, true]);
});

test('[m2.vision.last-seen] each side knows where the other drew up; an enemy who moves out of sight is known only where he was last seen', () => {
  const b = battle();
  m2UpdateVision(b.state);
  const column = b.state.getFormation('enemy_column');
  const before = centreOf(members(b, 'enemy_column'));
  // At the start every enemy is known where he stands (seen or not).
  for (const u of everyone(b).filter((x) => x.sideId === 'enemy')) assert.ok(m2LastSeen(b.state, 'ally', u), u.unitId);
  // The horse ride off out of every ally's sight.
  for (const u of members(b, 'enemy_column')) put(u, u.position.x + 80, u.position.z);
  m2UpdateVision(b.state);
  for (const u of members(b, 'enemy_column')) {
    assert.equal(m2Sees(b.state, 'ally', u), false);
    assert.ok(Math.abs(m2LastSeen(b.state, 'ally', u).x - (u.position.x - 80)) < 1e-9);
  }
  const known = m2KnownCentre(b.state, 'ally', column);
  assert.ok(Math.hypot(known.x - before.x, known.z - before.z) < 1e-9, JSON.stringify({ known, before }));
  // Its own side knows where it is.
  assert.ok(Math.abs(m2KnownCentre(b.state, 'enemy', column).x - (before.x + 80)) < 1e-9);
  // Seen again, known where it is again.
  for (const u of members(b, 'enemy_column')) put(u, u.position.x - 80, u.position.z);
  m2UpdateVision(b.state);
  assert.equal(members(b, 'enemy_column').every((u) => m2Sees(b.state, 'ally', u)), true);
});

test('[m2.vision.strike] nobody shoots or strikes at an enemy his side does not see; another man\'s sight is enough', () => {
  const b = battle({ unitTypes: { ally_loose: 'longbow', ally_line: 'skirmisher' } });
  const archer = members(b, 'ally_loose')[1];
  const scout = members(b, 'ally_line')[1];
  const enemy = members(b, 'enemy_line')[1];
  clear(b, [archer, scout, enemy]);
  // In the longbow's reach (26 m), beyond his own sight (24 m).
  put(archer, 0, 0);
  put(enemy, 0, 25);
  put(scout, -300, -300);
  m2UpdateVision(b.state);
  assert.ok(M2_UNIT_TYPES.longbow.range > 25);
  assert.equal(mayStrike(b.state, archer, enemy), false);
  // A skirmisher who sees him (45 m) shows him to the archer.
  put(scout, 0, -15);
  m2UpdateVision(b.state);
  assert.equal(mayStrike(b.state, archer, enemy), true);
});

test('[m2.vision.goes-by-last-seen] a formation sent against an enemy that has gone out of sight makes for where it was last seen', () => {
  const b = battle();
  m2UpdateVision(b.state);
  attack(b, 'ally_line', 'enemy_column');
  tick(b);
  const was = centreOf(members(b, 'enemy_column'));
  for (const u of members(b, 'enemy_column')) put(u, u.position.x + 80, u.position.z + 10);
  b.state.getFormation('enemy_column').anchor.x += 80;
  b.grid.rebuild(b.state);
  for (let i = 0; i < 3; i += 1) tick(b);
  const anchor = b.state.getFormation('ally_line').anchor;
  assert.ok(Math.hypot(anchor.x - was.x, anchor.z - was.z) < 5, JSON.stringify({ anchor, was }));
});

test('[m2.vision.enemy-commander] the enemy commander goes by what his men see: an ally formation out of sight is where it was last seen', () => {
  const b = battle({ withAI: true });
  m2UpdateVision(b.state);
  // The ally crossbowmen, which the enemy horse hunt (M2_EnemyAI.js), slip away out of every enemy's sight.
  const was = centreOf(members(b, 'ally_loose'));
  for (const u of members(b, 'ally_loose')) put(u, u.position.x - 80, u.position.z);
  b.state.getFormation('ally_loose').anchor.x -= 80;
  b.grid.rebuild(b.state);
  attack(b, 'ally_line', 'enemy_line');
  for (let i = 0; i < 3; i += 1) tick(b);
  const horse = b.state.getFormation('enemy_column');
  assert.equal(horse.order.targetFormationId, 'ally_loose');
  assert.ok(Math.hypot(horse.anchor.x - was.x, horse.anchor.z - was.z) < 5, JSON.stringify({ anchor: horse.anchor, was }));
});

test('[m2.vision.screen] the player sees an enemy out of his side\'s sight faded where it was last seen', () => {
  const b = battle();
  m2UpdateVision(b.state);
  const before = Object.fromEntries(members(b, 'enemy_column').map((u) => [u.unitId, { ...u.position }]));
  for (const u of members(b, 'enemy_column')) put(u, u.position.x + 80, u.position.z);
  m2UpdateVision(b.state);
  const snapshot = createRenderSnapshot(b.state);
  for (const unit of snapshot.units) {
    if (unit.formationId === 'enemy_column') {
      assert.equal(unit.seen, false);
      assert.deepEqual([unit.lastSeen.x, unit.lastSeen.z], [before[unit.unitId].x, before[unit.unitId].z]);
    } else {
      assert.equal(unit.seen, true, unit.unitId);
      assert.equal(unit.lastSeen, null);
    }
  }
  assert.deepEqual(snapshot.sight, { enemySeen: snapshot.units.filter((u) => u.sideId === 'enemy').length - members(b, 'enemy_column').length, enemyFaded: members(b, 'enemy_column').length });
});

test('[m2.vision.drawn-up] an enemy out of sight from the start is still known where he drew up', () => {
  const b = battle();
  // The enemy horse drawn up far off, beyond every ally's sight, before the battle begins.
  for (const u of members(b, 'enemy_column')) put(u, u.position.x + 80, u.position.z);
  const drawnUp = centreOf(members(b, 'enemy_column'));
  m2UpdateVision(b.state);
  for (const u of members(b, 'enemy_column')) {
    assert.equal(m2Sees(b.state, 'ally', u), false);
    assert.ok(m2LastSeen(b.state, 'ally', u), u.unitId);
  }
  const known = m2KnownCentre(b.state, 'ally', b.state.getFormation('enemy_column'));
  assert.ok(Math.hypot(known.x - drawnUp.x, known.z - drawnUp.z) < 1e-9);
});

test('[m2.vision.chase] horsemen charge and pursue only the enemies their side sees', () => {
  // A charge: the nearest of the enemy men seen, not a nearer one out of sight (just beyond the rider's 28 m).
  const b = battle();
  const rider = members(b, 'ally_column')[1];
  const [hidden, shown] = members(b, 'enemy_line');
  clear(b, [rider, hidden, shown]);
  put(rider, 0, 0);
  put(hidden, 0, 28.5);
  put(shown, 0, -35);
  m2UpdateVision(b.state);
  const column = b.state.getFormation('ally_column');
  column.order = { type: 'attack_target', target: null, targetFormationId: 'enemy_line', commandId: 'c' };
  column.tactic = 'charge';
  // (Both out of the rider's 28 m; a scout of his side sees the one behind him.)
  const scout = members(b, 'ally_line')[1];
  put(scout, 0, -40);
  m2UpdateVision(b.state);
  assert.equal(m2Sees(b.state, 'ally', hidden), false);
  const target = chargeTarget(b.state, rider);
  assert.deepEqual([target.x, target.z], [shown.position.x, shown.position.z]);
  // A pursuit: runners out of sight are not chased.
  const p = battle();
  const horse = members(p, 'ally_column');
  p.queue.enqueue({ commandId: 'att', type: 'formation_attack', formationId: 'ally_column', targetFormationId: 'enemy_line' }, p.state);
  tick(p);
  for (const u of members(p, 'enemy_line')) u.morale = 0;
  tick(p);
  assert.ok(pursuitTarget(p.state, horse[1]), 'runners in sight are chased');
  for (const u of members(p, 'enemy_line')) put(u, u.position.x + 80, u.position.z);
  m2UpdateVision(p.state);
  assert.equal(pursuitTarget(p.state, horse[1]), null);
});

test('[m2.vision.enemy-braces] enemy foot keep their spears planted against horse last seen close, gone out of sight', () => {
  const b = battle({ withAI: true });
  m2UpdateVision(b.state);
  const line = centreOf(members(b, 'enemy_line'));
  // The ally horse 10 m from the enemy foot.
  const horse = members(b, 'ally_column');
  const at = centreOf(horse);
  for (const u of horse) put(u, u.position.x - at.x + line.x - 10, u.position.z - at.z + line.z);
  b.grid.rebuild(b.state);
  attack(b, 'ally_line', 'enemy_line');
  tick(b);
  assert.equal(b.state.getFormation('enemy_line').tactic, 'spear_brace');
  // They ride off out of every enemy's sight; the foot do not know they have gone.
  for (const u of horse) put(u, u.position.x - 80, u.position.z);
  b.state.getFormation('ally_column').anchor.x -= 80;
  b.grid.rebuild(b.state);
  for (let i = 0; i < 25; i += 1) tick(b);
  assert.equal(horse.some((u) => m2Sees(b.state, 'enemy', u)), false);
  assert.equal(b.state.getFormation('enemy_line').tactic, 'spear_brace');
});
