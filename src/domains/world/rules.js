// World-map actions on a draft (see docs/REWRITE.md). Each validates all of its input before
// touching the draft and returns ok({...}) or fail('world_...'); a failure discards the whole
// transaction, so no undo code is needed.
//
// They change one thing in a group record: worldPosition and movement, plus the group's revision.
// context.world may supply another world (tests do); the default is the real map.
import { canonicalJson, clone, isRecord } from '../../core/data.js';
import { isId } from '../../core/ids.js';
import { fail, ok } from '../../core/result.js';
import { isStoredRoute, planRoute, storedRoute } from './routes.js';
import { stepMovement } from './movement.js';
import { defaultWorld } from './world.js';

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const MOVEMENT_KEYS = ['baseSpeed', 'currentSpeed', 'targetNode', 'targetX', 'targetY', 'route'];

function findGroup(draft, groupId) {
  const group = isId(groupId) ? draft.world?.mobileGroups?.[groupId] : undefined;
  if (!isRecord(group)) return fail('world_unknown_group', { groupId });
  if (!isRecord(group.movement) || !isRecord(group.worldPosition)) return fail('world_invalid_group', { groupId });
  return ok({ group });
}

// Group records carry a revision that goes up with every change to them.
const bumpRevision = (group) => { group.revision = Number.isInteger(group.revision) ? group.revision + 1 : 1; };

const insideMap = (world, x, y) => isNumber(x) && isNumber(y) && x >= 0 && y >= 0 && x <= world.map.width && y <= world.map.height;

function movementIssue(world, group, movement) {
  if (!isRecord(movement)) return 'movement';
  for (const key of Object.keys(movement)) {
    if (MOVEMENT_KEYS.includes(key)) continue;
    // A field this area does not know may stay as it is, but not change.
    if (!(key in group.movement) || canonicalJson(group.movement[key]) !== canonicalJson(movement[key])) return key;
  }
  if (!isNumber(movement.baseSpeed) || movement.baseSpeed < 0) return 'baseSpeed';
  if (!isNumber(movement.currentSpeed) || movement.currentSpeed < 0) return 'currentSpeed';
  if (!insideMap(world, movement.targetX, movement.targetY)) return 'target';
  if (movement.targetNode !== null && !(typeof movement.targetNode === 'string' && world.nodeById.has(movement.targetNode))) return 'targetNode';
  if ('route' in movement && !(isStoredRoute(movement.route) && world.nodeById.has(movement.route.destinationId))) return 'route';
  return null;
}

// Stores the result of one movement step. The patch is what stepMovement returned:
// { worldPosition: {x, y}, movement: {...} }. A movement without `route` ends the group's route.
export function moveGroup(draft, { groupId, patch } = {}, context = {}) {
  const world = context.world ?? defaultWorld;
  const found = findGroup(draft, groupId);
  if (!found.ok) return found;
  const { group } = found;
  if (!isRecord(patch) || !isRecord(patch.worldPosition) || !insideMap(world, patch.worldPosition.x, patch.worldPosition.y)) return fail('world_invalid_patch', { field: 'worldPosition' });
  const issue = movementIssue(world, group, patch.movement);
  if (issue) return fail('world_invalid_patch', { field: `movement.${issue}` });
  const next = clone(patch.movement);
  group.worldPosition = { x: patch.worldPosition.x, y: patch.worldPosition.y };
  group.movement = next;
  bumpRevision(group);
  return ok({ groupId });
}

// A manual order. Either { groupId, nodeId } (go to a settlement, along roads if there is a road
// route, otherwise straight) or { groupId, x, y } (go to a point; points outside the map are pulled
// onto its edge). Any order replaces what the group was doing, including a route.
export function orderGroupTo(draft, input = {}, context = {}) {
  const world = context.world ?? defaultWorld;
  const { groupId, nodeId, x, y } = input;
  const found = findGroup(draft, groupId);
  if (!found.ok) return found;
  const { group } = found;
  const toNode = nodeId !== undefined;
  const toPoint = x !== undefined || y !== undefined;
  if (toNode === toPoint) return fail('world_invalid_order', { reason: 'give either nodeId or x and y' });
  if (toNode && !world.nodeById.has(nodeId)) return fail('world_unknown_node', { nodeId });
  if (toPoint && !(isNumber(x) && isNumber(y))) return fail('world_invalid_target', { x, y });

  const movement = { ...group.movement };
  delete movement.route;
  let result;
  if (toNode) {
    const node = world.nodeById.get(nodeId);
    const plan = planRoute(world, group.worldPosition, nodeId);
    movement.targetNode = nodeId;
    if (plan.ok) {
      const route = storedRoute(plan);
      movement.route = route;
      movement.targetX = route.waypoints[0].x;
      movement.targetY = route.waypoints[0].y;
      result = { mode: 'road' };
    } else {
      // No usable road route: walk straight to the settlement, as the earlier version did.
      movement.targetX = node.x;
      movement.targetY = node.y;
      result = { mode: 'direct', routeFailure: plan.error };
    }
  } else {
    movement.targetNode = null;
    movement.targetX = Math.max(0, Math.min(world.map.width, x));
    movement.targetY = Math.max(0, Math.min(world.map.height, y));
    result = { mode: 'ground' };
  }
  group.movement = movement;
  bumpRevision(group);
  return ok({ groupId, ...result });
}

// Stops where the group stands.
export function stopGroup(draft, { groupId } = {}) {
  const found = findGroup(draft, groupId);
  if (!found.ok) return found;
  const { group } = found;
  const movement = { ...group.movement };
  delete movement.route;
  movement.targetNode = null;
  movement.targetX = group.worldPosition.x;
  movement.targetY = group.worldPosition.y;
  movement.currentSpeed = movement.baseSpeed;
  group.movement = movement;
  bumpRevision(group);
  return ok({ groupId });
}

// Ends the automatic route of this group only: it finishes the leg it is on and then stays.
export function cancelRoute(draft, { groupId } = {}) {
  const found = findGroup(draft, groupId);
  if (!found.ok) return found;
  const { group } = found;
  if (!('route' in group.movement)) return ok({ groupId, cancelled: false });
  const movement = { ...group.movement };
  delete movement.route;
  movement.targetNode = null;
  group.movement = movement;
  bumpRevision(group);
  return ok({ groupId, cancelled: true });
}

// One frame for one group: step, then store the step. Returns the event (arrival, blocked) if any.
export function advanceGroup(draft, { groupId, dtSeconds } = {}, context = {}) {
  const world = context.world ?? defaultWorld;
  const found = findGroup(draft, groupId);
  if (!found.ok) return found;
  const step = stepMovement(found.group, dtSeconds, world);
  if (!step.ok) return step;
  if (!step.patch) return ok({ groupId, changed: false, event: null });
  const stored = moveGroup(draft, { groupId, patch: step.patch }, context);
  if (!stored.ok) return stored;
  return ok({ groupId, changed: true, event: step.event });
}
