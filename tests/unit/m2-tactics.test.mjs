// Formation shapes (line, column, loose, shield wall, wedge, ring) and formation orders (charge, braced spears,
// hit and run, flank; hold fire, focused fire, volley, skirmish) in the 3D battle (m2/M2_FormationSystem.js,
// m2/M2_Orders.js). None of them makes a blow or a bolt stronger: what they change is what the men do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COMMANDER_SHEETS } from '../../m2/M2_Commanders.js';
import { calculateFormationSlots, formationTypesFor } from '../../m2/M2_FormationSystem.js';
import { ordersFor } from '../../m2/M2_Orders.js';
import { battle, tick, attack, members } from './m2-sim-helpers.mjs';

const tactics = (kind, value) => ({ ...DEFAULT_COMMANDER_SHEETS[kind], skills: { ...DEFAULT_COMMANDER_SHEETS[kind].skills, tactics: value } });
const SKILLED = Object.fromEntries(['ally', 'enemy'].flatMap((side) => [
  [`${side}_line`, tactics('infantry', 70)], [`${side}_column`, tactics('cavalry', 70)], [`${side}_loose`, tactics('crossbow', 70)],
]));
let seq = 0;
const order = (b, formationId, tacticId) => b.queue.enqueue({ commandId: `t${seq += 1}`, type: 'formation_set_tactic', formationId, tacticId }, b.state);
const shape = (b, formationId, formationTypeId) => b.queue.enqueue({ commandId: `f${seq += 1}`, type: 'formation_set_type', formationId, formationTypeId }, b.state);
const units = (b) => b.state.getUnitIdsStable().map((id) => b.state.getUnit(id));
// Moves a formation (and its men) by (dx, dz), and keeps it there.
const shift = (b, formationId, dx, dz) => {
  const f = b.state.getFormation(formationId);
  f.anchor = { x: f.anchor.x + dx, z: f.anchor.z + dz };
  for (const u of members(b, formationId)) { u.position.x += dx; u.position.z += dz; u.previousPosition = { ...u.position }; }
};
const parkHero = (b) => { const h = b.state.getUnit(b.state.playerCharacterId); h.position.x -= 60; h.position.z += 60; };

test('[m2.shape.kinds] each kind takes only its shapes, and each shape stands as it should', () => {
  const b = battle();
  assert.deepEqual(formationTypesFor(b.state.getFormation('ally_line')), ['line', 'column', 'loose', 'shield_wall', 'wedge', 'circle']);
  assert.deepEqual(formationTypesFor(b.state.getFormation('ally_column')), ['line', 'column', 'loose', 'wedge']);
  assert.equal(shape(b, 'ally_column', 'shield_wall').error, 'm2_command_invalid_formation_type');
  assert.equal(shape(b, 'ally_line', 'shield_wall').ok, true);
  const f = { anchor: { x: 0, z: 0 }, facing: 0, spacing: 1.25 };
  const ids = Array.from({ length: 9 }, (_, i) => `u${i}`);
  const wall = [...calculateFormationSlots({ ...f, formationTypeId: 'shield_wall' }, ids).values()];
  assert.deepEqual([...new Set(wall.map((s) => s.z.toFixed(2)))], ['0.00', '-0.75', '-1.50'], 'three ranks, 0.75 m apart');
  const wedge = [...calculateFormationSlots({ ...f, formationTypeId: 'wedge' }, ids).values()];
  assert.equal(wedge.filter((s) => s.z === 0).length, 1, 'one man at the point');
  assert.ok(wedge.every((s) => s.z <= 0));
  const ring = [...calculateFormationSlots({ ...f, formationTypeId: 'circle' }, ids).values()];
  for (const s of ring) assert.ok(Math.abs(Math.atan2(s.x, s.z) - Math.atan2(Math.sin(s.facing), Math.cos(s.facing))) < 1e-9, 'facing out');
});

test('[m2.shape.shield-wall] a shield wall keeps its shields up at a walk and takes less from the bolts in front of it', () => {
  const run = (wall) => {
    const b = battle();
    shift(b, 'ally_loose', -40, 40);
    shift(b, 'ally_column', -40, 40);
    parkHero(b);
    const line = b.state.getFormation('ally_line');
    const shooters = b.state.getFormation('enemy_loose');
    line.facing = Math.atan2(shooters.anchor.x - line.anchor.x, shooters.anchor.z - line.anchor.z);
    if (wall) shape(b, 'ally_line', 'shield_wall');
    for (let i = 0; i < 60; i += 1) tick(b);
    attack(b, 'enemy_loose', 'ally_line');
    for (let i = 0; i < 400; i += 1) tick(b);
    const taken = b.events.filter((e) => e.damageEventId.startsWith('projectile:') && b.state.getUnit(e.targetUnitId).formationId === 'ally_line');
    return { b, hits: taken.length, each: taken.reduce((s, e) => s + e.damage, 0) / Math.max(1, taken.length) };
  };
  const open = run(false);
  const walled = run(true);
  assert.ok(open.hits > 5 && walled.hits > 5, JSON.stringify({ open: open.hits, walled: walled.hits }));
  assert.ok(walled.each < open.each * 0.7, JSON.stringify({ open: open.each, walled: walled.each }));
  assert.ok(members(walled.b, 'ally_line').some((u) => u.blocking));
});

test('[m2.order.slots] charge and hold fire any formation can be given; the rest as its commander\'s tactics allow', () => {
  const plain = battle();
  assert.deepEqual(ordersFor(plain.state.getFormation('ally_line')), ['charge', 'spear_brace']);
  assert.deepEqual(ordersFor(plain.state.getFormation('ally_column')), ['charge', 'hit_and_run']);
  assert.deepEqual(ordersFor(plain.state.getFormation('ally_loose')), ['hold_fire', 'focus_fire']);
  const skilled = battle({ commanderSheets: SKILLED });
  assert.deepEqual(ordersFor(skilled.state.getFormation('ally_line')), ['charge', 'spear_brace', 'flank']);
  assert.deepEqual(ordersFor(skilled.state.getFormation('ally_loose')), ['hold_fire', 'focus_fire', 'volley', 'skirmish']);
  assert.equal(order(plain, 'ally_line', 'flank').error, 'm2_command_tactic_not_available');
  assert.equal(order(plain, 'ally_line', 'volley').error, 'm2_command_tactic_not_available');
  assert.equal(order(plain, 'ally_line', 'charge').ok, true);
  tick(plain);
  assert.equal(plain.state.getFormation('ally_line').tactic, 'charge');
  assert.equal(order(plain, 'ally_line', null).ok, true);
  tick(plain);
  assert.equal(plain.state.getFormation('ally_line').tactic, null);
});

test('[m2.order.no-added-effects] no order or shape makes a blow, a charge or a bolt stronger', () => {
  // One soldier (not a commander) of `formationId` facing one enemy soldier; everyone else far off. The first
  // blow he strikes, under each shape and order.
  const firstBlow = (formationId, { shapeId = null, tacticId = null, runUp = false } = {}) => {
    const b = battle({ commanderSheets: SKILLED });
    const f = b.state.getFormation(formationId);
    const man = members(b, formationId).find((u) => u.unitId !== f.commanderUnitId);
    const foe = members(b, 'enemy_line').find((u) => u.unitId !== b.state.getFormation('enemy_line').commanderUnitId);
    for (const u of units(b)) if (u !== man && u !== foe) { u.position = { x: 200 + Number(u.unitId.slice(-2)) * 3, y: 0, z: 200 }; u.slotTarget = null; }
    if (shapeId) f.formationTypeId = shapeId;
    f.tactic = tacticId;
    // Sent against the enemy line (so he goes in at full pace), but making for the place set here.
    f.order = { type: 'attack_target', target: null, targetFormationId: 'enemy_line', commandId: 'test' };
    b.formation.updateSlots = () => {};
    foe.position = { x: 0, y: 0, z: 0 };
    foe.slotTarget = { x: 0, z: 0 };
    man.position = { x: 0, y: 0, z: runUp ? -20 : -1.2 };
    man.slotTarget = { x: 0, z: 1 };
    man.heading = 0;
    for (let i = 0; i < 200; i += 1) {
      const events = tick(b);
      const blow = events.find((e) => e.sourceUnitId === man.unitId);
      if (blow) return blow.damage;
    }
    return null;
  };
  const foot = firstBlow('ally_line');
  assert.equal(foot, 3);
  for (const setting of [{ shapeId: 'shield_wall' }, { shapeId: 'wedge' }, { shapeId: 'circle' }, { tacticId: 'charge' }, { tacticId: 'spear_brace' }, { tacticId: 'flank' }]) {
    assert.equal(firstBlow('ally_line', setting), foot, JSON.stringify(setting));
  }
  const charge = firstBlow('ally_column', { runUp: true });
  assert.equal(charge, 10, 'a charge: 4 x 2.5');
  for (const setting of [{ shapeId: 'wedge' }, { tacticId: 'hit_and_run' }, { tacticId: 'charge' }, { tacticId: 'flank' }]) {
    assert.equal(firstBlow('ally_column', { ...setting, runUp: true }), charge, JSON.stringify(setting));
  }
  // The first bolt of crossbowmen ordered to attack, under each order.
  const firstBolt = (tacticId) => {
    const b = battle({ commanderSheets: SKILLED });
    b.state.getFormation('ally_loose').tactic = tacticId;
    attack(b, 'ally_loose', 'enemy_line');
    for (let i = 0; i < 300; i += 1) {
      const hit = tick(b).find((e) => e.damageEventId.startsWith('projectile:bolt') && b.state.getUnit(e.sourceUnitId).formationId === 'ally_loose' && !b.state.getUnit(e.targetUnitId).commander);
      if (hit) return hit.damage;
    }
    return null;
  };
  assert.equal(firstBolt(null), 8);
  for (const tacticId of ['focus_fire', 'volley', 'skirmish']) assert.equal(firstBolt(tacticId), 8, tacticId);
});

test('[m2.order.charge] under a charge the men run straight at the enemy instead of keeping their places', () => {
  const firstBlow = (charge) => {
    const b = battle();
    shift(b, 'enemy_line', 0, -20);
    if (charge) order(b, 'ally_line', 'charge');
    tick(b);
    attack(b, 'ally_line', 'enemy_line');
    for (let i = 0; i < 600; i += 1) {
      tick(b);
      if (b.events.some((e) => e.damageEventId.startsWith('auto_melee:') && b.state.getUnit(e.sourceUnitId).formationId === 'ally_line')) return { tick: i, cohesion: b.state.getFormation('ally_line').cohesion };
    }
    return { tick: Infinity };
  };
  const formed = firstBlow(false);
  const charging = firstBlow(true);
  assert.ok(charging.tick < formed.tick, JSON.stringify({ formed, charging }));
});

test('[m2.order.spear-brace] horsemen are held by a single braced line they would break through unbraced', () => {
  const ride = (braced) => {
    const b = battle();
    const horse = members(b, 'ally_column')[1];
    const foot = members(b, 'enemy_line');
    for (const u of units(b)) if (u !== horse && !foot.includes(u)) { u.position = { x: 100 + Number(u.unitId.slice(-2)) * 2, y: 0, z: 100 }; u.slotTarget = null; }
    foot.forEach((m, i) => { m.position = { x: (i - 3) * 0.75, y: 0, z: 5 }; m.slotTarget = { x: m.position.x, z: m.position.z }; m.heading = Math.PI; });
    if (braced) b.state.getFormation('enemy_line').tactic = 'spear_brace';
    horse.position = { x: 0, y: 0, z: -12 };
    horse.slotTarget = { x: 0, z: 20 };
    b.formation.updateSlots = () => {};
    for (let i = 0; i < 200; i += 1) tick(b);
    return horse.position.z;
  };
  assert.ok(ride(false) > 15, 'through the unbraced line');
  assert.ok(ride(true) < 7, 'held by the braced one');
});

test('[m2.order.hit-and-run] horsemen who hit and run wheel away after a charge and charge again', () => {
  const run = (hitAndRun) => {
    const b = battle({ commanderSheets: SKILLED });
    if (hitAndRun) order(b, 'ally_column', 'hit_and_run');
    tick(b);
    attack(b, 'ally_column', 'enemy_line');
    let wheeled = 0;
    for (let i = 0; i < 600; i += 1) { tick(b); if (members(b, 'ally_column').some((u) => u.withdrawTo)) wheeled += 1; }
    return { charges: b.combat.getObservation(b.state).chargeHitCount, wheeled };
  };
  const stay = run(false);
  const raid = run(true);
  assert.equal(stay.wheeled, 0);
  assert.ok(raid.wheeled > 0 && raid.charges > stay.charges, JSON.stringify({ stay, raid }));
});

test('[m2.order.flank] a flanking formation goes round and comes at its target from behind', () => {
  const contactAngle = (flank) => {
    const b = battle({ commanderSheets: SKILLED });
    shift(b, 'enemy_line', 0, -25);
    shift(b, 'enemy_loose', 40, -40);
    shift(b, 'enemy_column', 40, -40);
    parkHero(b);
    const target = b.state.getFormation('enemy_line');
    target.facing = 0;
    if (flank) order(b, 'ally_column', 'flank');
    tick(b);
    attack(b, 'ally_column', 'enemy_line');
    for (let i = 0; i < 1200; i += 1) {
      tick(b);
      const blow = b.events.find((e) => b.state.getUnit(e.sourceUnitId).formationId === 'ally_column' && b.state.getUnit(e.targetUnitId).formationId === 'enemy_line');
      if (blow) {
        const a = b.state.getUnit(blow.sourceUnitId);
        const t = b.state.getUnit(blow.targetUnitId);
        // How far round from the target's front (facing +z) the blow came from: 0 in front, pi behind.
        return Math.abs(Math.atan2(a.position.x - t.position.x, a.position.z - t.position.z));
      }
    }
    return null;
  };
  const straight = contactAngle(false);
  const round = contactAngle(true);
  assert.ok(straight !== null && straight < Math.PI / 2, `straight at ${straight}`);
  assert.ok(round !== null && round > Math.PI / 2, `round at ${round}`);
});

test('[m2.order.crossbows] crossbowmen hold their fire, pick on one formation, loose in volleys, or keep their distance, as ordered', () => {
  const shoot = (tacticId, { stagger = false, ticks = 300 } = {}) => {
    const b = battle({ commanderSheets: SKILLED });
    if (tacticId) order(b, 'ally_loose', tacticId);
    tick(b);
    if (stagger) members(b, 'ally_loose').forEach((u, i) => { u.attackCooldownTicks = 1 + i * 13; });
    attack(b, 'ally_loose', 'enemy_column');
    for (let i = 0; i < ticks; i += 1) tick(b);
    return b;
  };
  const allyBolts = (b) => b.bolts.filter((x) => x.sideId === 'ally');
  assert.equal(allyBolts(shoot('hold_fire')).length, 0);
  // (Whom they aim at: a bolt may still strike whoever stands in its way.)
  const aimed = (b) => new Set(allyBolts(b).map((x) => b.state.getUnit(x.aimedAt).formationId));
  assert.deepEqual([...aimed(shoot('focus_fire'))], ['enemy_column']);
  assert.ok([...aimed(shoot(null))].some((f) => f !== 'enemy_column'), 'without focus they shoot the nearest');
  const volley = shoot('volley', { stagger: true });
  const ticksFired = new Set(allyBolts(volley).map((x) => x.tick));
  assert.ok(allyBolts(volley).length / ticksFired.size >= 4, `${allyBolts(volley).length} bolts in ${ticksFired.size} ticks`);
  // Skirmishers: an enemy coming within 10 m makes them step back.
  const b = battle({ commanderSheets: SKILLED });
  order(b, 'ally_loose', 'skirmish');
  tick(b);
  const man = members(b, 'ally_loose')[2];
  const foe = members(b, 'enemy_line')[2];
  foe.position = { x: man.position.x + 6, y: 0, z: man.position.z };
  foe.slotTarget = { x: foe.position.x, z: foe.position.z };
  b.formation.updateSlots(b.state);
  const before = Math.hypot(foe.position.x - man.position.x, foe.position.z - man.position.z);
  for (let i = 0; i < 40; i += 1) { tick(b); foe.slotTarget = { x: foe.position.x, z: foe.position.z }; }
  assert.ok(Math.hypot(foe.position.x - man.position.x, foe.position.z - man.position.z) > before + 3);
});

test('[m2.tactics.enemy-uses] the enemy commander shapes and orders his formations as the moment calls for', () => {
  const b = battle({ withAI: true, commanderSheets: SKILLED });
  // The enemy line stands back, so it has a way to come in under the ally crossbows.
  shift(b, 'enemy_line', 0, -20);
  attack(b, 'ally_column', 'enemy_line');
  tick(b);
  tick(b);
  // Under the ally crossbows, on the way in: a shield wall; horse coming: braced spears.
  assert.equal(b.state.getFormation('enemy_line').formationTypeId, 'shield_wall');
  assert.equal(b.state.getFormation('enemy_column').tactic, 'charge', 'horse ride into crossbowmen');
  // As the horsemen come near, before they strike: braced spears.
  let braced = false;
  for (let i = 0; i < 200 && !braced; i += 1) {
    tick(b);
    braced = b.state.getFormation('enemy_line').tactic === 'spear_brace';
  }
  assert.ok(braced);
  assert.ok(['volley', 'skirmish'].includes(b.state.getFormation('enemy_loose').tactic));
});
