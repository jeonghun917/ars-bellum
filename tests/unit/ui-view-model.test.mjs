import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorld, orderGroupTo } from '../../src/domains/world/index.js';
import { describeMoveEvent, describeOrder, isIdle, playerGroupIdOf, readHud, settlementUnderGroup } from '../../src/ui/view-model.js';
import { PLAYER_GROUP_ID, makeCampaign } from './ui-helpers.mjs';

test('[ui.hud.reads-state] the top bar reads gold, days of food, manpower, territory and the date from the state', () => {
  const { campaign } = makeCampaign();
  const hud = readHud(campaign.getState());
  assert.deepEqual({ gold: hud.gold, foodDays: hud.foodDays, manpower: hud.manpower, territory: hud.territory, day: hud.day, clock: hud.clock },
    { gold: 500, foodDays: 10, manpower: 0, territory: 0, day: 1, clock: '1일 08:00' });
  assert.equal(playerGroupIdOf(campaign.getState()), PLAYER_GROUP_ID);
  campaign.store.transact('more food', (draft) => { draft.world.inventories.legacy_player_group_inventory.bulkItems.travel_rations = 25; });
  assert.equal(readHud(campaign.getState()).foodDays, 25);
});

test('[ui.hud.settlement-under-group] the settlement panel belongs to a group that stands in a settlement, not one passing or far away', () => {
  const { campaign } = makeCampaign();
  const groupId = PLAYER_GROUP_ID;
  assert.equal(settlementUnderGroup(campaign.getState(), defaultWorld, groupId), null);
  const place = (x, y, moving) => campaign.store.transact('place', (draft) => {
    const group = draft.world.mobileGroups[groupId];
    group.worldPosition = { x, y };
    group.movement.targetX = moving ? 3500 : x;
    group.movement.targetY = moving ? 1800 : y;
  });
  place(800, 1200, false);
  assert.equal(settlementUnderGroup(campaign.getState(), defaultWorld, groupId)?.id, 'test_castle');
  place(815, 1205, false);
  assert.equal(settlementUnderGroup(campaign.getState(), defaultWorld, groupId)?.id, 'test_castle', 'close enough');
  place(900, 1200, false);
  assert.equal(settlementUnderGroup(campaign.getState(), defaultWorld, groupId), null, 'too far');
  place(800, 1200, true);
  assert.equal(settlementUnderGroup(campaign.getState(), defaultWorld, groupId), null, 'on its way elsewhere');
  assert.equal(isIdle(campaign.getState().world.mobileGroups[groupId]), false);
});

test('[ui.hud.messages-for-orders-and-events] arrival, blocking and orders are written with the settlement\'s and terrain\'s names', () => {
  assert.match(describeMoveEvent({ type: 'arrived', nodeId: 'test_castle' }, defaultWorld), /카멜롯 성에 도착/);
  assert.match(describeMoveEvent({ type: 'arrived', nodeId: null }, defaultWorld), /목적지에 도착/);
  assert.match(describeMoveEvent({ type: 'blocked', terrainName: '강' }, defaultWorld), /강 지형/);
  const { campaign } = makeCampaign();
  const road = campaign.store.transact('order', (draft) => orderGroupTo(draft, { groupId: PLAYER_GROUP_ID, nodeId: 'test_city' }));
  assert.match(describeOrder(road, defaultWorld, 'test_city'), /아우구스투스/);
  assert.match(describeOrder({ mode: 'direct' }, defaultWorld, 'test_city'), /직선/);
  assert.match(describeOrder({ mode: 'ground' }, defaultWorld, undefined), /지정한 위치/);
});
