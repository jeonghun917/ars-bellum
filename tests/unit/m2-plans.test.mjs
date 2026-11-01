// Battle plans (m2/M2_Plans.js): how a whole side uses its formations together, by the kinds it has.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COMMANDER_SHEETS } from '../../m2/M2_Commanders.js';
import { plansFor } from '../../m2/M2_Plans.js';
import { battle, tick, members } from './m2-sim-helpers.mjs';

const skilled = (kind) => ({ ...DEFAULT_COMMANDER_SHEETS[kind], skills: { ...DEFAULT_COMMANDER_SHEETS[kind].skills, tactics: 100 } });
const ALL_PLANS = { ally_line: skilled('infantry'), ally_column: skilled('cavalry'), ally_loose: skilled('crossbow') };
let seq = 0;
const plan = (b, planId) => b.queue.enqueue({ commandId: `plan${seq += 1}`, type: 'army_set_plan', planId }, b.state);
const f = (b, id) => b.state.getFormation(id);
const kill = (b, id) => { for (const u of members(b, id)) { u.hp = 0; u.state = 'incapacitated'; } };
const centre = (b, id) => {
  const alive = members(b, id).filter((u) => u.hp > 0 && u.state !== 'incapacitated');
  return { x: alive.reduce((s, u) => s + u.position.x, 0) / alive.length, z: alive.reduce((s, u) => s + u.position.z, 0) / alive.length };
};
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// The enemy stands back from the allies (so plans have room to unfold).
const standBack = (b, dz = -20) => {
  for (const id of ['enemy_line', 'enemy_column', 'enemy_loose']) {
    const formation = f(b, id);
    formation.anchor = { x: formation.anchor.x, z: formation.anchor.z + dz };
    for (const u of members(b, id)) { u.position.z += dz; u.previousPosition = { ...u.position }; }
  }
};

test('[m2.plan.available] a side can use frontal push, and two plans for each of its best commander\'s tactic slots, of those its kinds allow', () => {
  const ordinary = battle();
  assert.deepEqual(plansFor(ordinary.state, 'ally'), ['frontal_push', 'anvil_hammer', 'shoot_then_charge']);
  const great = battle({ commanderSheets: ALL_PLANS });
  assert.deepEqual(plansFor(great.state, 'ally'), ['frontal_push', 'anvil_hammer', 'shoot_then_charge', 'screen_archers', 'defend_counter', 'double_envelopment', 'feigned_retreat']);
  // Without horse, nothing that needs horse.
  kill(great, 'ally_column');
  assert.deepEqual(plansFor(great.state, 'ally'), ['frontal_push', 'shoot_then_charge']);
  assert.equal(plan(ordinary, 'feigned_retreat').error, 'm2_command_plan_not_available');
  assert.equal(plan(ordinary, 'anvil_hammer').ok, true);
  tick(ordinary);
  assert.equal(ordinary.state.getPlan('ally').planId, 'anvil_hammer');
  assert.ok(['ally_line', 'ally_column', 'ally_loose'].every((id) => f(ordinary, id).underPlan));
});

test('[m2.plan.anvil-hammer] the foot attack the enemy\'s nearest formation; the horse go round and strike it from behind', () => {
  const b = battle({ commanderSheets: ALL_PLANS });
  standBack(b);
  plan(b, 'anvil_hammer');
  tick(b);
  const target = f(b, 'ally_line').order.targetFormationId;
  assert.equal(f(b, 'ally_line').order.type, 'attack_target');
  assert.equal(f(b, 'ally_column').order.targetFormationId, target);
  assert.equal(f(b, 'ally_column').tactic, 'flank');
  // The hammer comes from behind the anvil's target.
  for (let i = 0; i < 1200; i += 1) {
    tick(b);
    const blow = b.events.find((e) => b.state.getUnit(e.sourceUnitId).formationId === 'ally_column' && b.state.getUnit(e.targetUnitId).formationId === target);
    if (blow) {
      const a = b.state.getUnit(blow.sourceUnitId);
      const t = b.state.getUnit(blow.targetUnitId);
      const from = Math.atan2(a.position.x - t.position.x, a.position.z - t.position.z);
      const round = Math.abs(Math.atan2(Math.sin(from - f(b, target).facing), Math.cos(from - f(b, target).facing)));
      assert.ok(round > Math.PI / 2, `struck from ${round} off the target's front`);
      return;
    }
  }
  assert.fail('the horse never struck');
});

test('[m2.plan.shoot-then-charge] the foot wait in a shield wall while the crossbows shoot, and charge once the target has lost a third', () => {
  const b = battle({ commanderSheets: ALL_PLANS });
  standBack(b);
  plan(b, 'shoot_then_charge');
  tick(b);
  assert.equal(f(b, 'ally_line').order.type, 'hold');
  assert.equal(f(b, 'ally_line').formationTypeId, 'shield_wall');
  assert.equal(f(b, 'ally_loose').order.type, 'attack_target');
  const target = f(b, 'ally_loose').order.targetFormationId;
  // A third of the target falls: the foot go in.
  const victims = members(b, target).slice(0, Math.ceil(members(b, target).length / 3));
  for (const u of victims) { u.hp = 0; u.state = 'incapacitated'; }
  tick(b);
  assert.equal(f(b, 'ally_line').order.type, 'attack_target');
  assert.equal(f(b, 'ally_line').tactic, 'charge');
});

test('[m2.plan.screen-archers] the horse keep by the crossbows and charge whatever comes within 10 m of them', () => {
  const b = battle({ commanderSheets: ALL_PLANS });
  standBack(b, -25);
  plan(b, 'screen_archers');
  for (let i = 0; i < 100; i += 1) tick(b);
  assert.equal(f(b, 'ally_column').order.type, 'move');
  assert.ok(gap(centre(b, 'ally_column'), centre(b, 'ally_loose')) < 12, 'beside the crossbows');
  // An enemy formation comes at the crossbows.
  const raider = f(b, 'enemy_line');
  const bows = centre(b, 'ally_loose');
  for (const u of members(b, 'enemy_line')) { u.position.x = bows.x + 5 + (u.position.x - raider.anchor.x) * 0.2; u.position.z = bows.z - 5; }
  raider.anchor = { x: bows.x + 5, z: bows.z - 5 };
  tick(b);
  assert.equal(f(b, 'ally_column').order.type, 'attack_target');
  assert.equal(f(b, 'ally_column').order.targetFormationId, 'enemy_line');
});

test('[m2.plan.defend-counter] the foot hold in a shield wall and the horse wait behind them, until the enemy is locked with the foot', () => {
  const b = battle({ commanderSheets: ALL_PLANS });
  standBack(b, -25);
  plan(b, 'defend_counter');
  for (let i = 0; i < 60; i += 1) tick(b);
  assert.equal(f(b, 'ally_line').order.type, 'hold');
  assert.equal(f(b, 'ally_line').formationTypeId, 'shield_wall');
  assert.equal(f(b, 'ally_column').order.type, 'move');
  // The enemy foot come up against the wall.
  const wall = centre(b, 'ally_line');
  const attacker = f(b, 'enemy_line');
  for (const u of members(b, 'enemy_line')) { u.position.x = wall.x + (u.position.x - attacker.anchor.x); u.position.z = wall.z - 3; }
  attacker.anchor = { x: wall.x, z: wall.z - 3 };
  tick(b);
  assert.equal(f(b, 'ally_column').order.type, 'attack_target');
  assert.equal(f(b, 'ally_column').order.targetFormationId, 'enemy_line');
  assert.equal(f(b, 'ally_column').tactic, 'flank');
});

test('[m2.plan.double-envelopment] the foot take the front; two other formations go round it, one on each side', () => {
  const b = battle({ commanderSheets: ALL_PLANS });
  standBack(b);
  plan(b, 'double_envelopment');
  tick(b);
  const target = f(b, 'ally_line').order.targetFormationId;
  const wings = ['ally_column', 'ally_loose'].map((id) => f(b, id));
  for (const wing of wings) assert.equal(wing.order.targetFormationId, target);
  assert.deepEqual(wings.map((w) => w.flankSide).sort(), [-1, 1]);
  assert.equal(f(b, 'ally_column').tactic, 'flank');
});

test('[m2.plan.feigned-retreat] the horse ride in, fall back behind their own foot, and charge again', () => {
  const b = battle({ commanderSheets: ALL_PLANS });
  standBack(b);
  plan(b, 'feigned_retreat');
  const stages = [];
  let again = null;
  for (let i = 0; i < 2400 && !again; i += 1) {
    tick(b);
    const stage = b.state.getPlan('ally').stage;
    if (stages.at(-1) !== stage) stages.push(stage);
    if (stage === 1) assert.equal(f(b, 'ally_column').order.type, 'move', 'falling back');
    // Charging again (looked at as it starts: the fight after may break them, and they withdraw).
    if (stage === 2) { tick(b); again = f(b, 'ally_column').order.type; }
  }
  assert.deepEqual(stages, [0, 1, 2]);
  assert.equal(again, 'attack_target');
  assert.equal(f(b, 'ally_line').formationTypeId, 'shield_wall');
});

test('[m2.plan.by-hand] a formation the player orders by hand leaves the plan; the others carry on', () => {
  const b = battle({ commanderSheets: ALL_PLANS });
  standBack(b);
  plan(b, 'anvil_hammer');
  tick(b);
  b.queue.enqueue({ commandId: 'manual', type: 'formation_move', formationId: 'ally_column', target: { x: -20, z: 10 } }, b.state);
  for (let i = 0; i < 40; i += 1) tick(b);
  assert.equal(f(b, 'ally_column').underPlan, false);
  assert.equal(f(b, 'ally_column').order.type, 'move');
  assert.equal(f(b, 'ally_line').underPlan, true);
  assert.equal(f(b, 'ally_line').order.type, 'attack_target');
  // No plan: the side goes back to plain orders.
  plan(b, null);
  tick(b);
  assert.equal(b.state.getPlan('ally'), null);
});

test('[m2.plan.enemy-picks] the enemy commander picks the best plan his commanders know for what he has', () => {
  const b = battle({ withAI: true });
  b.queue.enqueue({ commandId: 'go', type: 'formation_attack', formationId: 'ally_line', targetFormationId: 'enemy_line' }, b.state);
  tick(b);
  tick(b);
  assert.equal(b.state.getPlan('enemy').planId, 'anvil_hammer');
  // Without his horse, he cannot use it.
  const c = battle({ withAI: true });
  kill(c, 'enemy_column');
  c.queue.enqueue({ commandId: 'go', type: 'formation_attack', formationId: 'ally_line', targetFormationId: 'enemy_line' }, c.state);
  tick(c);
  tick(c);
  assert.equal(c.state.getPlan('enemy').planId, 'shoot_then_charge');
});

test('[m2.plan.deterministic] the same plans give the same battle', () => {
  const run = () => {
    const b = battle({ withAI: true, commanderSheets: ALL_PLANS });
    plan(b, 'feigned_retreat');
    for (let i = 0; i < 800; i += 1) tick(b);
    return JSON.stringify(b.state.getSnapshot());
  };
  assert.equal(run(), run());
});
