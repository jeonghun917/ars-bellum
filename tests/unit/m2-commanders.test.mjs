// Formations' commanders (부대장) in the 3D battle (m2/M2_Commanders.js): men of their own, whose command skills
// steady their formations and whose fall shakes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isM2UnitAlive } from '../../m2/M2_BattleState.js';
import { DEFAULT_COMMANDER_SHEETS } from '../../m2/M2_Commanders.js';
import { M2_MORALE_DEFINITION } from '../../m2/M2_Definitions.js';
import { battle, tick, members } from './m2-sim-helpers.mjs';
import { newGameState, PLAYER_CHARACTER_ID } from '../../src/game/new-game.js';
import { buildHeroSheet } from '../../src/game/battle-hero.js';

const withSkills = (kind, skills) => ({ ...DEFAULT_COMMANDER_SHEETS[kind], skills: { ...DEFAULT_COMMANDER_SHEETS[kind].skills, ...skills } });
const kill = (u) => { u.hp = 0; u.state = 'incapacitated'; };
const meanMorale = (b, formationId) => {
  const alive = members(b, formationId).filter(isM2UnitAlive);
  return alive.reduce((s, u) => s + u.morale, 0) / alive.length;
};

test('[m2.commander.own-man] each formation\'s commander carries his own sheet: his gear, his skills, a horse if he leads horsemen', () => {
  const b = battle();
  for (const id of b.state.getFormationIdsStable()) {
    const f = b.state.getFormation(id);
    const c = b.state.getUnit(f.commanderUnitId);
    assert.ok(c.commander, id);
    assert.equal(f.command.commanderUnitId, c.unitId);
    assert.equal(c.maxHp, c.commander.combat.maxHp);
    assert.ok(c.armor > 0, 'he wears armor');
    const soldier = members(b, id).find((u) => u !== c && !u.commander);
    assert.equal(soldier.commander, null);
  }
  assert.equal(b.state.getUnit(b.state.getFormation('ally_column').commanderUnitId).commander.combat.mounted, true);
  assert.equal(b.state.getUnit(b.state.getFormation('ally_line').commanderUnitId).commander.combat.mounted, false);
});

test('[m2.commander.leadership] a formation led by a commander of high leadership holds higher morale', () => {
  const run = (leadership) => {
    const b = battle({ commanderSheets: { ally_line: withSkills('infantry', { leadership }) } });
    for (let i = 0; i < 100; i += 1) tick(b);
    return meanMorale(b, 'ally_line');
  };
  const poor = run(0);
  const ordinary = run(40);
  const great = run(100);
  assert.ok(great - ordinary >= 4 && ordinary - poor >= 3, JSON.stringify({ poor, ordinary, great }));
});

test('[m2.commander.command] under a commander of high command the same losses weigh less', () => {
  const run = (command) => {
    const b = battle({ commanderSheets: { ally_column: withSkills('cavalry', { command }) } });
    tick(b);
    const f = b.state.getFormation('ally_column');
    for (const u of members(b, 'ally_column').filter((x) => x.unitId !== f.commanderUnitId).slice(0, 3)) kill(u);
    for (let i = 0; i < 200; i += 1) tick(b);
    return meanMorale(b, 'ally_column');
  };
  const poor = run(0);
  const great = run(100);
  assert.ok(great - poor >= 6, JSON.stringify({ poor, great }));
});

test('[m2.commander.falls] when the commander falls his men are shaken, and the next man leads them on', () => {
  const run = (killCommander) => {
    const b = battle();
    tick(b);
    const f = b.state.getFormation('ally_line');
    const victim = killCommander ? b.state.getUnit(f.commanderUnitId) : members(b, 'ally_line').find((u) => u.unitId !== f.commanderUnitId);
    kill(victim);
    for (let i = 0; i < 200; i += 1) tick(b);
    return { b, morale: meanMorale(b, 'ally_line') };
  };
  const lostCommander = run(true);
  const lostSoldier = run(false);
  assert.ok(lostSoldier.morale - lostCommander.morale >= M2_MORALE_DEFINITION.commanderLostPenalty * 0.8,
    JSON.stringify({ commander: lostCommander.morale, soldier: lostSoldier.morale }));
  // The formation can still be rallied with its commander gone.
  const b = lostCommander.b;
  const f = b.state.getFormation('ally_line');
  for (const u of members(b, 'ally_line').filter(isM2UnitAlive)) { u.state = 'routing'; u.routeTarget = { x: u.position.x, z: 18 }; u.morale = 30; }
  f.order = { type: 'rally', target: null, targetFormationId: null, commandId: 'r' };
  tick(b);
  assert.ok(members(b, 'ally_line').filter(isM2UnitAlive).every((u) => u.morale > 30), 'rallying');
});

test('[m2.commander.tactics] a commander\'s tactics skill sets how many plans his formation can carry out', () => {
  const slots = (tactics) => battle({ commanderSheets: { ally_line: withSkills('infantry', { tactics }) } }).state.getFormation('ally_line').command.tacticSlots;
  assert.deepEqual([slots(0), slots(33), slots(34), slots(67), slots(100)], [1, 1, 2, 2, 3]);
});

test('[m2.commander.strikes-with-his-weapon] a commander fights with his own weapon, harder than his men', () => {
  const b = battle({ withAI: true });
  const r = b.queue.enqueue({ commandId: 'a', type: 'formation_attack', formationId: 'ally_line', targetFormationId: 'enemy_line' }, b.state);
  assert.equal(r.ok, true);
  for (let i = 0; i < 600; i += 1) tick(b);
  const by = (pred) => b.events.filter((e) => e.damageEventId.startsWith('auto_melee:') && pred(b.state.getUnit(e.sourceUnitId)));
  const commanders = by((u) => u.commander && u.kindId === 'infantry');
  const soldiers = by((u) => !u.commander && u.kindId === 'infantry');
  assert.ok(commanders.length > 0 && soldiers.length > 0);
  const avg = (list) => list.reduce((s, e) => s + e.damage, 0) / list.length;
  assert.ok(avg(commanders) > avg(soldiers) * 2, JSON.stringify({ commanders: avg(commanders), soldiers: avg(soldiers) }));
});

test('[m2.commander.from-campaign] a character\'s command skills reach the battle in his sheet', () => {
  const state = newGameState();
  Object.assign(state.world.characters[PLAYER_CHARACTER_ID].skills, { command: 70, leadership: 55, tactics: 80 });
  const sheet = buildHeroSheet(state, PLAYER_CHARACTER_ID);
  const b = battle({ commanderSheets: { ally_line: sheet } });
  assert.deepEqual(b.state.getFormation('ally_line').command, { commanderUnitId: b.state.getFormation('ally_line').commanderUnitId, command: 70, leadership: 55, tactics: 80, tacticSlots: 3 });
});
