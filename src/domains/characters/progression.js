// Experience and skill levels, and the ratings derived from skills.
//
// Experience is added to a skill; every full XP_PER_LEVEL points of a skill's experience raise its
// level by one, up to the skill's maximum. How much a gain is worth depends on how hard the task was,
// how often the same thing was done before (repetition), whether it succeeded, the character's
// aptitude for the skill, and the growth source's own multiplier.
import { clone, isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import { getDefinition, isStoredRef, listDefinitionIds } from '../definitions/index.js';
import { DEFAULT_APTITUDE_VALUE, DEFAULT_SKILL_MAX_LEVEL } from './catalog.js';
import { getModifiers } from './condition.js';
import { isCount, isNumber } from './shape.js';
import { loadCharacter, touch } from './store.js';

export const XP_PER_LEVEL = 100;
export const MIN_DIFFICULTY = 0.1;
export const MIN_APTITUDE_FACTOR = 0.1;
export const REPETITION_PENALTY = 0.25;
export const FAILURE_FACTOR = 0.35;
export const MAX_REPETITION_KEY_LENGTH = 120;

export function repetitionFactor(repeats) {
  return 1 / (1 + Math.max(0, repeats) * REPETITION_PENALTY);
}

function readGain(input, today) {
  if (!isRecord(input)) return fail('characters_invalid_input');
  const sourceTypeId = input.sourceTypeId === undefined ? 'action' : input.sourceTypeId;
  const difficulty = input.difficulty === undefined ? 1 : input.difficulty;
  const day = input.day === undefined ? today : input.day;
  const sourceRef = input.sourceRef === undefined ? null : input.sourceRef;
  const tags = input.tags === undefined ? [] : input.tags;
  const customData = input.customData === undefined ? {} : input.customData;
  const repetitionKey = input.repetitionKey === undefined ? null : input.repetitionKey;
  if (typeof input.skillId !== 'string' || typeof sourceTypeId !== 'string') return fail('characters_invalid_input');
  if (!isNumber(input.amount) || input.amount <= 0) return fail('characters_invalid_experience_amount');
  if (!isNumber(difficulty)) return fail('characters_invalid_difficulty');
  if (input.success !== undefined && typeof input.success !== 'boolean') return fail('characters_invalid_input');
  if (!isCount(day)) return fail('characters_invalid_day');
  if (sourceRef !== null && !isStoredRef(sourceRef)) return fail('characters_invalid_source_ref');
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string' && tag.length > 0 && tag.length <= 60)) return fail('characters_invalid_tags');
  if (!isRecord(customData)) return fail('characters_invalid_custom_data');
  if (repetitionKey !== null && (typeof repetitionKey !== 'string' || repetitionKey.length === 0 || repetitionKey.length > MAX_REPETITION_KEY_LENGTH)) {
    return fail('characters_invalid_repetition_key');
  }
  return ok({
    skillId: input.skillId, sourceTypeId, amount: input.amount, difficulty, success: input.success !== false, day, sourceRef, tags, customData, repetitionKey,
  });
}

// Adds experience to a skill of a living character.
// input: { characterId, skillId, amount, sourceTypeId = 'action', difficulty = 1, success = true,
//          repetitionKey, day = today, sourceRef, tags, customData, expectedRevision }
export function gainExperience(draft, input) {
  if (!isRecord(input)) return fail('characters_invalid_input');
  const read = readGain(input, draft.calendar.day);
  if (!read.ok) return read;
  const found = loadCharacter(draft, input.characterId, input.expectedRevision);
  if (!found.ok) return found;
  const { character } = found;
  if (!character.identity.alive) return fail('characters_not_alive', { characterId: character.id });
  const gain = read;
  const skill = getDefinition(draft, 'skill', gain.skillId);
  if (!skill) return fail('characters_unknown_skill', { skillId: gain.skillId });
  const source = getDefinition(draft, 'growth_source', gain.sourceTypeId);
  if (!source) return fail('characters_unknown_growth_source', { sourceTypeId: gain.sourceTypeId });
  if (gain.difficulty < MIN_DIFFICULTY) return fail('characters_insufficient_difficulty');

  const progression = character.progression;
  const repeats = gain.repetitionKey === null ? 0 : progression.repetition[gain.repetitionKey] ?? 0;
  const aptitudeDefinition = getDefinition(draft, 'aptitude', skill.aptitudeDefinitionId);
  const aptitude = character.aptitudes[skill.aptitudeDefinitionId] ?? aptitudeDefinition?.defaultValue ?? DEFAULT_APTITUDE_VALUE;
  const amount = gain.amount * (source.baseMultiplier ?? 1) * gain.difficulty * repetitionFactor(repeats)
    * (gain.success ? 1 : FAILURE_FACTOR) * Math.max(MIN_APTITUDE_FACTOR, aptitude);

  const before = progression.skillExperience[gain.skillId] ?? 0;
  const after = before + amount;
  const levelsGained = Math.floor(after / XP_PER_LEVEL) - Math.floor(before / XP_PER_LEVEL);
  const maxLevel = skill.maxLevel ?? DEFAULT_SKILL_MAX_LEVEL;
  const level = Math.min(maxLevel, (character.skills[gain.skillId] ?? 0) + levelsGained);

  progression.skillExperience[gain.skillId] = after;
  progression.sourceTotals[gain.sourceTypeId] = (progression.sourceTotals[gain.sourceTypeId] ?? 0) + amount;
  character.skills[gain.skillId] = level;
  progression.records.push({
    sourceTypeId: gain.sourceTypeId,
    skillDefinitionId: gain.skillId,
    amount,
    day: gain.day,
    sourceRef: clone(gain.sourceRef),
    tags: [...gain.tags],
    customData: clone(gain.customData),
  });
  if (gain.repetitionKey !== null) progression.repetition[gain.repetitionKey] = repeats + 1;
  touch(character);
  return ok({ amount, level, levelsGained });
}

const fromSource = (sourceTypeId) => (draft, input) => (isRecord(input) ? gainExperience(draft, { ...input, sourceTypeId }) : fail('characters_invalid_input'));
export const gainFromAction = fromSource('action');
export const gainFromRole = fromSource('role');
export const gainFromEducation = fromSource('education');
export const gainFromEvent = fromSource('event');

// Each rating is the weighted average of the skills it lists, scaled by the character's condition.
export function getDerivedRatings(state, characterId, day) {
  const character = state.world.characters[characterId];
  if (!isRecord(character)) return null;
  const scale = getModifiers(character, day).combined;
  const ratings = {};
  for (const ratingId of listDefinitionIds(state, 'derived_rating')) {
    const weights = getDefinition(state, 'derived_rating', ratingId).weights;
    let total = 0;
    let weightSum = 0;
    for (const [skillId, weight] of Object.entries(weights)) {
      total += (character.skills[skillId] ?? 0) * weight;
      weightSum += weight;
    }
    ratings[ratingId] = (weightSum ? total / weightSum : 0) * scale;
  }
  return ratings;
}
