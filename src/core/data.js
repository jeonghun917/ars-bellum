// Plain-JSON helpers. Game state is plain JSON only (no Map, Set, Date or class instances),
// so it can be cloned, frozen, compared and saved without special cases.

export const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// Returns the first path that is not plain JSON, or null.
export function findNonJson(value, path = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) { const bad = findNonJson(value[i], `${path}[${i}]`); if (bad) return bad; }
    return null;
  }
  const prototype = isRecord(value) ? Object.getPrototypeOf(value) : undefined;
  if (prototype === Object.prototype || prototype === null) {
    for (const key of Object.keys(value)) { const bad = findNonJson(value[key], `${path}.${key}`); if (bad) return bad; }
    return null;
  }
  return path;
}

// JSON with object keys sorted, so equal data always gives the same text (and digest).
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
