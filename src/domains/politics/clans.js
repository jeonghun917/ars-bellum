// Clans: a family with a head, a succession law and custom, designated successors, inheritance pacts
// and two kinds of strength (what the head may decide, and how far the family really follows).
//
// Record: { id, version, revision, name, cultureId, factionId, headCharacterId, branchClanIds,
// treasuryAccountId, successionLawId, inheritanceCustomId, designatedSuccessorIds, inheritancePacts,
// headPower: { legalAuthority, actualControl }, standing: { prestige, legitimacy, unity }, customData }.
//
// Members, titles, holdings and claims are not stored on the clan: they follow from the characters,
// titles and land rights that point at it (see getClanView). Clan membership itself is changed
// only through affiliation.js, so a character's clan and faction never disagree with the clan's.
import { clone, isRecord } from '../../core/data.js';
import { isId } from '../../core/ids.js';
import { ok } from '../../core/result.js';
import { hasDefinition, getDefinition } from './definitions.js';
import { listSettlementIdsHeldBy } from './land-rights.js';
import { listTitleIdsHeldBy } from './titles.js';
import { validatePactStructure } from './pacts.js';
import {
  RECORD_VERSION, getAccount, getCharacter, getClan, has, idList, isCount, isFiniteNumber, isStoredId, needRecord, politicsFail,
  sameJson, sortedUnique, todayOf,
} from './shared.js';

export const CLAN_DERIVED_FIELDS = Object.freeze(['memberCharacterIds', 'memberClanIds', 'titleIds', 'holdingSettlementIds', 'claimIds']);
export const CLAN_RULE_FIELDS = Object.freeze(['factionId', 'headCharacterId', 'treasuryAccountId']);
export const CLAN_HEAD_POWER_KEYS = Object.freeze(['legalAuthority', 'actualControl']);
export const CLAN_STANDING_KEYS = Object.freeze(['prestige', 'legitimacy', 'unity']);

const metricsProblem = (value, keys) => !isRecord(value) || keys.some((key) => !isFiniteNumber(value[key]));

// Problems with one clan on its own. Cross-record rules (the head is a member, ...) are in checks.js.
export function clanProblems(state, id, record) {
  if (!isRecord(record)) return ['record_not_plain'];
  const problems = [];
  if (record.id !== id) problems.push('record_id_mismatch');
  if (!isStoredId(record.id)) problems.push('invalid_clan_id');
  if (record.version !== RECORD_VERSION) problems.push('unsupported_version');
  if (!isCount(record.revision)) problems.push('invalid_revision');
  if (typeof record.name !== 'string') problems.push('invalid_name');
  for (const field of ['cultureId', 'factionId', 'headCharacterId', 'treasuryAccountId', 'successionLawId', 'inheritanceCustomId']) {
    if (record[field] !== null && !isStoredId(record[field])) problems.push(`invalid_${field}`);
  }
  for (const field of CLAN_DERIVED_FIELDS) {
    if (has(record, field)) problems.push(`derived_field_stored:${field}`);
  }
  if (metricsProblem(record.headPower, CLAN_HEAD_POWER_KEYS)) problems.push('invalid_clan_metric:headPower');
  if (metricsProblem(record.standing, CLAN_STANDING_KEYS)) problems.push('invalid_clan_metric:standing');
  if (record.successionLawId && !hasDefinition(state, 'succession_law', record.successionLawId)) problems.push('unregistered_succession_law');
  if (record.inheritanceCustomId && !hasDefinition(state, 'inheritance_custom', record.inheritanceCustomId)) problems.push('unregistered_inheritance_custom');
  if (idList(record.designatedSuccessorIds) === null) problems.push('invalid_designated_successors');
  if (!Array.isArray(record.branchClanIds) || !record.branchClanIds.every(isStoredId) || !sameJson(record.branchClanIds, sortedUnique(record.branchClanIds))
    || record.branchClanIds.includes(record.id)) problems.push('invalid_branch_clans');
  if (!Array.isArray(record.inheritancePacts)) problems.push('invalid_inheritance_pacts');
  else {
    const ids = new Set();
    for (const pact of record.inheritancePacts) {
      const issue = validatePactStructure(pact);
      if (issue) problems.push(`invalid_pact:${issue}`);
      else if (ids.has(pact.id)) problems.push(`duplicate_pact_id:${pact.id}`);
      else ids.add(pact.id);
    }
  }
  if (!isRecord(record.customData)) problems.push('invalid_custom_data');
  return problems;
}

// The metrics with the given ones changed, or null when the patch is not a record of known finite numbers.
function patchMetrics(current, patch, keys) {
  if (!isRecord(patch)) return null;
  if (Object.keys(patch).some((key) => !keys.includes(key) || !isFiniteNumber(patch[key]))) return null;
  return { ...current, ...patch };
}

// input: { id, name?, cultureId?, successionLawId?, inheritanceCustomId?, headPower?, standing?,
//          designatedSuccessorIds?, inheritancePacts?, customData? }
// The faction, head and treasury are set afterwards through affiliation.js (they need the clan to exist).
export function createClan(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  for (const field of CLAN_DERIVED_FIELDS) if (has(input, field)) return politicsFail('derived_field', { field });
  for (const field of CLAN_RULE_FIELDS) if (has(input, field) && input[field] !== null) return politicsFail('field_set_by_rule', { field });
  if (!isId(input.id)) return politicsFail('invalid_clan_id');
  if (has(draft.world.clans, input.id)) return politicsFail('duplicate_clan_id', { id: input.id });
  const headPower = patchMetrics({ legalAuthority: 0, actualControl: 0 }, input.headPower === undefined ? {} : input.headPower, CLAN_HEAD_POWER_KEYS);
  const standing = patchMetrics({ prestige: 0, legitimacy: 0, unity: 0 }, input.standing === undefined ? {} : input.standing, CLAN_STANDING_KEYS);
  const successors = input.designatedSuccessorIds === undefined ? [] : idList(input.designatedSuccessorIds);
  if (!headPower || !standing) return politicsFail('invalid_clan_metric');
  if (successors === null) return politicsFail('invalid_designated_successors');
  if (successors.some((characterId) => !getCharacter(draft, characterId))) return politicsFail('missing_character', { field: 'designatedSuccessorIds' });
  const record = {
    id: input.id,
    version: RECORD_VERSION,
    revision: 0,
    name: input.name === undefined ? '' : input.name,
    cultureId: input.cultureId === undefined ? null : input.cultureId,
    factionId: null,
    headCharacterId: null,
    branchClanIds: [],
    treasuryAccountId: null,
    successionLawId: input.successionLawId === undefined ? null : input.successionLawId,
    inheritanceCustomId: input.inheritanceCustomId === undefined ? null : input.inheritanceCustomId,
    designatedSuccessorIds: successors,
    inheritancePacts: input.inheritancePacts === undefined ? [] : clone(input.inheritancePacts),
    headPower,
    standing,
    customData: input.customData === undefined ? {} : clone(input.customData),
  };
  const problems = clanProblems(draft, record.id, record);
  if (problems.length) return politicsFail('invalid_clan', { id: record.id, problems });
  draft.world.clans[record.id] = record;
  return ok({ clanId: record.id });
}

function loadClan(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  const clan = getClan(draft, input.clanId);
  return clan ? ok({ clan }) : politicsFail('missing_clan', { clanId: input.clanId });
}

function finish(clan, next) {
  if (sameJson({ ...clan, revision: 0 }, { ...next, revision: 0 })) return politicsFail('no_change');
  Object.assign(clan, next, { revision: clan.revision + 1 });
  return ok({ clanId: clan.id });
}

// Changes some of the head's two strengths and/or the clan's three standings.
// input: { clanId, headPower?: { legalAuthority?, actualControl? }, standing?: { prestige?, legitimacy?, unity? } }
export function setClanMetrics(draft, input) {
  const found = loadClan(draft, input);
  if (!found.ok) return found;
  if (input.headPower === undefined && input.standing === undefined) return politicsFail('invalid_input', { field: 'headPower/standing' });
  const next = clone(found.clan);
  if (input.headPower !== undefined) {
    next.headPower = patchMetrics(found.clan.headPower, input.headPower, CLAN_HEAD_POWER_KEYS);
    if (!next.headPower) return politicsFail('invalid_clan_metric', { field: 'headPower' });
  }
  if (input.standing !== undefined) {
    next.standing = patchMetrics(found.clan.standing, input.standing, CLAN_STANDING_KEYS);
    if (!next.standing) return politicsFail('invalid_clan_metric', { field: 'standing' });
  }
  return finish(found.clan, next);
}

// input: { clanId, successionLawId?: id | null, inheritanceCustomId?: id | null } (only given fields change)
export function setClanLaws(draft, input) {
  const found = loadClan(draft, input);
  if (!found.ok) return found;
  const next = clone(found.clan);
  let given = 0;
  if (has(input, 'successionLawId')) {
    given += 1;
    if (input.successionLawId !== null && !hasDefinition(draft, 'succession_law', input.successionLawId)) return politicsFail('unregistered_succession_law', { successionLawId: input.successionLawId });
    next.successionLawId = input.successionLawId;
  }
  if (has(input, 'inheritanceCustomId')) {
    given += 1;
    if (input.inheritanceCustomId !== null && !hasDefinition(draft, 'inheritance_custom', input.inheritanceCustomId)) return politicsFail('unregistered_inheritance_custom', { inheritanceCustomId: input.inheritanceCustomId });
    next.inheritanceCustomId = input.inheritanceCustomId;
  }
  if (!given) return politicsFail('invalid_input', { field: 'successionLawId/inheritanceCustomId' });
  return finish(found.clan, next);
}

// The designated successors in priority order (first is preferred). Keeping the given order is the
// point of the list: the earlier version sorted it by id, which lost the priority.
// input: { clanId, characterIds: [id, ...] }
export function setDesignatedSuccessors(draft, input) {
  const found = loadClan(draft, input);
  if (!found.ok) return found;
  const ids = idList(input.characterIds);
  if (ids === null) return politicsFail('invalid_designated_successors');
  const missing = ids.find((characterId) => !getCharacter(draft, characterId));
  if (missing) return politicsFail('missing_character', { characterId: missing });
  const next = clone(found.clan);
  next.designatedSuccessorIds = ids;
  return finish(found.clan, next);
}

// input: { clanId, branchClanIds }. A clan cannot branch from itself or from its own descendants.
export function setBranchClans(draft, input) {
  const found = loadClan(draft, input);
  if (!found.ok) return found;
  const ids = idList(input.branchClanIds);
  if (ids === null) return politicsFail('invalid_branch_clans');
  if (ids.includes(found.clan.id)) return politicsFail('clan_branch_cycle', { clanId: found.clan.id });
  const missing = ids.find((clanId) => !getClan(draft, clanId));
  if (missing) return politicsFail('missing_clan', { clanId: missing });
  // A branch must not already have this clan among its own branches, at any depth.
  const reach = new Set();
  const walk = (clanId) => {
    for (const child of getClan(draft, clanId).branchClanIds) {
      if (!reach.has(child) && getClan(draft, child)) {
        reach.add(child);
        walk(child);
      }
    }
  };
  for (const branchId of ids) walk(branchId);
  if (reach.has(found.clan.id)) return politicsFail('clan_branch_cycle', { clanId: found.clan.id });
  const next = clone(found.clan);
  next.branchClanIds = sortedUnique(ids);
  return finish(found.clan, next);
}

// Replaces the clan's inheritance pacts. A pact must be well formed; an `active` one needs every
// consent and approval given. input: { clanId, pacts }
export function setInheritancePacts(draft, input) {
  const found = loadClan(draft, input);
  if (!found.ok) return found;
  if (!Array.isArray(input.pacts)) return politicsFail('invalid_inheritance_pacts');
  const ids = new Set();
  for (const pact of input.pacts) {
    const issue = validatePactStructure(pact);
    if (issue) return politicsFail('invalid_pact', { issue });
    if (ids.has(pact.id)) return politicsFail('duplicate_pact_id', { id: pact.id });
    ids.add(pact.id);
  }
  const custom = found.clan.inheritanceCustomId ? getDefinition(draft, 'inheritance_custom', found.clan.inheritanceCustomId) : null;
  if (custom && custom.allowsPacts === false && input.pacts.length) return politicsFail('pacts_not_allowed', { inheritanceCustomId: custom.id });
  const next = clone(found.clan);
  next.inheritancePacts = clone(input.pacts);
  return finish(found.clan, next);
}

// ---------------------------------------------------------------------------------------------
// Queries

export function listClanMemberIds(state, clanId) {
  return Object.keys(state.world.characters)
    .filter((id) => state.world.characters[id].affiliations && state.world.characters[id].affiliations.clanId === clanId)
    .sort();
}

// The clan with what follows from other records: its members, the titles it holds and the
// settlements it holds (`holding`) or claims (`claim`) on `day` (default today). A right that ended
// or was replaced no longer counts; the earlier version listed those too.
export function getClanView(state, clanId, day = undefined) {
  const clan = getClan(state, clanId);
  if (!clan) return null;
  const holder = { type: 'clan', id: clanId };
  return {
    ...clone(clan),
    memberCharacterIds: listClanMemberIds(state, clanId),
    titleIds: listTitleIdsHeldBy(state, holder),
    holdingSettlementIds: listSettlementIdsHeldBy(state, holder, 'holding', day === undefined ? todayOf(state) : day),
    claimIds: listSettlementIdsHeldBy(state, holder, 'claim', day === undefined ? todayOf(state) : day),
  };
}

export const treasuryOwnerMatches = (state, accountId, ownerType, ownerId) => {
  const account = getAccount(state, accountId);
  return !!account && !!account.ownerRef && account.ownerRef.type === ownerType && account.ownerRef.id === ownerId;
};
