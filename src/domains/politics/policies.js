// Succession policies: how candidates are ranked, who is eligible, and how an estate is divided.
// They are pure functions of their input, so the same state always gives the same heir; nothing
// here draws random numbers. Laws and customs name these policies by id.
import { isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import { clone } from '../../core/data.js';
import { copyRef, isStoredRef, refKey, sameJson } from './shared.js';

export const BPS_SCALE = 10000;

function distinctRefs(values) {
  const out = [];
  const seen = new Set();
  for (const reference of Array.isArray(values) ? values : []) {
    if (isStoredRef(reference) && !seen.has(refKey(reference))) {
      seen.add(refKey(reference));
      out.push(copyRef(reference));
    }
  }
  return out;
}

const byPriorityThenId = (a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0) || String(a.id).localeCompare(String(b.id));

// Higher priority first, then larger share, then reference order: a fixed order for equal claims.
export function orderBeneficiaries(entries) {
  return [...entries].sort((a, b) => {
    const byPriority = (Number(b.priority) || 0) - (Number(a.priority) || 0);
    if (byPriority) return byPriority;
    const byShare = (Number(b.shareBps) || 0) - (Number(a.shareBps) || 0);
    if (byShare) return byShare;
    const ka = refKey(a.beneficiaryRef);
    const kb = refKey(b.beneficiaryRef);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export const EVALUATORS = Object.freeze({
  // The designated candidates in the order given, each once. The legal heirs are not ranked here:
  // succession appends them after the designated candidates (the law's fallback to the first legal heir).
  'm1.ordered_candidates.v1': (input) => {
    const ranked = distinctRefs(input.candidateRefs);
    const pacts = (input.pactSnapshots || []).filter(isRecord).sort(byPriorityThenId);
    return ok({
      rankedCandidateRefs: ranked,
      rankedPactIds: pacts.map((pact) => pact.id),
      tieBreakTrace: ranked.map(refKey),
      warnings: ranked.length || !distinctRefs(input.legalHeirRefs).length ? [] : ['designated_candidates_empty'],
    });
  },
});

export const ELIGIBILITY = Object.freeze({
  'm1.alive_eligible.v1': (input) => {
    const character = input.character;
    const reasons = [];
    if (!character) reasons.push('missing_character');
    else {
      if (!isRecord(character.identity) || character.identity.alive !== true) reasons.push('not_alive');
      if (isRecord(character.condition) && character.condition.incapacitated) reasons.push('incapacitated');
    }
    if ((input.permanentlyReleasedCharacterIds || []).includes(input.candidateRef.id)) reasons.push('permanently_released');
    return ok({ eligible: reasons.length === 0, reasonCodes: reasons });
  },
});

// Splits a whole-number lot: explicit amounts first, then the expected shares (basis points) of
// what remains, rounded down with the rounding remainder handed out one unit at a time in
// beneficiary order. What no share covers goes to the first legal heir. Nothing is lost or made up.
export function allocateIntegerLot(originalAmount, explicitAllocations, shares, legalHeirRef) {
  if (!Number.isSafeInteger(originalAmount) || originalAmount < 0) return fail('politics_allocation_numeric_overflow');
  const explicit = (explicitAllocations || []).reduce((sum, a) => sum + Number(a.amount || a.quantity || a.shareUnits || 0), 0);
  if (!Number.isSafeInteger(explicit) || explicit < 0 || explicit > originalAmount) return fail('politics_allocation_conservation_failed');
  const remaining = originalAmount - explicit;
  const ordered = orderBeneficiaries(shares || []);
  const totalBps = ordered.reduce((sum, s) => sum + Number(s.shareBps || 0), 0);
  if (!Number.isSafeInteger(totalBps) || totalBps < 0 || totalBps > BPS_SCALE) return fail('politics_invalid_expected_share');
  const amounts = [];
  for (const share of ordered) {
    const product = remaining * Number(share.shareBps || 0);
    if (!Number.isSafeInteger(product)) return fail('politics_allocation_numeric_overflow');
    amounts.push({
      beneficiaryRef: copyRef(share.beneficiaryRef),
      amount: Math.floor(product / BPS_SCALE),
      priority: Number(share.priority) || 0,
      shareBps: Number(share.shareBps) || 0,
    });
  }
  const expectedTarget = Math.floor((remaining * totalBps) / BPS_SCALE);
  let rounding = expectedTarget - amounts.reduce((sum, a) => sum + a.amount, 0);
  for (let index = 0; rounding > 0 && amounts.length; index += 1) {
    amounts[index % amounts.length].amount += 1;
    rounding -= 1;
  }
  const residual = remaining - expectedTarget;
  if (residual > 0 && !legalHeirRef) return fail('politics_no_eligible_legal_heir');
  const allocated = amounts.reduce((sum, a) => sum + a.amount, 0);
  if (explicit + allocated + residual !== originalAmount) return fail('politics_allocation_conservation_failed');
  return ok({
    originalAmount,
    explicitAllocations: explicit,
    remainingAmount: remaining,
    expectedTarget,
    allocations: amounts.filter((a) => a.amount > 0),
    policyResidual: residual,
    residualBeneficiaryRef: residual > 0 ? copyRef(legalHeirRef) : null,
  });
}

function divisibleAllocations(asset, calc) {
  const isRight = asset.assetClass === 'land_right';
  const entry = (beneficiaryRef, amount) => ({
    assetRef: copyRef(asset.assetRef),
    assetClass: asset.assetClass,
    beneficiaryRef: copyRef(beneficiaryRef),
    action: isRight ? 'split_share' : 'transfer_balance',
    ...(isRight ? { shareUnits: amount } : { amount }),
  });
  const out = calc.allocations.map((a) => entry(a.beneficiaryRef, a.amount));
  if (calc.policyResidual > 0) out.push(entry(calc.residualBeneficiaryRef, calc.policyResidual));
  return out;
}

const WHOLE_ACTION = { title: 'assign_holder', land_right: 'transfer_whole' };

export const INHERITANCE = Object.freeze({
  // Active pacts decide the assets they name; every other asset follows the expected shares, and
  // what they leave over goes to the first legal heir.
  'm1.pact_then_legal_first.v1': (input) => {
    const assets = Array.isArray(input.assetSnapshots) ? input.assetSnapshots : [];
    const pacts = (input.pactSnapshots || []).filter((p) => p.status === 'active').sort(byPriorityThenId);
    const expected = input.expectedShares || [];
    const explicitByAsset = {};
    for (const pact of pacts) {
      for (const allocation of pact.allocations || []) {
        const key = refKey(allocation.assetRef);
        if (explicitByAsset[key]) return fail('politics_allocation_conflict', key);
        explicitByAsset[key] = allocation;
      }
    }
    const allocations = [];
    const selected = [];
    const sortKey = (asset) => `${asset.assetClass}:${refKey(asset.assetRef)}`;
    for (const asset of [...assets].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0))) {
      const explicit = explicitByAsset[refKey(asset.assetRef)];
      const shares = expected.filter((s) => s.assetClass === asset.assetClass && (!s.scopeRef || sameJson(s.scopeRef, asset.assetRef)));
      if (explicit) {
        allocations.push(JSON.parse(JSON.stringify(explicit)));
        selected.push(explicit.beneficiaryRef);
      } else if (asset.divisible === true) {
        const amount = Number(asset.amount != null ? asset.amount : asset.shareUnits);
        const calc = allocateIntegerLot(amount, [], shares, input.firstLegalHeirRef);
        if (!calc.ok) return calc;
        for (const allocation of divisibleAllocations(asset, calc)) {
          allocations.push(allocation);
          selected.push(allocation.beneficiaryRef);
        }
      } else {
        const ordered = orderBeneficiaries(shares);
        const beneficiary = ordered.length ? ordered[0].beneficiaryRef : input.firstLegalHeirRef;
        if (!beneficiary) return fail('politics_no_eligible_legal_heir', refKey(asset.assetRef));
        allocations.push({
          assetRef: copyRef(asset.assetRef),
          assetClass: asset.assetClass,
          beneficiaryRef: copyRef(beneficiary),
          action: WHOLE_ACTION[asset.assetClass] || 'transfer_owner',
        });
        selected.push(beneficiary);
      }
    }
    return ok({
      selectedHeirRefs: distinctRefs(selected),
      allocations,
      fallbackUsed: pacts.length === 0,
      resultTagIds: pacts.length ? ['pact_applied'] : ['legal_fallback'],
    });
  },
});

const TABLES = { evaluator: EVALUATORS, eligibility: ELIGIBILITY, inheritance: INHERITANCE };

// Runs a policy on a private copy of its input and checks that it returned a plain successful
// result, so a faulty policy fails the rule that called it instead of damaging state. (`tables`
// is only for tests that need a faulty policy; the built-in tables are frozen.)
export function runPolicy(kind, id, input, tables = TABLES) {
  const table = tables[kind];
  if (!table || !Object.prototype.hasOwnProperty.call(table, id)) return fail('politics_unsupported_policy', { kind, id });
  let result;
  try {
    result = clone(table[id](clone(input || {})));
  } catch (error) {
    return fail('politics_invalid_policy_output', String(error && error.message || error));
  }
  if (!result || result.ok !== true) return result && result.ok === false ? result : fail('politics_invalid_policy_output');
  return result;
}

export const POLICY_IDS = Object.freeze({
  evaluator: Object.keys(EVALUATORS),
  eligibility: Object.keys(ELIGIBILITY),
  inheritance: Object.keys(INHERITANCE),
});
