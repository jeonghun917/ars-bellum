// Record checks for world.clans, world.factions, world.titles and world.landRights, from the earlier
// version's record validators and its save-time reference checks, plus the rules that tie the
// records together (membership, heads, rulers, treasuries, indexes on characters).
//
// Reads from other areas, read-only: characters (affiliations.clanId/factionId, titleIds, claimIds),
// finance accounts (ownerRef) and state.playerControl.campaignClanId.
import { isRecord } from '../../core/data.js';
import { ok } from '../../core/result.js';
import { clanProblems } from './clans.js';
import { factionProblems } from './factions.js';
import { landRightProblems, landRightSetProblems } from './land-rights.js';
import { titleProblems } from './titles.js';
import { getAccount, has, politicsFail, sameJson } from './shared.js';

const COLLECTIONS = ['clans', 'factions', 'titles', 'landRights'];

function treasuryProblem(state, accountId, ownerType, ownerId) {
  if (accountId === null) return null;
  const account = getAccount(state, accountId);
  if (!account) return 'missing_treasury_account';
  const owner = account.ownerRef;
  return isRecord(owner) && owner.type === ownerType && owner.id === ownerId ? null : 'treasury_owner_mismatch';
}

// Titles and claim rights per character, from the records (for the index comparison below).
function indexesByCharacter(world) {
  const titles = {};
  const claims = {};
  for (const id of Object.keys(world.titles).sort()) {
    const holder = world.titles[id].holderRef;
    if (isRecord(holder) && holder.type === 'character') (titles[holder.id] ??= []).push(id);
  }
  for (const id of Object.keys(world.landRights).sort()) {
    const right = world.landRights[id];
    if (isRecord(right) && right.rightTypeId === 'claim' && right.status === 'active' && isRecord(right.holderRef) && right.holderRef.type === 'character') {
      (claims[right.holderRef.id] ??= []).push(id);
    }
  }
  return { titles, claims };
}

export function checkPolitics(state) {
  const world = state.world;
  for (const name of COLLECTIONS) {
    if (!isRecord(world[name])) return politicsFail('invalid_root', { collection: name });
  }
  const problems = [];
  const report = (path, issues) => issues.forEach((issue) => problems.push(`${path}: ${issue}`));
  for (const id of Object.keys(world.clans).sort()) report(`clans.${id}`, clanProblems(state, id, world.clans[id]));
  for (const id of Object.keys(world.factions).sort()) report(`factions.${id}`, factionProblems(state, id, world.factions[id]));
  for (const id of Object.keys(world.titles).sort()) report(`titles.${id}`, titleProblems(state, id, world.titles[id]));
  for (const id of Object.keys(world.landRights).sort()) report(`landRights.${id}`, landRightProblems(state, id, world.landRights[id]));
  report('landRights', landRightSetProblems(state));
  if (problems.length) return politicsFail('invalid_records', problems);

  const characters = isRecord(world.characters) ? world.characters : {};
  for (const id of Object.keys(world.clans).sort()) {
    const clan = world.clans[id];
    const at = `clans.${id}`;
    if (clan.factionId !== null && !has(world.factions, clan.factionId)) problems.push(`${at}: missing_faction`);
    for (const branchId of clan.branchClanIds) if (!has(world.clans, branchId)) problems.push(`${at}: missing_branch_clan`);
    for (const characterId of clan.designatedSuccessorIds) if (!has(characters, characterId)) problems.push(`${at}: missing_designated_successor`);
    if (clan.headCharacterId !== null) {
      const head = characters[clan.headCharacterId];
      if (!head) problems.push(`${at}: missing_head`);
      else if (!isRecord(head.affiliations) || head.affiliations.clanId !== id) problems.push(`${at}: head_not_member`);
    }
    const treasury = treasuryProblem(state, clan.treasuryAccountId, 'clan', id);
    if (treasury) problems.push(`${at}: ${treasury}`);
  }
  for (const id of Object.keys(world.factions).sort()) {
    const faction = world.factions[id];
    const at = `factions.${id}`;
    if (faction.rulerCharacterId !== null && !has(characters, faction.rulerCharacterId)) problems.push(`${at}: missing_ruler`);
    if (faction.rulingClanId !== null) {
      if (!has(world.clans, faction.rulingClanId)) problems.push(`${at}: missing_ruling_clan`);
      else if (world.clans[faction.rulingClanId].factionId !== id) problems.push(`${at}: ruling_clan_not_member`);
    }
    const treasury = treasuryProblem(state, faction.treasuryAccountId, 'faction', id);
    if (treasury) problems.push(`${at}: ${treasury}`);
  }
  const derived = indexesByCharacter(world);
  for (const id of Object.keys(characters).sort()) {
    const character = characters[id];
    const at = `characters.${id}`;
    const affiliations = character.affiliations;
    if (isRecord(affiliations)) {
      const { clanId, factionId } = affiliations;
      if (clanId && !has(world.clans, clanId)) problems.push(`${at}: missing_clan`);
      if (factionId && !has(world.factions, factionId)) problems.push(`${at}: missing_faction`);
      if (clanId && has(world.clans, clanId) && world.clans[clanId].factionId !== factionId) problems.push(`${at}: clan_faction_mismatch`);
    }
    if (!sameJson(character.titleIds, derived.titles[id] || [])) problems.push(`${at}: title_index_mismatch`);
    if (!sameJson(character.claimIds, derived.claims[id] || [])) problems.push(`${at}: claim_index_mismatch`);
  }
  const campaignClanId = state.playerControl && state.playerControl.campaignClanId;
  if (campaignClanId && !has(world.clans, campaignClanId)) problems.push('playerControl.campaignClanId: missing_clan');
  return problems.length ? politicsFail('invalid_records', problems) : ok();
}
