// Where the battlefield's surroundings stand (the owner, 2026-11-07: the background). Only what is drawn: nothing
// here touches the battle, which is fought on flat ground (y = 0). Pure numbers, no drawing (M2_Scenery.js draws
// them), the same every load (a fixed seed).
// - The play area (PLAY: where formations draw up, fight, and run to the retreat edges at z = ±18) stays flat
//   and clear: only grass tufts and pebbles, too small to hide anyone.
// - Around it, still flat: woods on both flanks and behind the enemy's side (-z); behind the player's side (+z)
//   a dirt road with a fence, haystacks and a farmstead.
// - Further out the ground rises into low hills with scattered trees, a watchtower on one of them, and beyond
//   the haze a ring of mountains.

// Half-sizes (m) of the play area, kept clear.
export const PLAY = Object.freeze({ x: 40, z: 28 });
// Half-sizes of the flat ground around it; the hills rise beyond, over RISE metres.
export const FLAT = Object.freeze({ x: 62, z: 48 });
const RISE = 40;
// How far the drawn ground reaches.
export const GROUND_SIZE = 300;

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

const smooth = (t) => t * t * (3 - 2 * t);

// How far out of the flat ground (x, z) is: 0 inside it, rising to 1 at RISE metres beyond.
function outside(x, z) {
  const dx = Math.max(0, Math.abs(x) - FLAT.x);
  const dz = Math.max(0, Math.abs(z) - FLAT.z);
  return Math.min(1, Math.hypot(dx, dz) / RISE);
}

// The ground's height (m) at (x, z): 0 on the flat ground, rolling hills beyond (up to about 14 m).
export function groundHeight(x, z) {
  const k = smooth(outside(x, z));
  if (k === 0) return 0;
  const rolls = 6 + 4 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05 - 0.4) + 3 * Math.sin((x - z) * 0.021);
  return k * Math.max(1.5, rolls + 4 * k);
}

// Whether (x, z) is in the play area kept clear (with a margin of `margin` metres).
export function inPlayArea(x, z, margin = 0) {
  return Math.abs(x) < PLAY.x + margin && Math.abs(z) < PLAY.z + margin;
}

// The dirt road behind the player's side: a gentle curve across the field at about z = 36.
export function roadZ(x) {
  return 36 + 3.5 * Math.sin(x * 0.035) + 0.0012 * x * x;
}
export const ROAD_HALF_WIDTH = 2.2;

// Everything placed: { trees, bushes, rocks, tufts, haystacks, fence, houses, tower, mountains }, each a list of
// { x, z, y, scale, turn, kind }. kind: a tree's kind ("pine", "oak"), a house's ("house", "barn").
export function sceneryLayout(seed = 20261107) {
  const rnd = random(seed);
  const pick = (lo, hi) => lo + (hi - lo) * rnd();
  const place = (x, z, scale, kind) => ({ x, z, y: groundHeight(x, z), scale, turn: pick(0, Math.PI * 2), kind });
  const clearOfRoad = (x, z, gap) => Math.abs(z - roadZ(x)) > ROAD_HALF_WIDTH + gap;
  const trees = [];
  // Woods: clumps along the flanks and behind the enemy's side, thicker further out.
  const woods = [
    { x: -58, z: -6, rx: 14, rz: 34, n: 70 }, { x: 58, z: 4, rx: 14, rz: 34, n: 70 },
    { x: -10, z: -50, rx: 46, rz: 9, n: 80 }, { x: 46, z: -46, rx: 16, rz: 10, n: 30 },
    { x: -78, z: 40, rx: 12, rz: 10, n: 22 }, { x: 84, z: 46, rx: 14, rz: 9, n: 22 }
  ];
  for (const wood of woods) {
    for (let i = 0; i < wood.n; i += 1) {
      // Denser towards a clump's middle.
      const a = pick(0, Math.PI * 2);
      const r = Math.sqrt(rnd());
      const x = wood.x + Math.cos(a) * wood.rx * r;
      const z = wood.z + Math.sin(a) * wood.rz * r;
      if (inPlayArea(x, z, 4) || !clearOfRoad(x, z, 2)) continue;
      trees.push(place(x, z, pick(0.8, 1.35), rnd() < 0.55 ? "pine" : "oak"));
    }
  }
  // Scattered trees on the hills.
  for (let i = 0; i < 160; i += 1) {
    const x = pick(-140, 140);
    const z = pick(-140, 140);
    if (outside(x, z) < 0.15 || rnd() < 0.35 || !clearOfRoad(x, z, 2)) continue;
    trees.push(place(x, z, pick(0.9, 1.5), rnd() < 0.6 ? "pine" : "oak"));
  }
  // Bushes along the wood edges and the road; rocks here and there outside the play area.
  const bushes = [];
  for (let i = 0; i < 140; i += 1) {
    const x = pick(-90, 90);
    const z = pick(-70, 70);
    if (inPlayArea(x, z, 2) || !clearOfRoad(x, z, 0.8)) continue;
    bushes.push(place(x, z, pick(0.6, 1.3)));
  }
  const rocks = [];
  for (let i = 0; i < 70; i += 1) {
    const x = pick(-110, 110);
    const z = pick(-100, 100);
    if (inPlayArea(x, z, 2) || !clearOfRoad(x, z, 0.5)) continue;
    rocks.push(place(x, z, pick(0.4, 1.6)));
  }
  // Grass tufts everywhere on the flat ground (the play area too: they hide nothing).
  const tufts = [];
  for (let i = 0; i < 2600; i += 1) {
    const x = pick(-FLAT.x, FLAT.x);
    const z = pick(-FLAT.z, FLAT.z);
    if (!clearOfRoad(x, z, 0.2)) continue;
    tufts.push(place(x, z, pick(0.6, 1.4)));
  }
  // Behind the player's side, beyond the road: a farmstead, haystacks in a mown field, a fence along the road.
  const houses = [
    { ...place(-20, 52, 1, "house"), turn: 0.15 }, { ...place(-11, 55, 1.1, "barn"), turn: -0.1 },
    { ...place(-26, 58, 0.9, "house"), turn: 0.5 }
  ];
  const haystacks = [];
  for (let i = 0; i < 9; i += 1) haystacks.push(place(14 + (i % 3) * 7 + pick(-1.5, 1.5), 46 + Math.floor(i / 3) * 5 + pick(-1, 1), pick(0.85, 1.15)));
  const fence = [];
  for (let x = -60; x <= 60; x += 3) {
    if (x > -6 && x < 6) continue; // (a gap where the farm track meets the road)
    const z = roadZ(x) + ROAD_HALF_WIDTH + 1.2;
    const z2 = roadZ(x + 3) + ROAD_HALF_WIDTH + 1.2;
    fence.push({ x, z, y: 0, scale: 1, turn: Math.atan2(3, z2 - z), kind: "rail" });
  }
  // A watchtower on a hill behind the enemy's side.
  const tower = place(-34, -96, 1, "tower");
  // Mountains: a ring beyond the haze.
  const mountains = [];
  for (let i = 0; i < 26; i += 1) {
    const a = (i / 26) * Math.PI * 2 + pick(-0.08, 0.08);
    const r = pick(190, 225);
    mountains.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: 0, scale: pick(0.7, 1.4), turn: pick(0, Math.PI * 2), kind: "mountain", height: pick(28, 62) });
  }
  return Object.freeze({ trees, bushes, rocks, tufts, houses, haystacks, fence, tower, mountains });
}
