import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createStore } from '../../src/core/store.js';
import { newCharacter, newGameState } from '../../src/game/new-game.js';
import { validateState } from '../../src/persist/schema.js';
import {
  DEFAULT_MEMORY_TYPE_IDS, checkMemories, createMemory, getMemory, isKnownDecayPolicy, isKnownMemoryType,
  listMemoriesForOwner, memoryId, resolveMemory,
} from '../../src/domains/memories/index.js';

// A custom definition as the definitions area stores it in world.customDefinitions.records.
const customDefinition = (domainId, definitionId, approvalStatus = 'approved') => ({
  [`${domainId}:${definitionId}`]: { domainId, definitionId, approvalStatus, definitionData: { id: definitionId } },
});

function makeStore(customRecords = {}) {
  const state = newGameState({ seed: 5 });
  for (const id of ['ann', 'bo', 'cy', 'Dee_4']) state.world.characters[id] = newCharacter({ id, name: id });
  Object.assign(state.world.customDefinitions.records, customRecords);
  return createStore(state, { validate: validateState });
}

const memory = (overrides = {}) => ({
  ownerCharacterId: 'ann', targetCharacterIds: ['bo'], memoryTypeId: 'life_saved', eventDay: 4, importance: 900,
  knowledge: 'known_to_targets', sourceEventId: 'event_1', payload: { place: 'ford' }, ...overrides,
});

const create = (store, input) => store.transact('create', (draft) => createMemory(draft, input));
const resolve = (store, input) => store.transact('resolve', (draft) => resolveMemory(draft, input));
const resolution = (id, overrides = {}) => ({ memoryId: id, nextStatus: 'resolved', decisionDay: 9, reasonId: 'repaid', sourceEventId: 'event_9', ...overrides });

function expectedOwnerIndex(records) {
  const index = {};
  for (const id of Object.keys(records).sort()) (index[records[id].ownerCharacterId] ??= []).push(id);
  return index;
}

function assertConsistent(store) {
  const root = store.getState().world.memories;
  assert.deepEqual(root.ownerIndex, expectedOwnerIndex(root.records));
  assert.equal(checkMemories(store.getState()).ok, true);
  assert.equal(validateState(store.getState()).ok, true);
}

test('[memories.create.record-and-owner-index] creating a memory stores an unresolved record listed under its owner', () => {
  const store = makeStore();
  const rngBefore = store.getState().rng;
  const result = create(store, memory());
  assert.equal(result.ok, true);
  assert.equal(result.idempotent, false);
  const state = store.getState();
  const record = getMemory(state, result.memoryId);
  assert.equal(result.memoryId, memoryId('ann', 'life_saved', 'event_1'));
  assert.deepEqual(record, {
    id: result.memoryId, ownerCharacterId: 'ann', targetCharacterIds: ['bo'], memoryTypeId: 'life_saved', eventDay: 4, importance: 900,
    knowledge: 'known_to_targets', decayPolicyId: 'permanent', sourceEventId: 'event_1', payload: { place: 'ford' },
    status: 'unresolved', resolution: null, revision: 0,
  });
  assert.deepEqual(state.world.memories.ownerIndex, { ann: [result.memoryId] });
  assert.equal(state.world.memories.revision, 1);
  assert.deepEqual(state.rng, rngBefore, 'memory rules draw no random numbers');
  assert.equal(getMemory(state, 'memory:nothing'), null);
  assertConsistent(store);
});

test('[memories.create.targets-and-ids] targets are de-duplicated and sorted; ids match the earlier version; one memory per owner, type and event', () => {
  const sha = (text) => createHash('sha256').update(text).digest('hex');
  assert.equal(memoryId('ann', 'life_saved', 'event_1'), `memory:${sha('["ann","life_saved","event_1"]')}`);
  const store = makeStore();
  const a = create(store, memory({ targetCharacterIds: ['cy', 'bo', 'cy'] }));
  assert.deepEqual(getMemory(store.getState(), a.memoryId).targetCharacterIds, ['bo', 'cy']);
  const b = create(store, memory({ memoryTypeId: 'major_betrayal' }));
  const c = create(store, memory({ ownerCharacterId: 'Dee_4', targetCharacterIds: [] }));
  const d = create(store, memory({ ownerCharacterId: 'ann', sourceEventId: 'event_2' }));
  assert.equal(new Set([a.memoryId, b.memoryId, c.memoryId, d.memoryId]).size, 4);
  const index = store.getState().world.memories.ownerIndex;
  assert.equal(index.ann.length, 3);
  assert.deepEqual(index.ann, [...index.ann].sort());
  assert.deepEqual(index.Dee_4, [c.memoryId]);
  assertConsistent(store);
});

test('[memories.create.replay-and-conflict] re-delivering an event is a no-op, also after the memory was closed; different content is refused', () => {
  const store = makeStore();
  const first = create(store, memory());
  const before = store.getState();
  const replay = create(store, memory({ targetCharacterIds: ['bo', 'bo'] }));
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);
  assert.deepEqual(store.getState().world.memories, before.world.memories);
  for (const changed of [{ importance: 100 }, { eventDay: 5 }, { knowledge: 'public' }, { targetCharacterIds: ['cy'] }, { payload: { place: 'hill' } }]) {
    const result = create(store, memory(changed));
    assert.equal(result.ok, false, JSON.stringify(changed));
    assert.equal(result.error, 'memories_duplicate_conflict');
    assert.deepEqual(store.getState().world, before.world);
  }
  assert.equal(resolve(store, resolution(first.memoryId)).ok, true);
  const afterClose = create(store, memory());
  assert.equal(afterClose.ok, true);
  assert.equal(afterClose.idempotent, true);
  assert.equal(getMemory(store.getState(), first.memoryId).status, 'resolved');
  assertConsistent(store);
});

test('[memories.create.bad-input-changes-nothing] invalid memories are refused and leave the state as it was', () => {
  const store = makeStore(customDefinition('memory_type', 'pending_type', 'pending'));
  create(store, memory({ sourceEventId: 'seed_event' }));
  const cases = [
    ['not an object', null, 'memories_invalid_input'],
    ['bad owner id', memory({ ownerCharacterId: 'bad id' }), 'memories_invalid_input'],
    ['bad event id', memory({ sourceEventId: '' }), 'memories_invalid_input'],
    ['negative day', memory({ eventDay: -1 }), 'memories_invalid_input'],
    ['importance too high', memory({ importance: 1001 }), 'memories_invalid_input'],
    ['importance fractional', memory({ importance: 5.5 }), 'memories_invalid_input'],
    ['importance negative', memory({ importance: -1 }), 'memories_invalid_input'],
    ['unknown knowledge', memory({ knowledge: 'secret' }), 'memories_invalid_input'],
    ['targets not a list', memory({ targetCharacterIds: 'bo' }), 'memories_invalid_input'],
    ['target id invalid', memory({ targetCharacterIds: ['bo', 'no good'] }), 'memories_invalid_input'],
    ['payload not an object', memory({ payload: [1] }), 'memories_invalid_input'],
    ['payload not JSON', memory({ payload: { when: undefined } }), 'memories_invalid_input'],
    ['payload not finite', memory({ payload: { n: NaN } }), 'memories_invalid_input'],
    ['unknown owner', memory({ ownerCharacterId: 'nobody' }), 'memories_missing_owner'],
    ['unknown target', memory({ targetCharacterIds: ['nobody'] }), 'memories_missing_target'],
    ['unregistered type', memory({ memoryTypeId: 'made_up' }), 'memories_unregistered_type'],
    ['type only proposed', memory({ memoryTypeId: 'pending_type' }), 'memories_unregistered_type'],
    ['unregistered decay policy', memory({ decayPolicyId: 'fades' }), 'memories_unregistered_decay_policy'],
  ];
  for (const [label, input, code] of cases) {
    const before = store.getState();
    const result = create(store, input);
    assert.equal(result.ok, false, label);
    assert.equal(result.error, code, label);
    assert.equal(store.getState(), before, label);
    const draft = JSON.parse(JSON.stringify(before));
    assert.equal(createMemory(draft, input).ok, false, label);
    assert.deepEqual(draft, JSON.parse(JSON.stringify(before)), `${label}: draft untouched`);
  }
});

test('[memories.definitions.approved-custom-only] custom memory types and decay policies count only once approved', () => {
  const store = makeStore({
    ...customDefinition('memory_type', 'oath_sworn'),
    ...customDefinition('memory_type', 'rejected_type', 'rejected'),
    ...customDefinition('memory_decay_policy', 'fades_in_year'),
  });
  const world = store.getState().world;
  assert.equal(isKnownMemoryType(world, 'oath_sworn'), true);
  assert.equal(isKnownMemoryType(world, 'rejected_type'), false);
  assert.equal(isKnownMemoryType(world, 'fades_in_year'), false, 'a decay policy is not a memory type');
  assert.equal(isKnownDecayPolicy(world, 'fades_in_year'), true);
  assert.equal(isKnownDecayPolicy(world, 'permanent'), true);
  assert.equal(isKnownDecayPolicy(world, 'oath_sworn'), false);
  for (const id of DEFAULT_MEMORY_TYPE_IDS) assert.equal(isKnownMemoryType(world, id), true, id);
  assert.equal(create(store, memory({ memoryTypeId: 'oath_sworn', decayPolicyId: 'fades_in_year' })).ok, true);
  assert.equal(create(store, memory({ memoryTypeId: 'rejected_type' })).error, 'memories_unregistered_type');
  assertConsistent(store);
});

test('[memories.resolve.transitions] an open memory closes once; repeating the decision is a no-op, a different one is refused', () => {
  const store = makeStore(customDefinition('memory_decay_policy', 'fades_in_year'));
  const { memoryId: id } = create(store, memory());
  const first = resolve(store, resolution(id, { nextStatus: 'forgiven' }));
  assert.equal(first.ok, true);
  assert.equal(first.idempotent, false);
  const closed = getMemory(store.getState(), id);
  assert.equal(closed.status, 'forgiven');
  assert.deepEqual(closed.resolution, { status: 'forgiven', decisionDay: 9, reasonId: 'repaid', sourceEventId: 'event_9' });
  assert.equal(closed.revision, 1);
  const rootRevision = store.getState().world.memories.revision;
  const again = resolve(store, resolution(id, { nextStatus: 'forgiven' }));
  assert.equal(again.idempotent, true);
  assert.deepEqual(getMemory(store.getState(), id), closed);
  assert.equal(store.getState().world.memories.revision, rootRevision);
  for (const other of [{ nextStatus: 'resolved' }, { nextStatus: 'forgiven', decisionDay: 10 }, { nextStatus: 'forgiven', reasonId: 'other' }]) {
    const before = store.getState();
    const refused = resolve(store, resolution(id, other));
    assert.equal(refused.error, 'memories_invalid_transition');
    assert.deepEqual(store.getState().world, before.world);
  }
  // Only a policy that is not permanent lets a memory expire.
  const mortal = create(store, memory({ sourceEventId: 'event_2', decayPolicyId: 'fades_in_year' }));
  assert.equal(resolve(store, resolution(mortal.memoryId, { nextStatus: 'expired' })).ok, true);
  assert.equal(getMemory(store.getState(), mortal.memoryId).status, 'expired');
  assertConsistent(store);
});

test('[memories.resolve.permanent-never-expires] a permanent memory cannot be expired, even when it is already closed', () => {
  const store = makeStore();
  const { memoryId: id } = create(store, memory());
  const before = store.getState();
  assert.equal(resolve(store, resolution(id, { nextStatus: 'expired' })).error, 'memories_permanent_expiry_forbidden');
  assert.equal(store.getState(), before);
  resolve(store, resolution(id));
  assert.equal(resolve(store, resolution(id, { nextStatus: 'expired' })).error, 'memories_permanent_expiry_forbidden');
  assert.equal(getMemory(store.getState(), id).status, 'resolved');
});

test('[memories.resolve.bad-input-changes-nothing] invalid or unknown resolutions are refused and leave the state as it was', () => {
  const store = makeStore();
  const { memoryId: id } = create(store, memory());
  const cases = [
    ['not an object', null, 'memories_invalid_input'],
    ['bad memory id', resolution('bad id'), 'memories_invalid_input'],
    ['status unresolved', resolution(id, { nextStatus: 'unresolved' }), 'memories_invalid_input'],
    ['status unknown', resolution(id, { nextStatus: 'gone' }), 'memories_invalid_input'],
    ['negative day', resolution(id, { decisionDay: -2 }), 'memories_invalid_input'],
    ['reason missing', resolution(id, { reasonId: undefined }), 'memories_invalid_input'],
    ['event bad', resolution(id, { sourceEventId: 'no good' }), 'memories_invalid_input'],
    ['unknown memory', resolution('memory:none'), 'memories_missing_record'],
  ];
  for (const [label, input, code] of cases) {
    const before = store.getState();
    const result = resolve(store, input);
    assert.equal(result.ok, false, label);
    assert.equal(result.error, code, label);
    assert.equal(store.getState(), before, label);
    const draft = JSON.parse(JSON.stringify(before));
    assert.equal(resolveMemory(draft, input).ok, false, label);
    assert.deepEqual(draft, JSON.parse(JSON.stringify(before)), `${label}: draft untouched`);
  }
});

test('[memories.list.filters] an owner\'s memories can be filtered by status, type and target', () => {
  const store = makeStore();
  const a = create(store, memory({ sourceEventId: 'e1' }));
  const b = create(store, memory({ sourceEventId: 'e2', memoryTypeId: 'major_betrayal', targetCharacterIds: ['cy'] }));
  create(store, memory({ sourceEventId: 'e3', ownerCharacterId: 'bo', targetCharacterIds: [] }));
  resolve(store, resolution(a.memoryId));
  const state = store.getState();
  const ids = (list) => list.map((record) => record.id).sort();
  assert.deepEqual(ids(listMemoriesForOwner(state, 'ann')), [a.memoryId, b.memoryId].sort());
  assert.deepEqual(ids(listMemoriesForOwner(state, 'ann', { status: 'unresolved' })), [b.memoryId]);
  assert.deepEqual(ids(listMemoriesForOwner(state, 'ann', { memoryTypeId: 'life_saved' })), [a.memoryId]);
  assert.deepEqual(ids(listMemoriesForOwner(state, 'ann', { targetCharacterId: 'cy' })), [b.memoryId]);
  assert.deepEqual(listMemoriesForOwner(state, 'nobody'), []);
  assert.equal(listMemoriesForOwner(state, 'bo').length, 1);
});

test('[memories.check.detects-corruption] the area check rejects index, id, target, type and resolution problems', () => {
  const store = makeStore({ ...customDefinition('memory_decay_policy', 'fades_in_year'), ...customDefinition('memory_type', 'oath_sworn') });
  const a = create(store, memory());
  const b = create(store, memory({ sourceEventId: 'event_2', decayPolicyId: 'fades_in_year' }));
  assert.equal(create(store, memory({ sourceEventId: 'event_3', memoryTypeId: 'oath_sworn' })).ok, true);
  resolve(store, resolution(b.memoryId, { nextStatus: 'expired' }));
  const good = store.getState();
  assert.equal(checkMemories(good).ok, true);
  const broken = (change) => {
    const copy = JSON.parse(JSON.stringify(good));
    change(copy.world.memories, copy);
    return checkMemories(copy);
  };
  const cases = {
    'index lists an unknown id': (root) => root.ownerIndex.ann.push('memory:zzz'),
    'index missing': (root) => { delete root.ownerIndex.ann; },
    'index not sorted': (root) => { root.ownerIndex.ann.reverse(); },
    'index wrong owner': (root) => { root.ownerIndex.bo = root.ownerIndex.ann; delete root.ownerIndex.ann; },
    'record under wrong key': (root) => { root.records.other = root.records[a.memoryId]; delete root.records[a.memoryId]; },
    'owner changed so the id no longer matches': (root) => { root.records[a.memoryId].ownerCharacterId = 'bo'; },
    'owner unknown': (root, state) => { delete state.world.characters.ann; },
    'target unknown': (root, state) => { delete state.world.characters.bo; },
    'targets unsorted': (root) => { root.records[a.memoryId].targetCharacterIds = ['cy', 'bo']; },
    'targets repeat': (root) => { root.records[a.memoryId].targetCharacterIds = ['bo', 'bo']; },
    'type no longer registered': (root, state) => { delete state.world.customDefinitions.records['memory_type:oath_sworn']; },
    'decay policy no longer registered': (root, state) => { delete state.world.customDefinitions.records['memory_decay_policy:fades_in_year']; },
    'importance above 1000': (root) => { root.records[a.memoryId].importance = 1001; },
    'unknown knowledge': (root) => { root.records[a.memoryId].knowledge = 'secret'; },
    'unknown status': (root) => { root.records[a.memoryId].status = 'lost'; },
    'unresolved with a resolution': (root) => { root.records[a.memoryId].resolution = { status: 'resolved', decisionDay: 1, reasonId: 'r', sourceEventId: 'e' }; },
    'closed without a resolution': (root) => { root.records[b.memoryId].resolution = null; },
    'resolution status differs': (root) => { root.records[b.memoryId].resolution.status = 'resolved'; },
    'permanent memory expired': (root) => { root.records[a.memoryId].status = 'expired'; root.records[a.memoryId].resolution = { status: 'expired', decisionDay: 1, reasonId: 'r', sourceEventId: 'e' }; },
    'payload not an object': (root) => { root.records[a.memoryId].payload = []; },
    'future version': (root) => { root.version = 2; },
  };
  for (const [label, change] of Object.entries(cases)) assert.equal(broken(change).ok, false, label);
});

test('[memories.state.consistent-after-every-rule] records and owner index agree after each of many rule calls, failed or not', () => {
  const store = makeStore();
  let seed = 4242;
  const next = (limit) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed % limit;
  };
  const owners = ['ann', 'bo', 'cy', 'Dee_4', 'ghost'];
  const types = ['life_saved', 'major_betrayal', 'debt_forgiven', 'unknown_type'];
  const created = [];
  for (let step = 0; step < 120; step += 1) {
    const before = store.getState();
    let result;
    if (created.length > 0 && next(3) === 0) {
      const id = created[next(created.length)];
      result = resolve(store, resolution(id, { nextStatus: ['resolved', 'forgiven', 'expired'][next(3)], decisionDay: next(3) }));
    } else {
      result = create(store, memory({
        ownerCharacterId: owners[next(owners.length)],
        memoryTypeId: types[next(types.length)],
        sourceEventId: `event_${next(15)}`,
        importance: next(1100),
        targetCharacterIds: [owners[next(owners.length)]],
      }));
      if (result.ok) created.push(result.memoryId);
    }
    if (!result.ok) assert.equal(store.getState(), before, 'a failed rule changed the state');
    assertConsistent(store);
  }
  assert.ok(Object.keys(store.getState().world.memories.records).length > 5);
});
