import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore } from '../../src/core/store.js';
import { clone } from '../../src/core/data.js';
import { newCharacter, newGameState, PLAYER_CHARACTER_ID, PLAYER_GROUP_ID, PLAYER_INVENTORY_ID } from '../../src/game/new-game.js';
import { validateState } from '../../src/persist/schema.js';
import { migrateV1Envelope } from '../../src/persist/migrate-v1.js';
import { approveDefinition, getDefinition, listDefinitionIds, proposeDefinition } from '../../src/domains/definitions/index.js';
import { recordDeath } from '../../src/domains/characters/index.js';
import {
  COMMAND_STRUCTURES, GROUP_TYPES, attachInventory, attachTreasury, checkGroups, createGroup, getGroup, getGroupOfCharacter, linkCharacter,
  listGroups, setAllegiance, setCohesion, setCommanders, setMemberQuantity, splitGroup, unlinkCharacter, updateGroup,
} from '../../src/domains/groups/index.js';

// People: the player (in the player group) and four free characters.
const newStore = (edit = () => {}) => {
  const state = newGameState();
  state.world.clans.clan_a = { id: 'clan_a' };
  for (const id of ['anna', 'bert', 'cleo', 'dana']) state.world.characters[id] = newCharacter({ id, name: id });
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

const groupInput = (id, extra = {}) => ({ id, name: `Group ${id}`, groupTypeId: 'military_party', worldPosition: { x: 10, y: 20 }, ...extra });
const group = (store, id) => store.getState().world.mobileGroups[id];
const person = (store, id) => store.getState().world.characters[id];
const troops = { refTypeId: 'troop_unit', refId: 'spearmen', roleId: 'infantry', quantity: 20 };
const cart = { refTypeId: 'cart', refId: 'cart_basic', quantity: 3 };

// A band of four with anna in command, 20 spearmen and 3 carts.
const bandStore = () => {
  const store = newStore();
  apply(store, (draft) => createGroup(draft, groupInput('band', {
    memberCharacterIds: ['anna', 'bert', 'cleo', 'dana'],
    legalCommanderRef: { type: 'character', id: 'anna' },
    actingCommanderRef: { type: 'character', id: 'anna' },
    legalOwnerRef: { type: 'clan', id: 'clan_a' },
    employerRef: { type: 'clan', id: 'clan_a' },
    loyaltyAnchorRefs: [{ type: 'clan', id: 'clan_a' }],
    memberRefs: [troops],
    transport: { capacityWeightKg: 500, capacityVolumeL: 900, assetRefs: [cart] },
    cohesion: 80,
    movement: { baseSpeed: 150 },
  })));
  return store;
};

test('[groups.new-game.valid] a new game and an earlier version\'s new-game save pass the group checks', () => {
  assert.deepEqual(checkGroups(newGameState()), { ok: true });
  const v1 = JSON.parse(fs.readFileSync(new URL('../fixtures/v1-new-game-save.json', import.meta.url), 'utf8'));
  const migrated = migrateV1Envelope(v1);
  assert.deepEqual(checkGroups(migrated.state), { ok: true });
  assert.deepEqual(validateState(migrated.state), { ok: true });
});

test('[groups.catalog.built-in] the built-in group types and command structures are known, and an approved custom type is usable once approved', () => {
  const state = newGameState();
  assert.deepEqual(listDefinitionIds(state, 'mobile_group_type'), GROUP_TYPES.map((type) => type.id).sort());
  assert.deepEqual(listDefinitionIds(state, 'command_structure'), COMMAND_STRUCTURES.map((type) => type.id).sort());
  assert.deepEqual(getDefinition(state, 'mobile_group_type', 'military_party').capabilityTags, ['named_members', 'troops', 'combat', 'travel']);
  assert.deepEqual(GROUP_TYPES.map((type) => type.id), ['character_group', 'military_party', 'caravan', 'envoy_group', 'civilian_group']);
  const store = newStore();
  const input = { domainId: 'mobile_group_type', definitionId: 'pilgrims', definitionData: { capabilityTags: ['travel'] } };
  expectRejected(store, (draft) => createGroup(draft, groupInput('p1', { groupTypeId: 'pilgrims' })), 'groups_unregistered_group_type');
  apply(store, (draft) => proposeDefinition(draft, input));
  expectRejected(store, (draft) => createGroup(draft, groupInput('p1', { groupTypeId: 'pilgrims' })), 'groups_unregistered_group_type');
  apply(store, (draft) => approveDefinition(draft, { domainId: 'mobile_group_type', definitionId: 'pilgrims', expectedRevision: 0 }));
  apply(store, (draft) => createGroup(draft, groupInput('p1', { groupTypeId: 'pilgrims' })));
  assert.equal(group(store, 'p1').groupTypeId, 'pilgrims');
  const refused = store.transact('bad', (draft) => proposeDefinition(draft, { ...input, definitionId: 'bad', definitionData: { capabilityTags: 'travel' } }));
  assert.equal(refused.error, 'definitions_invalid_definition');
});

test('[groups.create.with-members] a new group takes its members from where they were, with defaults for what is not given', () => {
  const store = bandStore();
  const band = group(store, 'band');
  assert.deepEqual(band.memberCharacterIds, ['anna', 'bert', 'cleo', 'dana']);
  for (const id of band.memberCharacterIds) {
    assert.deepEqual(person(store, id).location, { mode: 'mobile_group', mobileGroupId: 'band', prisonerOfId: null, settlementId: null }, id);
    assert.equal(person(store, id).revision, 1);
  }
  assert.deepEqual(Object.keys(band).sort(), Object.keys(group(store, PLAYER_GROUP_ID)).sort());
  assert.equal(band.commandStructureId, 'single_commander');
  assert.equal(band.cohesion, 80);
  assert.deepEqual(band.movement, { baseSpeed: 150, currentSpeed: 150, targetNode: null, targetX: 10, targetY: 20 });
  assert.deepEqual(band.worldPosition, { x: 10, y: 20 });
  assert.deepEqual(band.memberRefs, [{ ...troops, customData: {} }]);
  assert.deepEqual(band.transport, { assetRefs: [{ ...cart, roleId: null, customData: {} }], capacityVolumeL: 900, capacityWeightKg: 500 });
  assert.equal(band.inventoryId, null);
  assert.equal(band.treasuryAccountId, null);
  assert.equal(band.version, 1);
  assert.equal(band.revision, 0);
  assert.equal(getGroup(store.getState(), 'band').id, 'band');
  assert.equal(getGroup(store.getState(), 'nothing'), null);
  assert.equal(getGroupOfCharacter(store.getState(), 'bert').id, 'band');
  assert.equal(getGroupOfCharacter(store.getState(), PLAYER_CHARACTER_ID).id, PLAYER_GROUP_ID);
  assert.deepEqual(listGroups(store.getState()).map((g) => g.id), ['band', PLAYER_GROUP_ID]);
  // The simplest group: no members, no commanders.
  apply(store, (draft) => createGroup(draft, groupInput('empty', { groupTypeId: 'caravan' })));
  assert.deepEqual(group(store, 'empty').memberCharacterIds, []);
  assert.equal(group(store, 'empty').cohesion, 100);
  assert.equal(getGroupOfCharacter(store.getState(), 'nobody'), null);
});

test('[groups.create.rejects-bad-input] a group with bad input, a taken id, unusable members or a commander who is not a member is refused', () => {
  const store = bandStore();
  store.transact('death', (draft) => recordDeath(draft, { characterId: 'cleo' }));
  const cases = [
    ['groups_invalid_input', () => null],
    ['groups_invalid_group_id', () => groupInput('Bad Id')],
    ['groups_duplicate_group', () => groupInput('band')],
    ['groups_unknown_field', () => groupInput('g', { speed: 3 })],
    ['groups_attach_after_create', () => groupInput('g', { inventoryId: PLAYER_INVENTORY_ID })],
    ['groups_attach_after_create', () => groupInput('g', { treasuryAccountId: 'legacy_player_personal_account' })],
    ['groups_invalid_name', () => groupInput('g', { name: '  ' })],
    ['groups_unregistered_group_type', () => groupInput('g', { groupTypeId: 'zeppelin' })],
    ['groups_unregistered_command_structure', () => groupInput('g', { commandStructureId: 'mob_rule' })],
    ['groups_invalid_cohesion', () => groupInput('g', { cohesion: 101 })],
    ['groups_invalid_cohesion', () => groupInput('g', { cohesion: -1 })],
    ['groups_invalid_cohesion', () => groupInput('g', { cohesion: Number.NaN })],
    ['groups_invalid_customData', () => groupInput('g', { customData: [] })],
    ['groups_invalid_position', () => groupInput('g', { worldPosition: { x: 1 } })],
    ['groups_invalid_position', () => groupInput('g', { worldPosition: undefined })],
    ['groups_invalid_movement', () => groupInput('g', { movement: { baseSpeed: -1 } })],
    ['groups_invalid_movement', () => groupInput('g', { movement: { flying: true } })],
    ['groups_invalid_transport', () => groupInput('g', { transport: { capacityWeightKg: -5 } })],
    ['groups_invalid_transport', () => groupInput('g', { transport: { speedBonus: 5 } })],
    ['groups_invalid_transport', () => groupInput('g', { transport: { assetRefs: [{ ...cart, quantity: 0 }] } })],
    ['groups_invalid_member_refs', () => groupInput('g', { memberRefs: [{ ...troops, quantity: 1.5 }] })],
    ['groups_invalid_member_refs', () => groupInput('g', { memberRefs: [troops, troops] })],
    ['groups_invalid_members', () => groupInput('g', { memberCharacterIds: 'anna' })],
    ['groups_invalid_members', () => groupInput('g', { memberCharacterIds: ['anna', 'anna'] })],
    ['groups_missing_character', () => groupInput('g', { memberCharacterIds: ['nobody'] })],
    ['groups_character_already_in_group', () => groupInput('g', { memberCharacterIds: [PLAYER_CHARACTER_ID] })],
    ['groups_character_already_in_group', () => groupInput('g', { memberCharacterIds: ['anna'] })],
    ['groups_invalid_ref', () => groupInput('g', { legalOwnerRef: { type: 'clan', id: 'clan_zzz' } })],
    ['groups_invalid_ref', () => groupInput('g', { employerRef: 'clan_a' })],
    ['groups_invalid_ref', () => groupInput('g', { loyaltyAnchorRefs: [null] })],
    ['groups_invalid_ref', () => groupInput('g', { loyaltyAnchorRefs: 'clan_a' })],
    ['groups_commander_not_member', () => groupInput('g', { memberCharacterIds: [], legalCommanderRef: { type: 'character', id: PLAYER_CHARACTER_ID } })],
    ['groups_commander_not_member', () => groupInput('g', { actingCommanderRef: { type: 'character', id: 'bert' } })],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => createGroup(draft, input()), code);
  // A dead character cannot join a new group (checked after freeing cleo, who is in "band" above).
  store.transact('free cleo', (draft) => unlinkCharacter(draft, { groupId: 'band', characterId: 'cleo' }));
  expectRejected(store, (draft) => createGroup(draft, groupInput('g', { memberCharacterIds: ['cleo'] })), 'groups_character_not_alive');
});

test('[groups.link.adds-member] a living free character joins a group on both sides at once, and joining again changes nothing', () => {
  const store = newStore();
  apply(store, (draft) => createGroup(draft, groupInput('band', { memberCharacterIds: ['anna'] })));
  const result = apply(store, (draft) => linkCharacter(draft, { groupId: 'band', characterId: 'bert', expectedGroupRevision: 0, expectedCharacterRevision: 0 }));
  assert.equal(result.changed, true);
  assert.deepEqual(group(store, 'band').memberCharacterIds, ['anna', 'bert']);
  assert.equal(group(store, 'band').revision, 1);
  assert.equal(person(store, 'bert').location.mobileGroupId, 'band');
  assert.equal(person(store, 'bert').location.mode, 'mobile_group');
  assert.equal(person(store, 'bert').revision, 1);
  const before = store.getState();
  const again = apply(store, (draft) => linkCharacter(draft, { groupId: 'band', characterId: 'bert' }));
  assert.equal(again.changed, false);
  assert.deepEqual(store.getState().world, before.world);
});

test('[groups.link.rejects] joining is refused for a missing or dead character, one already in another group, or a stale revision', () => {
  const store = bandStore();
  store.transact('free dana', (draft) => unlinkCharacter(draft, { groupId: 'band', characterId: 'dana' }));
  store.transact('death', (draft) => recordDeath(draft, { characterId: 'dana' }));
  const cases = [
    ['groups_invalid_input', null],
    ['groups_invalid_group_id', { groupId: 5, characterId: 'anna' }],
    ['groups_missing_group', { groupId: 'nowhere', characterId: 'anna' }],
    ['groups_missing_character', { groupId: 'band', characterId: 'nobody' }],
    ['groups_character_already_in_group', { groupId: PLAYER_GROUP_ID, characterId: 'anna' }],
    ['groups_character_not_alive', { groupId: PLAYER_GROUP_ID, characterId: 'dana' }],
    ['groups_revision_conflict', { groupId: 'band', characterId: 'dana', expectedGroupRevision: 9 }],
    ['groups_revision_conflict', { groupId: PLAYER_GROUP_ID, characterId: 'dana', expectedCharacterRevision: 9 }],
    ['groups_invalid_expected_revision', { groupId: 'band', characterId: 'dana', expectedGroupRevision: 'x' }],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => linkCharacter(draft, input), code);
  // A group that lists a character who is not located in it does not count as "already joined".
  const lopsided = newStore();
  const result = lopsided.transact('lopsided', (draft) => {
    draft.world.mobileGroups[PLAYER_GROUP_ID].memberCharacterIds.push('anna');
    return linkCharacter(draft, { groupId: PLAYER_GROUP_ID, characterId: 'anna' });
  });
  assert.equal(result.error, 'groups_relationship_mismatch');
});

test('[groups.unlink.removes-member] a member leaves on both sides at once, and the commanders cannot leave', () => {
  const store = bandStore();
  const result = apply(store, (draft) => unlinkCharacter(draft, { groupId: 'band', characterId: 'dana', expectedCharacterRevision: 1 }));
  assert.equal(result.changed, true);
  assert.deepEqual(group(store, 'band').memberCharacterIds, ['anna', 'bert', 'cleo']);
  assert.deepEqual(person(store, 'dana').location, { mode: 'none', mobileGroupId: null, prisonerOfId: null, settlementId: null });
  assert.equal(person(store, 'dana').revision, 2);
  // A character who was in a settlement before goes back to "settlement" mode.
  apply(store, (draft) => { draft.world.characters.bert.location.settlementId = 'town_a'; });
  apply(store, (draft) => unlinkCharacter(draft, { groupId: 'band', characterId: 'bert' }));
  assert.equal(person(store, 'bert').location.mode, 'settlement');
  const cases = [
    ['groups_cannot_remove_legal_commander', { groupId: 'band', characterId: 'anna' }],
    ['groups_relationship_mismatch', { groupId: 'band', characterId: 'dana' }],
    ['groups_relationship_mismatch', { groupId: PLAYER_GROUP_ID, characterId: 'cleo' }],
    ['groups_missing_character', { groupId: 'band', characterId: 'nobody' }],
    ['groups_missing_group', { groupId: 'nowhere', characterId: 'cleo' }],
    ['groups_revision_conflict', { groupId: 'band', characterId: 'cleo', expectedGroupRevision: 99 }],
    ['groups_revision_conflict', { groupId: 'band', characterId: 'cleo', expectedCharacterRevision: 99 }],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => unlinkCharacter(draft, input), code);
  // The acting commander is protected too, even when someone else is the legal commander.
  apply(store, (draft) => setCommanders(draft, { groupId: 'band', legalCommanderRef: { type: 'character', id: 'cleo' } }));
  expectRejected(store, (draft) => unlinkCharacter(draft, { groupId: 'band', characterId: 'anna' }), 'groups_cannot_remove_acting_commander');
  expectRejected(store, (draft) => unlinkCharacter(draft, { groupId: 'band', characterId: 'cleo' }), 'groups_cannot_remove_legal_commander');
});

test('[groups.commanders.appoints] commanders must be living members, can be cleared, and the command structure must be a known one', () => {
  const store = bandStore();
  apply(store, (draft) => setCommanders(draft, { groupId: 'band', legalCommanderRef: { type: 'character', id: 'bert' }, actingCommanderRef: { type: 'character', id: 'cleo' }, commandStructureId: 'delegated_command', expectedRevision: 0 }));
  assert.deepEqual(group(store, 'band').legalCommanderRef, { type: 'character', id: 'bert' });
  assert.deepEqual(group(store, 'band').actingCommanderRef, { type: 'character', id: 'cleo' });
  assert.equal(group(store, 'band').commandStructureId, 'delegated_command');
  assert.equal(group(store, 'band').revision, 1);
  assert.equal(apply(store, (draft) => setCommanders(draft, { groupId: 'band', legalCommanderRef: { type: 'character', id: 'bert' } })).changed, false);
  assert.equal(group(store, 'band').revision, 1);
  // A commander can be a record of another kind (a clan commanding the band), which needs no membership.
  apply(store, (draft) => setCommanders(draft, { groupId: 'band', legalCommanderRef: { type: 'clan', id: 'clan_a' }, actingCommanderRef: null }));
  assert.equal(group(store, 'band').actingCommanderRef, null);
  store.transact('death', (draft) => recordDeath(draft, { characterId: 'dana' }));
  const cases = [
    ['groups_invalid_input', null],
    ['groups_commander_not_member', { groupId: 'band', legalCommanderRef: { type: 'character', id: PLAYER_CHARACTER_ID } }],
    ['groups_commander_not_alive', { groupId: 'band', actingCommanderRef: { type: 'character', id: 'dana' } }],
    ['groups_invalid_ref', { groupId: 'band', legalCommanderRef: { type: 'character', id: 'nobody' } }],
    ['groups_invalid_ref', { groupId: 'band', legalCommanderRef: 'anna' }],
    ['groups_unregistered_command_structure', { groupId: 'band', commandStructureId: 'mob_rule' }],
    ['groups_invalid_input', { groupId: 'band' }],
    ['groups_unknown_field', { groupId: 'band', cohesion: 5 }],
    ['groups_missing_group', { groupId: 'nowhere', legalCommanderRef: null }],
    ['groups_revision_conflict', { groupId: 'band', legalCommanderRef: null, expectedRevision: 0 }],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => setCommanders(draft, input), code);
});

test('[groups.allegiance.sets-refs] owner, employer, paymaster, command authority and loyalty anchors must point at existing records', () => {
  const store = bandStore();
  const clan = { type: 'clan', id: 'clan_a' };
  apply(store, (draft) => setAllegiance(draft, { groupId: 'band', paymasterRef: clan, commandAuthorityRef: { type: 'character', id: PLAYER_CHARACTER_ID }, legalOwnerRef: null, loyaltyAnchorRefs: [] }));
  const band = group(store, 'band');
  assert.deepEqual([band.paymasterRef, band.commandAuthorityRef, band.legalOwnerRef, band.loyaltyAnchorRefs], [clan, { type: 'character', id: PLAYER_CHARACTER_ID }, null, []]);
  assert.deepEqual(band.employerRef, clan);
  assert.equal(apply(store, (draft) => setAllegiance(draft, { groupId: 'band', paymasterRef: clan })).changed, false);
  const cases = [
    ['groups_invalid_input', null],
    ['groups_invalid_input', { groupId: 'band' }],
    ['groups_unknown_field', { groupId: 'band', legalCommanderRef: null }],
    ['groups_invalid_ref', { groupId: 'band', employerRef: { type: 'clan', id: 'clan_zzz' } }],
    ['groups_invalid_ref', { groupId: 'band', employerRef: { type: 'spaceship', id: 'x' } }],
    ['groups_invalid_ref', { groupId: 'band', loyaltyAnchorRefs: [clan, { type: 'clan', id: 'clan_zzz' }] }],
    ['groups_invalid_ref', { groupId: 'band', loyaltyAnchorRefs: [null] }],
    ['groups_missing_group', { groupId: 'nowhere', employerRef: null }],
    ['groups_revision_conflict', { groupId: 'band', employerRef: null, expectedRevision: 0 }],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => setAllegiance(draft, input), code);
});

test('[groups.cohesion.limits] cohesion is set between 0 and 100 and nothing else is accepted', () => {
  const store = bandStore();
  apply(store, (draft) => setCohesion(draft, { groupId: 'band', cohesion: 0 }));
  assert.equal(group(store, 'band').cohesion, 0);
  apply(store, (draft) => setCohesion(draft, { groupId: 'band', cohesion: 100 }));
  apply(store, (draft) => setCohesion(draft, { groupId: 'band', cohesion: 42.5 }));
  assert.equal(group(store, 'band').cohesion, 42.5);
  const revision = group(store, 'band').revision;
  assert.equal(apply(store, (draft) => setCohesion(draft, { groupId: 'band', cohesion: 42.5 })).changed, false);
  assert.equal(group(store, 'band').revision, revision);
  for (const cohesion of [-0.1, 100.1, Number.NaN, Number.POSITIVE_INFINITY, '50', null, undefined]) {
    expectRejected(store, (draft) => setCohesion(draft, { groupId: 'band', cohesion }), 'groups_invalid_cohesion');
  }
  expectRejected(store, (draft) => setCohesion(draft, { groupId: 'nowhere', cohesion: 5 }), 'groups_missing_group');
  expectRejected(store, (draft) => setCohesion(draft, null), 'groups_invalid_input');
  expectRejected(store, (draft) => setCohesion(draft, { groupId: 'constructor', cohesion: 5 }), 'groups_missing_group');
  expectRejected(store, (draft) => setCohesion(draft, { groupId: 'band', cohesion: 5, expectedRevision: 0 }), 'groups_revision_conflict');
});

test('[groups.members.counted] counted members (troops, assets) are set to a whole number, and zero removes them', () => {
  const store = bandStore();
  apply(store, (draft) => setMemberQuantity(draft, { groupId: 'band', ...troops, quantity: 25 }));
  assert.equal(group(store, 'band').memberRefs[0].quantity, 25);
  apply(store, (draft) => setMemberQuantity(draft, { groupId: 'band', refTypeId: 'troop_unit', refId: 'spearmen', roleId: 'scouts', quantity: 4 }));
  apply(store, (draft) => setMemberQuantity(draft, { groupId: 'band', refTypeId: 'troop_unit', refId: 'archers', quantity: 6 }));
  assert.equal(group(store, 'band').memberRefs.length, 3);
  assert.deepEqual(group(store, 'band').memberRefs[2], { refTypeId: 'troop_unit', refId: 'archers', roleId: null, quantity: 6, customData: {} });
  apply(store, (draft) => setMemberQuantity(draft, { groupId: 'band', refTypeId: 'troop_unit', refId: 'archers', quantity: 0 }));
  assert.equal(group(store, 'band').memberRefs.length, 2);
  const revision = group(store, 'band').revision;
  assert.equal(apply(store, (draft) => setMemberQuantity(draft, { groupId: 'band', refTypeId: 'troop_unit', refId: 'archers', quantity: 0 })).changed, false);
  assert.equal(apply(store, (draft) => setMemberQuantity(draft, { groupId: 'band', ...troops, quantity: 25 })).changed, false);
  assert.equal(group(store, 'band').revision, revision);
  const cases = [
    ['groups_invalid_input', null],
    ['groups_invalid_quantity', { groupId: 'band', ...troops, quantity: -1 }],
    ['groups_invalid_quantity', { groupId: 'band', ...troops, quantity: 1.5 }],
    ['groups_invalid_quantity', { groupId: 'band', ...troops, quantity: '5' }],
    ['groups_invalid_member_refs', { groupId: 'band', refTypeId: 'Bad Id', refId: 'x', quantity: 1 }],
    ['groups_invalid_member_refs', { groupId: 'band', refTypeId: 'troop_unit', refId: 'x', roleId: 5, quantity: 1 }],
    ['groups_missing_group', { groupId: 'nowhere', ...troops }],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => setMemberQuantity(draft, input), code);
});

test('[groups.update.fields] a group can be renamed, retyped or given free data, but not through this rule\'s other fields', () => {
  const store = bandStore();
  apply(store, (draft) => updateGroup(draft, { groupId: 'band', name: 'Wolves', groupTypeId: 'caravan', specializedState: { mood: 'tired' }, customData: { flag: 1 } }));
  assert.deepEqual([group(store, 'band').name, group(store, 'band').groupTypeId, group(store, 'band').specializedState, group(store, 'band').customData], ['Wolves', 'caravan', { mood: 'tired' }, { flag: 1 }]);
  assert.equal(group(store, 'band').revision, 1);
  assert.equal(apply(store, (draft) => updateGroup(draft, { groupId: 'band', name: 'Wolves' })).changed, false);
  const cases = [
    ['groups_invalid_input', null],
    ['groups_invalid_name', { groupId: 'band', name: '' }],
    ['groups_unregistered_group_type', { groupId: 'band', groupTypeId: 'zeppelin' }],
    ['groups_invalid_specializedState', { groupId: 'band', specializedState: [] }],
    ['groups_invalid_customData', { groupId: 'band', customData: 5 }],
    ['groups_unknown_field', { groupId: 'band', memberCharacterIds: [] }],
    ['groups_unknown_field', { groupId: 'band', cohesion: 1 }],
    ['groups_missing_group', { groupId: 'nowhere', name: 'x' }],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => updateGroup(draft, input), code);
});

test('[groups.attach.inventory-and-treasury] an inventory or account is attached only if it exists and is owned by the group', () => {
  const store = bandStore();
  const withAssets = (draft) => {
    draft.world.inventories.band_inventory = { id: 'band_inventory', ownerRef: { type: 'mobile_group', id: 'band' } };
    draft.world.inventories.other_inventory = { id: 'other_inventory', ownerRef: { type: 'mobile_group', id: PLAYER_GROUP_ID } };
    draft.world.finance.accounts.band_funds = { id: 'band_funds', ownerRef: { type: 'mobile_group', id: 'band' } };
    draft.world.finance.accounts.other_funds = { id: 'other_funds', ownerRef: { type: 'character', id: 'anna' } };
    return { ok: true };
  };
  store.transact('assets', withAssets);
  apply(store, (draft) => attachInventory(draft, { groupId: 'band', inventoryId: 'band_inventory' }));
  apply(store, (draft) => attachTreasury(draft, { groupId: 'band', accountId: 'band_funds' }));
  assert.equal(group(store, 'band').inventoryId, 'band_inventory');
  assert.equal(group(store, 'band').treasuryAccountId, 'band_funds');
  assert.equal(group(store, 'band').revision, 2);
  assert.equal(apply(store, (draft) => attachInventory(draft, { groupId: 'band', inventoryId: 'band_inventory' })).changed, false);
  assert.equal(apply(store, (draft) => attachTreasury(draft, { groupId: 'band', accountId: 'band_funds' })).changed, false);
  assert.equal(group(store, 'band').revision, 2);
  const cases = [
    [attachInventory, 'groups_invalid_input', null],
    [attachInventory, 'groups_missing_inventory', { groupId: 'band', inventoryId: 'nothing' }],
    [attachInventory, 'groups_missing_inventory', { groupId: 'band' }],
    [attachInventory, 'groups_inventory_owner_mismatch', { groupId: 'band', inventoryId: 'other_inventory' }],
    [attachInventory, 'groups_missing_group', { groupId: 'nowhere', inventoryId: 'band_inventory' }],
    [attachInventory, 'groups_revision_conflict', { groupId: 'band', inventoryId: 'band_inventory', expectedGroupRevision: 0 }],
    [attachTreasury, 'groups_missing_account', { groupId: 'band', accountId: 'nothing' }],
    [attachTreasury, 'groups_account_owner_mismatch', { groupId: 'band', accountId: 'other_funds' }],
    [attachTreasury, 'groups_account_owner_mismatch', { groupId: PLAYER_GROUP_ID, accountId: 'band_funds' }],
    [attachTreasury, 'groups_missing_group', { groupId: 'nowhere', accountId: 'band_funds' }],
  ];
  for (const [rule, code, input] of cases) expectRejected(store, (draft) => rule(draft, input), code);
});

const scouts = (extra = {}) => ({
  id: 'scouts', name: 'Scouts', groupTypeId: 'envoy_group', commandStructureId: 'delegated_command', ...extra,
});

test('[groups.split.moves-parts] a split moves the named characters, counted members and assets to a new group that starts where the source is', () => {
  const store = bandStore();
  apply(store, (draft) => { draft.world.mobileGroups.band.worldPosition = { x: 300, y: 400 }; draft.world.mobileGroups.band.movement.targetX = 999; });
  const result = apply(store, (draft) => splitGroup(draft, {
    sourceGroupId: 'band',
    expectedGroupRevision: 0,
    newGroup: scouts({ legalCommanderRef: { type: 'character', id: 'bert' }, actingCommanderRef: { type: 'character', id: 'bert' } }),
    characterMoves: [{ characterId: 'bert', expectedRevision: 1 }, { characterId: 'dana' }],
    memberRefMoves: [{ refTypeId: 'troop_unit', refId: 'spearmen', roleId: 'infantry', quantity: 8 }],
    transportAssetMoves: [{ ...cart, quantity: 3 }],
  }));
  assert.equal(result.newGroupId, 'scouts');
  const source = group(store, 'band');
  const fresh = group(store, 'scouts');
  assert.deepEqual(source.memberCharacterIds, ['anna', 'cleo']);
  assert.deepEqual(fresh.memberCharacterIds, ['bert', 'dana']);
  assert.deepEqual(source.memberRefs.map((m) => m.quantity), [12]);
  assert.deepEqual(fresh.memberRefs.map((m) => [m.refId, m.quantity]), [['spearmen', 8]]);
  assert.deepEqual(source.transport.assetRefs, []);
  assert.deepEqual(fresh.transport.assetRefs.map((m) => m.quantity), [3]);
  assert.equal(source.revision, 1);
  for (const id of ['bert', 'dana']) assert.deepEqual([person(store, id).location.mobileGroupId, person(store, id).location.mode], ['scouts', 'mobile_group']);
  for (const id of ['anna', 'cleo']) assert.equal(person(store, id).location.mobileGroupId, 'band');
  // The new group starts where the source is, standing still, with the source's cohesion and allegiance.
  assert.deepEqual(fresh.worldPosition, { x: 300, y: 400 });
  assert.deepEqual(fresh.movement, { baseSpeed: 150, currentSpeed: 150, targetNode: null, targetX: 300, targetY: 400 });
  assert.equal(fresh.cohesion, 80);
  assert.deepEqual(fresh.legalOwnerRef, { type: 'clan', id: 'clan_a' });
  assert.deepEqual(fresh.employerRef, { type: 'clan', id: 'clan_a' });
  assert.deepEqual(fresh.loyaltyAnchorRefs, [{ type: 'clan', id: 'clan_a' }]);
  assert.deepEqual(fresh.legalCommanderRef, { type: 'character', id: 'bert' });
  assert.equal(fresh.inventoryId, null);
  assert.equal(fresh.treasuryAccountId, null);
  assert.equal(fresh.commandStructureId, 'delegated_command');
  assert.equal(fresh.revision, 0);
  // Explicit fields win over what would be inherited, and a split of only counted members is fine.
  apply(store, (draft) => splitGroup(draft, {
    sourceGroupId: 'band',
    newGroup: { id: 'cooks', name: 'Cooks', groupTypeId: 'civilian_group', commandStructureId: 'single_commander', cohesion: 30, employerRef: null, worldPosition: { x: 1, y: 2 }, movement: { baseSpeed: 90 } },
    memberRefMoves: [{ refTypeId: 'troop_unit', refId: 'spearmen', roleId: 'infantry', quantity: 12 }],
  }));
  assert.deepEqual(group(store, 'band').memberRefs, []);
  assert.deepEqual([group(store, 'cooks').cohesion, group(store, 'cooks').employerRef, group(store, 'cooks').worldPosition, group(store, 'cooks').movement.baseSpeed], [30, null, { x: 1, y: 2 }, 90]);
  assert.deepEqual(group(store, 'cooks').legalCommanderRef, null);
});

test('[groups.split.rejects] a split with bad input, a bad allocation, a taken id or the wrong commanders is refused and changes nothing', () => {
  const store = bandStore();
  const plan = (extra = {}, newGroup = {}) => ({ sourceGroupId: 'band', newGroup: scouts(newGroup), characterMoves: [{ characterId: 'bert' }], ...extra });
  const cases = [
    ['groups_invalid_input', () => null],
    ['groups_missing_source_group', () => plan({ sourceGroupId: 'nowhere' })],
    ['groups_revision_conflict', () => plan({ expectedGroupRevision: 5 })],
    ['groups_invalid_input', () => plan({ newGroup: 'scouts' })],
    ['groups_unknown_field', () => plan({}, { speed: 4 })],
    ['groups_duplicate_new_group_id', () => plan({}, { id: 'band' })],
    ['groups_duplicate_new_group_id', () => plan({}, { id: 'Bad Id' })],
    ['groups_explicit_command_structure_required', () => plan({}, { commandStructureId: undefined })],
    ['groups_unregistered_command_structure', () => plan({}, { commandStructureId: 'mob_rule' })],
    ['groups_unregistered_group_type', () => plan({}, { groupTypeId: 'zeppelin' })],
    ['groups_invalid_name', () => plan({}, { name: '' })],
    ['groups_empty_split', () => plan({ characterMoves: [] })],
    ['groups_empty_split', () => plan({ characterMoves: undefined })],
    ['groups_invalid_character_allocation', () => plan({ characterMoves: 'bert' })],
    ['groups_invalid_character_allocation', () => plan({ characterMoves: [{ characterId: 'bert' }, { characterId: 'bert' }] })],
    ['groups_invalid_character_allocation', () => plan({ characterMoves: [{ characterId: PLAYER_CHARACTER_ID }] })],
    ['groups_revision_conflict', () => plan({ characterMoves: [{ characterId: 'bert', expectedRevision: 9 }] })],
    ['groups_source_legal_commander_moved', () => plan({ characterMoves: [{ characterId: 'anna' }] })],
    ['groups_explicit_commander_not_moved', () => plan({}, { legalCommanderRef: { type: 'character', id: 'cleo' } })],
    ['groups_invalid_ref_allocation', () => plan({ memberRefMoves: [{ ...troops, quantity: 21 }] })],
    ['groups_invalid_ref_allocation', () => plan({ memberRefMoves: [{ ...troops, quantity: 0 }] })],
    ['groups_invalid_ref_allocation', () => plan({ memberRefMoves: [{ ...troops, quantity: 1.5 }] })],
    ['groups_invalid_ref_allocation', () => plan({ memberRefMoves: [{ ...troops, refId: 'pikemen', quantity: 1 }] })],
    ['groups_invalid_ref_allocation', () => plan({ memberRefMoves: 'all' })],
    ['groups_duplicate_ref_allocation', () => plan({ memberRefMoves: [{ ...troops, quantity: 1 }, { ...troops, quantity: 2 }] })],
    ['groups_invalid_transport_asset_allocation', () => plan({ transportAssetMoves: [{ ...cart, quantity: 4 }] })],
    ['groups_invalid_ref', () => plan({}, { employerRef: { type: 'clan', id: 'clan_zzz' } })],
    ['groups_invalid_cohesion', () => plan({}, { cohesion: 150 })],
  ];
  for (const [code, build] of cases) expectRejected(store, (draft) => splitGroup(draft, build()), code);
  // A dead member can be moved, but cannot be put in command of the new group.
  store.transact('death', (draft) => recordDeath(draft, { characterId: 'dana' }));
  expectRejected(store, (draft) => splitGroup(draft, plan({ characterMoves: [{ characterId: 'dana' }] }, { actingCommanderRef: { type: 'character', id: 'dana' } })), 'groups_commander_not_alive');
  // A group that lists a character who is not located in it cannot give that character away.
  const lopsided = store.transact('lopsided', (draft) => {
    draft.world.characters.bert.location = { mode: 'none', mobileGroupId: null, settlementId: null, prisonerOfId: null };
    return splitGroup(draft, plan({ characterMoves: [{ characterId: 'bert' }] }));
  });
  assert.equal(lopsided.error, 'groups_relationship_mismatch');
  // The acting commander (not the legal one) also stays: make cleo legal commander, anna keeps acting.
  apply(store, (draft) => setCommanders(draft, { groupId: 'band', legalCommanderRef: { type: 'character', id: 'cleo' } }));
  expectRejected(store, (draft) => splitGroup(draft, plan({ characterMoves: [{ characterId: 'anna' }] })), 'groups_source_acting_commander_moved');
});

test('[groups.split.all-or-nothing] a split that fails at the last step leaves no half-moved characters, counted members or new group', () => {
  const store = bandStore();
  // The transport request is the last thing checked, after characters and counted members were already worked out.
  const request = { sourceGroupId: 'band', newGroup: scouts(), characterMoves: [{ characterId: 'bert' }, { characterId: 'cleo' }], memberRefMoves: [{ ...troops, quantity: 5 }], transportAssetMoves: [{ ...cart, quantity: 99 }] };
  expectRejected(store, (draft) => splitGroup(draft, request), 'groups_invalid_transport_asset_allocation');
  assert.equal(group(store, 'scouts'), undefined);
  assert.deepEqual(group(store, 'band').memberCharacterIds, ['anna', 'bert', 'cleo', 'dana']);
  assert.equal(group(store, 'band').memberRefs[0].quantity, 20);
  assert.equal(person(store, 'bert').location.mobileGroupId, 'band');
});

const baseWithBand = () => {
  const state = newGameState();
  state.world.clans.clan_a = { id: 'clan_a' };
  for (const id of ['anna', 'bert']) {
    state.world.characters[id] = newCharacter({ id, name: id, mobileGroupId: 'band' });
  }
  state.world.mobileGroups.band = {
    ...clone(state.world.mobileGroups[PLAYER_GROUP_ID]), id: 'band', memberCharacterIds: ['anna', 'bert'], inventoryId: null,
    legalOwnerRef: { type: 'clan', id: 'clan_a' }, legalCommanderRef: { type: 'character', id: 'anna' }, actingCommanderRef: null,
  };
  return state;
};

test('[groups.check.rejects-bad-records] a saved game with a damaged group record is refused, naming the problem', () => {
  assert.deepEqual(checkGroups(baseWithBand()), { ok: true });
  assert.deepEqual(validateState(baseWithBand()), { ok: true });
  const damage = [
    ['record_id_mismatch', (s) => { s.world.mobileGroups.band.id = 'other'; }],
    ['record_id_mismatch', (s) => { s.world.mobileGroups.band = 5; }],
    ['invalid_map_key', (s) => { s.world.mobileGroups['Bad Key'] = { ...s.world.mobileGroups.band, id: 'Bad Key' }; }],
    ['unsupported_version', (s) => { s.world.mobileGroups.band.version = 2; }],
    ['invalid_revision', (s) => { s.world.mobileGroups.band.revision = -1; }],
    ['invalid_name', (s) => { s.world.mobileGroups.band.name = 5; }],
    ['unregistered_group_type', (s) => { s.world.mobileGroups.band.groupTypeId = 'zeppelin'; }],
    ['unregistered_command_structure', (s) => { s.world.mobileGroups.band.commandStructureId = 'mob_rule'; }],
    ['invalid_members', (s) => { s.world.mobileGroups.band.memberCharacterIds = 'anna'; }],
    ['duplicate_character_member', (s) => { s.world.mobileGroups.band.memberCharacterIds = ['anna', 'anna', 'bert']; }],
    ['missing_member:ghost', (s) => { s.world.mobileGroups.band.memberCharacterIds.push('ghost'); }],
    ['member_not_located_here:anna', (s) => { s.world.characters.anna.location = { mode: 'none', mobileGroupId: null, settlementId: null, prisonerOfId: null }; }],
    ['member_not_located_here:bert', (s) => { s.world.mobileGroups[PLAYER_GROUP_ID].memberCharacterIds.push('bert'); }],
    ['invalid_member_refs', (s) => { s.world.mobileGroups.band.memberRefs = [{ refTypeId: 'troop_unit', refId: 'x', roleId: null, quantity: 0, customData: {} }]; }],
    ['invalid_ref:legalOwnerRef', (s) => { s.world.mobileGroups.band.legalOwnerRef = 'clan_a'; }],
    ['missing_ref_target:legalOwnerRef', (s) => { s.world.mobileGroups.band.legalOwnerRef = { type: 'clan', id: 'clan_zzz' }; }],
    ['missing_ref_target:employerRef', (s) => { s.world.mobileGroups.band.employerRef = { type: 'faction', id: 'f_zzz' }; }],
    ['invalid_loyalty_anchor_refs', (s) => { s.world.mobileGroups.band.loyaltyAnchorRefs = [{ type: 'clan', id: 'clan_zzz' }]; }],
    ['invalid_loyalty_anchor_refs', (s) => { s.world.mobileGroups.band.loyaltyAnchorRefs = 'clan_a'; }],
    ['commander_not_member:legalCommanderRef', (s) => { s.world.mobileGroups.band.legalCommanderRef = { type: 'character', id: PLAYER_CHARACTER_ID }; }],
    ['commander_not_member:actingCommanderRef', (s) => { s.world.mobileGroups.band.actingCommanderRef = { type: 'character', id: PLAYER_CHARACTER_ID }; }],
    ['invalid_cohesion', (s) => { s.world.mobileGroups.band.cohesion = 101; }],
    ['invalid_asset_ids', (s) => { s.world.mobileGroups.band.inventoryId = 5; }],
    ['missing_inventory', (s) => { s.world.mobileGroups.band.inventoryId = 'no_inventory'; }],
    ['missing_treasury_account', (s) => { s.world.mobileGroups.band.treasuryAccountId = 'no_account'; }],
    ['invalid_custom_data', (s) => { s.world.mobileGroups.band.customData = []; }],
    ['invalid_position', (s) => { s.world.mobileGroups.band.worldPosition = { x: 'a', y: 1 }; }],
    ['invalid_movement', (s) => { s.world.mobileGroups.band.movement.baseSpeed = -1; }],
    ['invalid_movement', (s) => { s.world.mobileGroups.band.movement = null; }],
    ['invalid_transport', (s) => { s.world.mobileGroups.band.transport.capacityWeightKg = -1; }],
    ['invalid_transport', (s) => { s.world.mobileGroups.band.transport.assetRefs = 'x'; }],
  ];
  for (const [fragment, edit] of damage) {
    const state = baseWithBand();
    edit(state);
    const result = checkGroups(state);
    assert.equal(result.ok, false, fragment);
    assert.ok(JSON.stringify(result.detail).includes(fragment), `${fragment} not in ${JSON.stringify(result.detail)}`);
  }
  const state = baseWithBand();
  state.world.mobileGroups = [];
  assert.equal(checkGroups(state).error, 'groups_invalid_root');
  // Where a route leads is the world area's to define, so any value there is accepted.
  const routed = baseWithBand();
  routed.world.mobileGroups.band.movement.targetNode = { x: 1, y: 2, name: 'Old Bridge' };
  assert.deepEqual(checkGroups(routed), { ok: true });
});

test('[groups.check.two-way-link] a one-sided link between a character and a group is refused when a change would leave it', () => {
  const store = newStore();
  // Group lists a character who is not located in it.
  const listed = store.transact('list only', (draft) => { draft.world.mobileGroups[PLAYER_GROUP_ID].memberCharacterIds.push('anna'); });
  assert.equal(listed.error, 'store_state_invalid');
  // Character located in a group that does not list them.
  const located = store.transact('locate only', (draft) => { Object.assign(draft.world.characters.anna.location, { mode: 'mobile_group', mobileGroupId: PLAYER_GROUP_ID }); });
  assert.equal(located.error, 'store_state_invalid');
  // Taking the player out of the group on the character side only.
  const half = store.transact('half unlink', (draft) => { Object.assign(draft.world.characters[PLAYER_CHARACTER_ID].location, { mode: 'none', mobileGroupId: null }); });
  assert.equal(half.error, 'store_state_invalid');
  assert.equal(person(store, PLAYER_CHARACTER_ID).location.mobileGroupId, PLAYER_GROUP_ID);
  assert.equal(group(store, PLAYER_GROUP_ID).memberCharacterIds.includes('anna'), false);
});
