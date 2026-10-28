// Record checks for world.settlements. Each check returns the name of the first thing wrong, or
// null. Numbers must be finite and never negative; ids of resources must look like ids but need
// not be known (a save from a newer version may hold resources this one has never heard of).
import { isRecord } from '../../core/data.js';
import { isId } from '../../core/ids.js';
import { ok, fail } from '../../core/result.js';
import { CONSTRUCTION_HISTORY_LIMIT, MAX_PROSPERITY, MAX_TAX_RATE, MAX_WAGE_INDEX, MONEY_ACCOUNTS } from './config.js';
import { SETTLEMENT_TYPES, getBuilding } from './buildings.js';
import { LABOR_TYPE_IDS } from './labor-types.js';
import { REPORT_MAPS, REPORT_NUMBERS } from './records.js';

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isAmount = (value) => isNumber(value) && value >= 0;
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isShare = (value) => isNumber(value) && value >= 0 && value <= 1;
const inRange = (value, low, high) => isNumber(value) && value >= low && value <= high;
const isAmountMap = (map) => isRecord(map) && Object.keys(map).every((id) => isId(id) && isAmount(map[id]));
const isLaborMap = (map) => isRecord(map) && Object.keys(map).every((id) => LABOR_TYPE_IDS.includes(id) && isAmount(map[id]));
const isFullLaborMap = (map) => isLaborMap(map) && LABOR_TYPE_IDS.every((id) => id in map);
const sum = (map) => LABOR_TYPE_IDS.reduce((total, id) => total + map[id], 0);

function costIssue(cost) {
  if (!isRecord(cost) || !isAmount(cost.gold) || !isAmountMap(cost.resources)) return 'cost';
  return null;
}

function jobIssue(job, history) {
  if (!isRecord(job) || !isId(job.id)) return 'job_id';
  const open = ['queued', 'active'];
  const closed = ['completed', 'cancelled'];
  if (!(history ? closed : open).includes(job.status)) return `job_status:${job.id}`;
  const building = getBuilding(job.buildingId);
  if (!building) return `job_building:${job.id}`;
  if (!Number.isInteger(job.fromLevel) || job.fromLevel < 0 || job.targetLevel !== job.fromLevel + 1 || job.targetLevel > building.maxLevel) {
    return `job_levels:${job.id}`;
  }
  if (costIssue(job.cost)) return `job_cost:${job.id}`;
  if (!isNumber(job.requiredWork) || job.requiredWork < 1 || !inRange(job.progressWork, 0, job.requiredWork)) return `job_work:${job.id}`;
  if (!isCount(job.minimumDays) || job.minimumDays < 1 || !isCount(job.workedDays)) return `job_days:${job.id}`;
  if (!isCount(job.queuedDay) || (job.startedDay !== null && !isCount(job.startedDay)) || (job.finishedDay !== null && !isCount(job.finishedDay))) {
    return `job_dates:${job.id}`;
  }
  return null;
}

function constructionIssue(construction) {
  if (!isRecord(construction)) return 'construction';
  if (!Number.isSafeInteger(construction.nextJobNumber) || construction.nextJobNumber < 1) return 'construction_next_job_number';
  if (!isCount(construction.workforce) || !isCount(construction.assigned)) return 'construction_workforce';
  if (!Array.isArray(construction.queue) || !Array.isArray(construction.history)) return 'construction_lists';
  if (construction.history.length > CONSTRUCTION_HISTORY_LIMIT) return 'construction_history_length';
  const ids = new Set();
  let active = null;
  for (const job of construction.queue) {
    const issue = jobIssue(job, false);
    if (issue) return issue;
    if (ids.has(job.id)) return `job_duplicate:${job.id}`;
    ids.add(job.id);
    if (job.status === 'active') {
      if (active) return 'construction_two_active_jobs';
      active = job;
    }
  }
  for (const job of construction.history) {
    const issue = jobIssue(job, true);
    if (issue) return issue;
    if (ids.has(job.id)) return `job_duplicate:${job.id}`;
    ids.add(job.id);
  }
  if ((active ? active.id : null) !== construction.activeJobId) return 'construction_active_job';
  return null;
}

function populationIssue(population) {
  if (!isRecord(population)) return 'population';
  if (!isCount(population.current) || !Number.isSafeInteger(population.baseCapacity) || population.baseCapacity < 1) return 'population_numbers';
  if (!Number.isSafeInteger(population.effectiveCapacity) || population.effectiveCapacity < 1) return 'population_capacity';
  const age = population.demographics;
  if (!isRecord(age) || !isCount(age.children) || !isCount(age.workingAge) || !isCount(age.elderly)) return 'population_demographics';
  if (age.children + age.workingAge + age.elderly !== population.current) return 'population_demographics_total';
  const labor = population.labor;
  if (!isRecord(labor) || !isShare(labor.participationRate) || !isCount(labor.workforce)) return 'population_labor';
  for (const key of ['supplyByType', 'jobsByType', 'employedByType', 'unemployedByType', 'vacanciesByType']) {
    if (!isFullLaborMap(labor[key])) return `population_labor_${key}`;
  }
  if (labor.workforce > age.workingAge || sum(labor.supplyByType) !== labor.workforce) return 'population_labor_workforce';
  if (labor.employed + labor.unemployed !== labor.workforce || sum(labor.employedByType) !== labor.employed) return 'population_labor_employment';
  if (!isShare(labor.unemploymentRate) || !isShare(labor.vacancyRate) || !isCount(labor.vacancies)) return 'population_labor_rates';
  const conditions = population.conditions;
  const keys = ['foodSatisfaction', 'health', 'security', 'prosperity'];
  if (!isRecord(conditions) || !keys.every((key) => isShare(conditions[key]))) return 'population_conditions';
  const overrides = population.conditionOverrides;
  const validOverride = (key) => keys.includes(key) && isShare(overrides[key]);
  if (!isRecord(overrides) || !Object.keys(overrides).every(validOverride)) return 'population_condition_overrides';
  const migration = population.migration;
  if (!isRecord(migration) || !isShare(migration.outflowPressure) || !isShare(migration.inflowAttractiveness)
    || !isAmount(migration.pendingOutflow) || !isAmount(migration.pendingInflow)
    || !isCount(migration.arrivalsLastDay) || !isCount(migration.departuresLastDay)) return 'population_migration';
  const natural = population.naturalChange;
  const rateKeys = ['annualBirthRate', 'annualDeathRate', 'effectiveBirthRate', 'effectiveDeathRate'];
  if (!isRecord(natural) || !rateKeys.every((key) => isShare(natural[key]))) return 'population_natural_change';
  if (!isAmount(natural.birthAccumulator) || !isAmount(natural.deathAccumulator)) return 'population_natural_change';
  if (!isCount(natural.birthsLastDay) || !isCount(natural.deathsLastDay) || !Number.isSafeInteger(natural.netLastDay)) return 'population_natural_change';
  if (!isRecord(population.jobSources) || !Object.values(population.jobSources).every(isLaborMap)) return 'population_job_sources';
  if (!isFullLaborMap(population.jobSources.baseline)) return 'population_job_sources_baseline';
  return null;
}

function economyIssue(economy) {
  if (!isRecord(economy)) return 'economy';
  const indexesValid = inRange(economy.prosperity, 0, MAX_PROSPERITY)
    && inRange(economy.taxRate, 0, MAX_TAX_RATE)
    && inRange(economy.wageIndex, 0, MAX_WAGE_INDEX);
  if (!indexesValid) return 'economy_indexes';
  const report = economy.report;
  if (!isRecord(report) || !isCount(report.day)) return 'economy_report';
  if (!REPORT_NUMBERS.every((key) => isAmount(report[key])) || !REPORT_MAPS.every((key) => isAmountMap(report[key]))) return 'economy_report_values';
  return null;
}

export function settlementIssue(record, id) {
  if (!isRecord(record) || record.id !== id || !isId(id)) return 'id';
  if (!SETTLEMENT_TYPES.includes(record.type)) return 'type';
  if (!Array.isArray(record.tags) || !record.tags.every(isId)) return 'tags';
  if (!isAmountMap(record.inventory)) return 'inventory';
  if (!isRecord(record.money) || !MONEY_ACCOUNTS.every((account) => isAmount(record.money[account]))) return 'money';
  if (!isRecord(record.buildings)) return 'buildings';
  for (const [buildingId, state] of Object.entries(record.buildings)) {
    const building = getBuilding(buildingId);
    if (!building || !isRecord(state) || !Number.isInteger(state.level) || state.level < 1 || state.level > building.maxLevel
      || typeof state.enabled !== 'boolean' || !isShare(state.condition)) return `building:${buildingId}`;
  }
  return economyIssue(record.economy) ?? populationIssue(record.population) ?? constructionIssue(record.construction);
}

export function checkSettlements(state) {
  const settlements = state.world.settlements;
  for (const id of Object.keys(settlements)) {
    const issue = settlementIssue(settlements[id], id);
    if (issue) return fail('settlements_invalid_record', { id, issue });
  }
  return ok();
}
