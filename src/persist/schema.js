// Checks the top level of a saved/loaded game state. Each game area adds its own record checks
// through registerAreaCheck as it is rewritten, so validation lives next to the code that owns it.
import { isRecord } from '../core/data.js';
import { ok, fail } from '../core/result.js';
import { SCHEMA_VERSION } from '../game/new-game.js';

const WORLD_AREAS = [
  'characters', 'mobileGroups', 'inventories', 'finance', 'clans', 'factions', 'titles', 'landRights', 'settlements',
  'customDefinitions', 'relationships', 'memories', 'npcActivityProfiles', 'm1Followups',
];
const areaChecks = new Map();

export function registerAreaCheck(name, check) { areaChecks.set(name, check); }

const isDay = (n) => Number.isInteger(n) && n >= 1;
const isCount = (n) => Number.isInteger(n) && n >= 0;

export function validateState(state) {
  const issues = [];
  const need = (condition, path) => { if (!condition) issues.push(path); };
  need(isRecord(state), '$');
  if (!issues.length) {
    need(state.schemaVersion === SCHEMA_VERSION, 'schemaVersion');
    need(isCount(state.revision), 'revision');
    need(typeof state.saveId === 'string' && state.saveId.length > 0, 'saveId');
    const c = state.calendar;
    need(isRecord(c) && isDay(c.day) && Number.isInteger(c.hour) && c.hour >= 0 && c.hour < 24 && Number.isInteger(c.minute) && c.minute >= 0 && c.minute < 60, 'calendar');
    need(isCount(state.lastProcessedDay) && (!isRecord(c) || state.lastProcessedDay < c.day), 'lastProcessedDay');
    need(isRecord(state.clock) && state.clock.speed >= 0 && state.clock.realMsPerGameMinute > 0, 'clock');
    need(isRecord(state.prefs) && state.prefs.worldScale > 0 && state.prefs.battleScale > 0, 'prefs');
    need(isRecord(state.rng) && Number.isInteger(state.rng.seed) && Number.isInteger(state.rng.state), 'rng');
    need(isRecord(state.playerControl) && typeof state.playerControl.currentCharacterId === 'string', 'playerControl');
    need(isRecord(state.world), 'world');
    need(isRecord(state.legacy), 'legacy');
    if (isRecord(state.world)) for (const area of WORLD_AREAS) need(isRecord(state.world[area]), `world.${area}`);
    if (!issues.length) {
      need(isRecord(state.world.characters[state.playerControl.currentCharacterId]), 'playerControl.currentCharacterId');
    }
  }
  if (!issues.length) {
    for (const [name, check] of areaChecks) {
      const result = check(state);
      if (!result.ok) issues.push(`${name}: ${result.error}${result.detail ? ` ${JSON.stringify(result.detail)}` : ''}`);
    }
  }
  return issues.length ? fail('state_invalid', issues) : ok();
}
