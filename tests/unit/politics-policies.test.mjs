import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BPS_SCALE, DEFINITION_DOMAINS, DEFINITION_DOMAIN_SPECS, ELIGIBILITY, EVALUATORS, INHERITANCE, POLICY_IDS, allocateIntegerLot, getDefinition,
  hasDefinition, orderBeneficiaries, pactIsEffective, runPolicy, validatePactStructure,
} from '../../src/domains/politics/index.js';

const character = (id) => ({ type: 'character', id });
const A = character('a');
const B = character('b');
const C = character('c');
const D = character('d');

const customRecord = (domainId, definitionId, definitionData, approvalStatus = 'approved') => ({
  domainId, definitionId, schemaVersion: 1, definitionVersion: 1, sourceType: 'player', sourceRef: null, approvalStatus, approvedByRef: null, definitionData, revision: 0,
});
const stateWith = (records) => ({ world: { customDefinitions: { version: 1, revision: 0, records } } });

test('[politics.definitions.built-in] every built-in kind is known and unknown ids are not', () => {
  const state = stateWith({});
  assert.deepEqual([...DEFINITION_DOMAINS].sort(), ['faction_type', 'inheritance_custom', 'land_right_type', 'succession_law', 'succession_result_tag', 'title_status', 'title_type']);
  for (const id of ['realm', 'league', 'tribe', 'city_state']) assert.ok(hasDefinition(state, 'faction_type', id));
  for (const id of ['active', 'vacant', 'extinct']) assert.ok(hasDefinition(state, 'title_status', id));
  for (const id of ['rule', 'administration', 'suzerainty', 'military_occupation', 'legal_ownership', 'holding', 'revenue', 'claim']) assert.ok(hasDefinition(state, 'land_right_type', id));
  assert.ok(hasDefinition(state, 'succession_law', 'm1.default_succession'));
  assert.ok(hasDefinition(state, 'inheritance_custom', 'm1.default_inheritance'));
  assert.equal(getDefinition(state, 'faction_type', 'empire'), null);
  assert.equal(getDefinition(state, 'no_such_domain', 'realm'), null);
  // The earlier version's flags: a claim can pass to heirs but cannot be sold; occupation cannot be inherited.
  const claim = getDefinition(state, 'land_right_type', 'claim');
  assert.deepEqual([claim.transferable, claim.inheritable, claim.overlapMode], [false, true, 'allow']);
  assert.equal(getDefinition(state, 'land_right_type', 'military_occupation').inheritable, false);
  // A copy is returned: changing it does not change the catalogue.
  getDefinition(state, 'land_right_type', 'claim').transferable = true;
  assert.equal(getDefinition(state, 'land_right_type', 'claim').transferable, false);
});

test('[politics.definitions.custom-approved-only] only an approved, well-formed custom definition counts', () => {
  const good = { shareMode: 'fractional', overlapMode: 'fractional_sum' };
  const state = stateWith({
    'land_right_type:tithe': customRecord('land_right_type', 'tithe', good),
    'land_right_type:waiting': customRecord('land_right_type', 'waiting', good, 'pending'),
    'land_right_type:refused': customRecord('land_right_type', 'refused', good, 'rejected'),
    'land_right_type:broken': customRecord('land_right_type', 'broken', { shareMode: 'half' }),
    'land_right_type:claim': customRecord('land_right_type', 'claim', { transferable: true }),
    'title_type:count': customRecord('title_type', 'count', { defaultStatusId: 'no_such_status' }),
    'title_type:baron': customRecord('title_type', 'baron', { defaultStatusId: 'active', allowRoot: false }),
  });
  const tithe = getDefinition(state, 'land_right_type', 'tithe');
  assert.equal(tithe.shareMode, 'fractional');
  assert.equal(tithe.allowedSubjectRefTypes[0], 'settlement', 'fields left out come from the template');
  assert.equal(getDefinition(state, 'land_right_type', 'waiting'), null);
  assert.equal(getDefinition(state, 'land_right_type', 'refused'), null);
  assert.equal(getDefinition(state, 'land_right_type', 'broken'), null, 'a malformed approved definition counts as unknown');
  assert.equal(getDefinition(state, 'land_right_type', 'claim').transferable, false, 'a built-in id cannot be overridden');
  assert.equal(getDefinition(state, 'title_type', 'count'), null);
  assert.equal(getDefinition(state, 'title_type', 'baron').allowRoot, false);
});

test('[politics.definitions.domain-specs] the specs for the definitions area accept the defaults and name the problems', () => {
  const lookup = { has: (domain, id) => hasDefinition(stateWith({}), domain, id), get: () => null };
  for (const domainId of DEFINITION_DOMAINS) {
    const spec = DEFINITION_DOMAIN_SPECS[domainId];
    assert.ok(spec.defaults.length > 0, domainId);
    for (const definition of spec.defaults) assert.deepEqual(spec.validate(definition, lookup), [], `${domainId}:${definition.id}`);
  }
  const rightSpec = DEFINITION_DOMAIN_SPECS.land_right_type;
  assert.deepEqual(rightSpec.validate({ overlapMode: 'sometimes' }, lookup), ['invalid_overlap_mode']);
  assert.deepEqual(DEFINITION_DOMAIN_SPECS.succession_law.validate({ fallbackToFirstLegalHeir: false }, lookup), ['invalid_fallback']);
  assert.deepEqual(DEFINITION_DOMAIN_SPECS.succession_law.validate({ evaluatorPolicyId: 'unknown.policy' }, lookup), ['missing_policy:unknown.policy']);
  assert.deepEqual(DEFINITION_DOMAIN_SPECS.title_type.validate({ defaultStatusId: 'nowhere' }, lookup), ['missing_default_status']);
});

test('[politics.policies.order-candidates] designated candidates keep their order and appear once', () => {
  const result = EVALUATORS['m1.ordered_candidates.v1']({ candidateRefs: [C, A, C, { nonsense: true }, B], legalHeirRefs: [D, A] });
  assert.deepEqual(result.rankedCandidateRefs, [C, A, B]);
  assert.deepEqual(result.tieBreakTrace, ['character:c', 'character:a', 'character:b']);
  assert.deepEqual(result.warnings, []);
  const none = EVALUATORS['m1.ordered_candidates.v1']({ candidateRefs: [], legalHeirRefs: [D] });
  assert.deepEqual(none.rankedCandidateRefs, []);
  assert.deepEqual(none.warnings, ['designated_candidates_empty']);
  const pacts = EVALUATORS['m1.ordered_candidates.v1']({ pactSnapshots: [{ id: 'p2', priority: 1 }, { id: 'p1', priority: 1 }, { id: 'p3', priority: 5 }] });
  assert.deepEqual(pacts.rankedPactIds, ['p3', 'p1', 'p2']);
});

test('[politics.policies.eligibility] the dead, the incapacitated and the released are not eligible', () => {
  const check = (extra, released = []) => ELIGIBILITY['m1.alive_eligible.v1']({
    candidateRef: A,
    character: { identity: { alive: true }, condition: { incapacitated: false }, ...extra },
    permanentlyReleasedCharacterIds: released,
  });
  assert.deepEqual(check({}), { ok: true, eligible: true, reasonCodes: [] });
  assert.deepEqual(check({ identity: { alive: false } }).reasonCodes, ['not_alive']);
  assert.deepEqual(check({ condition: { incapacitated: true } }).reasonCodes, ['incapacitated']);
  assert.deepEqual(check({}, ['a']).reasonCodes, ['permanently_released']);
  assert.deepEqual(ELIGIBILITY['m1.alive_eligible.v1']({ candidateRef: A, character: null }).reasonCodes, ['missing_character']);
});

test('[politics.policies.allocation-conserves] a lot is split without losing or making up a unit', () => {
  const shares = [{ beneficiaryRef: A, shareBps: 3333 }, { beneficiaryRef: B, shareBps: 3333 }, { beneficiaryRef: C, shareBps: 3334 }];
  const rounded = allocateIntegerLot(100, [], shares, D);
  assert.equal(rounded.ok, true);
  // Rounding goes to the larger share first, then by reference order.
  assert.deepEqual(rounded.allocations.map((a) => [a.beneficiaryRef.id, a.amount]), [['c', 34], ['a', 33], ['b', 33]]);
  assert.equal(rounded.policyResidual, 0);
  const partial = allocateIntegerLot(101, [], [{ beneficiaryRef: A, shareBps: 5000 }, { beneficiaryRef: B, shareBps: 2000 }], D);
  assert.deepEqual(partial.allocations.map((a) => [a.beneficiaryRef.id, a.amount]), [['a', 50], ['b', 20]]);
  assert.equal(partial.policyResidual, 31);
  assert.deepEqual(partial.residualBeneficiaryRef, D);
  for (const [amount, explicit] of [[0, 0], [1, 0], [7, 3], [999983, 11], [10000, 10000]]) {
    const result = allocateIntegerLot(amount, [{ amount: explicit }], [{ beneficiaryRef: A, shareBps: 1234 }, { beneficiaryRef: B, shareBps: 4321 }, { beneficiaryRef: C, shareBps: 1 }], D);
    assert.equal(result.ok, true);
    const total = result.explicitAllocations + result.allocations.reduce((sum, a) => sum + a.amount, 0) + result.policyResidual;
    assert.equal(total, amount, `lot ${amount}`);
  }
  assert.equal(BPS_SCALE, 10000);
});

test('[politics.policies.allocation-refused] impossible lots are refused with a reason', () => {
  const share = (bps) => [{ beneficiaryRef: A, shareBps: bps }];
  assert.equal(allocateIntegerLot(-1, [], share(100), D).error, 'politics_allocation_numeric_overflow');
  assert.equal(allocateIntegerLot(1.5, [], share(100), D).error, 'politics_allocation_numeric_overflow');
  assert.equal(allocateIntegerLot(10, [{ amount: 11 }], share(100), D).error, 'politics_allocation_conservation_failed');
  assert.equal(allocateIntegerLot(10, [], [{ beneficiaryRef: A, shareBps: 6000 }, { beneficiaryRef: B, shareBps: 4001 }], D).error, 'politics_invalid_expected_share');
  assert.equal(allocateIntegerLot(10, [], share(5000), null).error, 'politics_no_eligible_legal_heir');
  assert.equal(allocateIntegerLot(10, [], share(10000), null).ok, true, 'no heir needed when the shares cover everything');
  assert.deepEqual(orderBeneficiaries([{ beneficiaryRef: B, shareBps: 1 }, { beneficiaryRef: A, shareBps: 1 }, { beneficiaryRef: C, shareBps: 9, priority: 0 }, { beneficiaryRef: D, shareBps: 0, priority: 2 }])
    .map((e) => e.beneficiaryRef.id), ['d', 'c', 'a', 'b']);
});

test('[politics.policies.pact-then-legal] pacts decide the assets they name; the rest follows the expected shares and the first legal heir', () => {
  const policy = INHERITANCE['m1.pact_then_legal_first.v1'];
  const title = { assetClass: 'title', assetRef: { type: 'title', id: 't1' } };
  const fief = { assetClass: 'land_right', assetRef: { type: 'land_right', id: 'r1' } };
  const share = { assetClass: 'land_right', assetRef: { type: 'land_right', id: 'r2' }, divisible: true, shareUnits: 1000 };
  const pact = { id: 'p1', status: 'active', allocations: [{ assetRef: title.assetRef, assetClass: 'title', beneficiaryRef: B, action: 'assign_holder' }] };
  const result = policy({
    assetSnapshots: [share, fief, title],
    pactSnapshots: [pact, { id: 'p0', status: 'draft', allocations: [{ assetRef: fief.assetRef, beneficiaryRef: C }] }],
    expectedShares: [{ assetClass: 'land_right', beneficiaryRef: C, shareBps: 6000 }],
    firstLegalHeirRef: A,
  });
  assert.equal(result.ok, true);
  assert.equal(result.fallbackUsed, false);
  assert.deepEqual(result.resultTagIds, ['pact_applied']);
  const byAsset = Object.fromEntries(result.allocations.map((a) => [`${a.assetRef.id}:${a.beneficiaryRef.id}`, a]));
  assert.equal(byAsset['t1:b'].action, 'assign_holder', 'the active pact names the title');
  assert.equal(byAsset['r1:c'].action, 'transfer_whole', 'a whole right goes to the largest expected share');
  assert.deepEqual([byAsset['r2:c'].action, byAsset['r2:c'].shareUnits], ['split_share', 600]);
  assert.equal(byAsset['r2:a'].shareUnits, 400, 'what no share covers goes to the first legal heir');
  const fallback = policy({ assetSnapshots: [title], firstLegalHeirRef: A });
  assert.deepEqual([fallback.fallbackUsed, fallback.resultTagIds], [true, ['legal_fallback']]);
  assert.equal(fallback.allocations[0].beneficiaryRef.id, 'a');
  assert.equal(policy({ assetSnapshots: [title] }).error, 'politics_no_eligible_legal_heir');
  const clash = policy({ assetSnapshots: [title], pactSnapshots: [pact, { ...pact, id: 'p2' }] });
  assert.equal(clash.error, 'politics_allocation_conflict');
});

test('[politics.policies.run-isolated] a policy runs on a copy of its input and a faulty one fails the caller', () => {
  const input = { candidateRefs: [A, B], legalHeirRefs: [] };
  const before = JSON.stringify(input);
  const ranked = runPolicy('evaluator', 'm1.ordered_candidates.v1', input);
  assert.equal(ranked.ok, true);
  ranked.rankedCandidateRefs.push(C);
  assert.equal(JSON.stringify(input), before);
  assert.equal(runPolicy('evaluator', 'no.such.policy', input).error, 'politics_unsupported_policy');
  assert.equal(runPolicy('nothing', 'm1.ordered_candidates.v1', input).error, 'politics_unsupported_policy');
  assert.deepEqual(POLICY_IDS.eligibility, ['m1.alive_eligible.v1']);
  // A policy that throws (here: no candidate to look at) is a failure, not a crash.
  const broken = runPolicy('eligibility', 'm1.alive_eligible.v1', { character: null });
  assert.equal(broken.ok, false);
  assert.equal(broken.error, 'politics_invalid_policy_output');
  // Faulty policies, through a table of our own: they cannot damage the caller's input or state.
  const tables = {
    evaluator: {
      throws: () => { throw new Error('boom'); },
      nothing: () => null,
      notOk: () => ({ answer: 1 }),
      refuses: () => ({ ok: false, error: 'politics_custom_reason' }),
      mutates: (given) => { given.candidateRefs.push(C); return { ok: true, seen: given.candidateRefs.length }; },
    },
  };
  assert.equal(runPolicy('evaluator', 'throws', input, tables).error, 'politics_invalid_policy_output');
  assert.equal(runPolicy('evaluator', 'nothing', input, tables).error, 'politics_invalid_policy_output');
  assert.equal(runPolicy('evaluator', 'notOk', input, tables).error, 'politics_invalid_policy_output');
  assert.equal(runPolicy('evaluator', 'refuses', input, tables).error, 'politics_custom_reason');
  assert.equal(runPolicy('evaluator', 'mutates', input, tables).seen, 3);
  assert.equal(JSON.stringify(input), before, 'the policy worked on a copy');
  assert.equal(runPolicy('evaluator', 'constructor', input, tables).error, 'politics_unsupported_policy');
});

test('[politics.pacts.structure] a pact must be well formed and an active one fully consented and approved', () => {
  const active = (extra = {}) => ({ id: 'p1', version: 1, status: 'active', ...extra });
  assert.equal(validatePactStructure(active()), null);
  assert.equal(validatePactStructure({ id: 'p1', version: 1, status: 'draft', consents: [{ accepted: false }] }), null, 'a draft may be incomplete');
  assert.equal(validatePactStructure(active({ version: 2 })), 'invalid_inheritance_pact');
  assert.equal(validatePactStructure(active({ id: 'bad id' })), 'invalid_inheritance_pact');
  assert.equal(validatePactStructure(active({ consents: [{ accepted: true, decisionId: 'd1' }, { accepted: false, decisionId: 'd2' }] })), 'missing_required_consent');
  assert.equal(validatePactStructure(active({ approvals: [{ approved: true }] })), 'missing_required_approval');
  const shares = (...bps) => bps.map((shareBps) => ({ assetClass: 'title', beneficiaryRef: A, shareBps }));
  assert.equal(validatePactStructure(active({ expectedShares: shares(6000, 4000) })), null);
  assert.equal(validatePactStructure(active({ expectedShares: shares(6000, 4001) })), 'invalid_expected_share');
  assert.equal(validatePactStructure(active({ expectedShares: shares(1.5) })), 'invalid_expected_share');
  assert.equal(validatePactStructure(active({ allocations: [{ assetRef: A, beneficiaryRef: B }] })), 'invalid_allocation');
  const timed = active({ effectiveConditions: { minDay: 10, maxDay: 20, requiredCauseIds: ['death'] } });
  assert.deepEqual([9, 10, 20, 21].map((day) => pactIsEffective(timed, day, 'death')), [false, true, true, false]);
  assert.equal(pactIsEffective(timed, 15, 'abdication'), false);
  assert.equal(pactIsEffective({ ...timed, status: 'revoked' }, 15, 'death'), false);
});
