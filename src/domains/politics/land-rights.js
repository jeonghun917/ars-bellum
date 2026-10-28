// Rights over settlements, kept apart: legal ownership, holding, revenue, rule, administration,
// suzerainty, military occupation and claim are separate records, so a conquest changes only the
// occupation and a governor's appointment only the administration.
//
// Record: { id, version, revision, rightTypeId, subjectRef, holderRef, basisRef, share, startDay,
// endDay, status ('active' | 'terminated' | 'superseded'), supersedesRightId, supersededByRightId,
// disputed, recognizedByFactionIds, customData }.
//
// Shares are fractions of one, kept to a millionth (LAND_RIGHT_SHARE_SCALE units); sums and splits
// are done on whole units so nothing is lost to rounding.
import { clone, isRecord } from '../../core/data.js';
import { isId } from '../../core/ids.js';
import { ok } from '../../core/result.js';
import { getDefinition } from './definitions.js';
import {
  BASIS_REF_TYPES, HOLDER_REF_TYPES, RECORD_VERSION, SUBJECT_REF_TYPES, bump, characterIdsIn, copyRef, getCharacter, getFaction, getLandRight,
  has, isAlive, isBoolean, isCount, isDayNumber, isFiniteNumber, isStoredId, isStoredRef, needRecord, politicsFail, recordFor, refKey, sameRef,
  sortedUnique, syncCharacterIndexes, todayOf,
} from './shared.js';

export const LAND_RIGHT_SHARE_SCALE = 1000000;
export const LAND_RIGHT_STATUSES = Object.freeze(['active', 'terminated', 'superseded']);

// Whole units of a share, or null when it is not a number in range or is finer than a millionth.
// (Rounded before comparing: 0.000249 * 1000000 is 248.99999999999997 in floating point, and the
// earlier version refused such shares.)
export function unitsFromShare(share) {
  if (!isFiniteNumber(share) || share < 0) return null;
  const scaled = share * LAND_RIGHT_SHARE_SCALE;
  const units = Math.round(scaled);
  return Math.abs(scaled - units) <= 1e-6 ? units : null;
}

export const shareFromUnits = (units) => units / LAND_RIGHT_SHARE_SCALE;

export const isActiveAt = (right, day) => right.status === 'active' && right.startDay <= day && (right.endDay === null || day <= right.endDay);

const rightType = (state, record) => getDefinition(state, 'land_right_type', record.rightTypeId);

// Problems with one right on its own (its fields and the records it points to).
export function landRightProblems(state, id, record) {
  if (!isRecord(record)) return ['record_not_plain'];
  const problems = [];
  if (record.id !== id) problems.push('record_id_mismatch');
  if (!isStoredId(record.id)) problems.push('invalid_land_right_id');
  if (record.version !== RECORD_VERSION) problems.push('unsupported_version');
  if (!isCount(record.revision)) problems.push('invalid_revision');
  const def = rightType(state, record);
  if (!def) problems.push('unregistered_land_right_type');
  const subjectOk = isStoredRef(record.subjectRef);
  const holderOk = isStoredRef(record.holderRef);
  if (!subjectOk) problems.push('invalid_subject_ref');
  if (!holderOk) problems.push('invalid_holder_ref');
  if (subjectOk) {
    if (!SUBJECT_REF_TYPES.includes(record.subjectRef.type) || (def && !def.allowedSubjectRefTypes.includes(record.subjectRef.type))) problems.push('subject_type_not_allowed');
    else if (!recordFor(state, record.subjectRef)) problems.push('missing_subject');
  }
  if (holderOk) {
    if (!HOLDER_REF_TYPES.includes(record.holderRef.type) || (def && !def.allowedHolderRefTypes.includes(record.holderRef.type))) problems.push('holder_type_not_allowed');
    else if (!recordFor(state, record.holderRef)) problems.push('missing_holder');
  }
  if (record.basisRef !== null) {
    if (!isStoredRef(record.basisRef)) problems.push('invalid_basis_ref');
    else if (!BASIS_REF_TYPES.includes(record.basisRef.type) || (def && !def.allowedBasisRefTypes.includes(record.basisRef.type))) problems.push('basis_type_not_allowed');
    else if (record.basisRef.type === 'land_right' && record.basisRef.id === record.id) problems.push('basis_is_self');
    else if (!recordFor(state, record.basisRef)) problems.push('missing_basis');
  } else if (def && def.basisRequired) {
    problems.push('basis_ref_required');
  }
  if (def) {
    if (def.shareMode === 'none' && record.share !== null) problems.push('invalid_share');
    if (def.shareMode === 'single' && record.share !== 1) problems.push('invalid_share');
    if (def.shareMode === 'fractional' && (!isFiniteNumber(record.share) || record.share <= 0 || record.share > 1)) problems.push('invalid_share');
  }
  if (record.share !== null && unitsFromShare(record.share) === null) problems.push('invalid_share_precision');
  if (!isDayNumber(record.startDay)) problems.push('invalid_start_day');
  if (record.endDay !== null && (!isDayNumber(record.endDay) || (isDayNumber(record.startDay) && record.endDay < record.startDay))) problems.push('invalid_end_day');
  if (!LAND_RIGHT_STATUSES.includes(record.status)) problems.push('invalid_right_status');
  else {
    if (record.status !== 'active' && record.endDay === null) problems.push('ended_right_needs_end_day');
    if ((record.status === 'superseded') !== (record.supersededByRightId !== null)) problems.push('supersede_status_mismatch');
  }
  for (const link of [record.supersedesRightId, record.supersededByRightId]) {
    if (link !== null && (!isStoredId(link) || link === record.id)) problems.push('invalid_supersede_link');
  }
  if (!isBoolean(record.disputed)) problems.push('invalid_disputed');
  const recognized = record.recognizedByFactionIds;
  if (!Array.isArray(recognized) || !recognized.every(isStoredId) || new Set(recognized).size !== recognized.length
    || JSON.stringify(recognized) !== JSON.stringify([...recognized].sort())) {
    problems.push('invalid_recognition_list');
  } else if (recognized.some((factionId) => !getFaction(state, factionId))) {
    problems.push('missing_recognizing_faction');
  }
  if (!isRecord(record.customData)) problems.push('invalid_custom_data');
  return problems;
}

// Problems between rights: supersede links that do not point back at each other, and rights of one
// kind on one settlement that the kind's overlap mode does not allow.
export function landRightSetProblems(state, rights = state.world.landRights) {
  const problems = [];
  const groups = {};
  for (const id of Object.keys(rights).sort()) {
    const right = rights[id];
    if (!isRecord(right)) continue;
    if (right.supersededByRightId) {
      const next = rights[right.supersededByRightId];
      if (!next || next.supersedesRightId !== id) problems.push(`supersede_link_mismatch:${id}`);
    }
    if (right.supersedesRightId) {
      const old = rights[right.supersedesRightId];
      if (!old || old.supersededByRightId !== id) problems.push(`supersede_link_mismatch:${id}`);
    }
    if (right.status !== 'active' || !isStoredRef(right.subjectRef) || !isStoredRef(right.holderRef)) continue;
    const key = `${refKey(right.subjectRef)}|${right.rightTypeId}`;
    (groups[key] ??= []).push(right);
  }
  for (const key of Object.keys(groups).sort()) {
    const group = groups[key];
    const def = rightType(state, group[0]);
    if (!def) continue;
    if (def.overlapMode === 'deny_any' && group.length > 1) problems.push(`land_right_overlap:${key}`);
    if (def.overlapMode === 'deny_same_holder') {
      const holders = new Set();
      for (const right of group) {
        const holder = refKey(right.holderRef);
        if (holders.has(holder)) problems.push(`land_right_overlap:${key}`);
        holders.add(holder);
      }
    }
    if (def.overlapMode === 'fractional_sum') {
      const units = group.reduce((sum, right) => sum + (unitsFromShare(right.share) || 0), 0);
      if (units > LAND_RIGHT_SHARE_SCALE) problems.push(`land_right_share_exceeded:${key}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Queries

const validDay = (state, day) => (day === undefined ? todayOf(state) : day);
const typeSet = (rightTypeIds) => (rightTypeIds === null || rightTypeIds === undefined ? null : new Set([].concat(rightTypeIds)));

// Settlements where `holderRef` holds a right that counts toward a faction's settlement index
// (rule, administration, suzerainty, military occupation), in force on `day`.
export function listSettlementIdsByHolder(state, holderRef, rightTypeIds = null, day = undefined) {
  const today = validDay(state, day);
  if (!isDayNumber(today) || !isStoredRef(holderRef)) return [];
  const wanted = typeSet(rightTypeIds);
  const out = new Set();
  for (const right of Object.values(state.world.landRights)) {
    const def = rightType(state, right);
    if (right.subjectRef.type === 'settlement' && sameRef(right.holderRef, holderRef) && isActiveAt(right, today)
      && (!wanted || wanted.has(right.rightTypeId)) && def && def.countsTowardFactionSettlementIndex === true) {
      out.add(right.subjectRef.id);
    }
  }
  return [...out].sort();
}

// Settlements where a right in force on `day` is recognized by the faction.
export function listSettlementIdsByRecognizingFaction(state, factionId, rightTypeIds = null, day = undefined) {
  const today = validDay(state, day);
  if (!isDayNumber(today)) return [];
  const wanted = typeSet(rightTypeIds);
  const out = new Set();
  for (const right of Object.values(state.world.landRights)) {
    if (right.subjectRef.type === 'settlement' && isActiveAt(right, today) && (!wanted || wanted.has(right.rightTypeId))
      && right.recognizedByFactionIds.includes(factionId)) {
      out.add(right.subjectRef.id);
    }
  }
  return [...out].sort();
}

// Settlements where `holderRef` holds a right of the given kinds, whether or not the kind counts
// toward the faction index (clan "holdings" and "claims" use this).
export function listSettlementIdsHeldBy(state, holderRef, rightTypeIds, day = undefined) {
  const today = validDay(state, day);
  if (!isDayNumber(today) || !isStoredRef(holderRef)) return [];
  const wanted = typeSet(rightTypeIds);
  const out = new Set();
  for (const right of Object.values(state.world.landRights)) {
    if (right.subjectRef.type === 'settlement' && sameRef(right.holderRef, holderRef) && isActiveAt(right, today) && (!wanted || wanted.has(right.rightTypeId))) {
      out.add(right.subjectRef.id);
    }
  }
  return [...out].sort();
}

// Every right in force on a settlement on `day`, as the relation "who holds what" (ordered by id).
export function listRightsOnSettlement(state, settlementId, day = undefined) {
  const today = validDay(state, day);
  if (!isDayNumber(today)) return [];
  return Object.keys(state.world.landRights).sort()
    .map((id) => state.world.landRights[id])
    .filter((right) => right.subjectRef.type === 'settlement' && right.subjectRef.id === settlementId && isActiveAt(right, today))
    .map(clone);
}

// ---------------------------------------------------------------------------------------------
// Rules

function holderProblem(draft, def, holderRef) {
  if (!isStoredRef(holderRef)) return politicsFail('invalid_holder_ref');
  if (!HOLDER_REF_TYPES.includes(holderRef.type) || !def.allowedHolderRefTypes.includes(holderRef.type)) return politicsFail('holder_type_not_allowed', { type: holderRef.type });
  const holder = recordFor(draft, holderRef);
  if (!holder) return politicsFail('missing_holder', holderRef);
  if (holderRef.type === 'character' && !isAlive(holder)) return politicsFail('holder_not_alive', holderRef);
  return null;
}

// Checks a changed set of rights as a whole, before anything is written.
function settle(draft, changes) {
  const proposed = { ...draft.world.landRights };
  for (const right of changes) proposed[right.id] = right;
  for (const right of changes) {
    const problems = landRightProblems(draft, right.id, right);
    if (problems.length) return politicsFail('invalid_land_right', { id: right.id, problems });
  }
  const touched = new Set(changes.map((right) => `${refKey(right.subjectRef)}|${right.rightTypeId}`));
  const setProblems = landRightSetProblems(draft, proposed).filter((problem) => {
    const key = problem.slice(problem.indexOf(':') + 1);
    return problem.startsWith('supersede_link_mismatch') || touched.has(key);
  });
  if (setProblems.length) return politicsFail('land_right_conflict', setProblems);
  return null;
}

function commit(draft, changes, previousHolders) {
  for (const right of changes) draft.world.landRights[right.id] = right;
  syncCharacterIndexes(draft, [...previousHolders, ...changes.flatMap((right) => characterIdsIn(right.holderRef))]);
}

function newRight(draft, input, base = {}) {
  const def = getDefinition(draft, 'land_right_type', input.rightTypeId);
  if (!def) return politicsFail('unknown_land_right_type', { rightTypeId: input.rightTypeId });
  let share = input.share;
  if (share === undefined) share = def.shareMode === 'single' ? 1 : def.shareMode === 'none' ? null : undefined;
  if (share === undefined || (share !== null && !isFiniteNumber(share))) return politicsFail('invalid_share');
  const recognized = input.recognizedByFactionIds === undefined ? [] : input.recognizedByFactionIds;
  if (!Array.isArray(recognized) || !recognized.every(isStoredId)) return politicsFail('invalid_recognition_list');
  if (input.disputed !== undefined && !isBoolean(input.disputed)) return politicsFail('invalid_disputed');
  if (input.customData !== undefined && !isRecord(input.customData)) return politicsFail('invalid_custom_data');
  if (input.startDay !== undefined && !isDayNumber(input.startDay)) return politicsFail('invalid_start_day');
  if (input.endDay !== undefined && input.endDay !== null && !isDayNumber(input.endDay)) return politicsFail('invalid_end_day');
  const holderBad = holderProblem(draft, def, input.holderRef);
  if (holderBad) return holderBad;
  return ok({
    right: {
      id: input.id,
      version: RECORD_VERSION,
      revision: 0,
      rightTypeId: input.rightTypeId,
      subjectRef: isStoredRef(input.subjectRef) ? copyRef(input.subjectRef) : input.subjectRef,
      holderRef: copyRef(input.holderRef),
      basisRef: input.basisRef === undefined || input.basisRef === null ? null : (isStoredRef(input.basisRef) ? copyRef(input.basisRef) : input.basisRef),
      share,
      startDay: input.startDay === undefined ? todayOf(draft) : input.startDay,
      endDay: input.endDay === undefined ? null : input.endDay,
      status: 'active',
      supersedesRightId: null,
      supersededByRightId: null,
      disputed: input.disputed === undefined ? false : input.disputed,
      recognizedByFactionIds: sortedUnique(recognized),
      customData: input.customData === undefined ? {} : clone(input.customData),
      ...base,
    },
  });
}

// input: { id, rightTypeId, subjectRef, holderRef, basisRef?, share?, startDay?, endDay?,
//          disputed?, recognizedByFactionIds?, customData? }
export function createLandRight(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  if (!isId(input.id)) return politicsFail('invalid_land_right_id');
  if (has(draft.world.landRights, input.id)) return politicsFail('duplicate_land_right_id', { id: input.id });
  const built = newRight(draft, input);
  if (!built.ok) return built;
  const conflict = settle(draft, [built.right]);
  if (conflict) return conflict;
  commit(draft, [built.right], []);
  return ok({ rightId: input.id });
}

function loadActiveRight(draft, rightId) {
  const right = getLandRight(draft, rightId);
  if (!right) return politicsFail('missing_land_right', { rightId });
  if (right.status !== 'active') return politicsFail('invalid_transition', { rightId, status: right.status });
  return ok({ right });
}

// Gives the whole right to a new holder. context.via = 'inheritance' checks the kind's
// `inheritable` flag instead of `transferable` (a claim passes to heirs but cannot be sold).
export function transferLandRight(draft, input, context = {}) {
  const bad = needRecord(input);
  if (bad) return bad;
  const found = loadActiveRight(draft, input.rightId);
  if (!found.ok) return found;
  const def = rightType(draft, found.right);
  const byInheritance = context.via === 'inheritance';
  if (byInheritance ? !def.inheritable : !def.transferable) return politicsFail(byInheritance ? 'asset_not_inheritable' : 'asset_not_transferable', { rightId: input.rightId });
  const holderBad = holderProblem(draft, def, input.holderRef);
  if (holderBad) return holderBad;
  if (sameRef(found.right.holderRef, input.holderRef)) return politicsFail('no_change');
  const next = clone(found.right);
  next.holderRef = copyRef(input.holderRef);
  next.revision += 1;
  const conflict = settle(draft, [next]);
  if (conflict) return conflict;
  commit(draft, [next], characterIdsIn(found.right.holderRef));
  return ok({ rightId: next.id });
}

export function setLandRightRecognition(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  const found = loadActiveRight(draft, input.rightId);
  if (!found.ok) return found;
  const list = input.recognizedByFactionIds;
  if (!Array.isArray(list) || !list.every(isStoredId)) return politicsFail('invalid_recognition_list');
  const next = clone(found.right);
  next.recognizedByFactionIds = sortedUnique(list);
  if (JSON.stringify(next.recognizedByFactionIds) === JSON.stringify(found.right.recognizedByFactionIds)) return politicsFail('no_change');
  next.revision += 1;
  const conflict = settle(draft, [next]);
  if (conflict) return conflict;
  commit(draft, [next], []);
  return ok({ rightId: next.id });
}

export function setLandRightDisputed(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  const found = loadActiveRight(draft, input.rightId);
  if (!found.ok) return found;
  if (!isBoolean(input.disputed)) return politicsFail('invalid_disputed');
  if (found.right.disputed === input.disputed) return politicsFail('no_change');
  found.right.disputed = input.disputed;
  bump(found.right);
  return ok({ rightId: found.right.id });
}

function endDayFor(draft, right, input) {
  const endDay = input.endDay === undefined ? Math.max(todayOf(draft), right.startDay) : input.endDay;
  return isDayNumber(endDay) && endDay >= right.startDay ? endDay : null;
}

// input: { rightId, endDay? } (endDay defaults to today)
export function terminateLandRight(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  const found = loadActiveRight(draft, input.rightId);
  if (!found.ok) return found;
  const endDay = endDayFor(draft, found.right, input);
  if (endDay === null) return politicsFail('invalid_end_day');
  const next = clone(found.right);
  next.status = 'terminated';
  next.endDay = endDay;
  next.revision += 1;
  const conflict = settle(draft, [next]);
  if (conflict) return conflict;
  commit(draft, [next], characterIdsIn(found.right.holderRef));
  return ok({ rightId: next.id });
}

// Ends a right and starts its successor on the same settlement and kind (a new holder, a new share,
// a new basis). input: { rightId, nextRight: { id, holderRef, share?, basisRef?, startDay?, ... }, endDay? }
export function supersedeLandRight(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  const found = loadActiveRight(draft, input.rightId);
  if (!found.ok) return found;
  const old = found.right;
  const spec = input.nextRight;
  if (!isRecord(spec) || !isId(spec.id)) return politicsFail('invalid_next_right');
  if (has(draft.world.landRights, spec.id)) return politicsFail('duplicate_land_right_id', { id: spec.id });
  if ((spec.rightTypeId !== undefined && spec.rightTypeId !== old.rightTypeId) || (spec.subjectRef !== undefined && !sameRef(spec.subjectRef, old.subjectRef))) {
    return politicsFail('supersede_changes_subject_or_type');
  }
  const endDay = endDayFor(draft, old, input);
  if (endDay === null) return politicsFail('invalid_end_day');
  const built = newRight(draft, {
    ...spec,
    rightTypeId: old.rightTypeId,
    subjectRef: old.subjectRef,
    share: spec.share === undefined ? old.share : spec.share,
    basisRef: spec.basisRef === undefined ? old.basisRef : spec.basisRef,
    startDay: spec.startDay === undefined ? Math.max(endDay, old.startDay) : spec.startDay,
  }, { supersedesRightId: old.id });
  if (!built.ok) return built;
  const ended = clone(old);
  ended.status = 'superseded';
  ended.endDay = endDay;
  ended.supersededByRightId = spec.id;
  ended.revision += 1;
  const conflict = settle(draft, [ended, built.right]);
  if (conflict) return conflict;
  commit(draft, [ended, built.right], characterIdsIn(old.holderRef));
  return ok({ rightId: old.id, nextRightId: spec.id });
}

// Splits a fractional right: each split takes `shareUnits` (whole millionths) into a new right for
// its holder; the original keeps the rest, which must stay above zero (except in an inheritance,
// where the splits may use it all and the original then ends).
// input: { rightId, splits: [{ id, holderRef, shareUnits }] }. context.via = 'inheritance' as above.
export function splitLandRight(draft, input, context = {}) {
  const bad = needRecord(input);
  if (bad) return bad;
  const found = loadActiveRight(draft, input.rightId);
  if (!found.ok) return found;
  const old = found.right;
  const def = rightType(draft, old);
  if (def.shareMode !== 'fractional') return politicsFail('asset_minimum_unit_violation', { rightId: old.id });
  const byInheritance = context.via === 'inheritance';
  if (byInheritance ? !def.inheritable : !def.transferable) return politicsFail(byInheritance ? 'asset_not_inheritable' : 'asset_not_transferable', { rightId: old.id });
  const splits = input.splits;
  if (!Array.isArray(splits) || splits.length === 0) return politicsFail('invalid_splits');
  const originalUnits = unitsFromShare(old.share);
  const seen = new Set();
  let used = 0;
  for (const split of splits) {
    if (!isRecord(split) || !isId(split.id) || has(draft.world.landRights, split.id) || seen.has(split.id)) return politicsFail('allocation_conflict', { id: split && split.id });
    if (!Number.isSafeInteger(split.shareUnits) || split.shareUnits <= 0) return politicsFail('asset_minimum_unit_violation', { id: split.id });
    seen.add(split.id);
    used += split.shareUnits;
  }
  // Inheritance may hand out the whole share: the original right then ends and the new rights carry
  // all of it. Otherwise the original must keep something.
  const exhausts = byInheritance && used === originalUnits;
  if (!Number.isSafeInteger(used) || (used >= originalUnits && !exhausts)) return politicsFail('land_right_share_exceeded', { rightId: old.id });
  const changes = [];
  const remainder = clone(old);
  if (exhausts) {
    remainder.status = 'terminated';
    remainder.endDay = Math.max(todayOf(draft), old.startDay);
  } else {
    remainder.share = shareFromUnits(originalUnits - used);
  }
  remainder.revision += 1;
  changes.push(remainder);
  for (const split of splits) {
    const holderBad = holderProblem(draft, def, split.holderRef);
    if (holderBad) return holderBad;
    const child = clone(old);
    child.id = split.id;
    child.revision = 0;
    child.holderRef = copyRef(split.holderRef);
    child.share = shareFromUnits(split.shareUnits);
    child.supersedesRightId = null;
    child.supersededByRightId = null;
    changes.push(child);
  }
  const conflict = settle(draft, changes);
  if (conflict) return conflict;
  commit(draft, changes, characterIdsIn(old.holderRef));
  return ok({ rightId: old.id, newRightIds: splits.map((split) => split.id) });
}
