// The shape of one settlement record (world.settlements[id]) and small helpers shared by the rules.
//
// {
//   id, type, tags,
//   population: { current, baseCapacity, effectiveCapacity, demographics, labor, conditions,
//                 conditionOverrides, migration, naturalChange, jobSources },
//   inventory: { resourceId: amount },          // any id is kept, known or not
//   money: { treasury, privateWealth, merchantCapital },
//   economy: { prosperity, taxRate, wageIndex, report },   // report = what happened on the last day
//   buildings: { buildingId: { level, enabled, condition } },
//   construction: { nextJobNumber, workforce, assigned, activeJobId, queue, history },
// }
import {
  DEFAULT_CONDITIONS, DEFAULT_PROSPERITY, DEFAULT_TAX_RATE, DEFAULT_WAGE_INDEX, NATURAL_RATES, PARTICIPATION_RATE, START_SHARES,
} from './config.js';
import { emptyLaborMap } from './labor-types.js';

export const REPORT_NUMBERS = Object.freeze([
  'productionValue', 'consumptionValue', 'foodNeeded', 'foodEaten', 'shortageValue', 'spoilageValue',
  'wagesPaid', 'wagesUnpaid', 'taxesCollected', 'maintenancePaid', 'maintenanceUnpaid',
]);
export const REPORT_MAPS = Object.freeze(['produced', 'used', 'consumed', 'spoiled']);

const scaled = (digits) => (value) => {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded; // never -0: it is not equal to 0 for deepStrictEqual and saves
};
export const round2 = scaled(2);
export const round4 = scaled(4);
export const round6 = scaled(6);
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export const sortedSettlementIds = (stateOrDraft) => Object.keys(stateOrDraft.world.settlements).sort();
export const getSettlement = (stateOrDraft, id) => (
  Object.prototype.hasOwnProperty.call(stateOrDraft.world.settlements, id) ? stateOrDraft.world.settlements[id] : null
);

export function emptyReport(day) {
  const report = { day };
  for (const key of REPORT_NUMBERS) report[key] = 0;
  for (const key of REPORT_MAPS) report[key] = {};
  return report;
}

// The report of the day being processed. The first daily step of a day starts it; later steps add.
export function reportFor(settlement, day) {
  const economy = settlement.economy;
  if (!economy.report || economy.report.day !== day) economy.report = emptyReport(day);
  return economy.report;
}

export function addToMap(map, id, amount) {
  map[id] = round4((map[id] ?? 0) + amount);
}

export function emptyLabor() {
  return {
    participationRate: PARTICIPATION_RATE,
    workforce: 0,
    supplyByType: emptyLaborMap(),
    jobsByType: emptyLaborMap(),
    employedByType: emptyLaborMap(),
    unemployedByType: emptyLaborMap(),
    vacanciesByType: emptyLaborMap(),
    employed: 0,
    unemployed: 0,
    unemploymentRate: 0,
    vacancies: 0,
    vacancyRate: 0,
  };
}

export function emptyConstruction() {
  return { nextJobNumber: 1, workforce: 0, assigned: 0, activeJobId: null, queue: [], history: [] };
}

export function newSettlementRecord({ id, type, tags, current, baseCapacity, prosperity, inventory, money }) {
  const children = Math.floor(current * START_SHARES.children);
  const elderly = Math.floor(current * START_SHARES.elderly);
  return {
    id,
    type,
    tags: [...tags],
    population: {
      current,
      baseCapacity,
      effectiveCapacity: baseCapacity,
      demographics: { children, workingAge: current - children - elderly, elderly },
      labor: emptyLabor(),
      conditions: { ...DEFAULT_CONDITIONS },
      conditionOverrides: {},
      migration: {
        outflowPressure: 0, inflowAttractiveness: 0, pendingOutflow: 0, pendingInflow: 0, arrivalsLastDay: 0, departuresLastDay: 0,
      },
      naturalChange: {
        ...NATURAL_RATES,
        effectiveBirthRate: NATURAL_RATES.annualBirthRate,
        effectiveDeathRate: NATURAL_RATES.annualDeathRate,
        birthAccumulator: 0,
        deathAccumulator: 0,
        birthsLastDay: 0,
        deathsLastDay: 0,
        netLastDay: 0,
      },
      jobSources: { baseline: emptyLaborMap(), buildings: emptyLaborMap(), construction: emptyLaborMap() },
    },
    inventory: { ...inventory },
    money: { ...money },
    economy: {
      prosperity: prosperity ?? DEFAULT_PROSPERITY,
      taxRate: DEFAULT_TAX_RATE,
      wageIndex: DEFAULT_WAGE_INDEX,
      report: emptyReport(0),
    },
    buildings: {},
    construction: emptyConstruction(),
  };
}
