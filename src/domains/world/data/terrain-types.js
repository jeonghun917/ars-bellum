// The world-map terrain catalog (W_TerrainTypes.js): a cell is a base terrain, optionally with a
// route laid over it (road, mountain pass, bridge) and features (oasis). Values are unchanged from
// the earlier version; tests compare the computed travel profiles against that version's output.
// This is not the battle terrain (TerrainTypes.js), which is a different catalog.
import { deepFreeze } from '../../../core/data.js';

const base = (id, name, passable, speedMult, foodMult, visibilityMult, ambushRisk, canCamp, battleTags) => (
  { id, name, passable, speedMult, foodMult, visibilityMult, ambushRisk, canCamp, battleTags }
);

export const BASE_TYPES = deepFreeze({
  plain: base('plain', '평원', true, 1.0, 1.0, 1.0, 0.05, true, ['plain']),
  forest: base('forest', '숲', true, 0.65, 1.15, 0.6, 0.35, true, ['forest', 'dense_cover']),
  hill: base('hill', '구릉', true, 0.8, 1.1, 1.2, 0.15, true, ['hill', 'elevation']),
  highland: base('highland', '고원', true, 0.7, 1.2, 1.3, 0.12, true, ['highland', 'rocky', 'elevation']),
  mountain: base('mountain', '산맥', false, 0, 1.7, 1.4, 0.2, false, ['mountain', 'cliff', 'rocky']),
  snow: base('snow', '설원', true, 0.6, 1.45, 1.1, 0.1, true, ['snow', 'cold']),
  desert: base('desert', '사막', true, 0.72, 1.65, 1.35, 0.08, true, ['desert', 'open_ground', 'heat']),
  marsh: base('marsh', '습지', true, 0.45, 1.3, 0.7, 0.3, false, ['marsh', 'mud', 'shallow_water']),
  river: base('river', '강', false, 0, 1.2, 1.0, 0.12, false, ['river', 'water_crossing']),
  sea: base('sea', '바다', false, 0, 1.0, 1.5, 0.0, false, ['sea']),
});

// A route is added on top of the base terrain and may only lie on the bases it allows.
// passableOverride true lets a pass or bridge cross an otherwise impassable base.
export const ROUTE_TYPES = deepFreeze({
  road: {
    id: 'road',
    name: '도로',
    allowedBaseIds: ['plain', 'forest', 'hill', 'highland', 'snow', 'desert', 'marsh'],
    passableOverride: null,
    speedMult: 1.28,
    foodMult: 0.88,
    visibilityMult: 1.1,
    ambushRiskAdd: -0.05,
    battleTags: ['road'],
  },
  mountain_pass: {
    id: 'mountain_pass',
    name: '산길',
    allowedBaseIds: ['hill', 'highland', 'mountain', 'snow'],
    passableOverride: true,
    speedMult: 0.72,
    foodMult: 1.2,
    visibilityMult: 0.9,
    ambushRiskAdd: 0.12,
    battleTags: ['mountain_pass', 'narrow_route'],
  },
  bridge: {
    id: 'bridge',
    name: '다리',
    allowedBaseIds: ['river', 'marsh'],
    passableOverride: true,
    speedMult: 0.95,
    foodMult: 1.0,
    visibilityMult: 1.0,
    ambushRiskAdd: 0.08,
    battleTags: ['bridge', 'chokepoint'],
  },
});

export const FEATURE_TYPES = deepFreeze({
  oasis: {
    id: 'oasis',
    name: '오아시스',
    allowedBaseIds: ['desert'],
    speedMult: 1.0,
    foodMult: 0.65,
    visibilityMult: 1.0,
    ambushRiskAdd: -0.03,
    canCampOverride: true,
    restBonus: 1.5,
    battleTags: ['oasis', 'water_source', 'vegetation'],
  },
});

// Which route a road of a given road `type` puts on the ground; anything else is a plain road.
export const ROAD_TYPE_TO_ROUTE = deepFreeze({ mountain_pass: 'mountain_pass', bridge: 'bridge' });
