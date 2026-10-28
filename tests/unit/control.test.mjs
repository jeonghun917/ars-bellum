import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore } from '../../src/core/store.js';
import { clone } from '../../src/core/data.js';
import { newCharacter, newGameState, PLAYER_CHARACTER_ID } from '../../src/game/new-game.js';
import { validateState } from '../../src/persist/schema.js';
import { migrateV1Envelope } from '../../src/persist/migrate-v1.js';
import { recordDeath, updateProfile } from '../../src/domains/characters/index.js';
import { createGroup, setCommanders, unlinkCharacter } from '../../src/domains/groups/index.js';
import {
  CONTROL_STATUSES, TRANSITION_CAUSES, bindInitialCharacter, checkControl, endCampaign, getCurrentCharacterId, getPlayerControl, isPlayerCharacter,
  removeDeadSuccessors, setCampaignClan, setSuccessors, transitionControl,
} from '../../src/domains/control/index.js';

// The player plus an heir, a cousin and a nephew, all alive, and one clan.
const newStore = (edit = () => {}) => {
  const state = newGameState();
  state.world.clans.clan_a = { id: 'clan_a' };
  for (const id of ['heir', 'cousin', 'nephew']) state.world.characters[id] = newCharacter({ id, name: id });
  edit(state);
  return createStore(state, { validate: validateState });
};

// A rule that fails must say why and leave both the store and a plain draft exactly as they were.
function expectRejected(store, rule, code) {
  const before = store.getState();
  const result = store.transact('test', rule);
  assert.equal(result.ok, false, `expected ${code} but the rule succeeded`);
  assert.equal(result.error, code);
  assert.strictEqual(store.getState(), before);
  const draft = clone(before);
  assert.equal(rule(draft).ok, false);
  assert.deepEqual(draft, before);
}

const apply = (store, rule) => {
  const result = store.transact('test', rule);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
};

const control = (store) => store.getState().playerControl;
const kill = (store, characterId) => apply(store, (draft) => recordDeath(draft, { characterId }));
const retire = (extra = {}) => ({ cause: 'retirement', nextCharacterId: 'heir', voluntaryDecisionId: 'decision_1', retirementApproved: true, ...extra });
const abdicate = (extra = {}) => ({ cause: 'abdication', nextCharacterId: 'heir', voluntaryDecisionId: 'decision_2', abdicationApproved: true, abdicatedRefIds: ['title_crown'], ...extra });

test('[control.new-game.valid] a new game and an earlier version\'s new-game save pass the player control checks', () => {
  assert.deepEqual(checkControl(newGameState()), { ok: true });
  const v1 = JSON.parse(fs.readFileSync(new URL('../fixtures/v1-new-game-save.json', import.meta.url), 'utf8'));
  const migrated = migrateV1Envelope(v1);
  assert.deepEqual(checkControl(migrated.state), { ok: true });
  assert.deepEqual(validateState(migrated.state), { ok: true });
  const state = newGameState();
  assert.equal(getCurrentCharacterId(state), PLAYER_CHARACTER_ID);
  assert.equal(isPlayerCharacter(state, PLAYER_CHARACTER_ID), true);
  assert.equal(isPlayerCharacter(state, 'heir'), false);
  assert.deepEqual(getPlayerControl(state), state.playerControl);
  assert.notStrictEqual(getPlayerControl(state), state.playerControl);
  assert.deepEqual([...CONTROL_STATUSES], ['unbound', 'active', 'ended']);
  assert.deepEqual([...TRANSITION_CAUSES], ['death', 'retirement', 'abdication']);
});

test('[control.transition.death] when the played character has died, control passes to the chosen living character and the old one is released for good', () => {
  const store = newStore();
  apply(store, (draft) => setSuccessors(draft, { characterIds: ['heir', 'cousin'] }));
  kill(store, PLAYER_CHARACTER_ID);
  const result = apply(store, (draft) => transitionControl(draft, { cause: 'death', nextCharacterId: 'heir', expectedRevision: 1 }));
  assert.deepEqual([result.currentCharacterId, result.controlStatus], ['heir', 'active']);
  assert.deepEqual(control(store), {
    version: 1, revision: 2, controlStatus: 'active', currentCharacterId: 'heir', campaignClanId: null,
    designatedSuccessorIds: ['cousin'], permanentlyReleasedCharacterIds: [PLAYER_CHARACTER_ID],
  });
  assert.equal(getCurrentCharacterId(store.getState()), 'heir');
  assert.equal(isPlayerCharacter(store.getState(), PLAYER_CHARACTER_ID), false);
});

test('[control.transition.retirement] a formal retirement of a living character, decided and approved, passes control on', () => {
  const store = newStore();
  apply(store, (draft) => transitionControl(draft, retire()));
  assert.equal(control(store).currentCharacterId, 'heir');
  assert.deepEqual(control(store).permanentlyReleasedCharacterIds, [PLAYER_CHARACTER_ID]);
  assert.equal(store.getState().world.characters[PLAYER_CHARACTER_ID].identity.alive, true);
});

test('[control.transition.abdication] an approved abdication that gives something up, decided by the player, passes control on', () => {
  const store = newStore();
  apply(store, (draft) => transitionControl(draft, abdicate()));
  assert.equal(control(store).currentCharacterId, 'heir');
  assert.deepEqual(control(store).permanentlyReleasedCharacterIds, [PLAYER_CHARACTER_ID]);
});

test('[control.transition.rejects] control does not pass on without a death, an approved retirement or abdication, and an eligible successor', () => {
  const store = newStore();
  kill(store, 'cousin');
  const cases = [
    ['control_invalid_input', null],
    ['control_invalid_cause', { cause: 'boredom', nextCharacterId: 'heir' }],
    ['control_invalid_cause', { nextCharacterId: 'heir' }],
    // A death is needed for cause "death", and a decision for the voluntary ones.
    ['control_character_not_dead', { cause: 'death', nextCharacterId: 'heir' }],
    ['control_decision_required', retire({ voluntaryDecisionId: undefined })],
    ['control_decision_required', retire({ voluntaryDecisionId: 'Not An Id' })],
    ['control_retirement_not_approved', retire({ retirementApproved: false })],
    ['control_retirement_not_approved', retire({ retirementApproved: undefined })],
    ['control_retirement_not_approved', retire({ retirementApproved: 'yes' })],
    ['control_decision_required', abdicate({ voluntaryDecisionId: undefined })],
    ['control_abdication_not_approved', abdicate({ abdicationApproved: false })],
    ['control_abdication_not_approved', abdicate({ abdicationApproved: undefined })],
    ['control_abdication_nothing_given_up', abdicate({ abdicatedRefIds: [] })],
    ['control_abdication_nothing_given_up', abdicate({ abdicatedRefIds: undefined })],
    ['control_abdication_nothing_given_up', abdicate({ abdicatedRefIds: ['a', 'a'] })],
    ['control_abdication_nothing_given_up', abdicate({ abdicatedRefIds: [5] })],
    // The successor must exist, be alive, be someone else and never have been played before.
    ['control_missing_character', retire({ nextCharacterId: 'nobody' })],
    ['control_ineligible_candidate', retire({ nextCharacterId: 'cousin' })],
    ['control_ineligible_candidate', retire({ nextCharacterId: PLAYER_CHARACTER_ID })],
    // Nobody to switch to: the campaign only ends with explicit approval.
    ['control_no_eligible_candidate', retire({ nextCharacterId: undefined })],
    ['control_no_eligible_candidate', retire({ nextCharacterId: null, endCampaignApproved: false })],
    ['control_no_eligible_candidate', retire({ nextCharacterId: null, endCampaignApproved: 'yes' })],
    ['control_revision_conflict', retire({ expectedRevision: 3 })],
    ['control_invalid_expected_revision', retire({ expectedRevision: 'x' })],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => transitionControl(draft, input), code);
  // Dying is not enough to retire: the played character must be alive for the voluntary causes.
  kill(store, PLAYER_CHARACTER_ID);
  expectRejected(store, (draft) => transitionControl(draft, retire()), 'control_character_dead');
  expectRejected(store, (draft) => transitionControl(draft, abdicate()), 'control_character_dead');
  expectRejected(store, (draft) => transitionControl(draft, { cause: 'death', nextCharacterId: 'cousin' }), 'control_ineligible_candidate');
});

test('[control.transition.never-replay] a character the player has left can never be played again, not even as a successor', () => {
  const store = newStore();
  apply(store, (draft) => transitionControl(draft, retire()));
  apply(store, (draft) => transitionControl(draft, retire({ nextCharacterId: 'cousin' })));
  assert.deepEqual(control(store).permanentlyReleasedCharacterIds, [PLAYER_CHARACTER_ID, 'heir']);
  expectRejected(store, (draft) => transitionControl(draft, retire({ nextCharacterId: PLAYER_CHARACTER_ID })), 'control_ineligible_candidate');
  expectRejected(store, (draft) => transitionControl(draft, retire({ nextCharacterId: 'heir' })), 'control_ineligible_candidate');
  expectRejected(store, (draft) => setSuccessors(draft, { characterIds: ['heir'] }), 'control_ineligible_candidate');
  // Even the checks refuse a state that plays a released character, so no rule can slip it through.
  const bad = clone(store.getState());
  bad.playerControl.currentCharacterId = PLAYER_CHARACTER_ID;
  assert.ok(JSON.stringify(checkControl(bad).detail).includes('released_character_reselected'));
});

test('[control.transition.end-of-campaign] with no one to switch to the campaign ends, keeping the last character, and stays ended', () => {
  const store = newStore();
  kill(store, PLAYER_CHARACTER_ID);
  apply(store, (draft) => transitionControl(draft, { cause: 'death', nextCharacterId: null, endCampaignApproved: true }));
  assert.equal(control(store).controlStatus, 'ended');
  assert.equal(control(store).currentCharacterId, PLAYER_CHARACTER_ID);
  assert.deepEqual(control(store).permanentlyReleasedCharacterIds, [PLAYER_CHARACTER_ID]);
  assert.equal(getCurrentCharacterId(store.getState()), null);
  assert.equal(isPlayerCharacter(store.getState(), PLAYER_CHARACTER_ID), false);
  for (const rule of [
    (draft) => transitionControl(draft, { cause: 'death', nextCharacterId: 'heir' }),
    (draft) => endCampaign(draft, { decisionId: 'd' }),
    (draft) => setCampaignClan(draft, { clanId: 'clan_a', decisionId: 'd' }),
    (draft) => setSuccessors(draft, { characterIds: ['heir'] }),
  ]) expectRejected(store, rule, 'control_invalid_transition');
});

test('[control.end-campaign.by-decision] the player can end the campaign by a recorded decision while the character is alive', () => {
  const store = newStore();
  apply(store, (draft) => setSuccessors(draft, { characterIds: ['heir'] }));
  expectRejected(store, (draft) => endCampaign(draft, {}), 'control_decision_required');
  expectRejected(store, (draft) => endCampaign(draft, null), 'control_invalid_input');
  expectRejected(store, (draft) => endCampaign(draft, { decisionId: 'd', expectedRevision: 9 }), 'control_revision_conflict');
  apply(store, (draft) => endCampaign(draft, { decisionId: 'decision_9' }));
  assert.deepEqual([control(store).controlStatus, control(store).currentCharacterId], ['ended', PLAYER_CHARACTER_ID]);
  assert.deepEqual(control(store).permanentlyReleasedCharacterIds, [PLAYER_CHARACTER_ID]);
  assert.deepEqual(control(store).designatedSuccessorIds, ['heir']);
});

test('[control.only-way-to-switch] no other rule changes who the player plays, whatever happens to the characters', () => {
  const store = newStore();
  apply(store, (draft) => createGroup(draft, { id: 'band', name: 'Band', groupTypeId: 'caravan', worldPosition: { x: 1, y: 1 }, memberCharacterIds: ['heir'] }));
  apply(store, (draft) => setCommanders(draft, { groupId: 'band', legalCommanderRef: { type: 'character', id: 'heir' } }));
  expectRejected(store, (draft) => unlinkCharacter(draft, { groupId: 'legacy_player_group', characterId: PLAYER_CHARACTER_ID }), 'groups_cannot_remove_legal_commander');
  apply(store, (draft) => updateProfile(draft, { characterId: PLAYER_CHARACTER_ID, name: 'Renamed' }));
  apply(store, (draft) => setSuccessors(draft, { characterIds: ['heir', 'cousin'] }));
  apply(store, (draft) => setCampaignClan(draft, { clanId: 'clan_a', decisionId: 'd1' }));
  apply(store, (draft) => removeDeadSuccessors(draft));
  kill(store, PLAYER_CHARACTER_ID);
  assert.equal(control(store).currentCharacterId, PLAYER_CHARACTER_ID);
  assert.equal(control(store).controlStatus, 'active');
  // A dead character is still the one played until a transition is made.
  assert.equal(getCurrentCharacterId(store.getState()), PLAYER_CHARACTER_ID);
  // Writing the field directly from outside the rules is caught when the played character is released.
  const sneaky = store.transact('sneaky', (draft) => { draft.playerControl.currentCharacterId = 'cousin'; draft.playerControl.permanentlyReleasedCharacterIds.push('cousin'); });
  assert.equal(sneaky.error, 'store_state_invalid');
});

test('[control.successors.set-and-prune] successors are chosen among living, unplayed characters; one who dies later is allowed to stay until pruned', () => {
  const store = newStore();
  const set = (characterIds) => (draft) => setSuccessors(draft, { characterIds });
  assert.equal(apply(store, set(['cousin', 'heir'])).changed, true);
  assert.deepEqual(control(store).designatedSuccessorIds, ['cousin', 'heir']);
  assert.equal(control(store).revision, 1);
  assert.equal(apply(store, set(['cousin', 'heir'])).changed, false);
  assert.equal(control(store).revision, 1);
  const cases = [
    ['control_invalid_input', null],
    ['control_invalid_successors', { characterIds: 'heir' }],
    ['control_invalid_successors', { characterIds: ['heir', 'heir'] }],
    ['control_invalid_successors', { characterIds: [7] }],
    ['control_missing_character', { characterIds: ['nobody'] }],
    ['control_ineligible_candidate', { characterIds: [PLAYER_CHARACTER_ID] }],
    ['control_revision_conflict', { characterIds: ['heir'], expectedRevision: 0 }],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => setSuccessors(draft, input), code);
  kill(store, 'cousin');
  expectRejected(store, set(['cousin']), 'control_ineligible_candidate');
  // The dead successor stays in the list without making the game invalid, and is dropped on request.
  assert.deepEqual(control(store).designatedSuccessorIds, ['cousin', 'heir']);
  assert.deepEqual(checkControl(store.getState()), { ok: true });
  const pruned = apply(store, (draft) => removeDeadSuccessors(draft));
  assert.deepEqual(pruned.removed, ['cousin']);
  assert.deepEqual(control(store).designatedSuccessorIds, ['heir']);
  const revision = control(store).revision;
  assert.deepEqual(apply(store, (draft) => removeDeadSuccessors(draft)).removed, []);
  assert.equal(control(store).revision, revision);
  expectRejected(store, (draft) => removeDeadSuccessors(draft, { expectedRevision: 0 }), 'control_revision_conflict');
});

test('[control.campaign-clan.set] the campaign clan is chosen by a recorded decision among existing clans', () => {
  const store = newStore();
  apply(store, (draft) => setCampaignClan(draft, { clanId: 'clan_a', decisionId: 'decision_3' }));
  assert.equal(control(store).campaignClanId, 'clan_a');
  assert.equal(control(store).revision, 1);
  assert.equal(apply(store, (draft) => setCampaignClan(draft, { clanId: 'clan_a', decisionId: 'decision_4' })).changed, false);
  assert.equal(control(store).revision, 1);
  const cases = [
    ['control_invalid_input', null],
    ['control_decision_required', { clanId: 'clan_a' }],
    ['control_decision_required', { clanId: 'clan_a', decisionId: '' }],
    ['control_missing_clan', { clanId: 'clan_zzz', decisionId: 'd' }],
    ['control_missing_clan', { clanId: 'constructor', decisionId: 'd' }],
    ['control_missing_clan', { clanId: 5, decisionId: 'd' }],
    ['control_revision_conflict', { clanId: 'clan_a', decisionId: 'd', expectedRevision: 0 }],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => setCampaignClan(draft, input), code);
});

test('[control.bind-initial.unbound] a campaign with no character yet is bound to a living one, once, with an existing clan', () => {
  const unbound = () => {
    const state = newGameState();
    state.world.clans.clan_a = { id: 'clan_a' };
    state.world.characters.heir = newCharacter({ id: 'heir', name: 'heir' });
    state.world.characters.dead_one = newCharacter({ id: 'dead_one', name: 'dead_one' });
    Object.assign(state.world.characters.dead_one.identity, { alive: false, deathDay: 0 });
    Object.assign(state.playerControl, { controlStatus: 'unbound', currentCharacterId: null });
    return state;
  };
  // The saved-state check requires a current character, so this uses the player control check alone.
  const store = createStore(unbound(), { validate: checkControl });
  const cases = [
    ['control_invalid_input', null],
    ['control_missing_character', { characterId: 'nobody' }],
    ['control_ineligible_candidate', { characterId: 'dead_one' }],
    ['control_missing_clan', { characterId: 'heir', campaignClanId: 'clan_zzz' }],
    ['control_revision_conflict', { characterId: 'heir', expectedRevision: 4 }],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => bindInitialCharacter(draft, input), code);
  apply(store, (draft) => bindInitialCharacter(draft, { characterId: 'heir', campaignClanId: 'clan_a' }));
  assert.deepEqual([control(store).controlStatus, control(store).currentCharacterId, control(store).campaignClanId, control(store).revision], ['active', 'heir', 'clan_a', 1]);
  expectRejected(store, (draft) => bindInitialCharacter(draft, { characterId: PLAYER_CHARACTER_ID }), 'control_invalid_transition');
});

test('[control.check.rejects-bad-records] a saved game with a damaged player control record is refused, naming the problem', () => {
  const base = () => {
    const state = newGameState();
    state.world.clans.clan_a = { id: 'clan_a' };
    for (const id of ['heir', 'cousin']) state.world.characters[id] = newCharacter({ id, name: id });
    state.playerControl.designatedSuccessorIds = ['heir'];
    state.playerControl.permanentlyReleasedCharacterIds = ['cousin'];
    return state;
  };
  assert.deepEqual(checkControl(base()), { ok: true });
  const damage = [
    ['invalid_revision', (s) => { s.playerControl.revision = -1; }],
    ['invalid_control_status', (s) => { s.playerControl.controlStatus = 'paused'; }],
    ['invalid_successor_ids', (s) => { s.playerControl.designatedSuccessorIds = 'heir'; }],
    ['invalid_successor_ids', (s) => { s.playerControl.designatedSuccessorIds = ['heir', 'heir']; }],
    ['invalid_released_ids', (s) => { s.playerControl.permanentlyReleasedCharacterIds = [1]; }],
    ['invalid_current_character', (s) => { s.playerControl.currentCharacterId = 5; }],
    ['invalid_campaign_clan', (s) => { s.playerControl.campaignClanId = 5; }],
    ['missing_campaign_clan', (s) => { s.playerControl.campaignClanId = 'clan_zzz'; }],
    ['missing_control_character', (s) => { s.playerControl.currentCharacterId = null; }],
    ['missing_control_character', (s) => { s.playerControl.currentCharacterId = 'nobody'; }],
    ['released_character_reselected', (s) => { s.playerControl.currentCharacterId = 'cousin'; }],
    ['invalid_control_character', (s) => { s.playerControl.controlStatus = 'unbound'; }],
    ['invalid_control_character', (s) => { s.playerControl.controlStatus = 'ended'; }],
    ['missing_released:ghost', (s) => { s.playerControl.permanentlyReleasedCharacterIds.push('ghost'); }],
    ['missing_successor:ghost', (s) => { s.playerControl.designatedSuccessorIds.push('ghost'); }],
    ['released_successor:cousin', (s) => { s.playerControl.designatedSuccessorIds.push('cousin'); }],
    ['current_is_successor', (s) => { s.playerControl.designatedSuccessorIds.push(PLAYER_CHARACTER_ID); }],
  ];
  for (const [fragment, edit] of damage) {
    const state = base();
    edit(state);
    const result = checkControl(state);
    assert.equal(result.ok, false, fragment);
    assert.ok(JSON.stringify(result.detail).includes(fragment), `${fragment} not in ${JSON.stringify(result.detail)}`);
  }
  const future = base();
  future.playerControl.version = 2;
  assert.equal(checkControl(future).error, 'control_unsupported_version');
  future.playerControl = [];
  assert.equal(checkControl(future).error, 'control_invalid_root');
  // An ended campaign may keep its last character (a released one) or have none.
  const ended = base();
  Object.assign(ended.playerControl, { controlStatus: 'ended', currentCharacterId: 'cousin' });
  assert.deepEqual(checkControl(ended), { ok: true });
  ended.playerControl.currentCharacterId = null;
  assert.deepEqual(checkControl(ended), { ok: true });
});
