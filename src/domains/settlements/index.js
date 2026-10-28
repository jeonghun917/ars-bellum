// Settlements: population, jobs, goods, money, buildings and construction of every settlement,
// and the daily processing that makes them live. Other areas import only from here.
//
//   records.js       shape of a settlement record, shared helpers
//   labor-types.js   the one table of job types        resources.js   goods and recipes
//   buildings.js     building table and formulas       config.js      every tunable number
//   stock.js         paying, refunding, moving goods and gold
//   rules.js         actions on goods, money, settings, buildings
//   construction.js  queue actions and daily progress  seed.js        creating settlements
//   effects.js, labor.js, demography.js, production.js, finance.js   the daily steps' logic
//   daily.js         the steps in order                checks.js      record validation
import { registerAreaCheck } from '../../persist/schema.js';
import { checkSettlements } from './checks.js';

export { dailySteps } from './daily.js';
export { checkSettlements, settlementIssue } from './checks.js';
export { createSettlementsFromWorldData } from './seed.js';
export { WORLD_SETTLEMENT_DATA } from './seed-data.js';
export {
  enqueueConstruction, cancelConstruction, setConstructionWorkforce, previewConstruction, projectedLevel,
} from './construction.js';
export {
  canAfford, payCost, refundCost, addResource, removeResource, moveMoney, changeMoney, setEconomyIndex, setBuildingEnabled,
} from './rules.js';
export { getSettlement, sortedSettlementIds as listSettlementIds } from './records.js';
export { developmentSnapshot } from './effects.js';
export { constructionLaborAvailable } from './labor.js';
export { LABOR_TYPES, LABOR_TYPE_IDS } from './labor-types.js';
export { RESOURCE_DATA, RECIPE_DATA, isKnownResource, getResource, getRecipeForBuilding } from './resources.js';
export {
  BUILDINGS, SETTLEMENT_TYPES, EFFECT_KEYS, getBuilding, constructionCost, constructionDays, workRequired, catalogProblems,
  effectsAtLevel, jobsAtLevel, maintenanceAtLevel, checkPlacement,
} from './buildings.js';

registerAreaCheck('settlements', checkSettlements);
