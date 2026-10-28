// The two test roads of the earlier version (W_Data.js). `type` decides which route type the road
// puts on the ground ("main_road" -> road, "mountain_pass", "bridge"). `waypoints` are the bends
// between the two settlements, listed from `fromSettlementId` towards `toSettlementId`.
import { deepFreeze } from '../../../core/data.js';

export const ROADS = deepFreeze([
  {
    id: 'road_castle_city',
    name: '서부 성채로',
    fromSettlementId: 'test_castle',
    toSettlementId: 'test_city',
    type: 'main_road',
    enabled: true,
    movementMultiplier: 1.25,
    danger: 10,
    waypoints: [],
  },
  {
    id: 'road_city_village',
    name: '동부 곡창로',
    fromSettlementId: 'test_city',
    toSettlementId: 'test_village',
    type: 'main_road',
    enabled: true,
    movementMultiplier: 1.25,
    danger: 15,
    waypoints: [],
  },
]);
