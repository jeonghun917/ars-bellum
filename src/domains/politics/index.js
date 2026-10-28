// Politics: clans, factions (the crown's power on four axes), titles, rights over settlements,
// who belongs to whom, and succession. Other areas import only from here.
import { registerAreaCheck } from '../../persist/schema.js';
import { checkPolitics } from './checks.js';

export { checkPolitics } from './checks.js';
export {
  DEFINITION_DOMAINS, DEFINITION_DOMAIN_SPECS, getDefinition, hasDefinition,
} from './definitions.js';
export {
  BPS_SCALE, ELIGIBILITY, EVALUATORS, INHERITANCE, POLICY_IDS, allocateIntegerLot, orderBeneficiaries, runPolicy,
} from './policies.js';
export { SUCCESSION_CAUSES, effectivePacts, pactIsEffective, validatePactStructure } from './pacts.js';
export {
  CLAN_HEAD_POWER_KEYS, CLAN_STANDING_KEYS, clanProblems, createClan, getClanView, listClanMemberIds, setBranchClans, setClanLaws, setClanMetrics,
  setDesignatedSuccessors, setInheritancePacts,
} from './clans.js';
export {
  POWER_MAX, POWER_MIN, SOVEREIGN_POWER_KEYS, adjustSovereignPower, buildObedienceInput, createFaction, factionProblems, getFactionView,
  listFactionClanIds, setFactionLaws, setSovereignPower,
} from './factions.js';
export {
  changeTitleHolder, changeTitleParent, changeTitleStatus, createTitle, listChildTitleIds, listTitleIdsHeldBy, setTitleSuccessionLaw, titleProblems,
  transitionTitle,
} from './titles.js';
export {
  LAND_RIGHT_SHARE_SCALE, LAND_RIGHT_STATUSES, createLandRight, isActiveAt, landRightProblems, landRightSetProblems, listRightsOnSettlement,
  listSettlementIdsByHolder, listSettlementIdsByRecognizingFaction, listSettlementIdsHeldBy, setLandRightDisputed, setLandRightRecognition,
  shareFromUnits, splitLandRight, supersedeLandRight, terminateLandRight, transferLandRight, unitsFromShare,
} from './land-rights.js';
export {
  changeClanHead, changeFactionRulingClan, changeFactionRuler, joinClan, leaveClan, linkClanToFaction, setClanTreasury, setFactionTreasury,
  unlinkClanFromFaction,
} from './affiliation.js';
export { planEstateAllocations, resolveSuccession } from './succession.js';

registerAreaCheck('politics', checkPolitics);
