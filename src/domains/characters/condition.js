// Health, fatigue, injury and age: the condition of a character and how it weakens what they do.
import { clone, isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import { isInjury, isNumber } from './shape.js';
import { loadCharacter, touch } from './store.js';

export const DAYS_PER_YEAR = 365;
export const CONDITION_KEYS = Object.freeze(['health', 'fatigue', 'wounded', 'injuries', 'incapacitated']);
const AGE_PENALTY_START = 60;
const AGE_PENALTY_PER_YEAR = 0.01;
const AGE_FACTOR_FLOOR = 0.5;
const INJURY_PENALTY_CAP = 0.75;
const INJURY_PENALTY_DIVISOR = 400;
const FATIGUE_DIVISOR = 150;
const FATIGUE_FACTOR_FLOOR = 0.25;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Age in years on `day` (or at death, for the dead).
export function getAge(character, day) {
  if (!isRecord(character) || !isRecord(character.identity)) return null;
  const end = character.identity.deathDay === null ? day : character.identity.deathDay;
  if (!isNumber(end)) return null;
  return Math.max(0, (end - character.identity.birthDay) / DAYS_PER_YEAR);
}

// Factors between 0 and 1 that scale what a character can do; `combined` is their product.
export function getModifiers(character, day) {
  const condition = character.condition;
  const age = getAge(character, day);
  const injuryTotal = condition.injuries.reduce((sum, injury) => sum + Math.max(0, injury.severity), 0);
  const injuryFactor = 1 - Math.min(INJURY_PENALTY_CAP, injuryTotal / INJURY_PENALTY_DIVISOR);
  const healthFactor = clamp(condition.health / 100, 0, 1);
  const fatigueFactor = clamp(1 - condition.fatigue / FATIGUE_DIVISOR, FATIGUE_FACTOR_FLOOR, 1);
  const ageFactor = age !== null && age > AGE_PENALTY_START ? Math.max(AGE_FACTOR_FLOOR, 1 - (age - AGE_PENALTY_START) * AGE_PENALTY_PER_YEAR) : 1;
  return { healthFactor, fatigueFactor, injuryFactor, ageFactor, combined: healthFactor * fatigueFactor * injuryFactor * ageFactor };
}

// Reads and checks a condition patch; returns the normalised fields to merge.
export function readConditionPatch(patch) {
  if (!isRecord(patch) || Object.keys(patch).length === 0) return fail('characters_invalid_condition_patch');
  for (const key of Object.keys(patch)) {
    if (!CONDITION_KEYS.includes(key)) return fail('characters_unknown_condition_field', { key });
  }
  const next = {};
  for (const key of ['health', 'fatigue']) {
    if (patch[key] === undefined) continue;
    if (!isNumber(patch[key])) return fail(`characters_invalid_${key}`);
    next[key] = clamp(patch[key], 0, 100);
  }
  for (const key of ['wounded', 'incapacitated']) {
    if (patch[key] === undefined) continue;
    if (typeof patch[key] !== 'boolean') return fail(`characters_invalid_${key}`);
    next[key] = patch[key];
  }
  if (patch.injuries !== undefined) {
    if (!Array.isArray(patch.injuries) || !patch.injuries.every(isInjury)) return fail('characters_invalid_injuries');
    next.injuries = clone(patch.injuries);
  }
  return ok({ next });
}

// Merges a patch into a condition: health and fatigue are clamped to 0..100, a character with an
// injury counts as wounded, and one at zero health or full fatigue counts as incapacitated. Those two
// flags stay set until a patch clears them explicitly (and the cause is gone), as in the earlier version.
export function mergeCondition(current, next) {
  const merged = { ...clone(current), ...clone(next) };
  merged.wounded = merged.wounded || merged.injuries.length > 0;
  merged.incapacitated = merged.incapacitated || merged.health <= 0 || merged.fatigue >= 100;
  return merged;
}

// Changes health, fatigue, wounded, injuries or incapacitated.
export function setCondition(draft, input) {
  if (!isRecord(input)) return fail('characters_invalid_input');
  const found = loadCharacter(draft, input.characterId, input.expectedRevision);
  if (!found.ok) return found;
  const read = readConditionPatch(input.patch);
  if (!read.ok) return read;
  const { character } = found;
  const merged = mergeCondition(character.condition, read.next);
  if (JSON.stringify(merged) === JSON.stringify(character.condition)) return ok({ changed: false });
  character.condition = merged;
  touch(character);
  return ok({ changed: true, condition: clone(merged) });
}
