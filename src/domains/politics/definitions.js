// The kinds of factions, titles, title statuses, land rights, succession laws, inheritance customs
// and succession result tags. The built-in ones are those the earlier version shipped; approved
// custom definitions in world.customDefinitions add to them (record key "<domain>:<id>", data in
// definitionData).
//
// The definitions area keeps its own domain registry; DEFINITION_DOMAIN_SPECS has these domains in
// the shape its registerDefinitionDomain takes, so wiring them in later is one call per domain.
// This module does not import that area: reading a definition here only needs world state.
import { clone, deepFreeze, isRecord } from '../../core/data.js';
import { isStoredId, has } from './shared.js';
import { POLICY_IDS } from './policies.js';

const LAND_RIGHT_TEMPLATE = {
  allowedSubjectRefTypes: ['settlement'],
  allowedHolderRefTypes: ['character', 'clan', 'faction'],
  allowedBasisRefTypes: ['title', 'land_right'],
  basisRequired: false,
  shareMode: 'single',
  overlapMode: 'deny_same_holder',
  transferable: true,
  inheritable: true,
  countsTowardFactionSettlementIndex: false,
};

const TITLE_TYPE_TEMPLATE = {
  allowedHolderRefTypes: ['character', 'clan', 'faction'],
  allowedParentTitleTypeIds: [],
  defaultStatusId: 'vacant',
  allowRoot: true,
  inheritable: true,
  transferable: true,
};

const TITLE_STATUS_TEMPLATE = { holderMode: 'optional', terminal: false, allowedNextStatusIds: [], allowsHolderChange: false, allowsParentChange: false };

const DEFAULT_POLICIES = {
  evaluatorPolicyId: 'm1.ordered_candidates.v1',
  eligibilityPolicyId: 'm1.alive_eligible.v1',
  inheritancePolicyId: 'm1.pact_then_legal_first.v1',
  policyParams: {},
};

const named = (id, rest) => ({ id, version: 1, name: id, customData: {}, ...rest });
const list = (items) => Object.fromEntries(items.map((item) => [item.id, item]));

const BUILT_IN = deepFreeze({
  faction_type: list(['realm', 'league', 'tribe', 'city_state'].map((id) => named(id))),
  title_status: list([
    named('active', { holderMode: 'required', terminal: false, allowedNextStatusIds: ['active', 'vacant', 'extinct'], allowsHolderChange: true, allowsParentChange: true }),
    named('vacant', { holderMode: 'forbidden', terminal: false, allowedNextStatusIds: ['vacant', 'active', 'extinct'], allowsHolderChange: false, allowsParentChange: true }),
    named('extinct', { holderMode: 'forbidden', terminal: true, allowedNextStatusIds: [], allowsHolderChange: false, allowsParentChange: false }),
  ]),
  title_type: list([
    named('generic_title', { ...TITLE_TYPE_TEMPLATE, name: 'generic title', allowedParentTitleTypeIds: ['generic_title'] }),
  ]),
  land_right_type: list([
    named('rule', { ...LAND_RIGHT_TEMPLATE, countsTowardFactionSettlementIndex: true, overlapMode: 'deny_any' }),
    named('administration', { ...LAND_RIGHT_TEMPLATE, countsTowardFactionSettlementIndex: true, overlapMode: 'deny_any' }),
    named('suzerainty', { ...LAND_RIGHT_TEMPLATE, countsTowardFactionSettlementIndex: true, overlapMode: 'allow' }),
    named('military_occupation', { ...LAND_RIGHT_TEMPLATE, countsTowardFactionSettlementIndex: true, overlapMode: 'deny_any', inheritable: false }),
    named('legal_ownership', { ...LAND_RIGHT_TEMPLATE, shareMode: 'fractional', overlapMode: 'fractional_sum' }),
    named('holding', { ...LAND_RIGHT_TEMPLATE, overlapMode: 'deny_same_holder' }),
    named('revenue', { ...LAND_RIGHT_TEMPLATE, shareMode: 'fractional', overlapMode: 'fractional_sum' }),
    named('claim', { ...LAND_RIGHT_TEMPLATE, overlapMode: 'allow', transferable: false }),
  ]),
  succession_law: list([
    named('m1.default_succession', { ...DEFAULT_POLICIES, name: 'default succession', legalHeirOrderSource: 'caller', fallbackToFirstLegalHeir: true }),
  ]),
  inheritance_custom: list([
    named('m1.default_inheritance', {
      ...DEFAULT_POLICIES, name: 'default inheritance', allowsPacts: true, requiredConsentRoles: [], requiredApprovalRoles: [], expectedShareMode: 'bps',
    }),
  ]),
  succession_result_tag: list(
    ['pact_applied', 'legal_fallback', 'clan_head_changed', 'player_control_changed', 'title_inherited', 'rights_transferred'].map((id) => named(id)),
  ),
});

// What a custom definition gets for the fields it leaves out.
const TEMPLATES = {
  faction_type: {},
  title_status: TITLE_STATUS_TEMPLATE,
  title_type: TITLE_TYPE_TEMPLATE,
  land_right_type: LAND_RIGHT_TEMPLATE,
  succession_law: { ...DEFAULT_POLICIES, fallbackToFirstLegalHeir: true },
  inheritance_custom: { ...DEFAULT_POLICIES, allowsPacts: true, requiredConsentRoles: [], requiredApprovalRoles: [] },
  succession_result_tag: {},
};

const isIdArray = (value) => Array.isArray(value) && value.every(isStoredId);
const isBool = (value) => typeof value === 'boolean';

function policyProblems(d) {
  const problems = [];
  if (!POLICY_IDS.evaluator.includes(d.evaluatorPolicyId)) problems.push(`missing_policy:${d.evaluatorPolicyId}`);
  if (!POLICY_IDS.eligibility.includes(d.eligibilityPolicyId)) problems.push(`missing_policy:${d.eligibilityPolicyId}`);
  if (!POLICY_IDS.inheritance.includes(d.inheritancePolicyId)) problems.push(`missing_policy:${d.inheritancePolicyId}`);
  if (!isRecord(d.policyParams)) problems.push('invalid_policy_params');
  return problems;
}

// Same requirements the earlier version's definition registry put on each domain. Each returns a
// list of problem codes (empty when the definition is fine); `has(domain, id)` says whether another
// definition is known.
const PROBLEMS = {
  faction_type: () => [],
  succession_result_tag: () => [],
  title_status: (d) => {
    const problems = [];
    if (!['required', 'forbidden', 'optional'].includes(d.holderMode)) problems.push('invalid_holder_mode');
    if (!isBool(d.terminal)) problems.push('invalid_terminal');
    if (!isIdArray(d.allowedNextStatusIds)) problems.push('invalid_allowed_statuses');
    if (!isBool(d.allowsHolderChange) || !isBool(d.allowsParentChange)) problems.push('invalid_status_flags');
    return problems;
  },
  title_type: (d, known) => {
    const problems = [];
    if (!isIdArray(d.allowedHolderRefTypes)) problems.push('invalid_allowed_holder_types');
    if (!isIdArray(d.allowedParentTitleTypeIds)) problems.push('invalid_allowed_parent_types');
    if (!known('title_status', d.defaultStatusId)) problems.push('missing_default_status');
    if (!isBool(d.allowRoot) || !isBool(d.inheritable) || !isBool(d.transferable)) problems.push('invalid_title_flags');
    return problems;
  },
  land_right_type: (d) => {
    const problems = [];
    if (!isIdArray(d.allowedSubjectRefTypes)) problems.push('invalid_subject_types');
    if (!isIdArray(d.allowedHolderRefTypes)) problems.push('invalid_holder_types');
    if (!isIdArray(d.allowedBasisRefTypes)) problems.push('invalid_basis_types');
    if (!isBool(d.basisRequired)) problems.push('invalid_basis_required');
    if (!['none', 'single', 'fractional'].includes(d.shareMode)) problems.push('invalid_share_mode');
    if (!['allow', 'deny_same_holder', 'deny_any', 'fractional_sum'].includes(d.overlapMode)) problems.push('invalid_overlap_mode');
    if (!isBool(d.transferable) || !isBool(d.inheritable) || !isBool(d.countsTowardFactionSettlementIndex)) problems.push('invalid_right_flags');
    return problems;
  },
  succession_law: (d) => {
    const problems = policyProblems(d);
    if (d.fallbackToFirstLegalHeir !== true) problems.push('invalid_fallback');
    return problems;
  },
  inheritance_custom: (d) => {
    const problems = policyProblems(d);
    if (!isBool(d.allowsPacts)) problems.push('invalid_pact_flag');
    if (!Array.isArray(d.requiredConsentRoles) || !Array.isArray(d.requiredApprovalRoles)) problems.push('invalid_roles');
    return problems;
  },
};

export const DEFINITION_DOMAINS = Object.freeze(Object.keys(BUILT_IN));

function customRecord(state, domainId, id) {
  const records = state && state.world && state.world.customDefinitions && state.world.customDefinitions.records;
  return has(records, `${domainId}:${id}`) ? records[`${domainId}:${id}`] : null;
}

export function getDefinition(state, domainId, id) {
  if (!has(BUILT_IN, domainId) || !isStoredId(id)) return null;
  if (has(BUILT_IN[domainId], id)) return clone(BUILT_IN[domainId][id]);
  const record = customRecord(state, domainId, id);
  if (!isRecord(record) || record.approvalStatus !== 'approved' || !isRecord(record.definitionData)) return null;
  // A malformed approved definition counts as unknown rather than breaking the rules that read it.
  const definition = { ...clone(TEMPLATES[domainId]), ...clone(record.definitionData), id };
  const known = (otherDomain, otherId) => getDefinition(state, otherDomain, otherId) !== null;
  return PROBLEMS[domainId](definition, known).length === 0 ? definition : null;
}

export const hasDefinition = (state, domainId, id) => getDefinition(state, domainId, id) !== null;

export const DEFINITION_DOMAIN_SPECS = Object.freeze(Object.fromEntries(DEFINITION_DOMAINS.map((domainId) => [domainId, Object.freeze({
  validate: (data, lookup) => PROBLEMS[domainId]({ ...clone(TEMPLATES[domainId]), ...data }, lookup.has),
  defaults: Object.values(BUILT_IN[domainId]).map(clone),
})])));
