// Record checks for world.relationships, from the earlier version's root and save validators.
// Depends on world.characters only for which character ids exist.
import { canonicalJson, isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import { RELATION_VALUE_KEYS, RELATION_VALUE_MAX, RELATION_VALUE_MIN, buildRelationIndexes, isStoredId, relationId } from './rules.js';

const isCount = (value) => Number.isInteger(value) && value >= 0;
const isSortedUniqueIds = (list) => Array.isArray(list) && list.every(isStoredId)
  && canonicalJson(list) === canonicalJson([...new Set(list)].sort());

function recordIssue(record, id, characters) {
  if (!isRecord(record) || record.id !== id || id !== relationId(record.fromCharacterId, record.toCharacterId)) return 'invalid_relation_id';
  if (!isStoredId(record.fromCharacterId) || !isStoredId(record.toCharacterId) || record.fromCharacterId === record.toCharacterId) return 'invalid_character_reference';
  if (!isRecord(characters[record.fromCharacterId]) || !isRecord(characters[record.toCharacterId])) return 'missing_character';
  const values = record.values;
  if (!isRecord(values) || Object.keys(values).sort().join(',') !== [...RELATION_VALUE_KEYS].sort().join(',')) return 'invalid_values';
  if (RELATION_VALUE_KEYS.some((key) => !Number.isInteger(values[key]) || values[key] < RELATION_VALUE_MIN || values[key] > RELATION_VALUE_MAX)) return 'invalid_values';
  if (!isSortedUniqueIds(record.tags)) return 'invalid_tags';
  if (!isCount(record.lastInteractionDay) || !isCount(record.lastDecayDay) || !isCount(record.revision)) return 'invalid_revision_or_day';
  return null;
}

function effectIssue(key, effect, records) {
  if (!/^relation_effect:[0-9a-f]{64}$/.test(key) || !isRecord(effect)) return 'invalid_effect';
  if (typeof effect.inputDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(effect.inputDigest)) return 'invalid_effect';
  if (!isStoredId(effect.sourceEventId) || !isCount(effect.appliedDay)) return 'invalid_effect';
  if (effect.relationId !== null && !isRecord(records[effect.relationId])) return 'invalid_effect_relation';
  return null;
}

export function checkRelations(state) {
  const root = state.world.relationships;
  if (!isRecord(root) || root.version !== 1 || !isCount(root.revision) || !isRecord(root.records) || !isRecord(root.appliedEffects)
    || !isRecord(root.indexes) || !isRecord(root.indexes.from) || !isRecord(root.indexes.to) || Object.keys(root.indexes).length !== 2) {
    return fail('relations_invalid_root');
  }
  const characters = state.world.characters;
  for (const id of Object.keys(root.records)) {
    const issue = recordIssue(root.records[id], id, characters);
    if (issue) return fail('relations_invalid_record', { id, issue });
  }
  if (canonicalJson(root.indexes) !== canonicalJson(buildRelationIndexes(root.records))) return fail('relations_index_mismatch');
  for (const key of Object.keys(root.appliedEffects)) {
    const issue = effectIssue(key, root.appliedEffects[key], root.records);
    if (issue) return fail('relations_invalid_effect', { key, issue });
  }
  return ok();
}
