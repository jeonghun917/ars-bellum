// Blows that hurt, and men who stop them (m2/M2_Defense.js; the owner, 2026-11-01: "a sword, not a pencil",
// then a fight of about a minute: about ten blows for a man without armour, seventeen in mail).
import test from 'node:test';
import assert from 'node:assert/strict';
import { battle, tick, members } from './m2-sim-helpers.mjs';
import { M2_DEFENSE, roll, stopChance, stopped } from '../../m2/M2_Defense.js';
import { M2_ARMOR_VALUES, m2UnitKind } from '../../m2/M2_UnitKinds.js';
import { damageThroughArmor } from '../../m2/M2_HeroLoadout.js';

const soldiers = (b, formationId) => members(b, formationId).filter((u) => !u.commander && !u.isPlayer);
// A point `distance` m from the unit, `degrees` off the way he faces.
const at = (u, degrees, distance = 1.5) => {
  const a = u.heading + degrees * Math.PI / 180;
  return { x: u.position.x + Math.sin(a) * distance, z: u.position.z + Math.cos(a) * distance };
};

test('[m2.defense.facing] a man stops blows at his front, half as often at his side, never from behind or running', () => {
  const b = battle();
  const man = soldiers(b, 'ally_line').find((u) => u.loadout === 'spear');
  const front = stopChance(b.state, man, at(man, 0));
  assert.ok(front > 0.5, `${front}`);
  assert.equal(stopChance(b.state, man, at(man, 90)), front * M2_DEFENSE.sideScale);
  assert.equal(stopChance(b.state, man, at(man, 180)), 0);
  man.state = 'routing';
  assert.equal(stopChance(b.state, man, at(man, 0)), 0);
});

test('[m2.defense.what-he-carries] a shield stops most, a weapon in both hands less, one in one hand least; a better guard more; a charge goes through more often', () => {
  const b = battle();
  const line = soldiers(b, 'ally_line');
  const by = (loadout) => line.find((u) => u.loadout === loadout);
  const front = (u, options) => stopChance(b.state, u, at(u, 0), options);
  const shield = by('spear');
  const both = by('great');
  const one = by('sword_free');
  assert.ok(shield && both && one, line.map((u) => u.loadout).join(','));
  for (const u of [shield, both, one]) u.guard = 50;
  assert.ok(front(shield) > front(both) && front(both) > front(one), JSON.stringify([front(shield), front(both), front(one)]));
  const before = front(one);
  one.guard = 90;
  assert.ok(front(one) > before);
  assert.equal(front(shield, { charging: true }), front(shield) * M2_DEFENSE.chargeScale);
  // The player stops blows himself (his block), never by chance.
  const hero = b.state.getUnit(b.state.playerCharacterId);
  assert.equal(stopChance(b.state, hero, at(hero, 0)), 0);
  // A commander by his sheet: a shield and his skill.
  const commander = b.state.getUnit(b.state.getFormation('ally_line').commanderUnitId);
  assert.ok(Math.abs(front(commander) - (M2_DEFENSE.melee.shield + (commander.commander.combat.melee.skill - 50) * M2_DEFENSE.skillPerPoint)) < 1e-9, `${front(commander)}`);
});

test('[m2.defense.shots] only a shield stops a bolt, a shield-bearer\'s big shield most of them, a shield wall more', () => {
  const b = battle({ unitTypes: { enemy_line: 'shield' } });
  const shot = (u) => stopChance(b.state, u, at(u, 0), { shot: true });
  const line = soldiers(b, 'ally_line');
  assert.equal(shot(line.find((u) => u.loadout === 'great')), 0);
  const shield = line.find((u) => u.loadout === 'spear');
  assert.equal(shot(shield), M2_DEFENSE.shot.shield);
  assert.equal(shot(soldiers(b, 'enemy_line')[0]), M2_DEFENSE.shot.big_shield);
  b.state.getFormation('ally_line').formationTypeId = 'shield_wall';
  shield.blocking = true;
  assert.equal(shot(shield), M2_DEFENSE.shot.shield + M2_DEFENSE.shieldWall);
});

test('[m2.defense.stopped] whether a blow is stopped follows the chance, and the same blow in the same battle always the same way', () => {
  const b = battle();
  const man = soldiers(b, 'ally_line').find((u) => u.loadout === 'spear');
  const from = at(man, 0);
  const chance = stopChance(b.state, man, from);
  let n = 0;
  for (let i = 0; i < 4000; i += 1) if (stopped(b.state, man, from, `blow:${i}`)) n += 1;
  assert.ok(Math.abs(n / 4000 - chance) < 0.03, `${n / 4000} for ${chance}`);
  assert.equal(stopped(b.state, man, from, 'blow:7'), stopped(battle().state, man, from, 'blow:7'));
  assert.equal(roll(1, 'x'), roll(1, 'x'));
  assert.notEqual(roll(1, 'x'), roll(2, 'x'));
});

test('[m2.defense.faces-foe] a man with an enemy at arm\'s length keeps his face to him, even stepping back into his place', () => {
  const b = battle();
  const man = soldiers(b, 'ally_line')[2];
  const foe = soldiers(b, 'enemy_line')[2];
  for (const u of b.state.getUnitIdsStable().map((id) => b.state.getUnit(id))) {
    if (u !== man && u !== foe) { u.position = { x: 200 + Number(u.unitId.slice(-2)) * 3, y: 0, z: 200 }; u.slotTarget = null; }
  }
  b.formation.updateSlots = () => {};
  // His place 2 m behind him (he steps back towards it); the foe 1.5 m in front, beyond his place's way.
  man.position = { x: 0, y: 0, z: 0 };
  man.slotTarget = { x: 0, z: 2, facing: 0 };
  foe.position = { x: 0, y: 0, z: -1.5 };
  foe.slotTarget = { x: 0, z: -1.5 };
  foe.attackCooldownTicks = 999;
  b.grid.rebuild(b.state);
  const toward = () => Math.atan2(foe.position.x - man.position.x, foe.position.z - man.position.z);
  let faced = 0;
  for (let i = 0; i < 10; i += 1) {
    foe.attackCooldownTicks = 999;
    tick(b);
    let off = Math.abs(((man.heading - toward()) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
    if (off < 0.2) faced += 1;
  }
  assert.ok(man.position.z > 0.3, `he stepped back (${man.position.z})`);
  assert.ok(faced >= 9, `faced him ${faced} of 10 ticks`);
});

test('[m2.defense.in-battle] in the fight, a man facing his attacker stops most of his blows; one struck from behind none', () => {
  const landed = (behind) => {
    const b = battle();
    const man = soldiers(b, 'ally_line').find((u) => u.loadout === 'spear');
    const foe = soldiers(b, 'enemy_line').find((u) => u.loadout === 'spear');
    // Behind: another ally stands nearer, on the far side of the foe, who faces that one and shows the man his back.
    const other = soldiers(b, 'ally_line').find((u) => u !== man);
    for (const u of b.state.getUnitIdsStable().map((id) => b.state.getUnit(id))) {
      if (u !== man && u !== foe && !(behind && u === other)) { u.position = { x: 200 + Number(u.unitId.slice(-2)) * 3, y: 0, z: 200 }; u.slotTarget = null; }
    }
    if (behind) { other.position = { x: 0, y: 0, z: 2.2 }; other.slotTarget = { x: 0, z: 2.2 }; }
    b.formation.updateSlots = () => {};
    man.position = { x: 0, y: 0, z: 0 };
    man.slotTarget = { x: 0, z: 0 };
    foe.position = { x: 0, y: 0, z: 1.2 };
    foe.slotTarget = { x: 0, z: 1.2 };
    b.grid.rebuild(b.state);
    let swings = 0;
    let hits = 0;
    for (let i = 0; i < 20 * 120; i += 1) {
      // The foe only takes the blows (strikes none back).
      foe.attackCooldownTicks = 999;
      foe.hp = foe.maxHp;
      const events = tick(b);
      if (man.state === 'attacking' && man.attackCooldownTicks === m2UnitKind(man).meleeCooldownTicks) swings += 1;
      hits += events.filter((e) => e.sourceUnitId === man.unitId).length;
    }
    return { swings, hits };
  };
  const facing = landed(false);
  const behind = landed(true);
  assert.ok(facing.swings > 20 && behind.swings > 20, JSON.stringify({ facing, behind }));
  assert.equal(behind.hits, behind.swings);
  assert.ok(facing.hits < facing.swings * 0.35, JSON.stringify(facing));
});

test('[m2.defense.blows-to-fall] a soldier falls to about ten blows without armour, about seventeen in mail, more in plate', () => {
  const b = battle();
  const foot = soldiers(b, 'ally_line');
  const blow = m2UnitKind('infantry').meleeDamage;
  const blows = (u, armor) => u.maxHp / Math.round(damageThroughArmor(blow, armor));
  for (const u of foot) {
    assert.equal(u.armor, M2_ARMOR_VALUES.mail);
    assert.ok(blows(u, 0) >= 8 && blows(u, 0) <= 13, `${u.unitId} ${blows(u, 0)}`);
    assert.ok(blows(u, u.armor) >= 14 && blows(u, u.armor) <= 22, `${u.unitId} ${blows(u, u.armor)}`);
    assert.ok(blows(u, M2_ARMOR_VALUES.plate) > blows(u, u.armor));
  }
});
