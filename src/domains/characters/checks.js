// Save/load checks for world.characters, from the earlier version's character validator and the
// save validator's record and reference checks. Depends on the definitions known in state (skills,
// aptitudes, growth sources) and on which groups, clans, factions, accounts and inventories exist.
import { isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import { getDefinition, isStoredId, isStoredRef, listDefinitionIds } from '../definitions/index.js';
import { DEFAULT_SKILL_MAX_LEVEL } from './catalog.js';
import { CHARACTER_VERSION, LOCATION_MODES, isCount, isIdList, isIdOrNull, isInjury, isNumber, isStringOrNull } from './shape.js';


// Maps each known id of a definition domain to a value taken from its definition.
function knownById(state, domainId, pick) {
  return new Map(listDefinitionIds(state, domainId).map((id) => [id, pick(getDefinition(state, domainId, id))]));
}

function numberMapIssue(map, known, { max = Infinity } = {}) {
  if (!isRecord(map)) return 'not_a_record';
  for (const [id, value] of Object.entries(map)) {
    if (!known.has(id)) return `unregistered:${id}`;
    const limit = max === 'by_definition' ? known.get(id) : max;
    if (!isNumber(value) || value < 0 || value > limit) return `invalid_value:${id}`;
  }
  return null;
}

function progressionIssue(progression, known) {
  if (!isRecord(progression)) return 'invalid_progression';
  const experience = numberMapIssue(progression.skillExperience, known.skills);
  if (experience) return `skill_experience:${experience}`;
  const totals = numberMapIssue(progression.sourceTotals, known.sources);
  if (totals) return `source_totals:${totals}`;
  if (!isRecord(progression.repetition) || !Object.values(progression.repetition).every(isCount)) return 'invalid_repetition';
  if (!Array.isArray(progression.records)) return 'invalid_records';
  for (const entry of progression.records) {
    const valid = isRecord(entry) && known.skills.has(entry.skillDefinitionId) && known.sources.has(entry.sourceTypeId)
      && isNumber(entry.amount) && entry.amount > 0 && (entry.day === null || isCount(entry.day))
      && (entry.sourceRef === null || isStoredRef(entry.sourceRef)) && Array.isArray(entry.tags) && entry.tags.every((tag) => typeof tag === 'string')
      && isRecord(entry.customData);
    if (!valid) return 'invalid_record_entry';
  }
  return null;
}

function identityIssue(identity) {
  if (!isRecord(identity) || typeof identity.name !== 'string' || !isCount(identity.birthDay)) return 'invalid_identity';
  if (typeof identity.alive !== 'boolean' || !isStringOrNull(identity.cultureId) || !isStringOrNull(identity.faithId)) return 'invalid_identity';
  if (identity.alive !== (identity.deathDay === null)) return 'alive_and_death_day_disagree';
  if (identity.deathDay !== null && (!isCount(identity.deathDay) || identity.deathDay < identity.birthDay)) return 'invalid_death_day';
  return null;
}

function conditionIssue(condition) {
  if (!isRecord(condition)) return 'invalid_condition';
  if (!isNumber(condition.health) || condition.health < 0 || condition.health > 100) return 'invalid_health';
  if (!isNumber(condition.fatigue) || condition.fatigue < 0 || condition.fatigue > 100) return 'invalid_fatigue';
  if (typeof condition.wounded !== 'boolean' || typeof condition.incapacitated !== 'boolean') return 'invalid_condition';
  if (!Array.isArray(condition.injuries) || !condition.injuries.every(isInjury)) return 'invalid_injuries';
  return null;
}

function recordIssue(id, record, known, world) {
  if (!isStoredId(id)) return 'invalid_map_key';
  if (!isRecord(record) || record.id !== id) return 'record_id_mismatch';
  if (record.version !== CHARACTER_VERSION) return 'unsupported_version';
  if (!isCount(record.revision)) return 'invalid_revision';
  if (Object.hasOwn(record, 'activity')) return 'legacy_activity_field';
  const identity = identityIssue(record.identity);
  if (identity) return identity;
  const affiliations = record.affiliations;
  if (!isRecord(affiliations) || !isIdOrNull(affiliations.clanId) || !isIdOrNull(affiliations.factionId) || !isStringOrNull(affiliations.legalStatusId)) return 'invalid_affiliations';
  if (affiliations.clanId !== null && !Object.hasOwn(world.clans, affiliations.clanId)) return 'missing_clan';
  if (affiliations.factionId !== null && !Object.hasOwn(world.factions, affiliations.factionId)) return 'missing_faction';
  const condition = conditionIssue(record.condition);
  if (condition) return condition;
  const skills = numberMapIssue(record.skills, known.skills, { max: 'by_definition' });
  if (skills) return `skills:${skills}`;
  const aptitudes = numberMapIssue(record.aptitudes, known.aptitudes);
  if (aptitudes) return `aptitudes:${aptitudes}`;
  const progression = progressionIssue(record.progression, known);
  if (progression) return progression;
  const standing = record.standing;
  if (!isRecord(standing) || !['reputation', 'prestige', 'legitimacy'].every((key) => isNumber(standing[key]))) return 'invalid_standing';
  for (const field of ['claimIds', 'offices', 'titleIds', 'traits']) {
    if (!isIdList(record[field])) return `invalid_${field}`;
  }
  if (!isRecord(record.customData)) return 'invalid_custom_data';
  if (!isIdOrNull(record.personalAccountId) || !isIdOrNull(record.personalInventoryId)) return 'invalid_personal_ids';
  if (record.personalAccountId !== null && !Object.hasOwn(world.finance.accounts, record.personalAccountId)) return 'missing_personal_account';
  if (record.personalInventoryId !== null && !Object.hasOwn(world.inventories, record.personalInventoryId)) return 'missing_personal_inventory';
  return locationIssue(id, record.location, world);
}

// A character in a group is in exactly that group, and that group lists them.
function locationIssue(id, location, world) {
  if (!isRecord(location) || !LOCATION_MODES.includes(location.mode)) return 'invalid_location';
  if (!isIdOrNull(location.mobileGroupId) || !isIdOrNull(location.settlementId) || !isIdOrNull(location.prisonerOfId)) return 'invalid_location';
  if ((location.mode === 'mobile_group') !== (location.mobileGroupId !== null)) return 'location_mode_and_group_disagree';
  if (location.mobileGroupId === null) return null;
  const group = world.mobileGroups[location.mobileGroupId];
  if (!isRecord(group)) return 'missing_group';
  if (!Array.isArray(group.memberCharacterIds) || !group.memberCharacterIds.includes(id)) return 'group_does_not_list_character';
  return null;
}

export function checkCharacters(state) {
  const characters = state.world.characters;
  if (!isRecord(characters)) return fail('characters_invalid_root');
  const known = {
    skills: knownById(state, 'skill', (definition) => definition.maxLevel ?? DEFAULT_SKILL_MAX_LEVEL),
    aptitudes: knownById(state, 'aptitude', () => Infinity),
    sources: knownById(state, 'growth_source', () => Infinity),
  };
  const issues = [];
  for (const id of Object.keys(characters).sort()) {
    const issue = recordIssue(id, characters[id], known, state.world);
    if (issue) issues.push(`${id}:${issue}`);
  }
  return issues.length ? fail('characters_invalid_records', issues) : ok();
}

