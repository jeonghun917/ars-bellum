// Changing NPC activity profiles. Each rule plans every change on copies first and only then
// writes them, so a rule that fails part-way has changed nothing. A rule that changes nothing
// (the same request again) succeeds without a new revision, so repeats are harmless.
import { canonicalJson, clone, isRecord } from '../../../core/data.js';
import { ok, fail } from '../../../core/result.js';
import { isStoredId } from '../../definitions/index.js';
import { isCount, sortedUnique } from '../shape.js';
import {
  ACTIVITY_TIERS, MAX_IMPORTANCE, PINNABLE_TIERS, PROCESS_INTERVAL, TIER_RANK, getProfile, isRoleReferenced,
} from './profiles.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const isIdArray = (value) => Array.isArray(value) && value.every(isStoredId);

function storedOrDefault(state, characterId) {
  const stored = state.world.npcActivityProfiles.records[characterId];
  return { stored: isRecord(stored) ? stored : null, profile: getProfile(state, characterId) };
}

// The final profile must make sense on its own: a historical character has no roles or pin, a
// character with roles is at least "named", and no tier is below its pinned floor.
function profileIssue(profile) {
  if (profile.tier === 'historical' && (profile.stableRoleKeys.length > 0 || profile.pinnedTierFloor !== null)) return 'activity_historical_reference_blocked';
  if (profile.stableRoleKeys.length > 0 && TIER_RANK[profile.tier] < TIER_RANK.active_named) return 'activity_role_floor_violation';
  if (profile.pinnedTierFloor !== null && TIER_RANK[profile.tier] < TIER_RANK[profile.pinnedTierFloor]) return 'activity_pin_floor_violation';
  return null;
}

// Writes planned profiles ({ id: profile }) into the draft. The root revision goes up by one if any changed.
function commit(draft, planned) {
  const root = draft.world.npcActivityProfiles;
  const changedIds = [];
  for (const id of Object.keys(planned).sort()) {
    root.records[id] = planned[id];
    changedIds.push(id);
  }
  if (changedIds.length) root.revision += 1;
  return changedIds;
}

function readChanges(list, idKey) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const ids = list.map((item) => item?.[idKey]);
  if (!list.every(isRecord) || !ids.every(isStoredId) || new Set(ids).size !== ids.length) return null;
  return [...list].sort((a, b) => a[idKey].localeCompare(b[idKey]));
}

function planTierChange(state, change, effectiveDay) {
  const known = ['characterId', 'nextTier', 'expectedRecordRevision', 'addReasonIds', 'removeReasonIds', 'demotionEligibleDay', 'pinnedTierFloor', 'importanceScore'];
  if (Object.keys(change).some((key) => !known.includes(key))) return fail('activity_invalid_input');
  if (!Object.hasOwn(state.world.characters, change.characterId)) return fail('activity_missing_character', { characterId: change.characterId });
  if (!ACTIVITY_TIERS.includes(change.nextTier)) return fail('activity_invalid_tier');
  if (change.expectedRecordRevision !== undefined && change.expectedRecordRevision !== null && !isCount(change.expectedRecordRevision)) return fail('activity_invalid_input');
  const { addReasonIds, removeReasonIds } = change;
  if ((addReasonIds !== undefined && !isIdArray(addReasonIds)) || (removeReasonIds !== undefined && !isIdArray(removeReasonIds))) return fail('activity_invalid_input');
  const add = sortedUnique(addReasonIds ?? []);
  const remove = sortedUnique(removeReasonIds ?? []);
  if (add.some((id) => remove.includes(id))) return fail('activity_invalid_input');
  if (![undefined, null].includes(change.demotionEligibleDay) && !isCount(change.demotionEligibleDay)) return fail('activity_invalid_input');
  if (![undefined, null].includes(change.pinnedTierFloor) && !PINNABLE_TIERS.includes(change.pinnedTierFloor)) return fail('activity_invalid_input');
  if (change.importanceScore !== undefined && (!isCount(change.importanceScore) || change.importanceScore > MAX_IMPORTANCE)) return fail('activity_invalid_input');

  const { stored, profile: before } = storedOrDefault(state, change.characterId);
  if (TIER_RANK[change.nextTier] < TIER_RANK[before.tier]) {
    if (before.demotionEligibleDay === null || effectiveDay < before.demotionEligibleDay) return fail('activity_demotion_not_eligible');
    if (before.stableRoleKeys.length && TIER_RANK[change.nextTier] < TIER_RANK.active_named) return fail('activity_role_floor_violation');
    if (before.pinnedTierFloor && TIER_RANK[change.nextTier] < TIER_RANK[before.pinnedTierFloor]) return fail('activity_pin_floor_violation');
  }
  if (change.nextTier === 'historical' && isRoleReferenced(state, change.characterId)) return fail('activity_historical_reference_blocked');
  const next = clone(before);
  next.tier = change.nextTier;
  next.promotionReasonIds = sortedUnique(next.promotionReasonIds.concat(add).filter((id) => !remove.includes(id)));
  if (change.demotionEligibleDay !== undefined) next.demotionEligibleDay = change.demotionEligibleDay;
  if (change.pinnedTierFloor !== undefined) next.pinnedTierFloor = change.pinnedTierFloor;
  if (change.importanceScore !== undefined) next.importanceScore = change.importanceScore;
  const issue = profileIssue(next);
  if (issue) return fail(issue);
  // Asking for what is already there is a successful no-op, even when the caller's revision is old.
  if (same(before, next)) return ok({ planned: null });
  const expected = change.expectedRecordRevision === undefined ? (stored ? stored.revision : null) : change.expectedRecordRevision;
  if ((stored ? stored.revision : null) !== expected) return fail('activity_revision_conflict');
  next.revision = stored ? stored.revision + 1 : 0;
  return ok({ planned: next });
}

// Moves characters to other tiers. A character can go down only when their "eligible from" day has
// come, never below "named" while they hold a stable role, never below a pinned floor, and becomes
// historical only when nothing refers to them as a person in office.
// input: { sourceEventId, effectiveDay, changes: [{ characterId, nextTier, expectedRecordRevision?, addReasonIds?,
//          removeReasonIds?, demotionEligibleDay?, pinnedTierFloor?, importanceScore? }] }
export function changeTiers(draft, input) {
  if (!isRecord(input) || !isStoredId(input.sourceEventId) || !isCount(input.effectiveDay)) return fail('activity_invalid_input');
  const changes = readChanges(input.changes, 'characterId');
  if (!changes) return fail('activity_invalid_input');
  const planned = {};
  for (const change of changes) {
    const result = planTierChange(draft, change, input.effectiveDay);
    if (!result.ok) return result;
    if (result.planned) planned[change.characterId] = result.planned;
  }
  return ok({ changedIds: commit(draft, planned) });
}

// A role (clan head, ruler, title holder...) starts or stops mattering for a character. Gaining a
// role makes them at least "named", clears any planned demotion and brings their next processing
// forward to the event day.
// input: { sourceEventId, eventDay, effects: [{ characterId, addRoleKeys?, removeRoleKeys? }] }
export function applyRoleEffects(draft, input) {
  if (!isRecord(input) || !isStoredId(input.sourceEventId) || !isCount(input.eventDay)) return fail('activity_invalid_input');
  const effects = readChanges(input.effects, 'characterId');
  if (!effects) return fail('activity_invalid_input');
  const planned = {};
  for (const effect of effects) {
    if (Object.keys(effect).some((key) => !['characterId', 'addRoleKeys', 'removeRoleKeys'].includes(key))) return fail('activity_invalid_input');
    if (!Object.hasOwn(draft.world.characters, effect.characterId)) return fail('activity_missing_character', { characterId: effect.characterId });
    const badList = (list) => list !== undefined && !isIdArray(list);
    if (badList(effect.addRoleKeys) || badList(effect.removeRoleKeys)) return fail('activity_invalid_input');
    const add = sortedUnique(effect.addRoleKeys ?? []);
    const remove = sortedUnique(effect.removeRoleKeys ?? []);
    if (add.some((key) => remove.includes(key))) return fail('activity_invalid_input');
    const { stored, profile: before } = storedOrDefault(draft, effect.characterId);
    const next = clone(before);
    next.stableRoleKeys = sortedUnique(next.stableRoleKeys.concat(add).filter((key) => !remove.includes(key)));
    if (add.length) {
      next.demotionEligibleDay = null;
      if (TIER_RANK[next.tier] < TIER_RANK.active_named) next.tier = 'active_named';
    }
    if (add.length || remove.length) next.nextProcessDay = Math.min(next.nextProcessDay, input.eventDay);
    if (same(before, next)) continue;
    next.revision = stored ? stored.revision + 1 : 0;
    planned[effect.characterId] = next;
  }
  return ok({ changedIds: commit(draft, planned) });
}

// Records that a character was processed today and schedules the next time by their tier.
// input: { characterId, currentDay }
export function processCharacter(draft, input) {
  if (!isRecord(input) || !isStoredId(input.characterId) || !isCount(input.currentDay)) return fail('activity_invalid_input');
  if (!Object.hasOwn(draft.world.characters, input.characterId)) return fail('activity_missing_character', { characterId: input.characterId });
  const { stored, profile } = storedOrDefault(draft, input.characterId);
  if (profile.tier === 'historical') return fail('activity_historical_not_processed');
  if (profile.lastProcessedDay === input.currentDay) return fail('activity_already_processed_today');
  if (profile.nextProcessDay > input.currentDay) return fail('activity_not_due', { nextProcessDay: profile.nextProcessDay });
  profile.lastProcessedDay = input.currentDay;
  profile.nextProcessDay = input.currentDay + PROCESS_INTERVAL[profile.tier];
  profile.revision = stored ? stored.revision + 1 : 0;
  commit(draft, { [input.characterId]: profile });
  return ok({ nextProcessDay: profile.nextProcessDay });
}

// Profiles due on `currentDay` (not historical, due by now, not already processed today), most
// important first, at most `budget` of them. Characters without a stored profile count with the default.
export function collectDueCharacters(state, currentDay, budget) {
  if (!isCount(currentDay) || !isCount(budget)) return [];
  return Object.keys(state.world.characters)
    .map((id) => getProfile(state, id))
    .filter((profile) => profile.tier !== 'historical' && profile.nextProcessDay <= currentDay && profile.lastProcessedDay !== currentDay)
    .sort((a, b) => b.importanceScore - a.importanceScore || a.lastProcessedDay - b.lastProcessedDay || a.characterId.localeCompare(b.characterId))
    .slice(0, budget);
}
