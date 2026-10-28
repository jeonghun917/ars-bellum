// Save/load checks for world.mobileGroups, from the earlier version's group validator and the save
// validator's record and reference checks. Depends on which group types and command structures are
// defined, and on characters, inventories, accounts and referenced records existing.
import { isRecord } from '../../core/data.js';
import { ok, fail } from '../../core/result.js';
import { hasDefinition, isStoredId, refExists } from '../definitions/index.js';
import {
  GROUP_VERSION, REF_FIELDS, isCohesion, isCount, isIdOrNull, isMemberRefList, isNumber, isRefOrNull,
} from './shape.js';

function placeIssue(group) {
  const position = group.worldPosition;
  if (!isRecord(position) || !isNumber(position.x) || !isNumber(position.y)) return 'invalid_position';
  const move = group.movement;
  const numbers = isRecord(move) && [move.targetX, move.targetY].every(isNumber) && [move.baseSpeed, move.currentSpeed].every((speed) => isNumber(speed) && speed >= 0);
  // targetNode is whatever the world area stores for the route target; only its numbers are checked here.
  if (!numbers) return 'invalid_movement';
  const transport = group.transport;
  if (!isRecord(transport) || ![transport.capacityVolumeL, transport.capacityWeightKg].every((capacity) => isNumber(capacity) && capacity >= 0)) return 'invalid_transport';
  if (!isMemberRefList(transport.assetRefs)) return 'invalid_transport';
  return null;
}

function commandIssue(group) {
  for (const field of ['legalCommanderRef', 'actingCommanderRef']) {
    const ref = group[field];
    if (ref !== null && ref.type === 'character' && !group.memberCharacterIds.includes(ref.id)) return `commander_not_member:${field}`;
  }
  return null;
}

function recordIssue(state, id, group) {
  const world = state.world;
  if (!isStoredId(id)) return 'invalid_map_key';
  if (!isRecord(group) || group.id !== id) return 'record_id_mismatch';
  if (group.version !== GROUP_VERSION) return 'unsupported_version';
  if (!isCount(group.revision)) return 'invalid_revision';
  if (typeof group.name !== 'string') return 'invalid_name';
  if (!hasDefinition(state, 'mobile_group_type', group.groupTypeId)) return 'unregistered_group_type';
  if (!hasDefinition(state, 'command_structure', group.commandStructureId)) return 'unregistered_command_structure';
  if (!Array.isArray(group.memberCharacterIds) || !group.memberCharacterIds.every(isStoredId)) return 'invalid_members';
  if (new Set(group.memberCharacterIds).size !== group.memberCharacterIds.length) return 'duplicate_character_member';
  for (const memberId of group.memberCharacterIds) {
    const character = world.characters[memberId];
    if (!isRecord(character)) return `missing_member:${memberId}`;
    if (character.location?.mobileGroupId !== id) return `member_not_located_here:${memberId}`;
  }
  if (!isMemberRefList(group.memberRefs)) return 'invalid_member_refs';
  for (const field of REF_FIELDS) {
    if (!isRefOrNull(group[field])) return `invalid_ref:${field}`;
    if (group[field] !== null && !refExists(state, group[field])) return `missing_ref_target:${field}`;
  }
  const anchorsOk = Array.isArray(group.loyaltyAnchorRefs)
    && group.loyaltyAnchorRefs.every((ref) => isRefOrNull(ref) && ref !== null && refExists(state, ref));
  if (!anchorsOk) return 'invalid_loyalty_anchor_refs';
  const command = commandIssue(group);
  if (command) return command;
  if (!isCohesion(group.cohesion)) return 'invalid_cohesion';
  if (!isIdOrNull(group.inventoryId) || !isIdOrNull(group.treasuryAccountId)) return 'invalid_asset_ids';
  if (group.inventoryId !== null && !Object.hasOwn(world.inventories, group.inventoryId)) return 'missing_inventory';
  if (group.treasuryAccountId !== null && !Object.hasOwn(world.finance.accounts, group.treasuryAccountId)) return 'missing_treasury_account';
  if (!isRecord(group.specializedState) || !isRecord(group.customData)) return 'invalid_custom_data';
  return placeIssue(group);
}

export function checkGroups(state) {
  const groups = state.world.mobileGroups;
  if (!isRecord(groups)) return fail('groups_invalid_root');
  const issues = [];
  for (const id of Object.keys(groups).sort()) {
    const issue = recordIssue(state, id, groups[id]);
    if (issue) issues.push(`${id}:${issue}`);
  }
  return issues.length ? fail('groups_invalid_records', issues) : ok();
}
