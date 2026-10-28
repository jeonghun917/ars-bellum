// Record checks for world.finance (accounts, transfers, debts) and the definitions they refer to.
// The rules mirror the earlier version's save-time validators (M1_Accounts, M1_Transfers,
// M1_DebtState and the persistent-record pass in M1_Migration), so its saves load unchanged.
import { isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import {
  getDefinition, hasDefinitionDomain, refExists as definitionsRefExists, registerDefinitionDomain,
} from '../definitions/index.js';

// Id patterns of the earlier version. Accounts and debts used lowercase ids starting with a letter;
// transfer records allowed upper case too (transaction ids were built from free text). New ids made
// by the rules use the stricter core isId; these only decide what a stored record may hold.
export const ACCOUNT_ID_PATTERN = /^[a-z][a-z0-9_.:-]*$/;
export const STORED_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/;
export const isAccountId = (value) => typeof value === 'string' && ACCOUNT_ID_PATTERN.test(value);
export const isStoredId = (value) => typeof value === 'string' && STORED_ID_PATTERN.test(value);
export const isStoredRef = (value) => isRecord(value) && isStoredId(value.type) && isStoredId(value.id);
export const isAmount = (value) => Number.isSafeInteger(value) && value > 0;
export const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

// The definition domains this area owns, with the built-in definitions of the earlier version.
// Registered once at load; approved custom definitions are read from the saved state through
// the definitions area, so a save that holds one keeps loading.
const registerOnce = (domainId, options) => {
  if (!hasDefinitionDomain(domainId)) registerDefinitionDomain(domainId, options);
};

registerOnce('owner_ref_type', {
  validate: (data) => (data.capabilityTags === undefined || Array.isArray(data.capabilityTags) ? [] : ['invalid_capability_tags']),
  defaults: [
    { id: 'character', capabilityTags: ['can_own_account', 'can_hold_title', 'can_hold_land_right', 'can_be_inheritance_beneficiary'] },
    { id: 'mobile_group', capabilityTags: ['can_own_account'] },
    { id: 'clan', capabilityTags: ['can_own_account', 'can_hold_title', 'can_hold_land_right', 'can_be_inheritance_beneficiary'] },
    { id: 'settlement', capabilityTags: ['can_own_account', 'can_be_right_subject'] },
    { id: 'faction', capabilityTags: ['can_own_account', 'can_hold_title', 'can_hold_land_right', 'can_be_inheritance_beneficiary'] },
    { id: 'title', capabilityTags: ['can_be_right_basis'] },
    { id: 'land_right', capabilityTags: ['can_be_right_basis'] },
  ],
});

registerOnce('legal_regime', {
  defaults: [{ id: 'patrimonial' }, { id: 'customary_feudal' }, { id: 'separated_finance' }, { id: 'bureaucratic_state' }],
});

registerOnce('account_type', {
  validate: (data, lookup) => {
    const allowed = data.allowedOwnerTypeIds;
    if (allowed === null || allowed === undefined) return [];
    if (!Array.isArray(allowed)) return ['invalid_allowed_owner_types'];
    return allowed.filter((id) => !lookup.has('owner_ref_type', id)).map((id) => `missing_owner_type_reference:${id}`);
  },
  defaults: [
    { id: 'personal', allowedOwnerTypeIds: ['character'], capabilityTags: ['personal_wealth'] },
    { id: 'party', allowedOwnerTypeIds: ['mobile_group'], capabilityTags: ['operational_funds'] },
    { id: 'clan', allowedOwnerTypeIds: ['clan'], capabilityTags: ['organization_treasury'] },
    { id: 'settlement', allowedOwnerTypeIds: ['settlement'], capabilityTags: ['public_budget'] },
    { id: 'state', allowedOwnerTypeIds: ['faction'], capabilityTags: ['sovereign_budget'] },
  ],
});

registerOnce('debt_type', { defaults: [{ id: 'currency_debt', capabilityTags: ['currency_principal'] }] });
registerOnce('settlement_method', { defaults: [{ id: 'currency_transfer', capabilityTags: ['account_transfer'] }] });

export const definitionOf = (state, domain, id) => getDefinition(state, domain, id);

export const isKnownOwnerType = (state, type) => definitionOf(state, 'owner_ref_type', type) !== null;

export function ownerTypeCanOwnAccounts(state, type) {
  const definition = definitionOf(state, 'owner_ref_type', type);
  return definition !== null && Array.isArray(definition.capabilityTags) && definition.capabilityTags.includes('can_own_account');
}

// Whether a { type, id } reference points at a record that exists in this state.
export const refExists = (state, ref) => isStoredRef(ref) && definitionsRefExists(state, ref);

// Campaign metrics (manpower, territory) are kept where the earlier version kept them:
// account.customData.m18CampaignMetrics = { version: 1, manpower, territory }, nothing else.
export const METRICS_KEY = 'm18CampaignMetrics';

export function isCampaignMetrics(value) {
  if (!isRecord(value)) return false;
  if (Object.keys(value).sort().join(',') !== 'manpower,territory,version') return false;
  return value.version === 1 && isCount(value.manpower) && isCount(value.territory);
}

// Reasons an account cannot be stored, as codes (empty when it is fine).
export function accountProblems(state, account) {
  const problems = [];
  const add = (code) => problems.push(code);
  if (!isRecord(account)) return ['not_a_record'];
  if (!isAccountId(account.id)) add('invalid_account_id');
  if (account.version !== 1) add('unsupported_version');
  if (!isCount(account.revision)) add('invalid_revision');
  const type = definitionOf(state, 'account_type', account.accountTypeId);
  if (!type) add('unregistered_account_type');
  if (!isStoredRef(account.ownerRef) || !definitionOf(state, 'owner_ref_type', account.ownerRef.type)) {
    add('invalid_owner_ref');
  } else {
    if (!ownerTypeCanOwnAccounts(state, account.ownerRef.type)) add('owner_lacks_account_capability');
    if (type && Array.isArray(type.allowedOwnerTypeIds) && !type.allowedOwnerTypeIds.includes(account.ownerRef.type)) add('owner_type_not_allowed');
    if (!refExists(state, account.ownerRef)) add('owner_missing');
  }
  if (!isAccountId(account.currencyId)) add('invalid_currency_id');
  // No account type of the earlier version allowed overdraft: a balance is never below zero.
  if (!isCount(account.balance)) add('invalid_balance');
  if (!isCount(account.reserveTarget)) add('invalid_reserve_target');
  if (account.legalRegimeId !== null && !definitionOf(state, 'legal_regime', account.legalRegimeId)) add('unregistered_legal_regime');
  if (account.budgetPolicyId !== null && typeof account.budgetPolicyId !== 'string') add('invalid_budget_policy_id');
  const spenders = account.authorizedSpenders;
  if (!Array.isArray(spenders) || !spenders.every(isAccountId) || new Set(spenders).size !== spenders.length) add('invalid_authorized_spenders');
  if (typeof account.frozen !== 'boolean') add('invalid_frozen');
  if (account.lastTransactionId !== null && typeof account.lastTransactionId !== 'string') add('invalid_last_transaction_id');
  if (!isRecord(account.customData)) add('invalid_custom_data');
  else if (Object.hasOwn(account.customData, METRICS_KEY) && !isCampaignMetrics(account.customData[METRICS_KEY])) add('invalid_campaign_metrics');
  return problems;
}

export function transferProblems(state, record) {
  const problems = [];
  const add = (code) => problems.push(code);
  if (!isRecord(record)) return ['not_a_record'];
  const accounts = state.world.finance.accounts;
  if (!isStoredId(record.id)) add('invalid_transfer_id');
  if (record.version !== 1) add('unsupported_version');
  if (!isCount(record.revision)) add('invalid_revision');
  if (!isAmount(record.amount)) add('invalid_amount');
  if (!isAccountId(record.currencyId)) add('invalid_currency_id');
  const fromId = record.fromAccountId;
  const toId = record.toAccountId;
  if (fromId === null && toId === null) add('missing_transaction_endpoint');
  if (fromId !== null && fromId === toId) add('same_account_transfer');
  const from = fromId === null ? null : accounts[fromId];
  const to = toId === null ? null : accounts[toId];
  if (fromId !== null && !(isStoredId(fromId) && isRecord(from))) add('missing_from_account');
  if (toId !== null && !(isStoredId(toId) && isRecord(to))) add('missing_to_account');
  if ((isRecord(from) && from.currencyId !== record.currencyId) || (isRecord(to) && to.currencyId !== record.currencyId)) add('transfer_currency_mismatch');
  if (typeof record.reasonTypeId !== 'string' || record.reasonTypeId === '') add('invalid_reason');
  if (record.sourceRef !== null && !isStoredRef(record.sourceRef)) add('invalid_source_ref');
  if (!isRecord(record.customData)) add('invalid_custom_data');
  if (typeof record.emergency !== 'boolean') add('invalid_emergency');
  const auditOk = record.audit === null || (isRecord(record.audit) && typeof record.audit.required === 'boolean' && typeof record.audit.status === 'string');
  if (!auditOk) add('invalid_audit');
  if (record.emergency === true && record.audit === null) add('emergency_without_audit');
  if (record.idempotencyKey !== null && (typeof record.idempotencyKey !== 'string' || record.idempotencyKey === '')) add('invalid_idempotency_key');
  if (record.createdDay !== null && !isCount(record.createdDay)) add('invalid_created_day');
  return problems;
}

export const DEBT_STATUSES = Object.freeze(['active', 'overdue', 'paid']);

export function debtProblems(state, debt) {
  const problems = [];
  const add = (code) => problems.push(code);
  if (!isRecord(debt)) return ['not_a_record'];
  if (!isAccountId(debt.id)) add('invalid_debt_id');
  if (debt.version !== 1) add('unsupported_version');
  if (!isCount(debt.revision)) add('invalid_revision');
  if (!isStoredRef(debt.creditorRef) || !isStoredRef(debt.debtorRef)) add('invalid_party_ref');
  else {
    if (!refExists(state, debt.creditorRef)) add('creditor_missing');
    if (!refExists(state, debt.debtorRef)) add('debtor_missing');
  }
  if (!definitionOf(state, 'debt_type', debt.debtTypeId)) add('unregistered_debt_type');
  if (!definitionOf(state, 'settlement_method', debt.settlementMethodId)) add('unregistered_settlement_method');
  if (!isCount(debt.principal)) add('invalid_principal');
  if (!isCount(debt.outstandingPrincipal) || debt.outstandingPrincipal > debt.principal) add('invalid_outstanding_principal');
  if (!isAccountId(debt.currencyId)) add('invalid_currency_id');
  if (!Number.isFinite(debt.interestRate) || debt.interestRate < 0) add('invalid_interest_rate');
  if (debt.dueDay !== null && !isCount(debt.dueDay)) add('invalid_due_day');
  if (typeof debt.status !== 'string' || debt.status === '') add('invalid_status');
  if (debt.status === 'paid' && debt.outstandingPrincipal !== 0) add('paid_with_outstanding_principal');
  if (debt.purposeId !== null && typeof debt.purposeId !== 'string') add('invalid_purpose_id');
  if (!Array.isArray(debt.guarantors) || !Array.isArray(debt.collateral)) add('invalid_guarantors_or_collateral');
  if (!isRecord(debt.obligationTerms) || !isRecord(debt.customData)) add('invalid_terms_or_custom_data');
  const payments = debt.paymentTransactionIds;
  if (!Array.isArray(payments) || new Set(payments).size !== payments.length) add('invalid_payment_transaction_ids');
  else if (!payments.every((id) => isStoredId(id) && isRecord(state.world.finance.transfers[id]))) add('payment_transfer_missing');
  return problems;
}

function checkMap(issues, map, path, keyOk, problemsOf) {
  if (!isRecord(map)) {
    issues.push(`${path}:not_a_record_map`);
    return;
  }
  for (const id of Object.keys(map).sort()) {
    const record = map[id];
    if (!keyOk(id)) issues.push(`${path}.${id}:invalid_map_key`);
    if (isRecord(record) && record.id !== id) issues.push(`${path}.${id}:record_id_mismatch`);
    for (const code of problemsOf(record)) issues.push(`${path}.${id}:${code}`);
  }
}

// The personal account of the character the player controls, when the state has one.
export function playerAccountIdOf(state) {
  const characters = state?.world?.characters;
  const current = isRecord(characters) ? characters[state.playerControl?.currentCharacterId] : null;
  const accountId = isRecord(current) ? current.personalAccountId : null;
  const accounts = state?.world?.finance?.accounts;
  return typeof accountId === 'string' && isRecord(accounts) && Object.hasOwn(accounts, accountId) ? accountId : null;
}

export function checkFinance(state) {
  const issues = [];
  const finance = state?.world?.finance;
  if (!isRecord(finance)) return fail('finance_invalid', ['world.finance:not_a_record']);
  checkMap(issues, finance.accounts, 'world.finance.accounts', isAccountId, (record) => accountProblems(state, record));
  if (!isRecord(finance.accounts)) return fail('finance_invalid', issues);
  checkMap(issues, finance.transfers, 'world.finance.transfers', isStoredId, (record) => transferProblems(state, record));
  if (!isRecord(finance.transfers)) return fail('finance_invalid', issues);
  checkMap(issues, finance.debts, 'world.finance.debts', isAccountId, (record) => debtProblems(state, record));

  // The earlier version kept campaign metrics on exactly one account: the personal account of the
  // character the player controls (its "campaign_metric_owner_count" / "duplicate_campaign_metric_owner").
  const metricOwners = Object.keys(finance.accounts).filter((id) => isRecord(finance.accounts[id]?.customData) && Object.hasOwn(finance.accounts[id].customData, METRICS_KEY)).sort();
  if (metricOwners.length > 1) issues.push(`world.finance.accounts:duplicate_campaign_metric_owner:${metricOwners.join(',')}`);
  const playerAccountId = playerAccountIdOf(state);
  if (playerAccountId !== null && !(metricOwners.length === 1 && metricOwners[0] === playerAccountId)) {
    issues.push(`world.finance.accounts.${playerAccountId}:missing_campaign_metrics_on_player_account`);
  }

  // A replayed request is recognised by its idempotency key, so a key may name only one transfer.
  const keys = new Map();
  for (const id of Object.keys(finance.transfers).sort()) {
    const key = finance.transfers[id]?.idempotencyKey;
    if (typeof key !== 'string') continue;
    if (keys.has(key)) issues.push(`world.finance.transfers.${id}:duplicate_idempotency_key`);
    keys.set(key, id);
  }
  return issues.length ? fail('finance_invalid', issues) : ok();
}
