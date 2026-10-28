// Seeded random numbers (mulberry32). The generator state is a plain integer kept in game state,
// so the same seed and the same actions always give the same results, also after save and load.
export function nextRandom(state) {
  let t = (state + 0x6d2b79f5) >>> 0;
  let r = Math.imul(t ^ (t >>> 15), t | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return { value: ((r ^ (r >>> 14)) >>> 0) / 4294967296, state: t };
}

// Draws from a store draft's rng field and advances it: draw(draft.rng) -> number in [0, 1).
export function draw(rng) {
  const { value, state } = nextRandom(rng.state);
  rng.state = state;
  return value;
}

export function drawInt(rng, minInclusive, maxInclusive) {
  return minInclusive + Math.floor(draw(rng) * (maxInclusive - minInclusive + 1));
}

export const seedFrom = (number) => ({ seed: number >>> 0, state: number >>> 0 });
