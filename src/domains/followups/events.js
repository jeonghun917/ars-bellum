// Turns a game event (a clan, faction or title changed, succession resolved, ...) into follow-up
// input: which handlers should react and the exact effects they will apply. Pure functions: no
// state is read or changed here.
//
// Event shape (from the transaction that produced it): { eventId, eventType, transactionId,
// planDigest, sequence, payload }. State-change events carry payload.semanticDelta.
import { clone, findNonJson, isRecord } from '../../core/data.js';
import { fail, ok } from '../../core/result.js';
import { isStoredId } from '../relations/index.js';
import {
  INPUT_SCHEMA, SEMANTIC_SCHEMA, FOLLOWUP_HANDLERS, digestOf, expectedRefsForEffects, sortedUnique,
} from './shared.js';

export const FOLLOWUP_EVENT_TYPES = Object.freeze([
  'clan_state_changed', 'faction_state_changed', 'title_state_changed',
  'settlement_rights_changed', 'succession_resolved', 'player_control_changed',
]);

// For each event type: the record type its semantic delta must target, and the payload field that
// must name the same record.
const TARGET_CONTRACTS = Object.freeze({
  clan_state_changed: ['clan', 'clanId'],
  faction_state_changed: ['faction', 'factionId'],
  title_state_changed: ['title', 'titleId'],
  settlement_rights_changed: ['land_right', 'landRightId'],
  player_control_changed: ['player_control', null],
});

const has = (object, key) => Object.hasOwn(object, key);

export function isValidEvent(event) {
  return isRecord(event) && isStoredId(event.eventId) && isStoredId(event.eventType) && isStoredId(event.transactionId)
    && typeof event.planDigest === 'string' && Number.isInteger(event.sequence) && event.sequence >= 0
    && (event.payload == null || isRecord(event.payload)) && findNonJson(event) === null;
}

function deltaField(delta, field) {
  const changes = delta && Array.isArray(delta.changes) ? delta.changes : [];
  if (changes.length === 0) return { before: null, after: null };
  const change = changes[0] || {};
  return {
    before: isRecord(change.before) && has(change.before, field) ? clone(change.before[field]) : null,
    after: isRecord(change.after) && has(change.after, field) ? clone(change.after[field]) : null,
  };
}

const characterRefId = (value) => (isRecord(value) && value.type === 'character' && isStoredId(value.id) ? value.id : null);

export function semanticHeaderValid(event, delta) {
  if (!isRecord(delta) || delta.schemaVersion !== SEMANTIC_SCHEMA || !isStoredId(delta.domainId) || !isStoredId(delta.command)) return false;
  if (!isRecord(delta.targetRef) || !isStoredId(delta.targetRef.type) || !isStoredId(delta.targetRef.id) || !Array.isArray(delta.changes)) return false;
  const payload = event.payload || {};
  const contract = TARGET_CONTRACTS[event.eventType] || null;
  if (contract && (delta.domainId !== contract[0] || delta.targetRef.type !== contract[0])) return false;
  if (contract && contract[1] && payload[contract[1]] !== delta.targetRef.id) return false;
  if (event.eventType === 'player_control_changed' && delta.targetRef.id !== 'singleton') return false;
  if (has(payload, 'command') && payload.command !== delta.command) return false;
  if (has(payload, 'beforeRevision') && payload.beforeRevision !== delta.beforeRevision) return false;
  if (has(payload, 'afterRevision') && payload.afterRevision !== delta.afterRevision) return false;
  return true;
}

// Role changes (clan head, faction ruler, title holder, player character) for the activity handler.
function activityEffects(event, eventDay, delta) {
  let oldId = null;
  let newId = null;
  let roleKey = null;
  if (event.eventType === 'clan_state_changed') {
    const field = deltaField(delta, 'headCharacterId');
    [oldId, newId, roleKey] = [field.before, field.after, `role:clan_head:${delta.targetRef.id}`];
  } else if (event.eventType === 'faction_state_changed') {
    const field = deltaField(delta, 'rulerCharacterId');
    [oldId, newId, roleKey] = [field.before, field.after, `role:faction_ruler:${delta.targetRef.id}`];
  } else if (event.eventType === 'title_state_changed') {
    const field = deltaField(delta, 'holderRef');
    [oldId, newId, roleKey] = [characterRefId(field.before), characterRefId(field.after), `role:title_holder:${delta.targetRef.id}`];
  } else if (event.eventType === 'player_control_changed') {
    const field = deltaField(delta, 'currentCharacterId');
    [oldId, newId, roleKey] = [field.before, field.after, 'role:player_control:campaign'];
  }
  if (oldId === newId || !roleKey) return [];
  const byCharacter = {};
  if (isStoredId(oldId)) byCharacter[oldId] = { characterId: oldId, addRoleKeys: [], removeRoleKeys: [roleKey] };
  if (isStoredId(newId)) {
    byCharacter[newId] ??= { characterId: newId, addRoleKeys: [], removeRoleKeys: [] };
    byCharacter[newId].addRoleKeys.push(roleKey);
  }
  const roleEffects = Object.keys(byCharacter).sort().map((id) => ({
    characterId: id,
    addRoleKeys: sortedUnique(byCharacter[id].addRoleKeys),
    removeRoleKeys: sortedUnique(byCharacter[id].removeRoleKeys),
  }));
  return roleEffects.length ? [{ type: 'activity_roles', sourceEventId: event.eventId, eventDay, effects: roleEffects }] : [];
}

// A title changing hands leaves a public memory for the old and the new holder.
function memoryEffects(event, eventDay, delta) {
  if (event.eventType !== 'title_state_changed') return [];
  const field = deltaField(delta, 'holderRef');
  const oldId = characterRefId(field.before);
  const newId = characterRefId(field.after);
  if (oldId === newId) return [];
  const memory = (ownerCharacterId, otherId, memoryTypeId) => ({
    type: 'memory_create', ownerCharacterId, targetCharacterIds: otherId ? [otherId] : [], memoryTypeId, eventDay,
    importance: 800, knowledge: 'public', decayPolicyId: 'permanent', sourceEventId: event.eventId, payload: { titleId: delta.targetRef.id },
  });
  const effects = [];
  if (oldId) effects.push(memory(oldId, newId, 'title_revoked'));
  if (newId) effects.push(memory(newId, oldId, 'title_granted'));
  return effects;
}

export function buildEffects(event, handlerId, eventDay, delta) {
  if (handlerId === 'm17.activity') return activityEffects(event, eventDay, delta);
  if (handlerId === 'm17.memory') return memoryEffects(event, eventDay, delta);
  return [];
}

// Which handlers an event needs, in sorted order (activity before memory). Events without a semantic
// delta (a succession) or with no role / memory change (a settlement right) need none. An event nobody reacts to still gets one
// "no handler" record, so the ledger shows it was seen.
export function handlersForEvent(event, eventDay) {
  const delta = event.payload && event.payload.semanticDelta;
  if (!semanticHeaderValid(event, delta)) return ['m17.no_handler'];
  const handlers = [];
  if (['clan_state_changed', 'faction_state_changed', 'title_state_changed', 'player_control_changed'].includes(event.eventType)
    && buildEffects(event, 'm17.activity', eventDay, delta).length) handlers.push('m17.activity');
  if (event.eventType === 'title_state_changed' && buildEffects(event, 'm17.memory', eventDay, delta).length) handlers.push('m17.memory');
  return handlers.length ? handlers : ['m17.no_handler'];
}

function sourceOf(event, delta, payload, command) {
  const revisionOf = (name) => {
    if (has(payload, name)) return payload[name];
    return has(delta, name) ? delta[name] : null;
  };
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    transactionId: event.transactionId,
    planDigest: event.planDigest,
    sequence: event.sequence,
    command,
    targetRef: clone(isRecord(delta.targetRef) ? delta.targetRef : { type: 'event', id: event.eventId }),
    beforeRevision: revisionOf('beforeRevision'),
    afterRevision: revisionOf('afterRevision'),
  };
}

const semanticKindOf = (eventType) => eventType.replace(/_state_changed$/, '_changed');

// The normalized input for one handler: { normalizedFollowupInput, inputDigest, handlerId }.
export function normalizeFromEvent(event, handlerId, eventDay) {
  if (!isValidEvent(event) || !FOLLOWUP_HANDLERS.includes(handlerId) || !Number.isInteger(eventDay) || eventDay < 0) return fail('followups_invalid_event');
  const payload = event.payload || {};
  let delta = payload.semanticDelta || null;
  if (event.eventType === 'succession_resolved') {
    delta = {
      schemaVersion: SEMANTIC_SCHEMA,
      domainId: 'succession',
      command: 'succession.resolve',
      targetRef: { type: 'character', id: String(payload.decedentCharacterId || 'resolution') },
      beforeRevision: null,
      afterRevision: null,
      changes: [],
      successionPayload: clone({
        cause: payload.cause,
        currentDay: payload.currentDay,
        decedentCharacterId: payload.decedentCharacterId,
        resultTagIds: payload.resultTagIds || [],
        resolution: payload.resolution || {},
      }),
    };
  }
  if (handlerId !== 'm17.no_handler' && !semanticHeaderValid(event, delta)) return fail('followups_header_mismatch');
  if (!delta) {
    delta = {
      schemaVersion: SEMANTIC_SCHEMA, domainId: 'event', command: String(payload.command || event.eventType),
      targetRef: { type: 'event', id: event.eventId }, beforeRevision: null, afterRevision: null, changes: [],
    };
  }
  const effects = buildEffects(event, handlerId, eventDay, delta);
  if (handlerId !== 'm17.no_handler' && effects.length === 0) return fail('followups_invalid_input');
  const expectedRefs = expectedRefsForEffects(effects, event.eventId, eventDay);
  if (expectedRefs === null) return fail('followups_header_mismatch');
  const normalized = {
    schemaVersion: INPUT_SCHEMA,
    eventDay,
    source: sourceOf(event, delta, payload, String(delta.command || payload.command || event.eventType)),
    semanticKind: semanticKindOf(event.eventType),
    semanticDelta: clone(delta),
    expectedRefs,
    effects: clone(effects),
  };
  return ok({ normalizedFollowupInput: normalized, inputDigest: digestOf(normalized), handlerId });
}

// The input for an event whose header is wrong: kept in the ledger as quarantined, never applied.
export function normalizeQuarantinedEvent(event, eventDay) {
  const payload = event.payload || {};
  const delta = isRecord(payload.semanticDelta) ? clone(payload.semanticDelta) : {
    schemaVersion: SEMANTIC_SCHEMA,
    domainId: 'event',
    command: String(payload.command || event.eventType),
    targetRef: { type: 'event', id: event.eventId },
    beforeRevision: has(payload, 'beforeRevision') ? payload.beforeRevision : null,
    afterRevision: has(payload, 'afterRevision') ? payload.afterRevision : null,
    changes: [],
  };
  const normalized = {
    schemaVersion: INPUT_SCHEMA,
    eventDay,
    source: sourceOf(event, delta, payload, String(payload.command || delta.command || event.eventType)),
    semanticKind: semanticKindOf(event.eventType),
    semanticDelta: delta,
    expectedRefs: [],
    effects: [],
  };
  return { normalizedFollowupInput: normalized, inputDigest: digestOf(normalized) };
}
