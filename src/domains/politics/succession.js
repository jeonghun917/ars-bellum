// Succession: when a character dies, retires or abdicates, who takes over the positions they held.
//
// resolveSuccession picks the new clan head, the new holder of each named title and the new ruler of
// a faction, and moves or ends the named land rights, all in one step. The choice is a fixed
// function of the records and the plan: designated candidates in the order given, then the legal
// heirs the caller names, the first who is eligible. No random numbers are drawn, so the same state
// and plan always give the same result.
//
// Not covered here (owned by other areas): the decedent's personal accounts and inventories,
// player control, and the events the earlier version announced. planEstateAllocations shows how a
// divisible estate would be split by the clan's pacts and expected shares.
import { clone, isRecord } from '../../core/data.js';
import { ok } from '../../core/result.js';
import { changeClanHead, changeFactionRuler } from './affiliation.js';
import { getDefinition, hasDefinition } from './definitions.js';
import { splitLandRight, supersedeLandRight, terminateLandRight, transferLandRight } from './land-rights.js';
import { SUCCESSION_CAUSES, effectivePacts, validatePactStructure } from './pacts.js';
import { runPolicy } from './policies.js';
import {
  copyRef, getCharacter, getClan, getFaction, getLandRight, getTitle, isStoredRef, needRecord, politicsFail, refKey, todayOf,
} from './shared.js';
import { changeTitleHolder } from './titles.js';

const DEFAULT_LAW_ID = 'm1.default_succession';

function uniqueRefs(values = []) {
  const out = [];
  const seen = new Set();
  for (const reference of values) {
    if (isStoredRef(reference) && !seen.has(refKey(reference))) {
      seen.add(refKey(reference));
      out.push(copyRef(reference));
    }
  }
  return out;
}

// A custom inheritance rule overrides the law's policies where it names them.
function policyIds(law, custom) {
  return {
    evaluatorPolicyId: (custom && custom.evaluatorPolicyId) || law.evaluatorPolicyId,
    eligibilityPolicyId: (custom && custom.eligibilityPolicyId) || law.eligibilityPolicyId,
    inheritancePolicyId: (custom && custom.inheritancePolicyId) || law.inheritancePolicyId,
    policyParams: { ...(law.policyParams || {}), ...((custom && custom.policyParams) || {}) },
  };
}

function refList(value) {
  if (value === undefined) return [];
  return Array.isArray(value) && value.every(isStoredRef) ? value : null;
}

// Chooses the heir for one position. `context`: { cause, decedentId, released, pactSnapshots, law,
// custom, memberOfClanId }. Returns ok({ candidateRef, trace }) or a failure.
function chooseHeir(state, subjectRef, candidateRefs, legalHeirRefs, context) {
  const ids = policyIds(context.law, context.custom);
  const designated = uniqueRefs(candidateRefs);
  const legal = uniqueRefs(legalHeirRefs);
  const evaluated = runPolicy('evaluator', ids.evaluatorPolicyId, {
    subjectRef, cause: context.cause, currentDay: todayOf(state), candidateRefs: designated, legalHeirRefs: legal,
    pactSnapshots: context.pactSnapshots, lawSnapshot: context.law, policyParams: ids.policyParams,
  });
  if (!evaluated.ok) return evaluated;
  const ordered = uniqueRefs([...(evaluated.rankedCandidateRefs || []), ...legal]);
  for (const candidateRef of ordered) {
    if (candidateRef.type !== 'character') continue;
    const character = getCharacter(state, candidateRef.id);
    if (!character) return politicsFail('missing_ref_target', refKey(candidateRef));
    // Nobody succeeds themselves; a clan head must belong to the clan.
    if (candidateRef.id === context.decedentId) continue;
    if (context.memberOfClanId && character.affiliations.clanId !== context.memberOfClanId) continue;
    const eligibility = runPolicy('eligibility', ids.eligibilityPolicyId, {
      candidateRef, subjectRef, cause: context.cause, currentDay: todayOf(state), character,
      permanentlyReleasedCharacterIds: context.released, policyParams: ids.policyParams,
    });
    if (!eligibility.ok) return eligibility;
    if (eligibility.eligible) return ok({ candidateRef, trace: evaluated.tieBreakTrace || [] });
  }
  return politicsFail('no_eligible_legal_heir', refKey(subjectRef));
}

function lawFor(state, lawId, fallback) {
  return (lawId && getDefinition(state, 'succession_law', lawId)) || fallback;
}

function clanStep(work, plan, context) {
  const clan = getClan(work, plan.clanId);
  if (!clan) return politicsFail('missing_ref_target', `clan:${plan.clanId}`);
  if (clan.headCharacterId !== context.decedentId) return politicsFail('decedent_not_holder', `clan:${clan.id}`);
  const pactIssue = clan.inheritancePacts.map(validatePactStructure).find(Boolean);
  if (pactIssue) return politicsFail(pactIssue);
  const candidates = plan.candidateRefs === undefined ? clan.designatedSuccessorIds.map((id) => ({ type: 'character', id })) : plan.candidateRefs;
  const chosen = chooseHeir(work, { type: 'clan', id: clan.id }, candidates, plan.legalHeirRefs, {
    ...context,
    law: lawFor(work, clan.successionLawId, context.defaultLaw),
    custom: clan.inheritanceCustomId ? getDefinition(work, 'inheritance_custom', clan.inheritanceCustomId) : null,
    pactSnapshots: effectivePacts(clan.inheritancePacts, todayOf(work), context.cause),
    memberOfClanId: clan.id,
  });
  if (!chosen.ok) return chosen;
  const changed = changeClanHead(work, { clanId: clan.id, characterId: chosen.candidateRef.id });
  return changed.ok ? ok({ result: copyRef(chosen.candidateRef) }) : changed;
}

function titleStep(work, plan, context) {
  const title = getTitle(work, plan.titleId);
  if (!title) return politicsFail('missing_ref_target', `title:${plan.titleId}`);
  if (!title.holderRef || title.holderRef.type !== 'character' || title.holderRef.id !== context.decedentId) return politicsFail('decedent_not_holder', `title:${title.id}`);
  const chosen = chooseHeir(work, { type: 'title', id: title.id }, plan.candidateRefs, plan.legalHeirRefs, {
    ...context, law: lawFor(work, title.successionLawId, context.defaultLaw), custom: null, pactSnapshots: [],
  });
  if (!chosen.ok) return chosen;
  const changed = changeTitleHolder(work, { titleId: title.id, holderRef: chosen.candidateRef }, { via: 'inheritance' });
  return changed.ok ? ok({ result: { titleId: title.id, holderRef: copyRef(chosen.candidateRef) } }) : changed;
}

const RIGHT_ACTIONS = Object.freeze(['transfer_whole', 'split_share', 'terminate', 'supersede']);

function rightStep(work, plan, context) {
  const right = getLandRight(work, plan.rightId);
  if (!right) return politicsFail('missing_ref_target', `land_right:${plan.rightId}`);
  if (right.holderRef.type !== 'character' || right.holderRef.id !== context.decedentId) return politicsFail('decedent_not_holder', `land_right:${right.id}`);
  if (!RIGHT_ACTIONS.includes(plan.action)) return politicsFail('invalid_allocation_action', plan.action);
  let changed;
  let holderRef = null;
  if (plan.action === 'transfer_whole') {
    holderRef = plan.beneficiaryRef;
    if (holderRef === undefined) {
      const chosen = chooseHeir(work, { type: 'land_right', id: right.id }, plan.candidateRefs, plan.legalHeirRefs, {
        ...context, law: context.defaultLaw, custom: null, pactSnapshots: [],
      });
      if (!chosen.ok) return chosen;
      holderRef = chosen.candidateRef;
    }
    changed = transferLandRight(work, { rightId: right.id, holderRef }, { via: 'inheritance' });
  } else if (plan.action === 'split_share') {
    changed = splitLandRight(work, { rightId: right.id, splits: plan.splits }, { via: 'inheritance' });
  } else if (plan.action === 'terminate') {
    changed = terminateLandRight(work, { rightId: right.id, endDay: Math.max(todayOf(work), right.startDay) });
  } else {
    changed = supersedeLandRight(work, { rightId: right.id, nextRight: plan.nextRight, endDay: Math.max(todayOf(work), right.startDay) });
  }
  if (!changed.ok) return changed;
  return ok({ result: { rightId: right.id, action: plan.action, ...(holderRef ? { holderRef: copyRef(holderRef) } : {}) } });
}

function factionStep(work, plan, context) {
  const faction = getFaction(work, plan.factionId);
  if (!faction) return politicsFail('missing_ref_target', `faction:${plan.factionId}`);
  if (faction.rulerCharacterId !== context.decedentId) return politicsFail('decedent_not_holder', `faction:${faction.id}`);
  const chosen = chooseHeir(work, { type: 'faction', id: faction.id }, plan.candidateRefs, plan.legalHeirRefs, {
    ...context, law: context.defaultLaw, custom: null, pactSnapshots: [],
  });
  if (!chosen.ok) return chosen;
  const changed = changeFactionRuler(work, { factionId: faction.id, characterId: chosen.candidateRef.id });
  return changed.ok ? ok({ result: copyRef(chosen.candidateRef) }) : changed;
}

function planProblem(input) {
  if (input.clan !== undefined && (!isRecord(input.clan) || refList(input.clan.candidateRefs) === null || refList(input.clan.legalHeirRefs) === null)) return 'clan';
  if (input.faction !== undefined && (!isRecord(input.faction) || refList(input.faction.candidateRefs) === null || refList(input.faction.legalHeirRefs) === null)) return 'faction';
  for (const [name, key] of [['titles', 'titleId'], ['landRights', 'rightId']]) {
    if (input[name] === undefined) continue;
    if (!Array.isArray(input[name])) return name;
    const seen = new Set();
    for (const item of input[name]) {
      if (!isRecord(item) || typeof item[key] !== 'string' || seen.has(item[key]) || refList(item.candidateRefs) === null || refList(item.legalHeirRefs) === null) return name;
      if (item.beneficiaryRef !== undefined && !isStoredRef(item.beneficiaryRef)) return name;
      seen.add(item[key]);
    }
  }
  return null;
}

// input: {
//   cause: 'death' | 'retirement' | 'abdication', decedentCharacterId,
//   successionLawId?          // law used where a record names none (default: the built-in law)
//   clan?:     { clanId, candidateRefs?, legalHeirRefs? }       // candidateRefs default to the clan's designated successors
//   titles?:   [{ titleId, candidateRefs?, legalHeirRefs? }]
//   landRights?: [{ rightId, action: 'transfer_whole' | 'split_share' | 'terminate' | 'supersede',
//                   beneficiaryRef? | candidateRefs?/legalHeirRefs?, splits?, nextRight? }]
//   faction?:  { factionId, candidateRefs?, legalHeirRefs? }
//   resultTagIds?
// }
// Every position named must be held by the decedent. Returns ok({ clanHead, titles, landRights,
// factionRuler, resultTagIds }). On any failure no record has changed.
export function resolveSuccession(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  if (!SUCCESSION_CAUSES.includes(input.cause)) return politicsFail('invalid_cause', { cause: input.cause });
  const decedent = getCharacter(draft, input.decedentCharacterId);
  if (!decedent) return politicsFail('missing_ref_target', `character:${input.decedentCharacterId}`);
  const problem = planProblem(input);
  if (problem) return politicsFail('invalid_plan', { part: problem });
  if (!input.clan && !input.faction && !(input.titles || []).length && !(input.landRights || []).length) return politicsFail('nothing_to_resolve');
  const defaultLaw = getDefinition(draft, 'succession_law', input.successionLawId === undefined ? DEFAULT_LAW_ID : input.successionLawId);
  if (!defaultLaw) return politicsFail('unsupported_policy', 'succession_law');
  const tags = input.resultTagIds === undefined ? [] : input.resultTagIds;
  if (!Array.isArray(tags) || tags.some((tag) => !hasDefinition(draft, 'succession_result_tag', tag))) return politicsFail('invalid_policy_output', 'result_tag');

  // Work on a copy of the world and copy it back only when every step succeeded.
  const work = { ...draft, world: clone(draft.world) };
  const context = {
    cause: input.cause,
    decedentId: decedent.id,
    released: (draft.playerControl && draft.playerControl.permanentlyReleasedCharacterIds) || [],
    defaultLaw,
  };
  const resolution = { clanHead: null, titles: [], landRights: [], factionRuler: null };
  const run = (step, plan, assign) => {
    const done = step(work, plan, context);
    if (!done.ok) return done;
    assign(done.result);
    return null;
  };
  let failure = null;
  if (input.clan) failure = run(clanStep, input.clan, (result) => { resolution.clanHead = result; });
  for (const plan of input.titles || []) {
    if (failure) break;
    failure = run(titleStep, plan, (result) => resolution.titles.push(result));
  }
  for (const plan of input.landRights || []) {
    if (failure) break;
    failure = run(rightStep, plan, (result) => resolution.landRights.push(result));
  }
  if (!failure && input.faction) failure = run(factionStep, input.faction, (result) => { resolution.factionRuler = result; });
  if (failure) return failure;

  draft.world = work.world;
  const resultTagIds = new Set(tags);
  if (resolution.clanHead) resultTagIds.add('clan_head_changed');
  if (resolution.titles.length) resultTagIds.add('title_inherited');
  if (resolution.landRights.length) resultTagIds.add('rights_transferred');
  return ok({ ...resolution, resultTagIds: [...resultTagIds].sort() });
}

// Shows how a clan's estate would be shared under its law, custom and active pacts, without
// changing anything: whole assets go to the pact's or expected share's first beneficiary (else the
// first legal heir); divisible lots are split in basis points, the rounding handed out one unit at a
// time and the remainder to the first legal heir. Nothing is lost or made up.
// input: { cause, clanId, assets: [{ assetClass, assetRef, divisible?, amount? | shareUnits? }],
//          expectedShares?, firstLegalHeirRef? }
export function planEstateAllocations(state, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  if (!SUCCESSION_CAUSES.includes(input.cause)) return politicsFail('invalid_cause', { cause: input.cause });
  const clan = getClan(state, input.clanId);
  if (!clan) return politicsFail('missing_ref_target', `clan:${input.clanId}`);
  if (!Array.isArray(input.assets) || !input.assets.every((asset) => isRecord(asset) && isStoredRef(asset.assetRef) && typeof asset.assetClass === 'string')) return politicsFail('invalid_plan', { part: 'assets' });
  if (input.firstLegalHeirRef !== undefined && !isStoredRef(input.firstLegalHeirRef)) return politicsFail('invalid_plan', { part: 'firstLegalHeirRef' });
  const pactIssue = clan.inheritancePacts.map(validatePactStructure).find(Boolean);
  if (pactIssue) return politicsFail(pactIssue);
  const law = lawFor(state, clan.successionLawId, getDefinition(state, 'succession_law', DEFAULT_LAW_ID));
  const custom = clan.inheritanceCustomId ? getDefinition(state, 'inheritance_custom', clan.inheritanceCustomId) : null;
  const ids = policyIds(law, custom);
  const pacts = effectivePacts(clan.inheritancePacts, todayOf(state), input.cause);
  const expectedShares = input.expectedShares === undefined ? pacts.flatMap((pact) => pact.expectedShares || []) : input.expectedShares;
  const planned = runPolicy('inheritance', ids.inheritancePolicyId, {
    assetSnapshots: input.assets, pactSnapshots: pacts, expectedShares, firstLegalHeirRef: input.firstLegalHeirRef, policyParams: ids.policyParams,
  });
  return planned;
}

