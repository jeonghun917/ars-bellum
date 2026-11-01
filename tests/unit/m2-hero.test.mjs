// The player's hero in the 3D battle (m2/M2_HeroLoadout.js): his own man, not one of a formation's, fighting
// as his skills and equipment allow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HERO_SHEET, heroCombat, damageThroughArmor } from '../../m2/M2_HeroLoadout.js';
import { isM2UnitAlive } from '../../m2/M2_BattleState.js';
import { battle, tick, attack, members } from './m2-sim-helpers.mjs';

const PLAYER = 'm2_fixture_player';
const sheet = (skills = {}, equipment = {}) => ({
  skills: { ...DEFAULT_HERO_SHEET.skills, ...skills },
  equipment: { ...DEFAULT_HERO_SHEET.equipment, ...equipment },
});
const SWORD = { itemId: 'arming_sword', weaponClass: 'one_handed', damage: 7, reach: 1.3, cooldownTicks: 12 };
const HORSE = { itemId: 'courser', speed: 5.6, hpBonus: 100 };

test('[m2.hero.own-man] the hero belongs to no formation: the line gets another leader and its orders do not move him', () => {
  const b = battle();
  const hero = b.state.getUnit(PLAYER);
  assert.equal(hero.formationId, null);
  for (const id of b.state.getFormationIdsStable()) assert.ok(!b.state.getFormation(id).memberUnitIds.includes(PLAYER), id);
  const line = b.state.getFormation('ally_line');
  assert.notEqual(line.commanderUnitId, PLAYER);
  assert.ok(line.memberUnitIds.includes(line.commanderUnitId));
  const at = { ...hero.position };
  const r = b.queue.enqueue({ commandId: 'mv', type: 'formation_move', formationId: 'ally_line', target: { x: -5, z: 15 } }, b.state);
  assert.equal(r.ok, true);
  for (let i = 0; i < 100; i += 1) tick(b);
  // (The line running past shoulders him aside a little; he does not go with it.)
  assert.ok(Math.hypot(hero.position.x - at.x, hero.position.z - at.z) < 0.5, JSON.stringify([at, hero.position]));
  assert.ok(members(b, 'ally_line').every((u) => u.position.z > 10), 'the line went');
});

test('[m2.hero.skills-and-gear] skill and equipment set the hero\'s blow, reach, armor, block, bow and pace', () => {
  const weak = heroCombat(sheet({ polearm: 0 }));
  const strong = heroCombat(sheet({ polearm: 100 }));
  assert.equal(weak.melee.damage, 8);
  assert.equal(strong.melee.damage, 16);
  assert.ok(strong.melee.cooldownTicks < weak.melee.cooldownTicks);
  const sword = heroCombat(sheet({}, { main_hand: SWORD }));
  assert.ok(sword.melee.reach < heroCombat(sheet()).melee.reach, 'a spear reaches further than a sword');
  assert.equal(sword.appearance, 'sword');
  assert.equal(heroCombat(sheet({}, { main_hand: SWORD, off_hand: null })).appearance, 'sword_free');
  assert.ok(heroCombat(sheet({}, { off_hand: null })).blockMultiplier > heroCombat(sheet()).blockMultiplier, 'a shield blocks more');
  assert.equal(damageThroughArmor(20, 20), 10);
  assert.equal(heroCombat(sheet({}, { body: null })).armor, 0);
  assert.equal(heroCombat(sheet({}, { ranged: null })).ranged, null);
  const rider = heroCombat(sheet({ riding: 40 }, { mount: HORSE }));
  assert.equal(rider.mounted, true);
  assert.equal(rider.appearance, 'cav');
  assert.ok(rider.moveSpeed > heroCombat(sheet()).moveSpeed * 1.5);
  assert.ok(rider.maxHp > heroCombat(sheet()).maxHp);
});

test('[m2.hero.fights-as-equipped] in battle the hero strikes with his weapon, wears his armor, and has no bow if he carries none', () => {
  const b = battle({ heroSheet: sheet({ polearm: 100 }, { ranged: null }) });
  const hero = b.state.getUnit(PLAYER);
  assert.equal(hero.maxHp, heroCombat(sheet({ polearm: 100 })).maxHp);
  // An enemy in reach in front of him.
  const foe = members(b, 'enemy_line')[3];
  foe.position = { x: hero.position.x, y: 0, z: hero.position.z + 1.8 };
  foe.slotTarget = { x: foe.position.x, z: foe.position.z };
  b.grid.rebuild(b.state);
  const before = foe.hp;
  b.queue.enqueue({ commandId: 'hit', type: 'player_melee_attack', actorUnitId: PLAYER, aimHeading: 0 }, b.state);
  tick(b);
  assert.equal(before - foe.hp, 16, 'the spear at full skill');
  assert.equal(hero.attackCooldownTicks, heroCombat(sheet({ polearm: 100 })).melee.cooldownTicks);
  // No bow: the bow button does nothing.
  for (let i = 0; i < 40; i += 1) tick(b);
  b.queue.enqueue({ commandId: 'bow', type: 'player_bow_fire', actorUnitId: PLAYER, aimHeading: 0 }, b.state);
  tick(b);
  assert.equal(b.state.projectileCount, 0);
  // Armor: a blow of 20 reaches him as 20 * 20 / (20 + 15).
  // (The foe in front has been striking back meanwhile: measure this one blow.)
  const hpBefore = hero.hp;
  b.state.applyDamageEvent({ damageEventId: 'test:armor', sourceUnitId: foe.unitId, targetUnitId: PLAYER, damage: 20 });
  assert.equal(hpBefore - hero.hp, Math.round(20 * 20 / 35));
});

test('[m2.hero.mounted] a hero on a horse rides as fast as a horseman and charges at the end of a run-up', () => {
  const b = battle({ heroSheet: sheet({ riding: 40 }, { mount: HORSE }) });
  const hero = b.state.getUnit(PLAYER);
  assert.equal(hero.kindId, 'cavalry');
  const foe = members(b, 'enemy_line')[3];
  for (const u of b.state.getUnitIdsStable().map((id) => b.state.getUnit(id))) if (u !== hero && u !== foe) {
    u.position = { x: 100 + Number(u.unitId.slice(-2)) * 2, y: 0, z: 100 };
    u.slotTarget = { x: u.position.x, z: u.position.z };
  }
  hero.position = { x: 0, y: 0, z: -20 };
  foe.position = { x: 0, y: 0, z: 0 };
  foe.slotTarget = { x: 0, z: 0 };
  b.formation.updateSlots = () => {};
  let fastest = 0;
  for (let i = 0; i < 80 && hero.position.z < -2.2; i += 1) {
    b.queue.enqueue({ commandId: `ride_${i}`, type: 'player_move', actorUnitId: PLAYER, move: { x: 0, z: 1 } }, b.state);
    tick(b);
    fastest = Math.max(fastest, Math.hypot(hero.velocity.x, hero.velocity.z));
  }
  // A horse's 5.6 m/s, a tenth quicker for riding skill 40.
  const pace = heroCombat(sheet({ riding: 40 }, { mount: HORSE })).moveSpeed;
  assert.ok(pace > 6 && fastest > pace * 0.98, `rode at ${fastest}, should ${pace}`);
  const before = foe.hp;
  b.queue.enqueue({ commandId: 'lance', type: 'player_melee_attack', actorUnitId: PLAYER, aimHeading: 0 }, b.state);
  tick(b);
  assert.ok(b.combat.getObservation(b.state).chargeHitCount >= 1, 'a charge');
  assert.ok(before - foe.hp >= heroCombat(sheet({ riding: 40 }, { mount: HORSE })).melee.damage * 2, `${before - foe.hp}`);
});

test('[m2.hero.army-retreat] when the whole army withdraws the hero goes with it: the battle ends as a retreat', () => {
  const b = battle();
  for (const id of ['ally_line', 'ally_column', 'ally_loose']) b.queue.enqueue({ commandId: `r_${id}`, type: 'formation_retreat', formationId: id }, b.state);
  let i = 0;
  for (; i < 20 * 60 && !b.outcome; i += 1) tick(b);
  assert.equal(b.outcome, 'ally_retreat');
  assert.ok(isM2UnitAlive(b.state.getUnit(PLAYER)));
});

test('[m2.hero.default-sheet] without a sheet the hero carries spear, shield, bow and mail', () => {
  const hero = battle().state.getUnit(PLAYER);
  assert.equal(hero.hero.melee.itemId, 'spear');
  assert.equal(hero.hero.appearance, 'spear');
  assert.equal(hero.armor, 15);
  assert.ok(hero.hero.ranged);
});
