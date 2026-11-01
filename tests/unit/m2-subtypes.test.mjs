// Subtypes (병종) in the 3D battle (m2/M2_UnitKinds.js): each differs from its kind only in body and equipment
// (the owner, 2026-10-31: no added effects). Every test runs the same fight with and without the subtype, so
// it fails if the subtype's difference is taken out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { battle, tick, attack, members } from './m2-sim-helpers.mjs';
import { M2_UNIT_KINDS, M2_UNIT_TYPES } from '../../m2/M2_UnitKinds.js';
import { buildScaleSnapshot } from '../../m2/fixtures/m2_scale_fixture.js';
import { validateBattleLaunchSnapshot } from '../../m2/M2_BattleSnapshot.js';
import { createCombatProfileCatalog } from '../../m2/M2_CombatProfiles.js';
import { M2_SCALE_COMBAT_PROFILES } from '../../m2/fixtures/m2_scale_fixture.js';

const soldiers = (b, formationId) => members(b, formationId).filter((u) => !u.commander && !u.isPlayer);
const run = (b, ticks, until = () => false) => { for (let i = 0; i < ticks && !until(); i += 1) tick(b); };
// Moves a formation out of the way (or further off), men and all.
const shift = (b, formationId, dx, dz) => {
  const f = b.state.getFormation(formationId);
  f.anchor = { x: f.anchor.x + dx, z: f.anchor.z + dz };
  for (const u of members(b, formationId)) { u.position.x += dx; u.position.z += dz; u.previousPosition = { ...u.position }; }
};
const struckBy = (b, formationId, kind = 'auto_melee:') => b.events.filter((e) => e.damageEventId.startsWith(kind) && b.state.getUnit(e.sourceUnitId).formationId === formationId);

test('[m2.subtypes.assigned] a formation the snapshot names a subtype has its men, of its kind; a subtype of another kind is not taken', () => {
  const b = battle({ unitTypes: { ally_line: 'shield', ally_loose: 'longbow', ally_column: 'heavy_cav', enemy_line: 'light_cav', enemy_loose: 'crossbow' } });
  const check = (formationId, typeId) => {
    const f = b.state.getFormation(formationId);
    assert.equal(f.unitTypeId, typeId, formationId);
    for (const u of soldiers(b, formationId)) assert.equal(u.unitTypeId, typeId, u.unitId);
  };
  check('ally_line', 'shield');
  check('ally_loose', 'longbow');
  check('ally_column', 'heavy_cav');
  check('enemy_line', null);
  check('enemy_loose', 'crossbow');
  // Body and equipment: armor, bolts carried, hit points against the kind's.
  const plain = battle();
  for (const u of soldiers(b, 'ally_line')) assert.equal(u.armor, 12);
  for (const u of soldiers(plain, 'ally_line')) assert.equal(u.armor, 0);
  for (const u of soldiers(b, 'ally_loose')) assert.equal(u.ammo, 30);
  for (const u of soldiers(b, 'enemy_loose')) assert.equal(u.ammo, 15);
  for (const u of soldiers(plain, 'ally_loose')) assert.equal(u.ammo, null, 'the kind\'s crossbowmen never run out');
  const hp = (x, id) => soldiers(x, id).map((u) => u.maxHp).reduce((s, v) => s + v, 0);
  assert.ok(hp(b, 'ally_column') > hp(plain, 'ally_column'), 'heavy horse stands more hits');
  // Every subtype is one of the three kinds, with a Korean name.
  for (const t of Object.values(M2_UNIT_TYPES)) {
    assert.ok(M2_UNIT_KINDS[t.kindId], t.id);
    assert.match(t.label, /[가-힣]/);
  }
});

test('[m2.subtypes.shield-stops-bolts] shield-bearers stop bolts from in front with their shields, as men in plain mail do not', () => {
  const bolts = (unitTypes) => {
    const b = battle({ unitTypes });
    // Nobody else in the way, or nearer.
    shift(b, 'ally_loose', -30, -30);
    shift(b, 'ally_column', -30, 30);
    const hero = b.state.getUnit(b.state.playerCharacterId);
    hero.position.x -= 40; hero.previousPosition = { ...hero.position };
    // The line turned to face the crossbowmen.
    const facing = b.state.getFormation('ally_line');
    const shooters = b.state.getFormation('enemy_loose');
    facing.facing = Math.atan2(shooters.anchor.x - facing.anchor.x, shooters.anchor.z - facing.anchor.z);
    for (const u of members(b, 'ally_line')) u.heading = facing.facing;
    attack(b, 'enemy_loose', 'ally_line');
    run(b, 500);
    const line = new Set(soldiers(b, 'ally_line').map((u) => u.unitId));
    return b.events.filter((e) => e.damageEventId.startsWith('projectile:') && line.has(e.targetUnitId)).map((e) => e.damage);
  };
  const shielded = bolts({ ally_line: 'shield' });
  const plain = bolts({});
  assert.ok(shielded.length > 3 && plain.length > 3, `${shielded.length} ${plain.length}`);
  assert.ok(plain.every((d) => d === M2_UNIT_KINDS.crossbow.boltDamage), JSON.stringify(plain));
  // Those shot from in front (the men at the ends of the line are shot from the side, past their shields).
  assert.ok(shielded.filter((d) => d < M2_UNIT_KINDS.crossbow.boltDamage).length >= shielded.length / 3, JSON.stringify(shielded));
});

test('[m2.subtypes.pike-outreaches-horse] pikemen strike charging horse before the horse reaches them; men with short spears are struck first', () => {
  const firstBlows = (unitTypes) => {
    const b = battle({ unitTypes });
    attack(b, 'enemy_column', 'ally_line');
    run(b, 600, () => struckBy(b, 'ally_line').length > 0 && struckBy(b, 'enemy_column').length > 0);
    return { foot: struckBy(b, 'ally_line')[0]?.tick ?? Infinity, horse: struckBy(b, 'enemy_column')[0]?.tick ?? Infinity };
  };
  const pike = firstBlows({ ally_line: 'pike' });
  const plain = firstBlows({});
  assert.ok(pike.foot < pike.horse, `pike ${JSON.stringify(pike)}`);
  assert.ok(plain.horse <= plain.foot, `plain ${JSON.stringify(plain)}`);
});

test('[m2.subtypes.crossbow-pierces] the crossbowman\'s (석궁병) bolts go through armor; the kind\'s crossbow bolts do not', () => {
  const perHit = (unitTypes) => {
    const b = battle({ unitTypes: { enemy_column: 'heavy_cav', ...unitTypes } });
    const horse = soldiers(b, 'enemy_column');
    const before = horse.reduce((s, u) => s + u.hp, 0);
    shift(b, 'enemy_loose', 30, -30);
    shift(b, 'enemy_line', 30, 30);
    attack(b, 'ally_loose', 'enemy_column');
    run(b, 500);
    const ids = new Set(horse.map((u) => u.unitId));
    const hits = b.events.filter((e) => e.damageEventId.startsWith('projectile:') && ids.has(e.targetUnitId)).length;
    assert.ok(hits > 3, `hits ${hits}`);
    assert.equal(struckBy(b, 'ally_line').length + struckBy(b, 'ally_column').length, 0, 'only bolts');
    return (before - horse.reduce((s, u) => s + u.hp, 0)) / hits;
  };
  const pierced = perHit({ ally_loose: 'crossbow' });
  const plain = perHit({});
  assert.ok(pierced > plain + 1, `${pierced} ${plain}`);
});

test('[m2.subtypes.ammo] the crossbowmen (석궁병) shoot their bolts, then close in and fight with their short swords', () => {
  const b = battle({ unitTypes: { ally_loose: 'crossbow' } });
  attack(b, 'ally_loose', 'enemy_line');
  run(b, 3000, () => struckBy(b, 'ally_loose').length > 0);
  const shots = new Map();
  for (const bolt of b.bolts) shots.set(bolt.ownerUnitId, (shots.get(bolt.ownerUnitId) || 0) + 1);
  for (const u of members(b, 'ally_loose')) assert.ok((shots.get(u.unitId) || 0) <= 15, `${u.unitId} ${shots.get(u.unitId)}`);
  assert.ok(soldiers(b, 'ally_loose').some((u) => u.ammo === 0), 'someone ran out');
  assert.ok(struckBy(b, 'ally_loose').length > 0, 'and fought on with his sword');
  assert.ok(struckBy(b, 'ally_loose').every((e) => e.tick > Math.max(...b.bolts.filter((x) => x.ownerUnitId === e.sourceUnitId).map((x) => x.tick))), 'after his last bolt');
  // The kind's crossbowmen, the same time, shoot on.
  const plain = battle();
  attack(plain, 'ally_loose', 'enemy_line');
  run(plain, b.state.tick);
  assert.ok(plain.bolts.filter((x) => x.sideId === 'ally').length > b.bolts.filter((x) => x.sideId === 'ally').length);
  assert.equal(struckBy(plain, 'ally_loose').length, 0);
});

test('[m2.subtypes.longbow] longbowmen shoot more often and from further off than crossbowmen', () => {
  const shoot = (unitTypes) => {
    const b = battle({ unitTypes });
    // The enemy far off, alone: the bowmen walk up until they can shoot.
    shift(b, 'enemy_line', 40, 0);
    shift(b, 'enemy_loose', 60, 30);
    shift(b, 'enemy_column', 60, -30);
    attack(b, 'ally_loose', 'enemy_line');
    let furthest = 0;
    for (let i = 0; i < 600; i += 1) {
      const seen = b.bolts.length;
      tick(b);
      for (const bolt of b.bolts.slice(seen)) {
        if (bolt.sideId !== 'ally') continue;
        const s = b.state.getUnit(bolt.ownerUnitId).position;
        const t = b.state.getUnit(bolt.aimedAt).position;
        furthest = Math.max(furthest, Math.hypot(s.x - t.x, s.z - t.z));
      }
    }
    return { shots: b.bolts.filter((x) => x.sideId === 'ally').length, furthest };
  };
  const longbow = shoot({ ally_loose: 'longbow' });
  const crossbow = shoot({});
  assert.ok(longbow.shots > crossbow.shots * 1.5, `${longbow.shots} ${crossbow.shots}`);
  assert.ok(longbow.furthest > M2_UNIT_KINDS.crossbow.range, `${longbow.furthest}`);
  assert.ok(crossbow.furthest <= M2_UNIT_KINDS.crossbow.range + 0.5, `${crossbow.furthest}`);
});

test('[m2.subtypes.horse] light horse reaches the enemy first, heavy horse last; heavy horse loses less to the same blows', () => {
  const ride = (typeId) => {
    const b = battle({ unitTypes: typeId ? { ally_column: typeId } : {} });
    const horse = soldiers(b, 'ally_column');
    const before = horse.reduce((s, u) => s + u.hp, 0);
    attack(b, 'ally_column', 'enemy_line');
    run(b, 900);
    const ids = new Set(horse.map((u) => u.unitId));
    const taken = b.events.filter((e) => ids.has(e.targetUnitId));
    return {
      first: struckBy(b, 'ally_column')[0]?.tick ?? Infinity,
      perBlow: (before - horse.reduce((s, u) => s + u.hp, 0)) / taken.reduce((s, e) => s + e.damage, 0),
    };
  };
  const light = ride('light_cav');
  const plain = ride(null);
  const heavy = ride('heavy_cav');
  assert.ok(light.first < plain.first && plain.first < heavy.first, JSON.stringify([light.first, plain.first, heavy.first]));
  assert.ok(heavy.perBlow < 0.75 && plain.perBlow > 0.95, JSON.stringify([heavy.perBlow, plain.perBlow]));
});

test('[m2.subtypes.shock] shock foot strike harder than the kind\'s foot soldiers', () => {
  const blows = (unitTypes) => {
    const b = battle({ unitTypes });
    attack(b, 'ally_line', 'enemy_line');
    run(b, 600);
    const own = new Set(soldiers(b, 'ally_line').map((u) => u.unitId));
    return struckBy(b, 'ally_line').filter((e) => own.has(e.sourceUnitId) && !b.state.getUnit(e.targetUnitId).blocking).map((e) => e.damage);
  };
  const shock = blows({ ally_line: 'shock' });
  const plain = blows({});
  assert.ok(shock.length > 0 && plain.length > 0);
  assert.ok(Math.max(...shock) > Math.max(...plain), `${Math.max(...shock)} ${Math.max(...plain)}`);
});

test('[m2.subtypes.mixed-battle] the mixed battle (?mixed) is a valid launch snapshot with every subtype but the skirmisher', () => {
  const snapshot = buildScaleSnapshot({ perSide: 40, mixed: true });
  const checked = validateBattleLaunchSnapshot(snapshot, createCombatProfileCatalog(M2_SCALE_COMBAT_PROFILES));
  assert.equal(checked.ok, true, JSON.stringify(checked));
  const types = new Set(snapshot.formations.map((f) => f.unitTypeId));
  for (const id of Object.keys(M2_UNIT_TYPES).filter((id) => id !== 'skirmisher')) assert.ok(types.has(id), id);
});
