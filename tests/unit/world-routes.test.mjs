import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, defaultWorld, planRoute, shortestPath } from '../../src/domains/world/index.js';

const town = (id, x, y) => ({ id, name: id, type: 'village', x, y, regionId: 'central_valley' });
const road = (id, from, to, extra = {}) => ({
  id, fromSettlementId: from, toSettlementId: to, type: 'main_road', enabled: true, movementMultiplier: 1, waypoints: [], ...extra,
});
const at = (node) => ({ x: node.x, y: node.y });
const ids = (list) => list.map((w) => w.nodeId).filter(Boolean);

test('[world.route.shortest-road-path] the route follows the cheapest roads, not the fewest', () => {
  // a - b - c in a line (1000 px each). A second road a - c bends far south (a long detour).
  const nodes = [town('a', 100, 100), town('b', 1100, 100), town('c', 2100, 100)];
  const detour = road('a_c', 'a', 'c', { waypoints: [{ x: 1100, y: 1500 }] });
  const world = createWorld({ nodes, roads: [road('a_b', 'a', 'b'), road('b_c', 'b', 'c'), detour] });
  const plan = planRoute(world, at(nodes[0]), 'c');
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.nodeIds, ['a', 'b', 'c']);
  assert.deepEqual(plan.roadIds, ['a_b', 'b_c']);
  assert.deepEqual(ids(plan.waypoints), ['a', 'b', 'c']);
  assert.deepEqual(plan.waypoints.map((w) => w.final), [false, false, true]);
  assert.equal(plan.routeLength, 2000);
  assert.equal(plan.detourRatio, 1);

  // Going the other way gives the same roads, reversed.
  const back = planRoute(world, at(nodes[2]), 'a');
  assert.deepEqual(back.nodeIds, ['c', 'b', 'a']);
  assert.deepEqual(back.roadIds, ['b_c', 'a_b']);

  // A faster road is cheaper even when it is no shorter: a straight a - c road at 2x beats a - b - c at 1x.
  const fast = createWorld({ nodes, roads: [road('a_b', 'a', 'b'), road('b_c', 'b', 'c'), road('a_c', 'a', 'c', { movementMultiplier: 2.5 })] });
  assert.deepEqual(planRoute(fast, at(nodes[0]), 'c').roadIds, ['a_c']);
  // ...and a slow direct road loses to the two good ones.
  const slow = createWorld({ nodes, roads: [road('a_b', 'a', 'b', { movementMultiplier: 1.25 }), road('b_c', 'b', 'c', { movementMultiplier: 1.25 }), road('a_c', 'a', 'c')] });
  assert.deepEqual(planRoute(slow, at(nodes[0]), 'c').roadIds, ['a_b', 'b_c']);

  // A group away from the settlements first walks to the nearest one that has a road.
  const start = { x: 300, y: 300 };
  const fromAside = planRoute(world, start, 'c');
  assert.deepEqual(fromAside.waypoints[0], { x: 100, y: 100, roadId: null, nodeId: 'a', final: false });
  assert.deepEqual(ids(fromAside.waypoints), ['a', 'b', 'c']);

  // The real map: castle -> city -> village, the only way.
  const castle = defaultWorld.nodeById.get('test_castle');
  const real = planRoute(defaultWorld, at(castle), 'test_village');
  assert.deepEqual(real.nodeIds, ['test_castle', 'test_city', 'test_village']);
  assert.deepEqual(real.roadIds, ['road_castle_city', 'road_city_village']);
  assert.deepEqual(real.waypoints.at(-1), { x: 3500, y: 1800, roadId: 'road_city_village', nodeId: 'test_village', final: true });

  // Already at the destination: a one-point route.
  const here = planRoute(world, at(nodes[1]), 'b');
  assert.deepEqual(here.waypoints.map((w) => [w.x, w.y, w.final]), [[1100, 100, true]]);
  assert.deepEqual(shortestPath(world, 'a', 'a'), { nodeIds: ['a'], roadIds: [] });
});

test('[world.route.deterministic-ties] equal-cost routes are settled by id, whatever order the data is listed in', () => {
  // Diamond: a - b - d and a - c - d have exactly equal cost. Two parallel roads b - d tie as well.
  const nodes = [town('a', 0, 100), town('b', 100, 200), town('c', 100, 0), town('d', 200, 100)];
  const roads = [road('a_b', 'a', 'b'), road('a_c', 'a', 'c'), road('b_d', 'b', 'd'), road('b_d2', 'b', 'd'), road('c_d', 'c', 'd')];
  const reference = planRoute(createWorld({ nodes, roads }), at(nodes[0]), 'd');
  assert.deepEqual(reference.nodeIds, ['a', 'b', 'd']);
  assert.deepEqual(reference.roadIds, ['a_b', 'b_d']);
  const rotations = (list) => list.map((_, i) => [...list.slice(i), ...list.slice(0, i)]);
  const orders = (list) => [list, [...list].reverse(), ...rotations(list), ...rotations([...list].reverse())];
  for (const nodeOrder of orders(nodes)) {
    for (const roadOrder of orders(roads)) {
      const plan = planRoute(createWorld({ nodes: nodeOrder, roads: roadOrder }), at(nodes[0]), 'd');
      assert.deepEqual(plan, reference);
    }
  }
  // Reversing the ends of every road changes nothing either.
  const flipped = roads.map((r) => ({ ...r, fromSettlementId: r.toSettlementId, toSettlementId: r.fromSettlementId }));
  assert.deepEqual(planRoute(createWorld({ nodes, roads: flipped }), at(nodes[0]), 'd').roadIds, ['a_b', 'b_d']);
  // Equidistant start settlements: the lower id is the start.
  const twins = createWorld({ nodes: [town('n', 100, 200), town('m', 100, 0), town('far', 3000, 0)], roads: [road('m_far', 'm', 'far'), road('n_far', 'n', 'far')] });
  assert.equal(planRoute(twins, { x: 0, y: 100 }, 'far').waypoints[0].nodeId, 'm');
});

test('[world.route.unreachable] a route that cannot be made says why, and nothing is invented', () => {
  const nodes = [town('a', 100, 100), town('b', 1100, 100), town('island', 100, 3000), town('x', 2500, 2500), town('y', 3500, 2500)];
  const roads = [road('a_b', 'a', 'b'), road('x_y', 'x', 'y'), road('off', 'a', 'island', { enabled: false })];
  const world = createWorld({ nodes, roads });
  const failure = (from, to) => { const r = planRoute(world, from, to); assert.equal(r.ok, false); return r; };
  // Two separate road networks, a settlement without usable roads, and a switched-off road.
  assert.deepEqual(failure(at(nodes[0]), 'x'), { ok: false, error: 'world_unreachable', detail: { fromNodeId: 'a', toNodeId: 'x' } });
  assert.equal(failure(at(nodes[3]), 'a').error, 'world_unreachable');
  assert.equal(failure(at(nodes[0]), 'island').error, 'world_unreachable');
  // No settlement with a road within 420 px of the start.
  assert.equal(failure({ x: 2000, y: 2000 }, 'a').error, 'world_no_start_road');
  assert.equal(failure({ x: 100, y: 100 + 421 }, 'b').error, 'world_no_start_road');
  assert.equal(planRoute(world, { x: 100, y: 100 + 420 }, 'b').ok, true);
  // Bad input.
  assert.equal(failure(at(nodes[0]), 'nowhere').error, 'world_unknown_node');
  assert.equal(failure(at(nodes[0]), undefined).error, 'world_unknown_node');
  assert.equal(failure({ x: Number.NaN, y: 1 }, 'b').error, 'world_invalid_position');
  assert.equal(failure(null, 'b').error, 'world_invalid_position');
  // A road route more than 2.25 times the straight line is not taken.
  const loopy = createWorld({
    nodes: [town('p', 100, 100), town('q', 300, 100)],
    roads: [road('p_q', 'p', 'q', { waypoints: [{ x: 100, y: 2000 }, { x: 300, y: 2000 }] })],
  });
  assert.deepEqual(planRoute(loopy, { x: 100, y: 100 }, 'q').error, 'world_detour_too_long');
  assert.equal(planRoute(loopy, { x: 100, y: 100 }, 'q', { maxDetourRatio: 100 }).ok, true);
});
