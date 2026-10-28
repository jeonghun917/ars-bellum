// Player control: which character the player plays. Other areas import only from here.
import { registerAreaCheck } from '../../persist/schema.js';
import { checkControl } from './checks.js';

export {
  CONTROL_STATUSES, CONTROL_VERSION, TRANSITION_CAUSES,
  bindInitialCharacter, endCampaign, removeDeadSuccessors, setCampaignClan, setSuccessors, transitionControl,
  getCurrentCharacterId, getPlayerControl, isPlayerCharacter,
} from './rules.js';
export { checkControl } from './checks.js';

registerAreaCheck('control', checkControl);
