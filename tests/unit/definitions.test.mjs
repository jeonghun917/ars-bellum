import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore } from '../../src/core/store.js';
import { clone } from '../../src/core/data.js';
import { newGameState, PLAYER_CHARACTER_ID, PLAYER_GROUP_ID } from '../../src/game/new-game.js';
import { validateState } from '../../src/persist/schema.js';
import { migrateV1Envelope } from '../../src/persist/migrate-v1.js';
import {
  REF_TYPES, approveDefinition, checkDefinitions, checkRef, definitionProblems, findRefTarget, getDefinition, getProposal, hasDefinition,
  listDefinitionIds, listProposals, proposeDefinition, refExists, registerDefinitionDomain, rejectDefinition,
} from '../../src/domains/definitions/index.js';

// A small domain of our own: widgets have a positive weight and may need another definition.
registerDefinitionDomain('test_widget', {
  validate: (data, lookup) => {
    const problems = [];
    if (!Number.isInteger(data.weight) || data.weight < 1) problems.push('invalid_weight');
    if (data.partId !== undefined && !lookup.has('test_widget', data.partId)) problems.push('missing_part');
    return problems;
  },
  defaults: [{ id: 'basic', weight: 1 }],
});
registerDefinitionDomain('owner_ref_type', {
  defaults: [
    { id: 'character', capabilityTags: ['can_own_account'] },
    { id: 'clan', capabilityTags: [] },
  ],
});

const newStore = (edit = () => {}) => {
  const state = newGameState();
  state.world.clans.clan_a = { id: 'clan_a' };
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

const widget = (id, extra = {}) => ({ domainId: 'test_widget', definitionId: id, definitionData: { weight: 3 }, ...extra });
const decide = (rule, id, extra = {}) => (draft) => rule(draft, { domainId: 'test_widget', definitionId: id, expectedRevision: 0, ...extra });

test('[definitions.new-game.valid] a new game and an earlier version\'s new-game save pass the definition checks', () => {
  assert.deepEqual(checkDefinitions(newGameState()), { ok: true });
  const v1 = JSON.parse(fs.readFileSync(new URL('../fixtures/v1-new-game-save.json', import.meta.url), 'utf8'));
  const migrated = migrateV1Envelope(v1);
  assert.equal(migrated.ok, true);
  assert.deepEqual(checkDefinitions(migrated.state), { ok: true });
  assert.deepEqual(validateState(migrated.state), { ok: true });
});

test('[definitions.registry.domain-rules] a domain is registered once, with valid ids and valid built-in definitions', () => {
  assert.throws(() => registerDefinitionDomain('test_widget'), /duplicate/);
  assert.throws(() => registerDefinitionDomain('Bad Id'), /invalid definition domain id/);
  assert.throws(() => registerDefinitionDomain('has:colon'), /invalid definition domain id/);
  assert.throws(() => registerDefinitionDomain('test_broken', { validate: () => ['nope'], defaults: [{ id: 'x' }] }), /invalid default definition/);
  assert.throws(() => registerDefinitionDomain('test_dupes', { defaults: [{ id: 'x' }, { id: 'x' }] }), /invalid default definition/);
  // A domain that failed to register leaves no trace, so it can be registered correctly afterwards.
  registerDefinitionDomain('test_broken');
  assert.deepEqual(listDefinitionIds(newGameState(), 'test_widget'), ['basic']);
  assert.equal(hasDefinition(newGameState(), 'test_widget', 'basic'), true);
  assert.equal(hasDefinition(newGameState(), 'test_widget', 'missing'), false);
  assert.equal(hasDefinition(newGameState(), 'unknown_domain', 'basic'), false);
});

test('[definitions.registry.built-in-copy] a built-in definition read from the registry cannot be changed by the reader', () => {
  const state = newGameState();
  const copy = getDefinition(state, 'test_widget', 'basic');
  copy.weight = 99;
  assert.equal(getDefinition(state, 'test_widget', 'basic').weight, 1);
});

test('[definitions.propose.stores-pending] a proposal is stored as pending in the earlier record shape and is not usable yet', () => {
  const store = newStore();
  const result = apply(store, (draft) => proposeDefinition(draft, widget('heavy', { sourceRef: { type: 'character', id: PLAYER_CHARACTER_ID } })));
  assert.equal(result.key, 'test_widget:heavy');
  const root = store.getState().world.customDefinitions;
  assert.equal(root.revision, 1);
  assert.deepEqual(root.records['test_widget:heavy'], {
    domainId: 'test_widget',
    definitionId: 'heavy',
    schemaVersion: 1,
    definitionVersion: 1,
    sourceType: 'player',
    sourceRef: { type: 'character', id: PLAYER_CHARACTER_ID },
    approvalStatus: 'pending',
    approvedByRef: null,
    definitionData: { weight: 3, id: 'heavy' },
    revision: 0,
  });
  assert.equal(hasDefinition(store.getState(), 'test_widget', 'heavy'), false);
  assert.equal(getDefinition(store.getState(), 'test_widget', 'heavy'), null);
  assert.deepEqual(listProposals(store.getState(), { approvalStatus: 'pending' }).map((record) => record.definitionId), ['heavy']);
  assert.equal(getProposal(store.getState(), 'test_widget', 'heavy').revision, 0);
});

test('[definitions.propose.rejects-bad-input] a proposal with bad or conflicting input is refused and changes nothing', () => {
  const store = newStore();
  apply(store, (draft) => proposeDefinition(draft, widget('heavy')));
  const cases = [
    ['definitions_invalid_input', () => null],
    ['definitions_unregistered_domain', () => ({ ...widget('x'), domainId: 'no_such_domain' })],
    ['definitions_invalid_definition_id', () => ({ ...widget('Upper') })],
    ['definitions_invalid_definition_id', () => ({ ...widget(7) })],
    ['definitions_invalid_definition_data', () => ({ ...widget('x'), definitionData: [] })],
    ['definitions_invalid_definition_version', () => widget('x', { definitionVersion: 0 })],
    ['definitions_invalid_source_type', () => widget('x', { sourceType: 'Not An Id' })],
    ['definitions_invalid_source_ref', () => widget('x', { sourceRef: { type: 'character' } })],
    ['definitions_missing_source', () => widget('x', { sourceRef: { type: 'character', id: 'nobody' } })],
    ['definitions_duplicate_definition', () => widget('basic')],
    ['definitions_duplicate_proposal', () => widget('heavy')],
    ['definitions_invalid_definition', () => ({ ...widget('x'), definitionData: { weight: 0 } })],
    ['definitions_invalid_definition', () => ({ ...widget('x'), definitionData: { weight: 1, partId: 'nothing' } })],
    ['definitions_invalid_definition', () => ({ ...widget('x'), definitionData: { weight: 1, referenceDefinitions: [{ domainId: 'test_widget', definitionId: 'nothing' }] } })],
    ['definitions_invalid_definition', () => ({ ...widget('x'), definitionData: { weight: 1, referenceDefinitions: 'basic' } })],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => proposeDefinition(draft, input()), code);
});

test('[definitions.propose.pending-not-known] a proposal that is still pending does not count as a known definition for others that need it', () => {
  const store = newStore();
  apply(store, (draft) => proposeDefinition(draft, widget('part')));
  const needsPart = { ...widget('whole'), definitionData: { weight: 1, partId: 'part' } };
  expectRejected(store, (draft) => proposeDefinition(draft, needsPart), 'definitions_invalid_definition');
  apply(store, decide(approveDefinition, 'part'));
  apply(store, (draft) => proposeDefinition(draft, needsPart));
  assert.equal(definitionProblems(store.getState(), 'test_widget', 'whole', { id: 'whole', weight: 1, partId: 'part' }).length, 0);
});

test('[definitions.approve.makes-known] an approved definition is known everywhere, built in ones stay, and the record is kept', () => {
  const store = newStore();
  apply(store, (draft) => proposeDefinition(draft, widget('heavy')));
  apply(store, decide(approveDefinition, 'heavy', { approvedByRef: { type: 'character', id: PLAYER_CHARACTER_ID } }));
  const state = store.getState();
  assert.equal(hasDefinition(state, 'test_widget', 'heavy'), true);
  assert.deepEqual(getDefinition(state, 'test_widget', 'heavy'), { weight: 3, id: 'heavy' });
  assert.deepEqual(listDefinitionIds(state, 'test_widget'), ['basic', 'heavy']);
  const record = state.world.customDefinitions.records['test_widget:heavy'];
  assert.equal(record.approvalStatus, 'approved');
  assert.deepEqual(record.approvedByRef, { type: 'character', id: PLAYER_CHARACTER_ID });
  assert.equal(record.revision, 1);
  assert.equal(state.world.customDefinitions.revision, 2);
  // What is read back from a save is just as known: no runtime registry has to be refilled.
  const reloaded = JSON.parse(JSON.stringify(state));
  assert.equal(hasDefinition(reloaded, 'test_widget', 'heavy'), true);
  assert.deepEqual(validateState(reloaded), { ok: true });
});

test('[definitions.reject.stays-unknown] a rejected proposal never becomes known and cannot be decided again', () => {
  const store = newStore();
  apply(store, (draft) => proposeDefinition(draft, widget('heavy')));
  apply(store, decide(rejectDefinition, 'heavy'));
  assert.equal(hasDefinition(store.getState(), 'test_widget', 'heavy'), false);
  assert.equal(store.getState().world.customDefinitions.records['test_widget:heavy'].approvalStatus, 'rejected');
  expectRejected(store, (draft) => approveDefinition(draft, { domainId: 'test_widget', definitionId: 'heavy', expectedRevision: 1 }), 'definitions_already_decided');
  expectRejected(store, (draft) => rejectDefinition(draft, { domainId: 'test_widget', definitionId: 'heavy', expectedRevision: 1 }), 'definitions_already_decided');
  expectRejected(store, (draft) => proposeDefinition(draft, widget('heavy')), 'definitions_duplicate_proposal');
});

test('[definitions.decide.rejects-bad-input] approving or rejecting needs an existing pending proposal, its current revision and a real approver', () => {
  const store = newStore();
  apply(store, (draft) => proposeDefinition(draft, widget('heavy')));
  const cases = [
    ['definitions_invalid_input', (draft) => approveDefinition(draft, null)],
    ['definitions_invalid_input', (draft) => approveDefinition(draft, { domainId: 7, definitionId: 'heavy', expectedRevision: 0 })],
    ['definitions_invalid_expected_revision', (draft) => approveDefinition(draft, { domainId: 'test_widget', definitionId: 'heavy' })],
    ['definitions_invalid_expected_revision', (draft) => rejectDefinition(draft, { domainId: 'test_widget', definitionId: 'heavy', expectedRevision: -1 })],
    ['definitions_missing_proposal', (draft) => approveDefinition(draft, { domainId: 'test_widget', definitionId: 'nothing', expectedRevision: 0 })],
    ['definitions_revision_conflict', (draft) => approveDefinition(draft, { domainId: 'test_widget', definitionId: 'heavy', expectedRevision: 5 })],
    ['definitions_revision_conflict', (draft) => rejectDefinition(draft, { domainId: 'test_widget', definitionId: 'heavy', expectedRevision: 5 })],
    ['definitions_invalid_approver', decide(approveDefinition, 'heavy', { approvedByRef: 'me' })],
    ['definitions_missing_approver', decide(approveDefinition, 'heavy', { approvedByRef: { type: 'character', id: 'nobody' } })],
  ];
  for (const [code, rule] of cases) expectRejected(store, rule, code);
});

test('[definitions.decide.rechecks-data] approval fails if the definition no longer fits its domain when it is decided', () => {
  const store = newStore();
  apply(store, (draft) => proposeDefinition(draft, widget('heavy')));
  // Break the stored data the way a bad edit or an older save could.
  const rule = (draft) => {
    draft.world.customDefinitions.records['test_widget:heavy'].definitionData.weight = 'heavy';
    return approveDefinition(draft, { domainId: 'test_widget', definitionId: 'heavy', expectedRevision: 0 });
  };
  const result = store.transact('test', rule);
  assert.equal(result.error, 'definitions_invalid_definition');
  assert.equal(store.getState().world.customDefinitions.records['test_widget:heavy'].approvalStatus, 'pending');
});

test('[definitions.check.rejects-bad-records] a saved game with a damaged definition record is refused', () => {
  const approved = () => {
    const store = newStore();
    apply(store, (draft) => proposeDefinition(draft, widget('heavy')));
    apply(store, decide(approveDefinition, 'heavy'));
    return clone(store.getState());
  };
  assert.deepEqual(checkDefinitions(approved()), { ok: true });
  const damage = [
    ['key_mismatch', (s) => { s.world.customDefinitions.records['test_widget:other'] = s.world.customDefinitions.records['test_widget:heavy']; }],
    ['invalid_schema_version', (s) => { s.world.customDefinitions.records['test_widget:heavy'].schemaVersion = 2; }],
    ['invalid_definition_version', (s) => { s.world.customDefinitions.records['test_widget:heavy'].definitionVersion = 0; }],
    ['invalid_source_type', (s) => { s.world.customDefinitions.records['test_widget:heavy'].sourceType = ''; }],
    ['invalid_source_ref', (s) => { s.world.customDefinitions.records['test_widget:heavy'].sourceRef = { type: 'character' }; }],
    ['invalid_approval_status', (s) => { s.world.customDefinitions.records['test_widget:heavy'].approvalStatus = 'maybe'; }],
    ['invalid_approved_by_ref', (s) => { s.world.customDefinitions.records['test_widget:heavy'].approvedByRef = 'me'; }],
    ['approver_without_approval', (s) => { const r = s.world.customDefinitions.records['test_widget:heavy']; r.approvalStatus = 'pending'; r.approvedByRef = { type: 'clan', id: 'clan_a' }; }],
    ['invalid_revision', (s) => { s.world.customDefinitions.records['test_widget:heavy'].revision = -1; }],
    ['invalid_definition_data', (s) => { s.world.customDefinitions.records['test_widget:heavy'].definitionData.id = 'other'; }],
    ['duplicates_built_in_definition', (s) => { const r = s.world.customDefinitions.records['test_widget:heavy']; delete s.world.customDefinitions.records['test_widget:heavy']; r.definitionId = 'basic'; r.definitionData.id = 'basic'; s.world.customDefinitions.records['test_widget:basic'] = r; }],
    ['invalid_weight', (s) => { s.world.customDefinitions.records['test_widget:heavy'].definitionData.weight = 0; }],
    ['invalid_record', (s) => { s.world.customDefinitions.records['test_widget:heavy'] = 5; }],
  ];
  for (const [fragment, edit] of damage) {
    const state = approved();
    edit(state);
    const result = checkDefinitions(state);
    assert.equal(result.ok, false, fragment);
    assert.ok(JSON.stringify(result.detail).includes(fragment), `${fragment} not in ${JSON.stringify(result.detail)}`);
  }
  const root = approved();
  root.world.customDefinitions.version = 2;
  assert.equal(checkDefinitions(root).error, 'definitions_unsupported_version');
  root.world.customDefinitions = { version: 1, revision: -1, records: {} };
  assert.equal(checkDefinitions(root).error, 'definitions_invalid_revision');
  root.world.customDefinitions = [];
  assert.equal(checkDefinitions(root).error, 'definitions_invalid_root');
});

test('[definitions.check.unknown-domain-kept] records of a domain no area has registered yet are kept as they are', () => {
  const state = newGameState();
  state.world.customDefinitions.records['future_domain:thing'] = {
    domainId: 'future_domain', definitionId: 'thing', schemaVersion: 1, definitionVersion: 1, sourceType: 'player', sourceRef: null,
    approvalStatus: 'approved', approvedByRef: null, definitionData: { id: 'thing' }, revision: 0,
  };
  assert.deepEqual(checkDefinitions(state), { ok: true });
});

test('[definitions.refs.targets] a reference is found when its record exists, for every reference type', () => {
  const state = newGameState();
  state.world.clans.clan_a = { id: 'clan_a' };
  state.world.factions.f1 = { id: 'f1' };
  state.world.titles.t1 = { id: 't1' };
  state.world.settlements.s1 = { id: 's1' };
  state.world.landRights.l1 = { id: 'l1' };
  const targets = {
    character: PLAYER_CHARACTER_ID, mobile_group: PLAYER_GROUP_ID, clan: 'clan_a', faction: 'f1', title: 't1', settlement: 's1', land_right: 'l1',
    account: 'legacy_player_personal_account', inventory: 'legacy_player_group_inventory',
  };
  assert.deepEqual([...REF_TYPES], Object.keys(targets).sort());
  for (const [type, id] of Object.entries(targets)) {
    assert.equal(refExists(state, { type, id }), true, type);
    assert.equal(findRefTarget(state, { type, id }).id, id);
    assert.equal(refExists(state, { type, id: 'missing_one' }), false, type);
  }
  assert.equal(refExists(state, { type: 'spaceship', id: 'x' }), false);
  assert.equal(refExists(state, { type: 'character' }), false);
  assert.equal(refExists(state, { type: 'character', id: PLAYER_CHARACTER_ID, extra: 1 }), false);
  assert.equal(refExists(state, { type: 'character', id: 'constructor' }), false);
  assert.equal(refExists(state, null), false);
});

test('[definitions.refs.check-ref] a reference is checked for shape, type, target and the capability its type needs', () => {
  const state = newGameState();
  state.world.clans.clan_a = { id: 'clan_a' };
  const player = { type: 'character', id: PLAYER_CHARACTER_ID };
  assert.deepEqual(checkRef(state, player), { ok: true, ref: player });
  assert.deepEqual(checkRef(state, player, 'can_own_account'), { ok: true, ref: player });
  const cases = [
    ['definitions_invalid_ref', [null]],
    ['definitions_invalid_ref', [{ type: 'character', id: '' }]],
    ['definitions_unknown_ref_type', [{ type: 'spaceship', id: 'x' }]],
    ['definitions_missing_ref_target', [{ type: 'character', id: 'nobody' }]],
    ['definitions_invalid_capability_tag', [player, 'Not A Tag']],
    ['definitions_ref_capability_denied', [{ type: 'clan', id: 'clan_a' }, 'can_own_account']],
    ['definitions_missing_ref_type_definition', [{ type: 'mobile_group', id: PLAYER_GROUP_ID }, 'can_own_account']],
    ['definitions_ref_capability_denied', [player, 'can_fly']],
  ];
  for (const [code, args] of cases) assert.equal(checkRef(state, ...args).error, code, JSON.stringify(args));
});
