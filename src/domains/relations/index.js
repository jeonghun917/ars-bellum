// Relationships between characters. Other areas import only from here.
import { registerAreaCheck } from '../../persist/schema.js';
import { checkRelations } from './checks.js';

export {
  RELATION_VALUE_KEYS,
  RELATION_VALUE_MAX,
  RELATION_VALUE_MIN,
  applyRelationshipDelta,
  getRelationship,
  isStoredId,
  listRelationshipsFrom,
  listRelationshipsTo,
  relationEffectKey,
  relationId,
} from './rules.js';
export { checkRelations } from './checks.js';

registerAreaCheck('relations', checkRelations);
