import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '../../src/core/data.js';
import { fail, ok } from '../../src/core/result.js';
import { draw } from '../../src/core/rng.js';
import { sha256Hex } from '../../src/core/sha256.js';
import { createStore } from '../../src/core/store.js';
import { newCharacter, newGameState } from '../../src/game/new-game.js';
import { runDueDays } from '../../src/game/daily.js';
import { validateState } from '../../src/persist/schema.js';
import { applyRelationshipDelta, getRelationship } from '../../src/domains/relations/index.js';
import { listMemoriesForOwner } from '../../src/domains/memories/index.js';
import {
  CATCH_UP_DAY_LIMIT, FOLLOWUP_DAILY_BUDGET, normalizeFromEvent, ACTIVITY_DAILY_BUDGET, MAX_RETRY_DELAY_DAYS, checkFollowupDigests, checkFollowups,
  dailySteps, enqueueEvent, enqueueNormalizedFollowup, getFollowup, listDueFollowups, runFollowups,
} from '../../src/domains/followups/index.js';

const DIGEST = `sha256:${'0'.repeat(64)}`;
const SEMANTIC = 'm17.semantic_delta.v1';
const clone = (value) => JSON.parse(JSON.stringify(value));

function makeStore({ day = 1, maxRecords, mutate } = {}) {
  const state = newGameState({ seed: 21 });
  for (const id of ['ann', 'bo', 'cy', 'Dee_4']) state.world.characters[id] = newCharacter({ id, name: id });
  state.calendar.day = day;
  if (maxRecords !== undefined) state.world.m1Followups.maxRecords = maxRecords;
  if (mutate) mutate(state);
  return createStore(state, { validate: validateState });
}

const setDay = (store, day) => store.transact('calendar', (draft) => { draft.calendar.day = day; });
const root = (store) => store.getState().world.m1Followups;
const enqueue = (store, event) => store.transact('enqueue', (draft) => enqueueEvent(draft, event));
const run = (store, day, context = {}) => store.transact('run', (draft) => runFollowups(draft, day, context));

// --- events ---------------------------------------------------------------------------------

const characterRef = (id) => (id ? { type: 'character', id } : null);

function stateEvent(n, eventType, domain, targetId, payloadField, before, after) {
  const payload = {
    semanticDelta: {
      schemaVersion: SEMANTIC, domainId: domain, command: `${domain}.change`, targetRef: { type: domain, id: targetId },
      beforeRevision: 1, afterRevision: 2, changes: [{ before, after }],
    },
  };
  if (payloadField) payload[payloadField] = targetId;
  return { eventId: `tx${n}:0`, eventType, transactionId: `tx${n}`, planDigest: DIGEST, sequence: 0, payload };
}

const titleEvent = (n, from, to, titleId = 'crown') => stateEvent(n, 'title_state_changed', 'title', titleId, 'titleId', { holderRef: characterRef(from) }, { holderRef: characterRef(to) });
const clanEvent = (n, from, to) => stateEvent(n, 'clan_state_changed', 'clan', 'house_a', 'clanId', { headCharacterId: from }, { headCharacterId: to });
const settlementEvent = (n) => stateEvent(n, 'settlement_rights_changed', 'land_right', 'right_1', 'landRightId', {}, {});
const successionEvent = (n, currentDay) => ({
  eventId: `tx${n}:0`, eventType: 'succession_resolved', transactionId: `tx${n}`, planDigest: DIGEST, sequence: 0,
  payload: { cause: 'death', currentDay, decedentCharacterId: 'ann', resultTagIds: [], resolution: {} },
});

// --- hand-made follow-up input (to test the ledger without an event) ------------------------------

function directInput(eventId, effects, day = 1) {
  const delta = {
    schemaVersion: SEMANTIC, domainId: 'event', command: 'test.command', targetRef: { type: 'event', id: eventId },
    beforeRevision: null, afterRevision: null, changes: [],
  };
  const full = effects.map((effect) => ({ sourceEventId: eventId, eventDay: day, ...effect }));
  const ids = new Set();
  for (const effect of full) {
    if (effect.type === 'memory_create') [effect.ownerCharacterId, ...effect.targetCharacterIds].forEach((id) => ids.add(id));
    if (effect.type === 'relationship_delta') [effect.fromCharacterId, effect.toCharacterId].forEach((id) => ids.add(id));
    if (effect.type === 'activity_roles') effect.effects.forEach((item) => ids.add(item.characterId));
  }
  const normalized = {
    schemaVersion: 'm17.followup_input.v1',
    eventDay: day,
    source: {
      eventId, eventType: 'test_event', transactionId: 'tx_test', planDigest: DIGEST, sequence: 0, command: 'test.command',
      targetRef: delta.targetRef, beforeRevision: null, afterRevision: null,
    },
    semanticKind: 'test_event',
    semanticDelta: delta,
    expectedRefs: [...ids].sort().map((id) => ({ type: 'character', id })),
    effects: full,
  };
  return { normalized, digest: `sha256:${sha256Hex(canonicalJson(normalized))}` };
}

const memoryEffect = (overrides = {}) => ({
  type: 'memory_create', ownerCharacterId: 'ann', targetCharacterIds: ['bo'], memoryTypeId: 'life_saved', importance: 500,
  knowledge: 'private', decayPolicyId: 'permanent', payload: {}, ...overrides,
});
const relationEffect = (overrides = {}) => ({
  type: 'relationship_delta', fromCharacterId: 'ann', toCharacterId: 'bo', reasonId: 'test_reason', deltas: { trust: 1 }, ...overrides,
});
const rolesEffect = (characterId = 'ann') => ({
  type: 'activity_roles', effects: [{ characterId, addRoleKeys: ['role:test'], removeRoleKeys: [] }],
});

function enqueueDirect(store, eventId, effects, day = 1) {
  const { normalized, digest } = directInput(eventId, effects, day);
  return store.transact('enqueue direct', (draft) => enqueueNormalizedFollowup(draft, normalized, digest));
}

// A handler for activity_roles (owned by another area) that only records what it was given.
const loggingContext = () => ({
  followups: {
    effectHandlers: {
      activity_roles: {
        touches: ['npcActivityProfiles'],
        apply(draft, effect, day) {
          (draft.legacy.log ??= []).push(`${effect.sourceEventId}@${day}`);
          return ok();
        },
      },
    },
  },
});

const activityHandler = (apply, touches) => ({ followups: { effectHandlers: { activity_roles: { ...(touches ? { touches } : {}), apply } } } });

// Both the store and the rule itself must leave everything as it was when a rule refuses.
function assertRefused(store, code, change, label = code) {
  const before = store.getState();
  const result = store.transact('refused', change);
  assert.equal(result.ok, false, label);
  assert.equal(result.error, code, label);
  assert.equal(store.getState(), before, label);
  const draft = clone(before);
  assert.equal(change(draft).ok, false, label);
  assert.deepEqual(draft, clone(before), `${label}: draft untouched`);
}

function assertValid(store) {
  assert.equal(checkFollowups(store.getState()).ok, true);
  assert.equal(checkFollowupDigests(store.getState()).ok, true);
  assert.equal(validateState(store.getState()).ok, true);
}

// ============================================================================================
// Ledger: enqueue

test('[followups.enqueue.title-event-makes-records] a title change gets an activity and a memory record with the exact effects', () => {
  const store = makeStore();
  const result = enqueue(store, titleEvent(1, 'ann', 'bo'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.recordKeys, ['tx1:0::m17.activity', 'tx1:0::m17.memory']);
  assert.equal(result.idempotent, false);
  const activity = getFollowup(store.getState(), 'tx1:0', 'm17.activity');
  const memory = getFollowup(store.getState(), 'tx1:0', 'm17.memory');
  for (const record of [activity, memory]) {
    assert.equal(record.status, 'pending');
    assert.equal(record.resultCode, null);
    assert.equal(record.attemptCount, 0);
    assert.equal(record.nextAttemptDay, 1);
    assert.equal(record.createdDay, 1);
    assert.equal(record.revision, 0);
    assert.deepEqual(record.normalizedFollowupInput.expectedRefs, [{ type: 'character', id: 'ann' }, { type: 'character', id: 'bo' }]);
    assert.equal(record.inputDigest, `sha256:${sha256Hex(canonicalJson(record.normalizedFollowupInput))}`);
  }
  assert.deepEqual(activity.normalizedFollowupInput.effects[0].effects, [
    { characterId: 'ann', addRoleKeys: [], removeRoleKeys: ['role:title_holder:crown'] },
    { characterId: 'bo', addRoleKeys: ['role:title_holder:crown'], removeRoleKeys: [] },
  ]);
  assert.deepEqual(memory.normalizedFollowupInput.effects.map((e) => [e.ownerCharacterId, e.targetCharacterIds, e.memoryTypeId]), [
    ['ann', ['bo'], 'title_revoked'],
    ['bo', ['ann'], 'title_granted'],
  ]);
  assert.equal(root(store).revision, 2);
  assertValid(store);
});

test('[followups.enqueue.other-event-kinds] each event kind gets the records the earlier version made for it', () => {
  const store = makeStore({ day: 3 });
  assert.deepEqual(enqueue(store, clanEvent(1, null, 'bo')).recordKeys, ['tx1:0::m17.activity']);
  assert.deepEqual(enqueue(store, clanEvent(2, 'bo', 'bo')).recordKeys, ['tx2:0::m17.no_handler']);
  assert.deepEqual(enqueue(store, titleEvent(3, null, 'cy')).recordKeys, ['tx3:0::m17.activity', 'tx3:0::m17.memory']);
  assert.deepEqual(enqueue(store, settlementEvent(4)).recordKeys, ['tx4:0::m17.no_handler']);
  const control = stateEvent(5, 'player_control_changed', 'player_control', 'singleton', null, { currentCharacterId: 'ann' }, { currentCharacterId: 'bo' });
  assert.deepEqual(enqueue(store, control).recordKeys, ['tx5:0::m17.activity']);
  const faction = stateEvent(6, 'faction_state_changed', 'faction', 'league', 'factionId', { rulerCharacterId: 'cy' }, { rulerCharacterId: null });
  assert.deepEqual(enqueue(store, faction).recordKeys, ['tx6:0::m17.activity']);
  const records = root(store).records;
  assert.deepEqual(records['tx1:0::m17.activity'].normalizedFollowupInput.effects[0].effects, [{ characterId: 'bo', addRoleKeys: ['role:clan_head:house_a'], removeRoleKeys: [] }]);
  const faction2 = records['tx6:0::m17.activity'].normalizedFollowupInput.effects[0].effects;
  assert.deepEqual(faction2, [{ characterId: 'cy', addRoleKeys: [], removeRoleKeys: ['role:faction_ruler:league'] }]);
  assert.deepEqual(records['tx5:0::m17.activity'].normalizedFollowupInput.effects[0].effects, [
    { characterId: 'ann', addRoleKeys: [], removeRoleKeys: ['role:player_control:campaign'] },
    { characterId: 'bo', addRoleKeys: ['role:player_control:campaign'], removeRoleKeys: [] },
  ]);
  // A title that did not change hands, or only lost / gained a holder.
  assert.deepEqual(enqueue(store, titleEvent(8, 'ann', 'ann')).recordKeys, ['tx8:0::m17.no_handler']);
  assert.deepEqual(enqueue(store, titleEvent(9, 'ann', null)).recordKeys, ['tx9:0::m17.activity', 'tx9:0::m17.memory']);
  const lost = root(store).records['tx9:0::m17.memory'].normalizedFollowupInput.effects;
  assert.deepEqual(lost.map((e) => [e.ownerCharacterId, e.targetCharacterIds, e.memoryTypeId]), [['ann', [], 'title_revoked']]);
  assert.deepEqual(enqueue(store, titleEvent(10, null, 'bo')).recordKeys, ['tx10:0::m17.activity', 'tx10:0::m17.memory']);
  assert.deepEqual(root(store).records['tx10:0::m17.memory'].normalizedFollowupInput.effects.map((e) => e.memoryTypeId), ['title_granted']);
  // A "no handler" record is born applied: the ledger only shows the event was seen.
  assert.equal(records['tx2:0::m17.no_handler'].status, 'applied');
  assert.equal(records['tx2:0::m17.no_handler'].resultCode, 'no_handler');
  assert.equal(records['tx4:0::m17.no_handler'].nextAttemptDay, 3);
  // A succession carries its own day instead of the calendar's.
  const succession = enqueue(store, successionEvent(7, 9));
  assert.equal(succession.ok, true);
  assert.equal(root(store).records['tx7:0::m17.no_handler'].nextAttemptDay, 9);
  assert.equal(root(store).records['tx7:0::m17.no_handler'].normalizedFollowupInput.semanticDelta.successionPayload.decedentCharacterId, 'ann');
  assertValid(store);
});

test('[followups.enqueue.replay-and-conflict] the same event again is a no-op; the same event with other content quarantines what was not applied', () => {
  const store = makeStore();
  enqueue(store, titleEvent(1, 'ann', 'bo'));
  enqueue(store, settlementEvent(2));
  const before = store.getState();
  const replay = enqueue(store, titleEvent(1, 'ann', 'bo'));
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);
  assert.deepEqual(root(store), before.world.m1Followups);
  assert.equal(enqueue(store, settlementEvent(2)).idempotent, true);

  const changed = enqueue(store, titleEvent(1, 'ann', 'cy'));
  assert.equal(changed.ok, true);
  assert.equal(changed.quarantined, true);
  for (const handler of ['m17.activity', 'm17.memory']) {
    const record = getFollowup(store.getState(), 'tx1:0', handler);
    assert.equal(record.status, 'quarantined');
    assert.equal(record.resultCode, 'immutable_conflict');
    assert.equal(record.revision, 1);
  }
  assert.deepEqual(listDueFollowups(store.getState(), 10), [], 'a quarantined record is never handled');
  assertValid(store);

  // Already quarantined (or applied) records cannot be changed again.
  assertRefused(store, 'followups_header_mismatch', (draft) => enqueueEvent(draft, titleEvent(1, 'ann', 'Dee_4')));
  const settlementAgain = { ...settlementEvent(2), planDigest: `sha256:${'1'.repeat(64)}` };
  assertRefused(store, 'followups_header_mismatch', (draft) => enqueueEvent(draft, settlementAgain));
});

test('[followups.enqueue.bad-header-is-quarantined] an event whose header disagrees with its delta is kept as a quarantined record and never applied', () => {
  const store = makeStore();
  const event = titleEvent(1, 'ann', 'bo');
  event.payload.titleId = 'another_title';
  const result = enqueue(store, event);
  assert.equal(result.ok, true);
  assert.deepEqual(result.recordKeys, ['tx1:0::m17.no_handler']);
  const record = getFollowup(store.getState(), 'tx1:0', 'm17.no_handler');
  assert.equal(record.status, 'quarantined');
  assert.equal(record.lastError, 'followups_header_mismatch');
  assert.deepEqual(record.normalizedFollowupInput.effects, []);
  assert.equal(enqueue(store, event).idempotent, true);
  const rootBefore = clone(root(store));
  const ran = store.transact('run', (draft) => runFollowups(draft, 5, {}));
  assert.equal(ran.ok, true);
  assert.deepEqual(root(store).records, rootBefore.records, 'the daily run leaves a quarantined record alone');
  assert.equal(store.getState().world.memories.revision, 0);
  assertValid(store);
});

test('[followups.enqueue.header-mismatches-are-quarantined] each way an event can disagree with its own delta ends as one quarantined record', () => {
  const store = makeStore();
  const variants = {
    'wrong schema': (e) => { e.payload.semanticDelta.schemaVersion = 'other'; },
    'delta without changes list': (e) => { delete e.payload.semanticDelta.changes; },
    'delta missing': (e) => { delete e.payload.semanticDelta; },
    'wrong domain': (e) => { e.payload.semanticDelta.domainId = 'clan'; },
    'wrong target type': (e) => { e.payload.semanticDelta.targetRef.type = 'clan'; },
    'target differs from payload': (e) => { e.payload.titleId = 'other'; },
    'payload command differs': (e) => { e.payload.command = 'title.other'; },
    'payload before revision differs': (e) => { e.payload.beforeRevision = 7; },
    'payload after revision differs': (e) => { e.payload.afterRevision = 7; },
  };
  let n = 20;
  for (const [label, change] of Object.entries(variants)) {
    n += 1;
    const event = clone(titleEvent(n, 'ann', 'bo'));
    change(event);
    const result = enqueue(store, event);
    assert.deepEqual(result.recordKeys, [`tx${n}:0::m17.no_handler`], label);
    assert.equal(getFollowup(store.getState(), `tx${n}:0`, 'm17.no_handler').status, 'quarantined', label);
  }
  const control = stateEvent(40, 'player_control_changed', 'player_control', 'not_singleton', null, { currentCharacterId: 'ann' }, { currentCharacterId: 'bo' });
  assert.equal(enqueue(store, control).recordKeys[0], 'tx40:0::m17.no_handler');
  assert.equal(getFollowup(store.getState(), 'tx40:0', 'm17.no_handler').status, 'quarantined');
  // A matching payload revision / command is accepted.
  const fine = titleEvent(41, 'ann', 'bo');
  Object.assign(fine.payload, { command: 'title.change', beforeRevision: 1, afterRevision: 2 });
  assert.equal(enqueue(store, fine).recordKeys.length, 2);
  assertValid(store);
});

test('[followups.enqueue.bad-input-changes-nothing] malformed events and follow-up input are refused and leave the ledger as it was', () => {
  const store = makeStore();
  enqueue(store, titleEvent(1, 'ann', 'bo'));
  const event = (change) => { const e = clone(titleEvent(2, 'ann', 'bo')); change(e); return e; };
  const events = [
    ['not an object', null, 'followups_invalid_event'],
    ['no event id', event((e) => { delete e.eventId; }), 'followups_invalid_event'],
    ['bad transaction id', event((e) => { e.transactionId = 'bad id'; }), 'followups_invalid_event'],
    ['negative sequence', event((e) => { e.sequence = -1; }), 'followups_invalid_event'],
    ['payload not an object', event((e) => { e.payload = []; }), 'followups_invalid_event'],
    ['payload not JSON', event((e) => { e.payload.extra = undefined; }), 'followups_invalid_event'],
    ['unsupported event type', event((e) => { e.eventType = 'weather_changed'; }), 'followups_unsupported_event_type'],
    ['succession without a day', { ...successionEvent(3, 4), payload: { cause: 'death' } }, 'followups_invalid_event'],
    ['succession with a bad day', successionEvent(3, -4), 'followups_invalid_event'],
  ];
  for (const [label, input, code] of events) assertRefused(store, code, (draft) => enqueueEvent(draft, input), label);

  const good = directInput('direct_1', [memoryEffect()]);
  const mutated = (change) => { const n = clone(good.normalized); change(n); return { ...good, normalized: n }; };
  const inputs = [
    ['digest does not match', { ...good, digest: DIGEST }, 'followups_digest_mismatch'],
    ['input changed after digest', mutated((n) => { n.effects[0].importance = 1; }), 'followups_digest_mismatch'],
    ['not an object', { normalized: 5, digest: DIGEST }, 'followups_digest_mismatch'],
  ];
  for (const [label, input, code] of inputs) {
    assertRefused(store, code, (draft) => enqueueNormalizedFollowup(draft, input.normalized, input.digest), label);
  }
  const redigest = (change) => {
    const n = clone(good.normalized);
    change(n);
    return { normalized: n, digest: `sha256:${sha256Hex(canonicalJson(n))}` };
  };
  const consistent = [
    ['header: command differs from the delta', redigest((n) => { n.source.command = 'other'; }), 'followups_header_mismatch'],
    ['expected refs wrong', redigest((n) => { n.expectedRefs = []; }), 'followups_header_mismatch'],
    ['effect for another event', redigest((n) => { n.effects[0].sourceEventId = 'elsewhere'; }), 'followups_header_mismatch'],
    ['effect of an unknown type', redigest((n) => { n.effects[0].type = 'teleport'; }), 'followups_invalid_input'],
    ['schema version unknown', redigest((n) => { n.schemaVersion = 'm17.other'; }), 'followups_digest_mismatch'],
    ['plan digest not text', redigest((n) => { n.source.planDigest = 5; }), 'followups_invalid_input'],
    ['sequence negative', redigest((n) => { n.source.sequence = -1; }), 'followups_invalid_input'],
    ['source event id invalid', redigest((n) => { n.source.eventId = 'bad id'; n.effects[0].sourceEventId = 'bad id'; }), 'followups_invalid_input'],
  ];
  for (const [label, input, code] of consistent) {
    assertRefused(store, code, (draft) => enqueueNormalizedFollowup(draft, input.normalized, input.digest), label);
  }
  const typed = [
    ['memory without a target list', directInput('d_mem', [memoryEffect()]), (n) => { delete n.effects[0].targetCharacterIds; }],
    ['memory with an invalid owner', directInput('d_mem2', [memoryEffect()]), (n) => { n.effects[0].ownerCharacterId = 'bad id'; }],
    ['relationship without deltas', directInput('d_rel', [relationEffect()]), (n) => { delete n.effects[0].deltas; }],
    ['relationship without a reason', directInput('d_rel2', [relationEffect()]), (n) => { n.effects[0].reasonId = 'bad id'; }],
    ['roles without a list', directInput('d_roles', [rolesEffect()]), (n) => { n.effects[0].effects = []; n.expectedRefs = []; }],
    ['roles item without role lists', directInput('d_roles2', [rolesEffect()]), (n) => { delete n.effects[0].effects[0].addRoleKeys; }],
    ['roles item with bad character', directInput('d_roles3', [rolesEffect()]), (n) => { n.effects[0].effects[0].characterId = 'bad id'; }],
    ['effect on another day', directInput('d_day', [relationEffect()]), (n) => { n.effects[0].eventDay = 9; }],
    ['mixed effect types', directInput('d_mixed', [relationEffect(), memoryEffect()]), () => {}],
  ];
  for (const [label, base, change] of typed) {
    const n = clone(base.normalized);
    change(n);
    const digest = `sha256:${sha256Hex(canonicalJson(n))}`;
    const code = label === 'mixed effect types' ? 'followups_invalid_input' : 'followups_header_mismatch';
    assertRefused(store, code, (draft) => enqueueNormalizedFollowup(draft, n, digest), label);
  }
  // The handler named by the caller must be the one the effects need.
  assertRefused(store, 'followups_header_mismatch', (draft) => enqueueNormalizedFollowup(draft, good.normalized, good.digest, 'm17.activity'));
  assertRefused(store, 'followups_invalid_input', (draft) => enqueueNormalizedFollowup(draft, good.normalized, good.digest, 'm17.unknown'));
  assert.equal(Object.keys(root(store).records).length, 2);
});

test('[followups.enqueue.same-event-later-day-conflict] conflicting input that names an earlier day still leaves a valid quarantined record', () => {
  const store = makeStore();
  assert.equal(enqueueDirect(store, 'direct_x', [relationEffect()], 5).ok, true);
  const other = directInput('direct_x', [relationEffect({ deltas: { trust: 2 } })], 3);
  const result = store.transact('conflict', (draft) => enqueueNormalizedFollowup(draft, other.normalized, other.digest));
  assert.equal(result.ok, true);
  assert.equal(result.quarantined, true);
  const record = getFollowup(store.getState(), 'direct_x', 'm17.relationship');
  assert.equal(record.status, 'quarantined');
  assert.ok(record.updatedDay >= record.createdDay);
  assertValid(store);
});

test('[followups.events.normalize-direct] normalizeFromEvent refuses handlers an event does not need, wrong headers and bad days', () => {
  const settlement = settlementEvent(1);
  assert.equal(normalizeFromEvent(settlement, 'm17.memory', 1).error, 'followups_invalid_input');
  assert.equal(normalizeFromEvent(titleEvent(2, 'ann', 'ann'), 'm17.memory', 1).error, 'followups_invalid_input');
  assert.equal(normalizeFromEvent(titleEvent(2, 'ann', 'ann'), 'm17.no_handler', 1).ok, true);
  const bad = titleEvent(3, 'ann', 'bo');
  bad.payload.titleId = 'elsewhere';
  assert.equal(normalizeFromEvent(bad, 'm17.activity', 1).error, 'followups_header_mismatch');
  assert.equal(normalizeFromEvent(titleEvent(3, 'ann', 'bo'), 'm17.unknown', 1).error, 'followups_invalid_event');
  assert.equal(normalizeFromEvent(titleEvent(3, 'ann', 'bo'), 'm17.memory', -1).error, 'followups_invalid_event');
  assert.equal(normalizeFromEvent(null, 'm17.memory', 1).error, 'followups_invalid_event');
  const good = normalizeFromEvent(titleEvent(3, 'ann', 'bo'), 'm17.memory', 4);
  assert.equal(good.ok, true);
  assert.equal(good.normalizedFollowupInput.eventDay, 4);
  assert.equal(good.inputDigest, `sha256:${sha256Hex(canonicalJson(good.normalizedFollowupInput))}`);
});

test('[followups.enqueue.capacity-is-enforced] a full ledger refuses new records, all-or-nothing, and still accepts repeats', () => {
  const store = makeStore({ maxRecords: 3 });
  assert.equal(enqueue(store, settlementEvent(1)).ok, true);
  assert.equal(enqueue(store, settlementEvent(2)).ok, true);
  // This event needs two records but only one place is left: neither is written.
  assertRefused(store, 'followups_capacity_exceeded', (draft) => enqueueEvent(draft, titleEvent(3, 'ann', 'bo')));
  assert.equal(Object.keys(root(store).records).length, 2);
  assert.equal(enqueue(store, settlementEvent(4)).ok, true);
  assertRefused(store, 'followups_capacity_exceeded', (draft) => enqueueEvent(draft, settlementEvent(5)));
  assertRefused(store, 'followups_capacity_exceeded', (draft) => enqueueNormalizedFollowup(draft, ...Object.values(directInput('direct_1', [memoryEffect()]))));
  assert.equal(enqueue(store, settlementEvent(1)).idempotent, true);
  // The area check also refuses a ledger that is over its limit.
  const over = clone(store.getState());
  over.world.m1Followups.maxRecords = 2;
  assert.equal(checkFollowups(over).ok, false);
  assertValid(store);
  const big = makeStore();
  assert.equal(root(big).maxRecords, 8192);
});

// ============================================================================================
// Daily run

test('[followups.daily.applies-effects-once] due records apply their effects on the day change and are never applied again', () => {
  const store = makeStore();
  enqueue(store, titleEvent(1, 'ann', 'bo'));
  setDay(store, 2);
  const context = loggingContext();
  const result = runDueDays(store, dailySteps, context);
  assert.equal(result.ok, true);
  assert.deepEqual(result.processed, [1]);
  const state = store.getState();
  const [revoked] = listMemoriesForOwner(state, 'ann');
  const [granted] = listMemoriesForOwner(state, 'bo');
  assert.equal(revoked.memoryTypeId, 'title_revoked');
  assert.deepEqual(revoked.targetCharacterIds, ['bo']);
  assert.equal(granted.memoryTypeId, 'title_granted');
  assert.deepEqual(granted.payload, { titleId: 'crown' });
  assert.equal(granted.importance, 800);
  assert.equal(granted.knowledge, 'public');
  assert.equal(granted.eventDay, 1);
  for (const handler of ['m17.activity', 'm17.memory']) {
    const record = getFollowup(state, 'tx1:0', handler);
    assert.equal(record.status, 'applied');
    assert.equal(record.resultCode, 'applied');
    assert.equal(record.lastError, null);
    assert.equal(record.updatedDay, 1);
    assert.equal(record.revision, 1);
  }
  assert.deepEqual(state.legacy.log, ['tx1:0@1']);
  assert.equal(state.world.m1Followups.orchestration.lastOrchestratedDay, 2);
  assert.equal(state.lastProcessedDay, 1);
  // Ledger revision: 2 records enqueued, then start, 2 records, activity phase, day 1 done, activity phase, day 2 done.
  assert.equal(state.world.m1Followups.revision, 2 + 1 + 2 + 1 + 1 + 1 + 1);
  assertValid(store);

  setDay(store, 5);
  assert.deepEqual(runDueDays(store, dailySteps, context).processed, [2, 3, 4]);
  assert.deepEqual(store.getState().legacy.log, ['tx1:0@1'], 'the activity effect was not applied again');
  assert.equal(listMemoriesForOwner(store.getState(), 'ann')[0].revision, 0);
  assert.equal(store.getState().world.m1Followups.orchestration.lastOrchestratedDay, 5);
  assert.equal(dailySteps[0].name, 'followups.drain');
  assert.equal(dailySteps.length, 1);
});

test('[followups.daily.relationship-handler] a relationship follow-up record changes the relationship and is applied once', () => {
  const store = makeStore();
  assert.equal(enqueueDirect(store, 'direct_rel', [relationEffect({ deltas: { trust: 40, fear: -5 } })]).ok, true);
  assert.equal(getFollowup(store.getState(), 'direct_rel', 'm17.relationship').status, 'pending');
  assert.equal(run(store, 1).ok, true);
  assert.deepEqual(getRelationship(store.getState(), 'ann', 'bo').values, { affection: 0, trust: 40, respect: 0, fear: -5, obligation: 0, rivalry: 0 });
  assert.equal(getFollowup(store.getState(), 'direct_rel', 'm17.relationship').status, 'applied');
  assert.equal(run(store, 9).ok, true);
  assert.equal(getRelationship(store.getState(), 'ann', 'bo').values.trust, 40);
  assertValid(store);
});

test('[followups.daily.failed-record-rolls-back-and-retries] a record whose effect fails changes nothing else, is retried with a growing delay, and applies once fixed', () => {
  const store = makeStore();
  // Two memories; the second names a memory type nobody registered yet.
  enqueueDirect(store, 'direct_mem', [memoryEffect({ memoryTypeId: 'life_saved' }), memoryEffect({ ownerCharacterId: 'cy', memoryTypeId: 'oath_sworn' })]);
  const before = store.getState();
  assert.equal(run(store, 1).ok, true);
  let record = getFollowup(store.getState(), 'direct_mem', 'm17.memory');
  assert.equal(record.status, 'failed');
  assert.equal(record.resultCode, 'handler_failed');
  assert.equal(record.lastError, 'memories_unregistered_type');
  assert.equal(record.attemptCount, 1);
  assert.equal(record.nextAttemptDay, 2);
  assert.deepEqual(store.getState().world.memories, before.world.memories, 'the first memory was taken back');
  assert.deepEqual(store.getState().rng, before.rng);
  assertValid(store);

  assert.equal(run(store, 2).ok, true);
  record = getFollowup(store.getState(), 'direct_mem', 'm17.memory');
  assert.deepEqual([record.attemptCount, record.nextAttemptDay], [2, 4]);
  // Not due on day 3.
  const revisionBefore = root(store).revision;
  assert.equal(run(store, 3).ok, true);
  assert.equal(getFollowup(store.getState(), 'direct_mem', 'm17.memory').attemptCount, 2);
  assert.ok(root(store).revision > revisionBefore, 'the day itself was still recorded');
  assert.equal(run(store, 4).ok, true);
  assert.deepEqual([getFollowup(store.getState(), 'direct_mem', 'm17.memory').attemptCount, getFollowup(store.getState(), 'direct_mem', 'm17.memory').nextAttemptDay], [3, 8]);

  // Once the custom type is approved, the next retry applies both memories exactly once.
  store.transact('approve', (draft) => {
    draft.world.customDefinitions.records['memory_type:oath_sworn'] = { domainId: 'memory_type', definitionId: 'oath_sworn', approvalStatus: 'approved', definitionData: { id: 'oath_sworn' } };
  });
  assert.equal(run(store, 8).ok, true);
  record = getFollowup(store.getState(), 'direct_mem', 'm17.memory');
  assert.equal(record.status, 'applied');
  assert.equal(record.lastError, null);
  assert.equal(record.attemptCount, 3);
  assert.equal(listMemoriesForOwner(store.getState(), 'ann').length, 1);
  assert.equal(listMemoriesForOwner(store.getState(), 'cy').length, 1);
  assertValid(store);
});

test('[followups.daily.retry-delay-is-capped] the delay between retries doubles up to 30 days', () => {
  const store = makeStore();
  enqueueDirect(store, 'direct_cap', [memoryEffect({ memoryTypeId: 'never_registered' })]);
  const delays = [];
  let day = 1;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    assert.equal(run(store, day).ok, true);
    const record = getFollowup(store.getState(), 'direct_cap', 'm17.memory');
    assert.equal(record.attemptCount, attempt);
    delays.push(record.nextAttemptDay - day);
    day = record.nextAttemptDay;
  }
  assert.deepEqual(delays, [1, 2, 4, 8, 16, MAX_RETRY_DELAY_DAYS, MAX_RETRY_DELAY_DAYS, MAX_RETRY_DELAY_DAYS]);
});

test('[followups.daily.failed-effect-restores-touched-areas] when an effect fails or throws, the areas it may touch and the random generator are restored', () => {
  const store = makeStore();
  enqueueDirect(store, 'direct_a', [rolesEffect('ann')]);
  enqueueDirect(store, 'direct_b', [rolesEffect('bo')]);
  enqueueDirect(store, 'direct_c', [rolesEffect('cy')]);
  const before = store.getState();
  const apply = (draft, effect) => {
    const who = effect.effects[0].characterId;
    // Changes a declared area (relationships), draws a random number, then fails in three ways.
    applyRelationshipDelta(draft, { fromCharacterId: 'bo', toCharacterId: 'cy', reasonId: 'why', sourceEventId: `ev_${who}`, eventDay: 1, deltas: { trust: 9 } });
    draw(draft.rng);
    if (who === 'ann') return fail('boom');
    if (who === 'bo') throw new Error('kaboom');
    draft.world.memories.revision += 50; // not declared: only restored when `touches` is left out
    return fail('boom_undeclared');
  };
  assert.equal(run(store, 1, activityHandler(apply, ['relationships'])).ok, true);
  const state = store.getState();
  assert.equal(getFollowup(state, 'direct_a', 'm17.activity').lastError, 'boom');
  assert.equal(getFollowup(state, 'direct_b', 'm17.activity').lastError, 'followups_effect_threw');
  assert.equal(getFollowup(state, 'direct_c', 'm17.activity').lastError, 'boom_undeclared');
  assert.deepEqual(state.world.relationships, before.world.relationships);
  assert.deepEqual(state.rng, before.rng);
  assert.equal(state.world.memories.revision, 50, 'a change outside the declared areas is not undone');

  // Without a declared list every area is restored.
  const store2 = makeStore();
  enqueueDirect(store2, 'direct_c', [rolesEffect('cy')]);
  const before2 = store2.getState();
  assert.equal(run(store2, 1, activityHandler(apply)).ok, true);
  assert.deepEqual(store2.getState().world.memories, before2.world.memories);
  assert.deepEqual(store2.getState().world.relationships, before2.world.relationships);
  assert.deepEqual(store2.getState().rng, before2.rng);
  assert.equal(getFollowup(store2.getState(), 'direct_c', 'm17.activity').status, 'failed');
  assertValid(store2);
});

test('[followups.daily.missing-effect-handler-retries] an effect type nobody handles yet fails the record for a later retry instead of dropping it', () => {
  const store = makeStore();
  enqueueDirect(store, 'direct_roles', [rolesEffect('ann')]);
  assert.equal(run(store, 1).ok, true);
  let record = getFollowup(store.getState(), 'direct_roles', 'm17.activity');
  assert.equal(record.status, 'failed');
  assert.equal(record.lastError, 'followups_no_effect_handler');
  assert.equal(run(store, record.nextAttemptDay, loggingContext()).ok, true);
  record = getFollowup(store.getState(), 'direct_roles', 'm17.activity');
  assert.equal(record.status, 'applied');
  assert.equal(record.attemptCount, 1);
  assert.deepEqual(store.getState().legacy.log, ['direct_roles@2']);
});

test('[followups.daily.invalid-record-is-quarantined] a stored record that fails its checks is quarantined and the day carries on', () => {
  const store = makeStore();
  enqueueDirect(store, 'direct_1_tampered', [memoryEffect({ ownerCharacterId: 'ann' })]);
  enqueueDirect(store, 'direct_2_ghost', [memoryEffect({ ownerCharacterId: 'ghost' })]);
  enqueueDirect(store, 'direct_3_good', [memoryEffect({ ownerCharacterId: 'cy' })]);
  store.transact('tamper', (draft) => { draft.world.m1Followups.records['direct_1_tampered::m17.memory'].inputDigest = DIGEST; });
  assert.equal(checkFollowups(store.getState()).ok, true);
  assert.equal(checkFollowupDigests(store.getState()).error, 'followups_digest_mismatch');
  assert.equal(run(store, 1).ok, true);
  const records = root(store).records;
  assert.equal(records['direct_1_tampered::m17.memory'].status, 'quarantined');
  assert.equal(records['direct_1_tampered::m17.memory'].lastError, 'followups_digest_mismatch');
  assert.equal(records['direct_2_ghost::m17.memory'].status, 'quarantined');
  assert.equal(records['direct_2_ghost::m17.memory'].lastError, 'followups_header_mismatch');
  assert.equal(records['direct_3_good::m17.memory'].status, 'applied');
  assert.deepEqual(listMemoriesForOwner(store.getState(), 'ann'), []);
  assert.equal(listMemoriesForOwner(store.getState(), 'cy').length, 1);
  assert.equal(checkFollowups(store.getState()).ok, true);
});

test('[followups.daily.inconsistent-stored-record-is-quarantined] a stored record whose handler or references no longer match its effects is quarantined', () => {
  const store = makeStore();
  enqueueDirect(store, 'direct_h', [relationEffect()]);
  enqueueDirect(store, 'direct_r', [relationEffect({ fromCharacterId: 'cy' })]);
  store.transact('tamper', (draft) => {
    const records = draft.world.m1Followups.records;
    // Handler no longer fits the effects (re-keyed so the record itself stays well formed).
    const wrongHandler = records['direct_h::m17.relationship'];
    delete records['direct_h::m17.relationship'];
    wrongHandler.handlerId = 'm17.memory';
    records['direct_h::m17.memory'] = wrongHandler;
    // Reference list no longer matches the effects (digest recomputed to match).
    const input = records['direct_r::m17.relationship'].normalizedFollowupInput;
    input.expectedRefs = [{ type: 'character', id: 'ann' }];
    records['direct_r::m17.relationship'].inputDigest = `sha256:${sha256Hex(canonicalJson(input))}`;
  });
  assertValid(store);
  assert.equal(run(store, 1).ok, true);
  for (const key of ['direct_h::m17.memory', 'direct_r::m17.relationship']) {
    assert.equal(root(store).records[key].status, 'quarantined', key);
    assert.equal(root(store).records[key].lastError, 'followups_header_mismatch', key);
  }
  assert.equal(getRelationship(store.getState(), 'ann', 'bo'), null);
  assert.equal(getRelationship(store.getState(), 'cy', 'bo'), null);
});

test('[followups.daily.ledger-tampering-is-refused] an effect that changes the ledger record it belongs to makes the whole run fail', () => {
  const store = makeStore();
  enqueueDirect(store, 'direct_t', [rolesEffect('ann')]);
  const tamper = (draft) => {
    draft.world.m1Followups.records['direct_t::m17.activity'].status = 'applied';
    draft.world.m1Followups.records['direct_t::m17.activity'].resultCode = 'applied';
    return ok();
  };
  // The run fails part-way, so only the store's all-or-nothing rule keeps the state intact here.
  const before = store.getState();
  const result = run(store, 1, activityHandler(tamper));
  assert.equal(result.error, 'followups_invalid_transition');
  assert.equal(store.getState(), before);
});

test('[followups.daily.order-is-by-day-event-handler] records are handled by due day, then event id, then handler, in plain character order', () => {
  const store = makeStore();
  for (const id of ['b1', 'a3', 'A2', 'Z9']) enqueueDirect(store, id, [rolesEffect('ann')]);
  enqueueDirect(store, 'early_late_id', [rolesEffect('ann')], 1);
  enqueueDirect(store, 'a0_but_later_day', [rolesEffect('ann')], 2);
  assert.equal(run(store, 2, loggingContext()).ok, true);
  assert.deepEqual(store.getState().legacy.log.map((entry) => entry.split('@')[0]), ['A2', 'Z9', 'a3', 'b1', 'early_late_id', 'a0_but_later_day']);
  assert.deepEqual(listDueFollowups(store.getState(), 9), []);
});

test('[followups.daily.budget-and-cursor] one day handles at most 64 records, remembers where it stopped, and finishes on the next call', () => {
  const store = makeStore();
  for (let i = 0; i < FOLLOWUP_DAILY_BUDGET + 6; i += 1) {
    enqueueDirect(store, `rel_${String(i).padStart(3, '0')}`, [relationEffect()]);
  }
  const first = run(store, 1);
  assert.equal(first.completedDays, 0);
  assert.equal(first.incomplete, true);
  assert.equal(first.phase, 'followups');
  assert.equal(getRelationship(store.getState(), 'ann', 'bo').values.trust, FOLLOWUP_DAILY_BUDGET);
  const orchestration = root(store).orchestration;
  assert.equal(orchestration.cursorDay, 1);
  assert.equal(orchestration.catchUpTargetDay, 1);
  assert.equal(orchestration.cursorPhase, 'followups');
  assert.equal(orchestration.followupCursorKey, '[1,"rel_063","m17.relationship"]');
  assert.equal(orchestration.lastOrchestratedDay, 0);
  assertValid(store);

  const second = run(store, 1);
  assert.equal(second.incomplete, false);
  assert.equal(second.completedDays, 1);
  assert.equal(getRelationship(store.getState(), 'ann', 'bo').values.trust, FOLLOWUP_DAILY_BUDGET + 6);
  assert.deepEqual(root(store).orchestration, {
    activityProcessedCharacterIds: [], catchUpTargetDay: null, cursorDay: null, cursorPhase: null, followupCursorKey: null, lastOrchestratedDay: 1,
  });
  assertValid(store);

  // Exactly one full budget finishes the day in one call.
  const exact = makeStore();
  for (let i = 0; i < FOLLOWUP_DAILY_BUDGET; i += 1) enqueueDirect(exact, `rel_${String(i).padStart(3, '0')}`, [relationEffect()]);
  const done = run(exact, 1);
  assert.equal(done.incomplete, false);
  assert.equal(root(exact).orchestration.lastOrchestratedDay, 1);
});

test('[followups.daily.cursor-restarts-for-records-behind-it] a record that became due behind the cursor is still handled on that day', () => {
  const store = makeStore();
  for (let i = 0; i < FOLLOWUP_DAILY_BUDGET + 1; i += 1) enqueueDirect(store, `rel_${String(i + 10).padStart(3, '0')}`, [relationEffect()]);
  assert.equal(run(store, 1).incomplete, true);
  // A record whose id sorts before the cursor arrives while the day is unfinished.
  enqueueDirect(store, 'rel_000', [relationEffect({ deltas: { rivalry: 3 } })]);
  const finished = run(store, 1);
  assert.equal(finished.incomplete, false);
  const record = getRelationship(store.getState(), 'ann', 'bo');
  assert.equal(record.values.rivalry, 3);
  assert.equal(record.values.trust, FOLLOWUP_DAILY_BUDGET + 1);
  assert.deepEqual(listDueFollowups(store.getState(), 1), []);
  assertValid(store);
});

test('[followups.daily.catch-up-is-limited-and-resumes] a long gap is worked off 30 days per call, each day at its own date, and can be extended', () => {
  const store = makeStore();
  enqueueDirect(store, 'rel_old', [memoryEffect({ memoryTypeId: 'never_registered' })], 5);
  const first = run(store, 45);
  assert.equal(first.completedDays, CATCH_UP_DAY_LIMIT);
  assert.equal(first.incomplete, true);
  let orchestration = root(store).orchestration;
  assert.deepEqual([orchestration.lastOrchestratedDay, orchestration.cursorDay, orchestration.catchUpTargetDay, orchestration.cursorPhase], [30, 31, 45, 'followups']);
  // The record due on day 5 failed on day 5 (not on the day the call was made for) and was retried at 6, 8, 12, 20 and 36.
  const retried = getFollowup(store.getState(), 'rel_old', 'm17.memory');
  assert.equal(retried.attemptCount, 5);
  assert.equal(retried.updatedDay, 20);
  assert.equal(retried.nextAttemptDay, 36);
  assertValid(store);

  const second = run(store, 50);
  assert.equal(second.completedDays, 20);
  assert.equal(second.incomplete, false);
  orchestration = root(store).orchestration;
  assert.deepEqual([orchestration.lastOrchestratedDay, orchestration.cursorDay, orchestration.catchUpTargetDay], [50, null, null]);
  const last = getFollowup(store.getState(), 'rel_old', 'm17.memory');
  assert.deepEqual([last.attemptCount, last.updatedDay, last.nextAttemptDay], [6, 36, 66]);
  // A day already worked off is not worked again.
  const revision = store.getState().revision;
  assert.equal(run(store, 50).completedDays, 0);
  assert.equal(run(store, 12).completedDays, 0);
  assert.equal(store.getState().world.m1Followups.orchestration.lastOrchestratedDay, 50);
  assert.ok(store.getState().revision > revision);
  assertValid(store);
});

test('[followups.daily.activity-phase-budget] the per-character phase handles each character once per day, 128 at a time', () => {
  const store = makeStore();
  const ids = Array.from({ length: 130 }, (_, i) => `npc_${String(i).padStart(3, '0')}`);
  // The hook always lists everyone: the ledger itself must remember who was done.
  const context = {
    followups: {
      activity: {
        dueCharacterIds: () => ids,
        process(draft, characterId, day) {
          (draft.legacy.activity ??= []).push(`${characterId}@${day}`);
          return ok();
        },
      },
    },
  };
  const first = run(store, 1, context);
  assert.equal(first.incomplete, true);
  assert.equal(first.phase, 'activity');
  assert.equal(store.getState().legacy.activity.length, ACTIVITY_DAILY_BUDGET);
  assert.equal(root(store).orchestration.activityProcessedCharacterIds.length, ACTIVITY_DAILY_BUDGET);
  assert.equal(root(store).orchestration.cursorPhase, 'activity');
  assertValid(store);
  const second = run(store, 1, context);
  assert.equal(second.incomplete, false);
  assert.deepEqual(store.getState().legacy.activity, ids.map((id) => `${id}@1`));
  assert.deepEqual(root(store).orchestration.activityProcessedCharacterIds, []);
  assert.equal(root(store).orchestration.lastOrchestratedDay, 1);
  // Next day everyone is due again.
  assert.equal(run(store, 2, context).incomplete, true);
  assert.equal(store.getState().legacy.activity.length, 130 + ACTIVITY_DAILY_BUDGET);
});

test('[followups.daily.step-failure-keeps-the-day-unprocessed] when the activity phase fails the whole day change is discarded and resumes later', () => {
  const store = makeStore({ day: 2 });
  enqueueDirect(store, 'rel_1', [relationEffect()]);
  let failing = true;
  const context = {
    followups: {
      activity: {
        dueCharacterIds: () => ['npc_1'],
        process: () => (failing ? fail('npc_broken') : ok()),
      },
    },
  };
  const before = store.getState();
  const result = runDueDays(store, dailySteps, context);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'daily_step_failed');
  assert.equal(result.detail.step, 'followups.drain');
  assert.equal(result.detail.cause.error, 'npc_broken');
  assert.deepEqual(result.processed, []);
  assert.equal(store.getState(), before, 'nothing of the day was kept');
  assert.equal(store.getState().lastProcessedDay, 0);
  failing = false;
  assert.deepEqual(runDueDays(store, dailySteps, context).processed, [1]);
  assert.equal(getFollowup(store.getState(), 'rel_1', 'm17.relationship').status, 'applied');
  assertValid(store);
});

test('[followups.daily.bad-input-changes-nothing] a bad day or a bad context is refused and leaves the state as it was', () => {
  const store = makeStore();
  enqueueDirect(store, 'rel_1', [relationEffect()]);
  for (const day of [-1, 1.5, '3', null, undefined]) {
    assertRefused(store, 'followups_invalid_input', (draft) => runFollowups(draft, day, {}), `day ${String(day)}`);
  }
  const contexts = [
    ['followups not an object', { followups: 5 }],
    ['effectHandlers not an object', { followups: { effectHandlers: [] } }],
    ['handler without apply', { followups: { effectHandlers: { activity_roles: {} } } }],
    ['handler touches not names', { followups: { effectHandlers: { activity_roles: { apply: () => ok(), touches: [1] } } } }],
    ['activity without process', { followups: { activity: { dueCharacterIds: () => [] } } }],
    ['activity not an object', { followups: { activity: 'x' } }],
  ];
  for (const [label, context] of contexts) {
    assertRefused(store, 'followups_invalid_context', (draft) => runFollowups(draft, 1, context), label);
  }
  const damaged = clone(store.getState());
  damaged.world.m1Followups.orchestration.cursorDay = 4;
  assert.equal(runFollowups(damaged, 1, {}).error, 'followups_invalid_root');
});

test('[followups.daily.runs-in-the-daily-runner] the daily step is registered once, in the late slot, and works through the game runner', () => {
  assert.equal(dailySteps.length, 1);
  assert.equal(dailySteps[0].order, 900);
  const store = makeStore({ day: 4 });
  const result = runDueDays(store, dailySteps, {});
  assert.deepEqual(result.processed, [1, 2, 3]);
  assert.equal(root(store).orchestration.lastOrchestratedDay, 4);
  assert.equal(store.getState().lastProcessedDay, 3);
  assertValid(store);
});

// ============================================================================================
// Checks

test('[followups.check.detects-corruption] the area check rejects root, cursor and record problems; the digest check finds altered input', () => {
  const store = makeStore();
  enqueue(store, titleEvent(1, 'ann', 'bo'));
  enqueue(store, settlementEvent(2));
  enqueueDirect(store, 'direct_fail', [memoryEffect({ memoryTypeId: 'never_registered' })]);
  run(store, 1);
  enqueue(store, titleEvent(3, 'ann', 'bo'));
  const badHeader = titleEvent(4, 'ann', 'bo');
  badHeader.payload.titleId = 'elsewhere';
  enqueue(store, badHeader);
  const good = store.getState();
  assert.equal(getFollowup(good, 'tx3:0', 'm17.memory').status, 'pending');
  assert.equal(getFollowup(good, 'tx1:0', 'm17.memory').status, 'applied');
  assert.equal(getFollowup(good, 'tx4:0', 'm17.no_handler').status, 'quarantined');
  assert.equal(checkFollowups(good).ok, true);
  assert.equal(checkFollowupDigests(good).ok, true);
  const key = 'direct_fail::m17.memory';
  const cases = {
    'future version': (r) => { r.version = 2; },
    'max records zero': (r) => { r.maxRecords = 0; },
    'more records than allowed': (r) => { r.maxRecords = 1; },
    'cursor day without a target': (r) => { r.orchestration.cursorDay = 3; },
    'cursor past the target': (r) => { Object.assign(r.orchestration, { cursorDay: 5, catchUpTargetDay: 4, cursorPhase: 'followups' }); },
    'unknown phase': (r) => { Object.assign(r.orchestration, { cursorDay: 1, catchUpTargetDay: 1, cursorPhase: 'lunch' }); },
    'cursor key left over while idle': (r) => { r.orchestration.followupCursorKey = '[1,"a","m17.memory"]'; },
    'cursor key not canonical': (r) => { Object.assign(r.orchestration, { cursorDay: 1, catchUpTargetDay: 1, cursorPhase: 'followups', followupCursorKey: '[1, "a", "m17.memory"]' }); },
    'processed ids unsorted': (r) => { Object.assign(r.orchestration, { cursorDay: 1, catchUpTargetDay: 1, cursorPhase: 'activity', activityProcessedCharacterIds: ['b', 'a'] }); },
    'record under a wrong key': (r) => { r.records.other = r.records[key]; delete r.records[key]; },
    'unknown handler': (r) => { r.records[key].handlerId = 'm17.other'; },
    'unknown status': (r) => { r.records[key].status = 'done'; },
    'pending with a result': (r) => { r.records['tx3:0::m17.activity'].resultCode = 'applied'; },
    'applied without a result': (r) => { r.records['tx1:0::m17.memory'].resultCode = null; },
    'quarantined without a result': (r) => { r.records['tx4:0::m17.no_handler'].resultCode = null; },
    'quarantined without an error': (r) => { r.records['tx4:0::m17.no_handler'].lastError = null; },
    'handler schema version': (r) => { r.records[key].handlerSchemaVersion = 2; },
    'sequence negative': (r) => { r.records[key].sequence = -1; r.records[key].normalizedFollowupInput.source.sequence = -1; },
    'plan digest differs from the input': (r) => { r.records[key].planDigest = 'other'; },
    'sequence differs from the input': (r) => { r.records[key].sequence = 5; },
    'empty ledger with no room': (r) => { r.records = {}; r.maxRecords = 0; },
    'cursor day missing while a target is set': (r) => { Object.assign(r.orchestration, { cursorDay: null, catchUpTargetDay: 3, cursorPhase: 'followups' }); },
    'failed without an error': (r) => { r.records[key].lastError = null; },
    'failed without attempts': (r) => { r.records[key].attemptCount = 0; },
    'updated before created': (r) => { r.records[key].updatedDay = 0; },
    'created day differs from the input': (r) => { r.records[key].createdDay = 2; r.records[key].updatedDay = 2; },
    'source differs from the input': (r) => { r.records[key].transactionId = 'other_tx'; },
    'applied no-handler with attempts': (r) => { r.records['tx2:0::m17.no_handler'].attemptCount = 1; },
    'applied no-handler with effects': (r) => { r.records['tx2:0::m17.no_handler'].resultCode = 'applied'; },
    'header out of line with the delta': (r) => { r.records[key].normalizedFollowupInput.source.command = 'other'; },
    'negative revision': (r) => { r.records[key].revision = -1; },
  };
  for (const [label, change] of Object.entries(cases)) {
    const copy = clone(good);
    change(copy.world.m1Followups);
    assert.equal(checkFollowups(copy).ok, false, label);
  }
  const altered = clone(good);
  altered.world.m1Followups.records['tx1:0::m17.memory'].normalizedFollowupInput.effects[0].importance = 1;
  assert.equal(checkFollowups(altered).ok, true, 'the per-transaction check does not recompute digests');
  assert.equal(checkFollowupDigests(altered).error, 'followups_digest_mismatch');
  assert.equal(checkFollowupDigests(good).ok, true);
  // A quarantined record keeps whatever input arrived, so its digest is not held against it.
  const quarantinedAltered = clone(good);
  quarantinedAltered.world.m1Followups.records['tx4:0::m17.no_handler'].normalizedFollowupInput.semanticDelta.changes = [{ extra: 1 }];
  assert.equal(checkFollowupDigests(quarantinedAltered).ok, true);
});

test('[followups.state.consistent-after-every-rule] the ledger stays valid after each of many enqueue and run calls, failed or not', () => {
  const store = makeStore({ maxRecords: 40 });
  let seed = 777;
  const next = (limit) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed % limit;
  };
  const people = ['ann', 'bo', 'cy', 'Dee_4'];
  let day = 1;
  for (let step = 0; step < 150; step += 1) {
    const before = store.getState();
    const choice = next(5);
    let result;
    if (choice === 0) result = enqueue(store, titleEvent(next(12), people[next(4)], people[next(4)], `title_${next(2)}`));
    else if (choice === 1) result = enqueue(store, clanEvent(next(12), people[next(4)], next(3) === 0 ? null : people[next(4)]));
    else if (choice === 2) result = enqueueDirect(store, `direct_${next(20)}`, [memoryEffect({ memoryTypeId: ['life_saved', 'never_registered'][next(2)] })], day);
    else if (choice === 3) result = enqueueDirect(store, `direct_${next(20)}`, [relationEffect({ deltas: { trust: next(3) } })], day);
    else {
      day += next(4);
      result = run(store, day, loggingContext());
    }
    if (!result.ok) assert.equal(store.getState(), before, 'a failed rule changed the state');
    assertValid(store);
  }
  assert.ok(Object.keys(root(store).records).length > 10);
});
