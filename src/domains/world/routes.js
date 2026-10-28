// Route planning: the cheapest way along roads from where a group stands to a settlement.
//
// planRoute is pure and deterministic: the same world and inputs always give the same route, and
// reordering the nodes or roads in the data does not change it. Equal-cost paths are settled by
// node id and then road id, never by the order things happen to be listed in.
import { fail, ok } from '../../core/result.js';
import { COST_EPSILON, MAX_DETOUR_RATIO, ROUTE_START_SEARCH, WAYPOINT_REACH } from './constants.js';

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

// The closest settlement that has at least one road, within `searchDistance`; ties go to the lower id.
function nearestRoadNode(world, x, y, searchDistance) {
  let best = null;
  let bestDistance = Infinity;
  for (const node of world.nodes) {
    if (world.edges.get(node.id).length === 0) continue;
    const d = Math.hypot(node.x - x, node.y - y);
    if (d < bestDistance || (d === bestDistance && best && node.id < best.id)) {
      best = node;
      bestDistance = d;
    }
  }
  return best && bestDistance <= searchDistance ? best : null;
}

// Dijkstra over the road graph. Returns { nodeIds, roadIds } or null if the end cannot be reached.
// Ties: every road costs more than zero, so all cheapest ways into a settlement come from settlements
// that are finished earlier. Among those, the lowest settlement id wins, then the lowest road id. That
// makes the answer the same whatever order the data lists its nodes and roads in.
export function shortestPath(world, startId, endId) {
  if (!world.edges.has(startId) || !world.edges.has(endId)) return null;
  if (startId === endId) return { nodeIds: [startId], roadIds: [] };
  const cost = new Map([...world.edges.keys()].map((id) => [id, Infinity]));
  const previous = new Map();
  const open = new Set(world.edges.keys());
  cost.set(startId, 0);
  while (open.size > 0) {
    let current = null;
    for (const id of open) {
      if (current === null || cost.get(id) < cost.get(current)) current = id;
    }
    if (cost.get(current) === Infinity) break;
    open.delete(current);
    if (current === endId) break;
    for (const edge of world.edges.get(current)) {
      if (!open.has(edge.to)) continue;
      const next = cost.get(current) + edge.cost;
      const known = cost.get(edge.to);
      const via = previous.get(edge.to);
      const cheaper = next < known - COST_EPSILON;
      const tie = Math.abs(next - known) <= COST_EPSILON && via
        && (current < via.from || (current === via.from && edge.roadId < via.roadId));
      if (cheaper || tie) {
        cost.set(edge.to, Math.min(known, next));
        previous.set(edge.to, { from: current, roadId: edge.roadId });
      }
    }
  }
  if (!previous.has(endId)) return null;
  const nodeIds = [endId];
  const roadIds = [];
  for (let at = endId; at !== startId;) {
    const step = previous.get(at);
    nodeIds.unshift(step.from);
    roadIds.unshift(step.roadId);
    at = step.from;
  }
  return { nodeIds, roadIds };
}

// Adds a waypoint unless it is on top of the previous one, in which case the two are merged.
function pushWaypoint(list, point) {
  const last = list[list.length - 1];
  if (last && distance(last, point) < 0.5) {
    last.nodeId = point.nodeId ?? last.nodeId;
    last.final = Boolean(last.final || point.final);
    return;
  }
  list.push({ x: point.x, y: point.y, roadId: point.roadId ?? null, nodeId: point.nodeId ?? null, final: Boolean(point.final) });
}

// Plans from the point `from` ({x, y}) to settlement `destinationId`. On success:
// { destinationId, waypoints: [{x, y, roadId, nodeId, final}], roadIds, nodeIds, routeLength, directLength, detourRatio }.
// Failures say why no road route exists; the caller decides whether to walk straight instead.
export function planRoute(world, from, destinationId, options = {}) {
  const startSearch = options.startSearchDistance ?? ROUTE_START_SEARCH;
  const reach = options.reachDistance ?? WAYPOINT_REACH;
  const maxDetour = options.maxDetourRatio ?? MAX_DETOUR_RATIO;
  if (!from || !isNumber(from.x) || !isNumber(from.y)) return fail('world_invalid_position');
  const destination = world.nodeById.get(destinationId);
  if (!destination) return fail('world_unknown_node', { nodeId: destinationId });
  const start = nearestRoadNode(world, from.x, from.y, startSearch);
  if (!start) return fail('world_no_start_road', { x: from.x, y: from.y });
  const path = shortestPath(world, start.id, destination.id);
  if (!path) return fail('world_unreachable', { fromNodeId: start.id, toNodeId: destination.id });

  const waypoints = [];
  if (distance(from, start) > reach) pushWaypoint(waypoints, { x: start.x, y: start.y, nodeId: start.id });
  path.roadIds.forEach((roadId, index) => {
    const road = world.roadById.get(roadId);
    const points = world.polylines.get(roadId);
    const forward = road.fromSettlementId === path.nodeIds[index];
    const ordered = forward ? points : [...points].reverse();
    ordered.forEach((point, i) => {
      const nodeId = i === 0 ? path.nodeIds[index] : i === ordered.length - 1 ? path.nodeIds[index + 1] : null;
      pushWaypoint(waypoints, { x: point.x, y: point.y, roadId, nodeId });
    });
  });
  if (waypoints.length === 0) pushWaypoint(waypoints, { x: destination.x, y: destination.y });
  const last = waypoints[waypoints.length - 1];
  last.x = destination.x;
  last.y = destination.y;
  last.nodeId = destination.id;
  last.final = true;

  let routeLength = 0;
  let previous = from;
  for (const point of waypoints) {
    routeLength += distance(previous, point);
    previous = point;
  }
  const directLength = distance(from, destination);
  const detourRatio = directLength > 0 ? routeLength / directLength : 1;
  if (detourRatio > maxDetour) return fail('world_detour_too_long', { detourRatio });
  return ok({ destinationId: destination.id, waypoints, roadIds: path.roadIds, nodeIds: path.nodeIds, routeLength, directLength, detourRatio });
}

// The part of a plan that is kept in the group record: where to go next and where it ends.
export function storedRoute(plan) {
  return { destinationId: plan.destinationId, index: 0, waypoints: plan.waypoints.map((w) => ({ x: w.x, y: w.y })) };
}

const isPoint = (p) => p !== null && typeof p === 'object' && isNumber(p.x) && isNumber(p.y);

// Shape of movement.route: { destinationId, index, waypoints: [{x, y}, ...] }, index inside waypoints.
export function isStoredRoute(route) {
  return route !== null && typeof route === 'object' && !Array.isArray(route)
    && typeof route.destinationId === 'string'
    && Array.isArray(route.waypoints) && route.waypoints.length > 0 && route.waypoints.every(isPoint)
    && Number.isInteger(route.index) && route.index >= 0 && route.index < route.waypoints.length;
}
