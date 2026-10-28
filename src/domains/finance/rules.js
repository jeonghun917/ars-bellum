// Finance actions on a store draft: accounts, money movements (transfer, mint, spend), campaign
// metrics and debts. Each rule checks all of its input against the draft before it writes, so a
// failure leaves the draft exactly as it was (and store.transact discards it anyway).
import { clone, isRecord } from '../../core/data.js';
import { isId, sameRef } from '../../core/ids.js';
import { ok, fail } from '../../core/result.js';
import {
  METRICS_KEY, accountProblems, debtProblems, definitionOf, isAccountId, isAmount, isCampaignMetrics, isCount,
  isStoredRef, ownerTypeCanOwnAccounts, playerAccountIdOf, refExists,
} from './checks.js';

const accountsOf = (draft) => draft.world.finance.accounts;
const transfersOf = (draft) => draft.world.finance.transfers;
const debtsOf = (draft) => draft.world.finance.debts;
const today = (draft) => draft.calendar.day;
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

function findAccount(draft, id) {
  return isId(id) && Object.hasOwn(accountsOf(draft), id) ? accountsOf(draft)[id] : null;
}

// Writes a changed record back with its revision raised by one, as the earlier version did.
function writeAccount(draft, next) {
  next.revision += 1;
  accountsOf(draft)[next.id] = next;
}

// ---------------------------------------------------------------- accounts

export function createAccount(draft, input) {
  if (!isRecord(input)) return fail('finance_invalid_input');
  const { id, accountTypeId, ownerRef, currencyId = 'gold', legalRegimeId = null, reserveTarget = 0, budgetPolicyId = null } = input;
  if (!isId(id)) return fail('finance_invalid_account_id', { id });
  if (Object.hasOwn(accountsOf(draft), id)) return fail('finance_duplicate_account_id', { id });
  const account = {
    id,
    version: 1,
    revision: 0,
    accountTypeId,
    currencyId,
    // New accounts open empty; money arrives by a transfer or a mint, so it is always on record.
    balance: 0,
    ownerRef: isRecord(ownerRef) ? { id: ownerRef.id, type: ownerRef.type } : ownerRef,
    authorizedSpenders: [],
    budgetPolicyId,
    frozen: false,
    lastTransactionId: null,
    legalRegimeId,
    reserveTarget,
    customData: {},
  };
  const problems = accountProblems(draft, account);
  if (problems.length) return fail('finance_invalid_account', { id, problems });
  accountsOf(draft)[id] = account;
  return ok({ accountId: id });
}

export function setAccountFrozen(draft, input) {
  const account = findAccount(draft, input?.accountId);
  if (!account) return fail('finance_account_missing', { accountId: input?.accountId });
  if (typeof input.frozen !== 'boolean') return fail('finance_invalid_input', { field: 'frozen' });
  if (account.frozen === input.frozen) return fail('finance_no_change');
  const next = clone(account);
  next.frozen = input.frozen;
  writeAccount(draft, next);
  return ok({ accountId: account.id, frozen: next.frozen });
}

// Authorized spenders are characters who may move money out of an account they do not own.
export function setAuthorizedSpenders(draft, input) {
  const account = findAccount(draft, input?.accountId);
  if (!account) return fail('finance_account_missing', { accountId: input?.accountId });
  const ids = input.spenderIds;
  if (!Array.isArray(ids) || !ids.every(isAccountId) || new Set(ids).size !== ids.length) return fail('finance_invalid_input', { field: 'spenderIds' });
  const missing = ids.filter((id) => !refExists(draft, { type: 'character', id }));
  if (missing.length) return fail('finance_spender_missing', { missing });
  const next = clone(account);
  next.authorizedSpenders = [...ids].sort();
  writeAccount(draft, next);
  return ok({ accountId: account.id });
}

export function changeAccountOwner(draft, input) {
  const account = findAccount(draft, input?.accountId);
  if (!account) return fail('finance_account_missing', { accountId: input?.accountId });
  const ownerRef = input.ownerRef;
  if (!isStoredRef(ownerRef) || !ownerTypeCanOwnAccounts(draft, ownerRef.type)) return fail('finance_invalid_owner', { ownerRef });
  if (!refExists(draft, ownerRef)) return fail('finance_owner_missing', { ownerRef });
  if (sameRef(account.ownerRef, ownerRef)) return fail('finance_no_change');
  const next = clone(account);
  next.ownerRef = { id: ownerRef.id, type: ownerRef.type };
  const problems = accountProblems(draft, next);
  if (problems.length) return fail('finance_invalid_account', { id: account.id, problems });
  writeAccount(draft, next);
  return ok({ accountId: account.id });
}

// ---------------------------------------------------------------- money movements

function spenderAllowed(account, spenderId) {
  if (spenderId === undefined) return true;
  if (account.ownerRef.type === 'character' && account.ownerRef.id === spenderId) return true;
  return account.authorizedSpenders.includes(spenderId);
}

// Budget policies are code, not saved data, so the caller passes them in the context:
// context.budgetPolicies = { [policyId]: (accountCopy, plan) => true | reason }.
function policyVerdict(draft, account, plan, context) {
  const type = definitionOf(draft, 'account_type', account.accountTypeId) || {};
  const ids = [account.budgetPolicyId, type.authorizationPolicyId, type.budgetPolicyId].filter(Boolean);
  const policies = isRecord(context?.budgetPolicies) ? context.budgetPolicies : {};
  for (const id of ids) {
    if (typeof policies[id] !== 'function') continue;
    let verdict;
    try {
      verdict = policies[id](clone(account), clone(plan));
    } catch (error) {
      return fail('finance_policy_failed', { policyId: id, message: String(error?.message || error) });
    }
    if (verdict !== true) return fail('finance_policy_rejected', { policyId: id, reason: verdict });
  }
  return ok();
}

function sameRequest(record, plan, amount) {
  return record.fromAccountId === plan.fromAccountId && record.toAccountId === plan.toAccountId && record.amount === amount;
}

function nextTransferId(draft) {
  const transfers = transfersOf(draft);
  let n = Object.keys(transfers).length + 1;
  while (Object.hasOwn(transfers, `transfer_${n}`)) n += 1;
  return `transfer_${n}`;
}

// The one place money moves. fromAccountId null mints money into the game, toAccountId null takes it
// out (spending on something outside the ledger). Every movement leaves a transfer record. The three
// public rules below each guarantee at least one account, so there is no both-null case here.
function moveMoney(draft, plan, context) {
  if (!isRecord(plan)) return fail('finance_invalid_input');
  const fromAccountId = plan.fromAccountId ?? null;
  const toAccountId = plan.toAccountId ?? null;
  const amount = plan.amount;
  if (!isAmount(amount)) return fail('finance_invalid_amount', { amount });
  if (!isId(plan.reasonTypeId)) return fail('finance_invalid_reason', { reasonTypeId: plan.reasonTypeId });
  const idempotencyKey = plan.idempotencyKey ?? null;
  if (idempotencyKey !== null && !isNonEmptyString(idempotencyKey)) return fail('finance_invalid_input', { field: 'idempotencyKey' });

  // A repeated request (same key) is answered with the first result instead of paying twice.
  if (idempotencyKey !== null) {
    const earlier = Object.values(transfersOf(draft)).find((record) => record.idempotencyKey === idempotencyKey);
    if (earlier) {
      if (!sameRequest(earlier, { fromAccountId, toAccountId }, amount)) return fail('finance_idempotency_conflict', { idempotencyKey, transferId: earlier.id });
      return ok({ replayed: true, transferId: earlier.id });
    }
  }
  if (fromAccountId !== null && fromAccountId === toAccountId) return fail('finance_same_account');
  const from = fromAccountId === null ? null : findAccount(draft, fromAccountId);
  const to = toAccountId === null ? null : findAccount(draft, toAccountId);
  if (fromAccountId !== null && !from) return fail('finance_account_missing', { accountId: fromAccountId });
  if (toAccountId !== null && !to) return fail('finance_account_missing', { accountId: toAccountId });
  const currencyId = (from || to).currencyId;
  if (from && to && from.currencyId !== to.currencyId) return fail('finance_currency_mismatch', { from: from.currencyId, to: to.currencyId });
  if (plan.currencyId !== undefined && plan.currencyId !== currencyId) return fail('finance_currency_mismatch', { expected: plan.currencyId, actual: currencyId });
  if ((from && from.frozen) || (to && to.frozen)) return fail('finance_account_frozen', { accountId: from && from.frozen ? from.id : to.id });
  if (plan.spenderId !== undefined && !isId(plan.spenderId)) return fail('finance_invalid_input', { field: 'spenderId' });
  if (from && !spenderAllowed(from, plan.spenderId)) return fail('finance_spender_not_authorized', { accountId: from.id, spenderId: plan.spenderId });
  if (plan.emergency !== undefined && typeof plan.emergency !== 'boolean') return fail('finance_invalid_input', { field: 'emergency' });
  const emergency = plan.emergency === true;
  if (from && from.balance < amount) return fail('finance_insufficient_balance', { accountId: from.id, balance: from.balance, amount });
  // Dipping below the reserve is allowed only as an emergency, and then it is marked for audit.
  if (from && from.balance - amount < from.reserveTarget && !emergency) return fail('finance_reserve_violation', { accountId: from.id, reserveTarget: from.reserveTarget });
  if (to && !Number.isSafeInteger(to.balance + amount)) return fail('finance_balance_overflow', { accountId: to.id });
  const sourceRef = plan.sourceRef ?? null;
  if (sourceRef !== null && !isStoredRef(sourceRef)) return fail('finance_invalid_input', { field: 'sourceRef' });
  const customData = plan.customData ?? {};
  if (!isRecord(customData)) return fail('finance_invalid_input', { field: 'customData' });
  if (from) {
    const policy = policyVerdict(draft, from, plan, context);
    if (!policy.ok) return policy;
  }
  const transferId = plan.transferId ?? nextTransferId(draft);
  if (!isId(transferId)) return fail('finance_invalid_input', { field: 'transferId' });
  if (Object.hasOwn(transfersOf(draft), transferId)) return fail('finance_duplicate_transfer_id', { transferId });

  const record = {
    id: transferId,
    version: 1,
    revision: 0,
    fromAccountId,
    toAccountId,
    currencyId,
    amount,
    reasonTypeId: plan.reasonTypeId,
    sourceRef: sourceRef && { id: sourceRef.id, type: sourceRef.type },
    customData: clone(customData),
    emergency,
    audit: emergency ? { required: true, status: 'pending' } : null,
    idempotencyKey,
    createdDay: today(draft),
  };
  if (from) {
    const next = clone(from);
    next.balance -= amount;
    next.lastTransactionId = transferId;
    writeAccount(draft, next);
  }
  if (to) {
    const next = clone(to);
    next.balance += amount;
    next.lastTransactionId = transferId;
    writeAccount(draft, next);
  }
  transfersOf(draft)[transferId] = record;
  return ok({ transferId });
}

// input: { fromAccountId, toAccountId, amount, reasonTypeId, spenderId?, emergency?, sourceRef?,
//          idempotencyKey?, transferId?, customData?, currencyId? }
export function transferFunds(draft, input, context) {
  if (!isRecord(input)) return fail('finance_invalid_input');
  if (input.fromAccountId == null || input.toAccountId == null) return fail('finance_missing_endpoint');
  return moveMoney(draft, input, context);
}

// Brings new money into an account (loot, income, ransom). input: { accountId, amount, reasonTypeId, ... }
export function mintFunds(draft, input, context) {
  if (!isRecord(input) || input.accountId == null) return fail('finance_missing_endpoint');
  const { accountId, ...rest } = input;
  return moveMoney(draft, { ...rest, fromAccountId: null, toAccountId: accountId }, context);
}

// Takes money out of the ledger (wages, tribute, purchases). input: { accountId, amount, reasonTypeId, ... }
export function spendFunds(draft, input, context) {
  if (!isRecord(input) || input.accountId == null) return fail('finance_missing_endpoint');
  const { accountId, ...rest } = input;
  return moveMoney(draft, { ...rest, fromAccountId: accountId, toAccountId: null }, context);
}

// ---------------------------------------------------------------- campaign metrics

export function getCampaignMetrics(state, accountId) {
  const account = state.world.finance.accounts[accountId];
  const metrics = account?.customData?.[METRICS_KEY];
  return isCampaignMetrics(metrics) ? { manpower: metrics.manpower, territory: metrics.territory } : null;
}

// Manpower and territory stay where the earlier version stored them, on one account only: the
// personal account of the character the player controls.
function metricsAccount(draft, accountId) {
  const account = findAccount(draft, accountId);
  if (!account) return fail('finance_account_missing', { accountId });
  if (playerAccountIdOf(draft) !== account.id) return fail('finance_metrics_wrong_account', { accountId });
  return ok({ account });
}

// What the metrics would be after the deltas, or a failure. Writes nothing.
function planMetrics(account, manpowerDelta, territoryDelta) {
  if (!Number.isSafeInteger(manpowerDelta) || !Number.isSafeInteger(territoryDelta)) return fail('finance_invalid_metric_delta', { manpowerDelta, territoryDelta });
  const current = account.customData[METRICS_KEY] ?? { version: 1, manpower: 0, territory: 0 };
  const manpower = current.manpower + manpowerDelta;
  const territory = current.territory + territoryDelta;
  if (!isCount(manpower) || !isCount(territory)) return fail('finance_metric_out_of_range', { manpower, territory });
  return ok({ metrics: { version: 1, manpower, territory } });
}

function writeMetrics(draft, account, metrics) {
  const next = clone(account);
  next.customData[METRICS_KEY] = metrics;
  writeAccount(draft, next);
}

// Changes manpower and territory by whole-number deltas; neither may go below zero or past the
// largest whole number.
// input: { accountId, manpowerDelta?, territoryDelta? }
export function changeCampaignMetrics(draft, input) {
  if (!isRecord(input)) return fail('finance_invalid_input');
  const found = metricsAccount(draft, input.accountId);
  if (!found.ok) return found;
  const manpowerDelta = input.manpowerDelta ?? 0;
  const territoryDelta = input.territoryDelta ?? 0;
  const planned = planMetrics(found.account, manpowerDelta, territoryDelta);
  if (!planned.ok) return planned;
  if (manpowerDelta === 0 && territoryDelta === 0) return fail('finance_no_change');
  writeMetrics(draft, found.account, planned.metrics);
  return ok({ accountId: found.account.id, manpower: planned.metrics.manpower, territory: planned.metrics.territory });
}

// When control passes to another character the metrics follow to that character's personal
// account (the earlier version required them on exactly that one account). input: { fromAccountId, toAccountId }
export function moveCampaignMetrics(draft, input) {
  if (!isRecord(input)) return fail('finance_invalid_input');
  const from = findAccount(draft, input.fromAccountId);
  const to = findAccount(draft, input.toAccountId);
  if (!from) return fail('finance_account_missing', { accountId: input.fromAccountId });
  if (!to) return fail('finance_account_missing', { accountId: input.toAccountId });
  if (from.id === to.id) return fail('finance_same_account');
  if (!isCampaignMetrics(from.customData[METRICS_KEY])) return fail('finance_metrics_missing', { accountId: from.id });
  const nextFrom = clone(from);
  const nextTo = clone(to);
  nextTo.customData[METRICS_KEY] = nextFrom.customData[METRICS_KEY];
  delete nextFrom.customData[METRICS_KEY];
  writeAccount(draft, nextFrom);
  writeAccount(draft, nextTo);
  return ok({ fromAccountId: from.id, toAccountId: to.id });
}

// The battle-victory gain of the earlier version (index.html victoryAtomic): loot gold, prisoners
// as manpower, and territory, all together or none. The gold is minted through the ledger (the
// earlier version changed the balance with no transfer record). input: { accountId, gold, manpower, territory, sourceRef? }
export function recordBattleVictory(draft, input) {
  if (!isRecord(input)) return fail('finance_invalid_input');
  const { accountId, gold = 0, manpower = 0, territory = 0 } = input;
  if (![gold, manpower, territory].every(isCount)) return fail('finance_invalid_amount', { gold, manpower, territory });
  if (gold === 0 && manpower === 0 && territory === 0) return fail('finance_no_change');
  const found = metricsAccount(draft, accountId);
  if (!found.ok) return found;
  // Plan the metrics first and write them last, so a failed mint leaves the draft as it was.
  const planned = planMetrics(found.account, manpower, territory);
  if (!planned.ok) return planned;
  let transferId = null;
  if (gold > 0) {
    const minted = mintFunds(draft, { accountId, amount: gold, reasonTypeId: 'battle_victory', sourceRef: input.sourceRef });
    if (!minted.ok) return minted;
    transferId = minted.transferId;
  }
  if (manpower > 0 || territory > 0) {
    // One revision step for the whole victory, as the earlier version's single account replace.
    if (gold > 0) accountsOf(draft)[accountId].customData[METRICS_KEY] = planned.metrics;
    else writeMetrics(draft, found.account, planned.metrics);
  }
  return ok({ transferId, gold, manpower, territory });
}

// ---------------------------------------------------------------- debts

const DEBT_PATCH_FIELDS = Object.freeze(['dueDay', 'interestRate', 'obligationTerms']);

export function createDebt(draft, input) {
  if (!isRecord(input)) return fail('finance_invalid_input');
  const id = input.id;
  if (!isId(id)) return fail('finance_invalid_debt_id', { id });
  if (Object.hasOwn(debtsOf(draft), id)) return fail('finance_duplicate_debt_id', { id });
  if (!isAmount(input.principal)) return fail('finance_invalid_amount', { principal: input.principal });
  if (isStoredRef(input.creditorRef) && sameRef(input.creditorRef, input.debtorRef)) return fail('finance_debt_self_owed');
  const debt = {
    id,
    version: 1,
    revision: 0,
    creditorRef: isRecord(input.creditorRef) ? { id: input.creditorRef.id, type: input.creditorRef.type } : null,
    debtorRef: isRecord(input.debtorRef) ? { id: input.debtorRef.id, type: input.debtorRef.type } : null,
    guarantors: clone(input.guarantors ?? []),
    collateral: clone(input.collateral ?? []),
    principal: input.principal,
    outstandingPrincipal: input.principal,
    currencyId: input.currencyId ?? 'gold',
    interestRate: input.interestRate ?? 0,
    dueDay: input.dueDay ?? null,
    status: 'active',
    purposeId: input.purposeId ?? null,
    debtTypeId: input.debtTypeId ?? 'currency_debt',
    settlementMethodId: input.settlementMethodId ?? 'currency_transfer',
    obligationTerms: clone(input.obligationTerms ?? {}),
    customData: {},
    paymentTransactionIds: [],
  };
  const problems = debtProblems(draft, debt);
  if (problems.length) return fail('finance_invalid_debt', { id, problems });
  debtsOf(draft)[id] = debt;
  return ok({ debtId: id });
}

// A party of a debt is matched by an account it owns (or the account itself, if the party is one).
function partyHoldsAccount(partyRef, account) {
  if (!isRecord(partyRef) || !account) return false;
  if (partyRef.type === 'account') return partyRef.id === account.id;
  return sameRef(partyRef, account.ownerRef);
}

// Counts an already-made transfer as a payment on a debt. input: { debtId, transferId, amount? }
export function recordDebtPayment(draft, input) {
  const debts = debtsOf(draft);
  const debt = isId(input?.debtId) && Object.hasOwn(debts, input.debtId) ? debts[input.debtId] : null;
  if (!debt) return fail('finance_debt_missing', { debtId: input?.debtId });
  const transfer = typeof input.transferId === 'string' && Object.hasOwn(transfersOf(draft), input.transferId) ? transfersOf(draft)[input.transferId] : null;
  if (!transfer) return fail('finance_transfer_missing', { transferId: input.transferId });
  if (debt.paymentTransactionIds.includes(transfer.id)) return ok({ replayed: true, debtId: debt.id });
  const usedBy = Object.values(debts).find((other) => other.paymentTransactionIds.includes(transfer.id));
  if (usedBy) return fail('finance_transfer_already_used', { debtId: usedBy.id });
  if (transfer.currencyId !== debt.currencyId) return fail('finance_currency_mismatch', { debt: debt.currencyId, transfer: transfer.currencyId });
  const from = transfer.fromAccountId === null ? null : accountsOf(draft)[transfer.fromAccountId];
  const to = transfer.toAccountId === null ? null : accountsOf(draft)[transfer.toAccountId];
  const payerOk = partyHoldsAccount(debt.debtorRef, from) || debt.guarantors.some((ref) => partyHoldsAccount(ref, from));
  if (!payerOk || !partyHoldsAccount(debt.creditorRef, to)) return fail('finance_payment_wrong_parties', { transferId: transfer.id });
  const amount = input.amount ?? transfer.amount;
  if (!isAmount(amount) || amount > transfer.amount || amount > debt.outstandingPrincipal) {
    return fail('finance_invalid_payment_amount', { amount, outstanding: debt.outstandingPrincipal, transferAmount: transfer.amount });
  }
  const next = clone(debt);
  next.outstandingPrincipal -= amount;
  next.paymentTransactionIds.push(transfer.id);
  if (next.outstandingPrincipal === 0) next.status = 'paid';
  next.revision += 1;
  debts[debt.id] = next;
  return ok({ debtId: debt.id, outstandingPrincipal: next.outstandingPrincipal, status: next.status });
}

// Pays a debt in one step: moves the money and records the payment, together or not at all.
// input: { debtId, fromAccountId, toAccountId, amount, spenderId?, idempotencyKey? }
export function payDebt(draft, input, context) {
  if (!isRecord(input)) return fail('finance_invalid_input');
  const debt = isId(input.debtId) && Object.hasOwn(debtsOf(draft), input.debtId) ? debtsOf(draft)[input.debtId] : null;
  if (!debt) return fail('finance_debt_missing', { debtId: input.debtId });
  const scratch = { ...draft, world: { ...draft.world, finance: clone(draft.world.finance) } };
  const moved = transferFunds(scratch, {
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    amount: input.amount,
    reasonTypeId: 'debt_payment',
    sourceRef: { id: debt.id, type: 'debt' },
    spenderId: input.spenderId,
    idempotencyKey: input.idempotencyKey,
  }, context);
  if (!moved.ok) return moved;
  const recorded = recordDebtPayment(scratch, { debtId: debt.id, transferId: moved.transferId });
  if (!recorded.ok) return recorded;
  draft.world.finance = scratch.world.finance;
  return ok({ ...recorded, transferId: moved.transferId });
}

// An active debt whose due day has passed becomes overdue. The day is the current calendar day.
export function markDebtOverdue(draft, input) {
  const debts = debtsOf(draft);
  const debt = isId(input?.debtId) && Object.hasOwn(debts, input.debtId) ? debts[input.debtId] : null;
  if (!debt) return fail('finance_debt_missing', { debtId: input?.debtId });
  if (debt.status !== 'active' || debt.dueDay === null || today(draft) <= debt.dueDay) return fail('finance_debt_not_overdue', { status: debt.status, dueDay: debt.dueDay });
  const next = clone(debt);
  next.status = 'overdue';
  next.revision += 1;
  debts[debt.id] = next;
  return ok({ debtId: debt.id });
}

// Changes the terms of an unpaid debt. Only the terms may change, not the parties or amounts.
// input: { debtId, dueDay?, interestRate?, obligationTerms? }
export function renegotiateDebt(draft, input) {
  const debts = debtsOf(draft);
  const debt = isId(input?.debtId) && Object.hasOwn(debts, input.debtId) ? debts[input.debtId] : null;
  if (!debt) return fail('finance_debt_missing', { debtId: input?.debtId });
  if (debt.status === 'paid') return fail('finance_debt_paid');
  const fields = Object.keys(input).filter((key) => key !== 'debtId');
  const unknown = fields.filter((key) => !DEBT_PATCH_FIELDS.includes(key));
  if (unknown.length) return fail('finance_invalid_input', { unknown });
  if (!fields.length) return fail('finance_no_change');
  const next = clone(debt);
  for (const key of fields) next[key] = clone(input[key]);
  // A new due day in the future makes an overdue debt current again.
  if (next.status === 'overdue' && next.dueDay !== null && today(draft) <= next.dueDay) next.status = 'active';
  const problems = debtProblems(draft, next);
  if (problems.length) return fail('finance_invalid_debt', { id: debt.id, problems });
  next.revision += 1;
  debts[debt.id] = next;
  return ok({ debtId: debt.id });
}

// Daily step: when a day ends, active debts due on or before it become overdue.
export function markOverdueDebts(draft, day) {
  if (!Number.isInteger(day) || day < 1) return fail('finance_invalid_day', { day });
  const marked = [];
  for (const id of Object.keys(debtsOf(draft)).sort()) {
    const debt = debtsOf(draft)[id];
    if (debt.status !== 'active' || debt.dueDay === null || day < debt.dueDay) continue;
    const next = clone(debt);
    next.status = 'overdue';
    next.revision += 1;
    debtsOf(draft)[id] = next;
    marked.push(id);
  }
  return ok({ marked });
}
