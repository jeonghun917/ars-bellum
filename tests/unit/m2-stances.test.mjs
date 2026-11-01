// Formation stances in the 3D battle (m2/M2_Stances.js): shield wall, braced spears, wedge, hit and run,
// volley; as many as a formation's commander's tactics allow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COMMANDER_SHEETS } from '../../m2/M2_Commanders.js';
import { stancesFor } from '../../m2/M2_Stances.js';
import { battle, tick, attack, members } from './m2-sim-helpers.mjs';

const tactics = (kind, value) => ({ ...DEFAULT_COMMANDER_SHEETS[kind], skills: { ...DEFAULT_COMMANDER_SHEETS[kind].skills, tactics: value } });
const SKILLED = { ally_line: tactics('infantry', 70), enemy_line: tactics('infantry', 70), ally_column: tactics('cavalry', 70), enemy_column: tactics('cavalry', 70), ally_loose: tactics('crossbow', 70), enemy_loose: tactics('crossbow', 70) };
const setStance = (b, formationId, stanceId) => b.queue.enqueue({ commandId: `s_${formationId}_${stanceId}_${b.state.tick}`, type: 'formation_set_stance', formationId, stanceId }, b.state);

test('[m2.stance.slots] a formation can take only the stances its commander\'s tactics allow, or none', () => {
  const plain = battle();
  assert.deepEqual(stancesFor(plain.state.getFormation('ally_line')), ['shield_wall']);
  assert.deepEqual(stancesFor(plain.state.getFormation('ally_column')), ['wedge']);
  assert.deepEqual(stancesFor(plain.state.getFormation('ally_loose')), ['volley']);
  const skilled = battle({ commanderSheets: SKILLED });
  assert.deepEqual(stancesFor(skilled.state.getFormation('ally_line')), ['shield_wall', 'spear_brace']);
  assert.deepEqual(stancesFor(skilled.state.getFormation('ally_column')), ['wedge', 'hit_and_run']);
  assert.equal(setStance(plain, 'ally_line', 'spear_brace').error, 'm2_command_stance_not_available');
  assert.equal(setStance(plain, 'ally_line', 'wedge').error, 'm2_command_stance_not_available');
  assert.equal(setStance(plain, 'ally_line', 'shield_wall').ok, true);
  tick(plain);
  assert.equal(plain.state.getFormation('ally_line').stance, 'shield_wall');
  assert.equal(setStance(plain, 'ally_line', null).ok, true);
  tick(plain);
  assert.equal(plain.state.getFormation('ally_line').stance, null);
});

test('[m2.stance.shield-wall] in a shield wall the men take less from bolts in front of them, and move at half pace', () => {
  const run = (wall) => {
    const b = battle();
    // The ally crossbowmen and horsemen stand well away, so the enemy crossbowmen shoot at the line; the
    // line turns to face them.
    for (const id of ['ally_loose', 'ally_column']) {
      for (const u of members(b, id)) { u.position.x -= 40; u.position.z += 40; u.slotTarget = null; }
    }
    // (And the player's hero, who would otherwise stand in front and take the bolts himself.)
    const hero = b.state.getUnit(b.state.playerCharacterId);
    hero.position.x -= 40;
    hero.position.z += 40;
    b.formation.updateSlots = () => {};
    const line = b.state.getFormation('ally_line');
    const shooters = b.state.getFormation('enemy_loose');
    const facing = Math.atan2(shooters.anchor.x - line.anchor.x, shooters.anchor.z - line.anchor.z);
    for (const u of members(b, 'ally_line')) { u.heading = facing; u.slotTarget = { x: u.position.x, z: u.position.z }; }
    if (wall) setStance(b, 'ally_line', 'shield_wall');
    tick(b);
    attack(b, 'enemy_loose', 'ally_line');
    for (let i = 0; i < 400; i += 1) tick(b);
    const taken = b.events.filter((e) => e.damageEventId.startsWith('projectile:') && b.state.getUnit(e.targetUnitId).formationId === 'ally_line');
    return { hits: taken.length, each: taken.reduce((s, e) => s + e.damage, 0) / Math.max(1, taken.length) };
  };
  const open = run(false);
  const walled = run(true);
  assert.ok(open.hits > 5 && walled.hits > 5, JSON.stringify({ open, walled }));
  assert.ok(walled.each <= open.each * 0.7, JSON.stringify({ open, walled }));
  const b = battle();
  setStance(b, 'ally_line', 'shield_wall');
  b.queue.enqueue({ commandId: 'mv', type: 'formation_move', formationId: 'ally_line', target: { x: -5, z: 25 } }, b.state);
  // The line's middle speed (a man shoved by a passing comrade moves fast for a moment).
  let fastest = 0;
  for (let i = 0; i < 60; i += 1) {
    tick(b);
    const speeds = members(b, 'ally_line').map((u) => Math.hypot(u.velocity.x, u.velocity.z)).sort((p, q) => p - q);
    fastest = Math.max(fastest, speeds[Math.floor(speeds.length / 2)]);
  }
  assert.ok(fastest <= 1.6 + 1e-9, `${fastest}`);
});

test('[m2.stance.spear-brace] braced spears break a cavalry charge and hit the horsemen hard', () => {
  const run = (brace) => {
    const b = battle({ commanderSheets: SKILLED });
    // The enemy line turns to face the horsemen (braced spears guard only their front).
    const line = b.state.getFormation('enemy_line');
    const column = b.state.getFormation('ally_column');
    line.facing = Math.atan2(column.anchor.x - line.anchor.x, column.anchor.z - line.anchor.z);
    b.formation.updateSlots(b.state);
    for (const u of members(b, 'enemy_line')) { u.position.x = u.slotTarget.x; u.position.z = u.slotTarget.z; u.heading = line.facing; }
    // The rest of the enemy stands well away, so the horsemen meet only the line.
    for (const id of ['enemy_loose', 'enemy_column']) {
      const f = b.state.getFormation(id);
      f.anchor = { x: f.anchor.x + 40, z: f.anchor.z - 40 };
      for (const u of members(b, id)) { u.position.x += 40; u.position.z -= 40; u.slotTarget = null; }
    }
    b.formation.updateSlots(b.state);
    if (brace) setStance(b, 'enemy_line', 'spear_brace');
    tick(b);
    attack(b, 'ally_column', 'enemy_line');
    for (let i = 0; i < 300; i += 1) tick(b);
    // Blows of the line's men (not its commander) on horsemen riding in: a braced spear strikes three times
    // as hard (3 x 3 = 9; a horse's armor is its hit points, so the blow lands whole).
    const meeting = b.events.filter((e) => {
      const source = b.state.getUnit(e.sourceUnitId);
      return b.state.getUnit(e.targetUnitId).kindId === 'cavalry' && source.formationId === 'enemy_line' && !source.commander && e.damage >= 9;
    });
    return { charges: b.combat.getObservation(b.state).chargeHitCount, meeting: meeting.length };
  };
  const open = run(false);
  const braced = run(true);
  assert.ok(open.charges > 0 && braced.charges < open.charges, JSON.stringify({ open, braced }));
  assert.equal(open.meeting, 0);
  assert.ok(braced.meeting > 0, JSON.stringify({ open, braced }));
});

test('[m2.stance.wedge] a wedge charges harder', () => {
  const chargeBlows = (wedge) => {
    const b = battle();
    if (wedge) setStance(b, 'ally_column', 'wedge');
    tick(b);
    attack(b, 'ally_column', 'enemy_line');
    for (let i = 0; i < 200; i += 1) tick(b);
    return Math.max(...b.events.filter((e) => b.state.getUnit(e.sourceUnitId).formationId === 'ally_column').map((e) => e.damage));
  };
  const open = chargeBlows(false);
  const wedge = chargeBlows(true);
  assert.ok(wedge >= open * 1.25, JSON.stringify({ open, wedge }));
});

test('[m2.stance.hit-and-run] horsemen who hit and run wheel away after a charge and charge again', () => {
  const run = (hitAndRun) => {
    const b = battle({ commanderSheets: SKILLED });
    if (hitAndRun) setStance(b, 'ally_column', 'hit_and_run');
    tick(b);
    attack(b, 'ally_column', 'enemy_line');
    let wheeled = 0;
    for (let i = 0; i < 600; i += 1) {
      tick(b);
      wheeled += members(b, 'ally_column').filter((u) => u.withdrawTo).length > 0 ? 1 : 0;
    }
    return { charges: b.combat.getObservation(b.state).chargeHitCount, wheeled };
  };
  const stay = run(false);
  const raid = run(true);
  assert.equal(stay.wheeled, 0);
  assert.ok(raid.wheeled > 0);
  assert.ok(raid.charges > stay.charges, JSON.stringify({ stay, raid }));
});

test('[m2.stance.volley] crossbowmen in a volley loose together, and their bolts strike harder', () => {
  const run = (volley) => {
    const b = battle();
    if (volley) setStance(b, 'ally_loose', 'volley');
    tick(b);
    // The men are at different points of spanning their crossbows (without this they would all start
    // loaded and loose together anyway).
    members(b, 'ally_loose').forEach((u, i) => { u.attackCooldownTicks = 1 + i * 13; });
    attack(b, 'ally_loose', 'enemy_line');
    for (let i = 0; i < 400; i += 1) tick(b);
    const ticks = new Set(b.bolts.filter((x) => x.sideId === 'ally').map((x) => x.tick));
    const hits = b.events.filter((e) => e.damageEventId.startsWith('projectile:bolt') && b.state.getUnit(e.sourceUnitId).sideId === 'ally');
    return { volleys: ticks.size, shots: b.bolts.filter((x) => x.sideId === 'ally').length, best: Math.max(...hits.map((e) => e.damage)) };
  };
  const free = run(false);
  const volley = run(true);
  // Every shot of a volley in the same tick: as many volleys as reloads, each of the whole formation.
  assert.ok(volley.shots / volley.volleys >= 4, JSON.stringify(volley));
  assert.ok(volley.best > free.best, JSON.stringify({ free, volley }));
});

test('[m2.stance.enemy-uses] the enemy commander takes stances: shields up on the way in, braced spears against horse, a wedge', () => {
  const b = battle({ withAI: true });
  attack(b, 'ally_column', 'enemy_line');
  tick(b);
  tick(b);
  assert.equal(b.state.getFormation('enemy_column').stance, 'wedge');
  assert.equal(b.state.getFormation('enemy_loose').stance, 'volley');
  const skilled = battle({ withAI: true, commanderSheets: SKILLED });
  attack(skilled, 'ally_column', 'enemy_line');
  for (let i = 0; i < 60; i += 1) tick(skilled);
  assert.equal(skilled.state.getFormation('enemy_column').stance, 'hit_and_run');
  assert.equal(skilled.state.getFormation('enemy_line').stance, 'spear_brace');
});
