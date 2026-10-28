// Inventory actions on a store draft: bulk goods, equipment items and assigned cargo, with a weight
// and volume capacity. Each rule builds the changed inventory on a copy, checks the result, and only
// then writes it, so a failure leaves the draft exactly as it was (and store.transact discards it
// anyway). Moving items between two inventories is one rule that changes both or neither.
import { clone, isRecord } from '../../core/data.js';
import { isId } from '../../core/ids.js';
import { ok, fail } from '../../core/result.js';
import { refExists } from '../definitions/index.js';
import { isKnownOwnerType } from '../finance/index.js';
import {
  getResource, hasCargoPurpose, hasEquipmentSlot, inventoryProblems, isMeasure, isQuantity, isStoredId, isStoredRef,
} from './checks.js';

const inventoriesOf = (draft) => draft.world.inventories;

function findInventory(draft, id) {
  return isStoredId(id) && Object.hasOwn(inventoriesOf(draft), id) ? inventoriesOf(draft)[id] : null;
}

// Weights and volumes are sums of decimals; rounding keeps "exactly at the limit" exact.
const round6 = (value) => Math.round(value * 1e6) / 1e6;

// Quantity held of a bulk item; own keys only, so an odd id such as "__proto__" holds nothing.
const heldOf = (bulkItems, id) => (Object.hasOwn(bulkItems, id) ? bulkItems[id] : 0);

// ---------------------------------------------------------------- load and capacity

// Weight and volume carried, against the limits. A limit of 0 means "no limit" (as in the earlier
// version, where the new-game inventory has 0 / 0). Reads only; accepts an inventory record or its id.
export function calculateLoad(state, inventoryOrId) {
  const inventory = typeof inventoryOrId === 'string' ? state.world.inventories[inventoryOrId] : inventoryOrId;
  if (!isRecord(inventory)) return null;
  let weightKg = 0;
  let volumeL = 0;
  for (const [id, quantity] of Object.entries(inventory.bulkItems)) {
    const resource = getResource(state, id);
    if (resource === null) continue;
    weightKg += quantity * resource.weight;
    volumeL += quantity * (resource.volume ?? resource.weight);
  }
  for (const item of inventory.equipmentItems) {
    weightKg += item.weightKg;
    volumeL += item.volumeL;
  }
  for (const cargo of inventory.assignedCargo) {
    // A lot states its own weight and volume; when it does not (0), they come from the resource.
    const resource = getResource(state, cargo.itemDefinitionId);
    weightKg += cargo.weightKg || (resource ? cargo.quantity * resource.weight : 0);
    volumeL += cargo.volumeL || (resource ? cargo.quantity * (resource.volume ?? resource.weight) : 0);
  }
  weightKg = round6(weightKg);
  volumeL = round6(volumeL);
  const { weightKg: weightLimitKg, volumeL: volumeLimitL } = inventory.capacity;
  return {
    weightKg,
    volumeL,
    weightLimitKg,
    volumeLimitL,
    overweight: weightLimitKg > 0 && weightKg > weightLimitKg,
    overvolume: volumeLimitL > 0 && volumeL > volumeLimitL,
  };
}

// Nutrition carried as food, and how many days it feeds `dailyNeed`.
export function getFoodSummary(state, inventoryId, dailyNeed = 0) {
  const inventory = state.world.inventories[inventoryId];
  if (!isRecord(inventory)) return null;
  let nutrition = 0;
  for (const [id, quantity] of Object.entries(inventory.bulkItems)) {
    const resource = getResource(state, id);
    if (resource !== null && (resource.category === 'food' || resource.tags.includes('food') || resource.tags.some((tag) => tag.endsWith('_food')))) {
      nutrition += quantity * resource.nutritionValue;
    }
  }
  const need = Number.isFinite(dailyNeed) && dailyNeed > 0 ? dailyNeed : 0;
  return { nutrition, dailyNeed: need, supplyDays: need > 0 ? nutrition / need : null };
}

// Refuses a result that is over a weight or volume limit (so adding to an inventory that is already
// overloaded is refused too). `allowOverload` is for the caller that accepts a heavy load: the
// earlier version only reported overload and let the party carry on.
function capacityVerdict(draft, next, allowOverload) {
  if (allowOverload) return ok();
  const load = calculateLoad(draft, next);
  if (load.overweight || load.overvolume) {
    return fail('inventory_over_capacity', {
      inventoryId: next.id, weightKg: load.weightKg, weightLimitKg: load.weightLimitKg, volumeL: load.volumeL, volumeLimitL: load.volumeLimitL,
    });
  }
  return ok();
}

function optionalFlag(input, name) {
  if (input[name] !== undefined && typeof input[name] !== 'boolean') return fail('inventory_invalid_input', { field: name });
  return ok({ value: input[name] === true });
}

// Last step of every rule that changes one inventory: the new record must pass the same checks as
// a saved one, then it replaces the old with its revision raised by one.
function commit(draft, current, next) {
  next.revision = current.revision + 1;
  const problems = inventoryProblems(draft, next);
  if (problems.length) return fail('inventory_invalid', { inventoryId: next.id, problems });
  inventoriesOf(draft)[next.id] = next;
  return ok();
}

// ---------------------------------------------------------------- inventories

// input: { id, ownerRef, capacity?: { weightKg, volumeL } }
export function createInventory(draft, input) {
  if (!isRecord(input)) return fail('inventory_invalid_input');
  const { id, ownerRef } = input;
  if (!isId(id)) return fail('inventory_invalid_id', { id });
  if (Object.hasOwn(inventoriesOf(draft), id)) return fail('inventory_duplicate_id', { id });
  if (!isStoredRef(ownerRef) || !isKnownOwnerType(draft, ownerRef.type)) return fail('inventory_invalid_owner', { ownerRef });
  if (!refExists(draft, ownerRef)) return fail('inventory_owner_missing', { ownerRef });
  const capacity = input.capacity ?? { weightKg: 0, volumeL: 0 };
  if (!isRecord(capacity) || !isMeasure(capacity.weightKg) || !isMeasure(capacity.volumeL)) return fail('inventory_invalid_capacity', { capacity });
  const inventory = {
    id,
    version: 1,
    revision: 0,
    ownerRef: { id: ownerRef.id, type: ownerRef.type },
    bulkItems: {},
    equipmentItems: [],
    assignedCargo: [],
    capacity: { volumeL: capacity.volumeL, weightKg: capacity.weightKg },
    customData: {},
  };
  const problems = inventoryProblems(draft, inventory);
  if (problems.length) return fail('inventory_invalid', { inventoryId: id, problems });
  inventoriesOf(draft)[id] = inventory;
  return ok({ inventoryId: id });
}

// input: { inventoryId, ownerRef }
export function changeInventoryOwner(draft, input) {
  const current = findInventory(draft, input?.inventoryId);
  if (!current) return fail('inventory_missing', { inventoryId: input?.inventoryId });
  const ownerRef = input.ownerRef;
  if (!isStoredRef(ownerRef) || !isKnownOwnerType(draft, ownerRef.type)) return fail('inventory_invalid_owner', { ownerRef });
  if (!refExists(draft, ownerRef)) return fail('inventory_owner_missing', { ownerRef });
  if (current.ownerRef.type === ownerRef.type && current.ownerRef.id === ownerRef.id) return fail('inventory_no_change');
  const next = clone(current);
  next.ownerRef = { id: ownerRef.id, type: ownerRef.type };
  const committed = commit(draft, current, next);
  return committed.ok ? ok({ inventoryId: current.id }) : committed;
}

// Sets the carrying limits (0 = no limit). A limit below what is carried is allowed: the inventory
// then counts as overloaded and takes nothing more. input: { inventoryId, weightKg, volumeL }
export function setCapacity(draft, input) {
  const current = findInventory(draft, input?.inventoryId);
  if (!current) return fail('inventory_missing', { inventoryId: input?.inventoryId });
  const { weightKg, volumeL } = input;
  if (!isMeasure(weightKg) || !isMeasure(volumeL)) return fail('inventory_invalid_capacity', { weightKg, volumeL });
  if (current.capacity.weightKg === weightKg && current.capacity.volumeL === volumeL) return fail('inventory_no_change');
  const next = clone(current);
  next.capacity = { volumeL, weightKg };
  const committed = commit(draft, current, next);
  return committed.ok ? ok({ inventoryId: current.id, load: calculateLoad(draft, inventoriesOf(draft)[current.id]) }) : committed;
}

// ---------------------------------------------------------------- bulk goods

function bulkInput(draft, input) {
  const current = findInventory(draft, input?.inventoryId);
  if (!current) return fail('inventory_missing', { inventoryId: input?.inventoryId });
  const { itemDefinitionId, quantity } = input;
  if (typeof itemDefinitionId !== 'string' || getResource(draft, itemDefinitionId) === null) return fail('inventory_unregistered_resource', { itemDefinitionId });
  if (!isQuantity(quantity)) return fail('inventory_invalid_quantity', { quantity });
  return ok({ current, itemDefinitionId, quantity });
}

// input: { inventoryId, itemDefinitionId, quantity, allowOverload? }
export function addBulk(draft, input) {
  const parsed = bulkInput(draft, input);
  if (!parsed.ok) return parsed;
  const overload = optionalFlag(input, 'allowOverload');
  if (!overload.ok) return overload;
  const { current, itemDefinitionId, quantity } = parsed;
  const total = heldOf(current.bulkItems, itemDefinitionId) + quantity;
  if (!Number.isSafeInteger(total)) return fail('inventory_invalid_quantity', { quantity });
  const next = clone(current);
  next.bulkItems[itemDefinitionId] = total;
  const fits = capacityVerdict(draft, next, overload.value);
  if (!fits.ok) return fits;
  const committed = commit(draft, current, next);
  return committed.ok ? ok({ inventoryId: current.id, itemDefinitionId, quantity: total }) : committed;
}

// input: { inventoryId, itemDefinitionId, quantity }. A quantity that reaches zero removes the entry.
export function removeBulk(draft, input) {
  const parsed = bulkInput(draft, input);
  if (!parsed.ok) return parsed;
  const { current, itemDefinitionId, quantity } = parsed;
  const held = heldOf(current.bulkItems, itemDefinitionId);
  if (held < quantity) return fail('inventory_insufficient_quantity', { itemDefinitionId, held, quantity });
  const next = clone(current);
  if (held === quantity) delete next.bulkItems[itemDefinitionId];
  else next.bulkItems[itemDefinitionId] = held - quantity;
  const committed = commit(draft, current, next);
  return committed.ok ? ok({ inventoryId: current.id, itemDefinitionId, quantity: held - quantity }) : committed;
}

// ---------------------------------------------------------------- equipment items

const EQUIPMENT_FIELDS = ['instanceId', 'itemDefinitionId', 'slotDefinitionId', 'ownershipRef', 'assignmentRef', 'weightKg', 'volumeL', 'tags', 'customData'];
const CARGO_FIELDS = ['cargoId', 'itemDefinitionId', 'cargoPurposeId', 'quantity', 'ownershipRef', 'assignmentRef', 'weightKg', 'volumeL', 'customData'];

const copyRef = (ref) => (ref === null ? null : { id: ref.id, type: ref.type });

// The two ref fields shared by equipment items and cargo lots: null or a { type, id } reference.
function refsOf(input, code) {
  const ownershipRef = input.ownershipRef ?? null;
  const assignmentRef = input.assignmentRef ?? null;
  if (ownershipRef !== null && !isStoredRef(ownershipRef)) return fail(code, { field: 'ownershipRef' });
  if (assignmentRef !== null && !isStoredRef(assignmentRef)) return fail(code, { field: 'assignmentRef' });
  return ok({ ownershipRef: copyRef(ownershipRef), assignmentRef: copyRef(assignmentRef) });
}

function unknownFields(input, allowed) {
  return Object.keys(input).filter((key) => !allowed.includes(key));
}

function instanceInUse(draft, instanceId) {
  return Object.values(inventoriesOf(draft)).some((inventory) => inventory.equipmentItems.some((item) => item.instanceId === instanceId));
}

function cargoInUse(draft, cargoId) {
  return Object.values(inventoriesOf(draft)).some((inventory) => inventory.assignedCargo.some((cargo) => cargo.cargoId === cargoId));
}

function buildEquipment(draft, input) {
  if (!isRecord(input)) return fail('inventory_invalid_item');
  const unknown = unknownFields(input, EQUIPMENT_FIELDS);
  if (unknown.length) return fail('inventory_invalid_item', { unknown });
  if (!isId(input.instanceId)) return fail('inventory_invalid_item', { field: 'instanceId' });
  if (!isId(input.itemDefinitionId)) return fail('inventory_invalid_item', { field: 'itemDefinitionId' });
  const slotDefinitionId = input.slotDefinitionId ?? null;
  if (slotDefinitionId !== null && !(typeof slotDefinitionId === 'string' && hasEquipmentSlot(draft, slotDefinitionId))) return fail('inventory_unregistered_equipment_slot', { slotDefinitionId });
  const weightKg = input.weightKg ?? 0;
  const volumeL = input.volumeL ?? 0;
  if (!isMeasure(weightKg) || !isMeasure(volumeL)) return fail('inventory_invalid_item', { field: 'weightKg/volumeL' });
  const tags = input.tags ?? [];
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string' && tag !== '')) return fail('inventory_invalid_item', { field: 'tags' });
  const customData = input.customData ?? {};
  if (!isRecord(customData)) return fail('inventory_invalid_item', { field: 'customData' });
  const refs = refsOf(input, 'inventory_invalid_item');
  if (!refs.ok) return refs;
  return ok({
    item: {
      instanceId: input.instanceId,
      itemDefinitionId: input.itemDefinitionId,
      slotDefinitionId,
      ownershipRef: refs.ownershipRef,
      assignmentRef: refs.assignmentRef,
      weightKg,
      volumeL,
      tags: [...new Set(tags)],
      customData: clone(customData),
    },
  });
}

// input: { inventoryId, item: { instanceId, itemDefinitionId, slotDefinitionId?, weightKg?, volumeL?, tags?, ownershipRef?, assignmentRef?, customData? }, allowOverload? }
export function addEquipment(draft, input) {
  const current = findInventory(draft, input?.inventoryId);
  if (!current) return fail('inventory_missing', { inventoryId: input?.inventoryId });
  const overload = optionalFlag(input, 'allowOverload');
  if (!overload.ok) return overload;
  const built = buildEquipment(draft, input.item);
  if (!built.ok) return built;
  if (instanceInUse(draft, built.item.instanceId)) return fail('inventory_duplicate_equipment', { instanceId: built.item.instanceId });
  const next = clone(current);
  next.equipmentItems.push(built.item);
  const fits = capacityVerdict(draft, next, overload.value);
  if (!fits.ok) return fits;
  const committed = commit(draft, current, next);
  return committed.ok ? ok({ inventoryId: current.id, instanceId: built.item.instanceId }) : committed;
}

function equipmentIndex(inventory, instanceId) {
  return inventory.equipmentItems.findIndex((item) => item.instanceId === instanceId);
}

// input: { inventoryId, instanceId }
export function removeEquipment(draft, input) {
  const current = findInventory(draft, input?.inventoryId);
  if (!current) return fail('inventory_missing', { inventoryId: input?.inventoryId });
  const index = equipmentIndex(current, input.instanceId);
  if (index < 0) return fail('inventory_missing_equipment', { instanceId: input.instanceId });
  const next = clone(current);
  const [item] = next.equipmentItems.splice(index, 1);
  const committed = commit(draft, current, next);
  return committed.ok ? ok({ inventoryId: current.id, item }) : committed;
}

// Equips an item in a slot, or takes it off (slotDefinitionId null). input: { inventoryId, instanceId, slotDefinitionId }
// The earlier version never checked an item's tags against the slot's, nor a slot's capacity (a group
// inventory holds one slot per member), so neither is checked here.
export function setEquipmentSlot(draft, input) {
  const current = findInventory(draft, input?.inventoryId);
  if (!current) return fail('inventory_missing', { inventoryId: input?.inventoryId });
  const index = equipmentIndex(current, input.instanceId);
  if (index < 0) return fail('inventory_missing_equipment', { instanceId: input.instanceId });
  const slotDefinitionId = input.slotDefinitionId;
  if (slotDefinitionId !== null && !(typeof slotDefinitionId === 'string' && hasEquipmentSlot(draft, slotDefinitionId))) return fail('inventory_unregistered_equipment_slot', { slotDefinitionId });
  if (current.equipmentItems[index].slotDefinitionId === slotDefinitionId) return fail('inventory_no_change');
  const next = clone(current);
  next.equipmentItems[index].slotDefinitionId = slotDefinitionId;
  const committed = commit(draft, current, next);
  return committed.ok ? ok({ inventoryId: current.id, instanceId: input.instanceId }) : committed;
}

// ---------------------------------------------------------------- assigned cargo

function buildCargo(draft, input) {
  if (!isRecord(input)) return fail('inventory_invalid_cargo');
  const unknown = unknownFields(input, CARGO_FIELDS);
  if (unknown.length) return fail('inventory_invalid_cargo', { unknown });
  if (!isId(input.cargoId)) return fail('inventory_invalid_cargo', { field: 'cargoId' });
  if (!isId(input.itemDefinitionId)) return fail('inventory_invalid_cargo', { field: 'itemDefinitionId' });
  const cargoPurposeId = input.cargoPurposeId ?? 'supply';
  if (!(typeof cargoPurposeId === 'string' && hasCargoPurpose(draft, cargoPurposeId))) return fail('inventory_unregistered_cargo_purpose', { cargoPurposeId });
  if (!isQuantity(input.quantity)) return fail('inventory_invalid_quantity', { quantity: input.quantity });
  const weightKg = input.weightKg ?? 0;
  const volumeL = input.volumeL ?? 0;
  if (!isMeasure(weightKg) || !isMeasure(volumeL)) return fail('inventory_invalid_cargo', { field: 'weightKg/volumeL' });
  const customData = input.customData ?? {};
  if (!isRecord(customData)) return fail('inventory_invalid_cargo', { field: 'customData' });
  const refs = refsOf(input, 'inventory_invalid_cargo');
  if (!refs.ok) return refs;
  return ok({
    cargo: {
      cargoId: input.cargoId,
      itemDefinitionId: input.itemDefinitionId,
      cargoPurposeId,
      quantity: input.quantity,
      ownershipRef: refs.ownershipRef,
      assignmentRef: refs.assignmentRef,
      weightKg,
      volumeL,
      customData: clone(customData),
    },
  });
}

// input: { inventoryId, cargo: { cargoId, itemDefinitionId, quantity, cargoPurposeId?, weightKg?, volumeL?, ownershipRef?, assignmentRef?, customData? }, allowOverload? }
export function addCargo(draft, input) {
  const current = findInventory(draft, input?.inventoryId);
  if (!current) return fail('inventory_missing', { inventoryId: input?.inventoryId });
  const overload = optionalFlag(input, 'allowOverload');
  if (!overload.ok) return overload;
  const built = buildCargo(draft, input.cargo);
  if (!built.ok) return built;
  if (cargoInUse(draft, built.cargo.cargoId)) return fail('inventory_duplicate_cargo', { cargoId: built.cargo.cargoId });
  const next = clone(current);
  next.assignedCargo.push(built.cargo);
  const fits = capacityVerdict(draft, next, overload.value);
  if (!fits.ok) return fits;
  const committed = commit(draft, current, next);
  return committed.ok ? ok({ inventoryId: current.id, cargoId: built.cargo.cargoId }) : committed;
}

// Removes a whole cargo lot (delivered or handed over). input: { inventoryId, cargoId }
export function removeCargo(draft, input) {
  const current = findInventory(draft, input?.inventoryId);
  if (!current) return fail('inventory_missing', { inventoryId: input?.inventoryId });
  const index = current.assignedCargo.findIndex((cargo) => cargo.cargoId === input.cargoId);
  if (index < 0) return fail('inventory_missing_cargo', { cargoId: input.cargoId });
  const next = clone(current);
  const [cargo] = next.assignedCargo.splice(index, 1);
  const committed = commit(draft, current, next);
  return committed.ok ? ok({ inventoryId: current.id, cargo }) : committed;
}

// A lot that loses part of its quantity keeps its share of the weight and volume it stated (the
// earlier version left them unchanged, so a half-spoiled lot weighed as much as a whole one).
function reduceCargo(cargo, loss) {
  const remaining = cargo.quantity - loss;
  const share = remaining / cargo.quantity;
  cargo.quantity = remaining;
  cargo.weightKg = round6(cargo.weightKg * share);
  cargo.volumeL = round6(cargo.volumeL * share);
}

const isLossMap = (value) => isRecord(value) && Object.values(value).every(isQuantity);

// Spoilage, theft or battle losses. Every loss must be covered by what is held: one that is not fails
// the whole rule (the earlier version failed for bulk goods but silently capped cargo losses).
// A cargo lot reduced to nothing is removed. input: { inventoryId, bulkLosses?: { resourceId: quantity }, cargoLosses?: { cargoId: quantity } }
export function applyLoss(draft, input) {
  const current = findInventory(draft, input?.inventoryId);
  if (!current) return fail('inventory_missing', { inventoryId: input?.inventoryId });
  const bulkLosses = input.bulkLosses ?? {};
  const cargoLosses = input.cargoLosses ?? {};
  if (!isLossMap(bulkLosses) || !isLossMap(cargoLosses)) return fail('inventory_invalid_quantity', { field: 'bulkLosses/cargoLosses' });
  if (Object.keys(bulkLosses).length + Object.keys(cargoLosses).length === 0) return fail('inventory_no_change');
  const next = clone(current);
  for (const [id, loss] of Object.entries(bulkLosses)) {
    const held = heldOf(next.bulkItems, id);
    if (held < loss) return fail('inventory_loss_exceeds_quantity', { itemDefinitionId: id, held, loss });
    if (held === loss) delete next.bulkItems[id];
    else next.bulkItems[id] = held - loss;
  }
  for (const [cargoId, loss] of Object.entries(cargoLosses)) {
    const cargo = next.assignedCargo.find((lot) => lot.cargoId === cargoId);
    if (!cargo) return fail('inventory_missing_cargo', { cargoId });
    if (cargo.quantity < loss) return fail('inventory_loss_exceeds_quantity', { cargoId, held: cargo.quantity, loss });
    reduceCargo(cargo, loss);
  }
  next.assignedCargo = next.assignedCargo.filter((cargo) => cargo.quantity > 0);
  const committed = commit(draft, current, next);
  return committed.ok ? ok({ inventoryId: current.id }) : committed;
}

// ---------------------------------------------------------------- moving between inventories

const isIdList = (value) => Array.isArray(value) && value.every((id) => typeof id === 'string') && new Set(value).size === value.length;

// Moves goods, equipment and cargo lots from one inventory to another, all or nothing. Equipment and
// cargo move whole, keeping their owner and assignment. The receiving inventory must stay within its
// limits unless `allowOverload` is set.
// input: { fromInventoryId, toInventoryId, bulkItems?: { resourceId: quantity }, equipmentItemIds?: [], cargoIds?: [], allowOverload? }
export function transferItems(draft, input) {
  if (!isRecord(input)) return fail('inventory_invalid_input');
  const from = findInventory(draft, input.fromInventoryId);
  const to = findInventory(draft, input.toInventoryId);
  if (!from) return fail('inventory_missing', { inventoryId: input.fromInventoryId });
  if (!to) return fail('inventory_missing', { inventoryId: input.toInventoryId });
  if (from.id === to.id) return fail('inventory_same_inventory');
  const overload = optionalFlag(input, 'allowOverload');
  if (!overload.ok) return overload;
  const bulkItems = input.bulkItems ?? {};
  const equipmentItemIds = input.equipmentItemIds ?? [];
  const cargoIds = input.cargoIds ?? [];
  if (!isLossMap(bulkItems)) return fail('inventory_invalid_quantity', { field: 'bulkItems' });
  if (!isIdList(equipmentItemIds) || !isIdList(cargoIds)) return fail('inventory_invalid_input', { field: 'equipmentItemIds/cargoIds' });
  if (Object.keys(bulkItems).length + equipmentItemIds.length + cargoIds.length === 0) return fail('inventory_no_change');

  const nextFrom = clone(from);
  const nextTo = clone(to);
  for (const [id, quantity] of Object.entries(bulkItems)) {
    if (getResource(draft, id) === null) return fail('inventory_unregistered_resource', { itemDefinitionId: id });
    const held = heldOf(nextFrom.bulkItems, id);
    if (held < quantity) return fail('inventory_insufficient_quantity', { itemDefinitionId: id, held, quantity });
    if (held === quantity) delete nextFrom.bulkItems[id];
    else nextFrom.bulkItems[id] = held - quantity;
    const total = heldOf(nextTo.bulkItems, id) + quantity;
    if (!Number.isSafeInteger(total)) return fail('inventory_invalid_quantity', { itemDefinitionId: id });
    nextTo.bulkItems[id] = total;
  }
  for (const instanceId of equipmentItemIds) {
    const index = equipmentIndex(nextFrom, instanceId);
    if (index < 0) return fail('inventory_missing_equipment', { instanceId });
    nextTo.equipmentItems.push(...nextFrom.equipmentItems.splice(index, 1));
  }
  for (const cargoId of cargoIds) {
    const index = nextFrom.assignedCargo.findIndex((cargo) => cargo.cargoId === cargoId);
    if (index < 0) return fail('inventory_missing_cargo', { cargoId });
    nextTo.assignedCargo.push(...nextFrom.assignedCargo.splice(index, 1));
  }
  const fits = capacityVerdict(draft, nextTo, overload.value);
  if (!fits.ok) return fits;
  nextFrom.revision = from.revision + 1;
  nextTo.revision = to.revision + 1;
  const problems = [...inventoryProblems(draft, nextFrom), ...inventoryProblems(draft, nextTo)];
  if (problems.length) return fail('inventory_invalid', { problems });
  inventoriesOf(draft)[from.id] = nextFrom;
  inventoriesOf(draft)[to.id] = nextTo;
  return ok({ fromInventoryId: from.id, toInventoryId: to.id });
}
