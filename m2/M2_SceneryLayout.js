// Where the battlefield's surroundings stand (the owner, 2026-11-07: the background, after his three pictures of
// open meadows: wide bright grass under a big sky, a far tree line and a clump of trees, soft green hills fading
// into blue haze, cart tracks through the grass). Only what is drawn: nothing here touches the battle, which is
// fought on flat ground (y = 0). Pure numbers, no drawing (M2_Scenery.js draws them), the same every load.
// - The play area (PLAY: where formations draw up, fight, and run to the retreat edges at z = ±18) stays flat
//   and clear: only grass, too short to hide anyone.
// - Around it the meadow rolls gently away; trees stand only far off, as tree lines and clumps.
// - Beyond, soft rounded hills in the haze.

// Half-sizes (m) of the play area, kept clear.
export const PLAY = Object.freeze({ x: 40, z: 28 });
// Half-sizes of the flat ground around it; the meadow swells beyond, over RISE metres.
export const FLAT = Object.freeze({ x: 58, z: 44 });
const RISE = 70;
// How far the drawn ground reaches.
export const GROUND_SIZE = 360;

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

// The ground's height (m) at (x, z): 0 on the flat ground, long gentle swells beyond (up to about 9 m).
export function groundHeight(x, z) {
  const k = smooth(outside(x, z));
  if (k === 0) return 0;
  const swell = 4.5 + 3 * Math.sin(x * 0.018 + 0.7) * Math.cos(z * 0.022 - 0.3) + 1.5 * Math.sin((x + z) * 0.011);
  return k * swell;
}

// Whether (x, z) is in the play area kept clear (with a margin of `margin` metres).
export function inPlayArea(x, z, margin = 0) {
  return Math.abs(x) < PLAY.x + margin && Math.abs(z) < PLAY.z + margin;
}

// Cart tracks through the grass: two wheel ruts along a gentle curve, across the meadow behind the player's side
// and up the swell beyond the enemy's (colour on the ground only).
export function trackZ(x, which) {
  return which === 0 ? 50 + 6 * Math.sin(x * 0.02) + 0.0016 * x * x : -62 - 8 * Math.sin(x * 0.017 + 1) - 0.001 * x * x;
}
export const TRACK_GAP = 1.6;

// Everything placed: { trees, clumps, hills, tufts }, each a list of { x, z, y, scale, turn, kind }. kind: a
// tree's ("round", "tall"). hills: { x, z, radius, height }.
export function sceneryLayout(seed = 20261107) {
  const rnd = random(seed);
  const pick = (lo, hi) => lo + (hi - lo) * rnd();
  const place = (x, z, scale, kind) => ({ x, z, y: groundHeight(x, z), scale, turn: pick(0, Math.PI * 2), kind });
  const trees = [];
  // Far tree lines along the horizon (broken, so the sky shows between them), mostly round broadleaves.
  const lines = [
    { from: -170, to: -10, z: -150, n: 150 }, { from: 20, to: 180, z: -145, n: 140 },
    { from: -180, to: -40, z: 140, n: 110 }, { from: 40, to: 170, z: 150, n: 100 },
    { from: -60, to: 60, z: 175, n: 70, side: true }
  ];
  for (const line of lines) {
    for (let i = 0; i < line.n; i += 1) {
      const x = pick(line.from, line.to);
      const z = line.z + pick(-7, 7) + 10 * Math.sin(x * 0.03);
      trees.push(place(x, z, pick(1.0, 1.6), rnd() < 0.8 ? "round" : "tall"));
    }
  }
  // Clumps: a close one on the right flank, others further off.
  const clumps = [{ x: 78, z: -26, r: 13, n: 26 }, { x: -96, z: 18, r: 9, n: 14 }, { x: 120, z: 70, r: 10, n: 14 }];
  for (const clump of clumps) {
    for (let i = 0; i < clump.n; i += 1) {
      const a = pick(0, Math.PI * 2);
      const r = Math.sqrt(rnd()) * clump.r;
      trees.push(place(clump.x + Math.cos(a) * r, clump.z + Math.sin(a) * r * 0.7, pick(1.0, 1.7), rnd() < 0.75 ? "round" : "tall"));
    }
  }
  // Soft rounded hills in the haze: one large and near enough to read as a hill, others lower and further.
  const hills = [
    { x: -150, z: -230, radius: 110, height: 55 }, { x: 60, z: -260, radius: 140, height: 38 },
    { x: 250, z: -60, radius: 120, height: 32 }, { x: -260, z: 40, radius: 130, height: 36 },
    { x: 170, z: 230, radius: 120, height: 30 }, { x: -120, z: 260, radius: 140, height: 34 }
  ];
  // Long grass over all the meadow (the play area too: it hides nothing).
  // (Tufts over one tile, GRASS_TILE metres square, that the drawing wraps round the camera: M2_Scenery.js.)
  const tufts = [];
  for (let i = 0; i < 9000; i += 1) tufts.push({ x: pick(-22, 22), z: pick(-22, 22), y: 0, scale: pick(0.7, 1.4), turn: pick(0, Math.PI * 2) });
  return Object.freeze({ trees, hills, tufts, clumps });
}
