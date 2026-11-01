// The hero sheet the 3D battle reads for the player's character (m2/M2_HeroLoadout.js): his combat skills and
// what he has equipped, with each item's battle numbers from the equipment definitions. Read-only: building
// it changes nothing in the game.
import { getEquipmentItem } from '../domains/inventory/index.js';

// The skills the battle uses.
export const HERO_SKILLS = Object.freeze(['athletics', 'bow', 'crossbow', 'one_handed', 'polearm', 'riding', 'two_handed']);
// The slots the battle reads, in the battle's own terms.
export const HERO_SLOTS = Object.freeze(['main_hand', 'off_hand', 'ranged', 'body', 'mount']);

const isCharacterRef = (ref, characterId) => ref?.type === 'character' && ref.id === characterId;

// The inventories a character's gear can be in: his own, and that of the group he travels with. In the
// group's inventory, an item equipped and assigned to him is his; one equipped and assigned to no one belongs
// to whoever commands the group (the group's gear is its leader's until handed out).
function equippedItems(state, character) {
  const world = state.world;
  const items = [];
  const personal = character.personalInventoryId ? world.inventories?.[character.personalInventoryId] : null;
  for (const item of personal?.equipmentItems || []) {
    if (item.slotDefinitionId && (item.assignmentRef === null || isCharacterRef(item.assignmentRef, character.id))) items.push(item);
  }
  const group = character.location?.mobileGroupId ? world.mobileGroups?.[character.location.mobileGroupId] : null;
  const shared = group?.inventoryId ? world.inventories?.[group.inventoryId] : null;
  const leads = isCharacterRef(group?.actingCommanderRef, character.id);
  for (const item of shared?.equipmentItems || []) {
    if (!item.slotDefinitionId) continue;
    if (isCharacterRef(item.assignmentRef, character.id) || (item.assignmentRef === null && leads)) items.push(item);
  }
  return items;
}

// { skills, equipment } for the battle, or null if there is no such character. Items whose definition is
// unknown, or that sit in a slot they are not made for, are left out; of two in one slot, the first found
// (his own inventory before the group's) is used.
export function buildHeroSheet(state, characterId) {
  const character = state?.world?.characters?.[characterId];
  if (!character) return null;
  const skills = Object.fromEntries(HERO_SKILLS.map((id) => [id, Number(character.skills?.[id]) || 0]));
  const equipment = Object.fromEntries(HERO_SLOTS.map((slot) => [slot, null]));
  for (const item of equippedItems(state, character)) {
    const definition = getEquipmentItem(state, item.itemDefinitionId);
    if (!definition || definition.slot !== item.slotDefinitionId || equipment[definition.slot] !== null) continue;
    equipment[definition.slot] = { itemId: definition.id, ...definition.battle };
  }
  return { skills, equipment };
}
