// Definitions and typed references: what other areas may use.
import { registerAreaCheck } from '../../persist/schema.js';
import { checkDefinitions } from './checks.js';

export {
  DEFINITIONS_VERSION, APPROVAL_STATUSES,
  isStoredId, isDefinitionId, recordKey,
  registerDefinitionDomain, hasDefinitionDomain, isCatalogDefinition,
  getDefinition, hasDefinition, listDefinitionIds, definitionProblems,
} from './registry.js';
export { REF_TYPES, isStoredRef, findRefTarget, refExists, checkRef } from './refs.js';
export { proposeDefinition, approveDefinition, rejectDefinition, getProposal, listProposals } from './rules.js';
export { checkDefinitions } from './checks.js';

registerAreaCheck('definitions', checkDefinitions);
