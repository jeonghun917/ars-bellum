// Saving and loading.
//
// A save is written to a staging key first, read back and checked, then written to the final key
// and read back again; the final key is only replaced by a save that has been read back intact.
// A save carries a revision: if the stored save is newer than the one this session loaded (for
// example another tab saved meanwhile), saving is refused rather than overwriting it. A save from a
// newer game version is never overwritten or loaded. Saves of the earlier version are read and
// converted, and their key is left untouched.
import { canonicalJson, isRecord } from '../core/data.js';
import { ok, fail } from '../core/result.js';
import { sha256Hex } from '../core/sha256.js';
import { SCHEMA_VERSION } from '../game/new-game.js';
import { validateState } from './schema.js';
import { migrateV1Envelope } from './migrate-v1.js';

export const SAVE_KEY = 'ars_bellum_save_v2';
export const STAGING_KEY = 'ars_bellum_save_v2_staging';
export const V1_SAVE_KEY = 'ars_bellum_save_v1';
const FORMAT = 'ars_bellum_save';

export const digestOf = (state) => `sha256:${sha256Hex(canonicalJson(state))}`;

export function encodeSave(state, savedAt) {
  return JSON.stringify({ format: FORMAT, schemaVersion: SCHEMA_VERSION, revision: state.revision, savedAt, digest: digestOf(state), state });
}

// Parses and checks one stored save text. Returns { state } or a failure saying exactly why.
export function decodeSave(raw) {
  let envelope;
  try { envelope = JSON.parse(raw); } catch { return fail('save_not_json'); }
  if (!isRecord(envelope) || envelope.format !== FORMAT) return fail('save_wrong_format');
  if (!Number.isInteger(envelope.schemaVersion)) return fail('save_no_schema_version');
  if (envelope.schemaVersion > SCHEMA_VERSION) return fail('save_from_newer_version', { schemaVersion: envelope.schemaVersion });
  if (envelope.schemaVersion < SCHEMA_VERSION) return fail('save_unknown_old_version', { schemaVersion: envelope.schemaVersion });
  if (!isRecord(envelope.state)) return fail('save_no_state');
  if (envelope.digest !== digestOf(envelope.state)) return fail('save_digest_mismatch');
  if (envelope.revision !== envelope.state.revision) return fail('save_revision_mismatch');
  const checked = validateState(envelope.state);
  if (!checked.ok) return fail('save_state_invalid', checked.detail);
  return ok({ state: envelope.state, revision: envelope.revision });
}

export function createSaveService(storage, { now = () => new Date().toISOString() } = {}) {
  // Revision of the save this session last loaded or wrote; null = no save seen yet.
  let knownRevision = null;

  function load() {
    const raw = storage.get(SAVE_KEY);
    if (raw !== null) {
      const decoded = decodeSave(raw);
      if (!decoded.ok) return decoded;
      knownRevision = decoded.revision;
      return ok({ state: decoded.state, source: 'v2' });
    }
    const v1 = storage.get(V1_SAVE_KEY);
    if (v1 !== null) {
      let envelope;
      try { envelope = JSON.parse(v1); } catch { return fail('v1_save_not_json'); }
      if (isRecord(envelope) && Number.isInteger(envelope.schemaVersion) && envelope.schemaVersion > 1) return fail('v1_key_holds_newer_version');
      const migrated = migrateV1Envelope(envelope);
      if (!migrated.ok) return migrated;
      const checked = validateState(migrated.state);
      if (!checked.ok) return fail('v1_migrated_state_invalid', checked.detail);
      knownRevision = null;
      return ok({ state: migrated.state, source: 'v1' });
    }
    return ok({ state: null, source: 'none' });
  }

  // `replaceUnreadable` lets the caller overwrite a stored save that cannot be read; without it,
  // an unreadable save is kept and saving is refused, so a damaged save is never lost silently.
  function save(state, { replaceUnreadable = false } = {}) {
    const checked = validateState(state);
    if (!checked.ok) return fail('save_state_invalid', checked.detail);
    const current = storage.get(SAVE_KEY);
    if (current !== null) {
      const decoded = decodeSave(current);
      if (!decoded.ok && decoded.error === 'save_from_newer_version') return fail('save_refused_newer_version_stored');
      if (!decoded.ok && !replaceUnreadable) return fail('save_refused_stored_save_unreadable', { cause: decoded.error });
      if (decoded.ok && decoded.revision !== knownRevision) {
        return fail('save_conflict', { stored: decoded.revision, known: knownRevision });
      }
    }
    if (knownRevision !== null && state.revision < knownRevision) return fail('save_older_than_stored', { state: state.revision, known: knownRevision });
    const raw = encodeSave(state, now());
    try {
      storage.set(STAGING_KEY, raw);
      if (storage.get(STAGING_KEY) !== raw || !decodeSave(raw).ok) return fail('save_staging_readback_failed');
      storage.set(SAVE_KEY, raw);
      if (storage.get(SAVE_KEY) !== raw) {
        if (current !== null) storage.set(SAVE_KEY, current);
        return fail('save_final_readback_failed');
      }
    } catch (error) {
      try { if (current !== null && storage.get(SAVE_KEY) !== current) storage.set(SAVE_KEY, current); } catch { /* keep the first error */ }
      return fail('save_write_failed', String(error?.message || error));
    } finally {
      try { storage.remove(STAGING_KEY); } catch { /* staging is disposable */ }
    }
    knownRevision = state.revision;
    return ok({ revision: state.revision });
  }

  return { load, save };
}
