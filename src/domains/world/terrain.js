// What the ground is at a map point, and what travelling over it costs.
//
// A cell is { baseId, routeId, featureIds }: the base terrain (plain unless a zone says otherwise),
// a route over it (a road if the point lies on a road, or a zone's route) and features. The travel
// profile folds base x route x feature into passability and multipliers, using the catalog in
// data/terrain-types.js. Points outside the map are sea.
import { BASE_TYPES, FEATURE_TYPES, ROAD_TYPE_TO_ROUTE, ROUTE_TYPES } from './data/terrain-types.js';
import { distanceToPolyline } from './geometry.js';

export { buildRoadPolyline, distanceToPolyline, distanceToSegment, polylineLength } from './geometry.js';

const own = (table, key) => (typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : null);

function insideShape(shape, x, y) {
  if (shape.type === 'rect') return x >= shape.x && y >= shape.y && x <= shape.x + shape.width && y <= shape.y + shape.height;
  const dx = x - shape.x;
  const dy = y - shape.y;
  return dx * dx + dy * dy <= shape.radius * shape.radius;
}

export function isInsideMap(world, x, y) {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= world.map.width && y <= world.map.height;
}

// The nearest enabled road whose centre line is within the road half-width of the point.
// The first road in the data wins a tie, so the answer never depends on anything but the data.
export function roadAt(world, x, y) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const road of world.roads) {
    if (road.enabled === false) continue;
    const distance = distanceToPolyline(x, y, world.polylines.get(road.id));
    if (distance <= world.roadHalfWidth && distance < nearestDistance) {
      nearest = road;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function cellAt(world, x, y) {
  if (!isInsideMap(world, x, y)) return { baseId: 'sea', routeId: null, featureIds: [], roadId: null, zoneIds: [], outsideMap: true };
  let baseId = 'plain';
  let routeId = null;
  const featureIds = [];
  const zoneIds = [];
  for (const zone of world.zones) {
    if (!insideShape(zone.shape, x, y)) continue;
    zoneIds.push(zone.id);
    if (zone.baseId) baseId = zone.baseId;
    if (zone.routeId) routeId = zone.routeId;
    for (const featureId of zone.featureIds ?? []) if (!featureIds.includes(featureId)) featureIds.push(featureId);
  }
  const road = roadAt(world, x, y);
  // A zone's own route (a bridge) outranks the route of a road passing through it.
  if (!routeId && road) routeId = own(ROAD_TYPE_TO_ROUTE, road.type) ?? 'road';
  return { baseId, routeId, featureIds, roadId: road ? road.id : null, zoneIds, outsideMap: false };
}

const allowed = (definition, baseId) => definition.allowedBaseIds.includes(baseId);

// Unknown base ids count as plain, unknown routes and features are ignored (as before).
export function travelProfile(cell) {
  const base = own(BASE_TYPES, cell?.baseId) ?? BASE_TYPES.plain;
  const route = own(ROUTE_TYPES, cell?.routeId);
  const featureIds = Array.isArray(cell?.featureIds) ? cell.featureIds.filter((id) => own(FEATURE_TYPES, id)) : [];
  const profile = {
    baseId: base.id,
    baseName: base.name,
    routeId: null,
    routeName: null,
    featureIds: [],
    featureNames: [],
    passable: base.passable,
    speedMult: base.speedMult,
    foodMult: base.foodMult,
    visibilityMult: base.visibilityMult,
    ambushRisk: base.ambushRisk,
    canCamp: base.canCamp,
    restBonus: 1,
    battleTags: [...base.battleTags],
    warnings: [],
  };
  if (route) {
    if (allowed(route, base.id)) {
      profile.routeId = route.id;
      profile.routeName = route.name;
      const wasPassable = profile.passable;
      if (route.passableOverride !== null) profile.passable = route.passableOverride;
      // Mountain and river have speed 0; a pass or bridge makes them passable, so the route's own
      // multiplier must apply to a full speed of 1 instead of to 0.
      if (!wasPassable && profile.passable && profile.speedMult <= 0) profile.speedMult = 1;
      profile.speedMult *= route.speedMult;
      profile.foodMult *= route.foodMult;
      profile.visibilityMult *= route.visibilityMult;
      profile.ambushRisk += route.ambushRiskAdd;
      profile.battleTags.push(...route.battleTags);
    } else {
      profile.warnings.push(`${route.name}은(는) ${base.name}에 놓을 수 없습니다.`);
    }
  }
  for (const featureId of featureIds) {
    const feature = FEATURE_TYPES[featureId];
    if (!allowed(feature, base.id)) {
      profile.warnings.push(`${feature.name}은(는) ${base.name}에 놓을 수 없습니다.`);
      continue;
    }
    profile.featureIds.push(feature.id);
    profile.featureNames.push(feature.name);
    profile.speedMult *= feature.speedMult;
    profile.foodMult *= feature.foodMult;
    profile.visibilityMult *= feature.visibilityMult;
    profile.ambushRisk += feature.ambushRiskAdd;
    if (typeof feature.canCampOverride === 'boolean') profile.canCamp = feature.canCampOverride;
    profile.restBonus *= feature.restBonus;
    profile.battleTags.push(...feature.battleTags);
  }
  profile.ambushRisk = Math.max(0, Math.min(1, profile.ambushRisk));
  profile.battleTags = [...new Set(profile.battleTags)];
  if (!profile.passable) profile.speedMult = 0;
  return profile;
}

export function profileAt(world, x, y) {
  return travelProfile(cellAt(world, x, y));
}

// Pixels per second for a group of the given base speed on ground with this profile.
export function partySpeed(baseSpeed, profile) {
  if (!Number.isFinite(baseSpeed) || baseSpeed < 0) return 0;
  return profile.passable ? baseSpeed * profile.speedMult : 0;
}
