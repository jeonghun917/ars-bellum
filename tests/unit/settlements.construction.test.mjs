import test from 'node:test';
import assert from 'node:assert/strict';
import { clone } from '../../src/core/data.js';
import { createStore } from '../../src/core/store.js';
import { newGameState } from '../../src/game/new-game.js';
import { runDueDays } from '../../src/game/daily.js';
import { validateState } from '../../src/persist/schema.js';
import * as settlements from '../../src/domains/settlements/index.js';

const {
  cancelConstruction, constructionLaborAvailable, createSettlementsFromWorldData, dailySteps, enqueueConstruction,
  previewConstruction, projectedLevel, setConstructionWorkforce,
} = settlements;
const ID = 'test_village';

function makeStore(edit) {
  const store = createStore(newGameState({ seed: 7 }), { validate: validateState });
  const seeded = store.transact('seed', (draft) => {
    const created = createSettlementsFromWorldData(draft);
    if (!created.ok) return created;
    const settlement = draft.world.settlements[ID];
    settlement.money.treasury = 1000;
    Object.assign(settlement.inventory, { timber: 100, planks: 50, clay: 50 });
    if (edit) edit(settlement);
    return created;
  });
  assert.equal(seeded.ok, true);
  return store;
}

const village = (store) => store.getState().world.settlements[ID];
const queue = (store, buildingId = 'farm') => store.transact('queue', (draft) => enqueueConstruction(draft, { settlementId: ID, buildingId }));
const crew = (store, workforce) => store.transact('crew', (draft) => setConstructionWorkforce(draft, { settlementId: ID, workforce }));

// Runs `count` more days: the calendar moves forward and every ended day is processed.
function passDays(store, count) {
  assert.equal(store.transact('time', (draft) => { draft.calendar.day += count; }).ok, true);
  const result = runDueDays(store, dailySteps);
  assert.equal(result.ok, true, JSON.stringify(result));
}

function assertRefused(store, rule, error) {
  const draft = clone(store.getState());
  const before = clone(draft);
  const direct = rule(draft);
  assert.equal(direct.ok, false);
  assert.equal(direct.error, error);
  assert.deepEqual(draft, before);
  const stateBefore = store.getState();
  assert.equal(store.transact('refused', rule).error, error);
  assert.equal(store.getState(), stateBefore);
}

test('[settlements.construction.enqueue-pays] queueing a building pays its cost at once and records the job', () => {
  const store = makeStore();
  const result = queue(store);
  assert.equal(result.ok, true);
  assert.deepEqual(result.job, {
    id: 'test_village-construction-1', buildingId: 'farm', fromLevel: 0, targetLevel: 1, status: 'queued',
    cost: { gold: 60, resources: { timber: 12 } }, requiredWork: 150, progressWork: 0, minimumDays: 12, workedDays: 0,
    queuedDay: 1, startedDay: null, finishedDay: null,
  });
  assert.equal(village(store).money.treasury, 940);
  assert.equal(village(store).inventory.timber, 88);
  assert.equal(village(store).construction.queue.length, 1);
  assert.equal(village(store).construction.nextJobNumber, 2);
  assert.deepEqual(village(store).buildings, {});
});

test('[settlements.construction.enqueue-refused] a job that cannot be queued changes nothing and pays nothing', () => {
  const store = makeStore((settlement) => { settlement.money.treasury = 50; });
  const enqueue = (input) => (draft) => enqueueConstruction(draft, input);
  assertRefused(store, enqueue({ settlementId: ID, buildingId: 'farm' }), 'settlements_insufficient_cost');
  assertRefused(store, enqueue({ settlementId: ID, buildingId: 'castle_of_cheese' }), 'settlements_unknown_building');
  assertRefused(store, enqueue({ settlementId: 'nowhere', buildingId: 'farm' }), 'settlements_unknown_settlement');
  assertRefused(store, enqueue({ settlementId: ID }), 'settlements_invalid_input');
  assertRefused(store, enqueue(null), 'settlements_invalid_input');
  assertRefused(store, enqueue({ settlementId: ID, buildingId: 'fishery' }), 'settlements_placement_blocked');
  assertRefused(store, enqueue({ settlementId: ID, buildingId: 'iron_mine' }), 'settlements_placement_blocked');
  assert.equal(previewConstruction(store.getState(), { settlementId: ID, buildingId: 'fishery' }).detail.reasons[0], 'needs_tag:river|coast|lake|port');

  const topped = makeStore((settlement) => { settlement.buildings.farm = { level: 5, enabled: true, condition: 1 }; });
  assertRefused(topped, enqueue({ settlementId: ID, buildingId: 'farm' }), 'settlements_max_level');
});

test('[settlements.construction.chain-levels] queued levels of one building follow each other and cost more each time', () => {
  const store = makeStore();
  assert.equal(queue(store).ok, true);
  const second = queue(store);
  const third = queue(store);
  assert.deepEqual([second.job.fromLevel, second.job.targetLevel], [1, 2]);
  assert.deepEqual([third.job.fromLevel, third.job.targetLevel], [2, 3]);
  assert.deepEqual(second.job.cost, { gold: 78, resources: { timber: 15.6 } });
  assert.equal(second.job.requiredWork, 188);
  assert.equal(second.job.minimumDays, 15);
  assert.equal(projectedLevel(village(store), 'farm'), 3);
  assert.equal(village(store).money.treasury, 1000 - 60 - 78 - 102);
});

test('[settlements.construction.cancel-refund] a job that has not started gets everything back, a started one half', () => {
  const store = makeStore();
  const queued = queue(store).job;
  const afterQueue = village(store);
  assert.equal(store.transact('cancel', (draft) => cancelConstruction(draft, { settlementId: ID, jobId: queued.id })).ok, true);
  assert.equal(village(store).money.treasury, 1000);
  assert.equal(village(store).inventory.timber, 100);
  assert.equal(village(store).construction.queue.length, 0);
  assert.equal(village(store).construction.history[0].status, 'cancelled');
  assert.notEqual(afterQueue.money.treasury, village(store).money.treasury);

  const second = queue(store).job;
  passDays(store, 1);
  assert.equal(village(store).construction.activeJobId, second.id);
  const goldBefore = village(store).money.treasury;
  const result = store.transact('cancel', (draft) => cancelConstruction(draft, { settlementId: ID, jobId: second.id }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.refunded, { gold: 30, resources: { timber: 6 } });
  assert.deepEqual(result.cancelled, [{ jobId: second.id, rate: 0.5 }]);
  assert.equal(village(store).money.treasury, goldBefore + 30);
  assert.equal(village(store).inventory.timber, 88 + 6);
  assert.equal(village(store).construction.activeJobId, null);
});

test('[settlements.construction.cancel-cascade] cancelling a level also cancels the later levels of that building', () => {
  const store = makeStore();
  const first = queue(store).job;
  const second = queue(store).job;
  const third = queue(store).job;
  const other = queue(store, 'lumber_camp').job;
  passDays(store, 1);
  assert.equal(village(store).construction.activeJobId, first.id);
  const goldBefore = village(store).money.treasury;
  const timberBefore = village(store).inventory.timber;

  const result = store.transact('cancel', (draft) => cancelConstruction(draft, { settlementId: ID, jobId: first.id }));
  assert.deepEqual(result.cancelled, [
    { jobId: first.id, rate: 0.5 },
    { jobId: third.id, rate: 1 },
    { jobId: second.id, rate: 1 },
  ]);
  assert.deepEqual(result.refunded, { gold: 30 + 102 + 78, resources: { timber: 6 + 20.28 + 15.6 } });
  assert.equal(village(store).money.treasury, Math.round((goldBefore + 30 + 102 + 78) * 100) / 100);
  assert.equal(village(store).inventory.timber, Math.round((timberBefore + 6 + 20.28 + 15.6) * 10000) / 10000);
  assert.deepEqual(village(store).construction.queue.map((job) => job.id), [other.id]);
  assert.equal(village(store).construction.history.length, 3);
  assert.equal(projectedLevel(village(store), 'farm'), 0);

  const lone = makeStore();
  const a = queue(lone).job;
  const b = queue(lone).job;
  const c = queue(lone).job;
  assert.deepEqual(lone.transact('cancel', (draft) => cancelConstruction(draft, { settlementId: ID, jobId: b.id })).cancelled.map((entry) => entry.jobId), [b.id, c.id]);
  assert.deepEqual(village(lone).construction.queue.map((job) => job.id), [a.id]);
});

test('[settlements.construction.cancel-refused] only a job that is waiting or running can be cancelled', () => {
  const store = makeStore();
  const job = queue(store).job;
  const cancel = (jobId) => (draft) => cancelConstruction(draft, { settlementId: ID, jobId });
  assertRefused(store, cancel('test_village-construction-9'), 'settlements_job_not_found');
  assertRefused(store, cancel('Not An Id'), 'settlements_invalid_input');
  assertRefused(store, (draft) => cancelConstruction(draft, { settlementId: 'nowhere', jobId: job.id }), 'settlements_unknown_settlement');
  assert.equal(store.transact('cancel', cancel(job.id)).ok, true);
  assertRefused(store, cancel(job.id), 'settlements_job_not_found');
  assert.equal(village(store).money.treasury, 1000);
});

test('[settlements.construction.workforce-input] the crew size must be a whole number of at least zero', () => {
  const store = makeStore();
  const set = (workforce) => (draft) => setConstructionWorkforce(draft, { settlementId: ID, workforce });
  assertRefused(store, set(-1), 'settlements_invalid_workforce');
  assertRefused(store, set(2.5), 'settlements_invalid_workforce');
  assertRefused(store, set('10'), 'settlements_invalid_workforce');
  assertRefused(store, (draft) => setConstructionWorkforce(draft, { settlementId: 'nowhere', workforce: 1 }), 'settlements_unknown_settlement');
  assert.equal(crew(store, 12).ok, true);
  assert.equal(village(store).construction.workforce, 12);
});

test('[settlements.construction.no-labor-no-progress] with nobody assigned a building makes no progress, however long it waits', () => {
  const store = makeStore();
  const job = queue(store).job;
  passDays(store, 40);
  const waiting = village(store).construction.queue[0];
  assert.equal(waiting.id, job.id);
  assert.equal(waiting.status, 'active');
  assert.equal(waiting.progressWork, 0);
  assert.equal(waiting.workedDays, 0);
  assert.equal(village(store).construction.assigned, 0);
  assert.deepEqual(village(store).buildings, {});
  assert.equal(village(store).population.jobSources.construction.laborers, 0);
});

test('[settlements.construction.progress-per-laborer] each laborer adds one unit of work a day, up to the laborers the settlement has free', () => {
  const store = makeStore();
  queue(store);
  crew(store, 10);
  passDays(store, 3);
  assert.equal(village(store).construction.queue[0].progressWork, 30);
  assert.equal(village(store).construction.queue[0].workedDays, 3);
  assert.equal(village(store).population.jobSources.construction.laborers, 10);

  const available = constructionLaborAvailable(village(store));
  assert.ok(available > 10 && available < 200);
  crew(store, 100000);
  passDays(store, 1);
  assert.equal(village(store).construction.assigned, available);
  assert.equal(village(store).construction.queue[0].progressWork, 30 + available);
  assert.ok(village(store).population.labor.employedByType.laborers >= available);
});

test('[settlements.construction.completion-once] a finished job raises the building by exactly one level, once', () => {
  const store = makeStore();
  const job = queue(store).job;
  crew(store, 60);
  passDays(store, 11);
  const running = village(store).construction.queue[0];
  assert.equal(running.progressWork, 150, 'the work is done early');
  assert.equal(running.status, 'active', 'but the building waits for its minimum days');
  assert.deepEqual(village(store).buildings, {});

  passDays(store, 1);
  assert.deepEqual(village(store).buildings, { farm: { level: 1, enabled: true, condition: 1 } });
  assert.equal(village(store).construction.queue.length, 0);
  assert.equal(village(store).construction.activeJobId, null);
  const [done] = village(store).construction.history;
  assert.deepEqual([done.id, done.status, done.startedDay, done.finishedDay, done.progressWork], [job.id, 'completed', 1, 12, 150]);

  passDays(store, 30);
  assert.equal(village(store).buildings.farm.level, 1);
  assert.equal(village(store).construction.history.length, 1);
  assert.equal(village(store).population.labor.jobsByType.peasants - village(store).population.jobSources.baseline.peasants, 12);
});

test('[settlements.construction.levels-in-order] queued levels are built one after another and none is skipped', () => {
  const store = makeStore();
  queue(store);
  queue(store);
  crew(store, 60);
  const seen = [];
  for (let day = 0; day < 40; day += 1) {
    passDays(store, 1);
    const level = village(store).buildings.farm?.level ?? 0;
    if (seen.at(-1) !== level) seen.push(level);
  }
  assert.deepEqual(seen, [0, 1, 2]);
  assert.deepEqual(village(store).construction.history.map((entry) => entry.targetLevel), [1, 2]);
});

test('[settlements.construction.stale-job-cancelled] a job whose building changed level some other way is cancelled and refunded, not built', () => {
  const store = makeStore();
  const job = queue(store).job;
  const second = queue(store).job;
  store.transact('tamper', (draft) => { draft.world.settlements[ID].buildings.farm = { level: 1, enabled: true, condition: 1 }; });
  crew(store, 60);
  passDays(store, 3);
  assert.deepEqual(village(store).construction.queue, []);
  assert.deepEqual(village(store).construction.history.map((entry) => [entry.id, entry.status]), [[job.id, 'cancelled'], [second.id, 'cancelled']]);
  assert.equal(village(store).buildings.farm.level, 1);
  assert.ok(village(store).money.treasury >= 1000, 'the gold paid at queueing came back');
});
