import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_TYPES, ROUTE_TYPES, FEATURE_TYPES, MAP, NODES, ROADS, TEST_ZONES, ZONES, REGIONS,
  cellAt, createWorld, defaultWorld, partySpeed, planRoute, profileAt, roadAt, travelProfile, validateWorldData,
} from '../../src/domains/world/index.js';

// Expected travel profiles, taken from the earlier version's W_TerrainTypes.js (getTravelProfile).
// Row: base, route, features, passable, speedMult, foodMult, visibilityMult, ambushRisk, canCamp,
// restBonus, profile.routeId, profile.featureIds, number of warnings.
const OLD_PROFILES = [
  ["plain", null, [], true, 1, 1, 1, 0.05, true, 1, null, [], 0],
  ["plain", null, ["oasis"], true, 1, 1, 1, 0.05, true, 1, null, [], 1],
  ["plain", "road", [], true, 1.28, 0.88, 1.1, 0, true, 1, "road", [], 0],
  ["plain", "mountain_pass", [], true, 1, 1, 1, 0.05, true, 1, null, [], 1],
  ["plain", "bridge", [], true, 1, 1, 1, 0.05, true, 1, null, [], 1],
  ["forest", null, [], true, 0.65, 1.15, 0.6, 0.35, true, 1, null, [], 0],
  ["forest", null, ["oasis"], true, 0.65, 1.15, 0.6, 0.35, true, 1, null, [], 1],
  ["forest", "road", [], true, 0.8320000000000001, 1.012, 0.66, 0.3, true, 1, "road", [], 0],
  ["forest", "mountain_pass", [], true, 0.65, 1.15, 0.6, 0.35, true, 1, null, [], 1],
  ["forest", "bridge", [], true, 0.65, 1.15, 0.6, 0.35, true, 1, null, [], 1],
  ["hill", null, [], true, 0.8, 1.1, 1.2, 0.15, true, 1, null, [], 0],
  ["hill", null, ["oasis"], true, 0.8, 1.1, 1.2, 0.15, true, 1, null, [], 1],
  ["hill", "road", [], true, 1.024, 0.9680000000000001, 1.32, 0.09999999999999999, true, 1, "road", [], 0],
  ["hill", "mountain_pass", [], true, 0.576, 1.32, 1.08, 0.27, true, 1, "mountain_pass", [], 0],
  ["hill", "bridge", [], true, 0.8, 1.1, 1.2, 0.15, true, 1, null, [], 1],
  ["highland", null, [], true, 0.7, 1.2, 1.3, 0.12, true, 1, null, [], 0],
  ["highland", null, ["oasis"], true, 0.7, 1.2, 1.3, 0.12, true, 1, null, [], 1],
  ["highland", "road", [], true, 0.8959999999999999, 1.056, 1.4300000000000002, 0.06999999999999999, true, 1, "road", [], 0],
  ["highland", "mountain_pass", [], true, 0.504, 1.44, 1.1700000000000002, 0.24, true, 1, "mountain_pass", [], 0],
  ["highland", "bridge", [], true, 0.7, 1.2, 1.3, 0.12, true, 1, null, [], 1],
  ["mountain", null, [], false, 0, 1.7, 1.4, 0.2, false, 1, null, [], 0],
  ["mountain", null, ["oasis"], false, 0, 1.7, 1.4, 0.2, false, 1, null, [], 1],
  ["mountain", "road", [], false, 0, 1.7, 1.4, 0.2, false, 1, null, [], 1],
  ["mountain", "mountain_pass", [], true, 0.72, 2.04, 1.26, 0.32, false, 1, "mountain_pass", [], 0],
  ["mountain", "bridge", [], false, 0, 1.7, 1.4, 0.2, false, 1, null, [], 1],
  ["snow", null, [], true, 0.6, 1.45, 1.1, 0.1, true, 1, null, [], 0],
  ["snow", null, ["oasis"], true, 0.6, 1.45, 1.1, 0.1, true, 1, null, [], 1],
  ["snow", "road", [], true, 0.768, 1.276, 1.2100000000000002, 0.05, true, 1, "road", [], 0],
  ["snow", "mountain_pass", [], true, 0.432, 1.74, 0.9900000000000001, 0.22, true, 1, "mountain_pass", [], 0],
  ["snow", "bridge", [], true, 0.6, 1.45, 1.1, 0.1, true, 1, null, [], 1],
  ["desert", null, [], true, 0.72, 1.65, 1.35, 0.08, true, 1, null, [], 0],
  ["desert", null, ["oasis"], true, 0.72, 1.0725, 1.35, 0.05, true, 1.5, null, ["oasis"], 0],
  ["desert", "road", [], true, 0.9216, 1.452, 1.4850000000000003, 0.03, true, 1, "road", [], 0],
  ["desert", "road", ["oasis"], true, 0.9216, 0.9438, 1.4850000000000003, 0, true, 1.5, "road", ["oasis"], 0],
  ["desert", "mountain_pass", [], true, 0.72, 1.65, 1.35, 0.08, true, 1, null, [], 1],
  ["desert", "mountain_pass", ["oasis"], true, 0.72, 1.0725, 1.35, 0.05, true, 1.5, null, ["oasis"], 1],
  ["desert", "bridge", [], true, 0.72, 1.65, 1.35, 0.08, true, 1, null, [], 1],
  ["desert", "bridge", ["oasis"], true, 0.72, 1.0725, 1.35, 0.05, true, 1.5, null, ["oasis"], 1],
  ["marsh", null, [], true, 0.45, 1.3, 0.7, 0.3, false, 1, null, [], 0],
  ["marsh", null, ["oasis"], true, 0.45, 1.3, 0.7, 0.3, false, 1, null, [], 1],
  ["marsh", "road", [], true, 0.5760000000000001, 1.1440000000000001, 0.77, 0.25, false, 1, "road", [], 0],
  ["marsh", "mountain_pass", [], true, 0.45, 1.3, 0.7, 0.3, false, 1, null, [], 1],
  ["marsh", "bridge", [], true, 0.4275, 1.3, 0.7, 0.38, false, 1, "bridge", [], 0],
  ["river", null, [], false, 0, 1.2, 1, 0.12, false, 1, null, [], 0],
  ["river", null, ["oasis"], false, 0, 1.2, 1, 0.12, false, 1, null, [], 1],
  ["river", "road", [], false, 0, 1.2, 1, 0.12, false, 1, null, [], 1],
  ["river", "mountain_pass", [], false, 0, 1.2, 1, 0.12, false, 1, null, [], 1],
  ["river", "bridge", [], true, 0.95, 1.2, 1, 0.2, false, 1, "bridge", [], 0],
  ["sea", null, [], false, 0, 1, 1.5, 0, false, 1, null, [], 0],
  ["sea", null, ["oasis"], false, 0, 1, 1.5, 0, false, 1, null, [], 1],
  ["sea", "road", [], false, 0, 1, 1.5, 0, false, 1, null, [], 1],
  ["sea", "mountain_pass", [], false, 0, 1, 1.5, 0, false, 1, null, [], 1],
  ["sea", "bridge", [], false, 0, 1, 1.5, 0, false, 1, null, [], 1],
];

test('[world.terrain.profile-values-match-old] every base, route and feature combination gives the earlier version\'s travel profile', () => {
  assert.equal(Object.keys(BASE_TYPES).length, 10);
  assert.equal(Object.keys(ROUTE_TYPES).length, 3);
  assert.equal(Object.keys(FEATURE_TYPES).length, 1);
  for (const row of OLD_PROFILES) {
    const [baseId, routeId, featureIds, passable, speedMult, foodMult, visibilityMult, ambushRisk, canCamp, restBonus, usedRoute, usedFeatures, warnings] = row;
    const profile = travelProfile({ baseId, routeId, featureIds });
    const label = JSON.stringify([baseId, routeId, featureIds]);
    assert.deepEqual(
      [profile.passable, profile.speedMult, profile.foodMult, profile.visibilityMult, profile.ambushRisk, profile.canCamp, profile.restBonus, profile.routeId, profile.featureIds, profile.warnings.length],
      [passable, speedMult, foodMult, visibilityMult, ambushRisk, canCamp, restBonus, usedRoute, usedFeatures, warnings],
      label,
    );
  }
  // Unknown ids fall back the way they did before: plain ground, unknown route and feature ignored.
  const fallback = travelProfile({ baseId: 'bogus', routeId: 'bogus', featureIds: ['bogus'] });
  assert.deepEqual([fallback.baseId, fallback.routeId, fallback.featureIds, fallback.speedMult], ['plain', null, [], 1]);
  assert.equal(partySpeed(180, travelProfile({ baseId: 'forest' })), 180 * 0.65);
  assert.equal(partySpeed(180, travelProfile({ baseId: 'river' })), 0);
  assert.equal(partySpeed(-5, travelProfile({ baseId: 'plain' })), 0);
});

const town = (id, x, y) => ({ id, name: id, type: 'village', x, y, regionId: 'central_valley' });

test('[world.terrain.cell-rules] the ground is plain unless a zone or a road says otherwise, and outside the map is sea', () => {
  assert.deepEqual(ZONES, []);
  assert.deepEqual(cellAt(defaultWorld, 1000, 3000), { baseId: 'plain', routeId: null, featureIds: [], roadId: null, zoneIds: [], outsideMap: false });
  for (const [x, y] of [[-1, 10], [10, -1], [MAP.width + 1, 10], [10, MAP.height + 1], [Number.NaN, 5]]) {
    const cell = cellAt(defaultWorld, x, y);
    assert.equal(cell.baseId, 'sea');
    assert.equal(cell.outsideMap, true);
    assert.equal(profileAt(defaultWorld, x, y).passable, false);
  }
  assert.equal(cellAt(defaultWorld, MAP.width, MAP.height).outsideMap, false);

  const world = createWorld({ zones: TEST_ZONES });
  // Circle edge is inside, one pixel further is not; the rectangle edge is inside too.
  assert.equal(cellAt(world, 3000 + 260, 3300).baseId, 'forest');
  assert.equal(cellAt(world, 3000 + 261, 3300).baseId, 'plain');
  assert.equal(cellAt(world, 3400, 2950).baseId, 'mountain');
  assert.equal(cellAt(world, 3399, 2950).baseId, 'plain');
  // River priority 20 beats nothing underneath it; the bridge (priority 30) adds a route over the river.
  assert.equal(cellAt(world, 2600, 3640).baseId, 'river');
  assert.equal(profileAt(world, 2600, 3640).passable, false);
  const bridge = cellAt(world, 2860, 3640);
  assert.deepEqual([bridge.baseId, bridge.routeId, bridge.zoneIds], ['river', 'bridge', ['test_river', 'test_bridge']]);
  assert.equal(profileAt(world, 2860, 3640).passable, true);
  assert.equal(profileAt(world, 2860, 3640).speedMult, 0.95);

  // Higher priority is applied later and wins; equal priority keeps list order.
  const layered = createWorld({
    zones: [
      { id: 'high', priority: 5, baseId: 'marsh', shape: { type: 'rect', x: 0, y: 0, width: 100, height: 100 } },
      { id: 'also_high', priority: 5, baseId: 'snow', shape: { type: 'rect', x: 0, y: 0, width: 100, height: 100 } },
      { id: 'low', priority: 1, baseId: 'hill', shape: { type: 'rect', x: 0, y: 0, width: 100, height: 100 } },
    ],
  });
  assert.equal(cellAt(layered, 50, 50).baseId, 'snow');
  const disabled = createWorld({ zones: [{ id: 'off', enabled: false, baseId: 'sea', shape: { type: 'rect', x: 0, y: 0, width: 100, height: 100 } }] });
  assert.equal(cellAt(disabled, 50, 50).baseId, 'plain');
});

test('[world.terrain.road-geometry] a road is one polyline through its bends, used for both the road cell and the route length', () => {
  const bent = createWorld({
    nodes: [town('a', 100, 100), town('b', 1100, 100)],
    roads: [{ id: 'bent', fromSettlementId: 'a', toSettlementId: 'b', type: 'main_road', enabled: true, movementMultiplier: 1, waypoints: [{ x: 600, y: 900 }] }],
  });
  // On the first leg, at the bend, and on the second leg: road. On the straight chord between the ends: not.
  for (const [x, y] of [[100, 100], [350, 500], [600, 900], [850, 500], [1100, 100]]) {
    assert.equal(cellAt(bent, x, y).routeId, 'road', `${x},${y}`);
    assert.equal(cellAt(bent, x, y).roadId, 'bent');
  }
  assert.equal(cellAt(bent, 600, 100).routeId, null);
  assert.equal(roadAt(bent, 600, 100), null);
  // The half-width is 34: 30 px beside the start of the road is on it, 40 px is not.
  assert.equal(roadAt(bent, 100 - 30, 100)?.id, 'bent');
  assert.equal(roadAt(bent, 100 - 40, 100), null);
  // Routing measures the same line: the route a-b is the two legs through the bend, not the chord.
  const plan = planRoute(bent, { x: 100, y: 100 }, 'b');
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.waypoints.map((w) => [w.x, w.y]), [[100, 100], [600, 900], [1100, 100]]);
  assert.ok(Math.abs(plan.routeLength - 2 * Math.hypot(500, 800)) < 1e-9);
  // A road from the other end uses the same line: the polyline is stored once.
  const reversed = createWorld({
    nodes: [town('a', 100, 100), town('b', 1100, 100)],
    roads: [{ id: 'bent', fromSettlementId: 'b', toSettlementId: 'a', type: 'main_road', enabled: true, movementMultiplier: 1, waypoints: [{ x: 600, y: 900 }] }],
  });
  for (const [x, y] of [[350, 500], [600, 900], [850, 500], [600, 100]]) {
    assert.equal(cellAt(reversed, x, y).routeId, cellAt(bent, x, y).routeId);
  }
  // Walking it from b to a visits the bend between them in the other order.
  const back = planRoute(reversed, { x: 1100, y: 100 }, 'a');
  assert.deepEqual(back.waypoints.map((w) => [w.x, w.y]), [[1100, 100], [600, 900], [100, 100]]);
  assert.deepEqual(planRoute(reversed, { x: 100, y: 100 }, 'b').waypoints.map((w) => [w.x, w.y]), [[100, 100], [600, 900], [1100, 100]]);
  // Roads also decide which route they lay down, and a disabled road lays none.
  const kinds = createWorld({
    nodes: [town('a', 100, 100), town('b', 1100, 100), town('c', 100, 900), town('d', 1100, 900)],
    roads: [
      { id: 'pass', fromSettlementId: 'a', toSettlementId: 'b', type: 'mountain_pass', enabled: true, movementMultiplier: 1, waypoints: [] },
      { id: 'off', fromSettlementId: 'c', toSettlementId: 'd', type: 'main_road', enabled: false, movementMultiplier: 1, waypoints: [] },
    ],
  });
  assert.equal(cellAt(kinds, 500, 100).routeId, 'mountain_pass');
  // Two roads equally near a point: the one listed first decides, so the answer is the data's, not chance.
  const twin = (first, second) => createWorld({
    nodes: [town('a', 100, 100), town('b', 1100, 100)],
    roads: [
      { id: first, fromSettlementId: 'a', toSettlementId: 'b', type: first === 'x_road' ? 'main_road' : 'mountain_pass', enabled: true, movementMultiplier: 1, waypoints: [] },
      { id: second, fromSettlementId: 'a', toSettlementId: 'b', type: second === 'x_road' ? 'main_road' : 'mountain_pass', enabled: true, movementMultiplier: 1, waypoints: [] },
    ],
  });
  assert.equal(cellAt(twin('x_road', 'y_pass'), 500, 100).roadId, 'x_road');
  assert.equal(cellAt(twin('y_pass', 'x_road'), 500, 100).roadId, 'y_pass');
  assert.equal(cellAt(kinds, 500, 900).routeId, null);
  // A road laid across a river is no crossing: roads may not lie on rivers, only bridges may.
  const flooded = createWorld({
    nodes: [town('a', 100, 100), town('b', 1100, 100)],
    roads: [{ id: 'r', fromSettlementId: 'a', toSettlementId: 'b', type: 'main_road', enabled: true, movementMultiplier: 1, waypoints: [] }],
    zones: [{ id: 'river', baseId: 'river', shape: { type: 'rect', x: 500, y: 0, width: 100, height: 200 } }],
  });
  assert.equal(cellAt(flooded, 550, 100).routeId, 'road');
  assert.equal(profileAt(flooded, 550, 100).passable, false);
  assert.equal(profileAt(flooded, 550, 100).warnings.length, 1);
});

test('[world.data.static-valid] the map data is valid, frozen, and bad data is refused', () => {
  assert.deepEqual(validateWorldData(), []);
  assert.deepEqual(validateWorldData({ zones: TEST_ZONES }), []);
  assert.equal(NODES.length, 3);
  assert.equal(ROADS.length, 2);
  assert.equal(MAP.width, 4096);
  assert.throws(() => { NODES[0].x = 1; });
  assert.throws(() => { ROADS[0].waypoints.push({ x: 1, y: 1 }); });
  assert.throws(() => { BASE_TYPES.plain.speedMult = 2; });
  assert.throws(() => { TEST_ZONES[0].shape.radius = 1; });
  const bad = (data) => validateWorldData({ regions: REGIONS, roads: [], zones: [], ...data });
  assert.deepEqual(bad({ nodes: [...NODES, NODES[0]] }), ['node_duplicate:test_city']);
  assert.deepEqual(bad({ nodes: [town('far', 5000, 10)] }), ['node_outside_map:far']);
  assert.deepEqual(bad({ nodes: [{ ...town('lost', 1, 1), regionId: 'nowhere' }] }), ['node_unknown_region:lost']);
  assert.deepEqual(bad({ nodes: NODES, roads: [{ ...ROADS[0], toSettlementId: 'ghost' }] }), ['road_missing_end:road_castle_city']);
  assert.deepEqual(bad({ nodes: NODES, roads: [{ ...ROADS[0], toSettlementId: ROADS[0].fromSettlementId }] }), ['road_loop:road_castle_city']);
  assert.deepEqual(bad({ nodes: NODES, roads: [ROADS[0], ROADS[0]] }), ['road_duplicate:road_castle_city']);
  assert.deepEqual(bad({ nodes: [town('p', 5, 5), town('q', 5, 5)], roads: [{ ...ROADS[0], id: 'zero', fromSettlementId: 'p', toSettlementId: 'q' }] }), ['road_zero_length:zero']);
  assert.deepEqual(bad({ nodes: NODES, zones: [{ id: 'z', baseId: 'lava', shape: { type: 'rect', x: 0, y: 0, width: 1, height: 1 } }] }), ['zone_unknown_base:z']);
  assert.deepEqual(bad({ nodes: NODES, zones: [{ id: 'z', baseId: 'hill', shape: { type: 'circle', x: 0, y: 0, radius: 0 } }] }), ['zone_shape_invalid:z']);
  assert.throws(() => createWorld({ nodes: [town('far', 5000, 10)] }), /node_outside_map:far/);
});
