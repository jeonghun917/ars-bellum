// Save/load checks for playerControl, from the earlier version's validator and the save validator's
// reference checks. Designated successors who have died since are allowed (removeDeadSuccessors
// drops them), so a death never makes a saved game invalid.
import { isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import { isStoredId } from '../definitions/index.js';
import { CONTROL_STATUSES, CONTROL_VERSION } from './rules.js';

const isIdList = (value) => Array.isArray(value) && value.every(isStoredId) && new Set(value).size === value.length;

export function checkControl(state) {
  const control = state.playerControl;
  if (!isRecord(control)) return fail('control_invalid_root');
  if (control.version !== CONTROL_VERSION) return fail('control_unsupported_version', { version: control.version });
  const problems = [];
  const need = (condition, code) => { if (!condition) problems.push(code); };
  need(Number.isInteger(control.revision) && control.revision >= 0, 'invalid_revision');
  need(CONTROL_STATUSES.includes(control.controlStatus), 'invalid_control_status');
  need(isIdList(control.designatedSuccessorIds), 'invalid_successor_ids');
  need(isIdList(control.permanentlyReleasedCharacterIds), 'invalid_released_ids');
  need(control.currentCharacterId === null || isStoredId(control.currentCharacterId), 'invalid_current_character');
  need(control.campaignClanId === null || isStoredId(control.campaignClanId), 'invalid_campaign_clan');
  if (problems.length) return fail('control_invalid', problems);

  const characters = state.world.characters;
  const released = control.permanentlyReleasedCharacterIds;
  const current = control.currentCharacterId;
  if (control.controlStatus === 'unbound') need(current === null, 'invalid_control_character');
  if (control.controlStatus === 'active') {
    need(current !== null, 'missing_control_character');
    need(!released.includes(current), 'released_character_reselected');
  }
  // An ended campaign has no current character, or keeps the last one played (always a released one).
  if (control.controlStatus === 'ended') need(current === null || released.includes(current), 'invalid_control_character');
  if (current !== null) need(isRecord(characters[current]), 'missing_control_character');
  for (const id of released) need(isRecord(characters[id]), `missing_released:${id}`);
  for (const id of control.designatedSuccessorIds) {
    need(isRecord(characters[id]), `missing_successor:${id}`);
    need(!released.includes(id), `released_successor:${id}`);
    need(id !== current, `current_is_successor:${id}`);
  }
  if (control.campaignClanId !== null) need(Object.hasOwn(state.world.clans, control.campaignClanId), 'missing_campaign_clan');
  return problems.length ? fail('control_invalid', problems) : ok();
}
