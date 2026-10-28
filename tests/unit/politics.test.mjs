import test from 'node:test';
import assert from 'node:assert/strict';
import { clone } from '../../src/core/data.js';
import { createStore } from '../../src/core/store.js';
import { seedFrom } from '../../src/core/rng.js';
import { newCharacter, newGameState } from '../../src/game/new-game.js';
import { validateState } from '../../src/persist/schema.js';
import * as politics from '../../src/domains/politics/index.js';

const { unitsFromShare } = politics;

const {
  adjustSovereignPower, buildObedienceInput, changeClanHead, changeFactionRulingClan, changeFactionRuler, changeTitleHolder, changeTitleParent,
  changeTitleStatus, checkPolitics, createClan, createFaction, createLandRight, createTitle, getClanView, getFactionView, joinClan, leaveClan,
  linkClanToFaction, listRightsOnSettlement, listSettlementIdsByHolder, listSettlementIdsByRecognizingFaction, planEstateAllocations,
  resolveSuccession, setBranchClans, setClanLaws, setClanMetrics, setClanTreasury, setDesignatedSuccessors, setFactionLaws,
  setFactionTreasury, setInheritancePacts, setLandRightDisputed, setLandRightRecognition, setSovereignPower, setTitleSuccessionLaw,
  splitLandRight, supersedeLandRight, terminateLandRight, transferLandRight, transitionTitle, unlinkClanFromFaction,
} = politics;

// ---------------------------------------------------------------------------------------------
// A small world. People: ann (head of clan_a, ruler of realm_a, holds the crown and duchy), bram and
// cora (clan_a), dax (clan_a, dead), eli (clan_a, incapacitated), fay (head of clan_b), gus (head of
// clan_c, no faction), hana (no clan). Day 100.

const must = (result) => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result;
};

function baseState() {
  const state = newGameState({ seed: 7 });
  state.calendar.day = 100;
  for (const id of ['ann', 'bram', 'cora', 'dax', 'eli', 'fay', 'gus', 'hana']) {
    state.world.characters[id] = newCharacter({ id, name: id });
  }
  for (const id of ['s_north', 's_south', 's_east', 's_west']) {
    state.world.settlements[id] = { id, name: id };
  }
  for (const [id, ownerType, ownerId] of [['acct_clan_a', 'clan', 'clan_a'], ['acct_clan_b', 'clan', 'clan_b'], ['acct_realm', 'faction', 'realm_a'], ['acct_twin', 'faction', 'clan_b']]) {
    state.world.finance.accounts[id] = {
      id, version: 1, revision: 0, accountTypeId: ownerType === 'clan' ? 'clan' : 'state', currencyId: 'gold', balance: 0,
      ownerRef: { type: ownerType, id: ownerId }, authorizedSpenders: [], budgetPolicyId: null, frozen: false, lastTransactionId: null,
      legalRegimeId: null, reserveTarget: 0, customData: {},
    };
  }
  return state;
}

const ref = (type, id) => ({ type, id });
const person = (id) => ref('character', id);

function buildWorld(draft) {
  must(createFaction(draft, {
    id: 'realm_a', name: 'Realm A', lawIds: ['law_b', 'law_a'],
    sovereignPower: { legalAuthority: 60, administrativeControl: 40, coercivePower: 30, politicalSupport: 50 },
  }));
  must(createClan(draft, {
    id: 'clan_a', name: 'House A', designatedSuccessorIds: ['bram', 'cora'],
    headPower: { legalAuthority: 70, actualControl: 55 }, standing: { prestige: 20, legitimacy: 10, unity: 5 },
  }));
  must(createClan(draft, { id: 'clan_b', name: 'House B' }));
  must(createClan(draft, { id: 'clan_c', name: 'House C' }));
  must(linkClanToFaction(draft, { clanId: 'clan_a', factionId: 'realm_a' }));
  must(linkClanToFaction(draft, { clanId: 'clan_b', factionId: 'realm_a' }));
  for (const id of ['ann', 'bram', 'cora', 'dax', 'eli']) must(joinClan(draft, { characterId: id, clanId: 'clan_a' }));
  must(joinClan(draft, { characterId: 'fay', clanId: 'clan_b' }));
  must(joinClan(draft, { characterId: 'gus', clanId: 'clan_c' }));
  draft.world.characters.dax.identity.alive = false;
  draft.world.characters.eli.condition.incapacitated = true;
  must(changeClanHead(draft, { clanId: 'clan_a', characterId: 'ann' }));
  must(changeClanHead(draft, { clanId: 'clan_b', characterId: 'fay' }));
  must(changeClanHead(draft, { clanId: 'clan_c', characterId: 'gus' }));
  must(changeFactionRulingClan(draft, { factionId: 'realm_a', clanId: 'clan_a' }));
  must(changeFactionRuler(draft, { factionId: 'realm_a', characterId: 'ann' }));
  must(setClanTreasury(draft, { clanId: 'clan_a', accountId: 'acct_clan_a' }));
  must(setFactionTreasury(draft, { factionId: 'realm_a', accountId: 'acct_realm' }));
  must(createTitle(draft, { id: 'crown', name: 'Crown', statusId: 'active', holderRef: person('ann') }));
  must(createTitle(draft, { id: 'duchy', name: 'Duchy', parentTitleId: 'crown', statusId: 'active', holderRef: person('ann') }));
  must(createTitle(draft, { id: 'county', name: 'County', parentTitleId: 'duchy' }));
  must(createLandRight(draft, { id: 'rule_north', rightTypeId: 'rule', subjectRef: ref('settlement', 's_north'), holderRef: ref('faction', 'realm_a') }));
  must(createLandRight(draft, { id: 'admin_north', rightTypeId: 'administration', subjectRef: ref('settlement', 's_south'), holderRef: person('bram'), basisRef: ref('title', 'duchy') }));
  must(createLandRight(draft, { id: 'holding_south', rightTypeId: 'holding', subjectRef: ref('settlement', 's_south'), holderRef: ref('clan', 'clan_a') }));
  must(createLandRight(draft, { id: 'claim_east', rightTypeId: 'claim', subjectRef: ref('settlement', 's_east'), holderRef: person('ann'), recognizedByFactionIds: ['realm_a'] }));
  must(createLandRight(draft, { id: 'own_south_ann', rightTypeId: 'legal_ownership', subjectRef: ref('settlement', 's_south'), holderRef: person('ann'), share: 0.6 }));
  must(createLandRight(draft, { id: 'own_south_clan', rightTypeId: 'legal_ownership', subjectRef: ref('settlement', 's_south'), holderRef: ref('clan', 'clan_a'), share: 0.4 }));
  must(createLandRight(draft, { id: 'occupation_west', rightTypeId: 'military_occupation', subjectRef: ref('settlement', 's_west'), holderRef: ref('faction', 'realm_a') }));
}

function emptyStore() {
  return createStore(baseState(), { validate: validateState });
}

function worldStore() {
  const store = emptyStore();
  const built = store.transact('build world', buildWorld);
  assert.equal(built.ok, true, JSON.stringify(built));
  return store;
}

// A refused rule says why, leaves the draft it ran on exactly as it was, and (through the store)
// leaves the state and revision as they were.
function refused(store, run, error) {
  const before = clone(store.getState());
  const direct = clone(before);
  const outcome = run(direct);
  assert.equal(outcome.ok, false, `expected ${error}, the rule succeeded`);
  assert.equal(outcome.error, error);
  assert.deepEqual(direct, before, 'the rule changed the draft before refusing');
  const result = store.transact('refused', run);
  assert.equal(result.ok, false);
  assert.equal(result.error, error);
  assert.deepEqual(store.getState(), before);
}

const change = (store, run) => {
  const result = store.transact('change', run);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
};

const world = (store) => store.getState().world;

// ---------------------------------------------------------------------------------------------
// Clans

test('[politics.clan.create] a clan is stored in the earlier record shape with nothing derived kept on it', () => {
  const store = emptyStore();
  change(store, (d) => createClan(d, { id: 'house_x', name: 'House X', cultureId: 'north' }));
  assert.deepEqual(world(store).clans.house_x, {
    id: 'house_x', version: 1, revision: 0, name: 'House X', cultureId: 'north', factionId: null, headCharacterId: null, branchClanIds: [],
    treasuryAccountId: null, successionLawId: null, inheritanceCustomId: null, designatedSuccessorIds: [], inheritancePacts: [],
    headPower: { legalAuthority: 0, actualControl: 0 }, standing: { prestige: 0, legitimacy: 0, unity: 0 }, customData: {},
  });
  const full = worldStore();
  const clan = world(full).clans.clan_a;
  for (const derived of ['memberCharacterIds', 'memberClanIds', 'titleIds', 'holdingSettlementIds', 'claimIds']) assert.equal(Object.hasOwn(clan, derived), false, derived);
  assert.deepEqual(clan.designatedSuccessorIds, ['bram', 'cora']);
  assert.equal(clan.headCharacterId, 'ann');
  assert.equal(clan.factionId, 'realm_a');
});

test('[politics.clan.create-refused] a clan with a bad id, derived field, rule-owned field or bad value is refused whole', () => {
  const store = worldStore();
  const create = (input) => (d) => createClan(d, input);
  refused(store, create(null), 'politics_invalid_input');
  refused(store, create({ id: 'Bad Id' }), 'politics_invalid_clan_id');
  refused(store, create({ id: 'clan_a' }), 'politics_duplicate_clan_id');
  refused(store, create({ id: 'k1', memberCharacterIds: ['ann'] }), 'politics_derived_field');
  refused(store, create({ id: 'k1', claimIds: [] }), 'politics_derived_field');
  refused(store, create({ id: 'k1', headCharacterId: 'ann' }), 'politics_field_set_by_rule');
  refused(store, create({ id: 'k1', factionId: 'realm_a' }), 'politics_field_set_by_rule');
  refused(store, create({ id: 'k1', treasuryAccountId: 'acct_clan_b' }), 'politics_field_set_by_rule');
  refused(store, create({ id: 'k1', headPower: { legalAuthority: Number.NaN } }), 'politics_invalid_clan_metric');
  refused(store, create({ id: 'k1', headPower: { strength: 1 } }), 'politics_invalid_clan_metric');
  refused(store, create({ id: 'k1', standing: 'high' }), 'politics_invalid_clan_metric');
  refused(store, create({ id: 'k1', designatedSuccessorIds: ['bram', 'bram'] }), 'politics_invalid_designated_successors');
  refused(store, create({ id: 'k1', designatedSuccessorIds: ['nobody'] }), 'politics_missing_character');
  refused(store, create({ id: 'k1', successionLawId: 'no.such.law' }), 'politics_invalid_clan');
  refused(store, create({ id: 'k1', inheritanceCustomId: 'no.such.custom' }), 'politics_invalid_clan');
  refused(store, create({ id: 'k1', inheritancePacts: 'none' }), 'politics_invalid_clan');
  refused(store, create({ id: 'k1', customData: [] }), 'politics_invalid_clan');
});

test('[politics.clan.metrics] the head power and standing change by patch, each value finite, a repeat is no change', () => {
  const store = worldStore();
  const before = world(store).clans.clan_a;
  change(store, (d) => setClanMetrics(d, { clanId: 'clan_a', headPower: { actualControl: 80 }, standing: { unity: -3 } }));
  const clan = world(store).clans.clan_a;
  assert.deepEqual(clan.headPower, { legalAuthority: 70, actualControl: 80 });
  assert.deepEqual(clan.standing, { prestige: 20, legitimacy: 10, unity: -3 });
  assert.equal(clan.revision, before.revision + 1);
  refused(store, (d) => setClanMetrics(d, { clanId: 'clan_a', headPower: { actualControl: 80 } }), 'politics_no_change');
  refused(store, (d) => setClanMetrics(d, { clanId: 'clan_a' }), 'politics_invalid_input');
  refused(store, (d) => setClanMetrics(d, { clanId: 'clan_a', headPower: { actualControl: Infinity } }), 'politics_invalid_clan_metric');
  refused(store, (d) => setClanMetrics(d, { clanId: 'clan_a', standing: { fame: 1 } }), 'politics_invalid_clan_metric');
  refused(store, (d) => setClanMetrics(d, { clanId: 'clan_a', headPower: { legalAuthority: 5 }, standing: { unity: '9' } }), 'politics_invalid_clan_metric');
  refused(store, (d) => setClanMetrics(d, { clanId: 'nobody', headPower: { legalAuthority: 1 } }), 'politics_missing_clan');
});

test('[politics.clan.laws] a succession law and inheritance custom must be known definitions', () => {
  const store = worldStore();
  change(store, (d) => {
    d.world.customDefinitions.records['succession_law:primogeniture'] = {
      domainId: 'succession_law', definitionId: 'primogeniture', schemaVersion: 1, definitionVersion: 1, sourceType: 'player', sourceRef: null,
      approvalStatus: 'approved', approvedByRef: null, definitionData: { id: 'primogeniture', name: 'primogeniture' }, revision: 0,
    };
    d.world.customDefinitions.records['succession_law:pending_law'] = {
      domainId: 'succession_law', definitionId: 'pending_law', schemaVersion: 1, definitionVersion: 1, sourceType: 'player', sourceRef: null,
      approvalStatus: 'pending', approvedByRef: null, definitionData: { id: 'pending_law' }, revision: 0,
    };
  });
  change(store, (d) => setClanLaws(d, { clanId: 'clan_a', successionLawId: 'primogeniture', inheritanceCustomId: 'm1.default_inheritance' }));
  assert.equal(world(store).clans.clan_a.successionLawId, 'primogeniture');
  refused(store, (d) => setClanLaws(d, { clanId: 'clan_a', successionLawId: 'pending_law' }), 'politics_unregistered_succession_law');
  refused(store, (d) => setClanLaws(d, { clanId: 'clan_a', inheritanceCustomId: 'ghost' }), 'politics_unregistered_inheritance_custom');
  refused(store, (d) => setClanLaws(d, { clanId: 'clan_a' }), 'politics_invalid_input');
  refused(store, (d) => setClanLaws(d, { clanId: 'clan_a', successionLawId: 'primogeniture' }), 'politics_no_change');
  change(store, (d) => setClanLaws(d, { clanId: 'clan_a', successionLawId: null }));
  assert.equal(world(store).clans.clan_a.successionLawId, null);
  assert.equal(world(store).clans.clan_a.inheritanceCustomId, 'm1.default_inheritance', 'only the given field changes');
});

test('[politics.clan.successors-keep-order] designated successors keep the priority they were given', () => {
  const store = worldStore();
  change(store, (d) => setDesignatedSuccessors(d, { clanId: 'clan_a', characterIds: ['cora', 'bram', 'fay'] }));
  assert.deepEqual(world(store).clans.clan_a.designatedSuccessorIds, ['cora', 'bram', 'fay'], 'not sorted by id');
  refused(store, (d) => setDesignatedSuccessors(d, { clanId: 'clan_a', characterIds: ['cora', 'bram', 'fay'] }), 'politics_no_change');
  refused(store, (d) => setDesignatedSuccessors(d, { clanId: 'clan_a', characterIds: ['bram', 'bram'] }), 'politics_invalid_designated_successors');
  refused(store, (d) => setDesignatedSuccessors(d, { clanId: 'clan_a', characterIds: 'bram' }), 'politics_invalid_designated_successors');
  refused(store, (d) => setDesignatedSuccessors(d, { clanId: 'clan_a', characterIds: ['bram', 'ghost'] }), 'politics_missing_character');
  refused(store, (d) => setDesignatedSuccessors(d, { clanId: 'ghost', characterIds: [] }), 'politics_missing_clan');
});

test('[politics.clan.branches] branch clans must exist and may not loop back to the clan', () => {
  const store = worldStore();
  change(store, (d) => setBranchClans(d, { clanId: 'clan_a', branchClanIds: ['clan_c', 'clan_b'] }));
  assert.deepEqual(world(store).clans.clan_a.branchClanIds, ['clan_b', 'clan_c']);
  refused(store, (d) => setBranchClans(d, { clanId: 'clan_b', branchClanIds: ['clan_a'] }), 'politics_clan_branch_cycle');
  refused(store, (d) => setBranchClans(d, { clanId: 'clan_c', branchClanIds: ['clan_a'] }), 'politics_clan_branch_cycle');
  refused(store, (d) => setBranchClans(d, { clanId: 'clan_a', branchClanIds: ['clan_a'] }), 'politics_clan_branch_cycle');
  refused(store, (d) => setBranchClans(d, { clanId: 'clan_a', branchClanIds: ['clan_zzz'] }), 'politics_missing_clan');
  refused(store, (d) => setBranchClans(d, { clanId: 'clan_a', branchClanIds: ['clan_b', 'clan_b'] }), 'politics_invalid_branch_clans');
});

test('[politics.clan.pacts] inheritance pacts are stored only when well formed and allowed by the clan\'s custom', () => {
  const store = worldStore();
  const pact = { id: 'pact_1', version: 1, status: 'active', consents: [{ accepted: true, decisionId: 'd1' }], approvals: [{ approved: true, decisionId: 'd2' }] };
  change(store, (d) => setInheritancePacts(d, { clanId: 'clan_a', pacts: [pact, { id: 'pact_2', version: 1, status: 'draft' }] }));
  assert.equal(world(store).clans.clan_a.inheritancePacts.length, 2);
  refused(store, (d) => setInheritancePacts(d, { clanId: 'clan_a', pacts: [pact, pact] }), 'politics_duplicate_pact_id');
  refused(store, (d) => setInheritancePacts(d, { clanId: 'clan_a', pacts: [{ ...pact, consents: [{ accepted: false, decisionId: 'd1' }] }] }), 'politics_invalid_pact');
  refused(store, (d) => setInheritancePacts(d, { clanId: 'clan_a', pacts: 'none' }), 'politics_invalid_inheritance_pacts');
  refused(store, (d) => setInheritancePacts(d, { clanId: 'clan_a', pacts: [pact, { id: 'pact_2', version: 1, status: 'draft' }] }), 'politics_no_change');
  change(store, (d) => {
    d.world.customDefinitions.records['inheritance_custom:no_pacts'] = {
      domainId: 'inheritance_custom', definitionId: 'no_pacts', schemaVersion: 1, definitionVersion: 1, sourceType: 'player', sourceRef: null,
      approvalStatus: 'approved', approvedByRef: null, definitionData: { id: 'no_pacts', allowsPacts: false }, revision: 0,
    };
    must(setClanLaws(d, { clanId: 'clan_b', inheritanceCustomId: 'no_pacts' }));
  });
  refused(store, (d) => setInheritancePacts(d, { clanId: 'clan_b', pacts: [pact] }), 'politics_pacts_not_allowed');
});

test('[politics.clan.view] the clan view lists members, titles and the settlements it holds or claims on the day', () => {
  const store = worldStore();
  change(store, (d) => {
    must(createLandRight(d, { id: 'claim_clan', rightTypeId: 'claim', subjectRef: ref('settlement', 's_west'), holderRef: ref('clan', 'clan_a') }));
    must(createLandRight(d, { id: 'holding_old', rightTypeId: 'holding', subjectRef: ref('settlement', 's_east'), holderRef: ref('clan', 'clan_a') }));
    must(transitionTitle(d, { titleId: 'county', statusId: 'active', holderRef: ref('clan', 'clan_a') }));
  });
  const view = getClanView(store.getState(), 'clan_a');
  assert.deepEqual(view.memberCharacterIds, ['ann', 'bram', 'cora', 'dax', 'eli']);
  assert.deepEqual(view.titleIds, ['county']);
  assert.deepEqual(view.holdingSettlementIds, ['s_east', 's_south']);
  assert.deepEqual(view.claimIds, ['s_west']);
  assert.equal(getClanView(store.getState(), 'clan_a', 99).holdingSettlementIds.length, 0, 'not yet in force the day before');
  // A right that ended no longer counts (the earlier version still listed it).
  change(store, (d) => terminateLandRight(d, { rightId: 'holding_old' }));
  assert.deepEqual(getClanView(store.getState(), 'clan_a').holdingSettlementIds, ['s_south']);
  assert.equal(getClanView(store.getState(), 'nobody'), null);
  assert.equal(Object.hasOwn(world(store).clans.clan_a, 'memberCharacterIds'), false);
});

// ---------------------------------------------------------------------------------------------
// Factions

test('[politics.faction.create] a faction is stored in the earlier record shape with its four axes', () => {
  const store = worldStore();
  const faction = world(store).factions.realm_a;
  assert.deepEqual(faction, {
    id: 'realm_a', version: 1, revision: faction.revision, factionTypeId: 'realm', name: 'Realm A', rulerCharacterId: 'ann', rulingClanId: 'clan_a',
    treasuryAccountId: 'acct_realm', lawIds: ['law_a', 'law_b'],
    sovereignPower: { legalAuthority: 60, administrativeControl: 40, coercivePower: 30, politicalSupport: 50 }, customData: {},
  });
  change(store, (d) => createFaction(d, { id: 'league_b', factionTypeId: 'league' }));
  assert.deepEqual(world(store).factions.league_b.sovereignPower, { legalAuthority: 0, administrativeControl: 0, coercivePower: 0, politicalSupport: 0 });
  const create = (input) => (d) => createFaction(d, input);
  refused(store, create({ id: 'realm_a' }), 'politics_duplicate_faction_id');
  refused(store, create({ id: 'Bad' }), 'politics_invalid_faction_id');
  refused(store, create({ id: 'f1', memberClanIds: [] }), 'politics_derived_field');
  refused(store, create({ id: 'f1', settlementIds: [] }), 'politics_derived_field');
  refused(store, create({ id: 'f1', rulerCharacterId: 'ann' }), 'politics_field_set_by_rule');
  refused(store, create({ id: 'f1', rulingClanId: 'clan_a' }), 'politics_field_set_by_rule');
  refused(store, create({ id: 'f1', factionTypeId: 'empire' }), 'politics_invalid_faction');
  refused(store, create({ id: 'f1', lawIds: ['x', 'x'] }), 'politics_invalid_law_ids');
  refused(store, create({ id: 'f1', sovereignPower: { legalAuthority: 101 } }), 'politics_invalid_faction');
  refused(store, create({ id: 'f1', sovereignPower: { legalAuthority: -1 } }), 'politics_invalid_faction');
  refused(store, create({ id: 'f1', sovereignPower: { might: 5 } }), 'politics_invalid_faction_power');
});

test('[politics.faction.power-axes] the four axes are set within 0..100 or adjusted and stopped at the ends', () => {
  const store = worldStore();
  change(store, (d) => setSovereignPower(d, { factionId: 'realm_a', power: { coercivePower: 100, politicalSupport: 0 } }));
  assert.deepEqual(world(store).factions.realm_a.sovereignPower, { legalAuthority: 60, administrativeControl: 40, coercivePower: 100, politicalSupport: 0 });
  refused(store, (d) => setSovereignPower(d, { factionId: 'realm_a', power: { coercivePower: 100 } }), 'politics_no_change');
  refused(store, (d) => setSovereignPower(d, { factionId: 'realm_a', power: { legalAuthority: 100.5 } }), 'politics_invalid_faction_power');
  refused(store, (d) => setSovereignPower(d, { factionId: 'realm_a', power: { legalAuthority: -0.1 } }), 'politics_invalid_faction_power');
  refused(store, (d) => setSovereignPower(d, { factionId: 'realm_a', power: { legalAuthority: Number.NaN } }), 'politics_invalid_faction_power');
  refused(store, (d) => setSovereignPower(d, { factionId: 'realm_a', power: {} }), 'politics_invalid_faction_power');
  refused(store, (d) => setSovereignPower(d, { factionId: 'realm_a', power: { might: 5 } }), 'politics_invalid_faction_power');
  refused(store, (d) => setSovereignPower(d, { factionId: 'ghost', power: { legalAuthority: 5 } }), 'politics_missing_faction');
  change(store, (d) => adjustSovereignPower(d, { factionId: 'realm_a', deltas: { legalAuthority: 55, administrativeControl: -50, coercivePower: -10 } }));
  assert.deepEqual(world(store).factions.realm_a.sovereignPower, { legalAuthority: 100, administrativeControl: 0, coercivePower: 90, politicalSupport: 0 });
  refused(store, (d) => adjustSovereignPower(d, { factionId: 'realm_a', deltas: { legalAuthority: 5 } }), 'politics_no_change');
  refused(store, (d) => adjustSovereignPower(d, { factionId: 'realm_a', deltas: { legalAuthority: 'lots' } }), 'politics_invalid_faction_power');
  refused(store, (d) => adjustSovereignPower(d, { factionId: 'realm_a', deltas: {} }), 'politics_invalid_faction_power');
});

test('[politics.faction.laws-and-view] laws are kept sorted and the view derives member clans and held settlements', () => {
  const store = worldStore();
  change(store, (d) => setFactionLaws(d, { factionId: 'realm_a', lawIds: ['z_law', 'a_law'] }));
  assert.deepEqual(world(store).factions.realm_a.lawIds, ['a_law', 'z_law']);
  refused(store, (d) => setFactionLaws(d, { factionId: 'realm_a', lawIds: ['a_law', 'z_law'] }), 'politics_no_change');
  refused(store, (d) => setFactionLaws(d, { factionId: 'realm_a', lawIds: ['a_law', 'a_law'] }), 'politics_invalid_law_ids');
  const view = getFactionView(store.getState(), 'realm_a');
  assert.deepEqual(view.memberClanIds, ['clan_a', 'clan_b']);
  // Only rule, administration, suzerainty and military occupation count toward the faction's settlements.
  assert.deepEqual(view.settlementIds, ['s_north', 's_west']);
  assert.deepEqual(getFactionView(store.getState(), 'realm_a', 99).settlementIds, []);
  assert.equal(getFactionView(store.getState(), 'ghost'), null);
  assert.equal(Object.hasOwn(world(store).factions.realm_a, 'memberClanIds'), false);
});

test('[politics.faction.obedience-input] the obedience input joins the four axes with the target\'s side and is frozen', () => {
  const store = worldStore();
  const state = store.getState();
  const base = () => ({
    factionRef: ref('faction', 'realm_a'),
    targetRef: ref('clan', 'clan_b'),
    sourceRevisions: { faction: state.world.factions.realm_a.revision, target: state.world.clans.clan_b.revision },
    targetDisposition: { loyalty: 70, fear: 20 },
    targetCapacity: { troops: 30 },
    legalContext: { contractRefs: [ref('title', 'duchy')] },
    localContext: { distance: 10 },
    commandContext: { burden: 40, legality: 90 },
  });
  const built = buildObedienceInput(state, base());
  assert.equal(built.ok, true);
  assert.deepEqual(built.value.factionPower, { administrativeControl: 40, coercivePower: 30, legalAuthority: 60, politicalSupport: 50 });
  assert.deepEqual(built.value.legalContext, { contractRefs: [ref('title', 'duchy')], privilegeRefs: [], immunityRefs: [] });
  assert.ok(Object.isFrozen(built.value) && Object.isFrozen(built.value.factionPower));
  assert.deepEqual(buildObedienceInput(state, base()).value, built.value);
  const bad = (patch) => buildObedienceInput(state, { ...base(), ...patch });
  assert.equal(buildObedienceInput(state, null).error, 'politics_invalid_input');
  assert.equal(bad({ commandContext: undefined }).error, 'politics_missing_obedience_input');
  assert.equal(bad({ factionRef: ref('clan', 'clan_a') }).error, 'politics_invalid_obedience_value');
  assert.equal(bad({ targetRef: ref('clan', 'ghost') }).error, 'politics_missing_ref_target');
  assert.equal(bad({ sourceRevisions: { faction: 99, target: 0 } }).error, 'politics_revision_conflict');
  assert.equal(bad({ targetDisposition: { loyalty: 101 } }).error, 'politics_invalid_obedience_value');
  assert.equal(bad({ localContext: { distance: Number.NaN } }).error, 'politics_invalid_obedience_value');
  assert.equal(bad({ legalContext: { privilegeRefs: 'none' } }).error, 'politics_invalid_obedience_value');
});

// ---------------------------------------------------------------------------------------------
// Affiliation

test('[politics.affiliation.join-leave] joining takes the clan\'s faction along, leaving clears both, and a head cannot leave', () => {
  const store = worldStore();
  change(store, (d) => joinClan(d, { characterId: 'hana', clanId: 'clan_b' }));
  assert.deepEqual(world(store).characters.hana.affiliations, { clanId: 'clan_b', factionId: 'realm_a', legalStatusId: null });
  assert.equal(world(store).characters.hana.revision, 1);
  refused(store, (d) => joinClan(d, { characterId: 'hana', clanId: 'clan_b' }), 'politics_no_change');
  refused(store, (d) => joinClan(d, { characterId: 'hana', clanId: 'clan_c' }), 'politics_character_already_in_clan');
  change(store, (d) => joinClan(d, { characterId: 'hana', clanId: 'clan_c', allowTransfer: true }));
  assert.deepEqual(world(store).characters.hana.affiliations, { clanId: 'clan_c', factionId: null, legalStatusId: null });
  refused(store, (d) => joinClan(d, { characterId: 'fay', clanId: 'clan_c', allowTransfer: true }), 'politics_character_is_clan_head');
  refused(store, (d) => joinClan(d, { characterId: 'dax', clanId: 'clan_b', allowTransfer: true }), 'politics_character_not_alive');
  refused(store, (d) => joinClan(d, { characterId: 'ghost', clanId: 'clan_b' }), 'politics_missing_character');
  refused(store, (d) => joinClan(d, { characterId: 'hana', clanId: 'ghost' }), 'politics_missing_clan');
  refused(store, (d) => leaveClan(d, { characterId: 'ann' }), 'politics_character_is_clan_head');
  refused(store, (d) => leaveClan(d, { characterId: 'hana', expectedClanId: 'clan_a' }), 'politics_clan_mismatch');
  change(store, (d) => leaveClan(d, { characterId: 'hana', expectedClanId: 'clan_c' }));
  assert.deepEqual(world(store).characters.hana.affiliations, { clanId: null, factionId: null, legalStatusId: null });
  refused(store, (d) => leaveClan(d, { characterId: 'hana' }), 'politics_no_change');
  // A dead member may still leave.
  change(store, (d) => leaveClan(d, { characterId: 'dax' }));
  assert.deepEqual(world(store).characters.dax.affiliations, { clanId: null, factionId: null, legalStatusId: null });
});

test('[politics.affiliation.link-faction] a clan changing faction takes every member along; the ruling clan cannot leave', () => {
  const store = worldStore();
  change(store, (d) => must(createFaction(d, { id: 'league_b', factionTypeId: 'league' })));
  const revision = world(store).clans.clan_b.revision;
  change(store, (d) => linkClanToFaction(d, { clanId: 'clan_b', factionId: 'league_b' }));
  assert.equal(world(store).clans.clan_b.factionId, 'league_b');
  assert.equal(world(store).clans.clan_b.revision, revision + 1);
  assert.equal(world(store).characters.fay.affiliations.factionId, 'league_b');
  change(store, (d) => unlinkClanFromFaction(d, { clanId: 'clan_b' }));
  assert.equal(world(store).clans.clan_b.factionId, null);
  assert.equal(world(store).characters.fay.affiliations.factionId, null);
  assert.equal(world(store).characters.fay.affiliations.clanId, 'clan_b');
  refused(store, (d) => unlinkClanFromFaction(d, { clanId: 'clan_b' }), 'politics_no_change');
  refused(store, (d) => linkClanToFaction(d, { clanId: 'clan_a', factionId: 'realm_a' }), 'politics_no_change');
  refused(store, (d) => unlinkClanFromFaction(d, { clanId: 'clan_a' }), 'politics_clan_rules_faction');
  refused(store, (d) => linkClanToFaction(d, { clanId: 'clan_a', factionId: 'league_b' }), 'politics_clan_rules_faction');
  refused(store, (d) => linkClanToFaction(d, { clanId: 'clan_b', factionId: 'ghost' }), 'politics_missing_faction');
  refused(store, (d) => linkClanToFaction(d, { clanId: 'ghost', factionId: 'realm_a' }), 'politics_missing_clan');
  refused(store, (d) => linkClanToFaction(d, { clanId: 'clan_b' }), 'politics_invalid_input');
});

test('[politics.affiliation.head-and-ruler] heads are living members, a ruling clan belongs to the faction, treasuries belong to their owner', () => {
  const store = worldStore();
  change(store, (d) => changeClanHead(d, { clanId: 'clan_a', characterId: 'bram' }));
  assert.equal(world(store).clans.clan_a.headCharacterId, 'bram');
  refused(store, (d) => changeClanHead(d, { clanId: 'clan_a', characterId: 'bram' }), 'politics_no_change');
  refused(store, (d) => changeClanHead(d, { clanId: 'clan_a', characterId: 'fay' }), 'politics_ineligible_candidate');
  refused(store, (d) => changeClanHead(d, { clanId: 'clan_a', characterId: 'dax' }), 'politics_character_not_alive');
  refused(store, (d) => changeClanHead(d, { clanId: 'clan_a', characterId: 'ghost' }), 'politics_missing_character');
  refused(store, (d) => changeClanHead(d, { clanId: 'clan_a' }), 'politics_missing_character');
  refused(store, (d) => changeClanHead(d, { clanId: 'ghost', characterId: 'bram' }), 'politics_missing_clan');
  change(store, (d) => changeClanHead(d, { clanId: 'clan_a', characterId: null }));
  assert.equal(world(store).clans.clan_a.headCharacterId, null);

  change(store, (d) => changeFactionRuler(d, { factionId: 'realm_a', characterId: 'hana' }));
  assert.equal(world(store).factions.realm_a.rulerCharacterId, 'hana', 'a ruler need not belong to the ruling clan');
  refused(store, (d) => changeFactionRuler(d, { factionId: 'realm_a', characterId: 'hana' }), 'politics_no_change');
  refused(store, (d) => changeFactionRuler(d, { factionId: 'realm_a', characterId: 'dax' }), 'politics_character_not_alive');
  refused(store, (d) => changeFactionRuler(d, { factionId: 'realm_a', characterId: 'ghost' }), 'politics_missing_character');
  refused(store, (d) => changeFactionRuler(d, { factionId: 'ghost', characterId: 'ann' }), 'politics_missing_faction');
  change(store, (d) => changeFactionRulingClan(d, { factionId: 'realm_a', clanId: 'clan_b' }));
  assert.equal(world(store).factions.realm_a.rulingClanId, 'clan_b');
  refused(store, (d) => changeFactionRulingClan(d, { factionId: 'realm_a', clanId: 'clan_c' }), 'politics_clan_not_in_faction');
  refused(store, (d) => changeFactionRulingClan(d, { factionId: 'realm_a', clanId: 'ghost' }), 'politics_missing_clan');
  refused(store, (d) => changeFactionRulingClan(d, { factionId: 'realm_a', clanId: 'clan_b' }), 'politics_no_change');

  change(store, (d) => setClanTreasury(d, { clanId: 'clan_b', accountId: 'acct_clan_b' }));
  assert.equal(world(store).clans.clan_b.treasuryAccountId, 'acct_clan_b');
  refused(store, (d) => setClanTreasury(d, { clanId: 'clan_b', accountId: 'acct_clan_a' }), 'politics_treasury_owner_mismatch');
  refused(store, (d) => setClanTreasury(d, { clanId: 'clan_b', accountId: 'acct_realm' }), 'politics_treasury_owner_mismatch');
  refused(store, (d) => setClanTreasury(d, { clanId: 'clan_b', accountId: 'acct_twin' }), 'politics_treasury_owner_mismatch');
  refused(store, (d) => setClanTreasury(d, { clanId: 'clan_b', accountId: 'ghost' }), 'politics_missing_account');
  refused(store, (d) => setClanTreasury(d, { clanId: 'clan_b', accountId: 'acct_clan_b' }), 'politics_no_change');
  refused(store, (d) => setFactionTreasury(d, { factionId: 'realm_a', accountId: 'acct_clan_a' }), 'politics_treasury_owner_mismatch');
  change(store, (d) => setFactionTreasury(d, { factionId: 'realm_a', accountId: null }));
  assert.equal(world(store).factions.realm_a.treasuryAccountId, null);
});

// ---------------------------------------------------------------------------------------------
// Titles

const approved = (domainId, definitionId, definitionData) => ({
  domainId, definitionId, schemaVersion: 1, definitionVersion: 1, sourceType: 'player', sourceRef: null, approvalStatus: 'approved',
  approvedByRef: null, definitionData: { id: definitionId, ...definitionData }, revision: 0,
});
const addDefinitions = (store, ...records) => change(store, (d) => {
  for (const record of records) d.world.customDefinitions.records[`${record.domainId}:${record.definitionId}`] = record;
});

test('[politics.title.create] a title is stored in the earlier record shape with the type\'s default status', () => {
  const store = emptyStore();
  change(store, (d) => createTitle(d, { id: 'throne', name: 'Throne' }));
  assert.deepEqual(world(store).titles.throne, {
    id: 'throne', version: 1, revision: 0, titleTypeId: 'generic_title', name: 'Throne', holderRef: null, parentTitleId: null, successionLawId: null,
    statusId: 'vacant', customData: {},
  });
  change(store, (d) => createTitle(d, { id: 'seat', parentTitleId: 'throne', statusId: 'active', holderRef: person('ann'), successionLawId: 'm1.default_succession' }));
  assert.deepEqual(world(store).characters.ann.titleIds, ['seat'], 'the holder\'s title index follows');
  assert.equal(world(store).characters.ann.revision, 1);
});

test('[politics.title.create-refused] a title with a bad id, type, status, holder, parent or law is refused whole', () => {
  const store = worldStore();
  const create = (input) => (d) => createTitle(d, input);
  refused(store, create(null), 'politics_invalid_input');
  refused(store, create({ id: 'Crown!' }), 'politics_invalid_title_id');
  refused(store, create({ id: 'crown' }), 'politics_duplicate_title_id');
  refused(store, create({ id: 't1', titleTypeId: 'emperor' }), 'politics_unregistered_title_type');
  refused(store, create({ id: 't1', name: 5 }), 'politics_invalid_name');
  refused(store, create({ id: 't1', customData: 'x' }), 'politics_invalid_custom_data');
  refused(store, create({ id: 't1', statusId: 'sleeping' }), 'politics_invalid_title');
  refused(store, create({ id: 't1', holderRef: person('ann') }), 'politics_invalid_title');
  refused(store, create({ id: 't1', statusId: 'active' }), 'politics_invalid_title');
  refused(store, create({ id: 't1', statusId: 'active', holderRef: person('ghost') }), 'politics_missing_holder');
  refused(store, create({ id: 't1', statusId: 'active', holderRef: person('dax') }), 'politics_holder_not_alive');
  refused(store, create({ id: 't1', statusId: 'active', holderRef: ref('settlement', 's_north') }), 'politics_title_holder_type_not_allowed');
  refused(store, create({ id: 't1', parentTitleId: 'ghost' }), 'politics_invalid_title');
  refused(store, create({ id: 't1', successionLawId: 'no.law' }), 'politics_invalid_title');
});

test('[politics.title.hierarchy] a parent must exist, be of an allowed type, not loop, and a root title must be allowed', () => {
  const store = worldStore();
  addDefinitions(store,
    approved('title_type', 'barony', { defaultStatusId: 'vacant', allowedParentTitleTypeIds: ['generic_title'], allowRoot: false }),
    approved('title_type', 'free_city', { defaultStatusId: 'vacant', allowedParentTitleTypeIds: [] }));
  change(store, (d) => createTitle(d, { id: 'barony_1', titleTypeId: 'barony', parentTitleId: 'county' }));
  refused(store, (d) => createTitle(d, { id: 'barony_2', titleTypeId: 'barony' }), 'politics_invalid_title');
  refused(store, (d) => createTitle(d, { id: 'under_barony', parentTitleId: 'barony_1' }), 'politics_invalid_title');
  refused(store, (d) => createTitle(d, { id: 'under_city', titleTypeId: 'free_city', parentTitleId: 'crown' }), 'politics_invalid_title');
  change(store, (d) => createTitle(d, { id: 'city_1', titleTypeId: 'free_city' }));
  refused(store, (d) => changeTitleParent(d, { titleId: 'crown', parentTitleId: 'county' }), 'politics_invalid_title');
  refused(store, (d) => changeTitleParent(d, { titleId: 'crown', parentTitleId: 'crown' }), 'politics_invalid_title');
  refused(store, (d) => changeTitleParent(d, { titleId: 'duchy', parentTitleId: 'ghost' }), 'politics_invalid_title');
  refused(store, (d) => changeTitleParent(d, { titleId: 'barony_1', parentTitleId: null }), 'politics_invalid_title');
  refused(store, (d) => changeTitleParent(d, { titleId: 'duchy', parentTitleId: 'crown' }), 'politics_no_change');
  change(store, (d) => changeTitleParent(d, { titleId: 'county', parentTitleId: 'crown' }));
  assert.equal(world(store).titles.county.parentTitleId, 'crown');
  change(store, (d) => changeTitleParent(d, { titleId: 'county', parentTitleId: null }));
  assert.equal(world(store).titles.county.parentTitleId, null);
  // An extinct title can no longer be moved.
  change(store, (d) => changeTitleStatus(d, { titleId: 'county', statusId: 'extinct' }));
  refused(store, (d) => changeTitleParent(d, { titleId: 'county', parentTitleId: 'crown' }), 'politics_invalid_transition');
});

test('[politics.title.status-rules] holders and statuses change only along the statuses\' rules', () => {
  const store = worldStore();
  addDefinitions(store,
    approved('title_status', 'locked', { holderMode: 'required', terminal: false, allowedNextStatusIds: ['locked', 'active'], allowsHolderChange: false, allowsParentChange: false }),
    approved('title_status', 'archived', { holderMode: 'forbidden', terminal: true, allowedNextStatusIds: ['archived', 'vacant'], allowsHolderChange: false, allowsParentChange: true }));
  // Filling and emptying a title goes with its status.
  change(store, (d) => transitionTitle(d, { titleId: 'county', statusId: 'active', holderRef: person('bram') }));
  assert.deepEqual(world(store).characters.bram.titleIds, ['county']);
  change(store, (d) => changeTitleHolder(d, { titleId: 'county', holderRef: person('cora') }));
  assert.deepEqual([world(store).characters.bram.titleIds, world(store).characters.cora.titleIds], [[], ['county']]);
  refused(store, (d) => changeTitleHolder(d, { titleId: 'county', holderRef: person('cora') }), 'politics_no_change');
  refused(store, (d) => changeTitleHolder(d, { titleId: 'county', holderRef: person('dax') }), 'politics_holder_not_alive');
  refused(store, (d) => changeTitleHolder(d, { titleId: 'county', holderRef: person('ghost') }), 'politics_missing_holder');
  refused(store, (d) => changeTitleHolder(d, { titleId: 'county', holderRef: null }), 'politics_invalid_input');
  refused(store, (d) => changeTitleHolder(d, { titleId: 'ghost', holderRef: person('ann') }), 'politics_missing_title');
  // Only the status: the holder must not change with it.
  refused(store, (d) => changeTitleStatus(d, { titleId: 'county', statusId: 'vacant' }), 'politics_invalid_title');
  change(store, (d) => transitionTitle(d, { titleId: 'county', statusId: 'vacant', holderRef: null }));
  assert.deepEqual(world(store).characters.cora.titleIds, []);
  refused(store, (d) => changeTitleHolder(d, { titleId: 'county', holderRef: person('cora') }), 'politics_invalid_transition');
  refused(store, (d) => transitionTitle(d, { titleId: 'county', statusId: 'sleeping', holderRef: null }), 'politics_invalid_transition');
  refused(store, (d) => transitionTitle(d, { titleId: 'county', statusId: 5, holderRef: null }), 'politics_invalid_input');
  refused(store, (d) => transitionTitle(d, { titleId: 'county', statusId: 'vacant' }), 'politics_invalid_input');
  refused(store, (d) => transitionTitle(d, { titleId: 'county', statusId: 'vacant', holderRef: person('cora') }), 'politics_invalid_transition');
  change(store, (d) => changeTitleStatus(d, { titleId: 'county', statusId: 'extinct' }));
  for (const statusId of ['vacant', 'active', 'extinct']) refused(store, (d) => changeTitleStatus(d, { titleId: 'county', statusId }), 'politics_invalid_transition');
  refused(store, (d) => setTitleSuccessionLaw(d, { titleId: 'county', successionLawId: null }), 'politics_invalid_transition');
  // A status that does not allow a holder change blocks a swap inside it, and is left only through its next statuses.
  change(store, (d) => must(createTitle(d, { id: 'vault', statusId: 'locked', holderRef: person('ann') })));
  refused(store, (d) => changeTitleHolder(d, { titleId: 'vault', holderRef: person('bram') }), 'politics_invalid_transition');
  refused(store, (d) => transitionTitle(d, { titleId: 'vault', statusId: 'locked', holderRef: person('bram') }), 'politics_invalid_transition');
  refused(store, (d) => transitionTitle(d, { titleId: 'vault', statusId: 'vacant', holderRef: null }), 'politics_invalid_transition');
  refused(store, (d) => changeTitleParent(d, { titleId: 'vault', parentTitleId: 'crown' }), 'politics_invalid_transition');
  change(store, (d) => transitionTitle(d, { titleId: 'vault', statusId: 'active', holderRef: person('bram') }));
  assert.equal(world(store).titles.vault.holderRef.id, 'bram');
  // A terminal status is final even when it lists a next status.
  change(store, (d) => createTitle(d, { id: 'old_post', statusId: 'archived' }));
  refused(store, (d) => changeTitleStatus(d, { titleId: 'old_post', statusId: 'vacant' }), 'politics_invalid_transition');
  refused(store, (d) => changeTitleParent(d, { titleId: 'old_post', parentTitleId: 'crown' }), 'politics_invalid_transition');
});

test('[politics.title.transfer-and-inherit-flags] a title that cannot be transferred still passes by inheritance unless it is not inheritable', () => {
  const store = worldStore();
  addDefinitions(store,
    approved('title_type', 'bound_seat', { defaultStatusId: 'vacant', allowedParentTitleTypeIds: [], transferable: false, inheritable: true }),
    approved('title_type', 'for_life', { defaultStatusId: 'vacant', allowedParentTitleTypeIds: [], transferable: true, inheritable: false }));
  change(store, (d) => {
    must(createTitle(d, { id: 'seat_1', titleTypeId: 'bound_seat', statusId: 'active', holderRef: person('ann') }));
    must(createTitle(d, { id: 'post_1', titleTypeId: 'for_life', statusId: 'active', holderRef: person('ann') }));
  });
  refused(store, (d) => changeTitleHolder(d, { titleId: 'seat_1', holderRef: person('bram') }), 'politics_asset_not_transferable');
  change(store, (d) => changeTitleHolder(d, { titleId: 'seat_1', holderRef: person('bram') }, { via: 'inheritance' }));
  assert.equal(world(store).titles.seat_1.holderRef.id, 'bram');
  change(store, (d) => changeTitleHolder(d, { titleId: 'post_1', holderRef: person('bram') }));
  refused(store, (d) => changeTitleHolder(d, { titleId: 'post_1', holderRef: person('cora') }, { via: 'inheritance' }), 'politics_asset_not_inheritable');
});

test('[politics.title.holders] clans and factions may hold titles; the type decides which holders are allowed; succession laws must be known', () => {
  const store = worldStore();
  addDefinitions(store, approved('title_type', 'personal_honor', { defaultStatusId: 'vacant', allowedParentTitleTypeIds: [], allowedHolderRefTypes: ['character'] }));
  change(store, (d) => transitionTitle(d, { titleId: 'county', statusId: 'active', holderRef: ref('faction', 'realm_a') }));
  assert.deepEqual(world(store).titles.county.holderRef, ref('faction', 'realm_a'));
  change(store, (d) => changeTitleHolder(d, { titleId: 'county', holderRef: ref('clan', 'clan_b') }));
  assert.deepEqual(world(store).characters.ann.titleIds, ['crown', 'duchy'], 'only character holders appear on characters');
  refused(store, (d) => createTitle(d, { id: 'honor_1', titleTypeId: 'personal_honor', statusId: 'active', holderRef: ref('clan', 'clan_a') }), 'politics_title_holder_type_not_allowed');
  refused(store, (d) => setTitleSuccessionLaw(d, { titleId: 'duchy', successionLawId: 'no.law' }), 'politics_unregistered_succession_law');
  change(store, (d) => setTitleSuccessionLaw(d, { titleId: 'duchy', successionLawId: 'm1.default_succession' }));
  refused(store, (d) => setTitleSuccessionLaw(d, { titleId: 'duchy', successionLawId: 'm1.default_succession' }), 'politics_no_change');
});

// ---------------------------------------------------------------------------------------------
// Land rights

const settlement = (id) => ref('settlement', id);

test('[politics.rights.create] a right is stored in the earlier record shape; a single share is 1 and the start day is today', () => {
  const store = worldStore();
  assert.deepEqual(world(store).landRights.rule_north, {
    id: 'rule_north', version: 1, revision: 0, rightTypeId: 'rule', subjectRef: settlement('s_north'), holderRef: ref('faction', 'realm_a'), basisRef: null,
    share: 1, startDay: 100, endDay: null, status: 'active', supersedesRightId: null, supersededByRightId: null, disputed: false,
    recognizedByFactionIds: [], customData: {},
  });
  assert.deepEqual(world(store).landRights.claim_east.recognizedByFactionIds, ['realm_a']);
  assert.deepEqual(world(store).characters.ann.claimIds, ['claim_east'], 'a character\'s claim index follows its claim rights');
});

test('[politics.rights.create-refused] a right with a bad id, type, reference, share or day is refused whole', () => {
  const store = worldStore();
  addDefinitions(store, approved('land_right_type', 'granted', { basisRequired: true }), approved('land_right_type', 'unshared', { shareMode: 'none' }));
  const base = { id: 'r_new', rightTypeId: 'revenue', subjectRef: settlement('s_east'), holderRef: person('bram'), share: 0.5 };
  const create = (patch) => (d) => createLandRight(d, { ...base, ...patch });
  const problemsOf = (patch) => createLandRight(clone(store.getState()), { ...base, ...patch }).detail.problems;
  refused(store, create({ rightTypeId: 'granted', share: 1 }), 'politics_invalid_land_right');
  assert.deepEqual(problemsOf({ rightTypeId: 'granted', share: 1 }), ['basis_ref_required']);
  refused(store, create({ rightTypeId: 'unshared', share: 1 }), 'politics_invalid_land_right');
  assert.deepEqual(problemsOf({ rightTypeId: 'unshared', share: 1 }), ['invalid_share']);
  refused(store, (d) => createLandRight(d, null), 'politics_invalid_input');
  change(store, create({ id: 'r_with_basis', rightTypeId: 'granted', share: 1, basisRef: ref('title', 'crown') }));
  change(store, create({ id: 'r_unshared', rightTypeId: 'unshared', share: undefined }));
  assert.equal(world(store).landRights.r_unshared.share, null);
  refused(store, create({ id: 'Bad Id' }), 'politics_invalid_land_right_id');
  refused(store, create({ id: 'rule_north' }), 'politics_duplicate_land_right_id');
  refused(store, create({ rightTypeId: 'tax' }), 'politics_unknown_land_right_type');
  refused(store, create({ subjectRef: settlement('s_nowhere') }), 'politics_invalid_land_right');
  refused(store, create({ subjectRef: ref('clan', 'clan_a') }), 'politics_invalid_land_right');
  refused(store, create({ subjectRef: 's_east' }), 'politics_invalid_land_right');
  refused(store, create({ holderRef: person('ghost') }), 'politics_missing_holder');
  refused(store, create({ holderRef: person('dax') }), 'politics_holder_not_alive');
  refused(store, create({ holderRef: ref('mobile_group', 'legacy_player_group') }), 'politics_holder_type_not_allowed');
  refused(store, create({ holderRef: null }), 'politics_invalid_holder_ref');
  refused(store, create({ holderRef: { ...person('bram'), extra: 1 } }), 'politics_invalid_holder_ref');
  refused(store, create({ subjectRef: { ...settlement('s_east'), extra: 1 } }), 'politics_invalid_land_right');
  refused(store, create({ basisRef: ref('title', 'ghost') }), 'politics_invalid_land_right');
  refused(store, create({ basisRef: ref('clan', 'clan_a') }), 'politics_invalid_land_right');
  refused(store, create({ basisRef: ref('land_right', 'r_new') }), 'politics_invalid_land_right');
  refused(store, create({ share: undefined }), 'politics_invalid_share');
  refused(store, create({ share: 0 }), 'politics_invalid_land_right');
  refused(store, create({ share: 1.5 }), 'politics_invalid_land_right');
  refused(store, create({ share: '0.5' }), 'politics_invalid_share');
  refused(store, create({ share: 0.0000005 }), 'politics_invalid_land_right');
  refused(store, create({ rightTypeId: 'holding', share: 0.5 }), 'politics_invalid_land_right');
  refused(store, create({ startDay: -1 }), 'politics_invalid_start_day');
  refused(store, create({ startDay: 1.5 }), 'politics_invalid_start_day');
  refused(store, create({ startDay: 120, endDay: 110 }), 'politics_invalid_land_right');
  refused(store, create({ endDay: 'soon' }), 'politics_invalid_end_day');
  refused(store, create({ recognizedByFactionIds: ['nowhere'] }), 'politics_invalid_land_right');
  refused(store, create({ recognizedByFactionIds: 'realm_a' }), 'politics_invalid_recognition_list');
  refused(store, create({ disputed: 'yes' }), 'politics_invalid_disputed');
  refused(store, create({ customData: [] }), 'politics_invalid_custom_data');
});

test('[politics.rights.overlap-modes] each kind allows or refuses overlapping rights on one settlement as its mode says', () => {
  const store = worldStore();
  const make = (id, rightTypeId, subject, holderRef, extra = {}) => (d) => createLandRight(d, { id, rightTypeId, subjectRef: settlement(subject), holderRef, ...extra });
  // deny_any: one rule / administration / occupation per settlement.
  refused(store, make('rule_again', 'rule', 's_north', person('bram')), 'politics_land_right_conflict');
  refused(store, make('admin_again', 'administration', 's_south', person('cora')), 'politics_land_right_conflict');
  refused(store, make('occ_again', 'military_occupation', 's_west', ref('faction', 'realm_a')), 'politics_land_right_conflict');
  change(store, make('rule_other', 'rule', 's_east', person('bram')));
  // deny_same_holder: two holders may hold, one holder may not hold twice.
  change(store, make('holding_bram', 'holding', 's_south', person('bram')));
  refused(store, make('holding_bram_2', 'holding', 's_south', person('bram')), 'politics_land_right_conflict');
  refused(store, make('holding_clan_2', 'holding', 's_south', ref('clan', 'clan_a')), 'politics_land_right_conflict');
  // allow: any number of suzerainties and claims.
  change(store, make('suz_1', 'suzerainty', 's_south', ref('faction', 'realm_a')));
  change(store, make('suz_2', 'suzerainty', 's_south', ref('clan', 'clan_b')));
  change(store, make('suz_3', 'suzerainty', 's_south', ref('clan', 'clan_b')));
  // fractional_sum: shares on one settlement add up to at most one whole.
  change(store, make('rev_1', 'revenue', 's_south', person('bram'), { share: 0.57 }));
  change(store, make('rev_2', 'revenue', 's_south', person('cora'), { share: 0.43 }));
  refused(store, make('rev_3', 'revenue', 's_south', person('ann'), { share: 0.000001 }), 'politics_land_right_conflict');
  refused(store, make('own_3', 'legal_ownership', 's_south', person('bram'), { share: 0.000001 }), 'politics_land_right_conflict');
  change(store, make('own_east', 'legal_ownership', 's_east', person('bram'), { share: 0.333333 }));
  change(store, make('own_east_2', 'legal_ownership', 's_east', person('cora'), { share: 0.666667 }));
  // A right that ended no longer takes up room.
  change(store, (d) => terminateLandRight(d, { rightId: 'rule_north' }));
  change(store, make('rule_north_2', 'rule', 's_north', person('bram')));
});

test('[politics.rights.transfer] a transferable right passes to a new holder; a claim cannot be given away; nothing else moves', () => {
  const store = worldStore();
  const before = world(store).landRights.holding_south;
  change(store, (d) => transferLandRight(d, { rightId: 'holding_south', holderRef: person('bram') }));
  assert.deepEqual(world(store).landRights.holding_south.holderRef, person('bram'));
  assert.equal(world(store).landRights.holding_south.revision, before.revision + 1);
  refused(store, (d) => transferLandRight(d, { rightId: 'holding_south', holderRef: person('bram') }), 'politics_no_change');
  refused(store, (d) => transferLandRight(d, { rightId: 'claim_east', holderRef: person('bram') }), 'politics_asset_not_transferable');
  refused(store, (d) => transferLandRight(d, { rightId: 'holding_south', holderRef: person('dax') }), 'politics_holder_not_alive');
  refused(store, (d) => transferLandRight(d, { rightId: 'holding_south', holderRef: person('ghost') }), 'politics_missing_holder');
  refused(store, (d) => transferLandRight(d, { rightId: 'holding_south', holderRef: null }), 'politics_invalid_holder_ref');
  refused(store, (d) => transferLandRight(d, { rightId: 'ghost', holderRef: person('bram') }), 'politics_missing_land_right');
  refused(store, (d) => transferLandRight(d, { rightId: 'holding_south' }), 'politics_invalid_holder_ref');
  // The claim passes by inheritance though (inheritable, not transferable).
  change(store, (d) => transferLandRight(d, { rightId: 'claim_east', holderRef: person('bram') }, { via: 'inheritance' }));
  assert.deepEqual([world(store).characters.ann.claimIds, world(store).characters.bram.claimIds], [[], ['claim_east']]);
  refused(store, (d) => transferLandRight(d, { rightId: 'occupation_west', holderRef: ref('clan', 'clan_b') }, { via: 'inheritance' }), 'politics_asset_not_inheritable');
  // Moving a holding onto a holder who already holds one on the same settlement is a conflict.
  change(store, (d) => createLandRight(d, { id: 'holding_cora', rightTypeId: 'holding', subjectRef: settlement('s_south'), holderRef: person('cora') }));
  refused(store, (d) => transferLandRight(d, { rightId: 'holding_south', holderRef: person('cora') }), 'politics_land_right_conflict');
});

test('[politics.rights.recognition-and-dispute] factions recognizing a right and the disputed flag change only on rights in force', () => {
  const store = worldStore();
  change(store, (d) => must(createFaction(d, { id: 'league_b' })));
  change(store, (d) => setLandRightRecognition(d, { rightId: 'rule_north', recognizedByFactionIds: ['realm_a', 'league_b', 'realm_a'] }));
  assert.deepEqual(world(store).landRights.rule_north.recognizedByFactionIds, ['league_b', 'realm_a']);
  refused(store, (d) => setLandRightRecognition(d, { rightId: 'rule_north', recognizedByFactionIds: ['realm_a', 'league_b'] }), 'politics_no_change');
  refused(store, (d) => setLandRightRecognition(d, { rightId: 'rule_north', recognizedByFactionIds: ['ghost'] }), 'politics_invalid_land_right');
  refused(store, (d) => setLandRightRecognition(d, { rightId: 'rule_north', recognizedByFactionIds: 'league_b' }), 'politics_invalid_recognition_list');
  change(store, (d) => setLandRightDisputed(d, { rightId: 'rule_north', disputed: true }));
  assert.equal(world(store).landRights.rule_north.disputed, true);
  refused(store, (d) => setLandRightDisputed(d, { rightId: 'rule_north', disputed: true }), 'politics_no_change');
  refused(store, (d) => setLandRightDisputed(d, { rightId: 'rule_north', disputed: 'maybe' }), 'politics_invalid_disputed');
  change(store, (d) => terminateLandRight(d, { rightId: 'rule_north' }));
  refused(store, (d) => setLandRightDisputed(d, { rightId: 'rule_north', disputed: false }), 'politics_invalid_transition');
  refused(store, (d) => setLandRightRecognition(d, { rightId: 'rule_north', recognizedByFactionIds: [] }), 'politics_invalid_transition');
});

test('[politics.rights.terminate-supersede] a right ends on a day; a superseded right is linked to its successor and both stay consistent', () => {
  const store = worldStore();
  change(store, (d) => terminateLandRight(d, { rightId: 'rule_north', endDay: 105 }));
  assert.deepEqual([world(store).landRights.rule_north.status, world(store).landRights.rule_north.endDay], ['terminated', 105]);
  refused(store, (d) => terminateLandRight(d, { rightId: 'rule_north' }), 'politics_invalid_transition');
  refused(store, (d) => terminateLandRight(d, { rightId: 'occupation_west', endDay: 99 }), 'politics_invalid_end_day');
  refused(store, (d) => terminateLandRight(d, { rightId: 'occupation_west', endDay: 1.5 }), 'politics_invalid_end_day');
  refused(store, (d) => terminateLandRight(d, { rightId: 'ghost' }), 'politics_missing_land_right');

  change(store, (d) => supersedeLandRight(d, { rightId: 'admin_north', nextRight: { id: 'admin_north_2', holderRef: person('cora') } }));
  const old = world(store).landRights.admin_north;
  const next = world(store).landRights.admin_north_2;
  assert.deepEqual([old.status, old.endDay, old.supersededByRightId], ['superseded', 100, 'admin_north_2']);
  assert.deepEqual([next.status, next.supersedesRightId, next.rightTypeId, next.subjectRef], ['active', 'admin_north', 'administration', settlement('s_south')]);
  assert.deepEqual(next.basisRef, ref('title', 'duchy'), 'the basis carries over unless replaced');
  const nextRight = (patch) => ({ rightId: 'admin_north_2', nextRight: { id: 'admin_north_3', holderRef: person('bram'), ...patch } });
  refused(store, (d) => supersedeLandRight(d, { rightId: 'admin_north', nextRight: { id: 'x1', holderRef: person('bram') } }), 'politics_invalid_transition');
  refused(store, (d) => supersedeLandRight(d, nextRight({ id: 'admin_north' })), 'politics_duplicate_land_right_id');
  refused(store, (d) => supersedeLandRight(d, nextRight({ id: 'Bad Id' })), 'politics_invalid_next_right');
  refused(store, (d) => supersedeLandRight(d, nextRight({ rightTypeId: 'rule' })), 'politics_supersede_changes_subject_or_type');
  refused(store, (d) => supersedeLandRight(d, nextRight({ subjectRef: settlement('s_east') })), 'politics_supersede_changes_subject_or_type');
  refused(store, (d) => supersedeLandRight(d, nextRight({ holderRef: person('dax') })), 'politics_holder_not_alive');
  refused(store, (d) => supersedeLandRight(d, nextRight({ holderRef: undefined })), 'politics_invalid_holder_ref');
  refused(store, (d) => supersedeLandRight(d, { rightId: 'admin_north_2', nextRight: 'bram' }), 'politics_invalid_next_right');
  refused(store, (d) => supersedeLandRight(d, { ...nextRight({}), endDay: 50 }), 'politics_invalid_end_day');
  refused(store, (d) => supersedeLandRight(d, nextRight({ share: 0.5 })), 'politics_invalid_land_right');
  // A fractional right keeps its share through a supersede unless the new one names another.
  change(store, (d) => supersedeLandRight(d, { rightId: 'own_south_clan', nextRight: { id: 'own_south_clan_2', holderRef: person('cora') } }));
  assert.equal(world(store).landRights.own_south_clan_2.share, 0.4);
  change(store, (d) => supersedeLandRight(d, { rightId: 'own_south_clan_2', nextRight: { id: 'own_south_clan_3', holderRef: person('cora'), share: 0.35 } }));
  assert.equal(world(store).landRights.own_south_clan_3.share, 0.35);
  assert.deepEqual(politics.checkPolitics(store.getState()), { ok: true });
});

test('[politics.rights.share-units] shares are whole millionths, rounded before they are compared', () => {
  assert.equal(politics.LAND_RIGHT_SHARE_SCALE, 1000000);
  // 0.000249 * 1000000 is 248.99999999999997 in floating point; it is still exactly 249 millionths.
  assert.equal(unitsFromShare(0.000249), 249);
  assert.equal(unitsFromShare(0.57), 570000);
  assert.equal(unitsFromShare(1), 1000000);
  assert.equal(unitsFromShare(0), 0);
  for (const bad of [0.0000005, 0.1234567, -0.1, Number.NaN, Infinity, '0.5', null, undefined]) assert.equal(unitsFromShare(bad), null, String(bad));
  assert.equal(politics.shareFromUnits(249), 0.000249);
  const store = worldStore();
  change(store, (d) => createLandRight(d, { id: 'tiny_1', rightTypeId: 'revenue', subjectRef: settlement('s_east'), holderRef: person('bram'), share: 0.000249 }));
  change(store, (d) => createLandRight(d, { id: 'tiny_2', rightTypeId: 'revenue', subjectRef: settlement('s_east'), holderRef: person('cora'), share: 0.999751 }));
  refused(store, (d) => createLandRight(d, { id: 'tiny_3', rightTypeId: 'revenue', subjectRef: settlement('s_east'), holderRef: person('ann'), share: 0.000001 }), 'politics_land_right_conflict');
});

test('[politics.rights.split] a fractional right is split in whole millionths; the original keeps a positive remainder', () => {
  const store = worldStore();
  change(store, (d) => setLandRightRecognition(d, { rightId: 'own_south_ann', recognizedByFactionIds: ['realm_a'] }));
  change(store, (d) => splitLandRight(d, { rightId: 'own_south_ann', splits: [{ id: 'own_south_bram', holderRef: person('bram'), shareUnits: 100000 }, { id: 'own_south_cora', holderRef: person('cora'), shareUnits: 50000 }] }));
  assert.deepEqual(['own_south_ann', 'own_south_bram', 'own_south_cora'].map((id) => world(store).landRights[id].share), [0.45, 0.1, 0.05]);
  assert.equal(world(store).landRights.own_south_bram.startDay, 100);
  assert.deepEqual([world(store).landRights.own_south_bram.revision, world(store).landRights.own_south_ann.revision], [0, 2]);
  assert.deepEqual(world(store).landRights.own_south_bram.recognizedByFactionIds, ['realm_a'], 'a new right copies the original\'s other fields');
  // A right that replaced another splits into rights that are not part of that chain.
  change(store, (d) => supersedeLandRight(d, { rightId: 'own_south_clan', nextRight: { id: 'own_south_clan_2', holderRef: person('cora') } }));
  change(store, (d) => splitLandRight(d, { rightId: 'own_south_clan_2', splits: [{ id: 'own_south_clan_part', holderRef: person('bram'), shareUnits: 100000 }] }));
  assert.deepEqual([world(store).landRights.own_south_clan_part.supersedesRightId, world(store).landRights.own_south_clan_2.supersedesRightId], [null, 'own_south_clan']);
  const split = (patch, id = 'own_south_ann') => (d) => splitLandRight(d, { rightId: id, splits: [{ id: 's_x', holderRef: person('bram'), shareUnits: 1000, ...patch }] });
  refused(store, split({ shareUnits: 450000 }), 'politics_land_right_share_exceeded');
  refused(store, split({ shareUnits: 460000 }), 'politics_land_right_share_exceeded');
  refused(store, split({ shareUnits: 0 }), 'politics_asset_minimum_unit_violation');
  refused(store, split({ shareUnits: 1.5 }), 'politics_asset_minimum_unit_violation');
  refused(store, split({ id: 'own_south_bram' }), 'politics_allocation_conflict');
  refused(store, split({ id: 'Bad Id' }), 'politics_allocation_conflict');
  refused(store, split({ holderRef: person('dax') }), 'politics_holder_not_alive');
  refused(store, split({}, 'holding_south'), 'politics_asset_minimum_unit_violation');
  refused(store, split({}, 'ghost'), 'politics_missing_land_right');
  refused(store, (d) => splitLandRight(d, { rightId: 'own_south_ann', splits: [] }), 'politics_invalid_splits');
  refused(store, (d) => splitLandRight(d, { rightId: 'own_south_ann', splits: [{ id: 'dup_1', holderRef: person('bram'), shareUnits: 10 }, { id: 'dup_1', holderRef: person('cora'), shareUnits: 10 }] }), 'politics_allocation_conflict');
  // Giving shares away is a transfer: kinds that cannot be transferred cannot be split that way.
  addDefinitions(store, approved('land_right_type', 'bound_share', { shareMode: 'fractional', overlapMode: 'fractional_sum', transferable: false }));
  change(store, (d) => createLandRight(d, { id: 'bound_1', rightTypeId: 'bound_share', subjectRef: settlement('s_north'), holderRef: person('ann'), share: 1 }));
  refused(store, split({}, 'bound_1'), 'politics_asset_not_transferable');
  // The whole share can only be handed out by inheritance, and then the original ends.
  refused(store, (d) => splitLandRight(d, { rightId: 'bound_1', splits: [{ id: 'bound_2', holderRef: person('bram'), shareUnits: 1000000 }] }), 'politics_asset_not_transferable');
  change(store, (d) => splitLandRight(d, { rightId: 'bound_1', splits: [{ id: 'bound_2', holderRef: person('bram'), shareUnits: 600000 }, { id: 'bound_3', holderRef: person('cora'), shareUnits: 400000 }] }, { via: 'inheritance' }));
  assert.equal(world(store).landRights.bound_1.status, 'terminated');
  assert.deepEqual([world(store).landRights.bound_2.share, world(store).landRights.bound_3.share], [0.6, 0.4]);
  assert.deepEqual(politics.checkPolitics(store.getState()), { ok: true });
});

test('[politics.rights.queries] settlements are found by holder, by recognizing faction and as the rights in force on a day', () => {
  const store = worldStore();
  const state = store.getState();
  assert.deepEqual(listSettlementIdsByHolder(state, ref('faction', 'realm_a')), ['s_north', 's_west']);
  assert.deepEqual(listSettlementIdsByHolder(state, ref('faction', 'realm_a'), 'rule'), ['s_north']);
  assert.deepEqual(listSettlementIdsByHolder(state, ref('faction', 'realm_a'), ['rule', 'military_occupation']), ['s_north', 's_west']);
  assert.deepEqual(listSettlementIdsByHolder(state, ref('clan', 'clan_a')), [], 'holdings do not count toward the faction index');
  assert.deepEqual(listSettlementIdsByHolder(state, ref('faction', 'realm_a'), null, 99), []);
  assert.deepEqual(listSettlementIdsByHolder(state, ref('faction', 'realm_a'), null, -1), []);
  assert.deepEqual(listSettlementIdsByHolder(state, 'realm_a'), []);
  assert.deepEqual(listSettlementIdsByRecognizingFaction(state, 'realm_a'), ['s_east']);
  assert.deepEqual(listSettlementIdsByRecognizingFaction(state, 'realm_a', 'rule'), []);
  assert.deepEqual(listSettlementIdsByRecognizingFaction(state, 'realm_a', ['claim'], 99), []);
  const south = listRightsOnSettlement(state, 's_south');
  assert.deepEqual(south.map((right) => right.id), ['admin_north', 'holding_south', 'own_south_ann', 'own_south_clan']);
  assert.deepEqual(listRightsOnSettlement(state, 's_south', 99), []);
  south[0].holderRef.id = 'changed';
  assert.equal(state.world.landRights.admin_north.holderRef.id, 'bram', 'the list holds copies');
  // A right with an end day stops counting after it.
  change(store, (d) => createLandRight(d, { id: 'rule_east', rightTypeId: 'rule', subjectRef: settlement('s_east'), holderRef: ref('faction', 'realm_a'), startDay: 90, endDay: 105 }));
  assert.deepEqual(listSettlementIdsByHolder(store.getState(), ref('faction', 'realm_a'), 'rule', 105), ['s_east', 's_north']);
  assert.deepEqual(listSettlementIdsByHolder(store.getState(), ref('faction', 'realm_a'), 'rule', 106), ['s_north']);
  assert.deepEqual(listSettlementIdsByHolder(store.getState(), ref('faction', 'realm_a'), 'rule', 89), []);
});

// ---------------------------------------------------------------------------------------------
// Checks

test('[politics.checks.valid-state] a consistent world passes the area check and the whole-state check, also after a save round trip', () => {
  assert.deepEqual(checkPolitics(newGameState()), { ok: true });
  const store = worldStore();
  assert.deepEqual(checkPolitics(store.getState()), { ok: true });
  assert.deepEqual(validateState(store.getState()), { ok: true });
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(store.getState()))), { ok: true });
});

test('[politics.checks.registered] the area check is part of whole-state validation, so a broken record cannot be stored or loaded', () => {
  const store = worldStore();
  const broken = clone(store.getState());
  broken.world.clans.clan_a.headCharacterId = 'fay';
  const verdict = validateState(broken);
  assert.equal(verdict.error, 'state_invalid');
  assert.ok(verdict.detail.some((issue) => issue.startsWith('politics: politics_invalid_records')));
  const before = clone(store.getState());
  const result = store.transact('corrupt', (d) => { d.world.clans.clan_a.headCharacterId = 'fay'; });
  assert.equal(result.error, 'store_state_invalid');
  assert.equal(store.replace(broken).error, 'store_state_invalid');
  assert.deepEqual(store.getState(), before);
});

const CORRUPTIONS = [
  ['clan head is not a member', (w) => { w.clans.clan_a.headCharacterId = 'fay'; }, 'clans.clan_a: head_not_member'],
  ['clan head does not exist', (w) => { w.clans.clan_a.headCharacterId = 'ghost'; }, 'clans.clan_a: missing_head'],
  ['clan faction does not exist', (w) => { w.clans.clan_c.factionId = 'ghost'; }, 'clans.clan_c: missing_faction'],
  ['clan treasury owned by another', (w) => { w.clans.clan_a.treasuryAccountId = 'acct_clan_b'; }, 'clans.clan_a: treasury_owner_mismatch'],
  ['clan treasury account missing', (w) => { w.clans.clan_a.treasuryAccountId = 'ghost'; }, 'clans.clan_a: missing_treasury_account'],
  ['branch clan missing', (w) => { w.clans.clan_a.branchClanIds = ['ghost']; }, 'clans.clan_a: missing_branch_clan'],
  ['branch clans not in order', (w) => { w.clans.clan_a.branchClanIds = ['clan_c', 'clan_b']; }, 'clans.clan_a: invalid_branch_clans'],
  ['two pacts with one id', (w) => {
    const pact = { id: 'p', version: 1, status: 'draft' };
    w.clans.clan_a.inheritancePacts = [pact, { ...pact }];
  }, 'duplicate_pact_id:p'],
  ['branch is the clan itself', (w) => { w.clans.clan_a.branchClanIds = ['clan_a']; }, 'clans.clan_a: invalid_branch_clans'],
  ['designated successor missing', (w) => { w.clans.clan_a.designatedSuccessorIds = ['ghost']; }, 'clans.clan_a: missing_designated_successor'],
  ['clan keeps a derived field', (w) => { w.clans.clan_a.memberCharacterIds = []; }, 'derived_field_stored:memberCharacterIds'],
  ['clan metric is not a number', (w) => { w.clans.clan_a.standing.unity = 'high'; }, 'invalid_clan_metric:standing'],
  ['clan law unknown', (w) => { w.clans.clan_a.successionLawId = 'ghost'; }, 'unregistered_succession_law'],
  ['clan record under the wrong key', (w) => { w.clans.other_key = w.clans.clan_b; delete w.clans.clan_b; }, 'record_id_mismatch'],
  ['clan pact malformed', (w) => { w.clans.clan_a.inheritancePacts = [{ id: 'p', version: 1, status: 'active', consents: [{ accepted: false }] }]; }, 'invalid_pact:missing_required_consent'],
  ['faction ruler missing', (w) => { w.factions.realm_a.rulerCharacterId = 'ghost'; }, 'factions.realm_a: missing_ruler'],
  ['ruling clan outside the faction', (w) => { w.factions.realm_a.rulingClanId = 'clan_c'; }, 'factions.realm_a: ruling_clan_not_member'],
  ['faction treasury owned by a clan', (w) => { w.factions.realm_a.treasuryAccountId = 'acct_clan_a'; }, 'factions.realm_a: treasury_owner_mismatch'],
  ['faction power out of range', (w) => { w.factions.realm_a.sovereignPower.coercivePower = 101; }, 'invalid_faction_power:coercivePower'],
  ['faction type unknown', (w) => { w.factions.realm_a.factionTypeId = 'empire'; }, 'unregistered_faction_type'],
  ['faction laws unsorted', (w) => { w.factions.realm_a.lawIds = ['b', 'a']; }, 'invalid_law_ids'],
  ['title with status needing a holder has none', (w) => { w.titles.crown.holderRef = null; }, 'title_holder_required'],
  ['title with status forbidding a holder has one', (w) => { w.titles.county.holderRef = person('ann'); }, 'title_holder_forbidden'],
  ['title holder missing', (w) => { w.titles.crown.holderRef = person('ghost'); }, 'missing_holder'],
  ['title parent missing', (w) => { w.titles.county.parentTitleId = 'ghost'; }, 'missing_parent_title'],
  ['title parent loop', (w) => { w.titles.crown.parentTitleId = 'county'; }, 'title_parent_cycle'],
  ['title type unknown', (w) => { w.titles.crown.titleTypeId = 'emperor'; }, 'unregistered_title_type'],
  ['title name not text', (w) => { w.titles.crown.name = 5; }, 'titles.crown: invalid_name'],
  ['title under the wrong key', (w) => { w.titles.other = w.titles.county; delete w.titles.county; }, 'titles.other: record_id_mismatch'],
  ['title status unknown', (w) => { w.titles.crown.statusId = 'sleeping'; }, 'unregistered_title_status'],
  ['title holder of a kind its type does not allow', (w) => {
    w.customDefinitions.records['title_type:personal_honor'] = approved('title_type', 'personal_honor', { defaultStatusId: 'vacant', allowedParentTitleTypeIds: ['generic_title'], allowedHolderRefTypes: ['character'] });
    Object.assign(w.titles.county, { titleTypeId: 'personal_honor', statusId: 'active', holderRef: ref('clan', 'clan_a') });
  }, 'title_holder_type_not_allowed'],
  ['land right holder of a kind its type does not allow', (w) => {
    w.customDefinitions.records['land_right_type:clan_only'] = approved('land_right_type', 'clan_only', { allowedHolderRefTypes: ['clan'] });
    w.landRights.rule_north.rightTypeId = 'clan_only';
  }, 'holder_type_not_allowed'],
  ['land right based on itself', (w) => { w.landRights.rule_north.basisRef = ref('land_right', 'rule_north'); }, 'basis_is_self'],
  ['land right marked superseded without a successor', (w) => { w.landRights.rule_north.supersededByRightId = 'admin_north'; }, 'supersede_status_mismatch'],
  ['land right says it replaced one that does not say so back', (w) => { w.landRights.rule_north.supersedesRightId = 'admin_north'; }, 'supersede_link_mismatch:rule_north'],
  ['land right recognition list not in order', (w) => {
    w.factions.realm_b = { ...w.factions.realm_a, id: 'realm_b', rulerCharacterId: null, rulingClanId: null, treasuryAccountId: null };
    w.landRights.claim_east.recognizedByFactionIds = ['realm_b', 'realm_a'];
  }, 'invalid_recognition_list'],
  ['clan treasury owned by a faction of the same id', (w) => { w.clans.clan_b.treasuryAccountId = 'acct_twin'; }, 'clans.clan_b: treasury_owner_mismatch'],
  ['faction ruling clan missing', (w) => { w.factions.realm_a.rulingClanId = 'ghost'; }, 'factions.realm_a: missing_ruling_clan'],
  ['land right subject missing', (w) => { w.landRights.rule_north.subjectRef = settlement('s_nowhere'); }, 'missing_subject'],
  ['land right holder missing', (w) => { w.landRights.rule_north.holderRef = ref('clan', 'ghost'); }, 'missing_holder'],
  ['land right basis missing', (w) => { w.landRights.rule_north.basisRef = ref('title', 'ghost'); }, 'missing_basis'],
  ['land right recognized by a missing faction', (w) => { w.landRights.claim_east.recognizedByFactionIds = ['ghost']; }, 'missing_recognizing_faction'],
  ['land right share beyond a millionth', (w) => { w.landRights.own_south_ann.share = 0.1234567; }, 'invalid_share_precision'],
  ['land rights overlap', (w) => { w.landRights.rule_again = { ...w.landRights.rule_north, id: 'rule_again' }; }, 'land_right_overlap:settlement:s_north|rule'],
  ['land shares exceed one', (w) => { w.landRights.own_south_clan.share = 0.5; }, 'land_right_share_exceeded'],
  ['ended right without an end day', (w) => { w.landRights.rule_north.status = 'terminated'; }, 'ended_right_needs_end_day'],
  ['superseded right without its successor', (w) => { Object.assign(w.landRights.rule_north, { status: 'superseded', endDay: 100, supersededByRightId: 'ghost' }); }, 'supersede_link_mismatch:rule_north'],
  ['character in a missing clan', (w) => { w.characters.hana.affiliations.clanId = 'ghost'; }, 'characters.hana: missing_clan'],
  ['character in a missing faction', (w) => { w.characters.hana.affiliations.factionId = 'ghost'; }, 'characters.hana: missing_faction'],
  ['character faction differs from the clan\'s', (w) => { w.characters.fay.affiliations.factionId = null; }, 'characters.fay: clan_faction_mismatch'],
  ['character title index stale', (w) => { w.characters.ann.titleIds = ['crown']; }, 'characters.ann: title_index_mismatch'],
  ['character title index missing a title', (w) => { w.characters.hana.titleIds = ['crown']; }, 'characters.hana: title_index_mismatch'],
  ['character claim index stale', (w) => { w.characters.ann.claimIds = []; }, 'characters.ann: claim_index_mismatch'],
];

test('[politics.checks.rejects-corruption] each broken link between politics records is named by the area check', () => {
  const good = worldStore().getState();
  for (const [name, corrupt, expected] of CORRUPTIONS) {
    const state = clone(good);
    corrupt(state.world);
    const verdict = checkPolitics(state);
    assert.equal(verdict.ok, false, name);
    assert.equal(verdict.error, 'politics_invalid_records', name);
    assert.ok(verdict.detail.some((issue) => issue.includes(expected)), `${name}: expected "${expected}" in ${JSON.stringify(verdict.detail)}`);
  }
  const state = clone(good);
  state.playerControl.campaignClanId = 'ghost';
  assert.ok(checkPolitics(state).detail.includes('playerControl.campaignClanId: missing_clan'));
  state.playerControl.campaignClanId = 'clan_a';
  assert.deepEqual(checkPolitics(state), { ok: true });
  const noRoot = clone(good);
  noRoot.world.titles = [];
  assert.equal(checkPolitics(noRoot).error, 'politics_invalid_root');
});

// ---------------------------------------------------------------------------------------------
// Succession

const dies = (d, id = 'ann') => { d.world.characters[id].identity.alive = false; };
const asDeath = (input) => (d) => resolveSuccession(d, { cause: 'death', decedentCharacterId: 'ann', ...input });
// A world in which ann (head of clan_a, ruler, title holder) has died.
const deadStore = () => {
  const store = worldStore();
  change(store, (d) => dies(d));
  return store;
};

test('[politics.succession.clan-head] the first eligible designated successor becomes head, in the order designated', () => {
  const store = deadStore();
  const result = change(store, asDeath({ clan: { clanId: 'clan_a' } }));
  assert.deepEqual(result.clanHead, person('bram'));
  assert.equal(world(store).clans.clan_a.headCharacterId, 'bram');
  assert.deepEqual(result.resultTagIds, ['clan_head_changed']);
  assert.equal(world(store).clans.clan_a.revision, 1 + world(worldStore()).clans.clan_a.revision);
  // Reordering the designated successors changes the heir.
  const other = worldStore();
  change(other, (d) => setDesignatedSuccessors(d, { clanId: 'clan_a', characterIds: ['cora', 'bram'] }));
  change(other, (d) => dies(d));
  assert.deepEqual(change(other, asDeath({ clan: { clanId: 'clan_a' } })).clanHead, person('cora'));
  // The caller's own candidates replace the designated ones.
  const explicit = deadStore();
  assert.deepEqual(change(explicit, asDeath({ clan: { clanId: 'clan_a', candidateRefs: [person('cora')] } })).clanHead, person('cora'));
});

test('[politics.succession.eligibility] the dead, the incapacitated, the released, non-members and the decedent are passed over', () => {
  const store = worldStore();
  change(store, (d) => setDesignatedSuccessors(d, { clanId: 'clan_a', characterIds: ['dax', 'eli', 'fay', 'ann', 'bram', 'cora'] }));
  change(store, (d) => dies(d));
  const first = change(store, asDeath({ clan: { clanId: 'clan_a' } }));
  assert.deepEqual(first.clanHead, person('bram'), 'dax is dead, eli incapacitated, fay in another clan, ann is the decedent');
  const released = deadStore();
  change(released, (d) => { d.playerControl.permanentlyReleasedCharacterIds = ['bram']; });
  assert.deepEqual(change(released, asDeath({ clan: { clanId: 'clan_a' } })).clanHead, person('cora'));
  // Abdication: the ruler is alive but still cannot succeed himself, even when named first.
  const abdicating = worldStore();
  const abdication = change(abdicating, (d) => resolveSuccession(d, {
    cause: 'abdication', decedentCharacterId: 'ann', clan: { clanId: 'clan_a', candidateRefs: [person('ann')], legalHeirRefs: [person('ann'), person('cora')] },
  }));
  assert.deepEqual(abdication.clanHead, person('cora'));
});

test('[politics.succession.legal-heirs] the legal heirs follow the designated candidates in the order the caller gives', () => {
  const store = deadStore();
  const plan = { clan: { clanId: 'clan_a', candidateRefs: [person('dax')], legalHeirRefs: [person('hana'), ref('clan', 'clan_b'), person('cora'), person('bram')] } };
  assert.deepEqual(change(store, asDeath(plan)).clanHead, person('cora'), 'hana belongs to no clan; a clan reference cannot be head');
  refused(deadStore(), asDeath({ clan: { clanId: 'clan_a', candidateRefs: [], legalHeirRefs: [] } }), 'politics_no_eligible_legal_heir');
  refused(deadStore(), asDeath({ clan: { clanId: 'clan_a', candidateRefs: [person('dax'), person('eli')], legalHeirRefs: [person('fay')] } }), 'politics_no_eligible_legal_heir');
  refused(deadStore(), asDeath({ clan: { clanId: 'clan_a', candidateRefs: [person('ghost')] } }), 'politics_missing_ref_target');
});

test('[politics.succession.titles] each named title goes to its own heir; the title indexes of old and new holders follow', () => {
  const store = deadStore();
  const before = clone(world(store));
  const result = change(store, asDeath({
    titles: [
      { titleId: 'crown', candidateRefs: [person('bram')] },
      { titleId: 'duchy', candidateRefs: [person('dax')], legalHeirRefs: [person('cora')] },
    ],
  }));
  assert.deepEqual(result.titles, [{ titleId: 'crown', holderRef: person('bram') }, { titleId: 'duchy', holderRef: person('cora') }]);
  assert.deepEqual(result.resultTagIds, ['title_inherited']);
  assert.deepEqual([world(store).characters.ann.titleIds, world(store).characters.bram.titleIds, world(store).characters.cora.titleIds], [[], ['crown'], ['duchy']]);
  assert.equal(world(store).characters.hana.revision, before.characters.hana.revision, 'unrelated characters are not touched');
  // A title with its own law (a known definition) is resolved under that law.
  addDefinitions(store, approved('succession_law', 'by_vote', { name: 'by vote' }));
  change(store, (d) => setTitleSuccessionLaw(d, { titleId: 'crown', successionLawId: 'by_vote' }));
  change(store, (d) => resolveSuccession(d, { cause: 'abdication', decedentCharacterId: 'bram', titles: [{ titleId: 'crown', candidateRefs: [person('fay')] }] }));
  assert.equal(world(store).titles.crown.holderRef.id, 'fay');
});

test('[politics.succession.titles-refused] a title that is not the decedent\'s, not inheritable or has no heir stops the whole succession', () => {
  const store = worldStore();
  addDefinitions(store, approved('title_type', 'for_life', { defaultStatusId: 'vacant', allowedParentTitleTypeIds: [], inheritable: false }));
  change(store, (d) => createTitle(d, { id: 'post', titleTypeId: 'for_life', statusId: 'active', holderRef: person('ann') }));
  change(store, (d) => dies(d));
  const heirs = { candidateRefs: [person('bram')] };
  refused(store, asDeath({ titles: [{ titleId: 'post', ...heirs }] }), 'politics_asset_not_inheritable');
  refused(store, asDeath({ titles: [{ titleId: 'county', ...heirs }] }), 'politics_decedent_not_holder');
  refused(store, asDeath({ titles: [{ titleId: 'ghost', ...heirs }] }), 'politics_missing_ref_target');
  refused(store, asDeath({ titles: [{ titleId: 'crown', candidateRefs: [person('dax')] }] }), 'politics_no_eligible_legal_heir');
  refused(store, asDeath({ titles: [{ titleId: 'crown', ...heirs }, { titleId: 'crown', ...heirs }] }), 'politics_invalid_plan');
  refused(store, asDeath({ titles: [{ titleId: 'crown', candidateRefs: 'bram' }] }), 'politics_invalid_plan');
  // The first steps are undone when a later one fails.
  refused(store, asDeath({ clan: { clanId: 'clan_a' }, titles: [{ titleId: 'crown', ...heirs }, { titleId: 'duchy', candidateRefs: [person('dax')] }] }), 'politics_no_eligible_legal_heir');
  refused(store, asDeath({ clan: { clanId: 'clan_a' }, titles: [{ titleId: 'crown', ...heirs }], faction: { factionId: 'realm_a', candidateRefs: [person('eli')] } }), 'politics_no_eligible_legal_heir');
});

test('[politics.succession.titles-not-transferable] a title that cannot be given away still passes to an heir', () => {
  const store = worldStore();
  addDefinitions(store, approved('title_type', 'bound_seat', { defaultStatusId: 'vacant', allowedParentTitleTypeIds: [], transferable: false, inheritable: true }));
  change(store, (d) => createTitle(d, { id: 'seat_1', titleTypeId: 'bound_seat', statusId: 'active', holderRef: person('ann') }));
  change(store, (d) => dies(d));
  change(store, asDeath({ titles: [{ titleId: 'seat_1', candidateRefs: [person('bram')] }] }));
  assert.equal(world(store).titles.seat_1.holderRef.id, 'bram');
  assert.deepEqual(world(store).characters.bram.titleIds, ['seat_1']);
});

test('[politics.succession.land-rights] rights pass whole, are split, end or are replaced as planned; kinds that cannot be inherited are refused', () => {
  const store = deadStore();
  const result = change(store, asDeath({
    landRights: [
      { rightId: 'claim_east', action: 'transfer_whole', beneficiaryRef: person('bram') },
      { rightId: 'own_south_ann', action: 'split_share', splits: [{ id: 'own_s_bram', holderRef: person('bram'), shareUnits: 400000 }, { id: 'own_s_cora', holderRef: ref('clan', 'clan_b'), shareUnits: 200000 }] },
    ],
  }));
  assert.deepEqual(result.landRights, [{ rightId: 'claim_east', action: 'transfer_whole', holderRef: person('bram') }, { rightId: 'own_south_ann', action: 'split_share' }]);
  assert.deepEqual(result.resultTagIds, ['rights_transferred']);
  const rights = world(store).landRights;
  assert.deepEqual(rights.claim_east.holderRef, person('bram'));
  assert.equal(rights.own_south_ann.status, 'terminated', 'handing out the whole share ends the original');
  assert.deepEqual([rights.own_s_bram.share, rights.own_s_cora.share], [0.4, 0.2]);
  assert.deepEqual([world(store).characters.ann.claimIds, world(store).characters.bram.claimIds], [[], ['claim_east']]);
  assert.deepEqual(checkPolitics(store.getState()), { ok: true });

  const other = deadStore();
  const chosen = change(other, asDeath({ landRights: [
    { rightId: 'claim_east', action: 'transfer_whole', candidateRefs: [person('dax')], legalHeirRefs: [person('cora')] },
    { rightId: 'own_south_ann', action: 'terminate' },
  ] }));
  assert.deepEqual(chosen.landRights[0].holderRef, person('cora'));
  assert.equal(world(other).landRights.own_south_ann.endDay, 100);

  const replaced = worldStore();
  change(replaced, (d) => transferLandRight(d, { rightId: 'admin_north', holderRef: person('ann') }));
  change(replaced, (d) => dies(d));
  change(replaced, asDeath({ landRights: [{ rightId: 'admin_north', action: 'supersede', nextRight: { id: 'admin_next', holderRef: person('cora') } }] }));
  assert.deepEqual([world(replaced).landRights.admin_north.status, world(replaced).landRights.admin_next.holderRef.id], ['superseded', 'cora']);
});

test('[politics.succession.land-rights-refused] a right that is not the decedent\'s, ended, not inheritable or badly planned stops the whole succession', () => {
  const store = worldStore();
  change(store, (d) => transferLandRight(d, { rightId: 'occupation_west', holderRef: person('ann') }));
  change(store, (d) => dies(d));
  const only = (plan) => asDeath({ landRights: [plan] });
  refused(store, only({ rightId: 'occupation_west', action: 'transfer_whole', beneficiaryRef: person('bram') }), 'politics_asset_not_inheritable');
  refused(store, only({ rightId: 'occupation_west', action: 'split_share', splits: [] }), 'politics_asset_minimum_unit_violation');
  refused(store, only({ rightId: 'holding_south', action: 'terminate' }), 'politics_decedent_not_holder');
  refused(store, only({ rightId: 'ghost', action: 'terminate' }), 'politics_missing_ref_target');
  refused(store, only({ rightId: 'claim_east', action: 'sell' }), 'politics_invalid_allocation_action');
  refused(store, only({ rightId: 'claim_east', action: 'transfer_whole', beneficiaryRef: person('dax') }), 'politics_holder_not_alive');
  refused(store, only({ rightId: 'claim_east', action: 'transfer_whole', beneficiaryRef: 'bram' }), 'politics_invalid_plan');
  refused(store, only({ rightId: 'claim_east', action: 'transfer_whole' }), 'politics_no_eligible_legal_heir');
  refused(store, only({ rightId: 'claim_east', action: 'supersede', nextRight: { id: 'Bad Id', holderRef: person('bram') } }), 'politics_invalid_next_right');
  refused(store, asDeath({ landRights: [{ rightId: 'claim_east', action: 'terminate' }, { rightId: 'claim_east', action: 'terminate' }] }), 'politics_invalid_plan');
  change(store, (d) => terminateLandRight(d, { rightId: 'claim_east' }));
  refused(store, only({ rightId: 'claim_east', action: 'terminate' }), 'politics_invalid_transition');
});

test('[politics.succession.faction-ruler] the ruler of a faction is replaced while its ruling clan stays', () => {
  const store = deadStore();
  const result = change(store, asDeath({ faction: { factionId: 'realm_a', candidateRefs: [person('dax'), person('fay')] } }));
  assert.deepEqual(result.factionRuler, person('fay'), 'a ruler need not belong to the ruling clan');
  assert.equal(world(store).factions.realm_a.rulerCharacterId, 'fay');
  assert.equal(world(store).factions.realm_a.rulingClanId, 'clan_a');
  refused(deadStore(), asDeath({ faction: { factionId: 'realm_a', candidateRefs: [person('dax')] } }), 'politics_no_eligible_legal_heir');
  refused(worldStore(), (d) => resolveSuccession(d, { cause: 'death', decedentCharacterId: 'bram', faction: { factionId: 'realm_a', candidateRefs: [person('cora')] } }), 'politics_decedent_not_holder');
  refused(deadStore(), asDeath({ faction: { factionId: 'ghost', candidateRefs: [person('fay')] } }), 'politics_missing_ref_target');
  refused(deadStore(), asDeath({ faction: 'realm_a' }), 'politics_invalid_plan');
});

test('[politics.succession.everything-at-once] clan, titles, rights and ruler are resolved together and the world stays consistent', () => {
  const store = deadStore();
  const result = change(store, asDeath({
    clan: { clanId: 'clan_a' },
    titles: [{ titleId: 'crown', candidateRefs: [person('bram')] }, { titleId: 'duchy', candidateRefs: [person('bram')] }],
    landRights: [{ rightId: 'claim_east', action: 'transfer_whole', beneficiaryRef: person('bram') }],
    faction: { factionId: 'realm_a', candidateRefs: [person('bram')] },
    resultTagIds: ['legal_fallback'],
  }));
  assert.deepEqual(result.resultTagIds, ['clan_head_changed', 'legal_fallback', 'rights_transferred', 'title_inherited']);
  assert.deepEqual(world(store).characters.bram.titleIds, ['crown', 'duchy']);
  assert.deepEqual(checkPolitics(store.getState()), { ok: true });
  assert.deepEqual(validateState(store.getState()), { ok: true });
});

test('[politics.succession.deterministic] the same state and plan always give the same result and no random number is drawn', () => {
  const run = () => {
    const store = deadStore();
    const rngBefore = clone(store.getState().rng);
    const realRandom = Math.random;
    Math.random = () => { throw new Error('succession must not use Math.random'); };
    try {
      const result = change(store, asDeath({
        clan: { clanId: 'clan_a', legalHeirRefs: [person('cora')] },
        titles: [{ titleId: 'crown', candidateRefs: [person('cora'), person('bram')] }],
        landRights: [{ rightId: 'claim_east', action: 'transfer_whole', legalHeirRefs: [person('bram'), person('cora')] }],
      }));
      assert.deepEqual(store.getState().rng, rngBefore, 'the random generator did not move');
      return { result, state: store.getState() };
    } finally {
      Math.random = realRandom;
    }
  };
  const first = run();
  const second = run();
  assert.deepEqual(first.result, second.result);
  assert.deepEqual(first.state, second.state);
  // A different seed does not change who inherits.
  const reseeded = deadStore();
  change(reseeded, (d) => { d.rng = seedFrom(99999); });
  assert.deepEqual(change(reseeded, asDeath({ clan: { clanId: 'clan_a' } })).clanHead, first.result.clanHead);
});

test('[politics.succession.pacts] an active pact that does not apply yet does not block, a malformed active pact does', () => {
  const store = deadStore();
  const pact = (extra) => ({ id: 'pact_1', version: 1, status: 'active', ...extra });
  change(store, (d) => setInheritancePacts(d, { clanId: 'clan_a', pacts: [pact({ effectiveConditions: { minDay: 500 } })] }));
  assert.deepEqual(change(store, asDeath({ clan: { clanId: 'clan_a' } })).clanHead, person('bram'));
  // Such a pact cannot be stored through setInheritancePacts or pass the area check; succession still
  // refuses it if one is found, leaving the draft as it was.
  const draft = clone(deadStore().getState());
  draft.world.clans.clan_a.inheritancePacts = [pact({ consents: [{ accepted: false, decisionId: 'd1' }] })];
  const copy = clone(draft);
  const outcome = asDeath({ clan: { clanId: 'clan_a' } })(draft);
  assert.equal(outcome.error, 'politics_missing_required_consent');
  assert.deepEqual(draft, copy);
});

test('[politics.succession.input-refused] a succession with an unusable plan is refused and changes nothing', () => {
  const store = worldStore();
  const resolve = (input) => (d) => resolveSuccession(d, input);
  const plan = { cause: 'death', decedentCharacterId: 'ann', clan: { clanId: 'clan_a' } };
  refused(store, resolve(null), 'politics_invalid_input');
  refused(store, resolve({ ...plan, cause: 'exile' }), 'politics_invalid_cause');
  refused(store, resolve({ ...plan, cause: undefined }), 'politics_invalid_cause');
  refused(store, resolve({ ...plan, decedentCharacterId: 'ghost' }), 'politics_missing_ref_target');
  refused(store, resolve({ cause: 'death', decedentCharacterId: 'ann' }), 'politics_nothing_to_resolve');
  refused(store, resolve({ cause: 'death', decedentCharacterId: 'ann', titles: [], landRights: [] }), 'politics_nothing_to_resolve');
  refused(store, resolve({ ...plan, clan: { clanId: 'ghost' } }), 'politics_missing_ref_target');
  refused(store, resolve({ ...plan, clan: 'clan_a' }), 'politics_invalid_plan');
  refused(store, resolve({ ...plan, clan: { clanId: 'clan_a', legalHeirRefs: [{ type: 'character' }] } }), 'politics_invalid_plan');
  refused(store, resolve({ ...plan, titles: 'crown' }), 'politics_invalid_plan');
  refused(store, resolve({ ...plan, landRights: [null] }), 'politics_invalid_plan');
  refused(store, resolve({ ...plan, successionLawId: 'no.law' }), 'politics_unsupported_policy');
  refused(store, resolve({ ...plan, resultTagIds: ['not_a_tag'] }), 'politics_invalid_policy_output');
  refused(store, resolve({ ...plan, resultTagIds: 'pact_applied' }), 'politics_invalid_policy_output');
  refused(store, resolve({ ...plan, decedentCharacterId: 'bram' }), 'politics_decedent_not_holder');
});

test('[politics.succession.estate-plan] the estate split follows the clan\'s effective pacts and expected shares and loses nothing', () => {
  const store = worldStore();
  const pact = {
    id: 'pact_1', version: 1, status: 'active',
    allocations: [{ assetRef: ref('title', 'duchy'), assetClass: 'title', beneficiaryRef: person('cora'), action: 'assign_holder' }],
    expectedShares: [{ assetClass: 'land_right', beneficiaryRef: person('bram'), shareBps: 7000 }, { assetClass: 'land_right', beneficiaryRef: person('cora'), shareBps: 2000 }],
  };
  change(store, (d) => setInheritancePacts(d, { clanId: 'clan_a', pacts: [pact] }));
  const assets = [
    { assetClass: 'title', assetRef: ref('title', 'duchy') },
    { assetClass: 'title', assetRef: ref('title', 'crown') },
    { assetClass: 'land_right', assetRef: ref('land_right', 'own_south_ann'), divisible: true, shareUnits: 600000 },
  ];
  const plan = planEstateAllocations(store.getState(), { cause: 'death', clanId: 'clan_a', assets, firstLegalHeirRef: person('eli') });
  assert.equal(plan.ok, true);
  assert.equal(plan.fallbackUsed, false);
  const byAsset = Object.fromEntries(plan.allocations.map((a) => [`${a.assetRef.id}:${a.beneficiaryRef.id}`, a]));
  assert.equal(byAsset['duchy:cora'].action, 'assign_holder');
  assert.equal(byAsset['crown:eli'].action, 'assign_holder', 'a title no pact names goes to the first legal heir');
  const units = plan.allocations.filter((a) => a.assetRef.id === 'own_south_ann').map((a) => [a.beneficiaryRef.id, a.shareUnits]);
  assert.deepEqual(units, [['bram', 420000], ['cora', 120000], ['eli', 60000]]);
  assert.equal(units.reduce((sum, [, n]) => sum + n, 0), 600000);
  // A pact that does not apply on this day is left out, so the shares fall back.
  change(store, (d) => setInheritancePacts(d, { clanId: 'clan_a', pacts: [{ ...pact, effectiveConditions: { minDay: 500 } }] }));
  const later = planEstateAllocations(store.getState(), { cause: 'death', clanId: 'clan_a', assets: [assets[1]], firstLegalHeirRef: person('eli') });
  assert.deepEqual([later.fallbackUsed, later.allocations[0].beneficiaryRef.id], [true, 'eli']);
  assert.equal(planEstateAllocations(store.getState(), { cause: 'death', clanId: 'clan_a', assets: [assets[1]] }).error, 'politics_no_eligible_legal_heir');
  assert.equal(planEstateAllocations(store.getState(), { cause: 'moved', clanId: 'clan_a', assets }).error, 'politics_invalid_cause');
  assert.equal(planEstateAllocations(store.getState(), { cause: 'death', clanId: 'ghost', assets }).error, 'politics_missing_ref_target');
  assert.equal(planEstateAllocations(store.getState(), { cause: 'death', clanId: 'clan_a', assets: [{ assetClass: 'title' }] }).error, 'politics_invalid_plan');
  assert.equal(planEstateAllocations(store.getState(), { cause: 'death', clanId: 'clan_a', assets, firstLegalHeirRef: 'bram' }).error, 'politics_invalid_plan');
});

// ---------------------------------------------------------------------------------------------
// All rules

const RULES = {
  createClan, setClanMetrics, setClanLaws, setDesignatedSuccessors, setBranchClans, setInheritancePacts, createFaction, setSovereignPower,
  adjustSovereignPower, setFactionLaws, joinClan, leaveClan, linkClanToFaction, unlinkClanFromFaction, changeClanHead, changeFactionRuler,
  changeFactionRulingClan, setClanTreasury, setFactionTreasury, createTitle, transitionTitle, changeTitleHolder, changeTitleParent,
  changeTitleStatus, setTitleSuccessionLaw, createLandRight, transferLandRight, setLandRightRecognition, setLandRightDisputed,
  terminateLandRight, supersedeLandRight, splitLandRight, resolveSuccession,
};
const FIELDS = [
  'id', 'clanId', 'factionId', 'titleId', 'rightId', 'characterId', 'accountId', 'holderRef', 'subjectRef', 'basisRef', 'nextRight', 'splits',
  'pacts', 'power', 'deltas', 'headPower', 'standing', 'characterIds', 'branchClanIds', 'lawIds', 'statusId', 'parentTitleId', 'share',
  'rightTypeId', 'titleTypeId', 'recognizedByFactionIds', 'disputed', 'endDay', 'startDay', 'cause', 'decedentCharacterId', 'clan', 'titles',
  'landRights', 'faction', 'successionLawId', 'inheritanceCustomId', 'expectedClanId', 'allowTransfer', 'customData', 'name',
];
const JUNK = [undefined, null, 0, -1, 1.5, Number.NaN, '', 'x', 'ghost', true, [], [[]], {}, { id: [] }, { type: 'character' }, [null], 'constructor', '__proto__'];

test('[politics.rules.junk-input] every rule refuses empty or nonsensical input without throwing or changing anything', () => {
  const store = worldStore();
  const before = clone(store.getState());
  for (const [name, rule] of Object.entries(RULES)) {
    const inputs = [...JUNK.map((junk) => junk), ...JUNK.map((junk) => Object.fromEntries(FIELDS.map((field) => [field, junk])))];
    for (const input of inputs) {
      const draft = clone(before);
      let outcome;
      assert.doesNotThrow(() => { outcome = rule(draft, input); }, `${name}(${JSON.stringify(input)})`);
      assert.equal(outcome.ok, false, `${name}(${JSON.stringify(input)}) should be refused`);
      assert.match(outcome.error, /^politics_[a-z_]+$/, name);
      assert.deepEqual(draft, before, `${name}(${JSON.stringify(input)}) changed the draft`);
    }
  }
  assert.deepEqual(store.getState(), before);
});

test('[politics.rules.every-change-raises-revision] a record changed by a rule gets one more revision, and records not named do not', () => {
  const store = worldStore();
  const before = clone(world(store));
  change(store, (d) => setClanMetrics(d, { clanId: 'clan_b', standing: { prestige: 4 } }));
  change(store, (d) => changeTitleHolder(d, { titleId: 'duchy', holderRef: person('bram') }));
  change(store, (d) => setLandRightDisputed(d, { rightId: 'rule_north', disputed: true }));
  change(store, (d) => adjustSovereignPower(d, { factionId: 'realm_a', deltas: { legalAuthority: 1 } }));
  const after = world(store);
  const revisions = (w) => Object.fromEntries(['clans', 'factions', 'titles', 'landRights'].flatMap((kind) => Object.entries(w[kind]).map(([id, record]) => [`${kind}.${id}`, record.revision])));
  const changed = Object.entries(revisions(after)).filter(([key, revision]) => revision !== revisions(before)[key]);
  assert.deepEqual(changed.map(([key, revision]) => [key, revision - revisions(before)[key]]), [
    ['clans.clan_b', 1], ['factions.realm_a', 1], ['titles.duchy', 1], ['landRights.rule_north', 1],
  ]);
  assert.equal(after.characters.bram.revision, before.characters.bram.revision + 1, 'the new holder\'s title index changed');
  assert.equal(after.characters.ann.revision, before.characters.ann.revision + 1, 'and the old holder\'s');
});
