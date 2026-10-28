// Characters: creating them, changing who they are, where they stand and whether they live.
// Skills and experience are in progression.js, health and age in condition.js.
//
// Record shape and ids are the earlier version's (see newCharacter in src/game/new-game.js).
// Groups and characters point at each other; the character side of that link is changed only by the
// group rules (src/domains/groups), so a character is never created or moved into a group here.
import { clone, isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import { newCharacter } from '../../game/new-game.js';
import { getDefinition, isStoredId, listDefinitionIds } from '../definitions/index.js';
import { DEFAULT_APTITUDE_VALUE, DEFAULT_SKILL_MAX_LEVEL } from './catalog.js';
import { mergeCondition, readConditionPatch } from './condition.js';
import {
  MAX_NAME_LENGTH, extraKeys, isCount, isIdList, isIdOrNull, isNumber, isStringOrNull, sortedUnique,
} from './shape.js';
import { loadCharacter, touch } from './store.js';

const CREATE_KEYS = ['id', 'identity', 'affiliations', 'aptitudes', 'skills', 'condition', 'standing', 'traits', 'offices', 'location',
  'personalAccountId', 'personalInventoryId', 'customData'];
const CREATE_IDENTITY_KEYS = ['name', 'birthDay', 'cultureId', 'faithId'];
const STANDING_KEYS = ['reputation', 'prestige', 'legitimacy'];

const isName = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_NAME_LENGTH;

function fillCustomDefinitions(draft, character) {
  for (const skillId of listDefinitionIds(draft, 'skill')) {
    if (!Object.hasOwn(character.skills, skillId)) character.skills[skillId] = 0;
    if (!Object.hasOwn(character.progression.skillExperience, skillId)) character.progression.skillExperience[skillId] = 0;
  }
  for (const aptitudeId of listDefinitionIds(draft, 'aptitude')) {
    if (!Object.hasOwn(character.aptitudes, aptitudeId)) character.aptitudes[aptitudeId] = getDefinition(draft, 'aptitude', aptitudeId).defaultValue ?? DEFAULT_APTITUDE_VALUE;
  }
  for (const sourceId of listDefinitionIds(draft, 'growth_source')) {
    if (!Object.hasOwn(character.progression.sourceTotals, sourceId)) character.progression.sourceTotals[sourceId] = 0;
  }
}

function applyStanding(character, standing) {
  if (!isRecord(standing) || extraKeys(standing, STANDING_KEYS).length) return fail('characters_invalid_standing');
  if (!Object.values(standing).every(isNumber)) return fail('characters_invalid_standing');
  Object.assign(character.standing, standing);
  return ok();
}

function applyLevels(draft, character, aptitudes, skills) {
  for (const [id, value] of Object.entries(aptitudes)) {
    if (!getDefinition(draft, 'aptitude', id)) return fail('characters_unknown_aptitude', { id });
    if (!isNumber(value) || value < 0) return fail('characters_invalid_aptitude', { id });
    character.aptitudes[id] = value;
  }
  for (const [id, value] of Object.entries(skills)) {
    const skill = getDefinition(draft, 'skill', id);
    if (!skill) return fail('characters_unknown_skill', { id });
    if (!isNumber(value) || value < 0 || value > (skill.maxLevel ?? DEFAULT_SKILL_MAX_LEVEL)) return fail('characters_invalid_skill_level', { id });
    character.skills[id] = value;
  }
  return ok();
}

function checkLinkedIds(draft, input) {
  if (input.personalAccountId !== undefined && input.personalAccountId !== null
    && !(isStoredId(input.personalAccountId) && Object.hasOwn(draft.world.finance.accounts, input.personalAccountId))) {
    return fail('characters_missing_account', { accountId: input.personalAccountId });
  }
  if (input.personalInventoryId !== undefined && input.personalInventoryId !== null
    && !(isStoredId(input.personalInventoryId) && Object.hasOwn(draft.world.inventories, input.personalInventoryId))) {
    return fail('characters_missing_inventory', { inventoryId: input.personalInventoryId });
  }
  return ok();
}

// Creates a living character with no experience, no titles and no clan or faction (those are given
// by the areas that own them). Everything not given gets the new-character default.
// input: { id, identity: { name, birthDay?, cultureId?, faithId? }, affiliations?: { legalStatusId },
//          aptitudes?, skills?, condition?, standing?, traits?, offices?, location?: { mode, settlementId },
//          personalAccountId?, personalInventoryId?, customData? }
export function createCharacter(draft, input) {
  if (!isRecord(input)) return fail('characters_invalid_input');
  for (const key of Object.keys(input)) {
    if (!CREATE_KEYS.includes(key)) {
      const protectedField = ['titleIds', 'claimIds', 'activity', 'progression'].includes(key);
      return fail(protectedField ? 'characters_protected_field' : 'characters_unknown_field', { key });
    }
  }
  if (!isStoredId(input.id)) return fail('characters_invalid_character_id');
  if (Object.hasOwn(draft.world.characters, input.id)) return fail('characters_duplicate_character', { characterId: input.id });
  const identity = input.identity;
  if (!isRecord(identity) || extraKeys(identity, CREATE_IDENTITY_KEYS).length) return fail('characters_invalid_identity');
  if (!isName(identity.name)) return fail('characters_invalid_name');
  const birthDay = identity.birthDay === undefined ? draft.calendar.day : identity.birthDay;
  if (!isCount(birthDay) || birthDay > draft.calendar.day) return fail('characters_invalid_birth_day');
  for (const key of ['cultureId', 'faithId']) {
    if (identity[key] !== undefined && !isStringOrNull(identity[key])) return fail('characters_invalid_identity');
  }
  const affiliations = input.affiliations === undefined ? {} : input.affiliations;
  if (!isRecord(affiliations)) return fail('characters_invalid_affiliations');
  if (extraKeys(affiliations, ['legalStatusId']).length) {
    return fail(Object.hasOwn(affiliations, 'clanId') || Object.hasOwn(affiliations, 'factionId') ? 'characters_protected_field' : 'characters_invalid_affiliations');
  }
  if (affiliations.legalStatusId !== undefined && !isStringOrNull(affiliations.legalStatusId)) return fail('characters_invalid_affiliations');
  const location = input.location === undefined ? { mode: 'none' } : input.location;
  if (!isRecord(location) || extraKeys(location, ['mode', 'settlementId']).length) return fail('characters_invalid_location');
  if (location.mode === 'mobile_group') return fail('characters_join_group_through_groups');
  if (!['none', 'settlement'].includes(location.mode)) return fail('characters_invalid_location');
  if (location.settlementId !== undefined && !(location.mode === 'settlement' && isStoredId(location.settlementId))) return fail('characters_invalid_location');
  for (const key of ['traits', 'offices']) {
    if (input[key] !== undefined && !isIdList(input[key])) return fail(`characters_invalid_${key}`);
  }
  if (input.customData !== undefined && !isRecord(input.customData)) return fail('characters_invalid_custom_data');
  if (input.aptitudes !== undefined && !isRecord(input.aptitudes)) return fail('characters_invalid_aptitude');
  if (input.skills !== undefined && !isRecord(input.skills)) return fail('characters_invalid_skill_level');
  const linked = checkLinkedIds(draft, input);
  if (!linked.ok) return linked;

  const character = newCharacter({ id: input.id, name: identity.name, birthDay, personalAccountId: input.personalAccountId ?? null });
  fillCustomDefinitions(draft, character);
  character.identity.cultureId = identity.cultureId ?? null;
  character.identity.faithId = identity.faithId ?? null;
  character.affiliations.legalStatusId = affiliations.legalStatusId ?? null;
  character.personalInventoryId = input.personalInventoryId ?? null;
  character.traits = sortedUnique(input.traits ?? []);
  character.offices = sortedUnique(input.offices ?? []);
  character.customData = clone(input.customData ?? {});
  if (location.mode === 'settlement') {
    character.location.mode = 'settlement';
    character.location.settlementId = location.settlementId ?? null;
  }
  const levels = applyLevels(draft, character, input.aptitudes ?? {}, input.skills ?? {});
  if (!levels.ok) return levels;
  const standing = applyStanding(character, input.standing ?? {});
  if (!standing.ok) return standing;
  if (input.condition !== undefined) {
    const read = readConditionPatch(input.condition);
    if (!read.ok) return read;
    character.condition = mergeCondition(character.condition, read.next);
  }
  draft.world.characters[character.id] = character;
  return ok({ characterId: character.id });
}

// Changes name, culture, faith, legal status, standing, traits, offices or free data.
// Only the fields given change. input: { characterId, name?, cultureId?, faithId?, legalStatusId?,
// standing?: { reputation?, prestige?, legitimacy? }, traits?, offices?, customData?, expectedRevision? }
export function updateProfile(draft, input) {
  if (!isRecord(input)) return fail('characters_invalid_input');
  const found = loadCharacter(draft, input.characterId, input.expectedRevision);
  if (!found.ok) return found;
  const allowed = ['characterId', 'expectedRevision', 'name', 'cultureId', 'faithId', 'legalStatusId', 'standing', 'traits', 'offices', 'customData'];
  const unknown = extraKeys(input, allowed);
  if (unknown.length) return fail('characters_unknown_field', { key: unknown[0] });
  if (input.name !== undefined && !isName(input.name)) return fail('characters_invalid_name');
  for (const key of ['cultureId', 'faithId', 'legalStatusId']) {
    if (input[key] !== undefined && !isStringOrNull(input[key])) return fail(`characters_invalid_${key}`);
  }
  for (const key of ['traits', 'offices']) {
    if (input[key] !== undefined && !isIdList(input[key])) return fail(`characters_invalid_${key}`);
  }
  if (input.customData !== undefined && !isRecord(input.customData)) return fail('characters_invalid_custom_data');
  const { character } = found;
  const before = JSON.stringify(character);
  const standing = applyStanding(character, input.standing ?? {});
  if (!standing.ok) return standing;
  if (input.name !== undefined) character.identity.name = input.name;
  if (input.cultureId !== undefined) character.identity.cultureId = input.cultureId;
  if (input.faithId !== undefined) character.identity.faithId = input.faithId;
  if (input.legalStatusId !== undefined) character.affiliations.legalStatusId = input.legalStatusId;
  if (input.traits !== undefined) character.traits = sortedUnique(input.traits);
  if (input.offices !== undefined) character.offices = sortedUnique(input.offices);
  if (input.customData !== undefined) character.customData = clone(input.customData);
  if (JSON.stringify(character) === before) return ok({ changed: false });
  touch(character);
  return ok({ changed: true });
}

// Sets the clan and/or faction a character belongs to (null leaves it). Called by the clan and
// faction rules, which own the membership; a field left out is unchanged.
export function setAffiliations(draft, input) {
  if (!isRecord(input)) return fail('characters_invalid_input');
  const found = loadCharacter(draft, input.characterId, input.expectedRevision);
  if (!found.ok) return found;
  if (extraKeys(input, ['characterId', 'expectedRevision', 'clanId', 'factionId']).length) return fail('characters_unknown_field');
  if (input.clanId === undefined && input.factionId === undefined) return fail('characters_invalid_affiliations');
  const targets = [['clanId', draft.world.clans, 'characters_missing_clan'], ['factionId', draft.world.factions, 'characters_missing_faction']];
  for (const [key, collection, code] of targets) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (!isStoredId(value)) return fail('characters_invalid_affiliations');
    if (!Object.hasOwn(collection, value)) return fail(code, { id: value });
  }
  const { character } = found;
  let changed = false;
  for (const [key] of targets) {
    if (input[key] !== undefined && character.affiliations[key] !== input[key]) {
      character.affiliations[key] = input[key];
      changed = true;
    }
  }
  if (!changed) return ok({ changed: false });
  touch(character);
  return ok({ changed: true });
}

function setIndex(field) {
  return (draft, input) => {
    if (!isRecord(input)) return fail('characters_invalid_input');
    const found = loadCharacter(draft, input.characterId, input.expectedRevision);
    if (!found.ok) return found;
    const ids = input[field];
    if (!isIdList(ids)) return fail(`characters_invalid_${field}`);
    const sorted = sortedUnique(ids);
    const { character } = found;
    if (JSON.stringify(character[field]) === JSON.stringify(sorted)) return ok({ changed: false });
    character[field] = sorted;
    touch(character);
    return ok({ changed: true });
  };
}

// The list of titles a character holds and of claims they have. The title and claim rules own
// these; they are derived lists, rebuilt by those rules and not edited by hand.
export const setTitleIndex = setIndex('titleIds');
export const setClaimIndex = setIndex('claimIds');

// Points a character at their personal account or inventory (null clears it).
export function setPersonalAssets(draft, input) {
  if (!isRecord(input)) return fail('characters_invalid_input');
  const found = loadCharacter(draft, input.characterId, input.expectedRevision);
  if (!found.ok) return found;
  if (extraKeys(input, ['characterId', 'expectedRevision', 'personalAccountId', 'personalInventoryId']).length) return fail('characters_unknown_field');
  if (input.personalAccountId === undefined && input.personalInventoryId === undefined) return fail('characters_invalid_input');
  for (const key of ['personalAccountId', 'personalInventoryId']) {
    if (input[key] !== undefined && !isIdOrNull(input[key])) return fail(`characters_invalid_${key}`);
  }
  const linked = checkLinkedIds(draft, input);
  if (!linked.ok) return linked;
  const { character } = found;
  let changed = false;
  for (const key of ['personalAccountId', 'personalInventoryId']) {
    if (input[key] !== undefined && character[key] !== input[key]) {
      character[key] = input[key];
      changed = true;
    }
  }
  if (!changed) return ok({ changed: false });
  touch(character);
  return ok({ changed: true });
}

// Puts a character who is not travelling with a group into a settlement (or nowhere, with null).
export function placeInSettlement(draft, input) {
  if (!isRecord(input)) return fail('characters_invalid_input');
  const found = loadCharacter(draft, input.characterId, input.expectedRevision);
  if (!found.ok) return found;
  if (!(input.settlementId === null || isStoredId(input.settlementId))) return fail('characters_invalid_settlement_id');
  const { character } = found;
  if (character.location.mode === 'mobile_group') return fail('characters_in_group', { mobileGroupId: character.location.mobileGroupId });
  const mode = input.settlementId === null ? 'none' : 'settlement';
  if (character.location.mode === mode && character.location.settlementId === input.settlementId) return ok({ changed: false });
  character.location.mode = mode;
  character.location.settlementId = input.settlementId;
  touch(character);
  return ok({ changed: true });
}

// The character's side of belonging to a mobile group (null = leaves the group). Only the group
// rules call this, in the same change that edits the group's member list.
export function setGroupLocation(draft, input) {
  if (!isRecord(input)) return fail('characters_invalid_input');
  const found = loadCharacter(draft, input.characterId, input.expectedRevision);
  if (!found.ok) return found;
  const groupId = input.mobileGroupId;
  if (groupId !== null && !isStoredId(groupId)) return fail('characters_invalid_group_id');
  if (groupId !== null && !Object.hasOwn(draft.world.mobileGroups, groupId)) return fail('characters_missing_group', { mobileGroupId: groupId });
  const { character } = found;
  const location = character.location;
  const mode = groupId !== null ? 'mobile_group' : (location.settlementId === null ? 'none' : 'settlement');
  if (location.mobileGroupId === groupId && location.mode === mode) return ok({ changed: false });
  location.mobileGroupId = groupId;
  location.mode = mode;
  touch(character);
  return ok({ changed: true });
}

// Records that a character died. They stay in their group until the group rules take them out.
// input: { characterId, day = today, expectedRevision? }
export function recordDeath(draft, input) {
  if (!isRecord(input)) return fail('characters_invalid_input');
  const found = loadCharacter(draft, input.characterId, input.expectedRevision);
  if (!found.ok) return found;
  const day = input.day === undefined ? draft.calendar.day : input.day;
  const { character } = found;
  if (!isCount(day) || day > draft.calendar.day || day < character.identity.birthDay) return fail('characters_invalid_death_day');
  if (!character.identity.alive) return fail('characters_already_dead', { characterId: character.id });
  character.identity.alive = false;
  character.identity.deathDay = day;
  character.condition.health = 0;
  character.condition.incapacitated = true;
  touch(character);
  return ok({ characterId: character.id, deathDay: day });
}

// ---- reading -------------------------------------------------------------------------------

export function getCharacter(state, characterId) {
  const character = isStoredId(characterId) && Object.hasOwn(state.world.characters, characterId) ? state.world.characters[characterId] : null;
  return character ? clone(character) : null;
}

export const listCharacters = (state) => Object.keys(state.world.characters).sort().map((id) => clone(state.world.characters[id]));

export const isAlive = (state, characterId) => state.world.characters[characterId]?.identity.alive === true;
