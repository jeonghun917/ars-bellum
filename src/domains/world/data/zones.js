// Terrain zones: shapes that override the default (everything is plain). The real map has none yet.
// Higher priority is applied later and so wins; equal priority keeps list order.
import { deepFreeze } from '../../../core/data.js';

export const ZONES = deepFreeze([]);

// The earlier version's test terrain (W_Terrain.js enableTestMode), far south of the playable
// area: a forest, a mountain, a river and a bridge over the river. Not part of the default world;
// pass it to createWorld({ zones }) to try blocked terrain.
export const TEST_ZONES = deepFreeze([
  { id: 'test_forest', name: '시험용 숲', priority: 10, baseId: 'forest', shape: { type: 'circle', x: 3000, y: 3300, radius: 260 } },
  { id: 'test_mountain', name: '시험용 산맥', priority: 10, baseId: 'mountain', shape: { type: 'rect', x: 3400, y: 2950, width: 360, height: 620 } },
  { id: 'test_river', name: '시험용 강', priority: 20, baseId: 'river', shape: { type: 'rect', x: 2450, y: 3600, width: 760, height: 80 } },
  { id: 'test_bridge', name: '시험용 다리', priority: 30, routeId: 'bridge', shape: { type: 'rect', x: 2810, y: 3570, width: 100, height: 140 } },
]);
