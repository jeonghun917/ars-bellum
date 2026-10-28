// Record checks for what the world area keeps in the game state: where every mobile group stands
// and where it is going. (The map itself is static data and is checked when the world is built.)
import { isRecord } from '../../core/data.js';
import { fail, ok } from '../../core/result.js';
import { targetNodeId } from './movement.js';
import { isStoredRoute } from './routes.js';
import { defaultWorld } from './world.js';

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const insideMap = (world, x, y) => isNumber(x) && isNumber(y) && x >= 0 && y >= 0 && x <= world.map.width && y <= world.map.height;

function groupIssue(world, group) {
  if (!isRecord(group) || !isRecord(group.worldPosition) || !isRecord(group.movement)) return 'invalid_group';
  const { worldPosition: at, movement } = group;
  if (!insideMap(world, at.x, at.y)) return 'invalid_position';
  if (!isNumber(movement.baseSpeed) || movement.baseSpeed < 0 || !isNumber(movement.currentSpeed) || movement.currentSpeed < 0) return 'invalid_speed';
  if (!insideMap(world, movement.targetX, movement.targetY)) return 'invalid_target';
  // targetNode is a node id; saves of the earlier version hold the whole node object, which is
  // accepted as long as its id names a node (the next movement step rewrites it as the id).
  const nodeId = movement.targetNode === null ? null : targetNodeId(movement.targetNode);
  if (movement.targetNode !== null && (nodeId === null || !world.nodeById.has(nodeId))) return 'unknown_target_node';
  if ('route' in movement) {
    if (!isStoredRoute(movement.route) || !movement.route.waypoints.every((p) => insideMap(world, p.x, p.y))) return 'invalid_route';
    if (movement.route.destinationId !== nodeId) return 'route_destination_mismatch';
  }
  return null;
}

export function checkWorld(state, world = defaultWorld) {
  const groups = state.world.mobileGroups;
  for (const id of Object.keys(groups)) {
    const issue = groupIssue(world, groups[id]);
    if (issue) return fail(`world_${issue}`, { groupId: id });
  }
  return ok();
}
