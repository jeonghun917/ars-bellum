// Characters (people with skills, condition and standing) and NPC activity profiles.
// Other areas import only from here.
import { registerAreaCheck } from '../../persist/schema.js';
import { checkCharacters } from './checks.js';
import { checkActivity } from './activity/checks.js';

export { CHARACTER_VERSION, LOCATION_MODES } from './shape.js';
export {
  DEFAULT_APTITUDE_VALUE, DEFAULT_SKILL_MAX_LEVEL, DERIVED_RATINGS, GROWTH_SOURCE_IDS, SKILL_APTITUDE,
} from './catalog.js';
export {
  createCharacter, updateProfile, setAffiliations, setTitleIndex, setClaimIndex, setPersonalAssets, placeInSettlement,
  setGroupLocation, recordDeath, getCharacter, listCharacters, isAlive,
} from './rules.js';
export { DAYS_PER_YEAR, getAge, getModifiers, setCondition } from './condition.js';
export {
  XP_PER_LEVEL, gainExperience, gainFromAction, gainFromRole, gainFromEducation, gainFromEvent, getDerivedRatings, repetitionFactor,
} from './progression.js';
export { checkCharacters } from './checks.js';

export {
  ACTIVITY_TIERS, ACTIVITY_VERSION, PROCESS_INTERVAL, TIER_RANK, defaultProfile, getProfile, isRoleReferenced,
} from './activity/profiles.js';
export { applyRoleEffects, changeTiers, collectDueCharacters, processCharacter } from './activity/rules.js';
export { checkActivity } from './activity/checks.js';

registerAreaCheck('characters', checkCharacters);
registerAreaCheck('npc_activity', checkActivity);
