// Production, eating and spoilage of one day (NEW: the earlier version never ran any of this).
//
// Production: every building with a recipe works at a fraction r of its capacity, the smallest of
//   - its operating factor (0 when switched off, else its condition),
//   - the workers available for its job type (employed people of that type, shared between
//     buildings in id order) divided by the workers it needs,
//   - what its inputs allow from the stock.
// If r is below the recipe's minimum operating rate it does not run that day. Otherwise it uses
// laborPerCycle*level*r workers, uses inputs*level*r/cycleDays and makes outputs*level*r/cycleDays.
// Employed peasants no building needs grow a little grain on their own (subsistence).
//
// Eating: people eat FOOD_PER_PERSON_PER_DAY units, from FOOD_ORDER. The share they get becomes the
// settlement's food satisfaction, which the population formulas already react to.
//
// Spoilage: each known resource loses its perishRate (less the warehouses' spoilageReduction) of
// the stock per day. Resource ids the catalog does not know are never touched.
import {
  FOOD_ORDER, FOOD_PER_PERSON_PER_DAY, SUBSISTENCE_GRAIN_PER_PEASANT,
} from './config.js';
import { developmentSnapshot, operatingFactor } from './effects.js';
import { getRecipeForBuilding, basePriceOf, perishRateOf, isKnownResource } from './resources.js';
import {
  addToMap, clamp, reportFor, round2, round4, round6, sortedSettlementIds,
} from './records.js';
import { putInInventory, takeFromInventory } from './stock.js';

function runBuilding(settlement, buildingId, state, labor, report) {
  const recipe = getRecipeForBuilding(buildingId);
  if (!recipe) return;
  const factor = operatingFactor(state);
  if (factor <= 0) return;
  const level = state.level;
  const workersAtFull = recipe.laborPerCycle * level;
  let rate = Math.min(1, factor, labor[recipe.laborType] / workersAtFull);
  for (const [id, amount] of Object.entries(recipe.inputs)) {
    const perDayAtFull = (amount * level) / recipe.cycleDays;
    rate = Math.min(rate, (settlement.inventory[id] ?? 0) / perDayAtFull);
  }
  if (rate < recipe.minimumOperatingRate) return;
  labor[recipe.laborType] -= workersAtFull * rate;
  for (const [id, amount] of Object.entries(recipe.inputs)) {
    const used = Math.min(settlement.inventory[id] ?? 0, round4((amount * level * rate) / recipe.cycleDays));
    takeFromInventory(settlement, id, used);
    addToMap(report.used, id, used);
  }
  for (const [id, amount] of Object.entries(recipe.outputs)) {
    const made = round4((amount * level * rate) / recipe.cycleDays);
    putInInventory(settlement, id, made);
    addToMap(report.produced, id, made);
  }
}

export function processProduction(settlement, day) {
  const report = reportFor(settlement, day);
  const labor = { ...settlement.population.labor.employedByType };
  for (const buildingId of Object.keys(settlement.buildings).sort()) {
    runBuilding(settlement, buildingId, settlement.buildings[buildingId], labor, report);
  }
  const subsistence = round4(Math.max(0, labor.peasants) * SUBSISTENCE_GRAIN_PER_PEASANT);
  putInInventory(settlement, 'grain', subsistence);
  addToMap(report.produced, 'grain', subsistence);
  let value = 0;
  for (const [id, amount] of Object.entries(report.produced)) value += amount * basePriceOf(id);
  report.productionValue = round2(value);
}

export function processConsumption(settlement, day) {
  const report = reportFor(settlement, day);
  const population = settlement.population;
  const needed = round4(population.current * FOOD_PER_PERSON_PER_DAY);
  let hungry = needed;
  let value = 0;
  for (const id of FOOD_ORDER) {
    if (hungry <= 0) break;
    const eaten = Math.min(settlement.inventory[id] ?? 0, hungry);
    if (eaten <= 0) continue;
    takeFromInventory(settlement, id, eaten);
    addToMap(report.consumed, id, eaten);
    value += eaten * basePriceOf(id);
    hungry = round4(hungry - eaten);
  }
  report.foodNeeded = needed;
  report.foodEaten = round4(needed - hungry);
  report.consumptionValue = round2(value);
  report.shortageValue = round2(hungry * basePriceOf('grain'));
  population.conditions.foodSatisfaction = needed > 0 ? round6(clamp(report.foodEaten / needed, 0, 1)) : 1;
}

export function processSpoilage(settlement, day) {
  const report = reportFor(settlement, day);
  const reduction = developmentSnapshot(settlement.buildings).effects.spoilageReduction;
  let value = 0;
  for (const id of Object.keys(settlement.inventory).sort()) {
    if (!isKnownResource(id)) continue;
    const amount = settlement.inventory[id];
    const rate = Math.max(0, perishRateOf(id) - reduction);
    if (rate === 0) continue;
    const left = Math.min(amount, round4(amount * (1 - rate)));
    const lost = round4(amount - left);
    if (left > 0) settlement.inventory[id] = left;
    else delete settlement.inventory[id];
    if (lost > 0) {
      addToMap(report.spoiled, id, lost);
      value += lost * basePriceOf(id);
    }
  }
  report.spoilageValue = round2(value);
}

const eachSettlement = (process) => (draft, day) => {
  for (const id of sortedSettlementIds(draft)) process(draft.world.settlements[id], day);
};
export const productionStep = eachSettlement(processProduction);
export const consumptionStep = eachSettlement(processConsumption);
export const spoilageStep = eachSettlement(processSpoilage);
