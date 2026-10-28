// Ids and references shared by every game area.
// An id is snake_case-ish: starts with a lowercase letter or digit, then lowercase letters, digits,
// "_", "-", ".", ":". A reference points at a record of some type: { type, id }.
export const ID_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,119}$/;
export const isId = (value) => typeof value === 'string' && ID_PATTERN.test(value);
export const isIdOrNull = (value) => value === null || isId(value);
export const isRef = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && isId(value.type) && isId(value.id) && Object.keys(value).length === 2;
export const isRefOrNull = (value) => value === null || isRef(value);
export const ref = (type, id) => ({ type, id });
export const sameRef = (a, b) => !!a && !!b && a.type === b.type && a.id === b.id;
