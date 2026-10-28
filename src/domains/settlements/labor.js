// Who can work (supply), what work exists (jobs) and who has a job (employment).
// The formulas are the earlier version's S_Labor.js. Jobs come from several sources that are kept
// apart in population.jobSources: the area owns "baseline", "buildings" and "construction"; any
// other source id (e.g. a later "military") is only summed.
import { BASELINE_JOBS } from './config.js';
import {
  BASELINE_SHARES, LABOR_TYPE_IDS, SUPPLY_WEIGHTS, distributeByWeight, emptyLaborMap, sumLaborMap,
} from './labor-types.js';
import { developmentSnapshot } from './effects.js';
import { round6, sortedSettlementIds } from './records.js';

export const OWNED_JOB_SOURCES = Object.freeze(['baseline', 'buildings', 'construction']);

export function laborSupply(population) {
  const { workingAge } = population.demographics;
  const workforce = Math.min(workingAge, Math.floor(workingAge * population.labor.participationRate));
  return { workforce, supplyByType: distributeByWeight(workforce, SUPPLY_WEIGHTS) };
}

// Jobs a settlement has without any building: a share of its people by type of settlement.
export function baselineJobs(population, settlementType) {
  const result = emptyLaborMap();
  if (population.current === 0) return result;
  const multiplier = BASELINE_JOBS.typeMultipliers[settlementType] ?? BASELINE_JOBS.typeMultipliers.default;
  const total = Math.max(BASELINE_JOBS.minimumJobs, Math.floor((population.current / BASELINE_JOBS.populationDivisor) * multiplier));
  let assigned = 0;
  LABOR_TYPE_IDS.forEach((id, index) => {
    if (index === LABOR_TYPE_IDS.length - 1) {
      result[id] = Math.max(0, total - assigned);
      return;
    }
    result[id] = Math.floor(total * BASELINE_SHARES[id]);
    assigned += result[id];
  });
  return result;
}

// Jobs the buildings offer, whole numbers per type.
export function buildingJobs(settlement) {
  const jobs = developmentSnapshot(settlement.buildings).jobs;
  return Object.fromEntries(LABOR_TYPE_IDS.map((id) => [id, Math.floor(jobs[id])]));
}

export function totalJobs(jobSources) {
  const total = emptyLaborMap();
  for (const source of Object.values(jobSources)) {
    for (const id of LABOR_TYPE_IDS) total[id] += source[id] ?? 0;
  }
  for (const id of LABOR_TYPE_IDS) total[id] = Math.floor(total[id]);
  return total;
}

export function employment(supply, jobs) {
  const employedByType = emptyLaborMap();
  const unemployedByType = emptyLaborMap();
  const vacanciesByType = emptyLaborMap();
  for (const id of LABOR_TYPE_IDS) {
    const workers = supply.supplyByType[id];
    const places = jobs[id];
    employedByType[id] = Math.min(workers, places);
    unemployedByType[id] = workers - employedByType[id];
    vacanciesByType[id] = places - employedByType[id];
  }
  const employed = sumLaborMap(employedByType);
  const unemployed = sumLaborMap(unemployedByType);
  const vacancies = sumLaborMap(vacanciesByType);
  const jobCount = sumLaborMap(jobs);
  return {
    workforce: supply.workforce,
    supplyByType: supply.supplyByType,
    jobsByType: jobs,
    employedByType,
    unemployedByType,
    vacanciesByType,
    employed,
    unemployed,
    unemploymentRate: supply.workforce > 0 ? round6(unemployed / supply.workforce) : 0,
    vacancies,
    vacancyRate: jobCount > 0 ? round6(vacancies / jobCount) : 0,
  };
}

// Laborers who could work on a building today: the laborer supply minus every laborer job that is
// not construction. Construction can use only what is left.
export function constructionLaborAvailable(settlement) {
  const population = settlement.population;
  const supply = laborSupply(population).supplyByType.laborers;
  let taken = baselineJobs(population, settlement.type).laborers + buildingJobs(settlement).laborers;
  for (const [sourceId, source] of Object.entries(population.jobSources)) {
    if (!OWNED_JOB_SOURCES.includes(sourceId)) taken += source.laborers ?? 0;
  }
  return Math.max(0, supply - Math.floor(taken));
}

// Rewrites the jobs the area owns and the employment figures from the current population,
// buildings and construction crew.
export function recalculateLabor(settlement) {
  const population = settlement.population;
  population.jobSources.baseline = baselineJobs(population, settlement.type);
  population.jobSources.buildings = buildingJobs(settlement);
  population.jobSources.construction = { ...emptyLaborMap(), laborers: settlement.construction.assigned };
  const result = employment(laborSupply(population), totalJobs(population.jobSources));
  population.labor = { participationRate: population.labor.participationRate, ...result };
}

export function laborStep(draft) {
  for (const id of sortedSettlementIds(draft)) recalculateLabor(draft.world.settlements[id]);
}
