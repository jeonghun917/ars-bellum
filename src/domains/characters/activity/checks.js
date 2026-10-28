// Save/load checks for world.npcActivityProfiles (the earlier save validator's rules, plus the
// consistency between tier, roles and pinned floor that the rules keep).
import { canonicalJson, isRecord } from '../../../core/data.js';
import { ok, fail } from '../../../core/result.js';
import { isStoredId } from '../../definitions/index.js';
import { isCount } from '../shape.js';
import { ACTIVITY_TIERS, ACTIVITY_VERSION, MAX_IMPORTANCE, PINNABLE_TIERS, TIER_RANK } from './profiles.js';

const isSortedUniqueIds = (list) => Array.isArray(list) && list.every(isStoredId)
  && canonicalJson(list) === canonicalJson([...new Set(list)].sort());

function profileIssue(id, profile, characters) {
  if (!isRecord(profile) || profile.characterId !== id || !isRecord(characters[id])) return 'invalid_character_reference';
  if (!ACTIVITY_TIERS.includes(profile.tier)) return 'invalid_tier';
  if (!isCount(profile.importanceScore) || profile.importanceScore > MAX_IMPORTANCE) return 'invalid_importance';
  if (!isCount(profile.nextProcessDay) || !isCount(profile.lastProcessedDay) || !isCount(profile.revision)) return 'invalid_day_or_revision';
  if (!isSortedUniqueIds(profile.promotionReasonIds)) return 'invalid_promotion_reasons';
  if (!isSortedUniqueIds(profile.stableRoleKeys)) return 'invalid_role_keys';
  if (profile.demotionEligibleDay !== null && !isCount(profile.demotionEligibleDay)) return 'invalid_demotion_day';
  if (profile.pinnedTierFloor !== null && !PINNABLE_TIERS.includes(profile.pinnedTierFloor)) return 'invalid_pinned_floor';
  if (profile.tier === 'historical' && (profile.stableRoleKeys.length > 0 || profile.pinnedTierFloor !== null)) return 'historical_with_role_or_pin';
  if (profile.stableRoleKeys.length > 0 && TIER_RANK[profile.tier] < TIER_RANK.active_named) return 'role_below_named';
  if (profile.pinnedTierFloor !== null && TIER_RANK[profile.tier] < TIER_RANK[profile.pinnedTierFloor]) return 'tier_below_pinned_floor';
  return null;
}

export function checkActivity(state) {
  const root = state.world.npcActivityProfiles;
  if (!isRecord(root) || root.version !== ACTIVITY_VERSION || !isCount(root.revision) || !isRecord(root.records)) return fail('activity_invalid_root');
  const issues = [];
  for (const id of Object.keys(root.records).sort()) {
    const issue = profileIssue(id, root.records[id], state.world.characters);
    if (issue) issues.push(`${id}:${issue}`);
  }
  return issues.length ? fail('activity_invalid_profiles', issues) : ok();
}
