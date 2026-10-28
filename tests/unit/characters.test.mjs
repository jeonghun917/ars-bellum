import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore } from '../../src/core/store.js';
import { clone } from '../../src/core/data.js';
import { APTITUDE_IDS, newCharacter, newGameState, PLAYER_CHARACTER_ID, PLAYER_GROUP_ID, SKILL_IDS } from '../../src/game/new-game.js';
import { validateState } from '../../src/persist/schema.js';
import { migrateV1Envelope } from '../../src/persist/migrate-v1.js';
import { approveDefinition, getDefinition, listDefinitionIds, proposeDefinition } from '../../src/domains/definitions/index.js';
import {
  DERIVED_RATINGS, GROWTH_SOURCE_IDS, SKILL_APTITUDE, XP_PER_LEVEL,
  applyRoleEffects, changeTiers, checkActivity, checkCharacters, collectDueCharacters, createCharacter, defaultProfile, gainExperience,
  gainFromEducation, getAge, getCharacter, getDerivedRatings, getModifiers, getProfile, isAlive, listCharacters, placeInSettlement, processCharacter,
  recordDeath, setAffiliations, setClaimIndex, setCondition, setGroupLocation, setPersonalAssets, setTitleIndex, updateProfile,
} from '../../src/domains/characters/index.js';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ''} expected ${expected}, got ${actual}`);

const newStore = (edit = () => {}) => {
  const state = newGameState();
  state.world.clans.clan_a = { id: 'clan_a' };
  state.world.factions.faction_a = { id: 'faction_a' };
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

const person = (id, extra = {}) => ({ id, identity: { name: `Person ${id}` }, ...extra });
const withPeople = (...ids) => newStore((state) => {
  for (const id of ids) {
    const character = newCharacter({ id, name: `Person ${id}` });
    state.world.characters[id] = character;
  }
});
const character = (store, id) => store.getState().world.characters[id];

// ---- records and catalog ------------------------------------------------------------------

test('[characters.new-game.valid] a new game and an earlier version\'s new-game save pass the character checks', () => {
  assert.deepEqual(checkCharacters(newGameState()), { ok: true });
  assert.deepEqual(checkActivity(newGameState()), { ok: true });
  const v1 = JSON.parse(fs.readFileSync(new URL('../fixtures/v1-new-game-save.json', import.meta.url), 'utf8'));
  const migrated = migrateV1Envelope(v1);
  assert.deepEqual(checkCharacters(migrated.state), { ok: true });
  assert.deepEqual(checkActivity(migrated.state), { ok: true });
  assert.deepEqual(validateState(migrated.state), { ok: true });
});

test('[characters.catalog.built-in] the built-in skills, aptitudes, growth sources and ratings are complete and refer to each other', () => {
  const state = newGameState();
  assert.deepEqual(listDefinitionIds(state, 'skill'), [...SKILL_IDS].sort());
  assert.deepEqual(listDefinitionIds(state, 'aptitude'), [...APTITUDE_IDS].sort());
  assert.deepEqual(listDefinitionIds(state, 'growth_source'), [...GROWTH_SOURCE_IDS].sort());
  assert.deepEqual(listDefinitionIds(state, 'derived_rating'), DERIVED_RATINGS.map((rating) => rating.id).sort());
  for (const skillId of SKILL_IDS) {
    assert.equal(getDefinition(state, 'skill', skillId).aptitudeDefinitionId, SKILL_APTITUDE[skillId]);
    assert.ok(APTITUDE_IDS.includes(SKILL_APTITUDE[skillId]), skillId);
  }
  for (const rating of DERIVED_RATINGS) {
    for (const skillId of Object.keys(rating.weights)) assert.ok(SKILL_IDS.includes(skillId), `${rating.id} uses ${skillId}`);
  }
  assert.deepEqual(SKILL_APTITUDE, {
    one_handed: 'combat', two_handed: 'combat', polearm: 'combat', bow: 'combat', crossbow: 'combat', throwing: 'combat',
    riding: 'mobility', athletics: 'mobility', command: 'command', tactics: 'command', scouting: 'command',
    logistics: 'administration', stewardship: 'administration', trade: 'administration',
    leadership: 'social', charm: 'social', diplomacy: 'social', intrigue: 'social',
    medicine: 'scholarship', engineering: 'scholarship', learning: 'scholarship',
  });
  assert.deepEqual(DERIVED_RATINGS.find((rating) => rating.id === 'scholarship_rating').weights, { medicine: 0.3, engineering: 0.3, learning: 0.4 });
  // A new character from the new-game builder has exactly the built-in skills and aptitudes.
  const fresh = newCharacter({ id: 'x', name: 'X' });
  assert.deepEqual(Object.keys(fresh.skills).sort(), [...SKILL_IDS].sort());
  assert.deepEqual(Object.keys(fresh.aptitudes).sort(), [...APTITUDE_IDS].sort());
});

// ---- creating ------------------------------------------------------------------------------

test('[characters.create.new-character] a new character gets the default record, today as birth day, and the custom skills approved so far', () => {
  const store = newStore();
  apply(store, (draft) => proposeDefinition(draft, { domainId: 'skill', definitionId: 'falconry', definitionData: { aptitudeDefinitionId: 'mobility', maxLevel: 10 } }));
  apply(store, (draft) => approveDefinition(draft, { domainId: 'skill', definitionId: 'falconry', expectedRevision: 0 }));
  apply(store, (draft) => { draft.calendar.day = 40; });
  const result = apply(store, (draft) => createCharacter(draft, person('anna', {
    identity: { name: 'Anna', cultureId: 'north', faithId: 'old_gods' },
    skills: { bow: 12 },
    aptitudes: { combat: 2 },
    traits: ['stubborn', 'brave'],
    standing: { reputation: 5 },
    condition: { health: 80 },
    location: { mode: 'settlement', settlementId: 'town_a' },
    customData: { note: 'x' },
  })));
  assert.equal(result.characterId, 'anna');
  const anna = character(store, 'anna');
  const fresh = newCharacter({ id: 'anna', name: 'Anna', birthDay: 40 });
  assert.equal(anna.identity.birthDay, 40);
  assert.equal(anna.identity.alive, true);
  assert.equal(anna.identity.cultureId, 'north');
  assert.equal(anna.skills.bow, 12);
  assert.equal(anna.skills.falconry, 0);
  assert.equal(anna.progression.skillExperience.falconry, 0);
  assert.equal(anna.aptitudes.combat, 2);
  assert.equal(anna.aptitudes.social, 1);
  assert.deepEqual(anna.traits, ['brave', 'stubborn']);
  assert.equal(anna.standing.reputation, 5);
  assert.equal(anna.condition.health, 80);
  assert.deepEqual(anna.location, { mode: 'settlement', mobileGroupId: null, prisonerOfId: null, settlementId: 'town_a' });
  assert.deepEqual(anna.titleIds, []);
  assert.deepEqual(anna.affiliations, fresh.affiliations);
  assert.equal(anna.revision, 0);
  assert.equal(anna.version, 1);
  assert.deepEqual(Object.keys(anna).sort(), Object.keys(fresh).sort());
  assert.deepEqual(getCharacter(store.getState(), 'anna'), anna);
  assert.deepEqual(listCharacters(store.getState()).map((c) => c.id), ['anna', PLAYER_CHARACTER_ID]);
  assert.equal(isAlive(store.getState(), 'anna'), true);
});

test('[characters.create.rejects-bad-input] a character with bad input, a taken id, or fields owned by other areas is refused', () => {
  const store = newStore();
  const cases = [
    ['characters_invalid_input', () => null],
    ['characters_invalid_character_id', () => person('Has Space')],
    ['characters_invalid_character_id', () => ({ identity: { name: 'No id' } })],
    ['characters_duplicate_character', () => person(PLAYER_CHARACTER_ID)],
    ['characters_unknown_field', () => person('x', { mood: 'sad' })],
    ['characters_protected_field', () => person('x', { titleIds: ['t'] })],
    ['characters_protected_field', () => person('x', { claimIds: [] })],
    ['characters_protected_field', () => person('x', { activity: {} })],
    ['characters_protected_field', () => person('x', { progression: {} })],
    ['characters_protected_field', () => person('x', { affiliations: { clanId: 'clan_a' } })],
    ['characters_protected_field', () => person('x', { affiliations: { factionId: 'faction_a' } })],
    ['characters_invalid_affiliations', () => person('x', { affiliations: { legalStatusId: 7 } })],
    ['characters_invalid_identity', () => ({ id: 'x' })],
    ['characters_invalid_identity', () => ({ id: 'x', identity: { name: 'X', alive: false } })],
    ['characters_invalid_identity', () => ({ id: 'x', identity: { name: 'X', deathDay: 3 } })],
    ['characters_invalid_name', () => ({ id: 'x', identity: { name: '   ' } })],
    ['characters_invalid_name', () => ({ id: 'x', identity: { name: 'N'.repeat(101) } })],
    ['characters_invalid_birth_day', () => ({ id: 'x', identity: { name: 'X', birthDay: -1 } })],
    ['characters_invalid_birth_day', () => ({ id: 'x', identity: { name: 'X', birthDay: 2 } })],
    ['characters_invalid_birth_day', () => ({ id: 'x', identity: { name: 'X', birthDay: 0.5 } })],
    ['characters_join_group_through_groups', () => person('x', { location: { mode: 'mobile_group' } })],
    ['characters_invalid_location', () => person('x', { location: { mode: 'orbit' } })],
    ['characters_invalid_location', () => person('x', { location: { mode: 'none', settlementId: 's' } })],
    ['characters_invalid_location', () => person('x', { location: { mode: 'settlement', mobileGroupId: PLAYER_GROUP_ID } })],
    ['characters_invalid_traits', () => person('x', { traits: ['a', 'a'] })],
    ['characters_invalid_offices', () => person('x', { offices: 'steward' })],
    ['characters_invalid_custom_data', () => person('x', { customData: [] })],
    ['characters_unknown_skill', () => person('x', { skills: { juggling: 1 } })],
    ['characters_invalid_skill_level', () => person('x', { skills: { bow: 101 } })],
    ['characters_invalid_skill_level', () => person('x', { skills: { bow: -1 } })],
    ['characters_invalid_skill_level', () => person('x', { skills: { bow: Number.NaN } })],
    ['characters_unknown_aptitude', () => person('x', { aptitudes: { luck: 1 } })],
    ['characters_invalid_aptitude', () => person('x', { aptitudes: { combat: -1 } })],
    ['characters_invalid_standing', () => person('x', { standing: { fame: 1 } })],
    ['characters_invalid_standing', () => person('x', { standing: { prestige: '5' } })],
    ['characters_invalid_health', () => person('x', { condition: { health: 'good' } })],
    ['characters_unknown_condition_field', () => person('x', { condition: { mood: 1 } })],
    ['characters_missing_account', () => person('x', { personalAccountId: 'no_such_account' })],
    ['characters_missing_inventory', () => person('x', { personalInventoryId: 'no_such_inventory' })],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => createCharacter(draft, input()), code);
});

test('[characters.create.links-existing-assets] a new character may point at an existing personal account and inventory', () => {
  const store = newStore();
  apply(store, (draft) => createCharacter(draft, person('anna', {
    personalAccountId: 'legacy_player_personal_account', personalInventoryId: 'legacy_player_group_inventory',
  })));
  assert.equal(character(store, 'anna').personalAccountId, 'legacy_player_personal_account');
  assert.equal(character(store, 'anna').personalInventoryId, 'legacy_player_group_inventory');
});

// ---- changing records -----------------------------------------------------------------------

test('[characters.profile.updates] only the given profile fields change, the revision goes up once, and asking for nothing new changes nothing', () => {
  const store = withPeople('anna');
  const result = apply(store, (draft) => updateProfile(draft, {
    characterId: 'anna', name: 'Anna of the North', cultureId: 'north', faithId: null, legalStatusId: 'freeborn',
    standing: { prestige: 4 }, traits: ['brave'], offices: ['steward'], customData: { mood: 'calm' },
  }));
  assert.equal(result.changed, true);
  const anna = character(store, 'anna');
  assert.equal(anna.identity.name, 'Anna of the North');
  assert.equal(anna.identity.cultureId, 'north');
  assert.equal(anna.affiliations.legalStatusId, 'freeborn');
  assert.deepEqual(anna.standing, { legitimacy: 0, prestige: 4, reputation: 0 });
  assert.deepEqual(anna.offices, ['steward']);
  assert.equal(anna.revision, 1);
  const again = apply(store, (draft) => updateProfile(draft, { characterId: 'anna', name: 'Anna of the North', traits: ['brave'] }));
  assert.equal(again.changed, false);
  assert.equal(character(store, 'anna').revision, 1);
  assert.equal(store.getState().revision, result.revision + 1);
});

test('[characters.profile.rejects-bad-input] a profile change with bad input or for a missing character is refused', () => {
  const store = withPeople('anna');
  const cases = [
    ['characters_invalid_input', { characterId: 'anna', name: 'x' }, null],
    ['characters_invalid_character_id', { characterId: 7 }],
    ['characters_missing_character', { characterId: 'nobody', name: 'x' }],
    ['characters_unknown_field', { characterId: 'anna', alive: false }],
    ['characters_unknown_field', { characterId: 'anna', titleIds: [] }],
    ['characters_invalid_name', { characterId: 'anna', name: '' }],
    ['characters_invalid_cultureId', { characterId: 'anna', cultureId: 5 }],
    ['characters_invalid_traits', { characterId: 'anna', traits: ['Bad Id'] }],
    ['characters_invalid_standing', { characterId: 'anna', standing: { prestige: 'high' } }],
    ['characters_invalid_standing', { characterId: 'anna', name: 'Changed', standing: { fame: 1 } }],
    ['characters_invalid_custom_data', { characterId: 'anna', customData: 'x' }],
  ];
  for (const [code, input, override] of cases) expectRejected(store, (draft) => updateProfile(draft, override === null ? null : input), code);
});

test('[characters.revision.expected] a change made against an out-of-date revision is refused', () => {
  const store = withPeople('anna');
  apply(store, (draft) => updateProfile(draft, { characterId: 'anna', name: 'Anna Two', expectedRevision: 0 }));
  expectRejected(store, (draft) => updateProfile(draft, { characterId: 'anna', name: 'Anna Three', expectedRevision: 0 }), 'characters_revision_conflict');
  expectRejected(store, (draft) => updateProfile(draft, { characterId: 'anna', name: 'Anna Three', expectedRevision: -1 }), 'characters_invalid_expected_revision');
  expectRejected(store, (draft) => setCondition(draft, { characterId: 'anna', patch: { fatigue: 5 }, expectedRevision: 0 }), 'characters_revision_conflict');
  expectRejected(store, (draft) => gainExperience(draft, { characterId: 'anna', skillId: 'bow', amount: 5, expectedRevision: 0 }), 'characters_revision_conflict');
  apply(store, (draft) => gainExperience(draft, { characterId: 'anna', skillId: 'bow', amount: 5, expectedRevision: 1 }));
  assert.equal(character(store, 'anna').revision, 2);
});

test('[characters.affiliation.sets-and-rejects] clan and faction can be set to existing ones, and a missing one or a bad request is refused', () => {
  const store = withPeople('anna');
  apply(store, (draft) => setAffiliations(draft, { characterId: 'anna', clanId: 'clan_a' }));
  apply(store, (draft) => setAffiliations(draft, { characterId: 'anna', factionId: 'faction_a' }));
  assert.deepEqual(character(store, 'anna').affiliations, { clanId: 'clan_a', factionId: 'faction_a', legalStatusId: null });
  assert.equal(apply(store, (draft) => setAffiliations(draft, { characterId: 'anna', clanId: 'clan_a' })).changed, false);
  apply(store, (draft) => setAffiliations(draft, { characterId: 'anna', clanId: null }));
  assert.equal(character(store, 'anna').affiliations.clanId, null);
  assert.equal(character(store, 'anna').affiliations.factionId, 'faction_a');
  const cases = [
    ['characters_missing_clan', { characterId: 'anna', clanId: 'clan_zzz' }],
    ['characters_missing_faction', { characterId: 'anna', factionId: 'faction_zzz' }],
    ['characters_missing_clan', { characterId: 'anna', clanId: 'constructor' }],
    ['characters_invalid_affiliations', { characterId: 'anna' }],
    ['characters_invalid_affiliations', { characterId: 'anna', clanId: 5 }],
    ['characters_unknown_field', { characterId: 'anna', clanId: 'clan_a', legalStatusId: 'x' }],
    ['characters_missing_character', { characterId: 'nobody', clanId: 'clan_a' }],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => setAffiliations(draft, input), code);
  // A bad faction must not leave a half-applied clan change behind.
  expectRejected(store, (draft) => setAffiliations(draft, { characterId: 'anna', clanId: 'clan_a', factionId: 'faction_zzz' }), 'characters_missing_faction');
});

test('[characters.index.title-and-claim] the title and claim lists are stored sorted without repeats, and bad lists are refused', () => {
  const store = withPeople('anna');
  apply(store, (draft) => setTitleIndex(draft, { characterId: 'anna', titleIds: ['title_b', 'title_a'] }));
  apply(store, (draft) => setClaimIndex(draft, { characterId: 'anna', claimIds: ['claim_1'] }));
  assert.deepEqual(character(store, 'anna').titleIds, ['title_a', 'title_b']);
  assert.deepEqual(character(store, 'anna').claimIds, ['claim_1']);
  assert.equal(apply(store, (draft) => setTitleIndex(draft, { characterId: 'anna', titleIds: ['title_a', 'title_b'] })).changed, false);
  expectRejected(store, (draft) => setTitleIndex(draft, { characterId: 'anna', titleIds: ['a', 'a'] }), 'characters_invalid_titleIds');
  expectRejected(store, (draft) => setTitleIndex(draft, { characterId: 'anna', titleIds: 'a' }), 'characters_invalid_titleIds');
  expectRejected(store, (draft) => setClaimIndex(draft, { characterId: 'anna', claimIds: [1] }), 'characters_invalid_claimIds');
  expectRejected(store, (draft) => setClaimIndex(draft, { characterId: 'nobody', claimIds: [] }), 'characters_missing_character');
});

test('[characters.assets.personal] the personal account and inventory can be pointed at existing records and cleared; missing ones are refused', () => {
  const store = withPeople('anna');
  apply(store, (draft) => setPersonalAssets(draft, { characterId: 'anna', personalAccountId: 'legacy_player_personal_account', personalInventoryId: 'legacy_player_group_inventory' }));
  assert.equal(character(store, 'anna').personalAccountId, 'legacy_player_personal_account');
  assert.equal(apply(store, (draft) => setPersonalAssets(draft, { characterId: 'anna', personalAccountId: 'legacy_player_personal_account' })).changed, false);
  apply(store, (draft) => setPersonalAssets(draft, { characterId: 'anna', personalAccountId: null }));
  assert.equal(character(store, 'anna').personalAccountId, null);
  expectRejected(store, (draft) => setPersonalAssets(draft, { characterId: 'anna', personalAccountId: 'no_such_account' }), 'characters_missing_account');
  expectRejected(store, (draft) => setPersonalAssets(draft, { characterId: 'anna', personalInventoryId: 'no_such_inventory' }), 'characters_missing_inventory');
  expectRejected(store, (draft) => setPersonalAssets(draft, { characterId: 'anna' }), 'characters_invalid_input');
  expectRejected(store, (draft) => setPersonalAssets(draft, { characterId: 'anna', personalAccountId: 5 }), 'characters_invalid_personalAccountId');
  expectRejected(store, (draft) => setPersonalAssets(draft, { characterId: 'anna', gold: 5 }), 'characters_unknown_field');
});

test('[characters.location.settlement] a character outside any group can be placed in a settlement or nowhere, but not one who travels with a group', () => {
  const store = withPeople('anna');
  apply(store, (draft) => placeInSettlement(draft, { characterId: 'anna', settlementId: 'town_a' }));
  assert.deepEqual(character(store, 'anna').location, { mode: 'settlement', mobileGroupId: null, prisonerOfId: null, settlementId: 'town_a' });
  assert.equal(apply(store, (draft) => placeInSettlement(draft, { characterId: 'anna', settlementId: 'town_a' })).changed, false);
  apply(store, (draft) => placeInSettlement(draft, { characterId: 'anna', settlementId: null }));
  assert.equal(character(store, 'anna').location.mode, 'none');
  expectRejected(store, (draft) => placeInSettlement(draft, { characterId: PLAYER_CHARACTER_ID, settlementId: 'town_a' }), 'characters_in_group');
  expectRejected(store, (draft) => placeInSettlement(draft, { characterId: 'anna', settlementId: 'Bad Id' }), 'characters_invalid_settlement_id');
  expectRejected(store, (draft) => placeInSettlement(draft, { characterId: 'anna' }), 'characters_invalid_settlement_id');
});

test('[characters.location.group-side] the character side of a group link is set only to a group that exists, with a matching mode', () => {
  const store = withPeople('anna');
  expectRejected(store, (draft) => setGroupLocation(draft, { characterId: 'anna', mobileGroupId: 'no_such_group' }), 'characters_missing_group');
  expectRejected(store, (draft) => setGroupLocation(draft, { characterId: 'anna', mobileGroupId: 5 }), 'characters_invalid_group_id');
  expectRejected(store, (draft) => setGroupLocation(draft, { characterId: 'nobody', mobileGroupId: null }), 'characters_missing_character');
  assert.equal(apply(store, (draft) => setGroupLocation(draft, { characterId: 'anna', mobileGroupId: null })).changed, false);
  // The group rules change both sides together; on its own, the character side alone would not pass the checks.
  const draft = clone(store.getState());
  assert.equal(setGroupLocation(draft, { characterId: 'anna', mobileGroupId: PLAYER_GROUP_ID }).changed, true);
  assert.deepEqual(draft.world.characters.anna.location, { mode: 'mobile_group', mobileGroupId: PLAYER_GROUP_ID, settlementId: null, prisonerOfId: null });
  assert.equal(draft.world.characters.anna.revision, 1);
  assert.equal(setGroupLocation(draft, { characterId: 'anna', mobileGroupId: null }).changed, true);
  assert.equal(draft.world.characters.anna.location.mode, 'none');
});

// ---- condition, age -------------------------------------------------------------------------

test('[characters.condition.clamps-and-flags] health and fatigue stay within 0 to 100, injuries make a character wounded, and exhaustion incapacitates', () => {
  const store = withPeople('anna');
  apply(store, (draft) => setCondition(draft, { characterId: 'anna', patch: { health: 150, fatigue: -20 } }));
  assert.deepEqual([character(store, 'anna').condition.health, character(store, 'anna').condition.fatigue], [100, 0]);
  apply(store, (draft) => setCondition(draft, { characterId: 'anna', patch: { injuries: [{ severity: 30, typeId: 'cut' }] } }));
  assert.equal(character(store, 'anna').condition.wounded, true);
  assert.equal(character(store, 'anna').condition.incapacitated, false);
  apply(store, (draft) => setCondition(draft, { characterId: 'anna', patch: { fatigue: 100 } }));
  assert.equal(character(store, 'anna').condition.incapacitated, true);
  // The two flags stay set until a patch clears them (and the cause is gone), as in the earlier version.
  apply(store, (draft) => setCondition(draft, { characterId: 'anna', patch: { fatigue: 10 } }));
  assert.equal(character(store, 'anna').condition.incapacitated, true);
  apply(store, (draft) => setCondition(draft, { characterId: 'anna', patch: { incapacitated: false, injuries: [], wounded: false } }));
  assert.equal(character(store, 'anna').condition.incapacitated, false);
  assert.equal(character(store, 'anna').condition.wounded, false);
  apply(store, (draft) => setCondition(draft, { characterId: 'anna', patch: { health: 0, incapacitated: false } }));
  assert.equal(character(store, 'anna').condition.incapacitated, true);
  const revision = character(store, 'anna').revision;
  assert.equal(apply(store, (draft) => setCondition(draft, { characterId: 'anna', patch: { health: 0 } })).changed, false);
  assert.equal(character(store, 'anna').revision, revision);
});

test('[characters.condition.rejects-bad-patch] a condition change with bad values, unknown fields or for a missing character is refused', () => {
  const store = withPeople('anna');
  const cases = [
    ['characters_invalid_input', null],
    ['characters_missing_character', { characterId: 'nobody', patch: { health: 5 } }],
    ['characters_invalid_condition_patch', { characterId: 'anna', patch: {} }],
    ['characters_invalid_condition_patch', { characterId: 'anna', patch: 'weak' }],
    ['characters_unknown_condition_field', { characterId: 'anna', patch: { mood: 1 } }],
    ['characters_invalid_health', { characterId: 'anna', patch: { health: '50' } }],
    ['characters_invalid_health', { characterId: 'anna', patch: { health: Number.POSITIVE_INFINITY } }],
    ['characters_invalid_fatigue', { characterId: 'anna', patch: { fatigue: Number.NaN } }],
    ['characters_invalid_wounded', { characterId: 'anna', patch: { wounded: 1 } }],
    ['characters_invalid_incapacitated', { characterId: 'anna', patch: { incapacitated: 'no' } }],
    ['characters_invalid_injuries', { characterId: 'anna', patch: { injuries: 'cut' } }],
    ['characters_invalid_injuries', { characterId: 'anna', patch: { injuries: [{ severity: -1 }] } }],
    ['characters_invalid_injuries', { characterId: 'anna', patch: { injuries: ['cut'] } }],
    ['characters_invalid_health', { characterId: 'anna', patch: { fatigue: 5, health: 'x' } }],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => setCondition(draft, input), code);
});

test('[characters.condition.modifiers] health, fatigue, injuries and old age each scale what a character can do, within their limits', () => {
  const base = newCharacter({ id: 'x', name: 'X' });
  assert.deepEqual(getModifiers(base, 100), { healthFactor: 1, fatigueFactor: 1, injuryFactor: 1, ageFactor: 1, combined: 1 });
  const hurt = clone(base);
  Object.assign(hurt.condition, { health: 50, fatigue: 75, injuries: [{ severity: 100 }] });
  const day70 = 70 * 365;
  const modifiers = getModifiers(hurt, day70);
  near(modifiers.healthFactor, 0.5);
  near(modifiers.fatigueFactor, 0.5);
  near(modifiers.injuryFactor, 0.75);
  near(modifiers.ageFactor, 0.9);
  near(modifiers.combined, 0.5 * 0.5 * 0.75 * 0.9);
  const extreme = clone(base);
  Object.assign(extreme.condition, { health: 0, fatigue: 100, injuries: [{ severity: 5000 }] });
  const floor = getModifiers(extreme, 200 * 365);
  assert.equal(floor.healthFactor, 0);
  near(floor.fatigueFactor, 1 / 3);
  near(floor.injuryFactor, 0.25);
  near(floor.ageFactor, 0.5);
  near(getAge(base, 730), 2);
  const dead = clone(base);
  Object.assign(dead.identity, { alive: false, deathDay: 365 });
  near(getAge(dead, 9999), 1);
  assert.equal(getAge(null, 1), null);
});

// ---- experience -----------------------------------------------------------------------------

test('[characters.experience.levels-up] experience adds up per skill and source, and every full 100 points raise the level by one', () => {
  const store = withPeople('anna');
  const first = apply(store, (draft) => gainExperience(draft, { characterId: 'anna', skillId: 'bow', amount: 60, tags: ['practice'], customData: { place: 'yard' } }));
  near(first.amount, 60);
  assert.equal(first.level, 0);
  const second = apply(store, (draft) => gainExperience(draft, { characterId: 'anna', skillId: 'bow', amount: 60, day: 3 }));
  assert.equal(second.level, 1);
  assert.equal(second.levelsGained, 1);
  const big = apply(store, (draft) => gainExperience(draft, { characterId: 'anna', skillId: 'bow', amount: 250, sourceTypeId: 'education', sourceRef: { type: 'clan', id: 'clan_a' } }));
  assert.equal(big.level, 3);
  const anna = character(store, 'anna');
  near(anna.progression.skillExperience.bow, 370);
  assert.equal(anna.skills.bow, 3);
  near(anna.progression.sourceTotals.action, 120);
  near(anna.progression.sourceTotals.education, 250);
  assert.equal(anna.progression.records.length, 3);
  assert.deepEqual(anna.progression.records[0], { sourceTypeId: 'action', skillDefinitionId: 'bow', amount: 60, day: 1, sourceRef: null, tags: ['practice'], customData: { place: 'yard' } });
  assert.equal(anna.progression.records[1].day, 3);
  assert.deepEqual(anna.progression.records[2].sourceRef, { type: 'clan', id: 'clan_a' });
  assert.equal(anna.revision, 3);
  assert.equal(XP_PER_LEVEL, 100);
  assert.equal(apply(store, (draft) => gainFromEducation(draft, { characterId: 'anna', skillId: 'learning', amount: 10 })).amount, 10);
  assert.equal(character(store, 'anna').progression.records.at(-1).sourceTypeId, 'education');
});

test('[characters.experience.modifiers] a gain is scaled by difficulty, repetition, failure and aptitude, with their floors', () => {
  const store = withPeople('anna');
  store.transact('setup', (draft) => { draft.world.characters.anna.aptitudes.combat = 2; draft.world.characters.anna.aptitudes.social = 0; });
  const gain = (input) => apply(store, (draft) => gainExperience(draft, { characterId: 'anna', ...input })).amount;
  near(gain({ skillId: 'bow', amount: 10, difficulty: 1.5 }), 10 * 1.5 * 2, 'difficulty and aptitude');
  near(gain({ skillId: 'bow', amount: 10, success: false }), 10 * 0.35 * 2, 'failure');
  near(gain({ skillId: 'charm', amount: 10 }), 10 * 0.1, 'aptitude floor of 0.1');
  near(gain({ skillId: 'riding', amount: 10, repetitionKey: 'ride' }), 10, 'first repeat');
  near(gain({ skillId: 'riding', amount: 10, repetitionKey: 'ride' }), 10 / 1.25, 'second time');
  near(gain({ skillId: 'riding', amount: 10, repetitionKey: 'ride' }), 10 / 1.5, 'third time');
  assert.equal(character(store, 'anna').progression.repetition.ride, 3);
  near(gain({ skillId: 'riding', amount: 10, repetitionKey: 'other' }), 10, 'another key starts fresh');
});

test('[characters.experience.max-level] a skill never goes above its maximum level, although experience keeps adding up', () => {
  const store = withPeople('anna');
  apply(store, (draft) => gainExperience(draft, { characterId: 'anna', skillId: 'bow', amount: 9000 }));
  assert.equal(character(store, 'anna').skills.bow, 90);
  apply(store, (draft) => gainExperience(draft, { characterId: 'anna', skillId: 'bow', amount: 3000 }));
  assert.equal(character(store, 'anna').skills.bow, 100);
  apply(store, (draft) => gainExperience(draft, { characterId: 'anna', skillId: 'bow', amount: 500 }));
  assert.equal(character(store, 'anna').skills.bow, 100);
  near(character(store, 'anna').progression.skillExperience.bow, 12500);
  assert.deepEqual(checkCharacters(store.getState()), { ok: true });
});

test('[characters.experience.custom-definitions] an approved custom skill, aptitude and growth source work like built-in ones, with their own limits', () => {
  const store = withPeople('anna');
  const approve = (domainId, definitionId, definitionData) => {
    apply(store, (draft) => proposeDefinition(draft, { domainId, definitionId, definitionData }));
    apply(store, (draft) => approveDefinition(draft, { domainId, definitionId, expectedRevision: 0 }));
  };
  // A skill needs an existing aptitude, and a broken one is refused when proposed.
  const refused = store.transact('bad', (draft) => proposeDefinition(draft, { domainId: 'skill', definitionId: 'bad', definitionData: { aptitudeDefinitionId: 'luck' } }));
  assert.equal(refused.error, 'definitions_invalid_definition');
  const refuse = (domainId, definitionId, definitionData) => {
    assert.equal(store.transact('bad', (draft) => proposeDefinition(draft, { domainId, definitionId, definitionData })).error, 'definitions_invalid_definition', `${domainId}:${definitionId}`);
  };
  refuse('skill', 'zero_max', { aptitudeDefinitionId: 'combat', maxLevel: 0 });
  refuse('skill', 'bad_default', { aptitudeDefinitionId: 'combat', maxLevel: 10, defaultLevel: 11 });
  refuse('aptitude', 'bad_aptitude', { defaultValue: 'high' });
  refuse('growth_source', 'free_lunch', { baseMultiplier: 0 });
  refuse('derived_rating', 'empty_rating', { weights: {} });
  refuse('derived_rating', 'unknown_skill_rating', { weights: { juggling: 1 } });
  refuse('derived_rating', 'negative_rating', { weights: { bow: -1 } });
  approve('aptitude', 'cunning', { defaultValue: 3 });
  approve('skill', 'falconry', { aptitudeDefinitionId: 'cunning', maxLevel: 5 });
  approve('growth_source', 'mentor', { baseMultiplier: 2 });
  // Not yet known to this character, which has no entry for it: defaults apply.
  const gained = apply(store, (draft) => gainExperience(draft, { characterId: 'anna', skillId: 'falconry', amount: 100, sourceTypeId: 'mentor' }));
  near(gained.amount, 100 * 2 * 3, 'growth multiplier and the aptitude default');
  assert.equal(gained.level, 5);
  assert.equal(character(store, 'anna').skills.falconry, 5);
  near(character(store, 'anna').progression.sourceTotals.mentor, 600);
  assert.deepEqual(checkCharacters(store.getState()), { ok: true });
  expectRejected(store, (draft) => createCharacter(draft, person('bert', { skills: { falconry: 6 } })), 'characters_invalid_skill_level');
  const bert = apply(store, (draft) => createCharacter(draft, person('bert', { skills: { falconry: 5 } })));
  assert.equal(bert.characterId, 'bert');
  assert.equal(character(store, 'bert').aptitudes.cunning, 3);
});

test('[characters.experience.rejects-bad-input] experience with bad input, for a dead or missing character, or too easy a task is refused', () => {
  const store = withPeople('anna', 'old_bob');
  store.transact('death', (draft) => recordDeath(draft, { characterId: 'old_bob' }));
  const gain = (input) => (draft) => gainExperience(draft, input);
  const cases = [
    ['characters_invalid_input', null],
    ['characters_invalid_input', { characterId: 'anna', skillId: 5, amount: 1 }],
    ['characters_invalid_input', { characterId: 'anna', skillId: 'bow', amount: 1, success: 'yes' }],
    ['characters_invalid_experience_amount', { characterId: 'anna', skillId: 'bow', amount: 0 }],
    ['characters_invalid_experience_amount', { characterId: 'anna', skillId: 'bow', amount: -4 }],
    ['characters_invalid_experience_amount', { characterId: 'anna', skillId: 'bow', amount: Number.NaN }],
    ['characters_invalid_experience_amount', { characterId: 'anna', skillId: 'bow', amount: '5' }],
    ['characters_invalid_difficulty', { characterId: 'anna', skillId: 'bow', amount: 1, difficulty: 'hard' }],
    ['characters_insufficient_difficulty', { characterId: 'anna', skillId: 'bow', amount: 1, difficulty: 0.09 }],
    ['characters_insufficient_difficulty', { characterId: 'anna', skillId: 'bow', amount: 1, difficulty: -1 }],
    ['characters_invalid_day', { characterId: 'anna', skillId: 'bow', amount: 1, day: -1 }],
    ['characters_invalid_day', { characterId: 'anna', skillId: 'bow', amount: 1, day: 1.5 }],
    ['characters_invalid_source_ref', { characterId: 'anna', skillId: 'bow', amount: 1, sourceRef: 'clan' }],
    ['characters_invalid_tags', { characterId: 'anna', skillId: 'bow', amount: 1, tags: 'x' }],
    ['characters_invalid_tags', { characterId: 'anna', skillId: 'bow', amount: 1, tags: [''] }],
    ['characters_invalid_custom_data', { characterId: 'anna', skillId: 'bow', amount: 1, customData: [] }],
    ['characters_invalid_repetition_key', { characterId: 'anna', skillId: 'bow', amount: 1, repetitionKey: '' }],
    ['characters_invalid_repetition_key', { characterId: 'anna', skillId: 'bow', amount: 1, repetitionKey: 5 }],
    ['characters_unknown_skill', { characterId: 'anna', skillId: 'juggling', amount: 1 }],
    ['characters_unknown_growth_source', { characterId: 'anna', skillId: 'bow', amount: 1, sourceTypeId: 'dreams' }],
    ['characters_missing_character', { characterId: 'nobody', skillId: 'bow', amount: 1 }],
    ['characters_not_alive', { characterId: 'old_bob', skillId: 'bow', amount: 1 }],
  ];
  for (const [code, input] of cases) expectRejected(store, gain(input), code);
});

test('[characters.ratings.derived] a rating is the weighted average of its skills, scaled by the character\'s condition', () => {
  const store = withPeople('anna');
  store.transact('skills', (draft) => { Object.assign(draft.world.characters.anna.skills, { one_handed: 40, athletics: 20, command: 60 }); });
  const ratings = getDerivedRatings(store.getState(), 'anna', 100);
  near(ratings.combat_rating, 40 * 0.15 + 20 * 0.2);
  near(ratings.command_rating, 60 * 0.35);
  near(ratings.social_rating, 0);
  assert.deepEqual(Object.keys(ratings).sort(), DERIVED_RATINGS.map((rating) => rating.id).sort());
  store.transact('hurt', (draft) => { draft.world.characters.anna.condition.health = 50; });
  near(getDerivedRatings(store.getState(), 'anna', 100).combat_rating, (40 * 0.15 + 20 * 0.2) * 0.5);
  assert.equal(getDerivedRatings(store.getState(), 'nobody', 100), null);
});

// ---- death ----------------------------------------------------------------------------------

test('[characters.death.records] a death sets the day and leaves the character dead, once, within their lifetime', () => {
  const store = withPeople('anna');
  store.transact('time', (draft) => { draft.calendar.day = 50; draft.world.characters.anna.identity.birthDay = 10; });
  const cases = [
    ['characters_invalid_death_day', { characterId: 'anna', day: 51 }],
    ['characters_invalid_death_day', { characterId: 'anna', day: 9 }],
    ['characters_invalid_death_day', { characterId: 'anna', day: -1 }],
    ['characters_invalid_death_day', { characterId: 'anna', day: 'soon' }],
    ['characters_missing_character', { characterId: 'nobody' }],
    ['characters_invalid_input', null],
  ];
  for (const [code, input] of cases) expectRejected(store, (draft) => recordDeath(draft, input), code);
  const result = apply(store, (draft) => recordDeath(draft, { characterId: 'anna', day: 30 }));
  assert.equal(result.deathDay, 30);
  const anna = character(store, 'anna');
  assert.deepEqual([anna.identity.alive, anna.identity.deathDay, anna.condition.health, anna.condition.incapacitated], [false, 30, 0, true]);
  assert.equal(isAlive(store.getState(), 'anna'), false);
  expectRejected(store, (draft) => recordDeath(draft, { characterId: 'anna' }), 'characters_already_dead');
  assert.equal(apply(store, (draft) => recordDeath(draft, { characterId: PLAYER_CHARACTER_ID })).deathDay, 50);
});

// ---- checks ---------------------------------------------------------------------------------

test('[characters.check.rejects-bad-records] a saved game with a damaged character record is refused, naming the problem', () => {
  const base = () => {
    const state = newGameState();
    state.world.clans.clan_a = { id: 'clan_a' };
    state.world.characters.anna = newCharacter({ id: 'anna', name: 'Anna' });
    return state;
  };
  assert.deepEqual(checkCharacters(base()), { ok: true });
  const damage = [
    ['record_id_mismatch', (s) => { s.world.characters.anna.id = 'bert'; }],
    ['invalid_map_key', (s) => { s.world.characters['Bad Key'] = { ...s.world.characters.anna, id: 'Bad Key' }; }],
    ['record_id_mismatch', (s) => { s.world.characters.anna = 5; }],
    ['unsupported_version', (s) => { s.world.characters.anna.version = 2; }],
    ['invalid_revision', (s) => { s.world.characters.anna.revision = -1; }],
    ['legacy_activity_field', (s) => { s.world.characters.anna.activity = {}; }],
    ['invalid_identity', (s) => { s.world.characters.anna.identity.name = 5; }],
    ['alive_and_death_day_disagree', (s) => { s.world.characters.anna.identity.alive = false; }],
    ['alive_and_death_day_disagree', (s) => { s.world.characters.anna.identity.deathDay = 5; }],
    ['invalid_death_day', (s) => { Object.assign(s.world.characters.anna.identity, { alive: false, birthDay: 10, deathDay: 5 }); }],
    ['invalid_affiliations', (s) => { s.world.characters.anna.affiliations.clanId = 5; }],
    ['missing_clan', (s) => { s.world.characters.anna.affiliations.clanId = 'clan_zzz'; }],
    ['missing_faction', (s) => { s.world.characters.anna.affiliations.factionId = 'faction_zzz'; }],
    ['invalid_health', (s) => { s.world.characters.anna.condition.health = 101; }],
    ['invalid_fatigue', (s) => { s.world.characters.anna.condition.fatigue = -1; }],
    ['invalid_injuries', (s) => { s.world.characters.anna.condition.injuries = [{ severity: 'bad' }]; }],
    ['skills:unregistered:juggling', (s) => { s.world.characters.anna.skills.juggling = 1; }],
    ['skills:invalid_value:bow', (s) => { s.world.characters.anna.skills.bow = 101; }],
    ['aptitudes:unregistered:luck', (s) => { s.world.characters.anna.aptitudes.luck = 1; }],
    ['aptitudes:invalid_value:combat', (s) => { s.world.characters.anna.aptitudes.combat = -1; }],
    ['skill_experience:unregistered:juggling', (s) => { s.world.characters.anna.progression.skillExperience.juggling = 1; }],
    ['source_totals:unregistered:dreams', (s) => { s.world.characters.anna.progression.sourceTotals.dreams = 1; }],
    ['invalid_repetition', (s) => { s.world.characters.anna.progression.repetition.k = -1; }],
    ['invalid_record_entry', (s) => { s.world.characters.anna.progression.records.push({ skillDefinitionId: 'nope' }); }],
    ['invalid_standing', (s) => { s.world.characters.anna.standing.prestige = 'x'; }],
    ['invalid_titleIds', (s) => { s.world.characters.anna.titleIds = ['a', 'a']; }],
    ['invalid_traits', (s) => { s.world.characters.anna.traits = 'x'; }],
    ['invalid_custom_data', (s) => { s.world.characters.anna.customData = []; }],
    ['missing_personal_account', (s) => { s.world.characters.anna.personalAccountId = 'no_such_account'; }],
    ['missing_personal_inventory', (s) => { s.world.characters.anna.personalInventoryId = 'no_such_inventory'; }],
    ['invalid_location', (s) => { s.world.characters.anna.location.mode = 'orbit'; }],
    ['location_mode_and_group_disagree', (s) => { s.world.characters.anna.location.mode = 'mobile_group'; }],
    ['location_mode_and_group_disagree', (s) => { s.world.characters.anna.location.mobileGroupId = PLAYER_GROUP_ID; }],
    ['group_does_not_list_character', (s) => { Object.assign(s.world.characters.anna.location, { mode: 'mobile_group', mobileGroupId: PLAYER_GROUP_ID }); }],
    ['missing_group', (s) => { Object.assign(s.world.characters.anna.location, { mode: 'mobile_group', mobileGroupId: 'no_group' }); }],
  ];
  for (const [fragment, edit] of damage) {
    const state = base();
    edit(state);
    const result = checkCharacters(state);
    assert.equal(result.ok, false, fragment);
    assert.ok(JSON.stringify(result.detail).includes(fragment), `${fragment} not in ${JSON.stringify(result.detail)}`);
  }
  const state = base();
  state.world.characters = [];
  assert.equal(checkCharacters(state).error, 'characters_invalid_root');
});

test('[characters.check.group-link-two-way] a character in a group must be listed by that group, and the checks run on every change', () => {
  const store = withPeople('anna');
  const refused = store.transact('one-sided', (draft) => {
    draft.world.characters.anna.location = { mode: 'mobile_group', mobileGroupId: PLAYER_GROUP_ID, settlementId: null, prisonerOfId: null };
  });
  assert.equal(refused.error, 'store_state_invalid');
  assert.equal(character(store, 'anna').location.mode, 'none');
});

// ---- NPC activity ---------------------------------------------------------------------------

const activityStore = () => withPeople('npc_a', 'npc_b', 'npc_c');
const profile = (store, id) => getProfile(store.getState(), id);
const tierChange = (store, input) => apply(store, (draft) => changeTiers(draft, { sourceEventId: 'event_1', effectiveDay: 5, ...input }));
const root = (store) => store.getState().world.npcActivityProfiles;
// Moves a character down a tier: first they must be marked as eligible, then the move is allowed.
const demote = (store, id, tier) => {
  tierChange(store, { effectiveDay: 1, changes: [{ characterId: id, nextTier: profile(store, id).tier, demotionEligibleDay: 0 }] });
  tierChange(store, { effectiveDay: 1, changes: [{ characterId: id, nextTier: tier }] });
};

test('[characters.activity.default-profile] a character without a stored profile has the default one, and a missing character has none', () => {
  const store = activityStore();
  assert.deepEqual(profile(store, 'npc_a'), defaultProfile('npc_a'));
  assert.equal(profile(store, 'nobody'), null);
  assert.equal(profile(store, 7), null);
  assert.deepEqual(root(store), { version: 1, revision: 0, records: {} });
  const changed = profile(store, 'npc_a');
  changed.tier = 'historical';
  assert.equal(profile(store, 'npc_a').tier, 'active_named');
});

test('[characters.activity.tier-changes] a character moves up freely, but down only when eligible and never below a role, a pin or a post', () => {
  const store = activityStore();
  tierChange(store, { changes: [{ characterId: 'npc_a', nextTier: 'active_major', importanceScore: 500, addReasonIds: ['war_hero', 'duelist'] }] });
  assert.deepEqual(profile(store, 'npc_a'), {
    characterId: 'npc_a', tier: 'active_major', importanceScore: 500, nextProcessDay: 1, lastProcessedDay: 0,
    promotionReasonIds: ['duelist', 'war_hero'], stableRoleKeys: [], demotionEligibleDay: null, pinnedTierFloor: null, revision: 0,
  });
  assert.equal(root(store).revision, 1);
  const demote = (id, tier, effectiveDay = 5) => (draft) => changeTiers(draft, { sourceEventId: 'event_2', effectiveDay, changes: [{ characterId: id, nextTier: tier }] });
  expectRejected(store, demote('npc_a', 'active_named'), 'activity_demotion_not_eligible');
  tierChange(store, { changes: [{ characterId: 'npc_a', nextTier: 'active_major', demotionEligibleDay: 10 }] });
  expectRejected(store, demote('npc_a', 'active_named', 9), 'activity_demotion_not_eligible');
  tierChange(store, { effectiveDay: 10, changes: [{ characterId: 'npc_a', nextTier: 'active_named', removeReasonIds: ['duelist'] }] });
  assert.equal(profile(store, 'npc_a').tier, 'active_named');
  assert.deepEqual(profile(store, 'npc_a').promotionReasonIds, ['war_hero']);

  // A stable role keeps a character at "named" or above.
  apply(store, (draft) => applyRoleEffects(draft, { sourceEventId: 'event_3', eventDay: 4, effects: [{ characterId: 'npc_b', addRoleKeys: ['clan_head_a'] }] }));
  tierChange(store, { changes: [{ characterId: 'npc_b', nextTier: 'active_named', demotionEligibleDay: 0 }] });
  expectRejected(store, demote('npc_b', 'inactive_named'), 'activity_role_floor_violation');
  // A pinned floor does too.
  tierChange(store, { changes: [{ characterId: 'npc_c', nextTier: 'active_major', pinnedTierFloor: 'active_major', demotionEligibleDay: 0 }] });
  expectRejected(store, demote('npc_c', 'active_named'), 'activity_pin_floor_violation');
  // Pinning above the current tier, in the same request, is refused too.
  expectRejected(store, (draft) => changeTiers(draft, { sourceEventId: 'event_4', effectiveDay: 5, changes: [{ characterId: 'npc_a', nextTier: 'active_named', pinnedTierFloor: 'active_major' }] }), 'activity_pin_floor_violation');
});

test('[characters.activity.historical-blocked] a character becomes historical only when no role, pin or post refers to them', () => {
  const store = activityStore();
  store.transact('clan head', (draft) => { draft.world.clans.clan_a = { id: 'clan_a', headCharacterId: 'npc_a' }; });
  store.transact('ruler', (draft) => { draft.world.factions.faction_a = { id: 'faction_a', rulerCharacterId: 'npc_b' }; });
  store.transact('title', (draft) => { draft.world.titles.title_a = { id: 'title_a', statusId: 'active', holderRef: { type: 'character', id: 'npc_c' } }; });
  store.transact('ex-title', (draft) => { draft.world.titles.title_b = { id: 'title_b', statusId: 'vacant', holderRef: { type: 'character', id: 'npc_d' } }; });
  store.transact('clan-title', (draft) => { draft.world.titles.title_c = { id: 'title_c', statusId: 'active', holderRef: { type: 'clan', id: 'npc_d' } }; });
  store.transact('npc_d', (draft) => { draft.world.characters.npc_d = newCharacter({ id: 'npc_d', name: 'D' }); });
  store.transact('npc_e', (draft) => { draft.world.characters.npc_e = newCharacter({ id: 'npc_e', name: 'E' }); });
  const toHistorical = (id) => (draft) => changeTiers(draft, { sourceEventId: 'event_9', effectiveDay: 1, changes: [{ characterId: id, nextTier: 'historical', demotionEligibleDay: 0 }] });
  tierChange(store, { changes: ['npc_a', 'npc_b', 'npc_c', 'npc_d', 'npc_e', PLAYER_CHARACTER_ID].map((id) => ({ characterId: id, nextTier: 'active_named', demotionEligibleDay: 0 })) });
  for (const id of ['npc_a', 'npc_b', 'npc_c', PLAYER_CHARACTER_ID]) expectRejected(store, toHistorical(id), 'activity_historical_reference_blocked');
  apply(store, toHistorical('npc_d'));
  assert.equal(profile(store, 'npc_d').tier, 'historical');
  // A historical character cannot be pinned, which would give a character nobody looks at a floor above that.
  expectRejected(store, (draft) => changeTiers(draft, { sourceEventId: 'event_11', effectiveDay: 1, changes: [{ characterId: 'npc_d', nextTier: 'historical', pinnedTierFloor: 'inactive_named' }] }), 'activity_historical_reference_blocked');
  // A stable role also blocks it, once the character is marked eligible again.
  apply(store, (draft) => applyRoleEffects(draft, { sourceEventId: 'event_10', eventDay: 1, effects: [{ characterId: 'npc_e', addRoleKeys: ['steward'] }] }));
  expectRejected(store, toHistorical('npc_e'), 'activity_demotion_not_eligible');
  tierChange(store, { effectiveDay: 1, changes: [{ characterId: 'npc_e', nextTier: 'active_named', demotionEligibleDay: 0 }] });
  expectRejected(store, toHistorical('npc_e'), 'activity_role_floor_violation');
});

test('[characters.activity.tier-change-input] tier changes with bad input, a stale revision or one bad entry among good ones change nothing', () => {
  const store = activityStore();
  tierChange(store, { changes: [{ characterId: 'npc_a', nextTier: 'active_major' }] });
  const change = (changes, extra = {}) => (draft) => changeTiers(draft, { sourceEventId: 'event_5', effectiveDay: 5, changes, ...extra });
  const cases = [
    ['activity_invalid_input', (draft) => changeTiers(draft, null)],
    ['activity_invalid_input', (draft) => changeTiers(draft, { sourceEventId: 'Bad Id', effectiveDay: 5, changes: [{ characterId: 'npc_a', nextTier: 'active_major' }] })],
    ['activity_invalid_input', (draft) => changeTiers(draft, { sourceEventId: 'e', effectiveDay: -1, changes: [{ characterId: 'npc_a', nextTier: 'active_major' }] })],
    ['activity_invalid_input', change([])],
    ['activity_invalid_input', change('npc_a')],
    ['activity_invalid_input', change([{ characterId: 'npc_a', nextTier: 'active_major' }, { characterId: 'npc_a', nextTier: 'active_major' }])],
    ['activity_invalid_input', change([{ characterId: 'npc_a', nextTier: 'active_major', mood: 1 }])],
    ['activity_invalid_input', change([{ characterId: 'npc_a', nextTier: 'active_major', addReasonIds: ['x'], removeReasonIds: ['x'] }])],
    ['activity_invalid_input', change([{ characterId: 'npc_a', nextTier: 'active_major', addReasonIds: 'x' }])],
    ['activity_invalid_input', change([{ characterId: 'npc_a', nextTier: 'active_major', importanceScore: 1001 }])],
    ['activity_invalid_input', change([{ characterId: 'npc_a', nextTier: 'active_major', importanceScore: -1 }])],
    ['activity_invalid_input', change([{ characterId: 'npc_a', nextTier: 'active_major', demotionEligibleDay: -2 }])],
    ['activity_invalid_input', change([{ characterId: 'npc_a', nextTier: 'active_major', pinnedTierFloor: 'historical' }])],
    ['activity_invalid_input', change([{ characterId: 'npc_a', nextTier: 'active_major', expectedRecordRevision: 'x' }])],
    ['activity_invalid_tier', change([{ characterId: 'npc_a', nextTier: 'legendary' }])],
    ['activity_missing_character', change([{ characterId: 'nobody', nextTier: 'active_major' }])],
    ['activity_revision_conflict', change([{ characterId: 'npc_a', nextTier: 'active_major', importanceScore: 9, expectedRecordRevision: 7 }])],
    ['activity_revision_conflict', change([{ characterId: 'npc_b', nextTier: 'active_major', expectedRecordRevision: 0 }])],
    // The second entry is bad, so the good first one must not be applied either.
    ['activity_missing_character', change([{ characterId: 'npc_b', nextTier: 'active_major' }, { characterId: 'zzz_nobody', nextTier: 'active_major' }])],
  ];
  for (const [code, rule] of cases) expectRejected(store, rule, code);
  assert.equal(root(store).revision, 1);
});

test('[characters.activity.replay-no-op] asking again for what is already so succeeds without a new revision, even with an old revision number', () => {
  const store = activityStore();
  const request = { characterId: 'npc_a', nextTier: 'active_major', importanceScore: 300, addReasonIds: ['hero'], expectedRecordRevision: null };
  tierChange(store, { changes: [request] });
  const after = store.getState();
  const again = apply(store, (draft) => changeTiers(draft, { sourceEventId: 'event_1', effectiveDay: 5, changes: [request] }));
  assert.deepEqual(again.changedIds, []);
  assert.deepEqual(store.getState().world.npcActivityProfiles, after.world.npcActivityProfiles);
  assert.equal(profile(store, 'npc_a').revision, 0);
  tierChange(store, { changes: [{ characterId: 'npc_a', nextTier: 'active_major', importanceScore: 400 }] });
  assert.equal(profile(store, 'npc_a').revision, 1);
  assert.equal(root(store).revision, 2);
});

test('[characters.activity.role-effects] gaining a role makes a character at least named, clears planned demotion and brings processing forward', () => {
  const store = activityStore();
  demote(store, 'npc_a', 'inactive_named');
  tierChange(store, { changes: [{ characterId: 'npc_a', nextTier: 'inactive_named', demotionEligibleDay: 3 }] });
  store.transact('later', (draft) => { draft.world.npcActivityProfiles.records.npc_a.nextProcessDay = 90; });
  const roles = (effects, day = 20) => (draft) => applyRoleEffects(draft, { sourceEventId: 'event_6', eventDay: day, effects });
  const revisionBefore = root(store).revision;
  apply(store, roles([{ characterId: 'npc_a', addRoleKeys: ['steward', 'clan_head_a'] }, { characterId: 'npc_b', addRoleKeys: ['ruler'] }]));
  assert.deepEqual(
    [profile(store, 'npc_a').tier, profile(store, 'npc_a').stableRoleKeys, profile(store, 'npc_a').demotionEligibleDay, profile(store, 'npc_a').nextProcessDay],
    ['active_named', ['clan_head_a', 'steward'], null, 20],
  );
  assert.equal(profile(store, 'npc_b').nextProcessDay, 1);
  assert.equal(root(store).revision, revisionBefore + 1, 'two profiles changed in one call: one root revision');
  apply(store, roles([{ characterId: 'npc_a', removeRoleKeys: ['steward'] }]));
  assert.deepEqual(profile(store, 'npc_a').stableRoleKeys, ['clan_head_a']);
  const before = store.getState();
  assert.deepEqual(apply(store, roles([{ characterId: 'npc_a', removeRoleKeys: ['unknown_role'] }])).changedIds, []);
  assert.deepEqual(store.getState().world.npcActivityProfiles, before.world.npcActivityProfiles);
  assert.equal(apply(store, roles([{ characterId: 'npc_c', addRoleKeys: [] }])).changedIds.length, 0);
  assert.equal(Object.hasOwn(root(store).records, 'npc_c'), false);
  // A historical character who gains a role is no longer historical.
  store.transact('historical', (draft) => { draft.world.npcActivityProfiles.records.npc_c = { ...defaultProfile('npc_c'), tier: 'historical' }; });
  apply(store, roles([{ characterId: 'npc_c', addRoleKeys: ['steward'] }]));
  assert.equal(profile(store, 'npc_c').tier, 'active_named');
  const bad = [
    ['activity_invalid_input', null],
    ['activity_invalid_input', []],
    ['activity_invalid_input', [{ characterId: 'npc_a', addRoleKeys: ['x'], removeRoleKeys: ['x'] }]],
    ['activity_invalid_input', [{ characterId: 'npc_a', addRoleKeys: 'x' }]],
    ['activity_invalid_input', [{ characterId: 'npc_a', mood: 1 }]],
    ['activity_invalid_input', [{ characterId: 'npc_a' }, { characterId: 'npc_a' }]],
    ['activity_missing_character', [{ characterId: 'npc_b', addRoleKeys: ['x'] }, { characterId: 'nobody', addRoleKeys: ['x'] }]],
  ];
  for (const [code, effects] of bad) expectRejected(store, (draft) => applyRoleEffects(draft, { sourceEventId: 'event_7', eventDay: 5, effects }), code);
  expectRejected(store, (draft) => applyRoleEffects(draft, { sourceEventId: 'event_7', eventDay: -5, effects: [{ characterId: 'npc_a', addRoleKeys: ['x'] }] }), 'activity_invalid_input');
});

test('[characters.activity.processing] a character is processed once a day when due, and the next time is set by their tier', () => {
  const store = activityStore();
  tierChange(store, { changes: [{ characterId: 'npc_b', nextTier: 'active_major' }] });
  demote(store, 'npc_c', 'inactive_named');
  const process = (id, day) => (draft) => processCharacter(draft, { characterId: id, currentDay: day });
  assert.equal(apply(store, process('npc_a', 1)).nextProcessDay, 8);
  assert.equal(apply(store, process('npc_b', 1)).nextProcessDay, 2);
  assert.equal(apply(store, process('npc_c', 1)).nextProcessDay, 31);
  assert.equal(profile(store, 'npc_a').lastProcessedDay, 1);
  assert.equal(profile(store, 'npc_a').revision, 0);
  expectRejected(store, process('npc_a', 1), 'activity_already_processed_today');
  expectRejected(store, process('npc_a', 5), 'activity_not_due');
  apply(store, process('npc_a', 8));
  assert.equal(profile(store, 'npc_a').revision, 1);
  assert.equal(profile(store, 'npc_a').nextProcessDay, 15);
  store.transact('historical', (draft) => { draft.world.npcActivityProfiles.records.npc_c.tier = 'historical'; });
  expectRejected(store, process('npc_c', 99), 'activity_historical_not_processed');
  expectRejected(store, process('nobody', 3), 'activity_missing_character');
  expectRejected(store, process('npc_a', -1), 'activity_invalid_input');
  expectRejected(store, (draft) => processCharacter(draft, null), 'activity_invalid_input');
});

test('[characters.activity.due-list] the due characters come most important first, limited by the budget, without historical or already processed ones', () => {
  const store = activityStore();
  tierChange(store, { changes: [
    { characterId: 'npc_a', nextTier: 'active_named', importanceScore: 10 },
    { characterId: 'npc_b', nextTier: 'active_major', importanceScore: 900 },
    { characterId: 'npc_c', nextTier: 'active_named', importanceScore: 10 },
    { characterId: PLAYER_CHARACTER_ID, nextTier: 'active_major', importanceScore: 500 },
  ] });
  const ids = (day, budget) => collectDueCharacters(store.getState(), day, budget).map((p) => p.characterId);
  assert.deepEqual(ids(1, 100), ['npc_b', PLAYER_CHARACTER_ID, 'npc_a', 'npc_c']);
  assert.deepEqual(ids(1, 2), ['npc_b', PLAYER_CHARACTER_ID]);
  assert.deepEqual(ids(1, 0), []);
  assert.deepEqual(ids(-1, 5), []);
  assert.deepEqual(ids(1, 1.5), []);
  apply(store, (draft) => processCharacter(draft, { characterId: 'npc_b', currentDay: 1 }));
  assert.deepEqual(ids(1, 100), [PLAYER_CHARACTER_ID, 'npc_a', 'npc_c']);
  assert.deepEqual(ids(2, 100), ['npc_b', PLAYER_CHARACTER_ID, 'npc_a', 'npc_c']);
  store.transact('historical', (draft) => { draft.world.npcActivityProfiles.records.npc_a.tier = 'historical'; });
  assert.deepEqual(ids(2, 100), ['npc_b', PLAYER_CHARACTER_ID, 'npc_c']);
  // Ties on importance go to whoever waited longest, then to the smaller id.
  apply(store, (draft) => processCharacter(draft, { characterId: 'npc_c', currentDay: 1 }));
  assert.deepEqual(ids(8, 100).slice(-1), ['npc_c']);
});

test('[characters.activity.due-order-ties] equally important characters are taken in the order they have waited, then by id; one processed today is not due again today', () => {
  const store = withPeople('npc_b', 'npc_c');
  store.transact('late', (draft) => { draft.world.characters.npc_a = newCharacter({ id: 'npc_a', name: 'A' }); });
  tierChange(store, { changes: ['npc_a', 'npc_b', 'npc_c'].map((id) => ({ characterId: id, nextTier: 'active_named', importanceScore: 50 })) });
  const ids = (day) => collectDueCharacters(store.getState(), day, 100).map((p) => p.characterId).filter((id) => id !== PLAYER_CHARACTER_ID);
  assert.deepEqual(ids(1), ['npc_a', 'npc_b', 'npc_c']);
  apply(store, (draft) => processCharacter(draft, { characterId: 'npc_a', currentDay: 1 }));
  assert.deepEqual(ids(8), ['npc_b', 'npc_c', 'npc_a']);
  // Bringing a character's next processing forward to a day they were already processed on does not make them due again that day.
  apply(store, (draft) => processCharacter(draft, { characterId: 'npc_b', currentDay: 8 }));
  apply(store, (draft) => applyRoleEffects(draft, { sourceEventId: 'event_8', eventDay: 8, effects: [{ characterId: 'npc_b', addRoleKeys: ['steward'] }] }));
  assert.equal(profile(store, 'npc_b').nextProcessDay, 8);
  assert.deepEqual(ids(8), ['npc_c', 'npc_a']);
  assert.deepEqual(ids(9), ['npc_c', 'npc_a', 'npc_b']);
});

test('[characters.activity.check-rejects-bad-records] a saved game with a damaged activity profile is refused', () => {
  const base = () => {
    const state = newGameState();
    state.world.characters.npc_a = newCharacter({ id: 'npc_a', name: 'A' });
    state.world.npcActivityProfiles.records.npc_a = { ...defaultProfile('npc_a'), importanceScore: 4 };
    return state;
  };
  assert.deepEqual(checkActivity(base()), { ok: true });
  const damage = [
    ['invalid_character_reference', (s) => { s.world.npcActivityProfiles.records.npc_z = { ...defaultProfile('npc_z') }; }],
    ['invalid_character_reference', (s) => { s.world.npcActivityProfiles.records.npc_a.characterId = 'other'; }],
    ['invalid_tier', (s) => { s.world.npcActivityProfiles.records.npc_a.tier = 'legendary'; }],
    ['invalid_importance', (s) => { s.world.npcActivityProfiles.records.npc_a.importanceScore = 1001; }],
    ['invalid_day_or_revision', (s) => { s.world.npcActivityProfiles.records.npc_a.nextProcessDay = -1; }],
    ['invalid_day_or_revision', (s) => { s.world.npcActivityProfiles.records.npc_a.revision = 0.5; }],
    ['invalid_promotion_reasons', (s) => { s.world.npcActivityProfiles.records.npc_a.promotionReasonIds = ['b', 'a']; }],
    ['invalid_role_keys', (s) => { s.world.npcActivityProfiles.records.npc_a.stableRoleKeys = ['a', 'a']; }],
    ['invalid_demotion_day', (s) => { s.world.npcActivityProfiles.records.npc_a.demotionEligibleDay = -1; }],
    ['invalid_pinned_floor', (s) => { s.world.npcActivityProfiles.records.npc_a.pinnedTierFloor = 'historical'; }],
    ['historical_with_role_or_pin', (s) => { Object.assign(s.world.npcActivityProfiles.records.npc_a, { tier: 'historical', stableRoleKeys: ['x'] }); }],
    ['role_below_named', (s) => { Object.assign(s.world.npcActivityProfiles.records.npc_a, { tier: 'inactive_named', stableRoleKeys: ['x'] }); }],
    ['tier_below_pinned_floor', (s) => { Object.assign(s.world.npcActivityProfiles.records.npc_a, { tier: 'inactive_named', pinnedTierFloor: 'active_named' }); }],
  ];
  for (const [fragment, edit] of damage) {
    const state = base();
    edit(state);
    const result = checkActivity(state);
    assert.equal(result.ok, false, fragment);
    assert.ok(JSON.stringify(result.detail).includes(fragment), `${fragment} not in ${JSON.stringify(result.detail)}`);
  }
  for (const root of [[], { version: 2, revision: 0, records: {} }, { version: 1, revision: -1, records: {} }, { version: 1, revision: 0, records: [] }]) {
    const state = base();
    state.world.npcActivityProfiles = root;
    assert.equal(checkActivity(state).error, 'activity_invalid_root');
  }
});
