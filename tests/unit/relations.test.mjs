import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createStore } from '../../src/core/store.js';
import { newCharacter, newGameState } from '../../src/game/new-game.js';
import { validateState } from '../../src/persist/schema.js';
import {
  applyRelationshipDelta, checkRelations, getRelationship, listRelationshipsFrom, listRelationshipsTo,
  relationEffectKey, relationId, RELATION_VALUE_KEYS,
} from '../../src/domains/relations/index.js';

const CHARACTERS = ['ann', 'bo', 'cy', 'Dee_4'];

// A store holding the new-game state plus a few extra characters, validated by every registered check.
function makeStore() {
  const state = newGameState({ seed: 11 });
  for (const id of CHARACTERS) state.world.characters[id] = newCharacter({ id, name: id });
  return createStore(state, { validate: validateState });
}

const effect = (overrides = {}) => ({
  fromCharacterId: 'ann', toCharacterId: 'bo', reasonId: 'gift', sourceEventId: 'event_1', eventDay: 3, deltas: { trust: 10 }, ...overrides,
});

const apply = (store, input) => store.transact('relation', (draft) => applyRelationshipDelta(draft, input));

// The index worked out here from the records alone, so the test does not rely on the code under test.
function expectedIndexes(records) {
  const indexes = { from: {}, to: {} };
  for (const id of Object.keys(records).sort()) {
    (indexes.from[records[id].fromCharacterId] ??= []).push(id);
    (indexes.to[records[id].toCharacterId] ??= []).push(id);
  }
  return indexes;
}

function assertConsistent(store) {
  const root = store.getState().world.relationships;
  assert.deepEqual(root.indexes, expectedIndexes(root.records));
  assert.equal(checkRelations(store.getState()).ok, true);
  assert.equal(validateState(store.getState()).ok, true);
}

test('[relations.apply.creates-record-and-indexes] the first effect creates one directed record listed under both characters', () => {
  const store = makeStore();
  const rngBefore = store.getState().rng;
  const result = apply(store, effect());
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.idempotent, false);
  const state = store.getState();
  const record = getRelationship(state, 'ann', 'bo');
  assert.equal(record.id, relationId('ann', 'bo'));
  assert.deepEqual(record.values, { affection: 0, trust: 10, respect: 0, fear: 0, obligation: 0, rivalry: 0 });
  assert.deepEqual(record.tags, []);
  assert.equal(record.revision, 0);
  assert.equal(record.lastInteractionDay, 3);
  assert.equal(record.lastDecayDay, 3);
  assert.equal(getRelationship(state, 'bo', 'ann'), null);
  assert.deepEqual(listRelationshipsFrom(state, 'ann'), [record]);
  assert.deepEqual(listRelationshipsTo(state, 'bo'), [record]);
  assert.deepEqual(listRelationshipsFrom(state, 'bo'), []);
  assert.deepEqual(state.rng, rngBefore, 'relationship rules draw no random numbers');
  assertConsistent(store);
});

test('[relations.apply.accumulates-and-clamps] later effects add to the values, which stay within -1000..1000', () => {
  const store = makeStore();
  apply(store, effect({ sourceEventId: 'e1', deltas: { trust: 600, fear: -400 } }));
  // Tags are set by other rules later; applying an effect must keep them.
  store.transact('tag', (draft) => { Object.values(draft.world.relationships.records)[0].tags = ['friend', 'rival']; });
  apply(store, effect({ sourceEventId: 'e2', eventDay: 5, deltas: { trust: 600, fear: -900, rivalry: 7 } }));
  const record = getRelationship(store.getState(), 'ann', 'bo');
  assert.deepEqual(record.values, { affection: 0, trust: 1000, respect: 0, fear: -1000, obligation: 0, rivalry: 7 });
  assert.equal(record.revision, 1);
  assert.deepEqual(record.tags, ['friend', 'rival']);
  assert.equal(record.lastInteractionDay, 5);
  assert.equal(record.lastDecayDay, 3, 'the decay day stays at the day the record was made');
  assert.equal(store.getState().world.relationships.revision, 2);
  assertConsistent(store);
});

test('[relations.apply.directed-and-sorted-indexes] a pair is directed and the indexes list ids in sorted order', () => {
  const store = makeStore();
  const pairs = [['ann', 'bo'], ['ann', 'cy'], ['bo', 'ann'], ['cy', 'bo'], ['Dee_4', 'bo'], ['ann', 'Dee_4']];
  pairs.forEach(([from, to], index) => apply(store, effect({ fromCharacterId: from, toCharacterId: to, sourceEventId: `e${index}`, deltas: { respect: 1 } })));
  const state = store.getState();
  assert.equal(Object.keys(state.world.relationships.records).length, pairs.length);
  assert.equal(listRelationshipsFrom(state, 'ann').length, 3);
  assert.equal(listRelationshipsTo(state, 'bo').length, 3);
  const ids = state.world.relationships.indexes.from.ann;
  assert.deepEqual(ids, [...ids].sort());
  assert.deepEqual(listRelationshipsTo(state, 'ann').map((r) => r.fromCharacterId), ['bo']);
  assertConsistent(store);
});

test('[relations.apply.sparse-zero-pairs] a pair that sums to zero gets no record, but an existing record is kept', () => {
  const store = makeStore();
  const zero = apply(store, effect({ deltas: {} }));
  assert.equal(zero.ok, true);
  assert.equal(zero.relationId, null);
  assert.equal(zero.created, false);
  assert.deepEqual(store.getState().world.relationships.records, {});
  const key = relationEffectKey(effect());
  assert.equal(store.getState().world.relationships.appliedEffects[key].relationId, null);
  apply(store, effect({ sourceEventId: 'e2', deltas: { trust: 5 } }));
  apply(store, effect({ sourceEventId: 'e3', deltas: { trust: -5 } }));
  const record = getRelationship(store.getState(), 'ann', 'bo');
  assert.deepEqual(Object.values(record.values), RELATION_VALUE_KEYS.map(() => 0));
  assertConsistent(store);
});

test('[relations.apply.replay-is-a-noop] the same effect delivered twice changes nothing; a different input under the same key is refused', () => {
  const store = makeStore();
  apply(store, effect());
  const before = store.getState();
  const replay = apply(store, effect());
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);
  assert.deepEqual(store.getState().world.relationships, before.world.relationships);
  const conflict = apply(store, effect({ deltas: { trust: 11 } }));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, 'relations_effect_conflict');
  assert.deepEqual(store.getState().world, before.world);
  assert.equal(store.getState().revision, before.revision + 1, 'only the replay (a successful no-op) raised the revision');
  // Same event for another pair or reason is a different effect.
  assert.equal(apply(store, effect({ reasonId: 'other_reason', deltas: { trust: 1 } })).ok, true);
  assert.equal(getRelationship(store.getState(), 'ann', 'bo').values.trust, 11);
  assertConsistent(store);
});

test('[relations.apply.bad-input-changes-nothing] invalid effects are refused and leave the whole state as it was', () => {
  const store = makeStore();
  apply(store, effect({ sourceEventId: 'seed_effect' }));
  const cases = [
    ['not an object', null, 'relations_invalid_input'],
    ['array', [], 'relations_invalid_input'],
    ['bad from id', effect({ fromCharacterId: 'no spaces' }), 'relations_invalid_input'],
    ['missing reason', effect({ reasonId: undefined }), 'relations_invalid_input'],
    ['negative day', effect({ eventDay: -1 }), 'relations_invalid_input'],
    ['fractional day', effect({ eventDay: 1.5 }), 'relations_invalid_input'],
    ['deltas not an object', effect({ deltas: [] }), 'relations_invalid_input'],
    ['self reference', effect({ toCharacterId: 'ann' }), 'relations_self_reference'],
    ['unknown character', effect({ toCharacterId: 'nobody' }), 'relations_missing_character'],
    ['unknown delta key', effect({ deltas: { charm: 1 } }), 'relations_invalid_delta'],
    ['fractional delta', effect({ deltas: { trust: 0.5 } }), 'relations_invalid_delta'],
    ['string delta', effect({ deltas: { trust: '5' } }), 'relations_invalid_delta'],
    ['infinite delta', effect({ deltas: { trust: Infinity } }), 'relations_invalid_delta'],
  ];
  for (const [label, input, code] of cases) {
    const before = store.getState();
    const result = apply(store, input);
    assert.equal(result.ok, false, label);
    assert.equal(result.error, code, label);
    assert.equal(store.getState(), before, `${label}: state object untouched`);
    // The rule itself must not touch the draft before it refuses, whatever the store would discard.
    const draft = JSON.parse(JSON.stringify(before));
    assert.equal(applyRelationshipDelta(draft, input).ok, false, label);
    assert.deepEqual(draft, JSON.parse(JSON.stringify(before)), `${label}: draft untouched`);
  }
});

test('[relations.ids.match-earlier-version] ids are the earlier version\'s sha256 digests and capitalised character ids still work', () => {
  const sha = (text) => createHash('sha256').update(text).digest('hex');
  assert.equal(relationId('ann', 'bo'), `relation:${sha('["ann","bo"]')}`);
  assert.equal(
    relationEffectKey({ sourceEventId: 'event_1', fromCharacterId: 'ann', toCharacterId: 'bo', reasonId: 'gift' }),
    `relation_effect:${sha('["event_1","ann","bo","gift"]')}`,
  );
  const store = makeStore();
  assert.equal(apply(store, effect({ fromCharacterId: 'Dee_4', sourceEventId: 'Event_Upper' })).ok, true);
  assert.ok(getRelationship(store.getState(), 'Dee_4', 'bo'));
  const stored = store.getState().world.relationships.appliedEffects;
  const [key] = Object.keys(stored);
  assert.match(key, /^relation_effect:[0-9a-f]{64}$/);
  assert.match(stored[key].inputDigest, /^sha256:[0-9a-f]{64}$/);
  assertConsistent(store);
});

test('[relations.check.detects-corruption] the area check rejects index, value, tag, id and effect problems', () => {
  const store = makeStore();
  apply(store, effect());
  apply(store, effect({ fromCharacterId: 'cy', sourceEventId: 'e2' }));
  const good = store.getState();
  assert.equal(checkRelations(good).ok, true);
  const broken = (change) => {
    const copy = JSON.parse(JSON.stringify(good));
    change(copy.world.relationships, copy);
    return checkRelations(copy);
  };
  const [idA] = Object.keys(good.world.relationships.records);
  const cases = {
    'index lists a record twice': (root) => root.indexes.from.ann.push(idA),
    'index missing': (root) => { delete root.indexes.to.bo; },
    'index has a stray character': (root) => { root.indexes.from.zed = []; },
    'value above 1000': (root) => { root.records[idA].values.trust = 1001; },
    'value not an integer': (root) => { root.records[idA].values.trust = 1.5; },
    'value key missing': (root) => { delete root.records[idA].values.fear; },
    'extra value key': (root) => { root.records[idA].values.charm = 0; },
    'tags not sorted': (root) => { root.records[idA].tags = ['b', 'a']; },
    'tags repeat': (root) => { root.records[idA].tags = ['a', 'a']; },
    'record id does not match its pair (indexes rebuilt to agree)': (root) => {
      root.records[idA].toCharacterId = 'cy';
      root.indexes = expectedIndexes(root.records);
    },
    'record from a character to itself': (root) => {
      const record = root.records[idA];
      delete root.records[idA];
      Object.assign(record, { toCharacterId: 'ann', id: relationId('ann', 'ann') });
      root.records[record.id] = record;
      root.indexes = expectedIndexes(root.records);
      for (const effect of Object.values(root.appliedEffects)) if (effect.relationId === idA) effect.relationId = record.id;
    },
    'record stored under a wrong key': (root) => { root.records.wrong = root.records[idA]; delete root.records[idA]; },
    'revision negative': (root) => { root.records[idA].revision = -1; },
    'unknown character': (root, state) => { delete state.world.characters.bo; },
    'effect points at a missing record': (root) => { Object.values(root.appliedEffects)[0].relationId = 'relation:missing'; },
    'effect key malformed': (root) => { root.appliedEffects.bad = Object.values(root.appliedEffects)[0]; },
    'effect digest malformed': (root) => { Object.values(root.appliedEffects)[0].inputDigest = 'abc'; },
    'future version': (root) => { root.version = 2; },
    'indexes has extra key': (root) => { root.indexes.extra = {}; },
  };
  for (const [label, change] of Object.entries(cases)) assert.equal(broken(change).ok, false, label);
});

test('[relations.state.consistent-after-every-rule] records, indexes and effects agree after each of many rule calls, failed or not', () => {
  const store = makeStore();
  let seed = 12345;
  const next = (limit) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed % limit;
  };
  const people = ['ann', 'bo', 'cy', 'Dee_4', 'legacy_player_character', 'ghost'];
  for (let step = 0; step < 120; step += 1) {
    const deltas = {};
    deltas[RELATION_VALUE_KEYS[next(6)]] = next(900) - 450;
    const input = effect({
      fromCharacterId: people[next(people.length)],
      toCharacterId: people[next(people.length)],
      sourceEventId: `event_${next(40)}`,
      reasonId: `reason_${next(2)}`,
      eventDay: next(50),
      deltas,
    });
    const before = store.getState();
    const result = apply(store, input);
    if (!result.ok) assert.equal(store.getState(), before, 'a failed rule changed the state');
    assertConsistent(store);
  }
  assert.ok(Object.keys(store.getState().world.relationships.records).length > 5);
});
