// Builds the two armies from a strength number or an explicit list of squad kinds.
import { SQUAD_KINDS } from './unit-stats.js';

export const MAX_SQUADS = 12;
export const STANDARD_SQUADS = 6;
export const MAX_SOLDIERS_PER_SQUAD = 12;

// The first six are the original army. Pikes and crossbows, which the old game offered buttons for
// but never fielded, join in the larger armies.
export const ROSTER_ORDER = Object.freeze([
  'shield', 'shock', 'archer', 'skirmisher', 'heavy_cav', 'light_cav',
  'pike', 'crossbow', 'shield', 'shock', 'archer', 'light_cav',
]);

// Where each squad stands at the start (ally side, x < 0). The enemy side mirrors x.
export const DEPLOY_SLOTS = Object.freeze([
  { x: -200, y: -50 }, { x: -200, y: 100 }, { x: -300, y: -50 }, { x: -300, y: 100 }, { x: -400, y: -100 }, { x: -400, y: 150 },
  { x: -200, y: -200 }, { x: -300, y: -200 }, { x: -200, y: 250 }, { x: -300, y: 250 }, { x: -400, y: -250 }, { x: -400, y: 300 },
]);

// strength 1 is the standard six squads; half is three, twice is twelve (the most there is room for).
export function rosterForStrength(strength) {
  const value = strength === undefined ? 1 : Number(strength);
  if (!Number.isFinite(value) || value < 0) throw new RangeError('battle2d: strength must be a number of 0 or more');
  const count = Math.min(MAX_SQUADS, Math.round(STANDARD_SQUADS * value));
  return ROSTER_ORDER.slice(0, count);
}

export function validateRoster(roster) {
  if (!Array.isArray(roster) || roster.length > MAX_SQUADS) {
    throw new RangeError(`battle2d: a squad list holds at most ${MAX_SQUADS} squads`);
  }
  for (const subType of roster) {
    if (!SQUAD_KINDS[subType]) throw new RangeError(`battle2d: unknown squad kind "${subType}"`);
  }
  return roster;
}

export function squadSpecs(team, roster, soldiers = MAX_SOLDIERS_PER_SQUAD) {
  const prefix = team === 'ally' ? '아군' : '적군';
  const sign = team === 'ally' ? 1 : -1;
  return roster.map((subType, index) => ({
    id: `${team}-${index + 1}`,
    name: `${prefix} ${SQUAD_KINDS[subType].label}`,
    team,
    subType,
    x: DEPLOY_SLOTS[index].x * sign,
    y: DEPLOY_SLOTS[index].y,
    soldiers,
  }));
}
