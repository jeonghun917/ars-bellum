import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clone } from '../../src/core/data.js';
import { createStore } from '../../src/core/store.js';
import { newCharacter, newGameState, PLAYER_CHARACTER_ID, PLAYER_GROUP_ID, PLAYER_INVENTORY_ID } from '../../src/game/new-game.js';
import { validateState } from '../../src/persist/schema.js';
import { migrateV1Envelope } from '../../src/persist/migrate-v1.js';
import {
  addBulk, addCargo, addEquipment, applyLoss, calculateLoad, changeInventoryOwner, checkInventory, createInventory,
  getFoodSummary, removeBulk, removeCargo, removeEquipment, setCapacity, setEquipmentSlot, transferItems,
} from '../../src/domains/inventory/index.js';

const v1NewGame = JSON.parse(fs.readFileSync(new URL('../fixtures/v1-new-game-save.json', import.meta.url), 'utf8'));

const PLAYER = PLAYER_INVENTORY_ID;
const CART = 'bob_cart';
const STORE = 'town_store';
const BOB_ID = 'npc_bob';
const TOWN_ID = 'town_a';

const sword = (extra = {}) => ({ instanceId: 'sword_1', itemDefinitionId: 'long_sword', slotDefinitionId: 'main_hand', weightKg: 1.5, volumeL: 2, tags: ['weapon'], ...extra });
const cargoLot = (extra = {}) => ({ cargoId: 'lot_1', itemDefinitionId: 'grain', cargoPurposeId: 'contract', quantity: 4, ...extra });

// The new-game inventory (10 travel rations) plus an empty cart owned by Bob and a store owned by a town.
function setup() {
  const state = newGameState();
  state.world.characters[BOB_ID] = newCharacter({ id: BOB_ID, name: 'Bob' });
  state.world.settlements[TOWN_ID] = { id: TOWN_ID };
  const store = createStore(state, { validate: () => ({ ok: true }) });
  const opened = store.transact('open inventories', (draft) => {
    const first = createInventory(draft, { id: CART, ownerRef: { type: 'character', id: BOB_ID } });
    if (!first.ok) return first;
    return createInventory(draft, { id: STORE, ownerRef: { type: 'settlement', id: TOWN_ID } });
  });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  return createStore(clone(store.getState()), { validate: validateState });
}

const inventory = (store, id = PLAYER) => store.getState().world.inventories[id];

// A rule that fails must leave the draft it was given exactly as it was, and the store unchanged.
function refuses(store, rule, code) {
  const before = clone(store.getState());
  let draftChanged = false;
  const result = store.transact('refused', (draft) => {
    const snapshot = clone(draft);
    const outcome = rule(draft);
    draftChanged = JSON.stringify(draft) !== JSON.stringify(snapshot);
    return outcome;
  });
  assert.equal(result.ok, false, `expected a failure, got ${JSON.stringify(result)}`);
  if (code) assert.equal(result.error, code, JSON.stringify(result));
  assert.equal(draftChanged, false, 'the failed rule changed its draft');
  assert.deepEqual(store.getState(), before);
  return result;
}

function succeeds(store, rule) {
  const result = store.transact('rule', rule);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

// ------------------------------------------------------------------ stored records

test('[inventory.records.new-game-valid] the new-game inventory passes the inventory check', () => {
  const state = newGameState();
  assert.deepEqual(checkInventory(state), { ok: true });
  assert.deepEqual(validateState(state), { ok: true });
  assert.deepEqual(state.world.inventories[PLAYER].bulkItems, { travel_rations: 10 });
});

test('[inventory.records.v1-save-valid] the inventory records of an earlier-version save pass the inventory check unchanged', () => {
  const stored = v1NewGame.gameState.world.inventories;
  assert.deepEqual(stored[PLAYER].bulkItems, { travel_rations: 10 });
  const migrated = migrateV1Envelope(clone(v1NewGame));
  assert.equal(migrated.ok, true);
  assert.deepEqual(migrated.state.world.inventories, stored);
  assert.deepEqual(checkInventory(migrated.state), { ok: true });
  assert.deepEqual(validateState(migrated.state), { ok: true });
});

test('[inventory.records.bad-records-refused] records the earlier version would not save are refused', () => {
  const state = setup().getState();
  const full = clone(state);
  full.world.inventories[CART].equipmentItems.push({
    instanceId: 'sword_1', itemDefinitionId: 'long_sword', slotDefinitionId: 'main_hand', ownershipRef: null, assignmentRef: null,
    weightKg: 1, volumeL: 1, tags: ['weapon'], customData: {},
  });
  full.world.inventories[CART].assignedCargo.push({
    cargoId: 'lot_1', itemDefinitionId: 'grain', cargoPurposeId: 'supply', quantity: 2, ownershipRef: null, assignmentRef: null,
    weightKg: 0, volumeL: 0, customData: {},
  });
  assert.deepEqual(checkInventory(full), { ok: true });
  const broken = (change) => {
    const copy = clone(full);
    change(copy.world.inventories, copy);
    return checkInventory(copy);
  };
  const cases = {
    'unregistered resource': (i) => { i[CART].bulkItems.moon_dust = 1; },
    'negative quantity': (i) => { i[CART].bulkItems.grain = -1; },
    'fractional quantity': (i) => { i[CART].bulkItems.grain = 1.5; },
    'owner record missing': (i) => { i[CART].ownerRef = { type: 'character', id: 'nobody' }; },
    'owner type unknown': (i) => { i[CART].ownerRef = { type: 'ghost', id: 'x' }; },
    'record id differs from its key': (i) => { i[CART].id = 'other'; },
    'unsupported version': (i) => { i[CART].version = 2; },
    'negative capacity': (i) => { i[CART].capacity.weightKg = -1; },
    'bulk items not a record': (i) => { i[CART].bulkItems = []; },
    'unregistered equipment slot': (i) => { i[CART].equipmentItems[0].slotDefinitionId = 'tail'; },
    'negative equipment weight': (i) => { i[CART].equipmentItems[0].weightKg = -1; },
    'equipment without an id': (i) => { i[CART].equipmentItems[0].instanceId = ''; },
    'duplicate equipment in one inventory': (i) => { i[CART].equipmentItems.push(clone(i[CART].equipmentItems[0])); },
    'the same equipment in two inventories': (i) => { i[STORE].equipmentItems.push(clone(i[CART].equipmentItems[0])); },
    'the same cargo in two inventories': (i) => { i[STORE].assignedCargo.push(clone(i[CART].assignedCargo[0])); },
    'unregistered cargo purpose': (i) => { i[CART].assignedCargo[0].cargoPurposeId = 'smuggling'; },
    'fractional cargo quantity': (i) => { i[CART].assignedCargo[0].quantity = 0.5; },
    'bad equipment reference': (i) => { i[CART].equipmentItems[0].ownershipRef = 'bob'; },
  };
  for (const [name, change] of Object.entries(cases)) {
    assert.equal(broken(change).ok, false, `${name} should be refused`);
  }
  // Zero quantities were stored by the earlier version (a split leaves them behind) and still load.
  assert.deepEqual(broken((i) => { i[CART].bulkItems.grain = 0; i[CART].assignedCargo[0].quantity = 0; }), { ok: true });
});

// ------------------------------------------------------------------ inventories

test('[inventory.create] an inventory opens empty for an owner that exists', () => {
  const store = setup();
  succeeds(store, (d) => createInventory(d, { id: 'wagon_one', ownerRef: { type: 'mobile_group', id: PLAYER_GROUP_ID }, capacity: { weightKg: 300, volumeL: 400 } }));
  assert.deepEqual(inventory(store, 'wagon_one'), {
    id: 'wagon_one', version: 1, revision: 0, ownerRef: { id: PLAYER_GROUP_ID, type: 'mobile_group' }, bulkItems: {}, equipmentItems: [],
    assignedCargo: [], capacity: { volumeL: 400, weightKg: 300 }, customData: {},
  });
});

test('[inventory.create-refused] a bad inventory is refused and nothing changes', () => {
  const store = setup();
  const good = { id: 'wagon_one', ownerRef: { type: 'mobile_group', id: PLAYER_GROUP_ID } };
  refuses(store, (d) => createInventory(d, null), 'inventory_invalid_input');
  refuses(store, (d) => createInventory(d, { ...good, id: 'Bad Id' }), 'inventory_invalid_id');
  refuses(store, (d) => createInventory(d, { ...good, id: CART }), 'inventory_duplicate_id');
  refuses(store, (d) => createInventory(d, { ...good, ownerRef: { type: 'mobile_group', id: 'nobody' } }), 'inventory_owner_missing');
  refuses(store, (d) => createInventory(d, { ...good, ownerRef: { type: 'ghost', id: 'x' } }), 'inventory_invalid_owner');
  refuses(store, (d) => createInventory(d, { ...good, ownerRef: 'group' }), 'inventory_invalid_owner');
  refuses(store, (d) => createInventory(d, { ...good, capacity: { weightKg: -1, volumeL: 0 } }), 'inventory_invalid_capacity');
  refuses(store, (d) => createInventory(d, { ...good, capacity: { weightKg: Number.NaN, volumeL: 0 } }), 'inventory_invalid_capacity');
  refuses(store, (d) => createInventory(d, { ...good, capacity: { weightKg: 5 } }), 'inventory_invalid_capacity');
});

test('[inventory.owner-change] an inventory changes hands only to an existing owner', () => {
  const store = setup();
  succeeds(store, (d) => changeInventoryOwner(d, { inventoryId: CART, ownerRef: { type: 'mobile_group', id: PLAYER_GROUP_ID } }));
  assert.deepEqual(inventory(store, CART).ownerRef, { id: PLAYER_GROUP_ID, type: 'mobile_group' });
  assert.equal(inventory(store, CART).revision, 1);
  refuses(store, (d) => changeInventoryOwner(d, { inventoryId: CART, ownerRef: { type: 'mobile_group', id: PLAYER_GROUP_ID } }), 'inventory_no_change');
  refuses(store, (d) => changeInventoryOwner(d, { inventoryId: CART, ownerRef: { type: 'character', id: 'nobody' } }), 'inventory_owner_missing');
  refuses(store, (d) => changeInventoryOwner(d, { inventoryId: CART, ownerRef: { type: 'ghost', id: 'x' } }), 'inventory_invalid_owner');
  refuses(store, (d) => changeInventoryOwner(d, { inventoryId: 'nope', ownerRef: { type: 'character', id: BOB_ID } }), 'inventory_missing');
});

// ------------------------------------------------------------------ bulk goods

test('[inventory.bulk.add-remove] bulk goods are added and removed by whole units, and an empty entry disappears', () => {
  const store = setup();
  const added = succeeds(store, (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'grain', quantity: 5 }));
  assert.equal(added.quantity, 5);
  succeeds(store, (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'travel_rations', quantity: 3 }));
  assert.deepEqual(inventory(store).bulkItems, { grain: 5, travel_rations: 13 });
  assert.equal(inventory(store).revision, 2);
  succeeds(store, (d) => removeBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'travel_rations', quantity: 4 }));
  succeeds(store, (d) => removeBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'grain', quantity: 5 }));
  assert.deepEqual(inventory(store).bulkItems, { travel_rations: 9 });
});

test('[inventory.bulk.invalid-refused] bad quantities, unknown goods and missing inventories change nothing', () => {
  const store = setup();
  const add = (extra) => (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'grain', quantity: 2, ...extra });
  const remove = (extra) => (d) => removeBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'travel_rations', quantity: 2, ...extra });
  for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '2', undefined, null, Number.MAX_SAFE_INTEGER + 2]) {
    refuses(store, add({ quantity }), 'inventory_invalid_quantity');
    refuses(store, remove({ quantity }), 'inventory_invalid_quantity');
  }
  refuses(store, add({ itemDefinitionId: 'moon_dust' }), 'inventory_unregistered_resource');
  refuses(store, add({ itemDefinitionId: '__proto__' }), 'inventory_unregistered_resource');
  refuses(store, add({ itemDefinitionId: undefined }), 'inventory_unregistered_resource');
  refuses(store, add({ inventoryId: 'nope' }), 'inventory_missing');
  refuses(store, remove({ inventoryId: 'nope' }), 'inventory_missing');
  refuses(store, remove({ quantity: 11 }), 'inventory_insufficient_quantity');
  refuses(store, remove({ itemDefinitionId: 'grain' }), 'inventory_insufficient_quantity');
  refuses(store, add({ allowOverload: 'yes' }), 'inventory_invalid_input');
  refuses(store, (d) => addBulk(d, null), 'inventory_missing');
  succeeds(store, (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'grain', quantity: Number.MAX_SAFE_INTEGER - 1 }));
  refuses(store, add({ quantity: 5 }), 'inventory_invalid_quantity');
});

// ------------------------------------------------------------------ equipment

test('[inventory.equipment.add-remove-slot] equipment is added with its own weight, equipped in a slot and removed whole', () => {
  const store = setup();
  succeeds(store, (d) => addEquipment(d, { inventoryId: PLAYER, item: sword({ slotDefinitionId: undefined, tags: ['weapon', 'weapon'] }) }));
  assert.deepEqual(inventory(store).equipmentItems, [{
    instanceId: 'sword_1', itemDefinitionId: 'long_sword', slotDefinitionId: null, ownershipRef: null, assignmentRef: null,
    weightKg: 1.5, volumeL: 2, tags: ['weapon'], customData: {},
  }]);
  succeeds(store, (d) => setEquipmentSlot(d, { inventoryId: PLAYER, instanceId: 'sword_1', slotDefinitionId: 'off_hand' }));
  assert.equal(inventory(store).equipmentItems[0].slotDefinitionId, 'off_hand');
  succeeds(store, (d) => setEquipmentSlot(d, { inventoryId: PLAYER, instanceId: 'sword_1', slotDefinitionId: null }));
  assert.equal(inventory(store).equipmentItems[0].slotDefinitionId, null);
  const removed = succeeds(store, (d) => removeEquipment(d, { inventoryId: PLAYER, instanceId: 'sword_1' }));
  assert.equal(removed.item.instanceId, 'sword_1');
  assert.deepEqual(inventory(store).equipmentItems, []);
});

test('[inventory.equipment.invalid-refused] bad equipment, duplicates and unknown slots change nothing', () => {
  const store = setup();
  const add = (item, inventoryId = PLAYER) => (d) => addEquipment(d, { inventoryId, item });
  refuses(store, add(null), 'inventory_invalid_item');
  refuses(store, add(sword({ instanceId: 'Bad Id' })), 'inventory_invalid_item');
  refuses(store, add(sword({ itemDefinitionId: '' })), 'inventory_invalid_item');
  refuses(store, add(sword({ weightKg: -1 })), 'inventory_invalid_item');
  refuses(store, add(sword({ volumeL: Number.NaN })), 'inventory_invalid_item');
  refuses(store, add(sword({ tags: 'weapon' })), 'inventory_invalid_item');
  refuses(store, add(sword({ tags: [''] })), 'inventory_invalid_item');
  refuses(store, add(sword({ customData: [] })), 'inventory_invalid_item');
  refuses(store, add(sword({ ownershipRef: 'bob' })), 'inventory_invalid_item');
  refuses(store, add(sword({ surprise: true })), 'inventory_invalid_item');
  refuses(store, add(sword({ slotDefinitionId: 'tail' })), 'inventory_unregistered_equipment_slot');
  refuses(store, add(sword(), 'nope'), 'inventory_missing');
  succeeds(store, add(sword()));
  refuses(store, add(sword()), 'inventory_duplicate_equipment');
  // An item exists in one inventory only.
  refuses(store, add(sword(), CART), 'inventory_duplicate_equipment');
  refuses(store, (d) => removeEquipment(d, { inventoryId: PLAYER, instanceId: 'ghost' }), 'inventory_missing_equipment');
  refuses(store, (d) => removeEquipment(d, { inventoryId: CART, instanceId: 'sword_1' }), 'inventory_missing_equipment');
  refuses(store, (d) => setEquipmentSlot(d, { inventoryId: PLAYER, instanceId: 'sword_1', slotDefinitionId: 'tail' }), 'inventory_unregistered_equipment_slot');
  refuses(store, (d) => setEquipmentSlot(d, { inventoryId: PLAYER, instanceId: 'sword_1', slotDefinitionId: 'main_hand' }), 'inventory_no_change');
  refuses(store, (d) => setEquipmentSlot(d, { inventoryId: PLAYER, instanceId: 'ghost', slotDefinitionId: 'body' }), 'inventory_missing_equipment');
});

// ------------------------------------------------------------------ cargo

test('[inventory.cargo.add-remove] cargo is carried for a purpose and handed over as a whole lot', () => {
  const store = setup();
  succeeds(store, (d) => addCargo(d, { inventoryId: PLAYER, cargo: cargoLot({ assignmentRef: { type: 'character', id: BOB_ID } }) }));
  succeeds(store, (d) => addCargo(d, { inventoryId: PLAYER, cargo: cargoLot({ cargoId: 'lot_2', cargoPurposeId: undefined, itemDefinitionId: 'iron_ingot', quantity: 1 }) }));
  assert.deepEqual(inventory(store).assignedCargo.map((lot) => [lot.cargoId, lot.cargoPurposeId, lot.quantity]), [['lot_1', 'contract', 4], ['lot_2', 'supply', 1]]);
  assert.deepEqual(inventory(store).assignedCargo[0].assignmentRef, { id: BOB_ID, type: 'character' });
  const removed = succeeds(store, (d) => removeCargo(d, { inventoryId: PLAYER, cargoId: 'lot_1' }));
  assert.equal(removed.cargo.quantity, 4);
  assert.deepEqual(inventory(store).assignedCargo.map((lot) => lot.cargoId), ['lot_2']);
});

test('[inventory.cargo.invalid-refused] bad cargo, duplicates and unknown purposes change nothing', () => {
  const store = setup();
  const add = (cargo, inventoryId = PLAYER) => (d) => addCargo(d, { inventoryId, cargo });
  refuses(store, add(null), 'inventory_invalid_cargo');
  refuses(store, add(cargoLot({ cargoId: 'Bad Id' })), 'inventory_invalid_cargo');
  refuses(store, add(cargoLot({ itemDefinitionId: '' })), 'inventory_invalid_cargo');
  refuses(store, add(cargoLot({ weightKg: -2 })), 'inventory_invalid_cargo');
  refuses(store, add(cargoLot({ assignmentRef: 'bob' })), 'inventory_invalid_cargo');
  refuses(store, add(cargoLot({ surprise: 1 })), 'inventory_invalid_cargo');
  refuses(store, add(cargoLot({ cargoPurposeId: 'smuggling' })), 'inventory_unregistered_cargo_purpose');
  for (const quantity of [0, -1, 1.5, Number.NaN, '3', undefined]) {
    refuses(store, add(cargoLot({ quantity })), 'inventory_invalid_quantity');
  }
  refuses(store, add(cargoLot(), 'nope'), 'inventory_missing');
  succeeds(store, add(cargoLot()));
  refuses(store, add(cargoLot()), 'inventory_duplicate_cargo');
  refuses(store, add(cargoLot(), CART), 'inventory_duplicate_cargo');
  refuses(store, (d) => removeCargo(d, { inventoryId: PLAYER, cargoId: 'ghost' }), 'inventory_missing_cargo');
  refuses(store, (d) => removeCargo(d, { inventoryId: CART, cargoId: 'lot_1' }), 'inventory_missing_cargo');
});

test('[inventory.loss.all-or-nothing] losses are applied together, a lot that is used up is removed, and an unaffordable loss changes nothing', () => {
  const store = setup();
  succeeds(store, (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'grain', quantity: 6 }));
  succeeds(store, (d) => addCargo(d, { inventoryId: PLAYER, cargo: cargoLot({ weightKg: 8, volumeL: 10 }) }));
  succeeds(store, (d) => addCargo(d, { inventoryId: PLAYER, cargo: cargoLot({ cargoId: 'lot_2', quantity: 2 }) }));
  succeeds(store, (d) => applyLoss(d, { inventoryId: PLAYER, bulkLosses: { grain: 6, travel_rations: 1 }, cargoLosses: { lot_1: 1, lot_2: 2 } }));
  assert.deepEqual(inventory(store).bulkItems, { travel_rations: 9 });
  assert.deepEqual(inventory(store).assignedCargo.map((lot) => [lot.cargoId, lot.quantity, lot.weightKg, lot.volumeL]), [['lot_1', 3, 6, 7.5]]);
  const loss = (extra) => (d) => applyLoss(d, { inventoryId: PLAYER, ...extra });
  refuses(store, loss({}), 'inventory_no_change');
  refuses(store, loss({ bulkLosses: { travel_rations: 10 } }), 'inventory_loss_exceeds_quantity');
  refuses(store, loss({ bulkLosses: { grain: 1 } }), 'inventory_loss_exceeds_quantity');
  refuses(store, loss({ cargoLosses: { lot_1: 4 } }), 'inventory_loss_exceeds_quantity');
  refuses(store, loss({ cargoLosses: { ghost: 1 } }), 'inventory_missing_cargo');
  // The first loss is fine but the second is not: neither is applied.
  refuses(store, loss({ bulkLosses: { travel_rations: 1 }, cargoLosses: { lot_1: 99 } }), 'inventory_loss_exceeds_quantity');
  refuses(store, loss({ bulkLosses: { travel_rations: 0 } }), 'inventory_invalid_quantity');
  refuses(store, loss({ bulkLosses: { travel_rations: 1.5 } }), 'inventory_invalid_quantity');
  refuses(store, loss({ cargoLosses: { lot_1: -1 } }), 'inventory_invalid_quantity');
  refuses(store, loss({ bulkLosses: [] }), 'inventory_invalid_quantity');
  refuses(store, (d) => applyLoss(d, { inventoryId: 'nope', bulkLosses: { travel_rations: 1 } }), 'inventory_missing');
});

// ------------------------------------------------------------------ capacity and load

test('[inventory.load.calculation] load adds bulk goods, equipment and cargo, taking cargo weight from the lot or else the resource', () => {
  const store = setup();
  succeeds(store, (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'grain', quantity: 4 }));
  succeeds(store, (d) => addEquipment(d, { inventoryId: PLAYER, item: sword() }));
  succeeds(store, (d) => addCargo(d, { inventoryId: PLAYER, cargo: cargoLot({ quantity: 2 }) }));
  succeeds(store, (d) => addCargo(d, { inventoryId: PLAYER, cargo: cargoLot({ cargoId: 'lot_2', quantity: 1, weightKg: 9, volumeL: 3 }) }));
  // 10 rations (0.75 kg / 0.8 l each) + 4 grain (1 / 1) + sword (1.5 / 2) + 2 grain from the catalogue + a lot of 9 kg / 3 l.
  assert.deepEqual(calculateLoad(store.getState(), PLAYER), {
    weightKg: 7.5 + 4 + 1.5 + 2 + 9, volumeL: 8 + 4 + 2 + 2 + 3, weightLimitKg: 0, volumeLimitL: 0, overweight: false, overvolume: false,
  });
  assert.deepEqual(calculateLoad(store.getState(), inventory(store, CART)).weightKg, 0);
  assert.equal(calculateLoad(store.getState(), 'nope'), null);
});

test('[inventory.capacity.limits] an inventory takes nothing past its weight limit, and a limit of 0 is no limit', () => {
  const store = setup();
  // 10 rations weigh 7.5 kg.
  succeeds(store, (d) => setCapacity(d, { inventoryId: PLAYER, weightKg: 10, volumeL: 0 }));
  refuses(store, (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'grain', quantity: 3 }), 'inventory_over_capacity');
  succeeds(store, (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'grain', quantity: 2 }));
  assert.equal(calculateLoad(store.getState(), PLAYER).weightKg, 9.5);
  refuses(store, (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'salt', quantity: 1 }), 'inventory_over_capacity');
  // Exactly at the limit is allowed (cloth weighs 0.5 kg), the next cloth is not.
  succeeds(store, (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'cloth', quantity: 1 }));
  assert.equal(calculateLoad(store.getState(), PLAYER).weightKg, 10);
  refuses(store, (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'cloth', quantity: 1 }), 'inventory_over_capacity');
  refuses(store, (d) => addEquipment(d, { inventoryId: PLAYER, item: sword({ weightKg: 0.1, volumeL: 0 }) }), 'inventory_over_capacity');
  // The volume limit is 0, so volume is not limited.
  succeeds(store, (d) => addEquipment(d, { inventoryId: PLAYER, item: sword({ weightKg: 0, volumeL: 5000 }) }));
  // An inventory with no limits takes anything.
  succeeds(store, (d) => addBulk(d, { inventoryId: CART, itemDefinitionId: 'horses', quantity: 1000 }));
});

test('[inventory.capacity.decimal-sums] decimal weights that add up to the limit exactly are not refused for rounding', () => {
  const store = setup();
  succeeds(store, (d) => setCapacity(d, { inventoryId: STORE, weightKg: 0.3, volumeL: 0 }));
  succeeds(store, (d) => addEquipment(d, { inventoryId: STORE, item: sword({ instanceId: 'dagger_1', weightKg: 0.1, volumeL: 0 }) }));
  // 0.1 + 0.2 is 0.30000000000000004 in floating point.
  succeeds(store, (d) => addEquipment(d, { inventoryId: STORE, item: sword({ instanceId: 'dagger_2', weightKg: 0.2, volumeL: 0 }) }));
  assert.equal(calculateLoad(store.getState(), STORE).weightKg, 0.3);
  assert.equal(calculateLoad(store.getState(), STORE).overweight, false);
});

test('[inventory.records.rules-keep-records-valid] a rule never writes an inventory that would not pass the record checks', () => {
  // A store that does not check state, holding an inventory whose owner has vanished.
  const state = setup().getState();
  const lenient = createStore(clone(state), { validate: () => ({ ok: true }) });
  succeeds(lenient, (d) => { delete d.world.characters[BOB_ID]; });
  refuses(lenient, (d) => addBulk(d, { inventoryId: CART, itemDefinitionId: 'grain', quantity: 1 }), 'inventory_invalid');
  refuses(lenient, (d) => setCapacity(d, { inventoryId: CART, weightKg: 5, volumeL: 5 }), 'inventory_invalid');
  refuses(lenient, (d) => transferItems(d, { fromInventoryId: PLAYER, toInventoryId: CART, bulkItems: { travel_rations: 1 } }), 'inventory_invalid');
});

test('[inventory.capacity.volume-limit] the volume limit is held for bulk goods, equipment and cargo alike', () => {
  const store = setup();
  succeeds(store, (d) => setCapacity(d, { inventoryId: PLAYER, weightKg: 0, volumeL: 10 }));
  succeeds(store, (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'grain', quantity: 2 }));
  assert.equal(calculateLoad(store.getState(), PLAYER).volumeL, 10);
  refuses(store, (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'cloth', quantity: 1 }), 'inventory_over_capacity');
  refuses(store, (d) => addEquipment(d, { inventoryId: PLAYER, item: sword({ weightKg: 0, volumeL: 0.5 }) }), 'inventory_over_capacity');
  refuses(store, (d) => addCargo(d, { inventoryId: PLAYER, cargo: cargoLot({ volumeL: 0.5 }) }), 'inventory_over_capacity');
  succeeds(store, (d) => addEquipment(d, { inventoryId: PLAYER, item: sword({ weightKg: 99, volumeL: 0 }) }));
  // Weight has no limit here (0), volume is full: a lot with no stated volume takes it from the resource.
  refuses(store, (d) => addCargo(d, { inventoryId: PLAYER, cargo: cargoLot({ quantity: 1 }) }), 'inventory_over_capacity');
});

test('[inventory.capacity.overload-and-relief] an overloaded inventory can be unloaded, and a caller may knowingly overload it', () => {
  const store = setup();
  succeeds(store, (d) => setCapacity(d, { inventoryId: PLAYER, weightKg: 5, volumeL: 0 }));
  // Lowering a limit below the load is allowed: the inventory is then overloaded.
  assert.equal(calculateLoad(store.getState(), PLAYER).overweight, true);
  refuses(store, (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'arrows', quantity: 1 }), 'inventory_over_capacity');
  succeeds(store, (d) => removeBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'travel_rations', quantity: 1 }));
  succeeds(store, (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'arrows', quantity: 1, allowOverload: true }));
  assert.equal(calculateLoad(store.getState(), PLAYER).overweight, true);
  refuses(store, (d) => setCapacity(d, { inventoryId: PLAYER, weightKg: -1, volumeL: 0 }), 'inventory_invalid_capacity');
  refuses(store, (d) => setCapacity(d, { inventoryId: PLAYER, weightKg: 5, volumeL: Number.NaN }), 'inventory_invalid_capacity');
  refuses(store, (d) => setCapacity(d, { inventoryId: PLAYER, weightKg: 5, volumeL: 0 }), 'inventory_no_change');
  refuses(store, (d) => setCapacity(d, { inventoryId: 'nope', weightKg: 5, volumeL: 0 }), 'inventory_missing');
});

test('[inventory.food.summary] food is counted by nutrition and turned into days of supply', () => {
  const store = setup();
  succeeds(store, (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'iron_ore', quantity: 50 }));
  assert.deepEqual(getFoodSummary(store.getState(), PLAYER, 4), { nutrition: 10, dailyNeed: 4, supplyDays: 2.5 });
  assert.deepEqual(getFoodSummary(store.getState(), PLAYER), { nutrition: 10, dailyNeed: 0, supplyDays: null });
  assert.equal(getFoodSummary(store.getState(), 'nope', 4), null);
});

// ------------------------------------------------------------------ moving between inventories

function loaded() {
  const store = setup();
  succeeds(store, (d) => {
    for (const rule of [
      addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'grain', quantity: 5 }),
      addEquipment(d, { inventoryId: PLAYER, item: sword() }),
      addCargo(d, { inventoryId: PLAYER, cargo: cargoLot({ weightKg: 5, volumeL: 6 }) }),
    ]) {
      if (!rule.ok) return rule;
    }
  });
  return store;
}

test('[inventory.transfer.moves-all] goods, equipment and cargo move together and keep their owner and assignment', () => {
  const store = loaded();
  succeeds(store, (d) => { d.world.inventories[PLAYER].equipmentItems[0].ownershipRef = { type: 'character', id: BOB_ID }; });
  const before = calculateLoad(store.getState(), PLAYER);
  succeeds(store, (d) => transferItems(d, {
    fromInventoryId: PLAYER, toInventoryId: CART, bulkItems: { grain: 5, travel_rations: 4 }, equipmentItemIds: ['sword_1'], cargoIds: ['lot_1'],
  }));
  const state = store.getState();
  assert.deepEqual(inventory(store).bulkItems, { travel_rations: 6 });
  assert.deepEqual(inventory(store, CART).bulkItems, { grain: 5, travel_rations: 4 });
  assert.deepEqual(inventory(store).equipmentItems, []);
  assert.deepEqual(inventory(store, CART).equipmentItems.map((item) => [item.instanceId, item.ownershipRef]), [['sword_1', { id: BOB_ID, type: 'character' }]]);
  assert.deepEqual(inventory(store).assignedCargo, []);
  assert.deepEqual(inventory(store, CART).assignedCargo.map((lot) => [lot.cargoId, lot.weightKg]), [['lot_1', 5]]);
  assert.equal(inventory(store).revision, 4);
  assert.equal(inventory(store, CART).revision, 1);
  const after = [calculateLoad(state, PLAYER), calculateLoad(state, CART)];
  assert.equal(round(after[0].weightKg + after[1].weightKg), round(before.weightKg));
});

const round = (value) => Math.round(value * 1e6) / 1e6;

test('[inventory.transfer.all-or-nothing] a move that cannot complete leaves both inventories as they were', () => {
  const store = loaded();
  const move = (extra) => (d) => transferItems(d, { fromInventoryId: PLAYER, toInventoryId: CART, bulkItems: { grain: 1 }, ...extra });
  refuses(store, move({ bulkItems: { grain: 6 } }), 'inventory_insufficient_quantity');
  // The first item is fine, a later one is not: nothing moves.
  refuses(store, move({ equipmentItemIds: ['sword_1', 'ghost'] }), 'inventory_missing_equipment');
  refuses(store, move({ cargoIds: ['lot_1', 'ghost'] }), 'inventory_missing_cargo');
  refuses(store, move({ bulkItems: { grain: 1, moon_dust: 1 } }), 'inventory_unregistered_resource');
  refuses(store, move({ bulkItems: { grain: 1, travel_rations: 11 } }), 'inventory_insufficient_quantity');
  refuses(store, move({ bulkItems: { grain: 0 } }), 'inventory_invalid_quantity');
  refuses(store, move({ bulkItems: { grain: 1.5 } }), 'inventory_invalid_quantity');
  refuses(store, move({ bulkItems: { grain: -1 } }), 'inventory_invalid_quantity');
  refuses(store, move({ equipmentItemIds: ['sword_1', 'sword_1'] }), 'inventory_invalid_input');
  refuses(store, move({ cargoIds: 'lot_1' }), 'inventory_invalid_input');
  refuses(store, move({ bulkItems: {} }), 'inventory_no_change');
  refuses(store, move({ toInventoryId: PLAYER }), 'inventory_same_inventory');
  refuses(store, move({ toInventoryId: 'nope' }), 'inventory_missing');
  refuses(store, move({ fromInventoryId: 'nope' }), 'inventory_missing');
  refuses(store, move({ allowOverload: 1 }), 'inventory_invalid_input');
  refuses(store, (d) => transferItems(d, null), 'inventory_invalid_input');
});

test('[inventory.transfer.destination-capacity] a move that would overload the receiving inventory is refused whole', () => {
  const store = loaded();
  succeeds(store, (d) => setCapacity(d, { inventoryId: CART, weightKg: 8, volumeL: 0 }));
  // 5 grain = 5 kg fits; 5 grain + the 1.5 kg sword + the 5 kg lot does not.
  const everything = { fromInventoryId: PLAYER, toInventoryId: CART, bulkItems: { grain: 5 }, equipmentItemIds: ['sword_1'], cargoIds: ['lot_1'] };
  refuses(store, (d) => transferItems(d, everything), 'inventory_over_capacity');
  succeeds(store, (d) => transferItems(d, { ...everything, equipmentItemIds: [], cargoIds: [] }));
  assert.equal(calculateLoad(store.getState(), CART).weightKg, 5);
  // The giving inventory is never held to a limit while it unloads.
  succeeds(store, (d) => setCapacity(d, { inventoryId: PLAYER, weightKg: 1, volumeL: 0 }));
  succeeds(store, (d) => transferItems(d, { fromInventoryId: PLAYER, toInventoryId: STORE, equipmentItemIds: ['sword_1'] }));
  refuses(store, (d) => transferItems(d, { ...everything, bulkItems: {}, equipmentItemIds: [], cargoIds: ['lot_1'], allowOverload: false }), 'inventory_over_capacity');
  succeeds(store, (d) => transferItems(d, { ...everything, bulkItems: {}, equipmentItemIds: [], cargoIds: ['lot_1'], allowOverload: true }));
  assert.equal(calculateLoad(store.getState(), CART).overweight, true);
});

// ------------------------------------------------------------------ definitions

test('[inventory.definitions.custom-resource] an approved custom resource can be stored, a merely proposed one cannot', () => {
  const store = setup();
  const record = (approvalStatus, extra = {}) => ({
    domainId: 'resource', definitionId: 'dragon_scale', schemaVersion: 1, definitionVersion: 1, sourceType: 'player', sourceRef: null,
    approvalStatus, approvedByRef: null, revision: 0,
    definitionData: {
      id: 'dragon_scale', name: 'Dragon scale', category: 'luxury', unit: 'piece', basePrice: 900, weight: 3, volume: 2, perishRate: 0, essential: false, tags: ['luxury'], ...extra,
    },
  });
  succeeds(store, (d) => { d.world.customDefinitions.records['resource:dragon_scale'] = record('pending'); });
  const add = (d) => addBulk(d, { inventoryId: PLAYER, itemDefinitionId: 'dragon_scale', quantity: 2 });
  refuses(store, add, 'inventory_unregistered_resource');
  succeeds(store, (d) => { d.world.customDefinitions.records['resource:dragon_scale'].approvalStatus = 'approved'; });
  succeeds(store, add);
  // Weight and volume come from the custom definition.
  assert.deepEqual([calculateLoad(store.getState(), PLAYER).weightKg, calculateLoad(store.getState(), PLAYER).volumeL], [7.5 + 6, 8 + 4]);
  // A custom resource with a bad weight is not a valid save.
  const bad = store.transact('bad resource', (d) => { d.world.customDefinitions.records['resource:dragon_scale'] = record('approved', { weight: -3 }); });
  assert.equal(bad.error, 'store_state_invalid');
});
