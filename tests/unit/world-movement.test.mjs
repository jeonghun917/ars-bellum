import test from 'node:test';
import assert from 'node:assert/strict';
import { clone } from '../../src/core/data.js';
import { createStore } from '../../src/core/store.js';
import { newGameState, PLAYER_GROUP_ID } from '../../src/game/new-game.js';
import { validateState } from '../../src/persist/schema.js';
import {
  TEST_ZONES, advanceGroup, cancelRoute, checkWorld, createWorld, defaultWorld, moveGroup, orderGroupTo, stepMovement, stopGroup,
} from '../../src/domains/world/index.js';

const SCOUT_ID = 'scout_group';
const FRAME = 1 / 60;

// A new game plus a second group, so a rule that touches "every group" is caught.
function makeStore({ player = {}, scout = {}, world = defaultWorld } = {}) {
  const state = newGameState({ seed: 7 });
  const playerGroup = state.world.mobileGroups[PLAYER_GROUP_ID];
  Object.assign(playerGroup.worldPosition, player.position ?? {});
  Object.assign(playerGroup.movement, player.movement ?? {});
  const second = clone(playerGroup);
  second.id = SCOUT_ID;
  second.name = 'scout';
  second.worldPosition = { x: 2000, y: 1500 };
  second.movement = { baseSpeed: 150, currentSpeed: 150, targetNode: null, targetX: 2000, targetY: 1500 };
  Object.assign(second.worldPosition, scout.position ?? {});
  Object.assign(second.movement, scout.movement ?? {});
  state.world.mobileGroups[SCOUT_ID] = second;
  // A world other than the real map needs its own check of node ids.
  return createStore(state, { validate: world === defaultWorld ? validateState : (candidate) => checkWorld(candidate, world) });
}

const group = (store, id = PLAYER_GROUP_ID) => store.getState().world.mobileGroups[id];
const order = (store, input, context) => store.transact('order', (draft) => orderGroupTo(draft, input, context));

// What a frame driver does: step the group, and commit only when the step changed something.
function frame(store, id, dt = FRAME, world = defaultWorld) {
  const step = stepMovement(group(store, id), dt, world);
  assert.equal(step.ok, true);
  if (!step.patch) return { committed: false, event: step.event };
  const stored = store.transact('frame', (draft) => moveGroup(draft, { groupId: id, patch: step.patch }, { world }));
  assert.equal(stored.ok, true);
  return { committed: true, event: step.event };
}

function runUntilIdle(store, id, { dt = FRAME, world = defaultWorld, limit = 200000 } = {}) {
  const events = [];
  let frames = 0;
  for (; frames < limit; frames += 1) {
    const result = frame(store, id, dt, world);
    if (result.event) events.push(result.event);
    if (!result.committed) break;
  }
  return { events, frames };
}

test('[world.move.arrival-once] a group arrives at its destination exactly once, and stays put afterwards', () => {
  const store = makeStore();
  assert.deepEqual(order(store, { groupId: PLAYER_GROUP_ID, nodeId: 'test_village' }).mode, 'road');
  const { events, frames } = runUntilIdle(store, PLAYER_GROUP_ID);
  assert.ok(frames > 100 && frames < 5000, `frames ${frames}`);
  // Passing through the castle and the city on the way is not arriving.
  assert.deepEqual(events, [{ type: 'arrived', groupId: PLAYER_GROUP_ID, nodeId: 'test_village', x: 3500, y: 1800 }]);
  const done = group(store);
  assert.deepEqual(done.worldPosition, { x: 3500, y: 1800 });
  assert.deepEqual(done.movement, { baseSpeed: 180, currentSpeed: 180, targetNode: null, targetX: 3500, targetY: 1800 });
  // Many more frames: nothing changes, nothing is reported, nothing is committed.
  const revision = store.getState().revision;
  for (let i = 0; i < 300; i += 1) {
    const idle = frame(store, PLAYER_GROUP_ID);
    assert.deepEqual(idle, { committed: false, event: null });
  }
  assert.equal(store.getState().revision, revision);

  // A point on the ground arrives once too, with no settlement named.
  order(store, { groupId: PLAYER_GROUP_ID, x: 3300, y: 1500 });
  const ground = runUntilIdle(store, PLAYER_GROUP_ID);
  assert.deepEqual(ground.events, [{ type: 'arrived', groupId: PLAYER_GROUP_ID, nodeId: null, x: 3300, y: 1500 }]);
  // Ordered to the place it stands: arrives at once, still once.
  order(store, { groupId: PLAYER_GROUP_ID, x: 3300, y: 1500 });
  assert.equal(runUntilIdle(store, PLAYER_GROUP_ID).events.length, 0);
  order(store, { groupId: PLAYER_GROUP_ID, nodeId: 'test_village' });
  const again = runUntilIdle(store, PLAYER_GROUP_ID);
  assert.deepEqual(again.events.map((e) => e.nodeId), ['test_village']);
});

test('[world.move.one-commit-per-step] a frame is one commit however far it goes, and an idle frame is none', () => {
  const store = makeStore();
  const commits = [];
  store.subscribe((event) => commits.push(event));
  order(store, { groupId: PLAYER_GROUP_ID, nodeId: 'test_village' });
  commits.length = 0;
  const before = store.getState();
  for (let i = 0; i < 5; i += 1) {
    const revision = store.getState().revision;
    const groupRevision = group(store).revision;
    assert.equal(frame(store, PLAYER_GROUP_ID).committed, true);
    assert.equal(store.getState().revision, revision + 1);
    assert.equal(group(store).revision, groupRevision + 1);
  }
  assert.equal(commits.length, 5);
  // stepMovement itself changes nothing it was given (the state is frozen, so it could not anyway).
  const snapshot = JSON.stringify(group(store));
  stepMovement(group(store), 5, defaultWorld);
  assert.equal(JSON.stringify(group(store)), snapshot);
  assert.notEqual(store.getState(), before);

  // One long step crosses several bends and a settlement and is still one patch, one commit.
  const longStep = stepMovement(group(store), 10, defaultWorld);
  assert.equal(longStep.ok, true);
  assert.ok(longStep.patch.worldPosition.x > 2000, 'a ten second step goes well past the city');
  commits.length = 0;
  const revision = store.getState().revision;
  assert.equal(frame(store, PLAYER_GROUP_ID, 10).committed, true);
  assert.equal(commits.length, 1);
  assert.equal(store.getState().revision, revision + 1);
  assert.equal(group(store).movement.route.index, 2, 'the route moved on past the castle and the city inside that one step');
  assert.ok(group(store).worldPosition.x > 2000);

  // Several groups in one frame: one transaction, one commit.
  const both = makeStore({ scout: { movement: { targetX: 2600, targetY: 1500 } } });
  order(both, { groupId: PLAYER_GROUP_ID, x: 1500, y: 1000 });
  let count = 0;
  both.subscribe(() => { count += 1; });
  const result = both.transact('frame', (draft) => {
    for (const id of [PLAYER_GROUP_ID, SCOUT_ID]) {
      const r = advanceGroup(draft, { groupId: id, dtSeconds: FRAME });
      if (!r.ok) return r;
    }
    return undefined;
  });
  assert.equal(result.ok, true);
  assert.equal(count, 1);
  assert.ok(group(both, PLAYER_GROUP_ID).worldPosition.x > 1000);
  assert.ok(group(both, SCOUT_ID).worldPosition.x > 2000);
});

test('[world.move.terrain-speed] speed follows the ground under the group: road faster, forest slower', () => {
  const world = createWorld({ zones: TEST_ZONES });
  const travelled = (from, to, base = 180) => {
    const step = stepMovement({ id: 'g', worldPosition: from, movement: { baseSpeed: base, currentSpeed: base, targetNode: null, targetX: to.x, targetY: to.y } }, 1, world);
    return { distance: Math.hypot(step.patch.worldPosition.x - from.x, step.patch.worldPosition.y - from.y), speed: step.patch.movement.currentSpeed };
  };
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} vs ${expected}`);
  // Open ground, 180 px/s.
  near(travelled({ x: 1000, y: 3000 }, { x: 1900, y: 3000 }).distance, 180);
  // Along the castle - city road, 180 x 1.28.
  near(travelled({ x: 900, y: 1225 }, { x: 1900, y: 1475 }).distance, 180 * 1.28);
  // In the test forest, 180 x 0.65.
  const forest = travelled({ x: 2800, y: 3300 }, { x: 3100, y: 3300 });
  near(forest.distance, 180 * 0.65);
  near(forest.speed, 180 * 0.65);
  // On a bridge over the river: passable, at 180 x 0.95. (0.2 s keeps the whole step on the bridge.)
  const onBridge = stepMovement({ id: 'g', worldPosition: { x: 2860, y: 3605 }, movement: { baseSpeed: 180, currentSpeed: 180, targetNode: null, targetX: 2860, targetY: 3900 } }, 0.2, world);
  near(onBridge.patch.worldPosition.y - 3605, 180 * 0.95 * 0.2);
  assert.equal(onBridge.event, null);
  // The whole step stays on a straight line to the target.
  const step = stepMovement({ id: 'g', worldPosition: { x: 1000, y: 3000 }, movement: { baseSpeed: 180, currentSpeed: 180, targetNode: null, targetX: 1900, targetY: 3900 } }, 1, world);
  near(step.patch.worldPosition.x - 1000, step.patch.worldPosition.y - 3000);
});

// River at x 2450..3210, y 3600..3680; bridge x 2810..2910. Both far from the playable area.
test('[world.move.blocked-result] impassable ground ends the order with a blocked event instead of freezing the group', () => {
  const world = createWorld({ zones: TEST_ZONES });
  const context = { world };
  const store = makeStore({ player: { position: { x: 2600, y: 3400 } } });
  order(store, { groupId: PLAYER_GROUP_ID, x: 2600, y: 3900 }, context);
  const { events } = runUntilIdle(store, PLAYER_GROUP_ID, { world });
  assert.equal(events.length, 1);
  const [blocked] = events;
  assert.equal(blocked.type, 'blocked');
  assert.equal(blocked.reason, 'impassable_terrain');
  assert.equal(blocked.terrainId, 'river');
  assert.deepEqual(blocked.target, { x: 2600, y: 3900 });
  assert.equal(blocked.x, 2600);
  assert.ok(blocked.y < 3600 && blocked.y > 3600 - 9, `stopped at the bank, y=${blocked.y}`);
  // The group is idle at the bank: the order is gone, the speed is back to normal, nothing repeats.
  const stopped = group(store);
  assert.deepEqual(stopped.worldPosition, { x: blocked.x, y: blocked.y });
  assert.deepEqual(stopped.movement, { baseSpeed: 180, currentSpeed: 180, targetNode: null, targetX: blocked.x, targetY: blocked.y });
  assert.deepEqual(frame(store, PLAYER_GROUP_ID, FRAME, world), { committed: false, event: null });
  // A new order works at once: back north, then along the bank to the bridge and across.
  order(store, { groupId: PLAYER_GROUP_ID, x: 2860, y: 3590 }, context);
  assert.equal(runUntilIdle(store, PLAYER_GROUP_ID, { world }).events[0].type, 'arrived');
  order(store, { groupId: PLAYER_GROUP_ID, x: 2860, y: 3900 }, context);
  const crossing = runUntilIdle(store, PLAYER_GROUP_ID, { world });
  assert.deepEqual(crossing.events.map((e) => e.type), ['arrived']);
  assert.deepEqual(group(store).worldPosition, { x: 2860, y: 3900 });

  // One huge step cannot jump over the river: the terrain is looked at all along the way.
  const jump = stepMovement({ id: 'g', worldPosition: { x: 2600, y: 3400 }, movement: { baseSpeed: 180, currentSpeed: 180, targetNode: null, targetX: 2600, targetY: 3900 } }, 600, world);
  assert.equal(jump.event.type, 'blocked');
  assert.ok(jump.patch.worldPosition.y < 3600);

  // A group standing in the mountain can still walk out if the way ahead is open, and is blocked if not.
  const inMountain = { id: 'g', worldPosition: { x: 3404, y: 3000 }, movement: { baseSpeed: 180, currentSpeed: 180, targetNode: null, targetX: 3300, targetY: 3000 } };
  assert.equal(stepMovement(inMountain, 1, world).event.type, 'arrived');
  const deeper = { ...inMountain, movement: { ...inMountain.movement, targetX: 3600, targetY: 3000 } };
  assert.equal(stepMovement(deeper, 1, world).event.type, 'blocked');
  assert.equal(stepMovement(deeper, 1, world).event.terrainId, 'mountain');

  // A route over a road that crosses a river ends the same way, and takes the route with it.
  const nodes = [
    { id: 'west', name: 'west', type: 'village', x: 500, y: 500, regionId: 'central_valley' },
    { id: 'east', name: 'east', type: 'village', x: 1500, y: 500, regionId: 'central_valley' },
  ];
  const flooded = createWorld({
    nodes,
    roads: [{ id: 'link', fromSettlementId: 'west', toSettlementId: 'east', type: 'main_road', enabled: true, movementMultiplier: 1, waypoints: [] }],
    zones: [{ id: 'river', baseId: 'river', shape: { type: 'rect', x: 900, y: 0, width: 100, height: 1000 } }],
  });
  const second = makeStore({ player: { position: { x: 500, y: 500 } }, world: flooded });
  assert.equal(order(second, { groupId: PLAYER_GROUP_ID, nodeId: 'east' }, { world: flooded }).mode, 'road');
  const along = runUntilIdle(second, PLAYER_GROUP_ID, { world: flooded });
  assert.equal(along.events.length, 1);
  assert.equal(along.events[0].type, 'blocked');
  assert.equal(along.events[0].nodeId, 'east');
  assert.ok(along.events[0].x < 900 && along.events[0].x > 891);
  assert.equal('route' in group(second).movement, false);
  assert.equal(group(second).movement.targetNode, null);
});

test('[world.command.manual-cancels-route] a manual order replaces the road route', () => {
  const store = makeStore();
  order(store, { groupId: PLAYER_GROUP_ID, nodeId: 'test_village' });
  assert.equal(group(store).movement.targetNode, 'test_village');
  assert.equal(group(store).movement.route.waypoints.length, 3);
  for (let i = 0; i < 30; i += 1) frame(store, PLAYER_GROUP_ID);
  assert.ok('route' in group(store).movement);

  const result = order(store, { groupId: PLAYER_GROUP_ID, x: 1100, y: 1000 });
  assert.equal(result.mode, 'ground');
  const movement = group(store).movement;
  assert.equal('route' in movement, false);
  assert.equal(movement.targetNode, null);
  assert.deepEqual([movement.targetX, movement.targetY], [1100, 1000]);
  // It now walks to the new point and arrives there, not at the old destination.
  const { events } = runUntilIdle(store, PLAYER_GROUP_ID);
  assert.deepEqual(events.map((e) => [e.type, e.nodeId, e.x, e.y]), [['arrived', null, 1100, 1000]]);

  // A settlement order replaces a settlement order; stop ends it; a point outside the map is pulled to the edge.
  order(store, { groupId: PLAYER_GROUP_ID, nodeId: 'test_castle' });
  order(store, { groupId: PLAYER_GROUP_ID, nodeId: 'test_village' });
  assert.equal(group(store).movement.route.destinationId, 'test_village');
  assert.equal(store.transact('stop', (draft) => stopGroup(draft, { groupId: PLAYER_GROUP_ID })).ok, true);
  const idle = group(store);
  assert.equal('route' in idle.movement, false);
  assert.deepEqual([idle.movement.targetNode, idle.movement.targetX, idle.movement.targetY], [null, idle.worldPosition.x, idle.worldPosition.y]);
  assert.equal(frame(store, PLAYER_GROUP_ID).committed, false);
  order(store, { groupId: PLAYER_GROUP_ID, x: -50, y: 99999 });
  assert.deepEqual([group(store).movement.targetX, group(store).movement.targetY], [0, 4096]);

  // Something else rewriting the target of a group on a route (not through a rule) is a manual
  // order too: the route is dropped at the next step instead of dragging the group back.
  const hijacked = makeStore();
  order(hijacked, { groupId: PLAYER_GROUP_ID, nodeId: 'test_village' });
  const copy = clone(group(hijacked));
  copy.movement.targetX = 1200;
  copy.movement.targetY = 900;
  const step = stepMovement(copy, FRAME, defaultWorld);
  assert.equal('route' in step.patch.movement, false);
  assert.equal(step.patch.movement.targetX, 1200);
  assert.equal(step.patch.movement.targetY, 900);
});

test('[world.command.cancel-only-given-group] cancelling a route touches that group and no other', () => {
  const store = makeStore({ scout: { position: { x: 1700, y: 1425 } } });
  order(store, { groupId: PLAYER_GROUP_ID, nodeId: 'test_village' });
  order(store, { groupId: SCOUT_ID, nodeId: 'test_castle' });
  const playerBefore = clone(group(store));
  const scoutBefore = clone(group(store, SCOUT_ID));
  assert.ok('route' in scoutBefore.movement && 'route' in playerBefore.movement);

  const cancelled = store.transact('cancel', (draft) => cancelRoute(draft, { groupId: SCOUT_ID }));
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(group(store), playerBefore, 'the other group is exactly as it was');
  const scout = group(store, SCOUT_ID);
  assert.equal('route' in scout.movement, false);
  assert.equal(scout.movement.targetNode, null);
  // The cancelled group finishes the leg it was on and stops there; the other keeps its route and arrives.
  const leg = runUntilIdle(store, SCOUT_ID);
  assert.deepEqual(leg.events.map((e) => [e.type, e.nodeId, e.x, e.y]), [['arrived', null, 2000, 1500]]);
  assert.equal(runUntilIdle(store, PLAYER_GROUP_ID).events.at(-1).nodeId, 'test_village');

  // Cancelling a group without a route is a harmless no-op, and for the player group it leaves the scout alone.
  const nothing = makeStore();
  const sameState = nothing.getState();
  const noop = nothing.transact('cancel', (draft) => cancelRoute(draft, { groupId: SCOUT_ID }));
  assert.equal(noop.ok, true);
  assert.equal(noop.cancelled, false);
  assert.deepEqual(nothing.getState().world, sameState.world);
  const mixed = makeStore();
  order(mixed, { groupId: SCOUT_ID, nodeId: 'test_village' });
  const scoutKept = clone(group(mixed, SCOUT_ID));
  mixed.transact('cancel', (draft) => cancelRoute(draft, { groupId: PLAYER_GROUP_ID }));
  assert.deepEqual(group(mixed, SCOUT_ID), scoutKept);
});

test('[world.order.road-or-direct] a settlement order uses the roads when it can and walks straight when it cannot', () => {
  const store = makeStore({ player: { position: { x: 1000, y: 1000 } }, scout: { position: { x: 3000, y: 3500 } } });
  const road = order(store, { groupId: PLAYER_GROUP_ID, nodeId: 'test_city' });
  assert.deepEqual([road.ok, road.mode], [true, 'road']);
  const movement = group(store).movement;
  // targetNode is the id, never the node object; the first leg heads for the nearest settlement with a road.
  assert.equal(movement.targetNode, 'test_city');
  assert.deepEqual([movement.targetX, movement.targetY], [800, 1200]);
  // Far from every road (more than 420 px): straight to the settlement.
  const direct = order(store, { groupId: SCOUT_ID, nodeId: 'test_city' });
  assert.deepEqual([direct.ok, direct.mode, direct.routeFailure], [true, 'direct', 'world_no_start_road']);
  assert.deepEqual(group(store, SCOUT_ID).movement, { baseSpeed: 150, currentSpeed: 150, targetNode: 'test_city', targetX: 2000, targetY: 1500 });
  const arrival = runUntilIdle(store, SCOUT_ID);
  assert.deepEqual(arrival.events.map((e) => [e.type, e.nodeId]), [['arrived', 'test_city']]);
  // A settlement that the roads do not reach: the same, with the reason.
  const island = createWorld({
    nodes: [
      { id: 'a', name: 'a', type: 'village', x: 100, y: 100, regionId: 'central_valley' },
      { id: 'b', name: 'b', type: 'village', x: 600, y: 100, regionId: 'central_valley' },
      { id: 'lonely', name: 'lonely', type: 'village', x: 300, y: 300, regionId: 'central_valley' },
    ],
    roads: [{ id: 'a_b', fromSettlementId: 'a', toSettlementId: 'b', type: 'main_road', enabled: true, movementMultiplier: 1, waypoints: [] }],
  });
  const unreachable = order(makeStore({ player: { position: { x: 100, y: 100 } }, world: island }), { groupId: PLAYER_GROUP_ID, nodeId: 'lonely' }, { world: island });
  assert.deepEqual([unreachable.mode, unreachable.routeFailure], ['direct', 'world_unreachable']);
});

test('[world.rules.failed-changes-nothing] a rule that fails changes nothing, in the draft or in the store', () => {
  const store = makeStore();
  order(store, { groupId: SCOUT_ID, nodeId: 'test_village' });
  const good = clone(group(store, SCOUT_ID));
  const goodPatch = { worldPosition: { x: 1010, y: 1000 }, movement: { ...group(store).movement, targetX: 1010, targetY: 1000, currentSpeed: 180 } };
  const cases = [
    ['world_unknown_group', (d) => orderGroupTo(d, { groupId: 'nobody', x: 1, y: 1 })],
    ['world_unknown_group', (d) => orderGroupTo(d, { groupId: undefined, x: 1, y: 1 })],
    ['world_unknown_group', (d) => stopGroup(d, { groupId: 'nobody' })],
    ['world_unknown_group', (d) => cancelRoute(d, { groupId: 'nobody' })],
    ['world_unknown_group', (d) => advanceGroup(d, { groupId: 'nobody', dtSeconds: 1 })],
    ['world_unknown_group', (d) => moveGroup(d, { groupId: 'nobody', patch: goodPatch })],
    ['world_unknown_node', (d) => orderGroupTo(d, { groupId: SCOUT_ID, nodeId: 'atlantis' })],
    ['world_unknown_node', (d) => orderGroupTo(d, { groupId: SCOUT_ID, nodeId: { id: 'test_city' } })],
    ['world_invalid_order', (d) => orderGroupTo(d, { groupId: SCOUT_ID })],
    ['world_invalid_order', (d) => orderGroupTo(d, { groupId: SCOUT_ID, nodeId: 'test_city', x: 1, y: 1 })],
    ['world_invalid_target', (d) => orderGroupTo(d, { groupId: SCOUT_ID, x: 5 })],
    ['world_invalid_target', (d) => orderGroupTo(d, { groupId: SCOUT_ID, x: Number.NaN, y: 5 })],
    ['world_invalid_target', (d) => orderGroupTo(d, { groupId: SCOUT_ID, x: '5', y: 5 })],
    ['world_invalid_step', (d) => advanceGroup(d, { groupId: SCOUT_ID, dtSeconds: -1 })],
    ['world_invalid_step', (d) => advanceGroup(d, { groupId: SCOUT_ID, dtSeconds: Number.NaN })],
    ['world_invalid_step', (d) => advanceGroup(d, { groupId: SCOUT_ID })],
    ['world_invalid_patch', (d) => moveGroup(d, { groupId: SCOUT_ID })],
    ['world_invalid_patch', (d) => moveGroup(d, { groupId: SCOUT_ID, patch: { movement: goodPatch.movement } })],
    ['world_invalid_patch', (d) => moveGroup(d, { groupId: SCOUT_ID, patch: { ...goodPatch, worldPosition: { x: 5000, y: 1 } } })],
    ['world_invalid_patch', (d) => moveGroup(d, { groupId: SCOUT_ID, patch: { ...goodPatch, worldPosition: { x: Number.NaN, y: 1 } } })],
    ['world_invalid_patch', (d) => moveGroup(d, { groupId: SCOUT_ID, patch: { ...goodPatch, movement: { ...goodPatch.movement, currentSpeed: -1 } } })],
    ['world_invalid_patch', (d) => moveGroup(d, { groupId: SCOUT_ID, patch: { ...goodPatch, movement: { ...goodPatch.movement, targetX: -3 } } })],
    ['world_invalid_patch', (d) => moveGroup(d, { groupId: SCOUT_ID, patch: { ...goodPatch, movement: { ...goodPatch.movement, targetNode: 'atlantis' } } })],
    ['world_invalid_patch', (d) => moveGroup(d, { groupId: SCOUT_ID, patch: { ...goodPatch, movement: { ...goodPatch.movement, targetNode: { id: 'test_city' } } } })],
    ['world_invalid_patch', (d) => moveGroup(d, { groupId: SCOUT_ID, patch: { ...goodPatch, movement: { ...goodPatch.movement, route: { destinationId: 'test_city', index: 3, waypoints: [{ x: 1, y: 1 }] } } } })],
    ['world_invalid_patch', (d) => moveGroup(d, { groupId: SCOUT_ID, patch: { ...goodPatch, movement: { ...goodPatch.movement, mystery: 1 } } })],
  ];
  for (const [error, run] of cases) {
    const before = store.getState();
    const result = store.transact('bad', run);
    assert.equal(result.ok, false, error);
    assert.equal(result.error, error);
    assert.equal(store.getState(), before, `${error}: state object unchanged`);
    // The rule on its own leaves the draft untouched too, so a caller that ignores the failure is safe.
    const draft = clone(before);
    assert.equal(run(draft).ok, false);
    assert.deepEqual(draft, clone(before), `${error}: draft unchanged`);
  }
  // A good change followed by a failing one in the same transaction: neither is kept.
  const before = store.getState();
  const both = store.transact('pair', (draft) => {
    const first = orderGroupTo(draft, { groupId: PLAYER_GROUP_ID, x: 123, y: 456 });
    if (!first.ok) return first;
    return orderGroupTo(draft, { groupId: SCOUT_ID, nodeId: 'atlantis' });
  });
  assert.equal(both.error, 'world_unknown_node');
  assert.equal(store.getState(), before);
  assert.deepEqual(group(store, SCOUT_ID), good);
  // The same patch that was refused with a bad field is accepted when it is right.
  assert.equal(store.transact('ok', (d) => moveGroup(d, { groupId: SCOUT_ID, patch: goodPatch })).ok, true);
  assert.deepEqual(group(store, SCOUT_ID).worldPosition, { x: 1010, y: 1000 });
});

test('[world.check.state-shape] saved movement is checked, and the earlier version\'s whole-node targetNode is accepted', () => {
  const fresh = newGameState();
  assert.deepEqual(checkWorld(fresh), { ok: true });
  const withGroup = (change) => {
    const state = clone(fresh);
    change(state.world.mobileGroups[PLAYER_GROUP_ID]);
    return checkWorld(state);
  };
  assert.equal(withGroup((g) => { g.worldPosition.x = 5000; }).error, 'world_invalid_position');
  assert.equal(withGroup((g) => { g.worldPosition.y = Number.NaN; }).error, 'world_invalid_position');
  assert.equal(withGroup((g) => { g.movement.baseSpeed = -1; }).error, 'world_invalid_speed');
  assert.equal(withGroup((g) => { g.movement.targetY = -1; }).error, 'world_invalid_target');
  assert.equal(withGroup((g) => { g.movement.targetNode = 'atlantis'; }).error, 'world_unknown_target_node');
  assert.equal(withGroup((g) => { g.movement.targetNode = { name: 'no id' }; }).error, 'world_unknown_target_node');
  assert.equal(withGroup((g) => { g.movement.targetNode = 7; }).error, 'world_unknown_target_node');
  assert.equal(withGroup((g) => { delete g.movement; }).error, 'world_invalid_group');
  assert.equal(withGroup((g) => { g.movement.route = { destinationId: 'test_city', index: 0, waypoints: [{ x: 5, y: 5 }] }; }).error, 'world_route_destination_mismatch');
  assert.equal(withGroup((g) => { g.movement.targetNode = 'test_city'; g.movement.route = { destinationId: 'test_city', index: 2, waypoints: [{ x: 5, y: 5 }] }; }).error, 'world_invalid_route');
  assert.equal(withGroup((g) => { g.movement.targetNode = 'test_city'; g.movement.route = { destinationId: 'test_city', index: 0, waypoints: [{ x: 5, y: 5 }] }; }).ok, true);
  assert.equal(withGroup((g) => { g.movement.targetNode = 'test_city'; }).ok, true);

  // A save from the earlier version: targetNode is the whole settlement record.
  const legacy = clone(fresh);
  const city = defaultWorld.nodeById.get('test_city');
  const movement = legacy.world.mobileGroups[PLAYER_GROUP_ID].movement;
  Object.assign(movement, { targetNode: clone(city), targetX: city.x, targetY: city.y });
  assert.equal(checkWorld(legacy).ok, true);
  const store = createStore(legacy, { validate: validateState });
  // The first step reads it as an id, writes it back as an id, and the arrival is reported once.
  const first = stepMovement(group(store), FRAME, defaultWorld);
  assert.equal(first.patch.movement.targetNode, 'test_city');
  const { events } = runUntilIdle(store, PLAYER_GROUP_ID);
  assert.deepEqual(events.map((e) => [e.type, e.nodeId]), [['arrived', 'test_city']]);
  assert.equal(group(store).movement.targetNode, null);
  // A whole-node targetNode that names no settlement is not followed: the order is dropped.
  const stale = clone(group(store));
  stale.movement.targetNode = { id: 'gone', name: 'gone' };
  assert.equal(stepMovement(stale, FRAME, defaultWorld).patch.movement.targetNode, null);
});
