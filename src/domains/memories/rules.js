// Character memories: what a character remembers about an event (a betrayal, a granted title...),
// who it concerns, how widely it is known, and whether it is still open.
//
// A memory's id is derived from (owner, memory type, source event), so one event gives each owner
// at most one memory of a type, and re-delivering the same event is a no-op. Record shapes and ids
// are the earlier version's.
import { canonicalJson, findNonJson, isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import { sha256Hex } from '../../core/sha256.js';

// Ids as the earlier version stored them: letters of either case are allowed, so saves with such
// character or event ids keep loading. (New ids are made lowercase by core/ids.js.)
export const isStoredId = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value);

export const MEMORY_KNOWLEDGE = Object.freeze(['private', 'known_to_targets', 'clan_known', 'faction_known', 'public']);
export const MEMORY_STATUSES = Object.freeze(['unresolved', 'resolved', 'forgiven', 'expired']);
export const MEMORY_TERMINAL_STATUSES = Object.freeze(['resolved', 'forgiven', 'expired']);
export const DEFAULT_MEMORY_TYPE_IDS = Object.freeze([
  'life_saved', 'kin_killed', 'major_betrayal', 'marriage_promise', 'alliance_promise',
  'title_granted', 'title_revoked', 'land_confiscated', 'public_humiliation',
  'decisive_war_support', 'succession_dispute', 'debt_forgiven', 'debt_defaulted',
]);
// "permanent" memories never expire; other policies can only come from approved custom definitions.
export const DEFAULT_DECAY_POLICY_IDS = Object.freeze(['permanent']);
export const MEMORY_IMPORTANCE_MAX = 1000;

// The fields fixed when a memory is created. A repeated create must match these exactly.
const CREATION_FIELDS = Object.freeze([
  'ownerCharacterId', 'targetCharacterIds', 'memoryTypeId', 'eventDay', 'importance', 'knowledge', 'decayPolicyId', 'sourceEventId', 'payload',
]);

export const memoryId = (ownerCharacterId, memoryTypeId, sourceEventId) => `memory:${sha256Hex(canonicalJson([ownerCharacterId, memoryTypeId, sourceEventId]))}`;

const isDayNumber = (value) => Number.isInteger(value) && value >= 0;

// Custom memory types and decay policies are approved records in world.customDefinitions,
// keyed "<domainId>:<definitionId>" as the earlier definition store saved them.
function isApprovedCustomDefinition(world, domainId, definitionId) {
  const records = isRecord(world.customDefinitions) ? world.customDefinitions.records : null;
  const record = isRecord(records) ? records[`${domainId}:${definitionId}`] : null;
  return isRecord(record) && record.domainId === domainId && record.definitionId === definitionId && record.approvalStatus === 'approved';
}

export function isKnownMemoryType(world, memoryTypeId) {
  return DEFAULT_MEMORY_TYPE_IDS.includes(memoryTypeId) || isApprovedCustomDefinition(world, 'memory_type', memoryTypeId);
}

export function isKnownDecayPolicy(world, decayPolicyId) {
  return DEFAULT_DECAY_POLICY_IDS.includes(decayPolicyId) || isApprovedCustomDefinition(world, 'memory_decay_policy', decayPolicyId);
}

export function buildOwnerIndex(records) {
  const index = {};
  for (const id of Object.keys(records).sort()) (index[records[id].ownerCharacterId] ??= []).push(id);
  return index;
}

function normalizeCreateInput(world, input) {
  if (!isRecord(input)) return fail('memories_invalid_input');
  const { ownerCharacterId, memoryTypeId, sourceEventId, eventDay, importance, knowledge } = input;
  const decayPolicyId = input.decayPolicyId ?? 'permanent';
  const payload = input.payload ?? {};
  const targets = input.targetCharacterIds ?? [];
  if (!isStoredId(ownerCharacterId) || !isStoredId(memoryTypeId) || !isStoredId(sourceEventId) || !isStoredId(decayPolicyId) || !isDayNumber(eventDay)) return fail('memories_invalid_input');
  if (!Number.isInteger(importance) || importance < 0 || importance > MEMORY_IMPORTANCE_MAX || !MEMORY_KNOWLEDGE.includes(knowledge)) return fail('memories_invalid_input');
  if (!isRecord(payload) || findNonJson(payload) !== null) return fail('memories_invalid_input');
  if (!Array.isArray(targets) || !targets.every(isStoredId)) return fail('memories_invalid_input');
  if (!isRecord(world.characters[ownerCharacterId])) return fail('memories_missing_owner', { ownerCharacterId });
  const targetCharacterIds = [...new Set(targets)].sort();
  for (const targetId of targetCharacterIds) {
    if (!isRecord(world.characters[targetId])) return fail('memories_missing_target', { targetId });
  }
  if (!isKnownMemoryType(world, memoryTypeId)) return fail('memories_unregistered_type', { memoryTypeId });
  if (!isKnownDecayPolicy(world, decayPolicyId)) return fail('memories_unregistered_decay_policy', { decayPolicyId });
  return ok({
    input: {
      ownerCharacterId, targetCharacterIds, memoryTypeId, eventDay, importance, knowledge, decayPolicyId, sourceEventId,
      payload: JSON.parse(JSON.stringify(payload)),
    },
  });
}

function sameCreation(record, input) {
  return CREATION_FIELDS.every((field) => canonicalJson(record[field]) === canonicalJson(input[field]));
}

// Creates a memory: input { ownerCharacterId, targetCharacterIds?, memoryTypeId, eventDay,
// importance (0..1000), knowledge, decayPolicyId? (default "permanent"), sourceEventId, payload? }.
export function createMemory(draft, input) {
  const normalized = normalizeCreateInput(draft.world, input);
  if (!normalized.ok) return normalized;
  const fields = normalized.input;
  const root = draft.world.memories;
  const id = memoryId(fields.ownerCharacterId, fields.memoryTypeId, fields.sourceEventId);
  const existing = root.records[id];
  if (existing) {
    // A replay is recognised by its creation fields, so it still matches after the memory was resolved.
    if (!sameCreation(existing, fields)) return fail('memories_duplicate_conflict', { memoryId: id });
    return ok({ idempotent: true, memoryId: id });
  }
  root.records[id] = { id, ...fields, status: 'unresolved', resolution: null, revision: 0 };
  const list = root.ownerIndex[fields.ownerCharacterId] ?? [];
  list.push(id);
  list.sort();
  root.ownerIndex[fields.ownerCharacterId] = list;
  root.revision += 1;
  return ok({ idempotent: false, memoryId: id });
}

// Closes an unresolved memory: input { memoryId, nextStatus (resolved|forgiven|expired),
// decisionDay, reasonId, sourceEventId }. A closed memory never changes again; repeating the same
// decision is a no-op. Permanent memories cannot expire.
export function resolveMemory(draft, input) {
  if (!isRecord(input)) return fail('memories_invalid_input');
  const { memoryId: id, nextStatus, decisionDay, reasonId, sourceEventId } = input;
  if (!isStoredId(id) || !MEMORY_TERMINAL_STATUSES.includes(nextStatus) || !isDayNumber(decisionDay) || !isStoredId(reasonId) || !isStoredId(sourceEventId)) {
    return fail('memories_invalid_input');
  }
  const root = draft.world.memories;
  const before = root.records[id];
  if (!before) return fail('memories_missing_record', { memoryId: id });
  if (nextStatus === 'expired' && before.decayPolicyId === 'permanent') return fail('memories_permanent_expiry_forbidden', { memoryId: id });
  const resolution = { status: nextStatus, decisionDay, reasonId, sourceEventId };
  if (before.status !== 'unresolved') {
    if (before.status === nextStatus && canonicalJson(before.resolution) === canonicalJson(resolution)) return ok({ idempotent: true, memoryId: id });
    return fail('memories_invalid_transition', { memoryId: id, status: before.status });
  }
  before.status = nextStatus;
  before.resolution = resolution;
  before.revision += 1;
  root.revision += 1;
  return ok({ idempotent: false, memoryId: id });
}

// Reads. They take any state (a draft or the frozen store state) and never change it.
export function getMemory(state, id) {
  return state.world.memories.records[id] ?? null;
}

// filter: { status?, memoryTypeId?, targetCharacterId? }
export function listMemoriesForOwner(state, ownerCharacterId, filter = {}) {
  const root = state.world.memories;
  const f = isRecord(filter) ? filter : {};
  return (root.ownerIndex[ownerCharacterId] ?? []).map((id) => root.records[id]).filter((record) => {
    if (f.status && record.status !== f.status) return false;
    if (f.memoryTypeId && record.memoryTypeId !== f.memoryTypeId) return false;
    if (f.targetCharacterId && !record.targetCharacterIds.includes(f.targetCharacterId)) return false;
    return true;
  });
}
