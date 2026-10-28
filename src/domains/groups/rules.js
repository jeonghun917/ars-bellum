// Mobile groups: who travels together (named characters and counted troops or assets), who owns and
// commands the group, how well it holds together, and the links to its inventory and treasury.
//
// Record shape and ids are the earlier version's. Where a group is and where it is heading belongs
// to the world area (movement); the rules here only set those once, when a group is created or split.
// Characters and groups point at each other; every rule here changes both sides together.
import { clone, isRecord } from '../../core/data.js';
import './catalog.js';
import { ok, fail } from '../../core/result.js';
import { checkRef, getDefinition, hasDefinition, isStoredId } from '../definitions/index.js';
import { setGroupLocation } from '../characters/index.js';
import {
  GROUP_VERSION, REF_FIELDS, isCharacterRef, isCohesion, isCount, isGroupName, isMemberRefList, isNumber, memberRefKey, MAX_COHESION,
} from './shape.js';

const CREATE_KEYS = ['id', 'name', 'groupTypeId', 'commandStructureId', 'memberCharacterIds', 'memberRefs', ...REF_FIELDS, 'loyaltyAnchorRefs',
  'cohesion', 'worldPosition', 'movement', 'transport', 'specializedState', 'customData'];
const MOVEMENT_KEYS = ['baseSpeed', 'currentSpeed', 'targetNode', 'targetX', 'targetY'];
const TRANSPORT_KEYS = ['capacityVolumeL', 'capacityWeightKg', 'assetRefs'];

function loadGroup(draft, groupId, expectedRevision) {
  if (!isStoredId(groupId)) return fail('groups_invalid_group_id');
  if (expectedRevision !== undefined && !isCount(expectedRevision)) return fail('groups_invalid_expected_revision');
  if (!Object.hasOwn(draft.world.mobileGroups, groupId)) return fail('groups_missing_group', { groupId });
  const group = draft.world.mobileGroups[groupId];
  if (expectedRevision !== undefined && group.revision !== expectedRevision) return fail('groups_revision_conflict', { groupId, revision: group.revision });
  return ok({ group });
}

function loadCharacter(draft, characterId) {
  if (!isStoredId(characterId) || !Object.hasOwn(draft.world.characters, characterId)) return fail('groups_missing_character', { characterId });
  return ok({ character: draft.world.characters[characterId] });
}

const touch = (group) => { group.revision += 1; };

function refOrNull(draft, value) {
  if (value === null) return ok({ ref: null });
  const checked = checkRef(draft, value);
  return checked.ok ? ok({ ref: checked.ref }) : fail('groups_invalid_ref', { cause: checked.error, ref: value });
}

// A character who commands a group must be one of its members (and alive, when newly appointed).
function commanderIssue(ref, memberIds, draft, { mustBeAlive }) {
  if (!isCharacterRef(ref)) return null;
  if (!memberIds.includes(ref.id)) return 'groups_commander_not_member';
  if (mustBeAlive && !draft.world.characters[ref.id].identity.alive) return 'groups_commander_not_alive';
  return null;
}

function normalizeMemberRefs(list) {
  if (list === undefined) return ok({ list: [] });
  if (!Array.isArray(list) || !list.every(isRecord)) return fail('groups_invalid_member_refs');
  const normalized = list.map((entry) => ({
    refTypeId: entry.refTypeId, refId: entry.refId, roleId: entry.roleId === undefined ? null : entry.roleId,
    quantity: entry.quantity, customData: entry.customData === undefined ? {} : clone(entry.customData),
  }));
  return isMemberRefList(normalized) ? ok({ list: normalized }) : fail('groups_invalid_member_refs');
}

function readPlace(input) {
  const position = input.worldPosition;
  if (!isRecord(position) || !isNumber(position.x) || !isNumber(position.y)) return fail('groups_invalid_position');
  const move = input.movement === undefined ? {} : input.movement;
  if (!isRecord(move) || Object.keys(move).some((key) => !MOVEMENT_KEYS.includes(key))) return fail('groups_invalid_movement');
  const baseSpeed = move.baseSpeed === undefined ? 0 : move.baseSpeed;
  const currentSpeed = move.currentSpeed === undefined ? baseSpeed : move.currentSpeed;
  const targetX = move.targetX === undefined ? position.x : move.targetX;
  const targetY = move.targetY === undefined ? position.y : move.targetY;
  const targetNode = move.targetNode === undefined ? null : move.targetNode;
  if (![baseSpeed, currentSpeed].every((speed) => isNumber(speed) && speed >= 0) || !isNumber(targetX) || !isNumber(targetY)) return fail('groups_invalid_movement');
  if (targetNode !== null && typeof targetNode !== 'string' && !isRecord(targetNode)) return fail('groups_invalid_movement');
  return ok({
    worldPosition: { x: position.x, y: position.y },
    movement: { baseSpeed, currentSpeed, targetNode: clone(targetNode), targetX, targetY },
  });
}

function readTransport(transport) {
  const value = transport === undefined ? {} : transport;
  if (!isRecord(value) || Object.keys(value).some((key) => !TRANSPORT_KEYS.includes(key))) return fail('groups_invalid_transport');
  const assets = normalizeMemberRefs(value.assetRefs);
  if (!assets.ok) return fail('groups_invalid_transport');
  const capacityWeightKg = value.capacityWeightKg === undefined ? 0 : value.capacityWeightKg;
  const capacityVolumeL = value.capacityVolumeL === undefined ? 0 : value.capacityVolumeL;
  if (![capacityWeightKg, capacityVolumeL].every((capacity) => isNumber(capacity) && capacity >= 0)) return fail('groups_invalid_transport');
  return ok({ transport: { assetRefs: assets.list, capacityVolumeL, capacityWeightKg } });
}

// Reads the parts of a new group's input that do not depend on who is moved or copied from elsewhere.
function readGroupFields(draft, input) {
  if (!isGroupName(input.name)) return fail('groups_invalid_name');
  if (typeof input.groupTypeId !== 'string' || !hasDefinition(draft, 'mobile_group_type', input.groupTypeId)) return fail('groups_unregistered_group_type');
  const commandStructureId = input.commandStructureId === undefined ? 'single_commander' : input.commandStructureId;
  if (typeof commandStructureId !== 'string' || !hasDefinition(draft, 'command_structure', commandStructureId)) return fail('groups_unregistered_command_structure');
  if (input.cohesion !== undefined && !isCohesion(input.cohesion)) return fail('groups_invalid_cohesion');
  for (const key of ['specializedState', 'customData']) {
    if (input[key] !== undefined && !isRecord(input[key])) return fail(`groups_invalid_${key}`);
  }
  const place = readPlace(input);
  if (!place.ok) return place;
  const transport = readTransport(input.transport);
  if (!transport.ok) return transport;
  const memberRefs = normalizeMemberRefs(input.memberRefs);
  if (!memberRefs.ok) return memberRefs;
  return ok({
    name: input.name, groupTypeId: input.groupTypeId, commandStructureId, cohesion: input.cohesion ?? MAX_COHESION,
    worldPosition: place.worldPosition, movement: place.movement, transport: transport.transport, memberRefs: memberRefs.list,
    specializedState: clone(input.specializedState ?? {}), customData: clone(input.customData ?? {}),
  });
}

function readRefFields(draft, input, inherited = {}) {
  const refs = {};
  for (const field of REF_FIELDS) {
    const value = input[field] === undefined ? (inherited[field] ?? null) : input[field];
    const checked = refOrNull(draft, value);
    if (!checked.ok) return checked;
    refs[field] = checked.ref;
  }
  const anchors = input.loyaltyAnchorRefs === undefined ? (inherited.loyaltyAnchorRefs ?? []) : input.loyaltyAnchorRefs;
  if (!Array.isArray(anchors)) return fail('groups_invalid_ref', { field: 'loyaltyAnchorRefs' });
  refs.loyaltyAnchorRefs = [];
  for (const anchor of anchors) {
    const checked = refOrNull(draft, anchor);
    if (!checked.ok || checked.ref === null) return fail('groups_invalid_ref', { field: 'loyaltyAnchorRefs' });
    refs.loyaltyAnchorRefs.push(checked.ref);
  }
  return ok({ refs });
}

function assembleGroup(id, fields, refs, memberCharacterIds) {
  return {
    id, version: GROUP_VERSION, revision: 0, name: fields.name, groupTypeId: fields.groupTypeId,
    memberCharacterIds, memberRefs: fields.memberRefs,
    legalOwnerRef: refs.legalOwnerRef, legalCommanderRef: refs.legalCommanderRef, actingCommanderRef: refs.actingCommanderRef,
    commandAuthorityRef: refs.commandAuthorityRef, commandStructureId: fields.commandStructureId,
    employerRef: refs.employerRef, paymasterRef: refs.paymasterRef, loyaltyAnchorRefs: refs.loyaltyAnchorRefs, cohesion: fields.cohesion,
    inventoryId: null, treasuryAccountId: null,
    worldPosition: fields.worldPosition, movement: fields.movement, transport: fields.transport,
    specializedState: fields.specializedState, customData: fields.customData,
  };
}

// Creates a group with its first members. Every named member must be a living character who is in
// no group yet; they are moved into this one. A named commander must be one of them.
// input: { id, name, groupTypeId, commandStructureId = 'single_commander', memberCharacterIds = [], memberRefs?,
//          legalOwnerRef?, legalCommanderRef?, actingCommanderRef?, commandAuthorityRef?, employerRef?, paymasterRef?,
//          loyaltyAnchorRefs?, cohesion = 100, worldPosition: { x, y }, movement?, transport?, specializedState?, customData? }
// The inventory and treasury are attached afterwards (attachInventory, attachTreasury).
export function createGroup(draft, input) {
  if (!isRecord(input)) return fail('groups_invalid_input');
  const unknown = Object.keys(input).find((key) => !CREATE_KEYS.includes(key));
  if (unknown) return fail(unknown === 'inventoryId' || unknown === 'treasuryAccountId' ? 'groups_attach_after_create' : 'groups_unknown_field', { key: unknown });
  if (!isStoredId(input.id)) return fail('groups_invalid_group_id');
  if (Object.hasOwn(draft.world.mobileGroups, input.id)) return fail('groups_duplicate_group', { groupId: input.id });
  const fields = readGroupFields(draft, input);
  if (!fields.ok) return fields;
  const memberIds = input.memberCharacterIds === undefined ? [] : input.memberCharacterIds;
  if (!Array.isArray(memberIds) || !memberIds.every(isStoredId) || new Set(memberIds).size !== memberIds.length) return fail('groups_invalid_members');
  for (const characterId of memberIds) {
    const found = loadCharacter(draft, characterId);
    if (!found.ok) return found;
    if (!found.character.identity.alive) return fail('groups_character_not_alive', { characterId });
    if (found.character.location.mobileGroupId !== null) return fail('groups_character_already_in_group', { characterId });
  }
  const refs = readRefFields(draft, input);
  if (!refs.ok) return refs;
  for (const field of ['legalCommanderRef', 'actingCommanderRef']) {
    const issue = commanderIssue(refs.refs[field], memberIds, draft, { mustBeAlive: true });
    if (issue) return fail(issue, { field });
  }
  const group = assembleGroup(input.id, fields, refs.refs, [...memberIds]);
  draft.world.mobileGroups[group.id] = group;
  for (const characterId of memberIds) {
    const moved = setGroupLocation(draft, { characterId, mobileGroupId: group.id });
    if (!moved.ok) return moved;
  }
  return ok({ groupId: group.id });
}

// Adds a living character to a group. Repeating it for a character already there is a no-op.
// input: { groupId, characterId, expectedGroupRevision?, expectedCharacterRevision? }
export function linkCharacter(draft, input) {
  if (!isRecord(input)) return fail('groups_invalid_input');
  const foundGroup = loadGroup(draft, input.groupId, input.expectedGroupRevision);
  if (!foundGroup.ok) return foundGroup;
  const foundCharacter = loadCharacter(draft, input.characterId);
  if (!foundCharacter.ok) return foundCharacter;
  if (input.expectedCharacterRevision !== undefined && input.expectedCharacterRevision !== foundCharacter.character.revision) {
    return fail('groups_revision_conflict', { characterId: input.characterId, revision: foundCharacter.character.revision });
  }
  const { group } = foundGroup;
  const { character } = foundCharacter;
  const currentGroupId = character.location.mobileGroupId;
  if (currentGroupId !== null && currentGroupId !== group.id) return fail('groups_character_already_in_group', { characterId: character.id });
  if (group.memberCharacterIds.includes(character.id)) {
    return currentGroupId === group.id ? ok({ changed: false }) : fail('groups_relationship_mismatch', { characterId: character.id });
  }
  if (!character.identity.alive) return fail('groups_character_not_alive', { characterId: character.id });
  const moved = setGroupLocation(draft, { characterId: character.id, mobileGroupId: group.id });
  if (!moved.ok) return moved;
  group.memberCharacterIds.push(character.id);
  touch(group);
  return ok({ changed: true });
}

// Takes a character out of a group. The legal and the acting commander cannot be taken out; appoint
// someone else first.
export function unlinkCharacter(draft, input) {
  if (!isRecord(input)) return fail('groups_invalid_input');
  const foundGroup = loadGroup(draft, input.groupId, input.expectedGroupRevision);
  if (!foundGroup.ok) return foundGroup;
  const foundCharacter = loadCharacter(draft, input.characterId);
  if (!foundCharacter.ok) return foundCharacter;
  if (input.expectedCharacterRevision !== undefined && input.expectedCharacterRevision !== foundCharacter.character.revision) {
    return fail('groups_revision_conflict', { characterId: input.characterId, revision: foundCharacter.character.revision });
  }
  const { group } = foundGroup;
  const { character } = foundCharacter;
  if (!group.memberCharacterIds.includes(character.id) || character.location.mobileGroupId !== group.id) return fail('groups_relationship_mismatch', { characterId: character.id });
  if (group.legalCommanderRef?.type === 'character' && group.legalCommanderRef.id === character.id) return fail('groups_cannot_remove_legal_commander');
  if (group.actingCommanderRef?.type === 'character' && group.actingCommanderRef.id === character.id) return fail('groups_cannot_remove_acting_commander');
  const moved = setGroupLocation(draft, { characterId: character.id, mobileGroupId: null });
  if (!moved.ok) return moved;
  group.memberCharacterIds = group.memberCharacterIds.filter((id) => id !== character.id);
  touch(group);
  return ok({ changed: true });
}

// Appoints the legal and/or acting commander (null clears), and may change the command structure.
// A character commander must be a living member of the group. Fields left out are unchanged.
export function setCommanders(draft, input) {
  if (!isRecord(input)) return fail('groups_invalid_input');
  const found = loadGroup(draft, input.groupId, input.expectedRevision);
  if (!found.ok) return found;
  if (Object.keys(input).some((key) => !['groupId', 'expectedRevision', 'legalCommanderRef', 'actingCommanderRef', 'commandStructureId'].includes(key))) {
    return fail('groups_unknown_field');
  }
  const { group } = found;
  const next = {};
  for (const field of ['legalCommanderRef', 'actingCommanderRef']) {
    if (input[field] === undefined) continue;
    const checked = refOrNull(draft, input[field]);
    if (!checked.ok) return checked;
    const issue = commanderIssue(checked.ref, group.memberCharacterIds, draft, { mustBeAlive: true });
    if (issue) return fail(issue, { field });
    next[field] = checked.ref;
  }
  if (input.commandStructureId !== undefined) {
    if (typeof input.commandStructureId !== 'string' || !hasDefinition(draft, 'command_structure', input.commandStructureId)) return fail('groups_unregistered_command_structure');
    next.commandStructureId = input.commandStructureId;
  }
  if (Object.keys(next).length === 0) return fail('groups_invalid_input');
  const changed = Object.keys(next).filter((key) => JSON.stringify(group[key]) !== JSON.stringify(next[key]));
  if (!changed.length) return ok({ changed: false });
  for (const key of changed) group[key] = next[key];
  touch(group);
  return ok({ changed: true });
}

// Sets who legally owns the group, who employs and pays it, whose command it follows and what it is
// loyal to (null clears; a list for the loyalty anchors). Every reference must point at an existing record.
export function setAllegiance(draft, input) {
  if (!isRecord(input)) return fail('groups_invalid_input');
  const found = loadGroup(draft, input.groupId, input.expectedRevision);
  if (!found.ok) return found;
  const fields = ['legalOwnerRef', 'commandAuthorityRef', 'employerRef', 'paymasterRef', 'loyaltyAnchorRefs'];
  if (Object.keys(input).some((key) => !['groupId', 'expectedRevision', ...fields].includes(key))) return fail('groups_unknown_field');
  const given = fields.filter((field) => input[field] !== undefined);
  if (!given.length) return fail('groups_invalid_input');
  const { group } = found;
  const read = readRefFields(draft, Object.fromEntries(given.map((field) => [field, input[field]])), Object.fromEntries(REF_FIELDS.map((field) => [field, group[field]])));
  if (!read.ok) return read;
  const changed = given.filter((field) => JSON.stringify(group[field]) !== JSON.stringify(read.refs[field]));
  if (!changed.length) return ok({ changed: false });
  for (const field of changed) group[field] = read.refs[field];
  touch(group);
  return ok({ changed: true });
}

// How well the group holds together, 0 (falling apart) to 100.
export function setCohesion(draft, input) {
  if (!isRecord(input)) return fail('groups_invalid_input');
  const found = loadGroup(draft, input.groupId, input.expectedRevision);
  if (!found.ok) return found;
  if (!isCohesion(input.cohesion)) return fail('groups_invalid_cohesion');
  const { group } = found;
  if (group.cohesion === input.cohesion) return ok({ changed: false });
  group.cohesion = input.cohesion;
  touch(group);
  return ok({ changed: true });
}

// Sets how many of a counted member (a troop unit...) the group has; 0 removes the entry.
// input: { groupId, refTypeId, refId, roleId = null, quantity }
export function setMemberQuantity(draft, input) {
  if (!isRecord(input)) return fail('groups_invalid_input');
  const found = loadGroup(draft, input.groupId, input.expectedRevision);
  if (!found.ok) return found;
  const roleId = input.roleId === undefined ? null : input.roleId;
  if (!isStoredId(input.refTypeId) || !isStoredId(input.refId) || (roleId !== null && !isStoredId(roleId))) return fail('groups_invalid_member_refs');
  if (!isCount(input.quantity)) return fail('groups_invalid_quantity');
  const { group } = found;
  const key = memberRefKey({ refTypeId: input.refTypeId, refId: input.refId, roleId });
  const index = group.memberRefs.findIndex((entry) => memberRefKey(entry) === key);
  if (index < 0 && input.quantity === 0) return ok({ changed: false });
  if (index < 0) {
    group.memberRefs.push({ refTypeId: input.refTypeId, refId: input.refId, roleId, quantity: input.quantity, customData: {} });
  } else if (input.quantity === 0) {
    group.memberRefs.splice(index, 1);
  } else if (group.memberRefs[index].quantity === input.quantity) {
    return ok({ changed: false });
  } else {
    group.memberRefs[index].quantity = input.quantity;
  }
  touch(group);
  return ok({ changed: true });
}

// Renames the group or changes its kind or free data. Membership, command and allegiance have their own rules.
export function updateGroup(draft, input) {
  if (!isRecord(input)) return fail('groups_invalid_input');
  const found = loadGroup(draft, input.groupId, input.expectedRevision);
  if (!found.ok) return found;
  const allowedKeys = ['groupId', 'expectedRevision', 'name', 'groupTypeId', 'specializedState', 'customData'];
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) return fail('groups_unknown_field');
  if (input.name !== undefined && !isGroupName(input.name)) return fail('groups_invalid_name');
  const knownType = typeof input.groupTypeId === 'string' && hasDefinition(draft, 'mobile_group_type', input.groupTypeId);
  if (input.groupTypeId !== undefined && !knownType) return fail('groups_unregistered_group_type');
  for (const key of ['specializedState', 'customData']) {
    if (input[key] !== undefined && !isRecord(input[key])) return fail(`groups_invalid_${key}`);
  }
  const { group } = found;
  const before = JSON.stringify(group);
  for (const key of ['name', 'groupTypeId']) if (input[key] !== undefined) group[key] = input[key];
  for (const key of ['specializedState', 'customData']) if (input[key] !== undefined) group[key] = clone(input[key]);
  if (JSON.stringify(group) === before) return ok({ changed: false });
  touch(group);
  return ok({ changed: true });
}

// Links a group to its inventory. The inventory must be owned by this group.
export function attachInventory(draft, input) {
  return attachAsset(draft, input, {
    idField: 'inventoryId', groupField: 'inventoryId', records: draft.world.inventories, missing: 'groups_missing_inventory', mismatch: 'groups_inventory_owner_mismatch',
  });
}

// Links a group to its treasury account. The account must be owned by this group.
export function attachTreasury(draft, input) {
  return attachAsset(draft, input, {
    idField: 'accountId', groupField: 'treasuryAccountId', records: draft.world.finance.accounts, missing: 'groups_missing_account', mismatch: 'groups_account_owner_mismatch',
  });
}

function attachAsset(draft, input, { idField, groupField, records, missing, mismatch }) {
  if (!isRecord(input)) return fail('groups_invalid_input');
  const found = loadGroup(draft, input.groupId, input.expectedGroupRevision);
  if (!found.ok) return found;
  const assetId = input[idField];
  if (!isStoredId(assetId) || !Object.hasOwn(records, assetId)) return fail(missing, { id: assetId });
  const owner = records[assetId].ownerRef;
  const { group } = found;
  if (owner?.type !== 'mobile_group' || owner.id !== group.id) return fail(mismatch);
  if (group[groupField] === assetId) return ok({ changed: false });
  group[groupField] = assetId;
  touch(group);
  return ok({ changed: true });
}

// Moves part of a group into a new group: some of its characters and some counted members and
// transport assets. The commanders stay with the source group. The new group starts where the source is
// (and not moving), with the source's cohesion and allegiance unless the plan says otherwise.
// To give the new group an inventory or treasury, create them owned by the new group and attach them.
// plan: { sourceGroupId, expectedGroupRevision?, newGroup: { id, name, groupTypeId, commandStructureId, ...optional fields },
//         characterMoves: [{ characterId }], memberRefMoves: [{ refTypeId, refId, roleId?, quantity }],
//         transportAssetMoves: [same] }
export function splitGroup(draft, plan) {
  if (!isRecord(plan)) return fail('groups_invalid_input');
  const foundSource = loadGroup(draft, plan.sourceGroupId, plan.expectedGroupRevision);
  if (!foundSource.ok) return fail(foundSource.error === 'groups_missing_group' ? 'groups_missing_source_group' : foundSource.error, foundSource.detail);
  const { group: source } = foundSource;
  const spec = plan.newGroup;
  if (!isRecord(spec)) return fail('groups_invalid_input');
  const allowed = [
    'id', 'name', 'groupTypeId', 'commandStructureId', ...REF_FIELDS, 'loyaltyAnchorRefs', 'cohesion', 'worldPosition', 'movement', 'transport',
    'specializedState', 'customData',
  ];
  const unknown = Object.keys(spec).find((key) => !allowed.includes(key));
  if (unknown) return fail('groups_unknown_field', { key: unknown });
  if (!isStoredId(spec.id) || Object.hasOwn(draft.world.mobileGroups, spec.id)) return fail('groups_duplicate_new_group_id');
  if (spec.commandStructureId === undefined) return fail('groups_explicit_command_structure_required');
  const characterMoves = plan.characterMoves === undefined ? [] : plan.characterMoves;
  if (!Array.isArray(characterMoves) || !characterMoves.every(isRecord)) return fail('groups_invalid_character_allocation');
  const movedIds = characterMoves.map((move) => move.characterId);
  const allocationOk = movedIds.every(isStoredId) && new Set(movedIds).size === movedIds.length
    && movedIds.every((id) => source.memberCharacterIds.includes(id));
  if (!allocationOk) return fail('groups_invalid_character_allocation');
  for (const move of characterMoves) {
    const current = draft.world.characters[move.characterId];
    if (move.expectedRevision !== undefined && move.expectedRevision !== current?.revision) return fail('groups_revision_conflict', { characterId: move.characterId });
    if (current?.location.mobileGroupId !== source.id) return fail('groups_relationship_mismatch', { characterId: move.characterId });
  }
  const memberAllocation = moveRefs(source.memberRefs, plan.memberRefMoves);
  if (!memberAllocation.ok) return memberAllocation;
  const transportAllocation = moveRefs(source.transport.assetRefs, plan.transportAssetMoves);
  if (!transportAllocation.ok) return fail('groups_invalid_transport_asset_allocation', { cause: transportAllocation.error });
  if (!movedIds.length && !memberAllocation.moved.length && !transportAllocation.moved.length) return fail('groups_empty_split');

  const startsAt = {
    worldPosition: spec.worldPosition ?? clone(source.worldPosition),
    movement: spec.movement ?? { baseSpeed: source.movement.baseSpeed, currentSpeed: source.movement.currentSpeed },
    cohesion: spec.cohesion ?? source.cohesion,
    transport: { ...clone(spec.transport ?? {}), assetRefs: transportAllocation.moved.map(clone) },
  };
  const fields = readGroupFields(draft, { ...spec, ...startsAt, memberRefs: memberAllocation.moved.map(clone) });
  if (!fields.ok) return fields;
  const refs = readRefFields(draft, spec, Object.fromEntries([...REF_FIELDS, 'loyaltyAnchorRefs'].map((field) => [field, source[field]])));
  if (!refs.ok) return refs;
  for (const field of ['legalCommanderRef', 'actingCommanderRef']) {
    if (spec[field] === undefined) {
      refs.refs[field] = null;
      continue;
    }
    const issue = commanderIssue(refs.refs[field], movedIds, draft, { mustBeAlive: true });
    if (issue) return fail(issue === 'groups_commander_not_member' ? 'groups_explicit_commander_not_moved' : issue, { field });
  }
  for (const field of ['legalCommanderRef', 'actingCommanderRef']) {
    if (source[field]?.type === 'character' && movedIds.includes(source[field].id)) {
      return fail(field === 'legalCommanderRef' ? 'groups_source_legal_commander_moved' : 'groups_source_acting_commander_moved');
    }
  }

  const created = assembleGroup(spec.id, fields, refs.refs, [...movedIds]);
  source.memberCharacterIds = source.memberCharacterIds.filter((id) => !movedIds.includes(id));
  source.memberRefs = memberAllocation.remain;
  source.transport.assetRefs = transportAllocation.remain;
  touch(source);
  draft.world.mobileGroups[created.id] = created;
  for (const characterId of movedIds) {
    const moved = setGroupLocation(draft, { characterId, mobileGroupId: created.id });
    if (!moved.ok) return moved;
  }
  return ok({ sourceGroupId: source.id, newGroupId: created.id });
}

// Takes the requested quantities out of a list of counted members. Each request names a different entry.
function moveRefs(source, requested) {
  if (requested !== undefined && (!Array.isArray(requested) || !requested.every(isRecord))) return fail('groups_invalid_ref_allocation');
  const remain = clone(source);
  const moved = [];
  const seen = new Set();
  for (const request of requested ?? []) {
    const roleId = request.roleId === undefined ? null : request.roleId;
    const key = memberRefKey({ refTypeId: request.refTypeId, refId: request.refId, roleId });
    if (seen.has(key)) return fail('groups_duplicate_ref_allocation');
    seen.add(key);
    const index = remain.findIndex((entry) => memberRefKey(entry) === key);
    if (index < 0 || !Number.isInteger(request.quantity) || request.quantity <= 0 || request.quantity > remain[index].quantity) return fail('groups_invalid_ref_allocation');
    moved.push({ ...clone(remain[index]), quantity: request.quantity });
    remain[index].quantity -= request.quantity;
    if (remain[index].quantity === 0) remain.splice(index, 1);
  }
  return ok({ remain, moved });
}

// ---- reading -------------------------------------------------------------------------------

export function getGroup(state, groupId) {
  const group = isStoredId(groupId) && Object.hasOwn(state.world.mobileGroups, groupId) ? state.world.mobileGroups[groupId] : null;
  return group ? clone(group) : null;
}

export const listGroups = (state) => Object.keys(state.world.mobileGroups).sort().map((id) => clone(state.world.mobileGroups[id]));

// The group a character travels with, or null.
export function getGroupOfCharacter(state, characterId) {
  const groupId = state.world.characters[characterId]?.location.mobileGroupId ?? null;
  return groupId === null ? null : getGroup(state, groupId);
}

export const getGroupTypeDefinition = (state, id) => getDefinition(state, 'mobile_group_type', id);
export const getCommandStructureDefinition = (state, id) => getDefinition(state, 'command_structure', id);
