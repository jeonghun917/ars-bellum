// The one result shape used everywhere: { ok: true, ...value } or { ok: false, error, detail? }.
export const ok = (value = {}) => ({ ok: true, ...value });
export const fail = (error, detail) => (detail === undefined ? { ok: false, error } : { ok: false, error, detail });
