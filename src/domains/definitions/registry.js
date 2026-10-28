// The registry of definition domains (skill, mobile_group_type, ...) and the lookup of definitions.
//
// A definition is either part of a built-in catalog (code, registered by the owning area when its
// module loads) or a custom definition proposed in play and stored in world.customDefinitions. A
// custom definition counts as known only once approved. The earlier version kept approved
// definitions in a runtime registry that had to be refilled after loading; here they are read
// straight from state, so nothing needs refilling.
import { isRecord, clone, deepFreeze } from '../../core/data.js';

export const DEFINITIONS_VERSION = 1;
export const APPROVAL_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);

// Ids the earlier version wrote: letters of either case. New ids are made with isId (lowercase);
// stored records are checked with this so earlier saves keep loading.
const STORED_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/;
export const isStoredId = (value) => typeof value === 'string' && STORED_ID.test(value);

// Definition and domain ids: lowercase, starting with a letter (as the earlier registry required).
const DEFINITION_ID = /^[a-z][a-z0-9_.:-]*$/;
export const isDefinitionId = (value) => typeof value === 'string' && value.length <= 120 && DEFINITION_ID.test(value);

const domains = new Map();

export const recordKey = (domainId, definitionId) => `${domainId}:${definitionId}`;

function customRecords(state) {
  const root = state?.world?.customDefinitions;
  return isRecord(root) && isRecord(root.records) ? root.records : {};
}

function approvedRecord(state, domainId, definitionId) {
  const record = customRecords(state)[recordKey(domainId, definitionId)];
  const known = isRecord(record) && record.domainId === domainId && record.definitionId === definitionId;
  return known && record.approvalStatus === 'approved' ? record : null;
}

export const hasDefinitionDomain = (domainId) => domains.has(domainId);
export const isCatalogDefinition = (domainId, definitionId) => domains.get(domainId)?.catalog.has(definitionId) === true;

// Does not copy the definition, so it is cheap enough for checks that run on every change.
export function hasDefinition(state, domainId, definitionId) {
  const domain = domains.get(domainId);
  if (!domain || typeof definitionId !== 'string') return false;
  return domain.catalog.has(definitionId) || approvedRecord(state, domainId, definitionId) !== null;
}

export function getDefinition(state, domainId, definitionId) {
  const domain = domains.get(domainId);
  if (!domain || typeof definitionId !== 'string') return null;
  if (domain.catalog.has(definitionId)) return clone(domain.catalog.get(definitionId));
  const record = approvedRecord(state, domainId, definitionId);
  return record && isRecord(record.definitionData) ? clone(record.definitionData) : null;
}

// Ids of every known definition in a domain (built in and approved custom), sorted.
export function listDefinitionIds(state, domainId) {
  const domain = domains.get(domainId);
  if (!domain) return [];
  const ids = new Set(domain.catalog.keys());
  for (const record of Object.values(customRecords(state))) {
    if (isRecord(record) && record.domainId === domainId && record.approvalStatus === 'approved') ids.add(record.definitionId);
  }
  return [...ids].sort();
}

// What a domain's validator may ask about other definitions (read-only).
const lookupFor = (state) => Object.freeze({
  has: (otherDomain, otherId) => hasDefinition(state, otherDomain, otherId),
  get: (otherDomain, otherId) => getDefinition(state, otherDomain, otherId),
  list: (otherDomain) => listDefinitionIds(state, otherDomain),
});

function runValidator(domain, data, state) {
  let problems;
  try {
    problems = domain.validate(data, lookupFor(state));
  } catch (error) {
    return [`validator_threw:${String(error?.message || error)}`];
  }
  return Array.isArray(problems) ? [...problems] : ['validator_rejected'];
}

// Problem codes for a definition's data against its domain, given the definitions known in `state`.
// Empty list means the data is fine. Also checks `referenceDefinitions` (definitions this one needs).
export function definitionProblems(state, domainId, definitionId, data) {
  const domain = domains.get(domainId);
  if (!domain) return ['unregistered_domain'];
  if (!isRecord(data)) return ['invalid_definition_data'];
  if (data.id !== definitionId) return ['definition_id_mismatch'];
  const problems = runValidator(domain, data, state);
  const references = data.referenceDefinitions === undefined ? [] : data.referenceDefinitions;
  if (!Array.isArray(references)) {
    problems.push('invalid_reference_definitions');
    return problems;
  }
  for (const reference of references) {
    const known = isRecord(reference) && isDefinitionId(reference.domainId) && isDefinitionId(reference.definitionId)
      && hasDefinition(state, reference.domainId, reference.definitionId);
    if (!known) problems.push(`missing_reference_definition:${reference?.domainId}:${reference?.definitionId}`);
  }
  return problems;
}

// Called once per domain by the area that owns it, when its module loads.
// validate(data, lookup) returns a list of problem codes (empty when fine). Built-in definitions
// are checked against it straight away, so a broken catalog stops the program at load.
export function registerDefinitionDomain(domainId, { validate = () => [], defaults = [] } = {}) {
  if (!isDefinitionId(domainId) || domainId.includes(':')) {
    throw new Error(`invalid definition domain id: ${domainId}`);
  }
  if (domains.has(domainId)) {
    throw new Error(`duplicate definition domain: ${domainId}`);
  }
  if (typeof validate !== 'function') {
    throw new Error(`definition domain ${domainId}: validate must be a function`);
  }
  const catalog = new Map();
  const domain = { validate, catalog };
  domains.set(domainId, domain);
  try {
    for (const definition of defaults) {
      if (!isRecord(definition) || !isDefinitionId(definition.id) || catalog.has(definition.id)) {
        throw new Error(`invalid default definition ${domainId}:${definition?.id}`);
      }
      const problems = definitionProblems(null, domainId, definition.id, definition);
      if (problems.length) throw new Error(`invalid default definition ${domainId}:${definition.id}: ${problems.join(',')}`);
      catalog.set(definition.id, deepFreeze(clone(definition)));
    }
  } catch (error) {
    domains.delete(domainId);
    throw error;
  }
}

export { customRecords, approvedRecord };
