// Where the battlefield's surroundings stand (the owner, 2026-11-07: the background, after his pictures of
// meadows: a lush meadow of long grass flowing in the wind under a blue sky, woods along the horizon, no
// fence). Only what is drawn: nothing here
// touches the battle, which is fought on flat ground (y = 0). Pure numbers, no drawing (M2_Scenery.js draws them),
// the same every load.
// - The play area (PLAY: where formations draw up, fight, and run to the retreat edges at z = ±18) stays flat;
//   only grass grows there.
// - Around it the meadow runs out flat to the woods on the horizon.

// Half-sizes (m) of the play area, kept clear.
export const PLAY = Object.freeze({ x: 40, z: 28 });
// Half-sizes of the flat ground: all of the meadow (the ground only dips and rises a little far off).
export const FLAT = Object.freeze({ x: 58, z: 44 });
// How far the drawn ground reaches.
export const GROUND_SIZE = 360;
// The square of long grass that the drawing keeps round the camera (M2_Scenery.js), and its cards of grass.
export const GRASS_TILE = 44;
export const GRASS_BLADES = 15000;

// A small seeded random generator (mulberry32): the same numbers every time for a seed.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The ground's height (m) at (x, z): flat over the meadow, a long low rise far off (under 2 m).
export function groundHeight(x, z) {
  const dx = Math.max(0, Math.abs(x) - FLAT.x);
  const dz = Math.max(0, Math.abs(z) - FLAT.z);
  const k = Math.min(1, Math.hypot(dx, dz) / 90);
  if (k === 0) return 0;
  return k * k * (1.2 + 0.6 * Math.sin(x * 0.02 + 0.7) * Math.cos(z * 0.025));
}

// Whether (x, z) is in the play area kept clear (with a margin of `margin` metres).
export function inPlayArea(x, z, margin = 0) {
  return Math.abs(x) < PLAY.x + margin && Math.abs(z) < PLAY.z + margin;
}

// Everything placed: { woods, trees, grass }.
// - woods: stretches of woodland along the horizon, each { x, z, width, height, facing } (a painted band facing
//   the field's middle).
// - trees: big single trees and clumps nearer the field, each { x, z, y, scale, kind } (kind: which painted tree).
// - grass: { count, seed }: how many cards of grass the grass square holds, and the seed that scatters them.
export function sceneryLayout(seed = 20261107) {
  const rnd = random(seed);
  const pick = (lo, hi) => lo + (hi - lo) * rnd();
  // The woods: a ring of overlapping bands round the horizon, nearer behind the enemy and on the right.
  const woods = [];
  for (let i = 0; i < 30; i += 1) {
    const a = (i / 30) * Math.PI * 2 + pick(-0.05, 0.05);
    const r = pick(135, 175) - (Math.sin(a) < -0.4 ? 20 : 0);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    woods.push({ x, z, y: groundHeight(x, z), width: pick(55, 85), height: pick(11, 17), facing: Math.atan2(-x, -z), kind: i % 3 });
  }
  // Big trees: a clump at the woods' edge on the left, a few standing alone in the meadow outside the play area.
  const trees = [];
  for (let i = 0; i < 6; i += 1) trees.push({ x: -96 + pick(-8, 8), z: -40 + i * 7 + pick(-2, 2), scale: pick(1.0, 1.4), kind: i % 3 });
  for (const [x, z] of [[72, -52], [-70, 58], [92, 36]]) trees.push({ x, z, scale: pick(0.9, 1.2), kind: Math.floor(pick(0, 3)) });
  for (const t of trees) t.y = groundHeight(t.x, t.z);
  const grass = Object.freeze({ count: GRASS_BLADES, seed: Math.floor(pick(1, 2147483646)) });
  return Object.freeze({ woods, trees, grass });
}
