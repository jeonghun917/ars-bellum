// Factions: a realm, league, tribe or city-state, with a ruler, a ruling clan, a treasury, laws and
// the crown's power on four axes (0..100): legal authority (what law lets the ruler do),
// administrative control (orders reaching, taxes, appointments), coercive power (own troops,
// fortresses, loyal forces) and political support (nobles, clergy, towns, officials, army).
//
// Record: { id, version, revision, factionTypeId, name, rulerCharacterId, rulingClanId,
// treasuryAccountId, lawIds, sovereignPower: { legalAuthority, administrativeControl, coercivePower,
// politicalSupport }, customData }.
//
// Member clans and settlements are not stored: they follow from the clans' factionId and the land
// rights (see getFactionView). The ruler, ruling clan and treasury are set through affiliation.js.
import { canonicalJson, clone, deepFreeze, isRecord } from '../../core/data.js';
import { isId } from '../../core/ids.js';
import { ok } from '../../core/result.js';
import { hasDefinition } from './definitions.js';
import { listSettlementIdsByHolder } from './land-rights.js';
import {
  RECORD_VERSION, getFaction, has, idList, isCount, isFiniteNumber, isStoredId, isStoredRef, needRecord, politicsFail, recordFor, sameJson,
  sortedUnique, todayOf,
} from './shared.js';

export const SOVEREIGN_POWER_KEYS = Object.freeze(['legalAuthority', 'administrativeControl', 'coercivePower', 'politicalSupport']);
export const FACTION_DERIVED_FIELDS = Object.freeze(['memberClanIds', 'settlementIds']);
export const FACTION_RULE_FIELDS = Object.freeze(['rulerCharacterId', 'rulingClanId', 'treasuryAccountId']);
export const POWER_MIN = 0;
export const POWER_MAX = 100;

const inRange = (value) => isFiniteNumber(value) && value >= POWER_MIN && value <= POWER_MAX;

export function factionProblems(state, id, record) {
  if (!isRecord(record)) return ['record_not_plain'];
  const problems = [];
  if (record.id !== id) problems.push('record_id_mismatch');
  if (!isStoredId(record.id)) problems.push('invalid_faction_id');
  if (record.version !== RECORD_VERSION) problems.push('unsupported_version');
  if (!isCount(record.revision)) problems.push('invalid_revision');
  if (typeof record.name !== 'string') problems.push('invalid_name');
  if (!hasDefinition(state, 'faction_type', record.factionTypeId)) problems.push('unregistered_faction_type');
  for (const field of FACTION_RULE_FIELDS) {
    if (record[field] !== null && !isStoredId(record[field])) problems.push(`invalid_${field}`);
  }
  for (const field of FACTION_DERIVED_FIELDS) {
    if (has(record, field)) problems.push(`derived_field_stored:${field}`);
  }
  if (!Array.isArray(record.lawIds) || !record.lawIds.every(isStoredId) || !sameJson(record.lawIds, sortedUnique(record.lawIds))) problems.push('invalid_law_ids');
  const power = record.sovereignPower;
  if (!isRecord(power)) problems.push('invalid_faction_power');
  else for (const key of SOVEREIGN_POWER_KEYS) if (!inRange(power[key])) problems.push(`invalid_faction_power:${key}`);
  if (!isRecord(record.customData)) problems.push('invalid_custom_data');
  return problems;
}

function powerPatch(current, patch) {
  if (!isRecord(patch) || Object.keys(patch).some((key) => !SOVEREIGN_POWER_KEYS.includes(key))) return null;
  return { ...current, ...patch };
}

// input: { id, name?, factionTypeId? (default 'realm'), lawIds?, sovereignPower?, customData? }
export function createFaction(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  for (const field of FACTION_DERIVED_FIELDS) if (has(input, field)) return politicsFail('derived_field', { field });
  for (const field of FACTION_RULE_FIELDS) if (has(input, field) && input[field] !== null) return politicsFail('field_set_by_rule', { field });
  if (!isId(input.id)) return politicsFail('invalid_faction_id');
  if (has(draft.world.factions, input.id)) return politicsFail('duplicate_faction_id', { id: input.id });
  const lawIds = input.lawIds === undefined ? [] : idList(input.lawIds);
  if (lawIds === null) return politicsFail('invalid_law_ids');
  const power = powerPatch({ legalAuthority: 0, administrativeControl: 0, coercivePower: 0, politicalSupport: 0 }, input.sovereignPower === undefined ? {} : input.sovereignPower);
  if (!power) return politicsFail('invalid_faction_power');
  const record = {
    id: input.id,
    version: RECORD_VERSION,
    revision: 0,
    factionTypeId: input.factionTypeId === undefined ? 'realm' : input.factionTypeId,
    name: input.name === undefined ? '' : input.name,
    rulerCharacterId: null,
    rulingClanId: null,
    treasuryAccountId: null,
    lawIds: sortedUnique(lawIds),
    sovereignPower: power,
    customData: input.customData === undefined ? {} : clone(input.customData),
  };
  const problems = factionProblems(draft, record.id, record);
  if (problems.length) return politicsFail('invalid_faction', { id: record.id, problems });
  draft.world.factions[record.id] = record;
  return ok({ factionId: record.id });
}

function loadFaction(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  const faction = getFaction(draft, input.factionId);
  return faction ? ok({ faction }) : politicsFail('missing_faction', { factionId: input.factionId });
}

function finish(draft, faction, next) {
  const problems = factionProblems(draft, next.id, next);
  if (problems.length) return politicsFail('invalid_faction', { id: next.id, problems });
  if (sameJson({ ...faction, revision: 0 }, { ...next, revision: 0 })) return politicsFail('no_change');
  Object.assign(faction, next, { revision: faction.revision + 1 });
  return ok({ factionId: faction.id });
}

// Sets some of the four axes; every axis must stay within 0..100. input: { factionId, power: { axis: value } }
export function setSovereignPower(draft, input) {
  const found = loadFaction(draft, input);
  if (!found.ok) return found;
  const next = clone(found.faction);
  next.sovereignPower = powerPatch(found.faction.sovereignPower, input.power);
  if (!next.sovereignPower || Object.keys(input.power).length === 0) return politicsFail('invalid_faction_power');
  if (SOVEREIGN_POWER_KEYS.some((key) => !inRange(next.sovereignPower[key]))) return politicsFail('invalid_faction_power', { range: [POWER_MIN, POWER_MAX] });
  return finish(draft, found.faction, next);
}

// Moves axes up or down by the given amounts, stopping at 0 and 100. input: { factionId, deltas: { axis: amount } }
export function adjustSovereignPower(draft, input) {
  const found = loadFaction(draft, input);
  if (!found.ok) return found;
  const deltas = input.deltas;
  if (!isRecord(deltas) || Object.keys(deltas).length === 0 || Object.keys(deltas).some((key) => !SOVEREIGN_POWER_KEYS.includes(key) || !isFiniteNumber(deltas[key]))) {
    return politicsFail('invalid_faction_power');
  }
  const next = clone(found.faction);
  for (const [key, delta] of Object.entries(deltas)) {
    next.sovereignPower[key] = Math.min(POWER_MAX, Math.max(POWER_MIN, next.sovereignPower[key] + delta));
  }
  return finish(draft, found.faction, next);
}

// input: { factionId, lawIds }
export function setFactionLaws(draft, input) {
  const found = loadFaction(draft, input);
  if (!found.ok) return found;
  const ids = idList(input.lawIds);
  if (ids === null) return politicsFail('invalid_law_ids');
  const next = clone(found.faction);
  next.lawIds = sortedUnique(ids);
  return finish(draft, found.faction, next);
}

// ---------------------------------------------------------------------------------------------
// Queries

export function listFactionClanIds(state, factionId) {
  return Object.keys(state.world.clans).filter((id) => state.world.clans[id].factionId === factionId).sort();
}

// The faction with its member clans and the settlements where it holds a counting right
// (rule, administration, suzerainty, military occupation) on `day` (default today).
export function getFactionView(state, factionId, day = undefined) {
  const faction = getFaction(state, factionId);
  if (!faction) return null;
  return {
    ...clone(faction),
    memberClanIds: listFactionClanIds(state, factionId),
    settlementIds: listSettlementIdsByHolder(state, { type: 'faction', id: factionId }, null, day === undefined ? todayOf(state) : day),
  };
}

const METRIC_GROUPS = ['targetDisposition', 'targetCapacity', 'localContext', 'commandContext'];

function metricGroupProblem(group) {
  return isRecord(group) && Object.values(group).every(inRange) ? null : 'invalid_obedience_value';
}

// Builds the fixed input for judging whether a target obeys a faction's order: the faction's four
// axes (taken from state) next to the target's side, all of which the caller supplies. It only
// gathers and checks; the judgement itself belongs to the later political AI.
// input: { factionRef, targetRef, sourceRevisions: { faction, target }, targetDisposition,
//          targetCapacity, legalContext: { contractRefs?, privilegeRefs?, immunityRefs? }, localContext, commandContext }
// The result is deep-frozen and in canonical key order.
export function buildObedienceInput(state, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  for (const key of ['factionRef', 'targetRef', 'sourceRevisions', 'targetDisposition', 'targetCapacity', 'legalContext', 'localContext', 'commandContext']) {
    if (input[key] === undefined || input[key] === null) return politicsFail('missing_obedience_input', { field: key });
  }
  if (!isStoredRef(input.factionRef) || input.factionRef.type !== 'faction') return politicsFail('invalid_obedience_value', { field: 'factionRef' });
  const faction = getFaction(state, input.factionRef.id);
  const target = recordFor(state, input.targetRef);
  if (!faction || !target) return politicsFail('missing_ref_target', { factionRef: input.factionRef, targetRef: input.targetRef });
  if (!isRecord(input.sourceRevisions) || input.sourceRevisions.faction !== faction.revision || input.sourceRevisions.target !== target.revision) return politicsFail('revision_conflict');
  for (const group of METRIC_GROUPS) {
    if (metricGroupProblem(input[group])) return politicsFail('invalid_obedience_value', { field: group });
  }
  const legal = input.legalContext;
  for (const key of ['contractRefs', 'privilegeRefs', 'immunityRefs']) {
    if (legal[key] !== undefined && (!Array.isArray(legal[key]) || !legal[key].every(isStoredRef))) return politicsFail('invalid_obedience_value', { field: `legalContext.${key}` });
  }
  const result = {
    version: 1,
    factionRef: clone(input.factionRef),
    targetRef: clone(input.targetRef),
    sourceRevisions: clone(input.sourceRevisions),
    factionPower: clone(faction.sovereignPower),
    targetDisposition: clone(input.targetDisposition),
    targetCapacity: clone(input.targetCapacity),
    legalContext: { contractRefs: clone(legal.contractRefs || []), privilegeRefs: clone(legal.privilegeRefs || []), immunityRefs: clone(legal.immunityRefs || []) },
    localContext: clone(input.localContext),
    commandContext: clone(input.commandContext),
  };
  return ok({ value: deepFreeze(JSON.parse(canonicalJson(result))) });
}
