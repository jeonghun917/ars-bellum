// Static facts about the world map and its regions. Frozen: nothing at run time edits them.
import { deepFreeze } from '../../../core/data.js';

export const MAP = deepFreeze({
  id: 'ars_bellum_world_v1',
  name: '아르스 벨룸 대륙',
  width: 4096,
  height: 4096,
  tileFolder: 'map_tiles',
  tileRows: 4,
  tileCols: 4,
  tileSize: 1024,
});

export const REGIONS = deepFreeze([
  {
    id: 'central_valley',
    name: '중앙 대하곡',
    settlementIds: ['test_castle', 'test_city', 'test_village'],
    tags: ['river', 'mountain_valley', 'fertile'],
  },
]);
