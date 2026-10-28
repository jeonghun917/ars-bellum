// Typed references: { type, id } pointing at a record somewhere in the world.
//
// The earlier version asked each owning area for a resolver at load time. Here the reference types
// are listed once, with the collection each one lives in, so a reference can be checked against any
// state without registering anything.
import { isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import { getDefinition, isDefinitionId, isStoredId } from './registry.js';

const REF_COLLECTIONS = Object.freeze({
  character: (world) => world.characters,
  mobile_group: (world) => world.mobileGroups,
  clan: (world) => world.clans,
  faction: (world) => world.factions,
  title: (world) => world.titles,
  settlement: (world) => world.settlements,
  land_right: (world) => world.landRights,
  account: (world) => world.finance?.accounts,
  inventory: (world) => world.inventories,
});

export const REF_TYPES = Object.freeze(Object.keys(REF_COLLECTIONS).sort());

// A reference as stored: lowercase type, stored-style id (earlier saves have mixed-case ids), exactly two keys.
export const isStoredRef = (value) => isRecord(value) && Object.keys(value).length === 2
  && isDefinitionId(value.type) && isStoredId(value.id);

export function findRefTarget(state, ref) {
  if (!isStoredRef(ref) || !Object.hasOwn(REF_COLLECTIONS, ref.type) || !isRecord(state?.world)) return null;
  const collection = REF_COLLECTIONS[ref.type](state.world);
  return isRecord(collection) && Object.hasOwn(collection, ref.id) ? collection[ref.id] : null;
}

export const refExists = (state, ref) => findRefTarget(state, ref) !== null;

// Checks that a reference is well formed, points at a record that exists, and (when a capability tag
// is given) that its type may be used that way. Capabilities come from the "owner_ref_type"
// definitions, e.g. only types tagged "can_own_account" may own an account.
export function checkRef(state, ref, capabilityTag = null) {
  if (!isStoredRef(ref)) return fail('definitions_invalid_ref');
  if (!Object.hasOwn(REF_COLLECTIONS, ref.type)) return fail('definitions_unknown_ref_type', { type: ref.type });
  if (capabilityTag !== null) {
    if (!isDefinitionId(capabilityTag)) return fail('definitions_invalid_capability_tag');
    const definition = getDefinition(state, 'owner_ref_type', ref.type);
    if (!definition) return fail('definitions_missing_ref_type_definition', { type: ref.type });
    const tags = Array.isArray(definition.capabilityTags) ? definition.capabilityTags : [];
    if (!tags.includes(capabilityTag)) return fail('definitions_ref_capability_denied', { type: ref.type, capabilityTag });
  }
  if (!refExists(state, ref)) return fail('definitions_missing_ref_target', { type: ref.type, id: ref.id });
  return ok({ ref: { type: ref.type, id: ref.id } });
}
