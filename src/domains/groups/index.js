// Mobile groups. Other areas import only from here.
import { registerAreaCheck } from '../../persist/schema.js';
import { checkGroups } from './checks.js';

export { COMMAND_STRUCTURES, GROUP_TYPES } from './catalog.js';
export { GROUP_VERSION, MAX_COHESION, MIN_COHESION } from './shape.js';
export {
  attachInventory, attachTreasury, createGroup, linkCharacter, setAllegiance, setCohesion, setCommanders, setMemberQuantity,
  splitGroup, unlinkCharacter, updateGroup,
  getCommandStructureDefinition, getGroup, getGroupOfCharacter, getGroupTypeDefinition, listGroups,
} from './rules.js';
export { checkGroups } from './checks.js';

registerAreaCheck('groups', checkGroups);
