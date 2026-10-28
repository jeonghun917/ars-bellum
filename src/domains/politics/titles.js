// Titles: a named position with a holder (a character, clan or faction), a place in a hierarchy
// (parent title) and a status that says whether it needs, forbids or allows a holder.
//
// Record: { id, version, revision, titleTypeId, name, holderRef, parentTitleId, successionLawId,
// statusId, customData }.
import { clone, isRecord } from '../../core/data.js';
import { isId } from '../../core/ids.js';
import { ok } from '../../core/result.js';
import { getDefinition, hasDefinition } from './definitions.js';
import {
  HOLDER_REF_TYPES, RECORD_VERSION, characterIdsIn, copyRef, getTitle, has, isAlive, isCount, isStoredId, isStoredRef, needRecord, politicsFail,
  recordFor, sameJson, sameRef, syncCharacterIndexes,
} from './shared.js';

const holderState = (state, holderRef) => {
  const holder = recordFor(state, holderRef);
  return holder ? { holder } : null;
};

// Problems with one title on its own. `titles` is the set it sits in (for the parent).
export function titleProblems(state, id, record, titles = state.world.titles) {
  if (!isRecord(record)) return ['record_not_plain'];
  const problems = [];
  if (record.id !== id) problems.push('record_id_mismatch');
  if (!isStoredId(record.id)) problems.push('invalid_title_id');
  if (record.version !== RECORD_VERSION) problems.push('unsupported_version');
  if (!isCount(record.revision)) problems.push('invalid_revision');
  if (typeof record.name !== 'string') problems.push('invalid_name');
  const type = getDefinition(state, 'title_type', record.titleTypeId);
  const status = getDefinition(state, 'title_status', record.statusId);
  if (!type) problems.push('unregistered_title_type');
  if (!status) problems.push('unregistered_title_status');
  if (record.holderRef !== null && !isStoredRef(record.holderRef)) problems.push('invalid_holder_ref');
  if (status) {
    if (status.holderMode === 'required' && record.holderRef === null) problems.push('title_holder_required');
    if (status.holderMode === 'forbidden' && record.holderRef !== null) problems.push('title_holder_forbidden');
  }
  if (isStoredRef(record.holderRef)) {
    if (!HOLDER_REF_TYPES.includes(record.holderRef.type) || (type && !type.allowedHolderRefTypes.includes(record.holderRef.type))) problems.push('title_holder_type_not_allowed');
    else if (!holderState(state, record.holderRef)) problems.push('missing_holder');
  }
  if (record.successionLawId !== null && !hasDefinition(state, 'succession_law', record.successionLawId)) problems.push('unregistered_succession_law');
  if (!isRecord(record.customData)) problems.push('invalid_custom_data');
  if (record.parentTitleId === null) {
    if (type && type.allowRoot !== true) problems.push('title_root_not_allowed');
  } else if (!isStoredId(record.parentTitleId)) {
    problems.push('invalid_parent_title_id');
  } else if (!has(titles, record.parentTitleId)) {
    problems.push('missing_parent_title');
  } else {
    const parentType = getDefinition(state, 'title_type', titles[record.parentTitleId].titleTypeId);
    if (type && parentType && !type.allowedParentTitleTypeIds.includes(parentType.id)) problems.push('parent_type_not_allowed');
    const seen = new Set([id]);
    for (let parent = record.parentTitleId; parent !== null && has(titles, parent); parent = titles[parent].parentTitleId) {
      if (seen.has(parent)) {
        problems.push('title_parent_cycle');
        break;
      }
      seen.add(parent);
    }
  }
  return problems;
}

const sameHolder = (a, b) => (a === null || b === null ? a === b : sameRef(a, b));

// Which changes the old status allows: a terminal status never changes; the next status must be
// listed; moving only the holder needs a status that allows it (and a holder change must keep both
// statuses requiring a holder); moving the parent needs statuses that allow it.
function transitionProblem(state, current, next, command) {
  const oldStatus = getDefinition(state, 'title_status', current.statusId);
  const newStatus = getDefinition(state, 'title_status', next.statusId);
  if (!oldStatus || !newStatus || oldStatus.terminal || !oldStatus.allowedNextStatusIds.includes(next.statusId)) return politicsFail('invalid_transition', { from: current.statusId, to: next.statusId });
  const holderChanged = !sameHolder(current.holderRef, next.holderRef);
  if (command === 'holder' && (oldStatus.holderMode !== 'required' || newStatus.holderMode !== 'required' || !oldStatus.allowsHolderChange)) return politicsFail('invalid_transition', { status: current.statusId });
  if (command === 'parent' && (!oldStatus.allowsParentChange || !newStatus.allowsParentChange)) return politicsFail('invalid_transition', { status: current.statusId });
  // A holder that changes inside one status (no status change) needs that status to allow it; a
  // holder that appears or goes with the status (vacant <-> active) is the status change itself.
  if (command === 'transition' && holderChanged && current.statusId === next.statusId && !oldStatus.allowsHolderChange) return politicsFail('invalid_transition', { status: current.statusId });
  return null;
}

function checkHolder(draft, type, holderRef) {
  if (holderRef === null) return null;
  if (!isStoredRef(holderRef) || !HOLDER_REF_TYPES.includes(holderRef.type) || !type.allowedHolderRefTypes.includes(holderRef.type)) return politicsFail('title_holder_type_not_allowed', { holderRef });
  const found = holderState(draft, holderRef);
  if (!found) return politicsFail('missing_holder', { holderRef });
  if (holderRef.type === 'character' && !isAlive(found.holder)) return politicsFail('holder_not_alive', { holderRef });
  return null;
}

function store(draft, next, current) {
  const problems = titleProblems(draft, next.id, next, { ...draft.world.titles, [next.id]: next });
  if (problems.length) return politicsFail('invalid_title', { id: next.id, problems });
  draft.world.titles[next.id] = next;
  syncCharacterIndexes(draft, [...characterIdsIn(current && current.holderRef), ...characterIdsIn(next.holderRef)]);
  return null;
}

function changed(draft, titleId, change, command, context = {}) {
  const current = getTitle(draft, titleId);
  if (!current) return politicsFail('missing_title', { titleId });
  const next = clone(current);
  const early = change(next, current);
  if (early) return early;
  const type = getDefinition(draft, 'title_type', current.titleTypeId);
  const transition = transitionProblem(draft, current, next, command);
  if (transition) return transition;
  if (command !== 'law' && type) {
    if (command === 'holder' && context.via !== 'inheritance' && !type.transferable) return politicsFail('asset_not_transferable', { titleId });
    const holderBad = !sameHolder(current.holderRef, next.holderRef) ? checkHolder(draft, type, next.holderRef) : null;
    if (holderBad) return holderBad;
  }
  if (sameJson({ ...current, revision: 0 }, { ...next, revision: 0 })) return politicsFail('no_change');
  next.revision = current.revision + 1;
  const stored = store(draft, next, current);
  return stored || ok({ titleId });
}

// input: { id, name?, titleTypeId?, parentTitleId?, holderRef?, statusId?, successionLawId?, customData? }
// The status defaults to the type's default status (vacant for the built-in type).
export function createTitle(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  if (!isId(input.id)) return politicsFail('invalid_title_id');
  if (has(draft.world.titles, input.id)) return politicsFail('duplicate_title_id', { id: input.id });
  const titleTypeId = input.titleTypeId === undefined ? 'generic_title' : input.titleTypeId;
  const type = getDefinition(draft, 'title_type', titleTypeId);
  if (!type) return politicsFail('unregistered_title_type', { titleTypeId });
  if (input.name !== undefined && typeof input.name !== 'string') return politicsFail('invalid_name');
  if (input.customData !== undefined && !isRecord(input.customData)) return politicsFail('invalid_custom_data');
  const optionalId = (value) => (value === undefined || value === null ? null : value);
  const holderRef = input.holderRef === undefined || input.holderRef === null ? null : input.holderRef;
  const holderBad = checkHolder(draft, type, holderRef);
  if (holderBad) return holderBad;
  const next = {
    id: input.id,
    version: RECORD_VERSION,
    revision: 0,
    titleTypeId,
    name: input.name === undefined ? '' : input.name,
    holderRef: holderRef === null ? null : copyRef(holderRef),
    parentTitleId: optionalId(input.parentTitleId),
    successionLawId: optionalId(input.successionLawId),
    statusId: input.statusId === undefined ? type.defaultStatusId : input.statusId,
    customData: input.customData === undefined ? {} : clone(input.customData),
  };
  const stored = store(draft, next, null);
  return stored || ok({ titleId: next.id });
}

// Moves a title to another status together with its holder (the one way to fill or empty a title).
// input: { titleId, statusId, holderRef }
export function transitionTitle(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  if (!isStoredId(input.statusId) || (input.holderRef !== null && !isStoredRef(input.holderRef))) return politicsFail('invalid_input', { field: 'statusId/holderRef' });
  return changed(draft, input.titleId, (next) => {
    next.statusId = input.statusId;
    next.holderRef = input.holderRef === null ? null : copyRef(input.holderRef);
  }, 'transition');
}

// Gives an active title to another holder. context.via = 'inheritance' checks `inheritable`
// (done by succession) instead of `transferable`.
export function changeTitleHolder(draft, input, context = {}) {
  const bad = needRecord(input);
  if (bad) return bad;
  if (!isStoredRef(input.holderRef)) return politicsFail('invalid_input', { field: 'holderRef' });
  const current = getTitle(draft, input.titleId);
  if (current && context.via === 'inheritance') {
    const type = getDefinition(draft, 'title_type', current.titleTypeId);
    if (type && !type.inheritable) return politicsFail('asset_not_inheritable', { titleId: input.titleId });
  }
  return changed(draft, input.titleId, (next) => {
    next.holderRef = copyRef(input.holderRef);
  }, 'holder', context);
}

export function changeTitleParent(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  if (input.parentTitleId !== null && !isStoredId(input.parentTitleId)) return politicsFail('invalid_input', { field: 'parentTitleId' });
  return changed(draft, input.titleId, (next) => {
    next.parentTitleId = input.parentTitleId;
  }, 'parent');
}

// Changes only the status; a status that needs or forbids a holder the title does not match must
// go through transitionTitle.
export function changeTitleStatus(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  if (!isStoredId(input.statusId)) return politicsFail('invalid_input', { field: 'statusId' });
  return changed(draft, input.titleId, (next) => {
    next.statusId = input.statusId;
  }, 'status');
}

export function setTitleSuccessionLaw(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  if (input.successionLawId !== null && !hasDefinition(draft, 'succession_law', input.successionLawId)) return politicsFail('unregistered_succession_law', { successionLawId: input.successionLawId });
  return changed(draft, input.titleId, (next) => {
    next.successionLawId = input.successionLawId;
  }, 'law');
}

export function listChildTitleIds(state, titleId) {
  return Object.keys(state.world.titles).filter((id) => state.world.titles[id].parentTitleId === titleId).sort();
}

export function listTitleIdsHeldBy(state, holderRef) {
  return Object.keys(state.world.titles).filter((id) => sameRef(state.world.titles[id].holderRef, holderRef)).sort();
}
