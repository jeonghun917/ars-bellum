// Rules on world.customDefinitions: proposing a definition in play, then approving or rejecting it.
// The record shape and the "<domain>:<id>" key are the earlier version's; other areas read approved
// records straight from state.
import { isRecord, clone } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import {
  DEFINITIONS_VERSION, definitionProblems, hasDefinition, hasDefinitionDomain, isDefinitionId, recordKey,
} from './registry.js';
import { isStoredRef, refExists } from './refs.js';

const isRevision = (value) => Number.isInteger(value) && value >= 0;

export function getProposal(state, domainId, definitionId) {
  const record = state?.world?.customDefinitions?.records?.[recordKey(domainId, definitionId)];
  return isRecord(record) ? clone(record) : null;
}

export function listProposals(state, { domainId = null, approvalStatus = null } = {}) {
  const records = state?.world?.customDefinitions?.records;
  if (!isRecord(records)) return [];
  return Object.keys(records).sort().map((key) => records[key])
    .filter((record) => isRecord(record) && (domainId === null || record.domainId === domainId)
      && (approvalStatus === null || record.approvalStatus === approvalStatus))
    .map(clone);
}

// Stores a proposal (pending). It is not usable until approved.
export function proposeDefinition(draft, input) {
  if (!isRecord(input)) return fail('definitions_invalid_input');
  const { domainId, definitionId } = input;
  if (!hasDefinitionDomain(domainId)) return fail('definitions_unregistered_domain', { domainId });
  if (!isDefinitionId(definitionId)) return fail('definitions_invalid_definition_id');
  if (!isRecord(input.definitionData)) return fail('definitions_invalid_definition_data');
  const version = input.definitionVersion === undefined ? 1 : input.definitionVersion;
  if (!Number.isInteger(version) || version < 1) return fail('definitions_invalid_definition_version');
  const sourceType = input.sourceType === undefined ? 'player' : input.sourceType;
  if (!isDefinitionId(sourceType)) return fail('definitions_invalid_source_type');
  const sourceRef = input.sourceRef === undefined ? null : input.sourceRef;
  if (sourceRef !== null && !isStoredRef(sourceRef)) return fail('definitions_invalid_source_ref');
  if (sourceRef !== null && !refExists(draft, sourceRef)) return fail('definitions_missing_source', { sourceRef });
  if (hasDefinition(draft, domainId, definitionId)) return fail('definitions_duplicate_definition', { domainId, definitionId });
  const root = draft.world.customDefinitions;
  const key = recordKey(domainId, definitionId);
  if (Object.hasOwn(root.records, key)) return fail('definitions_duplicate_proposal', { domainId, definitionId });
  const data = { ...clone(input.definitionData), id: definitionId };
  const problems = definitionProblems(draft, domainId, definitionId, data);
  if (problems.length) return fail('definitions_invalid_definition', problems);
  root.records[key] = {
    domainId,
    definitionId,
    schemaVersion: DEFINITIONS_VERSION,
    definitionVersion: version,
    sourceType,
    sourceRef: clone(sourceRef),
    approvalStatus: 'pending',
    approvedByRef: null,
    definitionData: data,
    revision: 0,
  };
  root.revision += 1;
  return ok({ key });
}

// A decision is made on the revision the decider saw: if the proposal changed meanwhile, it fails.
function pendingRecord(draft, input) {
  if (!isRecord(input)) return fail('definitions_invalid_input');
  const { domainId, definitionId } = input;
  if (typeof domainId !== 'string' || typeof definitionId !== 'string') return fail('definitions_invalid_input');
  if (!isRevision(input.expectedRevision)) return fail('definitions_invalid_expected_revision');
  const record = draft.world.customDefinitions.records[recordKey(domainId, definitionId)];
  if (!isRecord(record)) return fail('definitions_missing_proposal', { domainId, definitionId });
  if (record.revision !== input.expectedRevision) return fail('definitions_revision_conflict', { revision: record.revision });
  if (record.approvalStatus !== 'pending') return fail('definitions_already_decided', { approvalStatus: record.approvalStatus });
  return ok({ record });
}

// Approves a pending proposal; from then on the definition is known everywhere.
export function approveDefinition(draft, input) {
  const found = pendingRecord(draft, input);
  if (!found.ok) return found;
  const approvedByRef = input.approvedByRef === undefined ? null : input.approvedByRef;
  if (approvedByRef !== null && !isStoredRef(approvedByRef)) return fail('definitions_invalid_approver');
  if (approvedByRef !== null && !refExists(draft, approvedByRef)) return fail('definitions_missing_approver', { approvedByRef });
  const { record } = found;
  if (!hasDefinitionDomain(record.domainId)) return fail('definitions_unregistered_domain', { domainId: record.domainId });
  if (hasDefinition(draft, record.domainId, record.definitionId)) {
    return fail('definitions_duplicate_definition', { domainId: record.domainId, definitionId: record.definitionId });
  }
  // The data was checked when proposed; check again in case what it refers to has changed.
  const problems = definitionProblems(draft, record.domainId, record.definitionId, record.definitionData);
  if (problems.length) return fail('definitions_invalid_definition', problems);
  record.approvalStatus = 'approved';
  record.approvedByRef = clone(approvedByRef);
  record.revision += 1;
  draft.world.customDefinitions.revision += 1;
  return ok({ key: recordKey(record.domainId, record.definitionId) });
}

export function rejectDefinition(draft, input) {
  const found = pendingRecord(draft, input);
  if (!found.ok) return found;
  const { record } = found;
  record.approvalStatus = 'rejected';
  record.revision += 1;
  draft.world.customDefinitions.revision += 1;
  return ok({ key: recordKey(record.domainId, record.definitionId) });
}
