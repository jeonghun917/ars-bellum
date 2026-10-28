// Player control: which character the player plays, and the only ways that can change.
//
// The player plays one character at a time and switches only when that character dies, retires
// formally or abdicates. A character the player has left can never be played again. When there is
// no one to switch to, the campaign ends (with the player's approval).
//
// Note on "ended": the earlier version cleared the current character when a campaign ended, but the
// saved-state check requires the current character to exist, so here an ended campaign keeps the last
// character played as `currentCharacterId` (that character is in the released list).
import { clone, isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import { isStoredId } from '../definitions/index.js';

export const CONTROL_VERSION = 1;
export const CONTROL_STATUSES = Object.freeze(['unbound', 'active', 'ended']);
export const TRANSITION_CAUSES = Object.freeze(['death', 'retirement', 'abdication']);

const isCount = (value) => Number.isInteger(value) && value >= 0;
const isIdList = (value) => Array.isArray(value) && value.every(isStoredId) && new Set(value).size === value.length;

function loadControl(draft, expectedRevision) {
  if (expectedRevision !== undefined && !isCount(expectedRevision)) return fail('control_invalid_expected_revision');
  const control = draft.playerControl;
  if (expectedRevision !== undefined && control.revision !== expectedRevision) return fail('control_revision_conflict', { revision: control.revision });
  return ok({ control });
}

function character(draft, characterId) {
  if (!isStoredId(characterId) || !Object.hasOwn(draft.world.characters, characterId)) return null;
  return draft.world.characters[characterId];
}

// Can this character be played next: they exist, live, and have not been played and left before.
function candidateIssue(draft, control, characterId, released) {
  const candidate = character(draft, characterId);
  if (!candidate) return 'control_missing_character';
  if (!candidate.identity.alive || released.includes(characterId) || control.currentCharacterId === characterId) return 'control_ineligible_candidate';
  return null;
}

// The first character the player plays, for a campaign that has none yet (status "unbound").
// input: { characterId, campaignClanId?, expectedRevision? }
export function bindInitialCharacter(draft, input) {
  if (!isRecord(input)) return fail('control_invalid_input');
  const found = loadControl(draft, input.expectedRevision);
  if (!found.ok) return found;
  const { control } = found;
  if (control.controlStatus !== 'unbound') return fail('control_invalid_transition', { controlStatus: control.controlStatus });
  const issue = candidateIssue(draft, control, input.characterId, control.permanentlyReleasedCharacterIds);
  if (issue) return fail(issue, { characterId: input.characterId });
  const clanId = input.campaignClanId === undefined ? null : input.campaignClanId;
  if (clanId !== null && (!isStoredId(clanId) || !Object.hasOwn(draft.world.clans, clanId))) return fail('control_missing_clan', { clanId });
  control.currentCharacterId = input.characterId;
  control.controlStatus = 'active';
  control.campaignClanId = clanId;
  control.designatedSuccessorIds = control.designatedSuccessorIds.filter((id) => id !== input.characterId);
  control.revision += 1;
  return ok({ currentCharacterId: control.currentCharacterId });
}

function checkCause(draft, control, input) {
  const current = character(draft, control.currentCharacterId);
  if (!current) return fail('control_missing_character', { characterId: control.currentCharacterId });
  if (input.cause === 'death') {
    if (current.identity.alive || current.identity.deathDay === null) return fail('control_character_not_dead');
    return ok();
  }
  if (!current.identity.alive) return fail('control_character_dead');
  if (!isStoredId(input.voluntaryDecisionId)) return fail('control_decision_required');
  if (input.cause === 'retirement' && input.retirementApproved !== true) return fail('control_retirement_not_approved');
  if (input.cause === 'abdication') {
    if (input.abdicationApproved !== true) return fail('control_abdication_not_approved');
    if (!isIdList(input.abdicatedRefIds) || input.abdicatedRefIds.length === 0) return fail('control_abdication_nothing_given_up');
  }
  return ok();
}

// Switches to another character, or ends the campaign, after the current one dies, retires or abdicates.
// input: { cause: 'death' | 'retirement' | 'abdication', nextCharacterId?, endCampaignApproved?,
//          voluntaryDecisionId (retirement, abdication), retirementApproved, abdicationApproved, abdicatedRefIds,
//          expectedRevision? }
// With no nextCharacterId the campaign ends, and endCampaignApproved must be true.
export function transitionControl(draft, input) {
  if (!isRecord(input)) return fail('control_invalid_input');
  const found = loadControl(draft, input.expectedRevision);
  if (!found.ok) return found;
  const { control } = found;
  if (control.controlStatus !== 'active') return fail('control_invalid_transition', { controlStatus: control.controlStatus });
  if (!TRANSITION_CAUSES.includes(input.cause)) return fail('control_invalid_cause');
  const cause = checkCause(draft, control, input);
  if (!cause.ok) return cause;
  const released = [...new Set([...control.permanentlyReleasedCharacterIds, control.currentCharacterId])];
  const nextId = input.nextCharacterId === undefined ? null : input.nextCharacterId;
  if (nextId === null) {
    if (input.endCampaignApproved !== true) return fail('control_no_eligible_candidate');
  } else {
    const issue = candidateIssue(draft, control, nextId, released);
    if (issue) return fail(issue, { characterId: nextId });
  }
  control.permanentlyReleasedCharacterIds = released;
  if (nextId === null) {
    control.controlStatus = 'ended';
  } else {
    control.currentCharacterId = nextId;
  }
  control.designatedSuccessorIds = control.designatedSuccessorIds.filter((id) => id !== nextId && !released.includes(id));
  control.revision += 1;
  return ok({ currentCharacterId: control.currentCharacterId, controlStatus: control.controlStatus });
}

// Ends the campaign by the player's decision while the current character is alive and in play.
// input: { decisionId, expectedRevision? }
export function endCampaign(draft, input) {
  if (!isRecord(input)) return fail('control_invalid_input');
  const found = loadControl(draft, input.expectedRevision);
  if (!found.ok) return found;
  const { control } = found;
  if (control.controlStatus !== 'active') return fail('control_invalid_transition', { controlStatus: control.controlStatus });
  if (!isStoredId(input.decisionId)) return fail('control_decision_required');
  control.permanentlyReleasedCharacterIds = [...new Set([...control.permanentlyReleasedCharacterIds, control.currentCharacterId])];
  control.designatedSuccessorIds = control.designatedSuccessorIds.filter((id) => !control.permanentlyReleasedCharacterIds.includes(id));
  control.controlStatus = 'ended';
  control.revision += 1;
  return ok({ controlStatus: 'ended' });
}

// Chooses the clan the campaign is played for.
// input: { clanId, decisionId, expectedRevision? }
export function setCampaignClan(draft, input) {
  if (!isRecord(input)) return fail('control_invalid_input');
  const found = loadControl(draft, input.expectedRevision);
  if (!found.ok) return found;
  const { control } = found;
  if (control.controlStatus !== 'active') return fail('control_invalid_transition', { controlStatus: control.controlStatus });
  if (!isStoredId(input.decisionId)) return fail('control_decision_required');
  if (!isStoredId(input.clanId) || !Object.hasOwn(draft.world.clans, input.clanId)) return fail('control_missing_clan', { clanId: input.clanId });
  if (control.campaignClanId === input.clanId) return ok({ changed: false });
  control.campaignClanId = input.clanId;
  control.revision += 1;
  return ok({ changed: true });
}

// Replaces the list of characters the player wants to take over next, in order of preference.
// Each must exist, be alive, not be the current character and not have been played before.
// input: { characterIds, expectedRevision? }
export function setSuccessors(draft, input) {
  if (!isRecord(input)) return fail('control_invalid_input');
  const found = loadControl(draft, input.expectedRevision);
  if (!found.ok) return found;
  const { control } = found;
  if (control.controlStatus === 'ended') return fail('control_invalid_transition', { controlStatus: control.controlStatus });
  if (!isIdList(input.characterIds)) return fail('control_invalid_successors');
  for (const characterId of input.characterIds) {
    const issue = candidateIssue(draft, control, characterId, control.permanentlyReleasedCharacterIds);
    if (issue) return fail(issue, { characterId });
  }
  if (JSON.stringify(control.designatedSuccessorIds) === JSON.stringify(input.characterIds)) return ok({ changed: false });
  control.designatedSuccessorIds = [...input.characterIds];
  control.revision += 1;
  return ok({ changed: true });
}

// Drops designated successors who have died since they were chosen.
export function removeDeadSuccessors(draft, input = {}) {
  if (!isRecord(input)) return fail('control_invalid_input');
  const found = loadControl(draft, input.expectedRevision);
  if (!found.ok) return found;
  const { control } = found;
  const living = control.designatedSuccessorIds.filter((id) => character(draft, id)?.identity.alive === true);
  const removed = control.designatedSuccessorIds.filter((id) => !living.includes(id));
  if (!removed.length) return ok({ removed });
  control.designatedSuccessorIds = living;
  control.revision += 1;
  return ok({ removed });
}

// ---- reading -------------------------------------------------------------------------------

export const getPlayerControl = (state) => clone(state.playerControl);

// The character the player plays now (null when the campaign has ended).
export function getCurrentCharacterId(state) {
  return state.playerControl.controlStatus === 'active' ? state.playerControl.currentCharacterId : null;
}

export const isPlayerCharacter = (state, characterId) => getCurrentCharacterId(state) === characterId;
