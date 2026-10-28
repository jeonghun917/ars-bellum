import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/core/store.js';
import { advance, fromMinutes, toMinutes } from '../../src/core/calendar.js';
import { draw, seedFrom } from '../../src/core/rng.js';
import { fail, ok } from '../../src/core/result.js';

const base = () => ({ revision: 0, gold: 100, food: 10 });
const positive = (s) => (s.gold >= 0 && s.food >= 0 ? ok() : fail('negative'));

test('[core.store.all-or-nothing] a failed change leaves every area and the revision untouched', () => {
  const store = createStore(base(), { validate: positive });
  const failed = store.transact('buy', (draft) => { draft.gold -= 50; draft.food += 5; return fail('no_stock'); });
  assert.equal(failed.ok, false);
  assert.deepEqual(store.getState(), base());
  const invalid = store.transact('overspend', (draft) => { draft.gold -= 500; draft.food += 5; });
  assert.equal(invalid.error, 'store_state_invalid');
  assert.deepEqual(store.getState(), base());
  const thrown = store.transact('crash', (draft) => { draft.gold = 1; throw new Error('boom'); });
  assert.equal(thrown.error, 'store_change_threw');
  assert.equal(store.getState().gold, 100);
});

test('[core.store.revision] a successful change applies everything and raises the revision by one', () => {
  const store = createStore(base(), { validate: positive });
  const seen = [];
  store.subscribe((event) => seen.push(event));
  const result = store.transact('buy', (draft) => { draft.gold -= 50; draft.food += 5; });
  assert.equal(result.ok, true);
  assert.deepEqual(store.getState(), { revision: 1, gold: 50, food: 15 });
  assert.deepEqual(seen, [{ label: 'buy', revision: 1 }]);
});

test('[core.store.read-only] state read from the store cannot be changed in place', () => {
  const store = createStore(base());
  assert.throws(() => { 'use strict'; store.getState().gold = 0; });
  assert.equal(store.getState().gold, 100);
});

test('[core.store.json-only] values that cannot be saved as plain JSON are refused', () => {
  const store = createStore(base());
  assert.equal(store.transact('map', (draft) => { draft.extra = new Map(); }).error, 'store_state_not_json');
  assert.equal(store.transact('nan', (draft) => { draft.gold = Number.NaN; }).error, 'store_state_not_json');
  assert.equal(store.transact('nested', () => store.transact('inner', () => {})).error, 'store_nested_transaction');
});

test('[core.calendar.days] advancing time lists every day that ended, in order', () => {
  const start = { day: 1, hour: 23, minute: 30 };
  assert.deepEqual(advance(start, 20), { calendar: { day: 1, hour: 23, minute: 50 }, endedDays: [] });
  assert.deepEqual(advance(start, 30), { calendar: { day: 2, hour: 0, minute: 0 }, endedDays: [1] });
  assert.deepEqual(advance(start, 30 + 1440 * 2 + 5).endedDays, [1, 2, 3]);
  assert.deepEqual(fromMinutes(toMinutes({ day: 7, hour: 13, minute: 59 })), { day: 7, hour: 13, minute: 59 });
  assert.throws(() => advance(start, -1));
});

test('[core.rng.repeatable] the same seed always gives the same numbers', () => {
  const run = () => { const rng = seedFrom(42); return Array.from({ length: 5 }, () => draw(rng)); };
  assert.deepEqual(run(), run());
  const values = run();
  assert.ok(values.every((v) => v >= 0 && v < 1));
  assert.notDeepEqual(values, (() => { const rng = seedFrom(43); return Array.from({ length: 5 }, () => draw(rng)); })());
});
