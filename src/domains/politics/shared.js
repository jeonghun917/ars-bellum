// Helpers shared by the politics modules: reference lookups across world collections, id lists,
// the metric and day checks every record uses, and the per-character indexes (titleIds, claimIds)
// and affiliations that politics keeps in line with its own records.
//
// Fields of a character record that politics reads or writes (nothing else is touched):
//   read:  identity.alive, condition.incapacitated
//   write: affiliations.clanId, affiliations.factionId, titleIds, claimIds, revision
import { canonicalJson, isRecord } from '../../core/data.js';
import { fail } from '../../core/result.js';

export const RECORD_VERSION = 1;

// Ids already stored by the earlier version may use capital letters; ids made now are lowercase
// (core/ids.js). Stored ids and references are therefore checked with these.
const STORED_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/;
const REF_TYPE = /^[a-z][a-z0-9_.:-]*$/;
export const isStoredId = (value) => typeof value === 'string' && STORED_ID.test(value);
export const isStoredRef = (value) => isRecord(value) && Object.keys(value).length === 2
  && typeof value.type === 'string' && REF_TYPE.test(value.type) && isStoredId(value.id);

// What each kind of reference may be used for (the earlier version's reference-type capabilities).
export const HOLDER_REF_TYPES = Object.freeze(['character', 'clan', 'faction']);
export const SUBJECT_REF_TYPES = Object.freeze(['settlement']);
export const BASIS_REF_TYPES = Object.freeze(['title', 'land_right']);

export const politicsFail = (reason, detail) => fail(`politics_${reason}`, detail);

// Where each reference type lives in the world. Settlements must be world records, as the save-time
// check of the earlier version required for land-right subjects.
export function collectionFor(state, type) {
  const world = state.world;
  if (type === 'character') return world.characters;
  if (type === 'clan') return world.clans;
  if (type === 'faction') return world.factions;
  if (type === 'title') return world.titles;
  if (type === 'land_right') return world.landRights;
  if (type === 'settlement') return world.settlements;
  if (type === 'mobile_group') return world.mobileGroups;
  if (type === 'inventory') return world.inventories;
  if (type === 'account') return world.finance && world.finance.accounts;
  return null;
}

export const has = (object, key) => isRecord(object) && Object.prototype.hasOwnProperty.call(object, key);

export function recordFor(state, reference) {
  if (!isStoredRef(reference)) return null;
  const collection = collectionFor(state, reference.type);
  return has(collection, reference.id) ? collection[reference.id] : null;
}

export const refExists = (state, reference) => recordFor(state, reference) !== null;
export const refKey = (reference) => (reference ? `${reference.type}:${reference.id}` : '');
export const copyRef = (reference) => ({ type: reference.type, id: reference.id });
export const sameRef = (a, b) => !!a && !!b && a.type === b.type && a.id === b.id;
export const sameJson = (a, b) => canonicalJson(a) === canonicalJson(b);
export const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
export const isDayNumber = (value) => Number.isInteger(value) && value >= 0;
export const isCount = isDayNumber;
export const isBoolean = (value) => typeof value === 'boolean';

// A list of distinct ids, kept in the given order. Returns null when the value is not one.
export function idList(value) {
  if (!Array.isArray(value) || !value.every(isStoredId)) return null;
  return new Set(value).size === value.length ? [...value] : null;
}

export const sortedUnique = (list) => [...new Set(list)].sort();

export const getCharacter = (state, id) => (isStoredId(id) && has(state.world.characters, id) ? state.world.characters[id] : null);
export const getClan = (state, id) => (isStoredId(id) && has(state.world.clans, id) ? state.world.clans[id] : null);
export const getFaction = (state, id) => (isStoredId(id) && has(state.world.factions, id) ? state.world.factions[id] : null);
export const getTitle = (state, id) => (isStoredId(id) && has(state.world.titles, id) ? state.world.titles[id] : null);
export const getLandRight = (state, id) => (isStoredId(id) && has(state.world.landRights, id) ? state.world.landRights[id] : null);
export const getAccount = (state, id) => {
  const accounts = state.world.finance && state.world.finance.accounts;
  return isStoredId(id) && has(accounts, id) ? accounts[id] : null;
};

export const isAlive = (character) => isRecord(character) && isRecord(character.identity) && character.identity.alive === true;
export const todayOf = (state) => state.calendar.day;

export function needRecord(input) {
  return isRecord(input) ? null : politicsFail('invalid_input', { field: '$' });
}

// The titles a character holds and the claim rights it holds, as the character record stores them.
// Both indexes follow the record status only (not the day window), so they do not change by
// themselves as days pass.
export function derivedTitleIds(state, characterId) {
  return Object.keys(state.world.titles)
    .filter((id) => {
      const holder = state.world.titles[id].holderRef;
      return holder && holder.type === 'character' && holder.id === characterId;
    })
    .sort();
}

export function derivedClaimIds(state, characterId) {
  return Object.keys(state.world.landRights)
    .filter((id) => {
      const right = state.world.landRights[id];
      return right.rightTypeId === 'claim' && right.status === 'active'
        && right.holderRef && right.holderRef.type === 'character' && right.holderRef.id === characterId;
    })
    .sort();
}

// Brings the stored title and claim indexes of the given characters in line with the records.
// A character whose index changes gets a new revision, as any changed record does.
export function syncCharacterIndexes(draft, characterIds) {
  for (const id of sortedUnique(characterIds)) {
    const character = getCharacter(draft, id);
    if (!character) continue;
    const titleIds = derivedTitleIds(draft, id);
    const claimIds = derivedClaimIds(draft, id);
    if (sameJson(character.titleIds, titleIds) && sameJson(character.claimIds, claimIds)) continue;
    character.titleIds = titleIds;
    character.claimIds = claimIds;
    character.revision += 1;
  }
}

// Sets a character's clan and faction together (a clan always carries its faction with it).
export function setCharacterAffiliation(character, clanId, factionId) {
  const affiliations = character.affiliations;
  if (affiliations.clanId === clanId && affiliations.factionId === factionId) return false;
  affiliations.clanId = clanId;
  affiliations.factionId = factionId;
  character.revision += 1;
  return true;
}

export const characterIdsIn = (...references) => references
  .filter((reference) => reference && reference.type === 'character')
  .map((reference) => reference.id);

export const bump = (record) => {
  record.revision += 1;
};
