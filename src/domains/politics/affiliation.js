// Who belongs to whom: a character's clan, a clan's faction, a clan's head, a faction's ruler and
// ruling clan, and the treasury accounts of clans and factions.
//
// These are the only rules that change those fields, so the records always agree:
//   - a character in a clan carries that clan's faction;
//   - a clan's head is a living member of the clan;
//   - a faction's ruling clan belongs to the faction;
//   - a treasury account is owned by the clan or faction that names it.
// A rule checks everything first and writes after, so a refusal leaves every record as it was.
// (The earlier version asked callers for the expected revision of each record; one transaction
// makes that unnecessary here.)
import { ok } from '../../core/result.js';
import { listClanMemberIds } from './clans.js';
import {
  bump, getAccount, getCharacter, getClan, getFaction, isAlive, needRecord, politicsFail, setCharacterAffiliation,
} from './shared.js';

function loadCharacter(draft, characterId, { alive = false } = {}) {
  const character = getCharacter(draft, characterId);
  if (!character) return politicsFail('missing_character', { characterId });
  if (alive && !isAlive(character)) return politicsFail('character_not_alive', { characterId });
  return ok({ character });
}

// input: { characterId, clanId, allowTransfer? }. The character takes the clan's faction too.
export function joinClan(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  const found = loadCharacter(draft, input.characterId, { alive: true });
  if (!found.ok) return found;
  const clan = getClan(draft, input.clanId);
  if (!clan) return politicsFail('missing_clan', { clanId: input.clanId });
  const { character } = found;
  const currentClanId = character.affiliations.clanId;
  if (currentClanId === clan.id) return politicsFail('no_change');
  if (currentClanId && input.allowTransfer !== true) return politicsFail('character_already_in_clan', { clanId: currentClanId });
  if (currentClanId && getClan(draft, currentClanId) && getClan(draft, currentClanId).headCharacterId === character.id) return politicsFail('character_is_clan_head', { clanId: currentClanId });
  setCharacterAffiliation(character, clan.id, clan.factionId);
  return ok({ characterId: character.id, clanId: clan.id });
}

// input: { characterId, expectedClanId? }. The head of a clan cannot leave it; hand the headship on first.
export function leaveClan(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  const found = loadCharacter(draft, input.characterId);
  if (!found.ok) return found;
  const { character } = found;
  const clanId = character.affiliations.clanId;
  if (clanId === null) return politicsFail('no_change');
  if (input.expectedClanId !== undefined && input.expectedClanId !== clanId) return politicsFail('clan_mismatch', { clanId });
  const clan = getClan(draft, clanId);
  if (clan && clan.headCharacterId === character.id) return politicsFail('character_is_clan_head', { clanId });
  setCharacterAffiliation(character, null, null);
  return ok({ characterId: character.id });
}

function setClanFaction(draft, input, factionId) {
  const bad = needRecord(input);
  if (bad) return bad;
  const clan = getClan(draft, input.clanId);
  if (!clan) return politicsFail('missing_clan', { clanId: input.clanId });
  if (factionId !== null && !getFaction(draft, factionId)) return politicsFail('missing_faction', { factionId });
  if (clan.factionId === factionId) return politicsFail('no_change');
  const old = clan.factionId && getFaction(draft, clan.factionId);
  if (old && old.rulingClanId === clan.id) return politicsFail('clan_rules_faction', { clanId: clan.id, factionId: old.id });
  clan.factionId = factionId;
  bump(clan);
  for (const memberId of listClanMemberIds(draft, clan.id)) setCharacterAffiliation(draft.world.characters[memberId], clan.id, factionId);
  return ok({ clanId: clan.id, factionId });
}

// input: { clanId, factionId }. The members of the clan join the faction with it.
export function linkClanToFaction(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  if (typeof input.factionId !== 'string') return politicsFail('invalid_input', { field: 'factionId' });
  return setClanFaction(draft, input, input.factionId);
}

// input: { clanId }. A clan that rules its faction cannot leave it.
export function unlinkClanFromFaction(draft, input) {
  return setClanFaction(draft, input, null);
}

// input: { clanId, characterId: id | null }. The new head must be a living member of the clan.
export function changeClanHead(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  const clan = getClan(draft, input.clanId);
  if (!clan) return politicsFail('missing_clan', { clanId: input.clanId });
  if (input.characterId !== null) {
    const found = loadCharacter(draft, input.characterId, { alive: true });
    if (!found.ok) return found;
    if (found.character.affiliations.clanId !== clan.id) return politicsFail('ineligible_candidate', { characterId: input.characterId, reason: 'not_a_member' });
  }
  if (clan.headCharacterId === input.characterId) return politicsFail('no_change');
  clan.headCharacterId = input.characterId;
  bump(clan);
  return ok({ clanId: clan.id, headCharacterId: input.characterId });
}

// input: { factionId, characterId: id | null }
export function changeFactionRuler(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  const faction = getFaction(draft, input.factionId);
  if (!faction) return politicsFail('missing_faction', { factionId: input.factionId });
  if (input.characterId !== null) {
    const found = loadCharacter(draft, input.characterId, { alive: true });
    if (!found.ok) return found;
  }
  if (faction.rulerCharacterId === input.characterId) return politicsFail('no_change');
  faction.rulerCharacterId = input.characterId;
  bump(faction);
  return ok({ factionId: faction.id, rulerCharacterId: input.characterId });
}

// input: { factionId, clanId: id | null }. The ruling clan must belong to the faction.
export function changeFactionRulingClan(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  const faction = getFaction(draft, input.factionId);
  if (!faction) return politicsFail('missing_faction', { factionId: input.factionId });
  if (input.clanId !== null) {
    const clan = getClan(draft, input.clanId);
    if (!clan) return politicsFail('missing_clan', { clanId: input.clanId });
    if (clan.factionId !== faction.id) return politicsFail('clan_not_in_faction', { clanId: clan.id, factionId: faction.id });
  }
  if (faction.rulingClanId === input.clanId) return politicsFail('no_change');
  faction.rulingClanId = input.clanId;
  bump(faction);
  return ok({ factionId: faction.id, rulingClanId: input.clanId });
}

function setTreasury(draft, owner, ownerType, accountId) {
  if (accountId !== null) {
    const account = getAccount(draft, accountId);
    if (!account) return politicsFail('missing_account', { accountId });
    if (!account.ownerRef || account.ownerRef.type !== ownerType || account.ownerRef.id !== owner.id) return politicsFail('treasury_owner_mismatch', { accountId });
  }
  if (owner.treasuryAccountId === accountId) return politicsFail('no_change');
  owner.treasuryAccountId = accountId;
  bump(owner);
  return ok({ [`${ownerType}Id`]: owner.id, treasuryAccountId: accountId });
}

// input: { clanId, accountId: id | null }; the account must be owned by the clan (finance sets owners).
export function setClanTreasury(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  const clan = getClan(draft, input.clanId);
  if (!clan) return politicsFail('missing_clan', { clanId: input.clanId });
  return setTreasury(draft, clan, 'clan', input.accountId);
}

export function setFactionTreasury(draft, input) {
  const bad = needRecord(input);
  if (bad) return bad;
  const faction = getFaction(draft, input.factionId);
  if (!faction) return politicsFail('missing_faction', { factionId: input.factionId });
  return setTreasury(draft, faction, 'faction', input.accountId);
}
