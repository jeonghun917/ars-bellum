import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/core/store.js';
import { fail, ok } from '../../src/core/result.js';
import { runDueDays } from '../../src/game/daily.js';

const store = (day, lastProcessedDay = 0) => createStore({ revision: 0, calendar: { day, hour: 0, minute: 0 }, lastProcessedDay, log: [] });

test('[game.daily.in-order] each ended day runs once, steps in their order', () => {
  const s = store(4);
  const steps = [
    { order: 20, name: 'b', run: (d, day) => { d.log.push(`b${day}`); } },
    { order: 10, name: 'a', run: (d, day) => { d.log.push(`a${day}`); } },
  ];
  assert.deepEqual(runDueDays(s, steps).processed, [1, 2, 3]);
  assert.deepEqual(s.getState().log, ['a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
  assert.equal(s.getState().lastProcessedDay, 3);
  assert.deepEqual(runDueDays(s, steps).processed, []);
});

test('[game.daily.failure-stops] a failing step leaves that day unprocessed and keeps earlier days', () => {
  const s = store(5);
  const steps = [{ order: 1, name: 'x', run: (d, day) => { d.log.push(day); return day === 3 ? fail('broken') : ok(); } }];
  const result = runDueDays(s, steps);
  assert.equal(result.ok, false);
  assert.deepEqual(result.processed, [1, 2]);
  assert.deepEqual(s.getState().log, [1, 2]);
  assert.equal(s.getState().lastProcessedDay, 2);
});
