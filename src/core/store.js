// The single owner of persistent game state.
//
// State is read as a frozen snapshot. It changes only through transact(label, change): the change
// gets a private copy (the draft) and either returns nothing / ok(), or a failure. On failure, or if
// the draft does not validate, nothing changes. On success the draft becomes the new state and the
// revision goes up by one. Several areas changed in one transaction succeed or fail together.
import { clone, deepFreeze, findNonJson } from './data.js';
import { ok, fail } from './result.js';

export function createStore(initialState, { validate = () => ok() } = {}) {
  const first = validate(initialState);
  if (!first.ok) throw new Error(`initial state invalid: ${first.error} ${JSON.stringify(first.detail ?? '')}`);
  let state = deepFreeze(clone(initialState));
  let busy = false;
  const listeners = new Set();

  function transact(label, change) {
    if (busy) return fail('store_nested_transaction', { label });
    busy = true;
    try {
      const draft = clone(state);
      let outcome;
      try { outcome = change(draft); } catch (error) { return fail('store_change_threw', { label, message: String(error?.message || error) }); }
      if (outcome && outcome.ok === false) return outcome;
      const bad = findNonJson(draft);
      if (bad) return fail('store_state_not_json', { label, path: bad });
      draft.revision = state.revision + 1;
      const checked = validate(draft);
      if (!checked.ok) return fail('store_state_invalid', { label, cause: checked.error, detail: checked.detail });
      state = deepFreeze(draft);
      for (const listener of listeners) listener({ label, revision: state.revision });
      return ok({ revision: state.revision, ...(outcome && outcome.ok ? Object.fromEntries(Object.entries(outcome).filter(([k]) => k !== 'ok')) : {}) });
    } finally {
      busy = false;
    }
  }

  // Replaces the whole state, e.g. after loading a save. Same validation as a transaction.
  function replace(next) {
    if (busy) return fail('store_nested_transaction', { label: 'replace' });
    const bad = findNonJson(next);
    if (bad) return fail('store_state_not_json', { label: 'replace', path: bad });
    const checked = validate(next);
    if (!checked.ok) return fail('store_state_invalid', { label: 'replace', cause: checked.error, detail: checked.detail });
    state = deepFreeze(clone(next));
    for (const listener of listeners) listener({ label: 'replace', revision: state.revision });
    return ok({ revision: state.revision });
  }

  return {
    getState: () => state,
    transact,
    replace,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
