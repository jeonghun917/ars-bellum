// Inheritance pacts: agreements a clan stores in advance about who receives what.
//
// Pact: { id, version: 1, status, priority?, consents: [{ accepted, decisionId }],
// approvals: [{ approved, decisionId }], effectiveConditions: { minDay?, maxDay?, requiredCauseIds? },
// expectedShares: [{ assetClass, scopeRef?, beneficiaryRef, shareBps, priority? }],
// allocations: [{ assetRef, assetClass, beneficiaryRef, action, ... }] }.
// Only `active` pacts count. An active pact must have every consent and approval given.
import { isRecord } from '../../core/data.js';
import { BPS_SCALE } from './policies.js';
import { isDayNumber, isFiniteNumber, isStoredId, isStoredRef, refKey } from './shared.js';

const SUCCESSION_CAUSES = Object.freeze(['death', 'retirement', 'abdication']);
export { SUCCESSION_CAUSES };

const listOrAbsent = (value) => value === undefined || Array.isArray(value);

// Returns a problem code, or null when the pact is well formed.
export function validatePactStructure(pact) {
  if (!isRecord(pact) || !isStoredId(pact.id) || pact.version !== 1 || typeof pact.status !== 'string') return 'invalid_inheritance_pact';
  if (pact.priority !== undefined && !isFiniteNumber(pact.priority)) return 'invalid_inheritance_pact';
  if (!listOrAbsent(pact.consents) || !listOrAbsent(pact.approvals) || !listOrAbsent(pact.expectedShares) || !listOrAbsent(pact.allocations)) return 'invalid_inheritance_pact';
  if (pact.status !== 'active') return null;
  if (!(pact.consents || []).every((item) => isRecord(item) && item.accepted === true && item.decisionId)) return 'missing_required_consent';
  if (!(pact.approvals || []).every((item) => isRecord(item) && item.approved === true && item.decisionId)) return 'missing_required_approval';
  const conditions = pact.effectiveConditions === undefined ? {} : pact.effectiveConditions;
  if (!isRecord(conditions)) return 'invalid_inheritance_pact';
  for (const key of ['minDay', 'maxDay']) {
    if (conditions[key] !== undefined && conditions[key] !== null && !isDayNumber(conditions[key])) return 'invalid_inheritance_pact';
  }
  if (conditions.requiredCauseIds !== undefined && (!Array.isArray(conditions.requiredCauseIds) || !conditions.requiredCauseIds.every(isStoredId))) return 'invalid_inheritance_pact';
  const groups = {};
  for (const share of pact.expectedShares || []) {
    if (!isRecord(share) || typeof share.assetClass !== 'string' || !isStoredRef(share.beneficiaryRef) || (share.scopeRef !== undefined && !isStoredRef(share.scopeRef))) return 'invalid_expected_share';
    if (!Number.isInteger(share.shareBps) || share.shareBps < 0 || share.shareBps > BPS_SCALE) return 'invalid_expected_share';
    const group = `${share.assetClass}:${refKey(share.scopeRef)}`;
    groups[group] = (groups[group] || 0) + share.shareBps;
    if (groups[group] > BPS_SCALE) return 'invalid_expected_share';
  }
  for (const allocation of pact.allocations || []) {
    if (!isRecord(allocation) || !isStoredRef(allocation.assetRef) || !isStoredRef(allocation.beneficiaryRef) || typeof allocation.action !== 'string') return 'invalid_allocation';
  }
  return null;
}

// Whether an active pact applies on `day` for the cause. A pact that does not apply yet (or any
// more) is left out; the earlier version let it block the whole succession.
export function pactIsEffective(pact, day, cause) {
  if (pact.status !== 'active') return false;
  const conditions = pact.effectiveConditions || {};
  if (conditions.minDay !== undefined && conditions.minDay !== null && day < conditions.minDay) return false;
  if (conditions.maxDay !== undefined && conditions.maxDay !== null && day > conditions.maxDay) return false;
  if (Array.isArray(conditions.requiredCauseIds) && conditions.requiredCauseIds.length && !conditions.requiredCauseIds.includes(cause)) return false;
  return true;
}

export const effectivePacts = (pacts, day, cause) => (pacts || []).filter((pact) => pactIsEffective(pact, day, cause));
