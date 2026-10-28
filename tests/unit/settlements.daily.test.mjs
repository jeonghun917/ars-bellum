import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/core/store.js';
import { fail } from '../../src/core/result.js';
import { newGameState } from '../../src/game/new-game.js';
import { runDueDays } from '../../src/game/daily.js';
import { validateState } from '../../src/persist/schema.js';
import * as settlements from '../../src/domains/settlements/index.js';
import {
  CONSTRUCTION_WAGE, FOOD_PER_PERSON_PER_DAY, PUBLIC_WAGES, SUBSISTENCE_GRAIN_PER_PEASANT,
} from '../../src/domains/settlements/config.js';

const { createSettlementsFromWorldData, dailySteps, enqueueConstruction, setConstructionWorkforce } = settlements;
const ID = 'test_village';
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

function makeStore(edit) {
  const store = createStore(newGameState({ seed: 7 }), { validate: validateState });
  const seeded = store.transact('seed', (draft) => {
    const created = createSettlementsFromWorldData(draft);
    if (!created.ok) return created;
    if (edit) edit(draft.world.settlements[ID], draft);
    return created;
  });
  assert.equal(seeded.ok, true, JSON.stringify(seeded));
  return store;
}

const built = (level) => ({ level, enabled: true, condition: 1 });
const village = (store) => store.getState().world.settlements[ID];

function passDays(store, count, steps = dailySteps) {
  assert.equal(store.transact('time', (draft) => { draft.calendar.day += count; }).ok, true);
  const result = runDueDays(store, steps);
  assert.equal(result.ok, true, JSON.stringify(result));
}

// Every number in the settlements, so a test can say "none of them is negative".
function numbersIn(value, path, found = []) {
  if (typeof value === 'number') found.push([path, value]);
  else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) numbersIn(value[key], `${path}.${key}`, found);
  }
  return found;
}

test('[settlements.daily.step-order] the steps run construction, effects, labor, production, consumption, spoilage, finance, population', () => {
  assert.deepEqual(dailySteps.map((step) => step.name), [
    'settlements.construction', 'settlements.development_effects', 'settlements.labor', 'settlements.production',
    'settlements.consumption', 'settlements.spoilage', 'settlements.finance', 'settlements.population',
  ]);
  const orders = dailySteps.map((step) => step.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  assert.equal(new Set(orders).size, orders.length);
  assert.ok(orders.every((order) => order < 500), 'before the finance area marks overdue debts');
});

test('[settlements.daily.order-effects] a building that finishes today already raises capacity and jobs today, and food made today is eaten today', () => {
  const store = makeStore((settlement) => {
    Object.assign(settlement.inventory, { timber: 100, planks: 50, clay: 50 });
    settlement.inventory.grain = 0;
  });
  store.transact('queue', (draft) => {
    assert.equal(enqueueConstruction(draft, { settlementId: ID, buildingId: 'housing_district' }).ok, true);
    return setConstructionWorkforce(draft, { settlementId: ID, workforce: 60 });
  });
  passDays(store, 19);
  assert.equal(village(store).population.effectiveCapacity, 1600);
  assert.equal(village(store).economy.report.day, 19);
  passDays(store, 1);
  const done = village(store);
  assert.equal(done.buildings.housing_district.level, 1);
  assert.equal(done.economy.report.day, 20);
  assert.equal(done.population.effectiveCapacity, 2800);
  assert.equal(done.population.jobSources.buildings.laborers, 2);

  const hungry = makeStore((settlement) => { settlement.inventory.grain = 0; });
  passDays(hungry, 1);
  const report = village(hungry).economy.report;
  assert.ok(report.foodEaten > 0, 'grain grown today was eaten today');
  assert.equal(report.consumed.grain, report.produced.grain);
  assert.ok(report.taxesCollected > 0, 'taxes see the same day production');
});

test('[settlements.daily.deterministic] the same start and the same days give the same state, also across a save and load', () => {
  const run = () => {
    const store = makeStore();
    store.transact('queue', (draft) => {
      enqueueConstruction(draft, { settlementId: 'test_city', buildingId: 'farm' });
      setConstructionWorkforce(draft, { settlementId: 'test_city', workforce: 30 });
    });
    return store;
  };
  const a = run();
  const b = run();
  passDays(a, 25);
  passDays(b, 25);
  assert.deepEqual(a.getState(), b.getState());

  const split = run();
  passDays(split, 10);
  assert.equal(split.replace(JSON.parse(JSON.stringify(split.getState()))).ok, true);
  passDays(split, 15);
  assert.deepEqual(split.getState().world, a.getState().world);
  assert.deepEqual(split.getState().rng, a.getState().rng);
});

test('[settlements.daily.catch-up-equals-single-days] processing 30 days one at a time equals processing them in one catch-up', () => {
  const setup = (draft) => {
    for (const id of ['test_city', 'test_castle', 'test_village']) {
      const settlement = draft.world.settlements[id];
      settlement.money.treasury = 3000;
      Object.assign(settlement.inventory, { timber: 300, planks: 100, clay: 100, pottery: 20, iron_ingot: 20, salt: 5 });
      for (const buildingId of ['farm', 'bakery', 'housing_district']) {
        assert.equal(enqueueConstruction(draft, { settlementId: id, buildingId }).ok, true, `${id} ${buildingId}`);
      }
      setConstructionWorkforce(draft, { settlementId: id, workforce: 25 });
    }
    draft.world.settlements.test_castle.buildings.warehouse = built(1);
    draft.world.settlements.test_village.buildings.sawmill = built(1);
  };
  const stepwise = makeStore((_, draft) => setup(draft));
  const jump = makeStore((_, draft) => setup(draft));
  for (let day = 0; day < 30; day += 1) passDays(stepwise, 1);
  passDays(jump, 30);
  assert.equal(stepwise.getState().lastProcessedDay, 30);
  assert.equal(jump.getState().lastProcessedDay, 30);
  assert.deepEqual(stepwise.getState().world, jump.getState().world);
  assert.ok(Object.keys(jump.getState().world.settlements.test_city.buildings).length > 0 || jump.getState().world.settlements.test_city.construction.queue.length > 0);
});

test('[settlements.daily.failed-day-changes-nothing] if a later step fails the whole day is discarded, including every settlement step', () => {
  const store = makeStore((settlement) => { settlement.inventory.moon_dust = 4; });
  const before = store.getState();
  const steps = [...dailySteps, { order: 900, name: 'test.broken', run: () => fail('broken') }];
  assert.equal(store.transact('time', (draft) => { draft.calendar.day += 3; }).ok, true);
  const afterTime = store.getState();
  const result = runDueDays(store, steps);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'daily_step_failed');
  assert.deepEqual(result.processed, []);
  assert.equal(store.getState(), afterTime);
  assert.deepEqual(store.getState().world, before.world);
  assert.equal(store.getState().lastProcessedDay, 0);
  assert.equal(runDueDays(store, dailySteps).ok, true);
  assert.equal(store.getState().lastProcessedDay, 3);
});

test('[settlements.daily.no-negatives] after hundreds of days of hunger, debt and heavy upkeep no stock, money or count is below zero', () => {
  const store = makeStore((settlement, draft) => {
    settlement.money = { treasury: 3, privateWealth: 2, merchantCapital: 0 };
    settlement.inventory = { moon_dust: 2 };
    Object.assign(settlement.buildings, {
      fortifications: built(3), housing_district: built(2), farm: built(2), bakery: built(1), weaponsmith: built(1), jeweler: built(2),
    });
    settlement.construction.workforce = 500;
    const city = draft.world.settlements.test_city;
    city.money.treasury = 20;
    city.buildings.market_square = built(4);
    city.inventory.grain = 5;
  });
  store.transact('queue', (draft) => enqueueConstruction(draft, { settlementId: ID, buildingId: 'lumber_camp' }));
  for (let block = 0; block < 12; block += 1) {
    passDays(store, 30);
    for (const settlement of Object.values(store.getState().world.settlements)) {
      for (const [path, value] of numbersIn(settlement, settlement.id)) {
        if (path.endsWith('.netLastDay')) continue;
        assert.ok(Number.isFinite(value) && value >= 0, `${path} = ${value}`);
      }
    }
  }
  assert.equal(store.getState().lastProcessedDay, 360);
  assert.equal(village(store).inventory.moon_dust, 2);
});

test('[settlements.daily.unknown-resource-kept] a resource id the catalog does not know is never dropped, spoiled or eaten', () => {
  const store = makeStore((settlement) => { Object.assign(settlement.inventory, { moon_dust: 7.5, 'mod:glow_moss': 0.0003 }); });
  passDays(store, 120);
  assert.equal(village(store).inventory.moon_dust, 7.5);
  assert.equal(village(store).inventory['mod:glow_moss'], 0.0003);
  assert.equal(store.replace(JSON.parse(JSON.stringify(store.getState()))).ok, true);
  assert.equal(village(store).inventory.moon_dust, 7.5);
});

test('[settlements.production.farm-output] a farm makes its recipe amount per level, and idle peasants add a little subsistence grain', () => {
  const store = makeStore((settlement) => { settlement.buildings.farm = built(2); settlement.inventory.grain = 0; });
  passDays(store, 1);
  const state = village(store);
  const peasantsLeft = state.population.labor.employedByType.peasants - 24;
  assert.equal(state.economy.report.produced.grain, round(60 + peasantsLeft * SUBSISTENCE_GRAIN_PER_PEASANT, 4));
  assert.equal(state.economy.report.productionValue, round(state.economy.report.produced.grain * 8, 2));
  assert.equal(state.population.jobSources.buildings.peasants, 24);
});

test('[settlements.production.labor-limited] too few workers slow a building down, and below its minimum rate it stops', () => {
  const run = (participationRate) => {
    const store = makeStore((settlement) => {
      settlement.buildings.farm = built(5);
      settlement.inventory.grain = 0;
      settlement.population.labor.participationRate = participationRate;
    });
    passDays(store, 1);
    return village(store);
  };
  const slow = run(0.1);
  const peasants = slow.population.labor.employedByType.peasants;
  assert.ok(peasants > 15 && peasants < 25, `peasants ${peasants}`);
  assert.equal(slow.economy.report.produced.grain, round((30 * 5 * peasants) / 60, 4));
  assert.equal(slow.population.labor.vacanciesByType.peasants > 0, true);

  const idle = run(0.04);
  assert.ok(idle.population.labor.employedByType.peasants / 60 < 0.25);
  assert.equal(idle.economy.report.produced.grain, round(idle.population.labor.employedByType.peasants * SUBSISTENCE_GRAIN_PER_PEASANT, 4), 'only subsistence');
});

test('[settlements.production.inputs] a processing building uses its inputs, runs at the rate they allow and stops without them', () => {
  const run = (salt) => {
    const store = makeStore((settlement) => {
      settlement.buildings.bakery = built(1);
      Object.assign(settlement.inventory, { grain: 100, salt });
    });
    passDays(store, 1);
    return village(store).economy.report;
  };
  const full = run(5);
  assert.deepEqual(full.used, { grain: 4, salt: 0.1 });
  assert.equal(full.produced.bread, 5);
  const half = run(0.05);
  assert.deepEqual(half.used, { salt: 0.05, grain: 2 });
  assert.equal(half.produced.bread, 2.5);
  const none = run(0);
  assert.deepEqual(none.used, {});
  assert.equal(none.produced.bread, undefined);
});

test('[settlements.production.switched-off] a switched-off building produces nothing, offers no jobs and still costs upkeep', () => {
  const store = makeStore((settlement) => { settlement.buildings.farm = { level: 3, enabled: false, condition: 1 }; });
  passDays(store, 3);
  const report = village(store).economy.report;
  assert.deepEqual(report.produced, { grain: round(village(store).population.labor.employedByType.peasants * SUBSISTENCE_GRAIN_PER_PEASANT, 4) }, 'subsistence only');
  assert.equal(village(store).population.jobSources.buildings.peasants, 0);
  assert.equal(report.maintenancePaid, 3);
});

test('[settlements.consumption.eats-in-order] people eat perishable food first and grain last, and a full meal means full satisfaction', () => {
  const store = makeStore((settlement) => { Object.assign(settlement.inventory, { fish: 3, meat: 2, bread: 4, grain: 1000 }); });
  const need = round(village(store).population.current * FOOD_PER_PERSON_PER_DAY, 4);
  passDays(store, 1);
  const report = village(store).economy.report;
  assert.equal(report.foodNeeded, need);
  assert.deepEqual(report.consumed, { fish: 3, meat: 2, bread: 4, grain: round(need - 9, 4) });
  assert.equal(village(store).population.conditions.foodSatisfaction, 1);
  assert.equal(report.shortageValue, 0);
});

test('[settlements.consumption.shortage] with no food nobody eats, satisfaction falls to zero and deaths become more likely', () => {
  const starve = (hungry) => {
    const store = makeStore((settlement) => {
      settlement.inventory.grain = hungry ? 0 : 1000;
      if (hungry) settlement.population.labor.participationRate = 0;
    });
    passDays(store, 1);
    return village(store);
  };
  const fed = starve(false);
  const hungry = starve(true);
  assert.equal(hungry.economy.report.foodEaten, 0);
  assert.equal(hungry.population.conditions.foodSatisfaction, 0);
  assert.equal(hungry.economy.report.shortageValue, round(hungry.economy.report.foodNeeded * 8, 2));
  assert.equal(fed.population.conditions.foodSatisfaction, 1);
  assert.ok(hungry.population.naturalChange.effectiveDeathRate > fed.population.naturalChange.effectiveDeathRate * 1.6);
  assert.equal(hungry.inventory.grain, undefined);
});

test('[settlements.spoilage.rates] perishable goods lose their daily share, warehouses reduce the loss, unknown goods and non-perishables stay', () => {
  const stock = { grapes: 100, hides: 100, wine: 1000, salt: 100, moon_dust: 5 };
  const plain = makeStore((settlement) => { Object.assign(settlement.inventory, stock); });
  passDays(plain, 1);
  assert.deepEqual(
    { grapes: village(plain).inventory.grapes, hides: village(plain).inventory.hides, wine: village(plain).inventory.wine, salt: village(plain).inventory.salt, moon_dust: village(plain).inventory.moon_dust },
    { grapes: 88, hides: 97, wine: 999, salt: 100, moon_dust: 5 },
  );
  const { grain, ...spoiled } = village(plain).economy.report.spoiled;
  assert.deepEqual(spoiled, { grapes: 12, hides: 3, wine: 1 });
  assert.equal(village(plain).economy.report.spoilageValue, round(12 * 13 + 3 * 15 + 1 * 65 + grain * 8, 2));

  const stored = makeStore((settlement) => { Object.assign(settlement.inventory, stock); settlement.buildings.warehouse = built(1); });
  passDays(stored, 1);
  assert.equal(village(stored).inventory.grapes, 89.5);
  assert.equal(village(stored).inventory.hides, 98.5);
  assert.equal(village(stored).inventory.wine, 1000);
});

test('[settlements.production.goods-balance] every day, goods at the start plus made minus used, eaten and spoiled equals goods at the end', () => {
  const store = makeStore((settlement, draft) => {
    Object.assign(settlement.inventory, { timber: 20, iron_ore: 50, charcoal: 20, grapes: 40, wool: 20, salt: 3 });
    Object.assign(settlement.buildings, { farm: built(1), bakery: built(1), smelter: built(1), winery: built(1), weaver: built(1), sawmill: built(1) });
    Object.assign(draft.world.settlements.test_city.buildings, { farm: built(3), vineyard: built(2), warehouse: built(1) });
  });
  for (let day = 0; day < 40; day += 1) {
    const before = store.getState();
    passDays(store, 1);
    const after = store.getState();
    for (const id of ['test_village', 'test_city']) {
      const start = before.world.settlements[id].inventory;
      const end = after.world.settlements[id].inventory;
      const { produced, used, consumed, spoiled } = after.world.settlements[id].economy.report;
      for (const resourceId of new Set([...Object.keys(start), ...Object.keys(end), ...Object.keys(produced)])) {
        const expected = round((start[resourceId] ?? 0) + (produced[resourceId] ?? 0) - (used[resourceId] ?? 0) - (consumed[resourceId] ?? 0) - (spoiled[resourceId] ?? 0), 4);
        assert.equal(round(end[resourceId] ?? 0, 4), expected, `day ${day + 1} ${id} ${resourceId}`);
      }
    }
  }
  assert.ok(village(store).economy.report.produced.iron_ingot > 0 || village(store).inventory.iron_ingot > 0, 'the chain ran');
});

test('[settlements.finance.maintenance-charged] every building costs its upkeep from the treasury each day, paid to private wealth, and only what the treasury holds', () => {
  const upkeep = 2 * 2 + 10;
  const store = makeStore((settlement) => {
    settlement.money.treasury = 1000;
    Object.assign(settlement.buildings, { housing_district: built(2), fortifications: built(1) });
  });
  for (let day = 0; day < 5; day += 1) {
    const before = village(store).money;
    passDays(store, 1);
    const { money, economy } = village(store);
    assert.equal(economy.report.maintenancePaid, upkeep);
    assert.equal(economy.report.maintenanceUnpaid, 0);
    assert.equal(round(money.treasury + money.privateWealth, 2), round(before.treasury + before.privateWealth, 2), 'upkeep stays in the settlement');
  }

  const poor = makeStore((settlement) => {
    settlement.money = { treasury: 0, privateWealth: 0, merchantCapital: 0 };
    Object.assign(settlement.buildings, { housing_district: built(2), fortifications: built(1) });
  });
  passDays(poor, 10);
  const report = village(poor).economy.report;
  assert.equal(round(report.maintenancePaid + report.maintenanceUnpaid, 2), upkeep);
  assert.ok(report.maintenanceUnpaid > 0);
  assert.ok(village(poor).money.treasury >= 0 && village(poor).money.privateWealth >= 0);
});

test('[settlements.finance.wages-taxes] the treasury pays wages to its staff and crew, and private wealth pays tax on production and wages', () => {
  const store = makeStore((settlement) => {
    settlement.economy.taxRate = 0.2;
    settlement.economy.wageIndex = 2;
    settlement.construction.workforce = 20;
    settlement.inventory.timber = 100;
    settlement.buildings.farm = built(1);
  });
  store.transact('queue', (draft) => enqueueConstruction(draft, { settlementId: ID, buildingId: 'lumber_camp' }));
  const before = village(store).money;
  passDays(store, 1);
  const state = village(store);
  const employed = state.population.labor.employedByType;
  const staff = Object.entries(PUBLIC_WAGES).reduce((sum, [jobId, wage]) => sum + employed[jobId] * wage, 0);
  const wages = round((staff + 20 * CONSTRUCTION_WAGE) * 2, 2);
  const { report } = state.economy;
  assert.equal(state.construction.assigned, 20);
  assert.equal(report.wagesPaid, wages);
  assert.equal(report.taxesCollected, round(0.2 * (report.productionValue + wages), 2));
  assert.equal(report.maintenancePaid, 1);
  assert.equal(state.money.treasury, round(before.treasury - wages + report.taxesCollected - report.maintenancePaid, 2));
  assert.equal(state.money.privateWealth, round(before.privateWealth + wages - report.taxesCollected + report.maintenancePaid, 2));
  assert.equal(state.money.merchantCapital, before.merchantCapital);
});

test('[settlements.population.base-rates-stay] the base birth and death rates do not shrink from day to day', () => {
  const store = makeStore();
  passDays(store, 80);
  const natural = village(store).population.naturalChange;
  assert.equal(natural.annualBirthRate, 0.028);
  assert.equal(natural.annualDeathRate, 0.018);
  assert.ok(natural.effectiveBirthRate > 0.02 && natural.effectiveBirthRate < 0.03, `${natural.effectiveBirthRate}`);
  assert.ok(natural.effectiveDeathRate > 0.015 && natural.effectiveDeathRate < 0.02, `${natural.effectiveDeathRate}`);
});

test('[settlements.population.capacity-limits] a crowded settlement gets no arrivals, loses people, and its demography stays whole', () => {
  const store = makeStore((settlement) => {
    settlement.population.baseCapacity = 500;
    settlement.population.effectiveCapacity = 500;
  });
  const start = village(store).population.current;
  passDays(store, 1);
  const population = village(store).population;
  assert.equal(population.migration.arrivalsLastDay, 0);
  assert.ok(population.migration.departuresLastDay > 0);
  assert.ok(population.current < start);
  assert.equal(population.demographics.children + population.demographics.workingAge + population.demographics.elderly, population.current);
  assert.ok(population.naturalChange.effectiveDeathRate > 0.018 * 1.2);

  const full = makeStore((settlement) => {
    settlement.population.baseCapacity = 900;
    settlement.population.effectiveCapacity = 900;
    settlement.population.migration.pendingInflow = 50;
  });
  for (let day = 0; day < 30; day += 1) {
    const room = Math.max(0, 900 - village(full).population.current);
    passDays(full, 1);
    assert.ok(village(full).population.migration.arrivalsLastDay <= room, `day ${day + 1}: ${room} places free`);
  }

  const open = makeStore();
  passDays(open, 40);
  assert.ok(village(open).population.current > start, 'a settlement with room attracts people');
  assert.ok(village(open).population.current <= village(open).population.effectiveCapacity);
});

test('[settlements.labor.employment-balance] everyone in the workforce is either employed or not, and construction work counts as laborer jobs', () => {
  const store = makeStore((settlement) => {
    settlement.buildings.farm = built(2);
    settlement.inventory.timber = 100;
    settlement.construction.workforce = 15;
  });
  store.transact('queue', (draft) => enqueueConstruction(draft, { settlementId: ID, buildingId: 'lumber_camp' }));
  passDays(store, 5);
  const { labor, jobSources } = village(store).population;
  assert.equal(labor.employed + labor.unemployed, labor.workforce);
  for (const jobId of Object.keys(labor.supplyByType)) {
    assert.equal(labor.employedByType[jobId] + labor.unemployedByType[jobId], labor.supplyByType[jobId]);
    assert.equal(labor.employedByType[jobId] + labor.vacanciesByType[jobId], labor.jobsByType[jobId]);
    assert.equal(labor.jobsByType[jobId], Math.floor(jobSources.baseline[jobId] + jobSources.buildings[jobId] + jobSources.construction[jobId]));
  }
  assert.equal(jobSources.construction.laborers, 15);
  assert.ok(labor.employedByType.laborers >= 15);
  assert.ok(labor.workforce <= village(store).population.demographics.workingAge);
});
