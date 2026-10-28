// Reads what the screens show out of a game state. Pure functions: state in, plain values out.
import { getCampaignMetrics, playerAccountIdOf } from '../domains/finance/index.js';
import { getFoodSummary } from '../domains/inventory/index.js';
import { PLAYER_GROUP_ID } from '../game/new-game.js';
import { formatClock } from './format.js';

// The group the player moves: the one the controlled character travels with.
export function playerGroupIdOf(state) {
  const character = state.world.characters[state.playerControl.currentCharacterId];
  const groupId = character?.location?.mobileGroupId;
  if (typeof groupId === 'string' && state.world.mobileGroups[groupId]) return groupId;
  return state.world.mobileGroups[PLAYER_GROUP_ID] ? PLAYER_GROUP_ID : null;
}

// Gold, food (in days of supply), manpower, territory and the date, as the top bar shows them.
export function readHud(state) {
  const accountId = playerAccountIdOf(state);
  const account = accountId ? state.world.finance.accounts[accountId] : null;
  const metrics = accountId ? getCampaignMetrics(state, accountId) : null;
  const groupId = playerGroupIdOf(state);
  const group = groupId ? state.world.mobileGroups[groupId] : null;
  // One ration feeds one person for one day, so the daily need is the head count of the group.
  const dailyNeed = group ? Math.max(1, group.memberCharacterIds.length) : 1;
  const food = group ? getFoodSummary(state, group.inventoryId, dailyNeed) : null;
  return {
    gold: account ? account.balance : 0,
    foodDays: food ? food.supplyDays : null,
    manpower: metrics ? metrics.manpower : 0,
    territory: metrics ? metrics.territory : 0,
    day: state.calendar.day,
    clock: formatClock(state.calendar),
    speed: state.clock.speed,
  };
}

// A group standing at a settlement: not heading anywhere and within AT_SETTLEMENT pixels of its centre.
export const AT_SETTLEMENT = 30;
const SETTLED = 1;

export function isIdle(group) {
  const mv = group.movement;
  return !mv.route && Math.hypot(mv.targetX - group.worldPosition.x, mv.targetY - group.worldPosition.y) <= SETTLED;
}

export function settlementUnderGroup(state, world, groupId) {
  const group = groupId ? state.world.mobileGroups[groupId] : null;
  if (!group || !isIdle(group)) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const node of world.nodes) {
    if (!state.world.settlements[node.id]) continue;
    const distance = Math.hypot(node.x - group.worldPosition.x, node.y - group.worldPosition.y);
    if (distance <= Math.max(AT_SETTLEMENT, node.radius) && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

// The sentence for a movement event ({ type: 'arrived' | 'blocked', ... }) from stepMovement.
export function describeMoveEvent(event, world) {
  if (event.type === 'arrived') {
    const node = event.nodeId ? world.nodeById.get(event.nodeId) : null;
    return node ? `${node.name}에 도착했습니다.` : '목적지에 도착했습니다.';
  }
  if (event.type === 'blocked') {
    const place = event.terrainName ? `${event.terrainName} 지형` : '지나갈 수 없는 지형';
    return `${place}이(가) 길을 막아 더 갈 수 없습니다. 이동을 멈췄습니다.`;
  }
  return '';
}

// The sentence after a successful order; `result` is what transact returned for orderGroupTo.
export function describeOrder(result, world, nodeId) {
  if (nodeId !== undefined) {
    const name = world.nodeById.get(nodeId)?.name ?? nodeId;
    if (result.mode === 'road') return `${name}(으)로 도로를 따라 이동합니다.`;
    return `${name}(으)로 직선으로 이동합니다. 쓸 수 있는 도로 경로가 없습니다.`;
  }
  return '지정한 위치로 이동합니다.';
}
