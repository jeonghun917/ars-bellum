import test from 'node:test';
import assert from 'node:assert/strict';
import { runFrame } from '../../src/ui/frame.js';
import { createPacer } from '../../src/ui/pacer.js';
import { TEST_ZONES, createWorld, defaultWorld, orderGroupTo } from '../../src/domains/world/index.js';
import { PLAYER_GROUP_ID, countCommits, makeCampaign } from './ui-helpers.mjs';

// A day takes a million real seconds, so only the movement of a frame can commit.
const slowClock = (state) => { state.clock.realMsPerGameMinute = 1e9; };

function order(campaign, target, world = defaultWorld) {
  const result = campaign.store.transact('order', (draft) => orderGroupTo(draft, { groupId: PLAYER_GROUP_ID, ...target }, { world }));
  assert.equal(result.ok, true, JSON.stringify(result));
}
const frame = (campaign, extra = {}) => runFrame({ campaign, groupId: PLAYER_GROUP_ID, realDtMs: 100, pacer: extra.pacer ?? createPacer(), ...extra });

test('[ui.frame.idle-commits-nothing] a frame where the group stands still and no game minute is due commits no transaction', () => {
  const { campaign } = makeCampaign({ edit: slowClock });
  const commits = countCommits(campaign);
  const before = campaign.getState();
  const pacer = createPacer();
  for (let i = 0; i < 20; i += 1) {
    const out = frame(campaign, { pacer });
    assert.deepEqual(out, { event: null, minutes: 0, processedDays: [], failure: null });
  }
  assert.equal(commits.count, 0);
  assert.equal(campaign.getState(), before, 'the very same state object');
});

test('[ui.frame.moving-one-transaction] a moving group commits exactly one transaction per frame, with the movement rule\'s patch', () => {
  const { campaign } = makeCampaign({ edit: slowClock });
  order(campaign, { nodeId: 'test_castle' });
  const commits = countCommits(campaign);
  const pacer = createPacer();
  const startX = campaign.getState().world.mobileGroups[PLAYER_GROUP_ID].worldPosition.x;
  for (let i = 0; i < 3; i += 1) frame(campaign, { pacer });
  assert.equal(commits.count, 3);
  assert.deepEqual(commits.labels, ['move group', 'move group', 'move group']);
  assert.notEqual(campaign.getState().world.mobileGroups[PLAYER_GROUP_ID].worldPosition.x, startX);
});

test('[ui.frame.arrival-event] the group walks to the settlement, the frame reports arrival once, and later frames are idle again', () => {
  const { campaign } = makeCampaign({ edit: slowClock });
  order(campaign, { nodeId: 'test_castle' });
  const pacer = createPacer();
  const events = [];
  for (let i = 0; i < 400; i += 1) {
    const out = frame(campaign, { pacer, realDtMs: 200 });
    if (out.event) events.push(out.event);
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'arrived');
  assert.equal(events[0].nodeId, 'test_castle');
  const group = campaign.getState().world.mobileGroups[PLAYER_GROUP_ID];
  assert.deepEqual(group.worldPosition, { x: 800, y: 1200 });
  const commits = countCommits(campaign);
  frame(campaign, { pacer });
  assert.equal(commits.count, 0);
});

test('[ui.frame.blocked-event] walking into a mountain stops the group with a blocked event naming the terrain', () => {
  const world = createWorld({ zones: TEST_ZONES });
  const { campaign } = makeCampaign({
    edit(state) {
      slowClock(state);
      const group = state.world.mobileGroups[PLAYER_GROUP_ID];
      group.worldPosition = { x: 3300, y: 3100 };
      group.movement.targetX = 3300;
      group.movement.targetY = 3100;
    },
  });
  order(campaign, { x: 3600, y: 3100 }, world);
  const pacer = createPacer();
  let blocked = null;
  for (let i = 0; i < 100 && !blocked; i += 1) blocked = frame(campaign, { pacer, realDtMs: 200, world }).event;
  assert.equal(blocked?.type, 'blocked');
  assert.equal(blocked.terrainName, '산맥');
  const group = campaign.getState().world.mobileGroups[PLAYER_GROUP_ID];
  assert.ok(group.worldPosition.x < 3400, 'stopped before the mountain');
  assert.equal(group.movement.targetX, group.worldPosition.x, 'the order is cleared');
});

test('[ui.frame.paused-no-movement-no-time] while paused nothing moves and no time passes, even with an order given', () => {
  const { campaign } = makeCampaign({ edit(state) { state.clock.speed = 0; } });
  order(campaign, { nodeId: 'test_castle' });
  const commits = countCommits(campaign);
  const pacer = createPacer();
  for (let i = 0; i < 10; i += 1) frame(campaign, { pacer, realDtMs: 250 });
  assert.equal(commits.count, 0);
  assert.deepEqual(campaign.getState().world.mobileGroups[PLAYER_GROUP_ID].worldPosition, { x: 1000, y: 1000 });
});

test('[ui.frame.time-runs-days] game minutes go through advanceMinutes and the days that end are processed and reported', () => {
  const { campaign } = makeCampaign({ edit(state) { state.clock.realMsPerGameMinute = 1; state.clock.speed = 4; } });
  const pacer = createPacer();
  const days = [];
  let minutes = 0;
  for (let i = 0; i < 6; i += 1) {
    const out = frame(campaign, { pacer, realDtMs: 250 });
    assert.equal(out.failure, null);
    days.push(...out.processedDays);
    minutes += out.minutes;
  }
  assert.equal(minutes, 6000);
  assert.equal(campaign.getState().calendar.day, 5);
  assert.deepEqual(days, [1, 2, 3, 4]);
  assert.equal(campaign.getState().lastProcessedDay, 4);
});

test('[ui.frame.failure-reported] a failing daily run is returned as the frame\'s failure with the days that did finish; a retry asks again with zero minutes', () => {
  const { campaign } = makeCampaign({ edit(state) { state.clock.realMsPerGameMinute = 1; state.clock.speed = 1; } });
  const asked = [];
  const failing = {
    ...campaign,
    advanceMinutes(minutes) {
      asked.push(minutes);
      return { ok: false, error: 'daily_step_failed', detail: { day: 2, step: 'x', cause: { ok: false, error: 'boom' } }, processed: [1] };
    },
  };
  const pacer = createPacer();
  const out = frame(failing, { pacer, realDtMs: 250 });
  assert.equal(out.failure.error, 'daily_step_failed');
  assert.deepEqual(out.processedDays, [1]);
  assert.deepEqual(asked, [250]);
  const retry = frame(failing, { pacer, realDtMs: 0, retryDays: true });
  assert.equal(retry.failure.error, 'daily_step_failed');
  assert.deepEqual(asked, [250, 0]);
});

test('[ui.frame.unknown-group-fails] a frame for a group that does not exist reports the failure and commits nothing', () => {
  const { campaign } = makeCampaign({ edit: slowClock });
  const commits = countCommits(campaign);
  const out = runFrame({ campaign, groupId: 'no_such_group', realDtMs: 100, pacer: createPacer() });
  assert.equal(out.failure.error, 'world_unknown_group');
  assert.equal(commits.count, 0);
});
