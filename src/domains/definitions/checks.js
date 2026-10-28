// Save/load checks for world.customDefinitions (the rules the earlier save validator applied, plus
// the link between approval status and approver).
import { isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import {
  APPROVAL_STATUSES, DEFINITIONS_VERSION, definitionProblems, hasDefinitionDomain, isCatalogDefinition, isDefinitionId, recordKey,
} from './registry.js';
import { isStoredRef } from './refs.js';

export function checkDefinitions(state) {
  const root = state.world.customDefinitions;
  if (!isRecord(root) || !isRecord(root.records)) return fail('definitions_invalid_root');
  if (root.version !== DEFINITIONS_VERSION) return fail('definitions_unsupported_version', { version: root.version });
  if (!Number.isInteger(root.revision) || root.revision < 0) return fail('definitions_invalid_revision');
  const problems = [];
  for (const key of Object.keys(root.records).sort()) {
    const record = root.records[key];
    const at = (code) => problems.push(`${key}:${code}`);
    if (!isRecord(record)) {
      at('invalid_record');
      continue;
    }
    if (!isDefinitionId(record.domainId) || !isDefinitionId(record.definitionId)) {
      at('invalid_identity');
      continue;
    }
    if (key !== recordKey(record.domainId, record.definitionId)) at('key_mismatch');
    if (record.schemaVersion !== DEFINITIONS_VERSION) at('invalid_schema_version');
    if (!Number.isInteger(record.definitionVersion) || record.definitionVersion < 1) at('invalid_definition_version');
    if (typeof record.sourceType !== 'string' || record.sourceType.length === 0) at('invalid_source_type');
    if (record.sourceRef !== null && record.sourceRef !== undefined && !isStoredRef(record.sourceRef)) at('invalid_source_ref');
    if (!APPROVAL_STATUSES.includes(record.approvalStatus)) at('invalid_approval_status');
    if (record.approvedByRef !== null && record.approvedByRef !== undefined && !isStoredRef(record.approvedByRef)) at('invalid_approved_by_ref');
    if (record.approvalStatus !== 'approved' && record.approvedByRef !== null && record.approvedByRef !== undefined) at('approver_without_approval');
    if (!Number.isInteger(record.revision) || record.revision < 0) at('invalid_revision');
    if (!isRecord(record.definitionData) || record.definitionData.id !== record.definitionId) {
      at('invalid_definition_data');
      continue;
    }
    if (isCatalogDefinition(record.domainId, record.definitionId)) at('duplicates_built_in_definition');
    // Domains owned by areas that are not rewritten yet are not known here; their data is checked
    // once the owning area registers its domain.
    if (hasDefinitionDomain(record.domainId)) {
      for (const problem of definitionProblems(state, record.domainId, record.definitionId, record.definitionData)) at(problem);
    }
  }
  return problems.length ? fail('definitions_invalid_records', problems) : ok();
}
