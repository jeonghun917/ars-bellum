import test from 'node:test';
import assert from 'node:assert/strict';
import { clone } from '../../src/core/data.js';
import { createStore } from '../../src/core/store.js';
import { newGameState } from '../../src/game/new-game.js';
import { validateState } from '../../src/persist/schema.js';
import * as settlements from '../../src/domains/settlements/index.js';
import {
  BASELINE_JOBS, FOOD_ORDER, MONEY_SEEDS, PUBLIC_WAGES,
} from '../../src/domains/settlements/config.js';

const {
  addResource, canAfford, changeMoney, checkSettlements, createSettlementsFromWorldData, moveMoney, payCost, refundCost,
  removeResource, setBuildingEnabled, setEconomyIndex, WORLD_SETTLEMENT_DATA,
} = settlements;

function makeStore(edit) {
  const store = createStore(newGameState({ seed: 7 }), { validate: validateState });
  const seeded = store.transact('seed', (draft) => {
    const created = createSettlementsFromWorldData(draft);
    if (!created.ok) return created;
    if (edit) edit(draft.world.settlements.test_village);
    return created;
  });
  assert.equal(seeded.ok, true);
  return store;
}

// A rule that refuses must leave a bare draft untouched (so it needs no undo code) and, run in a
// transaction, must leave the stored state and its revision as they were.
function assertRefused(store, rule, error) {
  const draft = clone(store.getState());
  const before = clone(draft);
  const direct = rule(draft);
  assert.equal(direct.ok, false);
  assert.equal(direct.error, error);
  assert.deepEqual(draft, before);
  const stateBefore = store.getState();
  const result = store.transact('refused', rule);
  assert.equal(result.ok, false);
  assert.equal(result.error, error);
  assert.equal(store.getState(), stateBefore);
  return result;
}

const village = (store) => store.getState().world.settlements.test_village;
const stocked = (settlement) => {
  settlement.inventory.timber = 30;
  settlement.inventory.planks = 10;
};

test('[settlements.cost.all-or-nothing] a cost that cannot be paid in full takes nothing, even when part of it is affordable', () => {
  const store = makeStore(stocked);
  const pay = (cost) => (draft) => payCost(draft, { settlementId: 'test_village', cost });
  const enoughGoldShortGoods = { gold: 100, resources: { timber: 10, planks: 11 } };
  const enoughGoodsShortGold = { gold: 201, resources: { timber: 10 } };
  const detail = assertRefused(store, pay(enoughGoldShortGoods), 'settlements_insufficient_cost').detail;
  assert.deepEqual(detail, { missingGold: 0, missingResources: { planks: 1 } });
  assert.deepEqual(assertRefused(store, pay(enoughGoodsShortGold), 'settlements_insufficient_cost').detail, { missingGold: 1, missingResources: {} });
  const bothShort = { gold: 250, resources: { timber: 40, planks: 11 } };
  assert.deepEqual(assertRefused(store, pay(bothShort), 'settlements_insufficient_cost').detail.missingResources, { timber: 10, planks: 1 });

  const exact = { gold: 200, resources: { timber: 30, planks: 10 } };
  assert.equal(store.transact('pay', pay(exact)).ok, true);
  assert.equal(village(store).money.treasury, 0);
  assert.equal(village(store).inventory.timber, undefined);
  assert.equal(village(store).inventory.planks, undefined);
  assert.equal(village(store).inventory.grain, 350);
});

test('[settlements.cost.unknown-resource] a cost that names a resource nobody defined is refused whole', () => {
  const store = makeStore(stocked);
  const cost = { gold: 10, resources: { timber: 5, moon_dust: 1 } };
  const result = assertRefused(store, (draft) => payCost(draft, { settlementId: 'test_village', cost }), 'settlements_unknown_resource');
  assert.deepEqual(result.detail, { resourceId: 'moon_dust' });
  assertRefused(store, (draft) => refundCost(draft, { settlementId: 'test_village', cost, rate: 1 }), 'settlements_unknown_resource');
  assert.equal(canAfford(store.getState(), { settlementId: 'test_village', cost }).error, 'settlements_unknown_resource');
});

test('[settlements.cost.invalid-input] bad costs, amounts, rates and settlement ids are refused', () => {
  const store = makeStore(stocked);
  const pay = (input) => (draft) => payCost(draft, input);
  assertRefused(store, pay({ settlementId: 'test_village', cost: { gold: -1 } }), 'settlements_invalid_cost');
  assertRefused(store, pay({ settlementId: 'test_village', cost: { gold: Number.NaN } }), 'settlements_invalid_cost');
  assertRefused(store, pay({ settlementId: 'test_village', cost: { gold: '5' } }), 'settlements_invalid_cost');
  assertRefused(store, pay({ settlementId: 'test_village', cost: { resources: { timber: -2 } } }), 'settlements_invalid_cost');
  assertRefused(store, pay({ settlementId: 'test_village', cost: { resources: [] } }), 'settlements_invalid_cost');
  assertRefused(store, pay({ settlementId: 'test_village', cost: null }), 'settlements_invalid_cost');
  assertRefused(store, pay({ settlementId: 'nowhere', cost: { gold: 1 } }), 'settlements_unknown_settlement');
  assertRefused(store, pay({ settlementId: 'Not An Id', cost: { gold: 1 } }), 'settlements_invalid_input');
  assertRefused(store, pay(null), 'settlements_invalid_input');
  const refund = (rate) => (draft) => refundCost(draft, { settlementId: 'test_village', cost: { gold: 10 }, rate });
  assertRefused(store, refund(1.5), 'settlements_invalid_refund_rate');
  assertRefused(store, refund(-0.1), 'settlements_invalid_refund_rate');
  assertRefused(store, refund(undefined), 'settlements_invalid_refund_rate');
});

test('[settlements.cost.refund-rate] a refund gives back the given share of gold and goods', () => {
  const store = makeStore(stocked);
  const cost = { gold: 101, resources: { timber: 10.5, clay: 3 } };
  assert.equal(store.transact('refund', (draft) => refundCost(draft, { settlementId: 'test_village', cost, rate: 0.5 })).ok, true);
  assert.equal(village(store).money.treasury, 250.5);
  assert.equal(village(store).inventory.timber, 35.25);
  assert.equal(village(store).inventory.clay, 1.5);
  assert.equal(store.transact('refund', (draft) => refundCost(draft, { settlementId: 'test_village', cost, rate: 0 })).ok, true);
  assert.equal(village(store).money.treasury, 250.5);
});

test('[settlements.stock.no-negative] goods and gold cannot be taken below zero', () => {
  const store = makeStore(stocked);
  const id = 'test_village';
  assertRefused(store, (draft) => removeResource(draft, { settlementId: id, resourceId: 'timber', amount: 30.0001 }), 'settlements_insufficient_resource');
  assertRefused(store, (draft) => removeResource(draft, { settlementId: id, resourceId: 'iron_ingot', amount: 1 }), 'settlements_insufficient_resource');
  assertRefused(store, (draft) => removeResource(draft, { settlementId: id, resourceId: 'timber', amount: 0 }), 'settlements_invalid_amount');
  assertRefused(store, (draft) => removeResource(draft, { settlementId: id, resourceId: 'moon_dust', amount: 1 }), 'settlements_unknown_resource');
  assertRefused(store, (draft) => addResource(draft, { settlementId: id, resourceId: 'moon_dust', amount: 1 }), 'settlements_unknown_resource');
  assertRefused(store, (draft) => addResource(draft, { settlementId: id, resourceId: 'timber', amount: -1 }), 'settlements_invalid_amount');
  assertRefused(store, (draft) => moveMoney(draft, { settlementId: id, from: 'treasury', to: 'privateWealth', amount: 200.01 }), 'settlements_insufficient_money');
  assertRefused(store, (draft) => moveMoney(draft, { settlementId: id, from: 'treasury', to: 'treasury', amount: 1 }), 'settlements_unknown_account');
  assertRefused(store, (draft) => moveMoney(draft, { settlementId: id, from: 'bank', to: 'treasury', amount: 1 }), 'settlements_unknown_account');
  assertRefused(store, (draft) => changeMoney(draft, { settlementId: id, account: 'treasury', delta: -200.01 }), 'settlements_insufficient_money');
  assertRefused(store, (draft) => changeMoney(draft, { settlementId: id, account: 'treasury', delta: 0 }), 'settlements_invalid_amount');

  assert.equal(store.transact('take', (draft) => removeResource(draft, { settlementId: id, resourceId: 'timber', amount: 30 })).ok, true);
  assert.equal('timber' in village(store).inventory, false);
  assert.equal(store.transact('move', (draft) => moveMoney(draft, { settlementId: id, from: 'treasury', to: 'merchantCapital', amount: 200 })).ok, true);
  assert.equal(village(store).money.treasury, 0);
  assert.equal(village(store).money.merchantCapital, 320);
});

test('[settlements.settings.limits] tax rate, wage index and building switches only accept valid values', () => {
  const store = makeStore();
  const id = 'test_village';
  assert.equal(store.transact('tax', (draft) => setEconomyIndex(draft, { settlementId: id, key: 'taxRate', value: 0.25 })).ok, true);
  assert.equal(village(store).economy.taxRate, 0.25);
  assertRefused(store, (draft) => setEconomyIndex(draft, { settlementId: id, key: 'taxRate', value: 0.76 }), 'settlements_index_out_of_range');
  assertRefused(store, (draft) => setEconomyIndex(draft, { settlementId: id, key: 'wageIndex', value: -1 }), 'settlements_index_out_of_range');
  assertRefused(store, (draft) => setEconomyIndex(draft, { settlementId: id, key: 'luck', value: 1 }), 'settlements_unknown_index');
  assertRefused(store, (draft) => setBuildingEnabled(draft, { settlementId: id, buildingId: 'farm', enabled: false }), 'settlements_building_not_built');
  assertRefused(store, (draft) => setBuildingEnabled(draft, { settlementId: id, buildingId: 'castle_of_cheese', enabled: false }), 'settlements_unknown_building');
});

test('[settlements.seed.creates-all] seeding the map data creates consistent records for every settlement', () => {
  const store = makeStore();
  const state = store.getState();
  assert.deepEqual(settlements.listSettlementIds(state), ['test_castle', 'test_city', 'test_village']);
  const city = state.world.settlements.test_city;
  assert.equal(city.population.current, 8000);
  assert.equal(city.population.baseCapacity, 12000);
  assert.equal(city.population.effectiveCapacity, 12000);
  assert.deepEqual(city.population.demographics, { children: 1760, workingAge: 5440, elderly: 800 });
  assert.equal(city.inventory.grain, 500);
  assert.deepEqual(city.money, { treasury: 1800, privateWealth: 8500, merchantCapital: 3000 });
  assert.equal(city.economy.prosperity, 50);
  assert.equal(city.population.labor.workforce, 4243);
  assert.equal(city.population.labor.employed + city.population.labor.unemployed, 4243);
  assert.equal(state.world.settlements.test_castle.money.treasury, 1200);
  assert.equal(state.world.settlements.test_village.inventory.grain, 350);
  assert.deepEqual(checkSettlements(state), { ok: true });
});

test('[settlements.seed.idempotent] seeding again changes nothing, not even a settlement that has since changed', () => {
  const store = makeStore();
  store.transact('spend', (draft) => {
    draft.world.settlements.test_city.money.treasury = 5;
  });
  const before = store.getState();
  const again = store.transact('seed again', (draft) => createSettlementsFromWorldData(draft));
  assert.equal(again.ok, true);
  assert.deepEqual(again.created, []);
  assert.deepEqual(again.skipped, ['test_city', 'test_castle', 'test_village']);
  assert.deepEqual(store.getState().world, before.world);
  assert.equal(store.getState().world.settlements.test_city.money.treasury, 5);

  const partial = store.transact('add one', (draft) => {
    delete draft.world.settlements.test_castle;
    return createSettlementsFromWorldData(draft);
  });
  assert.deepEqual(partial.created, ['test_castle']);
  assert.equal(store.getState().world.settlements.test_city.money.treasury, 5);
});

test('[settlements.seed.all-or-nothing] one bad entry means no settlement is created at all', () => {
  const good = WORLD_SETTLEMENT_DATA.settlements;
  const bad = { id: 'broken', type: 'village', tags: [], population: { current: -5, capacity: 100 } };
  const empty = createStore(newGameState({ seed: 7 }), { validate: validateState });
  const data = { settlements: [good[0], good[1], bad, good[2]] };

  const draft = clone(empty.getState());
  const direct = createSettlementsFromWorldData(draft, data);
  assert.equal(direct.error, 'settlements_seed_invalid');
  assert.deepEqual(direct.detail, { id: 'broken', issue: 'population.current' });
  assert.deepEqual(draft.world.settlements, {});

  const result = empty.transact('seed', (d) => createSettlementsFromWorldData(d, data));
  assert.equal(result.ok, false);
  assert.deepEqual(empty.getState().world.settlements, {});
  assert.equal(empty.getState().revision, 0);
});

test('[settlements.seed.invalid-entries] every kind of bad map entry is named and refused', () => {
  const base = { id: 'x_town', type: 'town', tags: ['rural'], population: { current: 100, capacity: 200 }, economy: { prosperity: 40, foodStock: 10 } };
  const cases = [
    ['id', { ...base, id: 'Bad Id' }],
    ['type', { ...base, type: 'metropolis' }],
    ['tags', { ...base, tags: 'rural' }],
    ['population.current', { ...base, population: { current: 1.5, capacity: 200 } }],
    ['population.capacity', { ...base, population: { current: 1, capacity: 0 } }],
    ['economy.prosperity', { ...base, economy: { prosperity: 201 } }],
    ['economy.foodStock', { ...base, economy: { foodStock: -1 } }],
    ['inventory.relic', { ...base, inventory: { relic: -3 } }],
  ];
  for (const [issue, entry] of cases) {
    const draft = clone(newGameState());
    const result = createSettlementsFromWorldData(draft, { settlements: [entry] });
    assert.equal(result.error, 'settlements_seed_invalid', issue);
    assert.equal(result.detail.issue, issue);
    assert.deepEqual(draft.world.settlements, {});
  }
  const duplicate = createSettlementsFromWorldData(clone(newGameState()), { settlements: [base, base] });
  assert.equal(duplicate.detail.issue, 'duplicate_id');
  assert.equal(createSettlementsFromWorldData(clone(newGameState()), { settlements: 'none' }).detail.issue, 'settlements');
  assert.equal(createSettlementsFromWorldData(clone(newGameState()), { settlements: [base] }).ok, true);
});

test('[settlements.seed.unknown-resource-kept] a resource id the catalog does not know survives seeding and every read', () => {
  const entry = { id: 'x_town', type: 'town', tags: [], population: { current: 100, capacity: 200 }, inventory: { moon_dust: 7, grain: 3 } };
  const store = createStore(newGameState(), { validate: validateState });
  assert.equal(store.transact('seed', (draft) => createSettlementsFromWorldData(draft, { settlements: [entry] })).ok, true);
  assert.deepEqual(store.getState().world.settlements.x_town.inventory, { grain: 3, moon_dust: 7 });
  assert.equal(store.replace(clone(store.getState())).ok, true);
  assert.equal(store.getState().world.settlements.x_town.inventory.moon_dust, 7);
});

test('[settlements.check.rejects-bad-records] the state check refuses negative, missing or inconsistent settlement data', () => {
  const state = makeStore().getState();
  const broken = (edit) => {
    const copy = clone(state);
    edit(copy.world.settlements.test_village);
    return checkSettlements(copy);
  };
  assert.equal(broken((s) => { s.inventory.grain = -1; }).error, 'settlements_invalid_record');
  assert.equal(broken((s) => { s.inventory['Not An Id'] = 1; }).detail.issue, 'inventory');
  assert.equal(broken((s) => { s.money.treasury = -0.01; }).detail.issue, 'money');
  assert.equal(broken((s) => { s.population.demographics.children += 1; }).detail.issue, 'population_demographics_total');
  assert.equal(broken((s) => { s.population.labor.employed += 1; }).detail.issue, 'population_labor_employment');
  assert.equal(broken((s) => { s.economy.taxRate = 2; }).detail.issue, 'economy_indexes');
  assert.equal(broken((s) => { s.buildings.farm = { level: 99, enabled: true, condition: 1 }; }).detail.issue, 'building:farm');
  assert.equal(broken((s) => { s.buildings.moon_base = { level: 1, enabled: true, condition: 1 }; }).detail.issue, 'building:moon_base');
  assert.equal(broken((s) => { s.type = 'metropolis'; }).detail.issue, 'type');
  assert.equal(broken((s) => { s.construction.activeJobId = 'ghost'; }).detail.issue, 'construction_active_job');
  const store = createStore(clone(state), { validate: validateState });
  const refused = store.transact('corrupt', (draft) => { draft.world.settlements.test_village.money.privateWealth = -5; });
  assert.equal(refused.error, 'store_state_invalid');
  assert.equal(store.getState().world.settlements.test_village.money.privateWealth, 900);
});

test('[settlements.catalog.consistent] every id the tables mention exists, shares add up, formulas refuse levels that do not exist', () => {
  assert.deepEqual(settlements.catalogProblems(), []);
  const sum = (key) => settlements.LABOR_TYPES.reduce((total, type) => total + type[key], 0);
  assert.ok(Math.abs(sum('share') - 1) < 1e-9);
  assert.ok(Math.abs(sum('supplyWeight') - 1) < 1e-9);
  assert.equal(new Set(settlements.LABOR_TYPE_IDS).size, 9);
  assert.equal(settlements.BUILDINGS.length, 32);
  assert.equal(settlements.RESOURCE_DATA.length, 27);
  assert.equal(settlements.RECIPE_DATA.length, 23);
  assert.ok(settlements.RESOURCE_DATA.every((resource) => resource.perishRate >= 0 && resource.perishRate < 1 && resource.basePrice > 0));
  assert.deepEqual(settlements.constructionCost('farm', 1), { gold: 60, resources: { timber: 12 } });
  assert.equal(settlements.constructionCost('farm', 0), null);
  assert.equal(settlements.constructionCost('farm', 6), null);
  assert.equal(settlements.constructionDays('farm', 2), 15);
  assert.equal(settlements.workRequired('farm', 2), 188);
  assert.equal(settlements.constructionCost('castle_of_cheese', 1), null);
  assert.deepEqual(settlements.jobsAtLevel('farm', 2).peasants, 24);
  assert.equal(settlements.maintenanceAtLevel('fortifications', 3), 30);
  assert.deepEqual(settlements.effectsAtLevel('housing_district', 2), { housingCapacity: 2400 });
  assert.equal(settlements.checkPlacement('fishery', { type: 'village', tags: ['river'] }).allowed, true);
  assert.equal(settlements.checkPlacement('fishery', { type: 'village', tags: [] }).allowed, false);
  // The settings tables name job ids, resources and settlement types: a typo there would silently do nothing.
  assert.ok(Object.keys(PUBLIC_WAGES).every((id) => settlements.LABOR_TYPE_IDS.includes(id)));
  assert.ok(FOOD_ORDER.every((id) => settlements.isKnownResource(id)));
  for (const type of settlements.SETTLEMENT_TYPES) {
    assert.ok(MONEY_SEEDS[type], `money seed for ${type}`);
    assert.ok(BASELINE_JOBS.typeMultipliers[type], `baseline multiplier for ${type}`);
  }
});
