// Births, deaths and migration. The formulas are the earlier version's S_Demography.js, with one
// change: the earlier code saved each day's conditioned birth/death rate back as the "base" rate,
// so the base shrank every day (a birth rate of 2.8% a year fell below 0.2% within a month).
// Here the base rates stay as they are and the rates used each day are stored beside them.
//
// There is no randomness. Fractions of a person are carried over in the accumulators and
// migration remainders, so the result depends only on the state.
import { ARRIVAL_SHARES, DAYS_PER_YEAR, MIGRATION } from './config.js';
import { recalculateLabor } from './labor.js';
import { clamp, round6, sortedSettlementIds } from './records.js';

const NO_OVERRIDE = Object.freeze({});

function condition(population, key) {
  const override = (population.conditionOverrides ?? NO_OVERRIDE)[key];
  return clamp(override !== undefined ? override : population.conditions[key], 0, 1);
}

const occupancyOf = (population) => population.current / Math.max(1, population.effectiveCapacity);

export function birthRate(population) {
  const food = condition(population, 'foodSatisfaction');
  const health = condition(population, 'health');
  const security = condition(population, 'security');
  const occupancy = occupancyOf(population);
  const conditionFactor = clamp(0.55 + food * 0.2 + health * 0.15 + security * 0.1, 0.25, 1.15);
  const capacityFactor = occupancy <= 1 ? 1 : clamp(1 - (occupancy - 1) * 0.75, 0.2, 1);
  return clamp(population.naturalChange.annualBirthRate * conditionFactor * capacityFactor, 0, 1);
}

export function deathRate(population) {
  const food = condition(population, 'foodSatisfaction');
  const health = condition(population, 'health');
  const security = condition(population, 'security');
  const occupancy = occupancyOf(population);
  const hardship = (1 - food) * 0.45 + (1 - health) * 0.4 + (1 - security) * 0.15;
  const overcrowding = occupancy > 1 ? Math.min(1, occupancy - 1) : 0;
  return clamp(population.naturalChange.annualDeathRate * (0.7 + hardship * 1.5 + overcrowding * 0.9), 0, 1);
}

export function migrationPressure(population) {
  const occupancy = occupancyOf(population);
  const overcrowding = clamp(occupancy - 1, 0, 1);
  const freeShare = clamp(1 - occupancy, 0, 1);
  const unemployment = clamp(population.labor.unemploymentRate, 0, 1);
  const vacancyRate = clamp(population.labor.vacancyRate, 0, 1);
  const food = condition(population, 'foodSatisfaction');
  const health = condition(population, 'health');
  const security = condition(population, 'security');
  const prosperity = condition(population, 'prosperity');
  const outflowPressure = clamp(
    overcrowding * MIGRATION.overcrowdingWeight
      + unemployment * MIGRATION.unemploymentWeight
      + (1 - food) * MIGRATION.foodWeight
      + (1 - health) * MIGRATION.healthWeight
      + (1 - security) * MIGRATION.securityWeight,
    0,
    1,
  );
  const inflowAttractiveness = clamp(freeShare * 0.3 + vacancyRate * 0.25 + food * 0.1 + health * 0.1 + security * 0.1 + prosperity * 0.15, 0, 1);
  return { outflowPressure: round6(outflowPressure), inflowAttractiveness: round6(inflowAttractiveness) };
}

function dailyMigration(population) {
  const pressure = migrationPressure(population);
  const capacity = Math.max(1, population.effectiveCapacity);
  const freeCapacity = Math.max(0, capacity - population.current);
  const rawDepartures = population.current * pressure.outflowPressure * MIGRATION.scale + population.migration.pendingOutflow;
  const rawArrivals = Math.min(freeCapacity, capacity * pressure.inflowAttractiveness * MIGRATION.scale + population.migration.pendingInflow);
  const departures = Math.min(population.current, Math.floor(rawDepartures));
  const arrivals = Math.floor(rawArrivals); // rawArrivals is already capped by the free places
  return {
    ...pressure,
    departures,
    arrivals,
    outflowRemainder: round6(Math.max(0, rawDepartures - departures)),
    inflowRemainder: round6(Math.max(0, rawArrivals - arrivals)),
  };
}

function naturalChange(population) {
  const birth = birthRate(population);
  const death = deathRate(population);
  const rawBirths = (population.current * birth) / DAYS_PER_YEAR + population.naturalChange.birthAccumulator;
  const rawDeaths = (population.current * death) / DAYS_PER_YEAR + population.naturalChange.deathAccumulator;
  const births = Math.floor(rawBirths);
  const deaths = Math.min(population.current + births, Math.floor(rawDeaths));
  return {
    birth,
    death,
    births,
    deaths,
    net: births - deaths,
    birthAccumulator: round6(rawBirths - births),
    deathAccumulator: round6(rawDeaths - deaths),
  };
}

// Splits a whole number between the three age groups by share (largest remainder).
function splitByShares(total, shares) {
  const entries = Object.entries(shares).map(([key, share], index) => {
    const exact = total * share;
    return { key, index, floor: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  const result = {};
  let left = total;
  for (const entry of entries) {
    result[entry.key] = entry.floor;
    left -= entry.floor;
  }
  entries.sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (let i = 0; left > 0; i = (i + 1) % entries.length) {
    result[entries[i].key] += 1;
    left -= 1;
  }
  return result;
}

// Newborns are children, arrivals have the usual age mix. Deaths fall mostly on the old, then the
// working, then the young; people who leave are mostly working age, then children.
function applyChange(demographics, births, deaths, arrivals, departures) {
  const result = { ...demographics };
  result.children += births;
  const arrived = splitByShares(arrivals, ARRIVAL_SHARES);
  result.children += arrived.children;
  result.workingAge += arrived.workingAge;
  result.elderly += arrived.elderly;

  let dying = deaths;
  const elderlyDeaths = Math.min(result.elderly, Math.floor(dying * 0.55));
  result.elderly -= elderlyDeaths;
  dying -= elderlyDeaths;
  const workingDeaths = Math.min(result.workingAge, Math.floor(dying * 0.75));
  result.workingAge -= workingDeaths;
  dying -= workingDeaths;
  const childDeaths = Math.min(result.children, dying);
  result.children -= childDeaths;
  dying -= childDeaths;
  const moreWorking = Math.min(result.workingAge, dying);
  result.workingAge -= moreWorking;
  dying -= moreWorking;
  result.elderly -= Math.min(result.elderly, dying);

  let leaving = departures;
  const workingLeft = Math.min(result.workingAge, Math.floor(leaving * 0.75));
  result.workingAge -= workingLeft;
  leaving -= workingLeft;
  const childrenLeft = Math.min(result.children, Math.floor(leaving * 0.7));
  result.children -= childrenLeft;
  leaving -= childrenLeft;
  const elderlyLeft = Math.min(result.elderly, leaving);
  result.elderly -= elderlyLeft;
  leaving -= elderlyLeft;
  const moreWorkingLeft = Math.min(result.workingAge, leaving);
  result.workingAge -= moreWorkingLeft;
  leaving -= moreWorkingLeft;
  result.children -= Math.min(result.children, leaving);
  return result;
}

export function processPopulationDay(settlement) {
  const population = settlement.population;
  const natural = naturalChange(population);
  const migration = dailyMigration(population);
  const demographics = applyChange(population.demographics, natural.births, natural.deaths, migration.arrivals, migration.departures);
  population.demographics = demographics;
  population.current = demographics.children + demographics.workingAge + demographics.elderly;
  Object.assign(population.naturalChange, {
    effectiveBirthRate: round6(natural.birth),
    effectiveDeathRate: round6(natural.death),
    birthAccumulator: natural.birthAccumulator,
    deathAccumulator: natural.deathAccumulator,
    birthsLastDay: natural.births,
    deathsLastDay: natural.deaths,
    netLastDay: natural.net,
  });
  Object.assign(population.migration, {
    outflowPressure: migration.outflowPressure,
    inflowAttractiveness: migration.inflowAttractiveness,
    pendingOutflow: migration.outflowRemainder,
    pendingInflow: migration.inflowRemainder,
    arrivalsLastDay: migration.arrivals,
    departuresLastDay: migration.departures,
  });
  // The people who can work have changed, so the labor figures must follow in the same day.
  recalculateLabor(settlement);
}

export function demographyStep(draft) {
  for (const id of sortedSettlementIds(draft)) processPopulationDay(draft.world.settlements[id]);
}
