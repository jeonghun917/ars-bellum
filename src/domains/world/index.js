// World map: static map data, terrain, roads, route planning and group movement.
// Other areas import only from here.
import { registerAreaCheck } from '../../persist/schema.js';
import { checkWorld } from './checks.js';

export { MAP, REGIONS } from './data/map.js';
export { NODES } from './data/nodes.js';
export { ROADS } from './data/roads.js';
export { TEST_ZONES, ZONES } from './data/zones.js';
export { BASE_TYPES, FEATURE_TYPES, ROUTE_TYPES } from './data/terrain-types.js';
export { createWorld, defaultWorld, validateWorldData } from './world.js';
export { cellAt, isInsideMap, partySpeed, profileAt, roadAt, travelProfile } from './terrain.js';
export { planRoute, shortestPath } from './routes.js';
export { stepMovement, targetNodeId } from './movement.js';
export { advanceGroup, cancelRoute, moveGroup, orderGroupTo, stopGroup } from './rules.js';
export { checkWorld } from './checks.js';

registerAreaCheck('world', checkWorld);
