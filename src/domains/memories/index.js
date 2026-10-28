// Character memories. Other areas import only from here.
import { registerAreaCheck } from '../../persist/schema.js';
import { checkMemories } from './checks.js';

export {
  DEFAULT_DECAY_POLICY_IDS,
  DEFAULT_MEMORY_TYPE_IDS,
  MEMORY_KNOWLEDGE,
  MEMORY_STATUSES,
  MEMORY_TERMINAL_STATUSES,
  createMemory,
  getMemory,
  isKnownDecayPolicy,
  isKnownMemoryType,
  isStoredId,
  listMemoriesForOwner,
  memoryId,
  resolveMemory,
} from './rules.js';
export { checkMemories } from './checks.js';

registerAreaCheck('memories', checkMemories);
