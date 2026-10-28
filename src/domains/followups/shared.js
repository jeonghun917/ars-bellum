// Constants and record-level checks for the follow-up ledger (world.m1Followups).
//
// The ledger holds one record per (source event, handler). A record is created when a game event is
// seen, keeps the exact normalized input it was made from, and moves pending/failed -> applied,
// failed again, or quarantined. Record shapes and ids are the earlier version's.
import { canonicalJson, isRecord } from '../../core/data.js';
import { sha256Hex } from '../../core/sha256.js';
import { isStoredId } from '../relations/index.js';

export const FOLLOWUP_VERSION = 1;
export const INPUT_SCHEMA = 'm17.followup_input.v1';
export const SEMANTIC_SCHEMA = 'm17.semantic_delta.v1';
export const FOLLOWUP_HANDLERS = Object.freeze(['m17.relationship', 'm17.memory', 'm17.activity', 'm17.no_handler']);
export const RECORD_STATUSES = Object.freeze(['pending', 'applied', 'failed', 'quarantined']);
export const CURSOR_PHASES = Object.freeze([null, 'followups', 'activity']);
export const DEFAULT_MAX_RECORDS = 8192;
// How many records / characters one orchestrated day may handle, and how many days one run may catch up.
export const FOLLOWUP_DAILY_BUDGET = 64;
export const ACTIVITY_DAILY_BUDGET = 128;
export const CATCH_UP_DAY_LIMIT = 30;
export const MAX_RETRY_DELAY_DAYS = 30;

const isCount = (value) => Number.isInteger(value) && value >= 0;

export const digestOf = (value) => `sha256:${sha256Hex(canonicalJson(value))}`;
export const recordKey = (sourceEventId, handlerId) => `${sourceEventId}::${handlerId}`;
export const sortedUnique = (values) => [...new Set((Array.isArray(values) ? values : []).filter(isStoredId))].sort();

// Plain code-unit comparison. The earlier version sorted with localeCompare but compared the cursor
// with ">", so the order depended on the browser's locale; one fixed order keeps runs repeatable.
export const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------------------------
// The cursor: records are handled in (nextAttemptDay, sourceEventId, handlerId) order, and the
// cursor key remembers the last record handled so a day can resume where it stopped.

export const cursorKey = (record) => canonicalJson([record.nextAttemptDay, record.sourceEventId, record.handlerId]);

export function parseCursorKey(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 3 || !isCount(parsed[0]) || !isStoredId(parsed[1])
      || !FOLLOWUP_HANDLERS.includes(parsed[2]) || canonicalJson(parsed) !== value) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const compareDue = (a, b) => a.nextAttemptDay - b.nextAttemptDay
  || compareText(a.sourceEventId, b.sourceEventId)
  || compareText(a.handlerId, b.handlerId);

function isAfterCursor(record, key) {
  if (key === null) return true;
  const parsed = parseCursorKey(key);
  if (!parsed) return false;
  return compareDue(record, { nextAttemptDay: parsed[0], sourceEventId: parsed[1], handlerId: parsed[2] }) > 0;
}

// The next record to handle on `day`: pending or failed, due, and after the cursor. One pass, no sort.
export function findNextDue(records, day, key) {
  let best = null;
  for (const record of Object.values(records)) {
    if (record.status !== 'pending' && record.status !== 'failed') continue;
    if (record.nextAttemptDay > day || !isAfterCursor(record, key)) continue;
    if (best === null || compareDue(record, best) < 0) best = record;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Normalized input: what a record was made from.

export function inferHandler(normalized) {
  const effects = isRecord(normalized) && Array.isArray(normalized.effects) ? normalized.effects : [];
  if (effects.length === 0) return 'm17.no_handler';
  const types = sortedUnique(effects.map((effect) => effect && effect.type));
  if (types.length !== 1) return null;
  if (types[0] === 'memory_create') return 'm17.memory';
  if (types[0] === 'activity_roles') return 'm17.activity';
  if (types[0] === 'relationship_delta') return 'm17.relationship';
  return null;
}

export function normalizedHeaderValid(normalized) {
  if (!isRecord(normalized) || normalized.schemaVersion !== INPUT_SCHEMA || !isRecord(normalized.source) || !isRecord(normalized.semanticDelta)) return false;
  const { source, semanticDelta: delta } = normalized;
  if (delta.schemaVersion !== SEMANTIC_SCHEMA || !isStoredId(delta.domainId) || !isStoredId(delta.command)) return false;
  if (!isRecord(delta.targetRef) || !isStoredId(delta.targetRef.type) || !isStoredId(delta.targetRef.id) || !Array.isArray(delta.changes)) return false;
  return source.command === delta.command && canonicalJson(source.targetRef) === canonicalJson(delta.targetRef)
    && source.beforeRevision === delta.beforeRevision && source.afterRevision === delta.afterRevision;
}

// The characters an effect list touches, as sorted { type, id } references. Returns null when an
// effect is malformed or does not belong to this event and day.
export function expectedRefsForEffects(effects, sourceEventId, eventDay) {
  if (!Array.isArray(effects)) return null;
  const byKey = {};
  const add = (type, id) => {
    if (!isStoredId(type) || !isStoredId(id)) return false;
    byKey[`${type}:${id}`] = { type, id };
    return true;
  };
  for (const effect of effects) {
    if (!isRecord(effect) || effect.sourceEventId !== sourceEventId || effect.eventDay !== eventDay) return null;
    if (effect.type === 'activity_roles') {
      if (!Array.isArray(effect.effects) || effect.effects.length === 0) return null;
      for (const item of effect.effects) {
        if (!isRecord(item) || !add('character', item.characterId) || !Array.isArray(item.addRoleKeys) || !Array.isArray(item.removeRoleKeys)) return null;
      }
    } else if (effect.type === 'memory_create') {
      if (!add('character', effect.ownerCharacterId) || !Array.isArray(effect.targetCharacterIds)) return null;
      for (const id of effect.targetCharacterIds) {
        if (!add('character', id)) return null;
      }
    } else if (effect.type === 'relationship_delta') {
      if (!add('character', effect.fromCharacterId) || !add('character', effect.toCharacterId) || !isRecord(effect.deltas) || !isStoredId(effect.reasonId)) return null;
    } else {
      return null;
    }
  }
  return Object.keys(byKey).sort().map((key) => byKey[key]);
}

// ---------------------------------------------------------------------------------------------
// Record and root checks. Each returns null when fine, or a short issue code.

export function orchestrationIssue(value) {
  if (!isRecord(value) || !isCount(value.lastOrchestratedDay)) return 'invalid_orchestration';
  for (const key of ['catchUpTargetDay', 'cursorDay']) {
    if (value[key] !== null && !isCount(value[key])) return 'invalid_orchestration';
  }
  if (!CURSOR_PHASES.includes(value.cursorPhase)) return 'invalid_orchestration';
  if (value.followupCursorKey !== null && !parseCursorKey(value.followupCursorKey)) return 'invalid_cursor_key';
  if (!Array.isArray(value.activityProcessedCharacterIds)
    || canonicalJson(value.activityProcessedCharacterIds) !== canonicalJson(sortedUnique(value.activityProcessedCharacterIds))) return 'invalid_activity_processed';
  const active = value.cursorDay !== null || value.catchUpTargetDay !== null || value.cursorPhase !== null;
  if (active && (value.cursorDay === null || value.catchUpTargetDay === null || value.cursorPhase === null || value.cursorDay > value.catchUpTargetDay)) return 'invalid_cursor';
  if (!active && (value.followupCursorKey !== null || value.activityProcessedCharacterIds.length !== 0)) return 'stale_cursor_state';
  return null;
}

export function recordIssue(record, key, { verifyDigest = false } = {}) {
  if (!isRecord(record) || key !== recordKey(record.sourceEventId, record.handlerId)) return 'invalid_record_key';
  if (!isStoredId(record.sourceEventId) || !isStoredId(record.sourceEventType) || !isStoredId(record.transactionId)
    || typeof record.planDigest !== 'string' || !isCount(record.sequence)) return 'invalid_source';
  if (!FOLLOWUP_HANDLERS.includes(record.handlerId) || record.handlerSchemaVersion !== 1 || !RECORD_STATUSES.includes(record.status)) return 'invalid_handler_or_status';
  if (!isCount(record.attemptCount) || !isCount(record.nextAttemptDay)) return 'invalid_attempts';
  if (!isRecord(record.normalizedFollowupInput) || typeof record.inputDigest !== 'string' || !isCount(record.createdDay)
    || !isCount(record.updatedDay) || record.updatedDay < record.createdDay || !isCount(record.revision)) return 'invalid_record_fields';
  const normalized = record.normalizedFollowupInput;
  if (verifyDigest && digestOf(normalized) !== record.inputDigest) return 'digest_mismatch';
  const source = isRecord(normalized.source) ? normalized.source : {};
  if (normalized.eventDay !== record.createdDay || !Array.isArray(normalized.expectedRefs) || !Array.isArray(normalized.effects)) return 'invalid_normalized_input';
  if (source.eventId !== record.sourceEventId || source.eventType !== record.sourceEventType || source.transactionId !== record.transactionId
    || source.planDigest !== record.planDigest || source.sequence !== record.sequence) return 'source_mismatch';
  if (record.status !== 'quarantined' && !normalizedHeaderValid(normalized)) return 'invalid_header';
  if (record.status === 'pending' && record.resultCode !== null) return 'invalid_status_fields';
  if (record.status === 'failed' && (record.attemptCount < 1 || record.resultCode !== 'handler_failed' || typeof record.lastError !== 'string')) return 'invalid_status_fields';
  if (record.status === 'applied' && typeof record.resultCode !== 'string') return 'invalid_status_fields';
  if (record.status === 'quarantined' && (typeof record.resultCode !== 'string' || typeof record.lastError !== 'string')) return 'invalid_status_fields';
  if (record.handlerId === 'm17.no_handler' && record.status === 'applied'
    && (record.resultCode !== 'no_handler' || record.attemptCount !== 0 || normalized.effects.length !== 0)) return 'invalid_no_handler_record';
  return null;
}

export function rootIssue(root) {
  if (!isRecord(root) || root.version !== FOLLOWUP_VERSION || !isCount(root.revision) || !Number.isInteger(root.maxRecords)
    || root.maxRecords < 1 || !isRecord(root.records)) return 'invalid_root';
  return orchestrationIssue(root.orchestration);
}
