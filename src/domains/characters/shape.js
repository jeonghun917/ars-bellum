// Small input and record predicates shared by the character modules.
import { isRecord } from '../../core/data.js';
import { isStoredId } from '../definitions/index.js';

export const CHARACTER_VERSION = 1;
export const LOCATION_MODES = Object.freeze(['none', 'settlement', 'mobile_group']);
export const MAX_NAME_LENGTH = 100;

export const isCount = (value) => Number.isInteger(value) && value >= 0;
export const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
export const isIdOrNull = (value) => value === null || isStoredId(value);
export const isStringOrNull = (value) => value === null || (typeof value === 'string' && value.length > 0 && value.length <= 120);
export const isIdList = (value) => Array.isArray(value) && value.every(isStoredId) && new Set(value).size === value.length;

// Keys of `value` that are not in `allowed` (empty when it is a record with only allowed keys).
export const extraKeys = (value, allowed) => Object.keys(value).filter((key) => !allowed.includes(key));

// An injury is a record with a numeric severity; the rest of it is free data.
export const isInjury = (value) => isRecord(value) && isNumber(value.severity) && value.severity >= 0;

export const sortedUnique = (list) => [...new Set(list)].sort();
