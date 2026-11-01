// Record checks for world.inventories and the definitions they refer to (resources, equipment slots,
// cargo purposes). The rules mirror the earlier version's save-time validators (M1_Inventory and the
// persistent-record pass in M1_Migration), so its saves load unchanged.
import { isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import { getDefinition, hasDefinitionDomain, refExists, registerDefinitionDomain } from '../definitions/index.js';
import { isKnownOwnerType } from '../finance/index.js';

// Ids as the earlier version stored them (letters of either case). New ids made by the rules use
// the stricter core isId; this only decides what a stored record may hold.
export const isStoredId = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value);
export const isStoredRef = (value) => isRecord(value) && isStoredId(value.type) && isStoredId(value.id);
export const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
export const isQuantity = (value) => Number.isSafeInteger(value) && value > 0;
export const isMeasure = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// ---------------------------------------------------------------- definitions

export const RESOURCE_CATEGORIES = Object.freeze(['food', 'raw', 'processed', 'military', 'luxury']);
const WEIGHT_UNITS = ['kg', 'g', 't'];
const VOLUME_UNITS = ['l', 'ml', 'm3'];

// Resources of the earlier ResourceCatalog (recipes belong to the economy area). Weight is in kg per
// unit and volume in litres per unit (the unit's weight when not given); nutritionValue is 1 for
// food unless given, 0 otherwise.
const RESOURCES = [
  {
    id: 'grain', name: '곡물', category: 'food', unit: '자루',
    basePrice: 8, weight: 1, perishRate: 0.003, essential: true,
    tags: ['staple', 'civilian_food', 'army_food', 'farm'],
  },
  {
    id: 'bread', name: '빵', category: 'food', unit: '바구니',
    basePrice: 14, weight: 0.8, perishRate: 0.08, essential: true,
    tags: ['staple', 'civilian_food', 'processed_food', 'bakery'],
  },
  {
    id: 'meat', name: '고기', category: 'food', unit: '묶음',
    basePrice: 22, weight: 1.2, perishRate: 0.12, essential: false,
    tags: ['civilian_food', 'army_food', 'protein', 'livestock'],
  },
  {
    id: 'fish', name: '생선', category: 'food', unit: '바구니',
    basePrice: 18, weight: 1, perishRate: 0.18, essential: false,
    tags: ['civilian_food', 'protein', 'river', 'coast'],
  },
  {
    id: 'vegetables', name: '채소', category: 'food', unit: '바구니',
    basePrice: 10, weight: 0.9, perishRate: 0.1, essential: false,
    tags: ['civilian_food', 'farm', 'fresh_food'],
  },
  {
    id: 'grapes', name: '포도', category: 'food', unit: '바구니',
    basePrice: 13, weight: 0.9, perishRate: 0.12, essential: false,
    tags: ['civilian_food', 'vineyard', 'wine_input'],
  },
  {
    id: 'salt', name: '소금', category: 'food', unit: '자루',
    basePrice: 20, weight: 0.7, perishRate: 0, essential: true,
    tags: ['preservation', 'civilian_food', 'trade_good'],
  },
  {
    id: 'timber', name: '목재', category: 'raw', unit: '묶음',
    basePrice: 12, weight: 2, perishRate: 0, essential: false,
    tags: ['construction', 'fuel', 'forest', 'crafting'],
  },
  {
    id: 'iron_ore', name: '철광석', category: 'raw', unit: '자루',
    basePrice: 18, weight: 2.5, perishRate: 0, essential: false,
    tags: ['mine', 'metal', 'smithing_input'],
  },
  {
    id: 'silver_ore', name: '은광석', category: 'raw', unit: '자루',
    basePrice: 55, weight: 2, perishRate: 0, essential: false,
    tags: ['mine', 'precious_metal', 'luxury_input'],
  },
  {
    id: 'wool', name: '양모', category: 'raw', unit: '꾸러미',
    basePrice: 16, weight: 0.8, perishRate: 0.001, essential: false,
    tags: ['livestock', 'textile_input', 'cold_region'],
  },
  {
    id: 'hides', name: '가죽 원피', category: 'raw', unit: '묶음',
    basePrice: 15, weight: 1.1, perishRate: 0.03, essential: false,
    tags: ['livestock', 'leather_input'],
  },
  {
    id: 'clay', name: '점토', category: 'raw', unit: '자루',
    basePrice: 6, weight: 2.2, perishRate: 0, essential: false,
    tags: ['construction', 'pottery_input', 'river'],
  },
  {
    id: 'planks', name: '판재', category: 'processed', unit: '묶음',
    basePrice: 24, weight: 1.6, perishRate: 0, essential: false,
    tags: ['construction', 'crafting', 'timber_product'],
  },
  {
    id: 'charcoal', name: '목탄', category: 'processed', unit: '자루',
    basePrice: 16, weight: 0.7, perishRate: 0.002, essential: false,
    tags: ['fuel', 'smelting_input', 'smithing'],
  },
  {
    id: 'iron_ingot', name: '철괴', category: 'processed', unit: '덩이',
    basePrice: 48, weight: 1.8, perishRate: 0, essential: false,
    tags: ['metal', 'smithing', 'military_input'],
  },
  {
    id: 'cloth', name: '직물', category: 'processed', unit: '두루마리',
    basePrice: 38, weight: 0.5, perishRate: 0.002, essential: false,
    tags: ['textile', 'civilian_good', 'military_input'],
  },
  {
    id: 'leather', name: '가죽', category: 'processed', unit: '두루마리',
    basePrice: 34, weight: 0.7, perishRate: 0.005, essential: false,
    tags: ['leather', 'civilian_good', 'military_input'],
  },
  {
    id: 'pottery', name: '도기', category: 'processed', unit: '상자',
    basePrice: 20, weight: 1.2, perishRate: 0, essential: false,
    tags: ['household', 'trade_good', 'clay_product'],
  },
  {
    id: 'weapons', name: '무기', category: 'military', unit: '세트',
    basePrice: 120, weight: 1.5, perishRate: 0, essential: false,
    tags: ['recruitment', 'army_supply', 'smithing'],
  },
  {
    id: 'armor', name: '갑옷', category: 'military', unit: '세트',
    basePrice: 180, weight: 2.5, perishRate: 0, essential: false,
    tags: ['recruitment', 'army_supply', 'smithing'],
  },
  {
    id: 'arrows', name: '화살', category: 'military', unit: '묶음',
    basePrice: 26, weight: 0.4, perishRate: 0, essential: false,
    tags: ['army_supply', 'ranged_ammunition', 'fletching'],
  },
  {
    id: 'horses', name: '군마', category: 'military', unit: '마리',
    basePrice: 260, weight: 8, perishRate: 0.002, essential: false,
    tags: ['recruitment', 'cavalry', 'live_animal'],
  },
  {
    id: 'wine', name: '포도주', category: 'luxury', unit: '통',
    basePrice: 65, weight: 1.4, perishRate: 0.001, essential: false,
    tags: ['luxury', 'tavern', 'noble_demand', 'trade_good'],
  },
  {
    id: 'spices', name: '향신료', category: 'luxury', unit: '상자',
    basePrice: 140, weight: 0.3, perishRate: 0.001, essential: false,
    tags: ['luxury', 'import', 'noble_demand', 'trade_good'],
  },
  {
    id: 'jewelry', name: '장신구', category: 'luxury', unit: '상자',
    basePrice: 320, weight: 0.2, perishRate: 0, essential: false,
    tags: ['luxury', 'precious', 'noble_demand', 'trade_good'],
  },
  {
    id: 'travel_rations', name: '여행용 건량', category: 'food', unit: '배급',
    basePrice: 10, weight: 0.75, perishRate: 0.01, essential: true, volume: 0.8, nutritionValue: 1, temporaryBalanceValues: true,
    tags: ['food', 'army_food', 'travel_food', 'legacy_food_migration'],
  },
];

const withPhysicalDefaults = (resource) => ({
  ...resource,
  volume: resource.volume ?? resource.weight,
  weightUnitId: 'kg',
  volumeUnitId: 'l',
  nutritionValue: resource.nutritionValue ?? (resource.category === 'food' ? 1 : 0),
});

function resourceProblems(data) {
  const problems = [];
  if (typeof data.name !== 'string' || data.name.trim() === '') problems.push('invalid_resource_name');
  if (!RESOURCE_CATEGORIES.includes(data.category)) problems.push('invalid_resource_category');
  if (typeof data.unit !== 'string' || data.unit === '') problems.push('invalid_resource_unit');
  if (data.weightUnitId !== undefined && !WEIGHT_UNITS.includes(data.weightUnitId)) problems.push('unsupported_weight_unit');
  if (data.volumeUnitId !== undefined && !VOLUME_UNITS.includes(data.volumeUnitId)) problems.push('unsupported_volume_unit');
  if (!isMeasure(data.basePrice)) problems.push('invalid_base_price');
  if (!isMeasure(data.weight)) problems.push('invalid_weight');
  if (data.volume !== undefined && !isMeasure(data.volume)) problems.push('invalid_volume');
  if (data.nutritionValue !== undefined && !isMeasure(data.nutritionValue)) problems.push('invalid_nutrition_value');
  if (!isMeasure(data.perishRate) || data.perishRate > 1) problems.push('invalid_perish_rate');
  if (typeof data.essential !== 'boolean') problems.push('invalid_essential');
  if (!Array.isArray(data.tags) || !data.tags.every((tag) => typeof tag === 'string')) problems.push('invalid_tags');
  return problems;
}

const registerOnce = (domainId, options) => {
  if (!hasDefinitionDomain(domainId)) registerDefinitionDomain(domainId, options);
};

registerOnce('resource', { validate: resourceProblems, defaults: RESOURCES.map(withPhysicalDefaults) });

registerOnce('equipment_slot', {
  validate: (data) => {
    const problems = [];
    if (data.compatibleTags !== undefined && !Array.isArray(data.compatibleTags)) problems.push('invalid_compatible_tags');
    if (data.capacity !== undefined && !isMeasure(data.capacity)) problems.push('invalid_capacity');
    return problems;
  },
  defaults: [
    { id: 'main_hand', compatibleTags: ['weapon'], capacity: 1 },
    { id: 'off_hand', compatibleTags: ['weapon', 'shield'], capacity: 1 },
    { id: 'body', compatibleTags: ['armor'], capacity: 1 },
    { id: 'mount', compatibleTags: ['mount'], capacity: 1 },
    // A bow or crossbow carried as well as the hand weapons (as in Bannerlord, a slot of its own).
    { id: 'ranged', compatibleTags: ['ranged'], capacity: 1 },
  ],
});

// Equipment items and what each does in battle. slot is the equipment slot it is worn or carried in; battle
// holds the numbers the 3D battle reads (m2/M2_HeroLoadout.js): a hand weapon's weaponClass (the skill it
// uses), damage, reach (m) and cooldownTicks (20 a second); a shield's block (the share of a blocked blow
// that still lands); a bow or crossbow's damage, reloadTicks, speed (m/s) and range (m); body armor's armor
// (20 halves a blow); a horse's speed (m/s) and hpBonus.
export const EQUIPMENT_ITEMS = Object.freeze([
  { id: 'spear', name: '창', slot: 'main_hand', tags: ['weapon'], battle: { weaponClass: 'polearm', damage: 8, reach: 2.0, cooldownTicks: 16 } },
  { id: 'lance', name: '기병창', slot: 'main_hand', tags: ['weapon'], battle: { weaponClass: 'polearm', damage: 9, reach: 2.4, cooldownTicks: 20 } },
  { id: 'arming_sword', name: '한손검', slot: 'main_hand', tags: ['weapon'], battle: { weaponClass: 'one_handed', damage: 7, reach: 1.3, cooldownTicks: 12 } },
  { id: 'mace', name: '철퇴', slot: 'main_hand', tags: ['weapon'], battle: { weaponClass: 'one_handed', damage: 8, reach: 1.1, cooldownTicks: 14 } },
  { id: 'long_sword', name: '장검', slot: 'main_hand', tags: ['weapon'], battle: { weaponClass: 'two_handed', damage: 11, reach: 1.6, cooldownTicks: 20 } },
  { id: 'round_shield', name: '원형 방패', slot: 'off_hand', tags: ['shield'], battle: { kind: 'shield', block: 0.4 } },
  { id: 'kite_shield', name: '연 방패', slot: 'off_hand', tags: ['shield'], battle: { kind: 'shield', block: 0.3 } },
  { id: 'hunting_bow', name: '사냥활', slot: 'ranged', tags: ['ranged'], battle: { weaponClass: 'bow', damage: 10, reloadTicks: 20, speed: 12, range: 22 } },
  { id: 'war_bow', name: '전쟁활', slot: 'ranged', tags: ['ranged'], battle: { weaponClass: 'bow', damage: 13, reloadTicks: 26, speed: 14, range: 26 } },
  { id: 'crossbow', name: '석궁', slot: 'ranged', tags: ['ranged'], battle: { weaponClass: 'crossbow', damage: 18, reloadTicks: 60, speed: 30, range: 24 } },
  { id: 'gambeson', name: '누비옷', slot: 'body', tags: ['armor'], battle: { armor: 6 } },
  { id: 'mail_shirt', name: '사슬 셔츠', slot: 'body', tags: ['armor'], battle: { armor: 15 } },
  { id: 'mail_hauberk', name: '사슬 갑옷', slot: 'body', tags: ['armor'], battle: { armor: 22 } },
  { id: 'coat_of_plates', name: '판금 조끼', slot: 'body', tags: ['armor'], battle: { armor: 30 } },
  { id: 'rouncey', name: '승용마', slot: 'mount', tags: ['mount'], battle: { speed: 5.0, hpBonus: 80 } },
  { id: 'courser', name: '군마', slot: 'mount', tags: ['mount'], battle: { speed: 5.6, hpBonus: 100 } },
  { id: 'destrier', name: '전마', slot: 'mount', tags: ['mount'], battle: { speed: 5.2, hpBonus: 160 } },
].map((item) => Object.freeze({ ...item, tags: Object.freeze([...item.tags]), battle: Object.freeze({ ...item.battle }) })));

const WEAPON_CLASSES = new Set(['one_handed', 'two_handed', 'polearm']);
const RANGED_CLASSES = new Set(['bow', 'crossbow']);
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

// What an equipment item must say for its slot: the numbers the battle reads.
function equipmentItemProblems(data, lookup) {
  const problems = [];
  if (typeof data.slot !== 'string' || !lookup.has('equipment_slot', data.slot)) return ['missing_slot_reference'];
  if (!Array.isArray(data.tags) || !data.tags.every((tag) => typeof tag === 'string')) problems.push('invalid_tags');
  const battle = data.battle;
  if (!isRecord(battle)) return [...problems, 'invalid_battle'];
  const need = (keys) => keys.filter((key) => !positive(battle[key])).map((key) => `invalid_battle_${key}`);
  if (data.slot === 'main_hand') {
    if (!WEAPON_CLASSES.has(battle.weaponClass)) problems.push('invalid_battle_weaponClass');
    problems.push(...need(['damage', 'reach', 'cooldownTicks']));
  } else if (data.slot === 'off_hand') {
    if (battle.kind !== 'shield' || !(positive(battle.block) && battle.block < 1)) problems.push('invalid_battle_block');
  } else if (data.slot === 'ranged') {
    if (!RANGED_CLASSES.has(battle.weaponClass)) problems.push('invalid_battle_weaponClass');
    problems.push(...need(['damage', 'reloadTicks', 'speed', 'range']));
  } else if (data.slot === 'body') {
    problems.push(...need(['armor']));
  } else if (data.slot === 'mount') {
    problems.push(...need(['speed', 'hpBonus']));
  }
  return problems;
}

registerOnce('equipment_item', { validate: equipmentItemProblems, defaults: EQUIPMENT_ITEMS });

registerOnce('cargo_purpose', {
  defaults: [{ id: 'supply' }, { id: 'contract' }, { id: 'mission' }, { id: 'personal_assignment' }],
});

export const getResource = (state, id) => getDefinition(state, 'resource', id);
export const hasEquipmentSlot = (state, id) => getDefinition(state, 'equipment_slot', id) !== null;
export const getEquipmentItem = (state, id) => getDefinition(state, 'equipment_item', id);
export const hasCargoPurpose = (state, id) => getDefinition(state, 'cargo_purpose', id) !== null;

// ---------------------------------------------------------------- record checks

const refOrNull = (value) => value === null || isStoredRef(value);

function equipmentProblems(state, item, at) {
  const problems = [];
  if (!isRecord(item)) return [`${at}:not_a_record`];
  if (!isStoredId(item.instanceId)) problems.push(`${at}:invalid_instance_id`);
  if (!isStoredId(item.itemDefinitionId)) problems.push(`${at}:invalid_equipment_definition`);
  if (item.slotDefinitionId !== null && !(isStoredId(item.slotDefinitionId) && hasEquipmentSlot(state, item.slotDefinitionId))) problems.push(`${at}:unregistered_equipment_slot`);
  if (!isMeasure(item.weightKg) || !isMeasure(item.volumeL)) problems.push(`${at}:invalid_weight_or_volume`);
  if (!Array.isArray(item.tags) || !item.tags.every((tag) => typeof tag === 'string') || new Set(item.tags).size !== item.tags.length) problems.push(`${at}:invalid_tags`);
  if (!refOrNull(item.ownershipRef) || !refOrNull(item.assignmentRef)) problems.push(`${at}:invalid_ref`);
  if (!isRecord(item.customData)) problems.push(`${at}:invalid_custom_data`);
  return problems;
}

function cargoProblems(state, cargo, at) {
  const problems = [];
  if (!isRecord(cargo)) return [`${at}:not_a_record`];
  if (!isStoredId(cargo.cargoId)) problems.push(`${at}:invalid_cargo_id`);
  if (!isStoredId(cargo.itemDefinitionId)) problems.push(`${at}:invalid_cargo_item_definition`);
  if (!(isStoredId(cargo.cargoPurposeId) && hasCargoPurpose(state, cargo.cargoPurposeId))) problems.push(`${at}:unregistered_cargo_purpose`);
  if (!isCount(cargo.quantity)) problems.push(`${at}:invalid_quantity`);
  if (!isMeasure(cargo.weightKg) || !isMeasure(cargo.volumeL)) problems.push(`${at}:invalid_weight_or_volume`);
  if (!refOrNull(cargo.ownershipRef) || !refOrNull(cargo.assignmentRef)) problems.push(`${at}:invalid_ref`);
  if (!isRecord(cargo.customData)) problems.push(`${at}:invalid_custom_data`);
  return problems;
}

// Reasons one inventory cannot be stored, as codes (empty when it is fine).
export function inventoryProblems(state, inventory) {
  const problems = [];
  if (!isRecord(inventory)) return ['not_a_record'];
  if (!isStoredId(inventory.id)) problems.push('invalid_inventory_id');
  if (inventory.version !== 1) problems.push('unsupported_version');
  if (!isCount(inventory.revision)) problems.push('invalid_revision');
  if (!isStoredRef(inventory.ownerRef) || !isKnownOwnerType(state, inventory.ownerRef.type)) problems.push('invalid_owner_ref');
  else if (!refExists(state, inventory.ownerRef)) problems.push('owner_missing');
  if (!isRecord(inventory.capacity) || !isMeasure(inventory.capacity.weightKg) || !isMeasure(inventory.capacity.volumeL)) problems.push('invalid_capacity');
  if (!isRecord(inventory.bulkItems)) {
    problems.push('invalid_bulk_items');
  } else {
    for (const [id, quantity] of Object.entries(inventory.bulkItems)) {
      if (getResource(state, id) === null) problems.push(`bulkItems.${id}:unregistered_resource`);
      if (!isCount(quantity)) problems.push(`bulkItems.${id}:invalid_quantity`);
    }
  }
  if (!Array.isArray(inventory.equipmentItems)) {
    problems.push('invalid_equipment_items');
  } else {
    inventory.equipmentItems.forEach((item, index) => problems.push(...equipmentProblems(state, item, `equipmentItems[${index}]`)));
    const ids = inventory.equipmentItems.map((item) => item?.instanceId);
    if (new Set(ids).size !== ids.length) problems.push('duplicate_instance_id');
  }
  if (!Array.isArray(inventory.assignedCargo)) {
    problems.push('invalid_assigned_cargo');
  } else {
    inventory.assignedCargo.forEach((cargo, index) => problems.push(...cargoProblems(state, cargo, `assignedCargo[${index}]`)));
    const ids = inventory.assignedCargo.map((cargo) => cargo?.cargoId);
    if (new Set(ids).size !== ids.length) problems.push('duplicate_cargo_id');
  }
  if (!isRecord(inventory.customData)) problems.push('invalid_custom_data');
  return problems;
}

export function checkInventory(state) {
  const inventories = state?.world?.inventories;
  if (!isRecord(inventories)) return fail('inventory_invalid', ['world.inventories:not_a_record']);
  const issues = [];
  const seenInstances = new Map();
  const seenCargo = new Map();
  for (const id of Object.keys(inventories).sort()) {
    const inventory = inventories[id];
    if (!isStoredId(id)) issues.push(`world.inventories.${id}:invalid_map_key`);
    if (isRecord(inventory) && inventory.id !== id) issues.push(`world.inventories.${id}:record_id_mismatch`);
    for (const code of inventoryProblems(state, inventory)) issues.push(`world.inventories.${id}.${code}`);
    // An item lives in one inventory only; the same id in two would be a duplicated item.
    if (isRecord(inventory) && Array.isArray(inventory.equipmentItems)) {
      for (const item of inventory.equipmentItems) {
        if (seenInstances.has(item?.instanceId)) issues.push(`world.inventories.${id}:instance_in_two_inventories:${item.instanceId}`);
        seenInstances.set(item?.instanceId, id);
      }
    }
    if (isRecord(inventory) && Array.isArray(inventory.assignedCargo)) {
      for (const cargo of inventory.assignedCargo) {
        if (seenCargo.has(cargo?.cargoId)) issues.push(`world.inventories.${id}:cargo_in_two_inventories:${cargo.cargoId}`);
        seenCargo.set(cargo?.cargoId, id);
      }
    }
  }
  return issues.length ? fail('inventory_invalid', issues) : ok();
}
