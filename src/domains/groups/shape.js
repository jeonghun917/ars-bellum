// Predicates and small builders shared by the group modules.
import { isRecord } from '../../core/data.js';
import { isStoredId, isStoredRef } from '../definitions/index.js';

export const GROUP_VERSION = 1;
export const MAX_COHESION = 100;
export const MIN_COHESION = 0;
export const MAX_NAME_LENGTH = 100;
export const REF_FIELDS = Object.freeze(['legalOwnerRef', 'legalCommanderRef', 'actingCommanderRef', 'commandAuthorityRef', 'employerRef', 'paymasterRef']);

export const isCount = (value) => Number.isInteger(value) && value >= 0;
export const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
export const isIdOrNull = (value) => value === null || isStoredId(value);
export const isRefOrNull = (value) => value === null || isStoredRef(value);
export const isCohesion = (value) => isNumber(value) && value >= MIN_COHESION && value <= MAX_COHESION;
export const isGroupName = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_NAME_LENGTH;

// A non-character member (a troop unit, a wagon...): `quantity` of `refId` of kind `refTypeId` in a role.
export const memberRefKey = (entry) => JSON.stringify([entry.refTypeId, entry.refId, entry.roleId]);

export function isMemberRef(value) {
  return isRecord(value) && isStoredId(value.refTypeId) && isStoredId(value.refId) && (value.roleId === null || isStoredId(value.roleId))
    && Number.isInteger(value.quantity) && value.quantity > 0 && isRecord(value.customData);
}

export function isMemberRefList(list) {
  return Array.isArray(list) && list.every(isMemberRef) && new Set(list.map(memberRefKey)).size === list.length;
}

export const isCharacterRef = (ref) => ref !== null && ref.type === 'character';
