// The construction queue of a settlement: enqueue, cancel, crew size, and the daily progress.
//
// A job raises one building by one level. It is paid for in full when queued, so the money and
// goods are gone from the stock while it waits. Jobs run one at a time, in the order they were
// queued. Each day the active job gets as much work as it has laborers (one unit each); it
// completes when the work is done and it has been worked on for its minimum number of days.
// With no laborers there is no progress at all.
//
// Cancelling gives back everything for a job that has not started and half for one that has, and
// cancels the later levels of the same building that depended on it (each at its own rate).
import { clone } from '../../core/data.js';
import { isId } from '../../core/ids.js';
import { ok, fail } from '../../core/result.js';
import {
  CONSTRUCTION_HISTORY_LIMIT, REFUND_RATE_ACTIVE, REFUND_RATE_QUEUED, WORK_PER_LABORER_PER_DAY,
} from './config.js';
import {
  checkPlacement, constructionCost, constructionDays, getBuilding, workRequired,
} from './buildings.js';
import { constructionLaborAvailable } from './labor.js';
import { getSettlement, round2, round4, sortedSettlementIds } from './records.js';
import { normalizeCost, pay, refund } from './stock.js';

const isOpen = (job) => job.status === 'queued' || job.status === 'active';
const levelOf = (settlement, buildingId) => settlement.buildings[buildingId]?.level ?? 0;

function readIds(input, fields) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return fail('settlements_invalid_input');
  for (const field of fields) {
    if (!isId(input[field])) return fail('settlements_invalid_input', { field });
  }
  return null;
}

// The level the building will have once the jobs already queued for it are done.
export function projectedLevel(settlement, buildingId) {
  let level = levelOf(settlement, buildingId);
  for (const job of settlement.construction.queue) {
    if (job.buildingId !== buildingId || !isOpen(job)) continue;
    if (job.fromLevel !== level || job.targetLevel !== level + 1) break;
    level = job.targetLevel;
  }
  return level;
}

// What queueing the next level of a building would cost and take, without changing anything.
export function previewConstruction(stateOrDraft, input) {
  const bad = readIds(input, ['settlementId', 'buildingId']);
  if (bad) return bad;
  const settlement = getSettlement(stateOrDraft, input.settlementId);
  if (!settlement) return fail('settlements_unknown_settlement', { settlementId: input.settlementId });
  const building = getBuilding(input.buildingId);
  if (!building) return fail('settlements_unknown_building', { buildingId: input.buildingId });
  const fromLevel = projectedLevel(settlement, building.id);
  const targetLevel = fromLevel + 1;
  if (targetLevel > building.maxLevel) return fail('settlements_max_level', { buildingId: building.id, maxLevel: building.maxLevel });
  const placement = checkPlacement(building.id, settlement);
  if (!placement.allowed) return fail('settlements_placement_blocked', { buildingId: building.id, reasons: placement.reasons });
  return ok({
    settlementId: settlement.id,
    buildingId: building.id,
    fromLevel,
    targetLevel,
    cost: constructionCost(building.id, targetLevel),
    requiredWork: workRequired(building.id, targetLevel),
    minimumDays: constructionDays(building.id, targetLevel),
    warnings: placement.warnings,
  });
}

export function enqueueConstruction(draft, input) {
  const plan = previewConstruction(draft, input);
  if (!plan.ok) return plan;
  const settlement = draft.world.settlements[plan.settlementId];
  const paid = pay(settlement, plan.cost);
  if (!paid.ok) return paid;
  const construction = settlement.construction;
  const job = {
    id: `${settlement.id}-construction-${construction.nextJobNumber}`,
    buildingId: plan.buildingId,
    fromLevel: plan.fromLevel,
    targetLevel: plan.targetLevel,
    status: 'queued',
    cost: plan.cost,
    requiredWork: plan.requiredWork,
    progressWork: 0,
    minimumDays: plan.minimumDays,
    workedDays: 0,
    queuedDay: draft.calendar.day,
    startedDay: null,
    finishedDay: null,
  };
  construction.nextJobNumber += 1;
  construction.queue.push(job);
  return ok({ job: clone(job) });
}

// How many laborers to put on construction. The crew actually working each day is this number,
// or fewer when the settlement has fewer laborers free.
export function setConstructionWorkforce(draft, input) {
  const bad = readIds(input, ['settlementId']);
  if (bad) return bad;
  const settlement = getSettlement(draft, input.settlementId);
  if (!settlement) return fail('settlements_unknown_settlement', { settlementId: input.settlementId });
  if (!Number.isSafeInteger(input.workforce) || input.workforce < 0) return fail('settlements_invalid_workforce', { workforce: input.workforce });
  settlement.construction.workforce = input.workforce;
  return ok({ workforce: input.workforce });
}

function archive(settlement, job, status, day) {
  const construction = settlement.construction;
  construction.queue.splice(construction.queue.indexOf(job), 1);
  job.status = status;
  job.finishedDay = day;
  construction.history.push(job);
  if (construction.history.length > CONSTRUCTION_HISTORY_LIMIT) {
    construction.history.splice(0, construction.history.length - CONSTRUCTION_HISTORY_LIMIT);
  }
  if (construction.activeJobId === job.id) construction.activeJobId = null;
}

function addCost(total, part) {
  total.gold = round2(total.gold + part.gold);
  for (const [id, amount] of Object.entries(part.resources)) total.resources[id] = round4((total.resources[id] ?? 0) + amount);
}

// Cancels `job` and then every later level of the same building that is still open, highest level
// first. Returns what was given back in total.
function cancelChain(settlement, job, day) {
  const refunded = { gold: 0, resources: {} };
  const cancelled = [];
  const dependents = settlement.construction.queue
    .filter((other) => other !== job && other.buildingId === job.buildingId && other.fromLevel >= job.targetLevel && isOpen(other))
    .sort((a, b) => b.fromLevel - a.fromLevel);
  const targets = [job, ...dependents];
  // Refuse before changing anything if a stored cost cannot be refunded.
  for (const target of targets) {
    const checked = normalizeCost(target.cost);
    if (!checked.ok) return checked;
  }
  for (const target of targets) {
    const rate = target.status === 'queued' ? REFUND_RATE_QUEUED : REFUND_RATE_ACTIVE;
    const given = refund(settlement, target.cost, rate);
    if (!given.ok) return given;
    addCost(refunded, given.refunded);
    cancelled.push({ jobId: target.id, rate });
    archive(settlement, target, 'cancelled', day);
  }
  return ok({ refunded, cancelled });
}

export function cancelConstruction(draft, input) {
  const bad = readIds(input, ['settlementId', 'jobId']);
  if (bad) return bad;
  const settlement = getSettlement(draft, input.settlementId);
  if (!settlement) return fail('settlements_unknown_settlement', { settlementId: input.settlementId });
  const job = settlement.construction.queue.find((entry) => entry.id === input.jobId && isOpen(entry));
  if (!job) return fail('settlements_job_not_found', { jobId: input.jobId });
  return cancelChain(settlement, job, draft.calendar.day);
}

// Starts the first queued job when none is running. A job whose building is not at the level it
// was queued from (the level changed some other way) cannot be built: it is cancelled with its
// dependents and the next one is tried.
function activateNext(settlement, day) {
  const construction = settlement.construction;
  while (construction.activeJobId === null) {
    const candidate = construction.queue.find((job) => job.status === 'queued');
    if (!candidate) return ok();
    if (levelOf(settlement, candidate.buildingId) !== candidate.fromLevel) {
      const cancelled = cancelChain(settlement, candidate, day);
      if (!cancelled.ok) return cancelled;
      continue;
    }
    candidate.status = 'active';
    candidate.startedDay = day;
    construction.activeJobId = candidate.id;
  }
  return ok();
}

function completeJob(settlement, job, day) {
  if (levelOf(settlement, job.buildingId) !== job.fromLevel) return cancelChain(settlement, job, day);
  const current = settlement.buildings[job.buildingId];
  settlement.buildings[job.buildingId] = current
    ? { ...current, level: job.targetLevel }
    : { level: job.targetLevel, enabled: true, condition: 1 };
  job.progressWork = job.requiredWork;
  archive(settlement, job, 'completed', day);
  return ok();
}

export function processConstructionDay(settlement, day) {
  const construction = settlement.construction;
  const started = activateNext(settlement, day);
  if (!started.ok) return started;
  const active = construction.queue.find((job) => job.id === construction.activeJobId);
  if (!active) {
    construction.assigned = 0;
    return ok();
  }
  construction.assigned = Math.min(construction.workforce, constructionLaborAvailable(settlement));
  if (construction.assigned > 0) {
    active.progressWork = Math.min(active.requiredWork, round4(active.progressWork + construction.assigned * WORK_PER_LABORER_PER_DAY));
    active.workedDays += 1;
  }
  if (active.progressWork >= active.requiredWork && active.workedDays >= active.minimumDays) return completeJob(settlement, active, day);
  return ok();
}

export function constructionStep(draft, day) {
  for (const id of sortedSettlementIds(draft)) {
    const result = processConstructionDay(draft.world.settlements[id], day);
    if (!result.ok) return result;
  }
  return ok();
}
