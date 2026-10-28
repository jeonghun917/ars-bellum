// The battle's only source of randomness: the seeded generator from src/core/rng.js.
// Two separate streams are used so that drawing visual effects can never change a fight:
// the simulation stream decides outcomes, the cosmetic stream only feeds the renderer.
import { nextRandom } from '../../core/rng.js';

export function normalizeSeed(seed) {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new TypeError('battle2d: seed must be an integer');
  }
  return Math.trunc(seed) >>> 0;
}

export function createRandom(seed) {
  let state = normalizeSeed(seed);
  return {
    next() {
      const drawn = nextRandom(state);
      state = drawn.state;
      return drawn.value;
    },
    getState() {
      return state;
    },
  };
}

// Same seed, different stream: the constant is arbitrary but fixed.
export function createCosmeticRandom(seed) {
  return createRandom((normalizeSeed(seed) ^ 0x9e3779b9) >>> 0);
}
