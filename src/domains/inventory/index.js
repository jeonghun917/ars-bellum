// Inventories: bulk goods, equipment and cargo with a capacity. Other areas import from here only.
import { registerAreaCheck } from '../../persist/schema.js';
import { checkInventory } from './checks.js';

export {
  RESOURCE_CATEGORIES, checkInventory, inventoryProblems, getResource, hasEquipmentSlot, hasCargoPurpose,
} from './checks.js';
export {
  calculateLoad, getFoodSummary,
  createInventory, changeInventoryOwner, setCapacity,
  addBulk, removeBulk,
  addEquipment, removeEquipment, setEquipmentSlot,
  addCargo, removeCargo, applyLoss,
  transferItems,
} from './rules.js';

registerAreaCheck('inventory', checkInventory);
