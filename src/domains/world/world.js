// A world is the static map data checked once and indexed for fast lookups: nodes, roads, terrain
// zones, each road's polyline and the road graph. It holds no game state (groups and their
// positions live in the store) so it may be shared and is frozen.
import { isId } from '../../core/ids.js';
import { MAP, REGIONS } from './data/map.js';
import { NODES } from './data/nodes.js';
import { ROADS } from './data/roads.js';
import { ZONES } from './data/zones.js';
import { BASE_TYPES, FEATURE_TYPES, ROUTE_TYPES } from './data/terrain-types.js';
import { ROAD_HALF_WIDTH } from './constants.js';
import { buildRoadPolyline, polylineLength } from './geometry.js';

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function shapeIssue(shape) {
  if (!shape || typeof shape !== 'object') return 'shape_missing';
  if (shape.type === 'rect') {
    return [shape.x, shape.y].every(isNumber) && isNumber(shape.width) && isNumber(shape.height) && shape.width > 0 && shape.height > 0 ? null : 'shape_invalid';
  }
  if (shape.type === 'circle') {
    return [shape.x, shape.y].every(isNumber) && isNumber(shape.radius) && shape.radius > 0 ? null : 'shape_invalid';
  }
  return 'shape_invalid';
}

// Lists everything wrong with a set of map data, as short codes with the id they concern.
export function validateWorldData({ map = MAP, regions = REGIONS, nodes = NODES, roads = ROADS, zones = ZONES } = {}) {
  const issues = [];
  const regionIds = new Set(regions.map((region) => region.id));
  const nodeIds = new Set();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (!isId(node.id)) issues.push(`node_bad_id:${node.id}`);
    else if (nodeIds.has(node.id)) issues.push(`node_duplicate:${node.id}`);
    nodeIds.add(node.id);
    if (!isNumber(node.x) || !isNumber(node.y) || node.x < 0 || node.y < 0 || node.x > map.width || node.y > map.height) issues.push(`node_outside_map:${node.id}`);
    if (!regionIds.has(node.regionId)) issues.push(`node_unknown_region:${node.id}`);
  }
  const roadIds = new Set();
  for (const road of roads) {
    if (!isId(road.id)) issues.push(`road_bad_id:${road.id}`);
    else if (roadIds.has(road.id)) issues.push(`road_duplicate:${road.id}`);
    roadIds.add(road.id);
    if (!nodeIds.has(road.fromSettlementId)) issues.push(`road_missing_start:${road.id}`);
    if (!nodeIds.has(road.toSettlementId)) issues.push(`road_missing_end:${road.id}`);
    if (road.fromSettlementId === road.toSettlementId) issues.push(`road_loop:${road.id}`);
    // Route planning relies on every road costing something, so that cheapest ways in are found in order.
    const measurable = nodeIds.has(road.fromSettlementId) && nodeIds.has(road.toSettlementId) && Array.isArray(road.waypoints);
    if (measurable && road.fromSettlementId !== road.toSettlementId && polylineLength(buildRoadPolyline(road, byId)) === 0) issues.push(`road_zero_length:${road.id}`);
    if (!Array.isArray(road.waypoints) || road.waypoints.some((p) => !isNumber(p?.x) || !isNumber(p?.y))) issues.push(`road_bad_waypoint:${road.id}`);
  }
  const zoneIds = new Set();
  for (const zone of zones) {
    if (!isId(zone.id)) issues.push(`zone_bad_id:${zone.id}`);
    else if (zoneIds.has(zone.id)) issues.push(`zone_duplicate:${zone.id}`);
    zoneIds.add(zone.id);
    const problem = shapeIssue(zone.shape);
    if (problem) issues.push(`zone_${problem}:${zone.id}`);
    if (zone.baseId && !BASE_TYPES[zone.baseId]) issues.push(`zone_unknown_base:${zone.id}`);
    if (zone.routeId && !ROUTE_TYPES[zone.routeId]) issues.push(`zone_unknown_route:${zone.id}`);
    if ((zone.featureIds ?? []).some((id) => !FEATURE_TYPES[id])) issues.push(`zone_unknown_feature:${zone.id}`);
    if (!zone.baseId && !zone.routeId && !(zone.featureIds ?? []).length) issues.push(`zone_empty:${zone.id}`);
  }
  return issues;
}

// Throws on bad data: the map data is part of the program, not user input.
export function createWorld({ map = MAP, regions = REGIONS, nodes = NODES, roads = ROADS, zones = ZONES, roadHalfWidth = ROAD_HALF_WIDTH } = {}) {
  const issues = validateWorldData({ map, regions, nodes, roads, zones });
  if (issues.length) throw new Error(`invalid world data: ${issues.join(', ')}`);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const roadById = new Map(roads.map((road) => [road.id, road]));
  const polylines = new Map();
  const edges = new Map(nodes.map((node) => [node.id, []]));
  for (const road of roads) {
    const points = buildRoadPolyline(road, nodeById);
    polylines.set(road.id, points);
    if (road.enabled === false) continue;
    // A faster road is "shorter": cost is time-like length, so a long fast road can beat a short slow one.
    const cost = polylineLength(points) / Math.max(0.1, Number(road.movementMultiplier) || 1);
    edges.get(road.fromSettlementId).push({ to: road.toSettlementId, roadId: road.id, cost });
    edges.get(road.toSettlementId).push({ to: road.fromSettlementId, roadId: road.id, cost });
  }
  // Zones sorted once: ascending priority, list order for equal priority (Array.sort is stable).
  const orderedZones = zones.filter((zone) => zone.enabled !== false).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  return Object.freeze({
    map, regions, nodes, roads, zones: Object.freeze(orderedZones), roadHalfWidth, nodeById, roadById, polylines, edges,
  });
}

export const defaultWorld = createWorld();
export const isNodeId = (world, id) => typeof id === 'string' && world.nodeById.has(id);
