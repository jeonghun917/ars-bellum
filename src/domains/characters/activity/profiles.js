// NPC activity profiles: how often each character is looked at by the daily world simulation.
//
// Every character has a profile (a default one until something changes it). The tier says how
// important the character is: major characters are processed every day, named ones weekly or
// monthly, historical ones never. Record shape is the earlier version's (world.npcActivityProfiles).
import { clone, isRecord } from '../../../core/data.js';
import { isStoredId } from '../../definitions/index.js';

export const ACTIVITY_VERSION = 1;
export const ACTIVITY_TIERS = Object.freeze(['active_major', 'active_named', 'inactive_named', 'historical']);
export const PINNABLE_TIERS = Object.freeze(['active_major', 'active_named', 'inactive_named']);
export const TIER_RANK = Object.freeze({ historical: 0, inactive_named: 1, active_named: 2, active_major: 3 });
// Days between two processings of a character of each tier.
export const PROCESS_INTERVAL = Object.freeze({ active_major: 1, active_named: 7, inactive_named: 30 });
export const MAX_IMPORTANCE = 1000;

export function defaultProfile(characterId) {
  return {
    characterId,
    tier: 'active_named',
    importanceScore: 0,
    nextProcessDay: 1,
    lastProcessedDay: 0,
    promotionReasonIds: [],
    stableRoleKeys: [],
    demotionEligibleDay: null,
    pinnedTierFloor: null,
    revision: 0,
  };
}

// The stored profile, or the default one for a character who has none yet; null for no such character.
export function getProfile(state, characterId) {
  if (!isStoredId(characterId) || !Object.hasOwn(state.world.characters, characterId)) return null;
  const stored = state.world.npcActivityProfiles.records[characterId];
  return clone(isRecord(stored) ? stored : defaultProfile(characterId));
}

// Is the character something other records point at as a person in office? Such a character
// must not become historical. Reads the player control, clan, faction and title records.
export function isRoleReferenced(state, characterId) {
  if (state.playerControl.currentCharacterId === characterId) return true;
  const world = state.world;
  if (Object.values(world.clans).some((clan) => clan.headCharacterId === characterId)) return true;
  if (Object.values(world.factions).some((faction) => faction.rulerCharacterId === characterId)) return true;
  return Object.values(world.titles).some((title) => title.statusId === 'active' && title.holderRef?.type === 'character' && title.holderRef.id === characterId);
}
