// The player's character as the 3D battle sees him (src/game/battle-hero.js): his combat skills and his
// equipped items, with each item's battle numbers from the equipment definitions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/core/store.js';
import { newCharacter, newGameState, PLAYER_CHARACTER_ID, PLAYER_INVENTORY_ID, PLAYER_GROUP_ID } from '../../src/game/new-game.js';
import { validateState } from '../../src/persist/schema.js';
import { addEquipment, EQUIPMENT_ITEMS, getEquipmentItem } from '../../src/domains/inventory/index.js';
import { definitionProblems } from '../../src/domains/definitions/index.js';
import { buildHeroSheet, HERO_SLOTS } from '../../src/game/battle-hero.js';
import { heroCombat } from '../../m2/M2_HeroLoadout.js';
import { M2BattleState } from '../../m2/M2_BattleState.js';
import { createCombatProfileCatalog } from '../../m2/M2_CombatProfiles.js';
import { M2_TECHNICAL_COMBAT_PROFILES, M2_TECHNICAL_SNAPSHOT } from '../../m2/fixtures/m2_technical_fixture_v1.js';

const item = (instanceId, itemDefinitionId, slotDefinitionId, extra = {}) => ({ instanceId, itemDefinitionId, slotDefinitionId, weightKg: 1, volumeL: 1, ...extra });

// A new game whose player carries the given items in his group's inventory.
function gameWith(items, edit = () => {}) {
  const state = newGameState();
  edit(state);
  const store = createStore(state, { validate: validateState });
  for (const entry of items) {
    const added = store.transact('give', (draft) => addEquipment(draft, { inventoryId: PLAYER_INVENTORY_ID, item: entry, allowOverload: true }));
    assert.equal(added.ok, true, JSON.stringify(added));
  }
  return store.getState();
}

test('[battle-hero.items-defined] every equipment item says what it does in battle for its slot, and bad ones are refused', () => {
  const state = newGameState();
  assert.ok(EQUIPMENT_ITEMS.length >= 10);
  for (const slot of HERO_SLOTS) assert.ok(EQUIPMENT_ITEMS.some((entry) => entry.slot === slot), `an item for ${slot}`);
  for (const entry of EQUIPMENT_ITEMS) assert.deepEqual(definitionProblems(state, 'equipment_item', entry.id, entry), [], entry.id);
  const sword = getEquipmentItem(state, 'arming_sword');
  assert.deepEqual(definitionProblems(state, 'equipment_item', 'bad', { ...sword, id: 'bad', slot: 'tail' }), ['missing_slot_reference']);
  assert.ok(definitionProblems(state, 'equipment_item', 'bad', { ...sword, id: 'bad', battle: { ...sword.battle, reach: 0 } }).includes('invalid_battle_reach'));
  assert.ok(definitionProblems(state, 'equipment_item', 'bad', { ...sword, id: 'bad', battle: { ...sword.battle, weaponClass: 'bow' } }).includes('invalid_battle_weaponClass'));
  const shield = getEquipmentItem(state, 'round_shield');
  assert.ok(definitionProblems(state, 'equipment_item', 'bad', { ...shield, id: 'bad', battle: { kind: 'shield', block: 1.2 } }).includes('invalid_battle_block'));
});

test('[battle-hero.new-game] a new character has no combat skill and carries nothing: he fights with his fists', () => {
  const sheet = buildHeroSheet(newGameState(), PLAYER_CHARACTER_ID);
  assert.ok(Object.values(sheet.skills).every((value) => value === 0));
  assert.deepEqual(Object.values(sheet.equipment), [null, null, null, null, null]);
  const combat = heroCombat(sheet);
  assert.equal(combat.melee.itemId, null);
  assert.equal(combat.ranged, null);
  assert.equal(combat.mounted, false);
  assert.equal(buildHeroSheet(newGameState(), 'nobody'), null);
});

test('[battle-hero.equipped] his skills and the items equipped to him reach the battle, each with its numbers', () => {
  const state = gameWith([
    item('i1', 'long_sword', 'main_hand'),
    item('i2', 'mail_hauberk', 'body'),
    item('i3', 'war_bow', 'ranged'),
    item('i4', 'destrier', 'mount'),
    item('i5', 'kite_shield', 'off_hand'),
  ], (s) => { Object.assign(s.world.characters[PLAYER_CHARACTER_ID].skills, { two_handed: 60, bow: 50, riding: 20, athletics: 10 }); });
  const sheet = buildHeroSheet(state, PLAYER_CHARACTER_ID);
  assert.equal(sheet.skills.two_handed, 60);
  assert.equal(sheet.equipment.main_hand.itemId, 'long_sword');
  assert.equal(sheet.equipment.main_hand.weaponClass, 'two_handed');
  const combat = heroCombat(sheet);
  assert.equal(combat.melee.damage, Math.round(33 * 1.6));
  assert.equal(combat.armor, 22);
  assert.equal(combat.ranged.damage, Math.round(39 * 1.5));
  assert.equal(combat.mounted, true);
  assert.equal(combat.blockMultiplier, 0.3);
  assert.equal(combat.appearance, 'cavs');
});

test('[battle-hero.only-his] items not equipped, in the wrong slot, unknown, or handed to someone else are not his in battle', () => {
  const state = gameWith([
    item('i1', 'arming_sword', null),
    item('i2', 'mail_shirt', 'main_hand'),
    item('i3', 'mystery_relic', 'body'),
    item('i4', 'crossbow', 'ranged', { assignmentRef: { type: 'character', id: 'npc_bob' } }),
    item('i5', 'spear', 'main_hand'),
  ], (s) => {
    s.world.characters.npc_bob = newCharacter({ id: 'npc_bob', name: 'Bob', mobileGroupId: PLAYER_GROUP_ID });
    s.world.mobileGroups[PLAYER_GROUP_ID].memberCharacterIds.push('npc_bob');
  });
  const sheet = buildHeroSheet(state, PLAYER_CHARACTER_ID);
  assert.equal(sheet.equipment.main_hand.itemId, 'spear');
  assert.equal(sheet.equipment.body, null);
  assert.equal(sheet.equipment.ranged, null);
  // Bob does not lead the group: the crossbow handed to him is his; the leader's unassigned spear is not.
  const bob = buildHeroSheet(state, 'npc_bob');
  assert.equal(bob.equipment.ranged.itemId, 'crossbow');
  assert.equal(bob.equipment.main_hand, null);
});

test('[battle-hero.into-battle] a battle launched with his sheet has him fight as equipped', () => {
  const state = gameWith([item('i1', 'arming_sword', 'main_hand'), item('i2', 'coat_of_plates', 'body')],
    (s) => { s.world.characters[PLAYER_CHARACTER_ID].skills.one_handed = 50; });
  const heroSheet = buildHeroSheet(state, PLAYER_CHARACTER_ID);
  const battle = new M2BattleState({ ...M2_TECHNICAL_SNAPSHOT, heroSheet }, createCombatProfileCatalog(M2_TECHNICAL_COMBAT_PROFILES));
  const hero = battle.getUnit(M2_TECHNICAL_SNAPSHOT.playerCharacterId);
  assert.equal(hero.armor, 30);
  assert.equal(hero.hero.melee.itemId, 'arming_sword');
  assert.equal(hero.hero.melee.damage, Math.round(21 * 1.5));
  assert.equal(hero.hero.appearance, 'sword_free');
  assert.equal(hero.hero.ranged, null);
});
