// The enemy commander in the 3D battle (m2/M2_EnemyAI.js), and soldiers defending themselves without an
// order to attack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { battle, tick, attack, members, hpOf } from './m2-sim-helpers.mjs';
import { setPlan } from '../../m2/M2_Plans.js';

// The enemy commander's choices of target, formation by formation: under a frontal push (his battle plans
// are tested in m2-plans.test.mjs).
const frontal = (b) => setPlan(b.state, 'enemy', 'frontal_push', 0);

const enemyFormations = (b) => b.state.getFormationIdsStable().map((id) => b.state.getFormation(id)).filter((f) => f.sideId === 'enemy');
// To the centimetre: where the starting places overlap a little (a horse of the enemy column inside the
// enemy line), bodies settle by fractions of a millimetre.
const positions = (b, side) => JSON.stringify(b.state.getUnitIdsStable().map((id) => b.state.getUnit(id))
  .filter((u) => u.sideId === side).map((u) => [Math.round(u.position.x * 100), Math.round(u.position.z * 100)]));

test('[m2.ai.waits] left alone, the enemy holds its ground and nobody is hurt', () => {
  const b = battle({ withAI: true });
  for (let i = 0; i < 40; i += 1) tick(b);
  const before = positions(b, 'enemy');
  const hp = [hpOf(b, 'ally'), hpOf(b, 'enemy')];
  for (let i = 0; i < 400; i += 1) tick(b);
  assert.equal(b.ai.awake, false);
  assert.ok(enemyFormations(b).every((f) => f.order.type === 'hold'));
  assert.equal(positions(b, 'enemy'), before);
  assert.deepEqual([hpOf(b, 'ally'), hpOf(b, 'enemy')], hp);
  assert.equal(b.bolts.length, 0);
});

test('[m2.ai.wakes-on-attack-order] an ally attack order brings the whole enemy army into the fight', () => {
  const b = battle({ withAI: true });
  frontal(b);
  attack(b, 'ally_line', 'enemy_line');
  for (let i = 0; i < 2; i += 1) tick(b);
  assert.equal(b.ai.awake, true);
  for (const f of enemyFormations(b)) {
    assert.equal(f.order.type, 'attack_target', f.formationId);
    assert.equal(b.state.getFormation(f.order.targetFormationId).sideId, 'ally');
  }
  // The enemy horsemen go for the ally crossbowmen; the others for the nearest formation.
  assert.equal(b.state.getFormation('enemy_column').order.targetFormationId, 'ally_loose');
  const before = positions(b, 'enemy');
  for (let i = 0; i < 100; i += 1) tick(b);
  assert.notEqual(positions(b, 'enemy'), before, 'the enemy moves');
  assert.ok(b.bolts.some((bolt) => bolt.sideId === 'enemy'), 'the enemy crossbowmen shoot');
  assert.ok(b.events.some((e) => b.state.getUnit(e.sourceUnitId).sideId === 'enemy'), 'the enemy strikes');
});

test('[m2.ai.wakes-on-harm] hurting an enemy soldier wakes the enemy too', () => {
  const b = battle({ withAI: true });
  tick(b);
  assert.equal(b.ai.awake, false);
  b.state.getUnit('m2_fixture_enemy_03').hp -= 5;
  tick(b);
  assert.equal(b.ai.awake, true);
  assert.ok(enemyFormations(b).every((f) => f.order.type === 'attack_target'));
});

test('[m2.ai.cavalry-hunts-crossbows] the enemy horsemen ride for the ally crossbowmen even when others are nearer', () => {
  const b = battle({ withAI: true });
  frontal(b);
  // The ally crossbowmen stand far back; the ally foot and horse are much nearer the enemy horsemen.
  const loose = b.state.getFormation('ally_loose');
  loose.anchor = { x: -30, z: 25 };
  for (const u of members(b, 'ally_loose')) { u.position.x -= 27; u.position.z += 25; u.previousPosition = { ...u.position }; }
  attack(b, 'ally_line', 'enemy_line');
  tick(b);
  assert.equal(b.state.getFormation('enemy_column').order.targetFormationId, 'ally_loose');
  // Foot soldiers and crossbowmen take the nearest instead.
  assert.notEqual(b.state.getFormation('enemy_line').order.targetFormationId, 'ally_loose');
  assert.notEqual(b.state.getFormation('enemy_loose').order.targetFormationId, 'ally_loose');
});

test('[m2.ai.retargets] when its target is gone, an enemy formation turns on the next', () => {
  const b = battle({ withAI: true });
  frontal(b);
  attack(b, 'ally_line', 'enemy_line');
  tick(b);
  assert.equal(b.state.getFormation('enemy_column').order.targetFormationId, 'ally_loose');
  for (const u of members(b, 'ally_loose')) { u.hp = 0; u.state = 'incapacitated'; }
  for (let i = 0; i < 25; i += 1) tick(b);
  const target = b.state.getFormation('enemy_column').order.targetFormationId;
  assert.notEqual(target, 'ally_loose');
  assert.ok(['ally_line', 'ally_column'].includes(target), target);
});

test('[m2.ai.leaves-withdrawal] a withdrawing or rallying enemy formation keeps that order', () => {
  const b = battle({ withAI: true });
  attack(b, 'ally_line', 'enemy_line');
  tick(b);
  const line = b.state.getFormation('enemy_line');
  const loose = b.state.getFormation('enemy_loose');
  line.order = { type: 'withdraw', target: { x: line.anchor.x, z: -18 }, targetFormationId: null, commandId: 'test' };
  loose.order = { type: 'rally', target: null, targetFormationId: null, commandId: 'test' };
  // One decision of the commander (a rally with nobody running ends at once in the morale step, so the
  // commander is asked directly, at its next thinking tick).
  b.ai.step(b.state, b.state.tick + 100);
  assert.equal(line.order.type, 'withdraw');
  assert.equal(loose.order.type, 'rally');
  assert.equal(b.state.getFormation('enemy_column').order.type, 'attack_target');
});

test('[m2.ai.defend-in-place] soldiers ordered to hold strike back at enemies who reach them, crossbowmen shoot back', () => {
  const b = battle({ withAI: true });
  frontal(b);
  // Only the player's line is sent in; the ally horsemen and crossbowmen stay on hold.
  attack(b, 'ally_line', 'enemy_line');
  for (let i = 0; i < 600; i += 1) tick(b);
  const struckBy = (formationId) => b.events.filter((e) => b.state.getUnit(e.sourceUnitId).formationId === formationId);
  assert.equal(b.state.getFormation('ally_column').order.type, 'hold');
  assert.ok(struckBy('ally_column').length > 0, 'the ally horsemen defend themselves');
  assert.ok(b.bolts.some((bolt) => b.state.getUnit(bolt.ownerUnitId).formationId === 'ally_loose'), 'the ally crossbowmen shoot back');
  // Shooting back: at attackers only. Ordered to hold, crossbowmen did not shoot before the enemy attacked.
  const firstEnemyOrder = b.ai.getObservation().enemyWokeAtTick;
  assert.ok(b.bolts.filter((bolt) => bolt.sideId === 'ally').every((bolt) => bolt.tick >= firstEnemyOrder));
});

test('[m2.ai.battle-ends] once started, the battle is fought to an end', () => {
  const b = battle({ withAI: true });
  attack(b, 'ally_line', 'enemy_line');
  for (let i = 0; i < 20 * 300 && !b.outcome; i += 1) tick(b);
  assert.ok(b.outcome, 'an outcome within five minutes');
  assert.ok(['ally_victory', 'enemy_victory', 'ally_retreat', 'enemy_retreat'].includes(b.outcome), b.outcome);
});

test('[m2.ai.deterministic] the same battle with the enemy commander plays out the same way', () => {
  const run = () => {
    const b = battle({ withAI: true });
    attack(b, 'ally_column', 'enemy_loose');
    for (let i = 0; i < 600; i += 1) tick(b);
    return JSON.stringify([b.state.getSnapshot(), b.outcome]);
  };
  assert.equal(run(), run());
});
