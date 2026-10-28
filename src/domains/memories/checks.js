// Record checks for world.memories, from the earlier version's root and save validators.
// Depends on world.characters (which ids exist) and world.customDefinitions (approved custom
// memory types and decay policies).
import { canonicalJson, isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import {
  MEMORY_IMPORTANCE_MAX, MEMORY_KNOWLEDGE, MEMORY_STATUSES, buildOwnerIndex, isKnownDecayPolicy, isKnownMemoryType, isStoredId, memoryId,
} from './rules.js';

const isCount = (value) => Number.isInteger(value) && value >= 0;

function resolutionIssue(record) {
  if (record.status === 'unresolved') return record.resolution === null ? null : 'invalid_resolution';
  const resolution = record.resolution;
  if (!isRecord(resolution) || resolution.status !== record.status || !isCount(resolution.decisionDay) || !isStoredId(resolution.reasonId) || !isStoredId(resolution.sourceEventId)) {
    return 'invalid_resolution';
  }
  if (record.status === 'expired' && record.decayPolicyId === 'permanent') return 'permanent_expired';
  return null;
}

function recordIssue(record, id, world) {
  if (!isRecord(record) || record.id !== id || id !== memoryId(record.ownerCharacterId, record.memoryTypeId, record.sourceEventId)) return 'invalid_memory_id';
  if (!isStoredId(record.ownerCharacterId) || !isStoredId(record.memoryTypeId) || !isStoredId(record.sourceEventId) || !isStoredId(record.decayPolicyId)) return 'invalid_ids';
  if (!isRecord(world.characters[record.ownerCharacterId])) return 'missing_owner';
  const targets = record.targetCharacterIds;
  if (!Array.isArray(targets) || !targets.every(isStoredId) || canonicalJson(targets) !== canonicalJson([...new Set(targets)].sort())) return 'invalid_targets';
  if (targets.some((targetId) => !isRecord(world.characters[targetId]))) return 'missing_target';
  if (!isKnownMemoryType(world, record.memoryTypeId)) return 'unregistered_memory_type';
  if (!isKnownDecayPolicy(world, record.decayPolicyId)) return 'unregistered_decay_policy';
  if (!isCount(record.eventDay) || !Number.isInteger(record.importance) || record.importance < 0 || record.importance > MEMORY_IMPORTANCE_MAX) return 'invalid_memory_record';
  if (!MEMORY_KNOWLEDGE.includes(record.knowledge) || !MEMORY_STATUSES.includes(record.status) || !isRecord(record.payload) || !isCount(record.revision)) return 'invalid_memory_record';
  return resolutionIssue(record);
}

export function checkMemories(state) {
  const world = state.world;
  const root = world.memories;
  if (!isRecord(root) || root.version !== 1 || !isCount(root.revision) || !isRecord(root.records) || !isRecord(root.ownerIndex)) return fail('memories_invalid_root');
  for (const id of Object.keys(root.records)) {
    const issue = recordIssue(root.records[id], id, world);
    if (issue) return fail('memories_invalid_record', { id, issue });
  }
  if (canonicalJson(root.ownerIndex) !== canonicalJson(buildOwnerIndex(root.records))) return fail('memories_index_mismatch');
  return ok();
}
