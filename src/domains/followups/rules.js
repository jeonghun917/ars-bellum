// The follow-up ledger and its daily run.
//
// Other areas report game events here (enqueueEvent). Each event becomes ledger records, one per
// handler, holding the exact effects to apply later. The daily step then works through the records
// that are due, a day at a time and within a budget, applying their effects to relationships and
// memories (and, through the context, to anything else), retrying failed records with a growing
// delay. Where the run stopped is kept in the ledger's orchestration state, so a long catch-up or an
// over-budget day simply continues the next time.
//
// Applying one record's effects is all-or-nothing: if any effect fails, the parts of the world the
// effects may touch are put back and the record is marked failed (to retry), while the rest of the
// day carries on. Everything else follows the usual rule: a failed rule changes nothing.
import { canonicalJson, clone, isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import { createMemory } from '../memories/index.js';
import { applyRelationshipDelta, isStoredId } from '../relations/index.js';
import {
  FOLLOWUP_EVENT_TYPES, handlersForEvent, isValidEvent, normalizeFromEvent, normalizeQuarantinedEvent, semanticHeaderValid,
} from './events.js';
import {
  ACTIVITY_DAILY_BUDGET, CATCH_UP_DAY_LIMIT, FOLLOWUP_DAILY_BUDGET, FOLLOWUP_HANDLERS, INPUT_SCHEMA, MAX_RETRY_DELAY_DAYS,
  compareDue, cursorKey, digestOf, expectedRefsForEffects, findNextDue, inferHandler, normalizedHeaderValid, orchestrationIssue,
  recordKey, rootIssue, sortedUnique,
} from './shared.js';

// Runs after the steps that cause events, so events they report are handled in the same day change.
export const FOLLOWUPS_DAILY_ORDER = 900;

// ---------------------------------------------------------------------------------------------
// Enqueue. Every enqueue is prepared first (all checks, nothing changed) and only then written, so
// a failure part-way through an event with several handlers leaves the ledger as it was.

function sameImmutableFields(record, normalized, digest, handlerId) {
  const source = normalized.source || {};
  return record.sourceEventId === source.eventId && record.sourceEventType === source.eventType
    && record.transactionId === source.transactionId && record.planDigest === source.planDigest && record.sequence === source.sequence
    && record.handlerId === handlerId && record.handlerSchemaVersion === 1 && record.inputDigest === digest
    && record.createdDay === normalized.eventDay && canonicalJson(record.normalizedFollowupInput) === canonicalJson(normalized);
}

function newRecord(normalized, digest, handlerId, status, resultCode, lastError) {
  const { source, eventDay } = normalized;
  return {
    sourceEventId: source.eventId,
    sourceEventType: source.eventType,
    transactionId: source.transactionId,
    planDigest: source.planDigest,
    sequence: source.sequence,
    handlerId,
    handlerSchemaVersion: 1,
    status,
    resultCode,
    attemptCount: 0,
    nextAttemptDay: eventDay,
    lastError,
    normalizedFollowupInput: normalized,
    inputDigest: digest,
    createdDay: eventDay,
    updatedDay: eventDay,
    revision: 0,
  };
}

function prepareNormalized(root, input, suppliedDigest, explicitHandlerId) {
  const normalized = isRecord(input) ? clone(input) : null;
  if (!normalized || normalized.schemaVersion !== INPUT_SCHEMA || !Number.isInteger(normalized.eventDay) || normalized.eventDay < 0
    || typeof suppliedDigest !== 'string' || digestOf(normalized) !== suppliedDigest) return fail('followups_digest_mismatch');
  if (!normalizedHeaderValid(normalized)) return fail('followups_header_mismatch');
  const handlerId = explicitHandlerId ?? inferHandler(normalized);
  if (!FOLLOWUP_HANDLERS.includes(handlerId)) return fail('followups_invalid_input');
  const { source } = normalized;
  if (!isStoredId(source.eventId) || !isStoredId(source.eventType) || !isStoredId(source.transactionId)
    || typeof source.planDigest !== 'string' || !Number.isInteger(source.sequence) || source.sequence < 0) return fail('followups_invalid_input');
  if (inferHandler(normalized) !== handlerId) return fail('followups_header_mismatch');
  const expected = expectedRefsForEffects(normalized.effects, source.eventId, normalized.eventDay);
  if (expected === null || canonicalJson(expected) !== canonicalJson(normalized.expectedRefs)) return fail('followups_header_mismatch');
  const key = recordKey(source.eventId, handlerId);
  const existing = root.records[key];
  if (existing) {
    if (sameImmutableFields(existing, normalized, suppliedDigest, handlerId)) return ok({ action: { kind: 'exists', key } });
    // The same event arriving with different content: a record not yet applied is quarantined so it is
    // never applied; an applied or quarantined one cannot be touched.
    if (existing.status === 'pending' || existing.status === 'failed') {
      return ok({ action: { kind: 'quarantine_existing', key, day: normalized.eventDay } });
    }
    return fail('followups_header_mismatch', { recordKey: key, existingStatus: existing.status });
  }
  const noHandler = handlerId === 'm17.no_handler';
  const record = newRecord(normalized, suppliedDigest, handlerId, noHandler ? 'applied' : 'pending', noHandler ? 'no_handler' : null, null);
  return ok({ action: { kind: 'create', key, record } });
}

function prepareQuarantinedEvent(root, event, eventDay, errorCode) {
  const { normalizedFollowupInput: normalized, inputDigest } = normalizeQuarantinedEvent(event, eventDay);
  const handlerId = 'm17.no_handler';
  const key = recordKey(event.eventId, handlerId);
  const existing = root.records[key];
  if (existing) {
    if (existing.status === 'quarantined' && sameImmutableFields(existing, normalized, inputDigest, handlerId)) {
      return ok({ action: { kind: 'exists', key } });
    }
    return fail('followups_header_mismatch', { recordKey: key, existingStatus: existing.status });
  }
  const record = newRecord(normalized, inputDigest, handlerId, 'quarantined', 'quarantined', errorCode);
  return ok({ action: { kind: 'create', key, record } });
}

// Writes prepared actions. Cannot fail: capacity is checked before anything is written.
function writeActions(root, actions) {
  const created = actions.filter((action) => action.kind === 'create').length;
  if (Object.keys(root.records).length + created > root.maxRecords) return fail('followups_capacity_exceeded', { maxRecords: root.maxRecords });
  let quarantined = false;
  for (const action of actions) {
    if (action.kind === 'create') {
      root.records[action.key] = action.record;
      root.revision += 1;
    } else if (action.kind === 'quarantine_existing') {
      const record = root.records[action.key];
      Object.assign(record, {
        status: 'quarantined',
        resultCode: 'immutable_conflict',
        lastError: 'followups_header_mismatch',
        // Never earlier than the record's last update, so updatedDay stays in order.
        updatedDay: Math.max(action.day, record.updatedDay),
      });
      record.revision += 1;
      root.revision += 1;
      quarantined = true;
    }
  }
  return ok({
    recordKeys: actions.map((action) => action.key),
    idempotent: actions.every((action) => action.kind === 'exists'),
    quarantined,
  });
}

// Adds one record from already normalized input (see normalizeFromEvent). A repeat of the same
// input is a no-op; the same event with different content quarantines the earlier record.
export function enqueueNormalizedFollowup(draft, normalizedFollowupInput, inputDigest, handlerId = null) {
  const root = draft.world.m1Followups;
  const prepared = prepareNormalized(root, normalizedFollowupInput, inputDigest, handlerId);
  if (!prepared.ok) return prepared;
  const written = writeActions(root, [prepared.action]);
  if (!written.ok) return written;
  return ok({ recordKey: prepared.action.key, idempotent: written.idempotent, quarantined: written.quarantined, record: clone(root.records[prepared.action.key]) });
}

// Reports one game event to the ledger: one record per handler that reacts to it. Events with a
// wrong header are kept as quarantined records. Day: the calendar day, except a succession, which
// carries its own.
export function enqueueEvent(draft, event) {
  if (!isValidEvent(event)) return fail('followups_invalid_event');
  if (!FOLLOWUP_EVENT_TYPES.includes(event.eventType)) return fail('followups_unsupported_event_type', { eventType: event.eventType });
  const isSuccession = event.eventType === 'succession_resolved';
  const eventDay = isSuccession ? event.payload?.currentDay : draft.calendar.day;
  // A missing or bad day is refused by normalizeFromEvent / the quarantine below.
  if (!Number.isInteger(eventDay) || eventDay < 0) return fail('followups_invalid_event');
  const root = draft.world.m1Followups;
  const actions = [];
  if (!isSuccession && !semanticHeaderValid(event, event.payload && event.payload.semanticDelta)) {
    const prepared = prepareQuarantinedEvent(root, event, eventDay, 'followups_header_mismatch');
    if (!prepared.ok) return prepared;
    actions.push(prepared.action);
  } else {
    for (const handlerId of handlersForEvent(event, eventDay)) {
      const normalized = normalizeFromEvent(event, handlerId, eventDay);
      if (!normalized.ok) return normalized;
      const prepared = prepareNormalized(root, normalized.normalizedFollowupInput, normalized.inputDigest, handlerId);
      if (!prepared.ok) return prepared;
      actions.push(prepared.action);
    }
  }
  return writeActions(root, actions);
}

// ---------------------------------------------------------------------------------------------
// Reads. They take any state (a draft or the frozen store state) and never change it.

export function getFollowup(state, sourceEventId, handlerId) {
  return state.world.m1Followups.records[recordKey(sourceEventId, handlerId)] ?? null;
}

// Pending or failed records due on `day` (or earlier), in handling order, at most `limit`.
export function listDueFollowups(state, day, limit = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(day) || day < 0 || !Number.isInteger(limit) || limit < 0) return [];
  return Object.values(state.world.m1Followups.records)
    .filter((record) => (record.status === 'pending' || record.status === 'failed') && record.nextAttemptDay <= day)
    .sort(compareDue)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------------------------
// Orchestration state.

// Changes orchestration fields. Callers only build coherent states; checkFollowups (run by the store
// after every transaction) refuses any that are not.
function patchOrchestration(root, patch) {
  const next = { ...root.orchestration, ...clone(patch) };
  next.activityProcessedCharacterIds = sortedUnique(next.activityProcessedCharacterIds);
  if (canonicalJson(next) !== canonicalJson(root.orchestration)) {
    root.orchestration = next;
    root.revision += 1;
  }
  return ok();
}

// The only way a record changes after creation: pending or failed -> applied, failed or quarantined,
// with the cursor moved past it in the same step.
function transitionRecord(root, key, patch, cursor) {
  const record = root.records[key];
  if (!record || (record.status !== 'pending' && record.status !== 'failed')) return fail('followups_invalid_transition', { key });
  Object.assign(record, patch);
  record.revision += 1;
  root.orchestration.followupCursorKey = cursor;
  root.revision += 1;
  return ok();
}

// ---------------------------------------------------------------------------------------------
// Applying one record.

const BUILT_IN_APPLIERS = Object.freeze({
  relationship_delta: { touches: ['relationships'], apply: (draft, effect) => applyRelationshipDelta(draft, effect) },
  memory_create: { touches: ['memories'], apply: (draft, effect) => createMemory(draft, effect) },
});

// context.followups (all optional):
//   effectHandlers: { [effectType]: { touches?: [world area names], apply(draft, effect, day) } }
//     adds or replaces how an effect type is applied (activity_roles belongs to another area).
//     `touches` lists the world areas apply may change, so they can be restored if a later effect of
//     the same record fails; leave it out to restore every area.
//   activity: { dueCharacterIds(state, day) -> ids, process(draft, characterId, day) -> result }
//     the per-character daily phase that follows the follow-up phase.
function readContext(context) {
  const options = isRecord(context) && context.followups !== undefined ? context.followups : {};
  if (!isRecord(options)) return fail('followups_invalid_context');
  const handlers = { ...BUILT_IN_APPLIERS };
  if (options.effectHandlers !== undefined) {
    if (!isRecord(options.effectHandlers)) return fail('followups_invalid_context');
    for (const [type, handler] of Object.entries(options.effectHandlers)) {
      const touches = isRecord(handler) ? handler.touches : null;
      const validTouches = touches === undefined || (Array.isArray(touches) && touches.every((name) => typeof name === 'string'));
      if (!isRecord(handler) || typeof handler.apply !== 'function' || !validTouches) return fail('followups_invalid_context', { effectType: type });
      handlers[type] = handler;
    }
  }
  const activity = options.activity ?? null;
  if (activity !== null && (!isRecord(activity) || typeof activity.dueCharacterIds !== 'function' || typeof activity.process !== 'function')) return fail('followups_invalid_context');
  return ok({ handlers, activity });
}

// Checks a record before its effects are applied; any problem quarantines it. The area check has
// already guaranteed the record's own fields and header (checks.js), so this covers what that
// check leaves out: the digest, the handler against the effects, and the characters.
function validateStoredRecord(draft, record) {
  const normalized = record.normalizedFollowupInput;
  if (digestOf(normalized) !== record.inputDigest) return fail('followups_digest_mismatch');
  if (inferHandler(normalized) !== record.handlerId) return fail('followups_header_mismatch');
  const expected = expectedRefsForEffects(normalized.effects, record.sourceEventId, record.createdDay);
  if (expected === null || canonicalJson(expected) !== canonicalJson(normalized.expectedRefs)) return fail('followups_header_mismatch');
  for (const reference of normalized.expectedRefs) {
    // Only characters are ever referenced by effects.
    if (reference.type !== 'character' || !isRecord(draft.world.characters[reference.id])) return fail('followups_header_mismatch', { missing: reference.id });
  }
  return ok();
}

function snapshotAreas(draft, names) {
  const areas = names ?? Object.keys(draft.world).filter((name) => name !== 'm1Followups');
  return { rng: clone(draft.rng), areas: areas.map((name) => [name, clone(draft.world[name])]) };
}

function restoreAreas(draft, snapshot) {
  draft.rng = snapshot.rng;
  for (const [name, value] of snapshot.areas) {
    if (value === undefined) delete draft.world[name];
    else draft.world[name] = value;
  }
}

// Applies every effect of a record, or none: on any failure the touched areas are restored.
function applyEffects(draft, record, day, handlers) {
  const effects = record.normalizedFollowupInput.effects;
  const types = [...new Set(effects.map((effect) => effect.type))];
  const missing = types.find((type) => !handlers[type]);
  if (missing !== undefined) return fail('followups_no_effect_handler', { effectType: missing });
  const touchLists = types.map((type) => handlers[type].touches);
  const snapshot = snapshotAreas(draft, touchLists.every(Array.isArray) ? [...new Set(touchLists.flat())] : null);
  for (const effect of effects) {
    let outcome;
    try {
      outcome = handlers[effect.type].apply(draft, clone(effect), day);
    } catch (error) {
      outcome = fail('followups_effect_threw', { message: String(error?.message || error) });
    }
    if (outcome && outcome.ok === false) {
      restoreAreas(draft, snapshot);
      return outcome;
    }
  }
  return ok();
}

function processRecord(draft, record, day, handlers) {
  const root = draft.world.m1Followups;
  const key = recordKey(record.sourceEventId, record.handlerId);
  const cursor = cursorKey(record);
  const checked = validateStoredRecord(draft, record);
  if (!checked.ok) {
    return transitionRecord(root, key, { status: 'quarantined', resultCode: 'quarantined', lastError: String(checked.error), updatedDay: day }, cursor);
  }
  const applied = applyEffects(draft, record, day, handlers);
  if (!applied.ok) {
    const attempts = record.attemptCount + 1;
    return transitionRecord(root, key, {
      status: 'failed',
      resultCode: 'handler_failed',
      attemptCount: attempts,
      nextAttemptDay: day + Math.min(2 ** (attempts - 1), MAX_RETRY_DELAY_DAYS),
      lastError: String(applied.error),
      updatedDay: day,
    }, cursor);
  }
  return transitionRecord(root, key, { status: 'applied', resultCode: 'applied', lastError: null, updatedDay: day }, cursor);
}

// ---------------------------------------------------------------------------------------------
// One orchestrated day: follow-up phase, then activity phase, then the day is marked done.

// Handles due records after the cursor, up to the daily budget. Moves on to the activity phase when
// none are left; returns { complete: false } when the budget ran out first.
function runFollowupPhase(draft, day, handlers) {
  const root = draft.world.m1Followups;
  let processed = 0;
  for (;;) {
    const next = findNextDue(root.records, day, root.orchestration.followupCursorKey);
    if (next === null) {
      // Records enqueued or retried behind the cursor still count: start over from the beginning.
      if (root.orchestration.followupCursorKey !== null && findNextDue(root.records, day, null) !== null) {
        patchOrchestration(root, { followupCursorKey: null });
        continue;
      }
      const moved = patchOrchestration(root, { cursorPhase: 'activity', followupCursorKey: null });
      return moved.ok ? ok({ complete: true, processed }) : moved;
    }
    if (processed >= FOLLOWUP_DAILY_BUDGET) return ok({ complete: false, processed });
    const result = processRecord(draft, next, day, handlers);
    if (!result.ok) return result;
    processed += 1;
  }
}

function runActivityPhase(draft, day, activity) {
  const root = draft.world.m1Followups;
  let processed = 0;
  for (;;) {
    const done = root.orchestration.activityProcessedCharacterIds;
    const due = activity ? sortedUnique(activity.dueCharacterIds(draft, day)).filter((id) => !done.includes(id)) : [];
    if (due.length === 0) return ok({ complete: true, processed });
    if (processed >= ACTIVITY_DAILY_BUDGET) return ok({ complete: false, processed });
    const outcome = activity.process(draft, due[0], day);
    if (outcome && outcome.ok === false) return outcome;
    const marked = patchOrchestration(root, { activityProcessedCharacterIds: [...done, due[0]] });
    if (!marked.ok) return marked;
    processed += 1;
  }
}

function completeDay(root, day) {
  const patch = { lastOrchestratedDay: day, followupCursorKey: null, activityProcessedCharacterIds: [] };
  if (day < root.orchestration.catchUpTargetDay) Object.assign(patch, { cursorDay: day + 1, cursorPhase: 'followups' });
  else Object.assign(patch, { catchUpTargetDay: null, cursorDay: null, cursorPhase: null });
  return patchOrchestration(root, patch);
}

function startOrExtend(root, day) {
  const { orchestration } = root;
  if (orchestration.cursorDay === null) {
    if (day <= orchestration.lastOrchestratedDay) return ok();
    return patchOrchestration(root, {
      cursorDay: orchestration.lastOrchestratedDay + 1, catchUpTargetDay: day, cursorPhase: 'followups', followupCursorKey: null, activityProcessedCharacterIds: [],
    });
  }
  if (day > orchestration.catchUpTargetDay) return patchOrchestration(root, { catchUpTargetDay: day });
  return ok();
}

// Orchestrates every day up to `day` (the day being started) that was not handled yet (at most CATCH_UP_DAY_LIMIT days per
// call). Returns ok({ completedDays, incomplete }); incomplete means the budget or the day limit
// stopped it, and the next call continues from the saved cursor.
export function runFollowups(draft, day, context = {}) {
  if (!Number.isInteger(day) || day < 0) return fail('followups_invalid_input');
  const root = draft.world.m1Followups;
  const issue = rootIssue(root);
  if (issue) return fail('followups_invalid_root', { issue });
  const read = readContext(context);
  if (!read.ok) return read;
  const started = startOrExtend(root, day);
  if (!started.ok) return started;
  let completedDays = 0;
  while (root.orchestration.cursorDay !== null && completedDays < CATCH_UP_DAY_LIMIT) {
    const cursorDay = root.orchestration.cursorDay;
    if (root.orchestration.cursorPhase === 'followups') {
      const phase = runFollowupPhase(draft, cursorDay, read.handlers);
      if (!phase.ok) return phase;
      if (!phase.complete) return ok({ completedDays, incomplete: true, phase: 'followups' });
    }
    const activity = runActivityPhase(draft, cursorDay, read.activity);
    if (!activity.ok) return activity;
    if (!activity.complete) return ok({ completedDays, incomplete: true, phase: 'activity' });
    const finished = completeDay(root, cursorDay);
    if (!finished.ok) return finished;
    completedDays += 1;
  }
  return ok({ completedDays, incomplete: root.orchestration.cursorDay !== null });
}

// The earlier version orchestrated at the start of each new day, up to and including that day. The
// step for the ended day D therefore works through day D + 1: records due by then (this includes
// events the other daily steps just reported for the new day) are handled in the same day change.
export const dailySteps = Object.freeze([
  Object.freeze({ order: FOLLOWUPS_DAILY_ORDER, name: 'followups.drain', run: (draft, day, context) => runFollowups(draft, day + 1, context) }),
]);
