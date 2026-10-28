// Directed relationships between two characters: how `from` feels about `to`.
//
// Records are sparse: a pair has a record only once some value differs from zero. Every change
// arrives as an effect with a source event; the effect key (event, pair, reason) is remembered in
// appliedEffects so the same effect delivered twice changes nothing, while a different input under
// the same key is refused.
//
// Record shapes and ids are the earlier version's (ids are sha256 digests of the canonical JSON of
// the pair / effect key), so old saves keep their ids.
import { canonicalJson, isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import { sha256Hex } from '../../core/sha256.js';

// Ids as the earlier version stored them: letters of either case are allowed, so saves with such
// character or event ids keep loading. (New ids are made lowercase by core/ids.js.)
export const isStoredId = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value);

export const RELATION_VALUE_KEYS = Object.freeze(['affection', 'trust', 'respect', 'fear', 'obligation', 'rivalry']);
export const RELATION_VALUE_MIN = -1000;
export const RELATION_VALUE_MAX = 1000;

export const relationId = (fromCharacterId, toCharacterId) => `relation:${sha256Hex(canonicalJson([fromCharacterId, toCharacterId]))}`;

export function relationEffectKey({ sourceEventId, fromCharacterId, toCharacterId, reasonId }) {
  return `relation_effect:${sha256Hex(canonicalJson([sourceEventId, fromCharacterId, toCharacterId, reasonId]))}`;
}

const digestOf = (value) => `sha256:${sha256Hex(canonicalJson(value))}`;
const isDayNumber = (value) => Number.isInteger(value) && value >= 0;

function clampValue(value) {
  return Math.max(RELATION_VALUE_MIN, Math.min(RELATION_VALUE_MAX, value));
}

function zeroValues() {
  return Object.fromEntries(RELATION_VALUE_KEYS.map((key) => [key, 0]));
}

// The index lists, per character, the ids of records from / to that character, sorted.
export function buildRelationIndexes(records) {
  const indexes = { from: {}, to: {} };
  for (const id of Object.keys(records).sort()) {
    const record = records[id];
    (indexes.from[record.fromCharacterId] ??= []).push(id);
    (indexes.to[record.toCharacterId] ??= []).push(id);
  }
  return indexes;
}

function addToIndex(index, characterId, id) {
  const list = index[characterId] ?? [];
  list.push(id);
  list.sort();
  index[characterId] = list;
}

// Turns raw input into the canonical effect input: all six deltas present (missing ones are 0).
// The digest of this canonical input is what appliedEffects remembers, as in the earlier version.
function normalizeDeltaInput(characters, input) {
  if (!isRecord(input)) return fail('relations_invalid_input');
  const { fromCharacterId, toCharacterId, reasonId, sourceEventId, eventDay, deltas } = input;
  if (!isStoredId(fromCharacterId) || !isStoredId(toCharacterId) || !isStoredId(reasonId) || !isStoredId(sourceEventId) || !isDayNumber(eventDay) || !isRecord(deltas)) {
    return fail('relations_invalid_input');
  }
  if (fromCharacterId === toCharacterId) return fail('relations_self_reference');
  if (!isRecord(characters[fromCharacterId]) || !isRecord(characters[toCharacterId])) {
    return fail('relations_missing_character', { fromCharacterId, toCharacterId });
  }
  const normalizedDeltas = zeroValues();
  for (const [key, value] of Object.entries(deltas)) {
    if (!RELATION_VALUE_KEYS.includes(key) || !Number.isSafeInteger(value)) return fail('relations_invalid_delta', { key });
    normalizedDeltas[key] = value;
  }
  return ok({ input: { fromCharacterId, toCharacterId, deltas: normalizedDeltas, reasonId, sourceEventId, eventDay } });
}

// Applies one relationship effect: input { fromCharacterId, toCharacterId, deltas, reasonId,
// sourceEventId, eventDay }. Values are clamped to -1000..1000.
export function applyRelationshipDelta(draft, input) {
  const normalized = normalizeDeltaInput(draft.world.characters, input);
  if (!normalized.ok) return normalized;
  const effect = normalized.input;
  const root = draft.world.relationships;
  const id = relationId(effect.fromCharacterId, effect.toCharacterId);
  const effectKey = relationEffectKey(effect);
  const inputDigest = digestOf(effect);

  const prior = root.appliedEffects[effectKey];
  if (prior) {
    if (prior.inputDigest !== inputDigest) return fail('relations_effect_conflict', { effectKey });
    return ok({ idempotent: true, created: false, effectKey, relationId: prior.relationId });
  }

  const before = root.records[id] ?? null;
  const values = {};
  for (const key of RELATION_VALUE_KEYS) values[key] = clampValue((before ? before.values[key] : 0) + effect.deltas[key]);
  const allZero = RELATION_VALUE_KEYS.every((key) => values[key] === 0);

  // A pair that never had a record and still sums to zero stays sparse: only the effect is kept.
  let storedId = null;
  if (before || !allZero) {
    storedId = id;
    root.records[id] = {
      id,
      fromCharacterId: effect.fromCharacterId,
      toCharacterId: effect.toCharacterId,
      values,
      tags: before ? [...before.tags] : [],
      // As in the earlier version: the day of the latest applied effect, even when it arrives late.
      lastInteractionDay: effect.eventDay,
      lastDecayDay: before ? before.lastDecayDay : effect.eventDay,
      revision: before ? before.revision + 1 : 0,
    };
    if (!before) {
      addToIndex(root.indexes.from, effect.fromCharacterId, id);
      addToIndex(root.indexes.to, effect.toCharacterId, id);
    }
  }
  root.appliedEffects[effectKey] = { inputDigest, relationId: storedId, sourceEventId: effect.sourceEventId, appliedDay: effect.eventDay };
  root.revision += 1;
  return ok({ idempotent: false, created: !before && storedId !== null, effectKey, relationId: storedId });
}

// Reads. They take any state (a draft or the frozen store state) and never change it.
export function getRelationship(state, fromCharacterId, toCharacterId) {
  if (!isStoredId(fromCharacterId) || !isStoredId(toCharacterId)) return null;
  return state.world.relationships.records[relationId(fromCharacterId, toCharacterId)] ?? null;
}

export function listRelationshipsFrom(state, characterId) {
  const root = state.world.relationships;
  return (root.indexes.from[characterId] ?? []).map((id) => root.records[id]);
}

export function listRelationshipsTo(state, characterId) {
  const root = state.world.relationships;
  return (root.indexes.to[characterId] ?? []).map((id) => root.records[id]);
}
