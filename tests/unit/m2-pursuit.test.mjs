// Pursuit (추격) in the 3D battle (m2/M2_Pursuit.js): a formation set to pursue cuts down the runners of the
// formation it broke, as far as their edge of the field; one not set to pursue lets them go. Horse pursue by
// default, foot and crossbowmen do not (the owner, 2026-11-01).
import test from 'node:test';
import assert from 'node:assert/strict';
import { battle, tick, attack, members } from './m2-sim-helpers.mjs';
import { isM2UnitAlive } from '../../m2/M2_BattleState.js';
import { M2_MORALE_DEFINITION } from '../../m2/M2_Definitions.js';

let seq = 0;
const pursue = (b, formationId, value) => b.queue.enqueue({ commandId: `p${seq += 1}`, type: 'formation_set_pursuit', formationId, pursue: value }, b.state);
const run = (b, ticks, until = () => false) => { for (let i = 0; i < ticks && !until(); i += 1) tick(b); };
const running = (u) => isM2UnitAlive(u) && u.state === 'routing';
// Breaks a formation: every man's morale to nothing (the morale step sends them running).
const breakFormation = (b, formationId) => { for (const u of members(b, formationId)) u.morale = 0; tick(b); };
const near = (b, formationId, targetId, d) => {
  const at = (id) => { const m = members(b, id).filter(isM2UnitAlive); return { x: m.reduce((s, u) => s + u.position.x, 0) / m.length, z: m.reduce((s, u) => s + u.position.z, 0) / m.length }; };
  const a = at(formationId); const t = at(targetId);
  return Math.hypot(a.x - t.x, a.z - t.z) <= d;
};

// The horse sent at the enemy line; the line breaks as they come near. What the runners suffer after.
function chase({ pursuit = null, ticks = 400 } = {}) {
  const b = battle();
  if (pursuit !== null) assert.equal(pursue(b, 'ally_column', pursuit).ok, true);
  attack(b, 'ally_column', 'enemy_line');
  run(b, 400, () => near(b, 'ally_column', 'enemy_line', 6));
  breakFormation(b, 'enemy_line');
  const line = members(b, 'enemy_line');
  assert.ok(line.every((u) => running(u) || !isM2UnitAlive(u)), 'the line runs');
  const hp = line.reduce((s, u) => s + u.hp, 0);
  const from = b.events.length;
  let deepest = 0;
  for (let i = 0; i < ticks; i += 1) {
    tick(b);
    for (const u of members(b, 'ally_column')) deepest = Math.min(deepest, u.position.z);
  }
  const ids = new Set(line.map((u) => u.unitId));
  const after = b.events.slice(from);
  return {
    b,
    lost: hp - line.reduce((s, u) => s + u.hp, 0),
    killed: line.filter((u) => !isM2UnitAlive(u)).length,
    struckRunners: after.filter((e) => ids.has(e.targetUnitId)).length,
    runnersStruck: after.filter((e) => ids.has(e.sourceUnitId)).length,
    deepest,
  };
}

test('[m2.pursuit.default] horse pursue, foot and crossbowmen do not, unless the snapshot or an order says otherwise', () => {
  const b = battle();
  const f = (id) => b.state.getFormation(id);
  assert.equal(f('ally_column').pursuit, true);
  assert.equal(f('enemy_column').pursuit, true);
  for (const id of ['ally_line', 'ally_loose', 'enemy_line', 'enemy_loose']) assert.equal(f(id).pursuit, false, id);
  // The snapshot's choice.
  const set = battle({ formations: { ally_column: { pursuit: false }, ally_line: { pursuit: true } } });
  assert.equal(set.state.getFormation('ally_column').pursuit, false);
  assert.equal(set.state.getFormation('ally_line').pursuit, true);
  // An order changes it, and leaves the formation under its battle plan; only true or false is taken.
  b.state.getFormation('ally_line').underPlan = true;
  assert.equal(pursue(b, 'ally_line', true).ok, true);
  assert.equal(pursue(b, 'ally_line', 'yes').ok, false);
  tick(b);
  assert.equal(f('ally_line').pursuit, true);
  assert.equal(f('ally_line').underPlan, true);
  assert.equal(b.state.getSnapshot().formations.find((x) => x.formationId === 'ally_line').pursuit, true);
});

test('[m2.pursuit.cuts-down] horse set to pursue ride after the broken line and cut its runners down; not set, they let them go', () => {
  const on = chase();
  const off = chase({ pursuit: false });
  assert.ok(on.struckRunners > 0 && on.lost > 0, JSON.stringify({ struck: on.struckRunners, lost: on.lost }));
  assert.equal(off.struckRunners, 0);
  assert.equal(off.lost, 0);
  // A running man does not strike back.
  assert.equal(on.runnersStruck, 0);
});

test('[m2.pursuit.edge] pursuers ride no further than the runners\' edge of the field', () => {
  const { deepest } = chase({ ticks: 600 });
  const edge = M2_MORALE_DEFINITION.retreatEdgeZ;
  assert.ok(deepest < -edge + 4, `they rode after them (${deepest})`);
  assert.ok(deepest > -edge + 0.5, `and stopped short of the edge (${deepest})`);
  // Those who reach it have got away: the pursuers turn back to their places.

});

test('[m2.pursuit.archers] crossbowmen set to pursue shoot at the runners; not set, they do not', () => {
  const shots = (value) => {
    const b = battle();
    if (value !== null) assert.equal(pursue(b, 'ally_loose', value).ok, true);
    attack(b, 'ally_loose', 'enemy_line');
    run(b, 200);
    breakFormation(b, 'enemy_line');
    const from = b.bolts.length;
    const ids = new Set(members(b, 'enemy_line').map((u) => u.unitId));
    const hp = members(b, 'enemy_line').reduce((s, u) => s + u.hp, 0);
    run(b, 300);
    return {
      atRunners: b.bolts.slice(from).filter((x) => x.sideId === 'ally' && ids.has(x.aimedAt)).length,
      lost: hp - members(b, 'enemy_line').reduce((s, u) => s + u.hp, 0),
    };
  };
  const on = shots(true);
  const off = shots(null);
  assert.ok(on.atRunners > 0 && on.lost > 0, JSON.stringify(on));
  assert.deepEqual(off, { atRunners: 0, lost: 0 });
});

test('[m2.pursuit.enemy] the enemy\'s horse, pursuing, keep after a broken ally formation until its runners have got away', () => {
  const b = battle({ withAI: true });
  attack(b, 'ally_line', 'enemy_line');
  const prey = () => b.state.getFormation('enemy_column').order.targetFormationId;
  // Whichever ally formation the enemy horse ride at breaks as they reach it (once the enemy's battle plan
  // has given them their target: before that the commander's first choice may change).
  run(b, 600, () => b.state.tick > 60 && prey() && near(b, 'enemy_column', prey(), 6));
  const target = prey();
  assert.ok(target && near(b, 'enemy_column', target, 6), `reached ${target}`);
  breakFormation(b, target);
  assert.equal(prey(), target);
  const ids = new Set(members(b, target).map((u) => u.unitId));
  const from = b.events.length;
  let kept = 0;
  let away = 0;
  for (let i = 0; i < 300; i += 1) {
    tick(b);
    // (A runner who has reached his edge has got away.)
    if (!members(b, target).some((u) => running(u) && u.position.z < M2_MORALE_DEFINITION.retreatEdgeZ)) continue;
    if (prey() === target) kept += 1;
    else away += 1;
  }
  assert.ok(kept > 0 && away === 0, `kept after them ${kept}, turned away ${away}`);
  assert.ok(b.events.slice(from).some((e) => ids.has(e.targetUnitId) && b.state.getUnit(e.sourceUnitId).formationId === 'enemy_column'), 'and cut them down');
});

test('[m2.pursuit.hero] the hero can cut down a running enemy', () => {
  const b = battle();
  const hero = b.state.getUnit(b.state.playerCharacterId);
  const runner = members(b, 'enemy_line')[0];
  breakFormation(b, 'enemy_line');
  assert.ok(running(runner));
  // Beside him, in front.
  runner.position = { x: hero.position.x, y: 0, z: hero.position.z + 1 };
  runner.previousPosition = { ...runner.position };
  runner.routeTarget = { ...runner.position };
  const hp = runner.hp;
  b.queue.enqueue({ commandId: 'swing', type: 'player_melee_attack', actorUnitId: hero.unitId, aimHeading: 0 }, b.state);
  tick(b);
  assert.ok(runner.hp < hp, `${runner.hp} ${hp}`);
});
