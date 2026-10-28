// Storage adapters with one small interface: get(key) -> string|null, set(key, string), remove(key).
export function browserStorage(storage = globalThis.localStorage) {
  return {
    get: (key) => storage.getItem(key),
    set: (key, value) => storage.setItem(key, value),
    remove: (key) => storage.removeItem(key),
  };
}

// In-memory storage for tests. `failOn` makes chosen writes throw, to test failure paths.
export function memoryStorage(initial = {}, { failOn = () => false } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: (key) => (data.has(key) ? data.get(key) : null),
    set: (key, value) => { if (failOn(key, value)) throw new Error(`write refused: ${key}`); data.set(key, String(value)); },
    remove: (key) => { data.delete(key); },
  };
}
