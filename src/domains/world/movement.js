// Moving one group for one frame. stepMovement is pure: it reads the group record and returns what
// the frame changes, and the caller commits that once (rules.moveGroup, inside one transaction).
//
//   stepMovement(group, dtSeconds, world) -> ok({ patch, event })
//     patch: { worldPosition, movement } to store, or null when the frame changes nothing
//     event: null, { type: 'arrived', ... } or { type: 'blocked', ... }
//
// The route (if any) is read from and written to movement.route, so a saved game keeps its route.
// Terrain is sampled along the whole step, so a long step cannot jump over a river, and impassable
// ground stops the group with a 'blocked' event and clears its order. It never leaves a group
// holding a target it can no longer move towards.
import { canonicalJson, isRecord } from '../../core/data.js';
import { fail, ok } from '../../core/result.js';
import { ARRIVE_DISTANCE, MAX_SAMPLES_PER_STEP, SAMPLE_DISTANCE, WAYPOINT_REACH } from './constants.js';
import { isStoredRoute } from './routes.js';
import { partySpeed, profileAt } from './terrain.js';
import { defaultWorld } from './world.js';

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// movement.targetNode is a node id. Saves of the earlier version stored the whole node object
// ({ id, name, x, y, ... }); those are accepted here and read as their id.
export function targetNodeId(value) {
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value.id === 'string') return value.id;
  return null;
}

export function stepMovement(group, dtSeconds, world = defaultWorld) {
  if (!isRecord(group) || !isRecord(group.worldPosition) || !isRecord(group.movement)) return fail('world_invalid_group');
  const mv = group.movement;
  if (!isNumber(group.worldPosition.x) || !isNumber(group.worldPosition.y) || !isNumber(mv.baseSpeed) || mv.baseSpeed < 0) return fail('world_invalid_group');
  if (!isNumber(dtSeconds) || dtSeconds < 0) return fail('world_invalid_step', { dtSeconds });
  const { width, height } = world.map;
  const base = mv.baseSpeed;
  let x = clamp(group.worldPosition.x, 0, width);
  let y = clamp(group.worldPosition.y, 0, height);
  const targetX = clamp(isNumber(mv.targetX) ? mv.targetX : x, 0, width);
  const targetY = clamp(isNumber(mv.targetY) ? mv.targetY : y, 0, height);
  let nodeId = targetNodeId(mv.targetNode);
  if (nodeId !== null && !world.nodeById.has(nodeId)) nodeId = null;

  // A route stays in force only while the group is still heading for its current bend and for the
  // route's destination. If anything else rewrote the target, that is a manual order: drop the route.
  let waypoints = null;
  let index = 0;
  if (isStoredRoute(mv.route)) {
    const here = mv.route.waypoints[mv.route.index];
    if (Math.abs(here.x - targetX) <= 0.5 && Math.abs(here.y - targetY) <= 0.5 && mv.route.destinationId === nodeId) {
      waypoints = mv.route.waypoints;
      index = mv.route.index;
    }
  }
  const hadRoute = waypoints !== null;
  const currentTarget = () => (waypoints ? waypoints[index] : { x: targetX, y: targetY });

  let remaining = dtSeconds;
  let moved = false;
  let speedUsed = null;
  let arrived = false;
  let blockedBy = null;
  for (let samples = 0; samples < MAX_SAMPLES_PER_STEP;) {
    const target = currentTarget();
    const dx = target.x - x;
    const dy = target.y - y;
    const distance = Math.hypot(dx, dy);
    const isFinal = !waypoints || index === waypoints.length - 1;
    if (!isFinal && distance <= WAYPOINT_REACH) {
      index += 1;
      continue;
    }
    if (isFinal && distance <= ARRIVE_DISTANCE) {
      x = target.x;
      y = target.y;
      arrived = true;
      break;
    }
    if (remaining <= 0) break;
    samples += 1;
    const length = Math.min(distance, SAMPLE_DISTANCE);
    const nextX = length === distance ? target.x : x + (dx / distance) * length;
    const nextY = length === distance ? target.y : y + (dy / distance) * length;
    const profile = profileAt(world, nextX, nextY);
    if (!profile.passable) {
      blockedBy = profile;
      break;
    }
    const speed = partySpeed(base, profile);
    if (speed <= 0) break;
    speedUsed = speed;
    moved = true;
    const needed = length / speed;
    if (needed <= remaining) {
      x = nextX;
      y = nextY;
      remaining -= needed;
    } else {
      const fraction = (remaining * speed) / distance;
      x += dx * fraction;
      y += dy * fraction;
      remaining = 0;
    }
  }

  const movement = { ...mv };
  delete movement.route;
  let event = null;
  if (blockedBy || arrived) {
    const goal = waypoints ? waypoints[waypoints.length - 1] : { x: targetX, y: targetY };
    movement.targetNode = null;
    movement.targetX = x;
    movement.targetY = y;
    movement.currentSpeed = base;
    if (blockedBy) {
      event = {
        type: 'blocked', groupId: group.id ?? null, x, y, reason: 'impassable_terrain',
        terrainId: blockedBy.baseId, terrainName: blockedBy.baseName, nodeId, target: { x: goal.x, y: goal.y },
      };
    } else if (moved || nodeId !== null || hadRoute) {
      event = { type: 'arrived', groupId: group.id ?? null, nodeId, x, y };
    }
  } else {
    const target = currentTarget();
    movement.targetNode = nodeId;
    movement.targetX = target.x;
    movement.targetY = target.y;
    movement.currentSpeed = speedUsed ?? partySpeed(base, profileAt(world, x, y));
    if (waypoints) movement.route = { destinationId: mv.route.destinationId, index, waypoints: mv.route.waypoints };
  }
  const patch = { worldPosition: { x, y }, movement };
  const unchanged = canonicalJson(patch) === canonicalJson({ worldPosition: group.worldPosition, movement: mv });
  return ok({ patch: unchanged ? null : patch, event });
}
