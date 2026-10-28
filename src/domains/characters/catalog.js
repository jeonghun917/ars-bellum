// The built-in character definitions: aptitudes, skills, growth sources and derived ratings.
// Approved custom definitions in world.customDefinitions add to them. The lists of skill and
// aptitude ids come from the new-game state, so there is one place that says which exist.
import { APTITUDE_IDS, SKILL_IDS } from '../../game/new-game.js';
import { registerDefinitionDomain } from '../definitions/index.js';

export const GROWTH_SOURCE_IDS = Object.freeze(['action', 'education', 'event', 'role']);

// Which aptitude speeds up learning of each built-in skill.
export const SKILL_APTITUDE = Object.freeze({
  one_handed: 'combat', two_handed: 'combat', polearm: 'combat', bow: 'combat', crossbow: 'combat', throwing: 'combat',
  riding: 'mobility', athletics: 'mobility',
  command: 'command', tactics: 'command', scouting: 'command',
  logistics: 'administration', stewardship: 'administration', trade: 'administration',
  leadership: 'social', charm: 'social', diplomacy: 'social', intrigue: 'social',
  medicine: 'scholarship', engineering: 'scholarship', learning: 'scholarship',
});

export const DERIVED_RATINGS = Object.freeze([
  { id: 'combat_rating', weights: { one_handed: 0.15, two_handed: 0.15, polearm: 0.1, bow: 0.1, crossbow: 0.1, throwing: 0.05, riding: 0.15, athletics: 0.2 } },
  { id: 'command_rating', weights: { command: 0.35, tactics: 0.3, scouting: 0.15, logistics: 0.2 } },
  { id: 'administration_rating', weights: { stewardship: 0.45, trade: 0.25, logistics: 0.15, engineering: 0.15 } },
  { id: 'social_rating', weights: { leadership: 0.25, charm: 0.25, diplomacy: 0.3, intrigue: 0.2 } },
  { id: 'scholarship_rating', weights: { medicine: 0.3, engineering: 0.3, learning: 0.4 } },
]);

export const DEFAULT_SKILL_MAX_LEVEL = 100;
export const DEFAULT_APTITUDE_VALUE = 1;

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const optionalNumber = (value) => value === undefined || value === null || isNumber(value);

for (const id of SKILL_IDS) {
  if (!SKILL_APTITUDE[id]) throw new Error(`skill without an aptitude: ${id}`);
}

registerDefinitionDomain('aptitude', {
  validate: (data) => (optionalNumber(data.defaultValue) ? [] : ['invalid_default_value']),
  defaults: APTITUDE_IDS.map((id) => ({ id, name: id, defaultValue: DEFAULT_APTITUDE_VALUE })),
});

registerDefinitionDomain('skill', {
  validate(data, lookup) {
    const problems = [];
    if (typeof data.aptitudeDefinitionId !== 'string' || !lookup.has('aptitude', data.aptitudeDefinitionId)) problems.push('missing_aptitude_reference');
    if (!optionalNumber(data.defaultLevel)) problems.push('invalid_default_level');
    if (!optionalNumber(data.maxLevel) || (data.maxLevel !== undefined && data.maxLevel !== null && data.maxLevel <= 0)) problems.push('invalid_max_level');
    const max = isNumber(data.maxLevel) ? data.maxLevel : DEFAULT_SKILL_MAX_LEVEL;
    if (isNumber(data.defaultLevel) && (data.defaultLevel < 0 || data.defaultLevel > max)) problems.push('invalid_default_level');
    return problems;
  },
  defaults: SKILL_IDS.map((id) => ({ id, name: id, aptitudeDefinitionId: SKILL_APTITUDE[id], defaultLevel: 0, maxLevel: DEFAULT_SKILL_MAX_LEVEL })),
});

registerDefinitionDomain('growth_source', {
  validate: (data) => (optionalNumber(data.baseMultiplier) && !(isNumber(data.baseMultiplier) && data.baseMultiplier <= 0) ? [] : ['invalid_base_multiplier']),
  defaults: GROWTH_SOURCE_IDS.map((id) => ({ id, name: id, baseMultiplier: 1 })),
});

registerDefinitionDomain('derived_rating', {
  validate(data, lookup) {
    const problems = [];
    const weights = data.weights;
    if (weights === null || typeof weights !== 'object' || Array.isArray(weights) || Object.keys(weights).length === 0) {
      return ['invalid_weights'];
    }
    for (const [skillId, weight] of Object.entries(weights)) {
      if (!lookup.has('skill', skillId)) problems.push(`missing_skill_reference:${skillId}`);
      if (!isNumber(weight) || weight < 0) problems.push(`invalid_weight:${skillId}`);
    }
    return problems;
  },
  defaults: DERIVED_RATINGS.map((rating) => ({ id: rating.id, name: rating.id, weights: { ...rating.weights } })),
});
