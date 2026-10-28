import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newGameState } from '../../src/game/new-game.js';
import { validateState } from '../../src/persist/schema.js';
import { createSaveService, encodeSave, SAVE_KEY, STAGING_KEY, V1_SAVE_KEY } from '../../src/persist/save.js';
import { memoryStorage } from '../../src/persist/storage.js';
import { migrateV1Envelope } from '../../src/persist/migrate-v1.js';

const v1NewGame = fs.readFileSync(new URL('../fixtures/v1-new-game-save.json', import.meta.url), 'utf8');
const withRevision = (state, revision) => ({ ...state, revision });

test('[persist.new-game.valid] a new game passes the state checks', () => {
  assert.deepEqual(validateState(newGameState()), { ok: true });
});

test('[persist.save.round-trip] what is saved loads back exactly', () => {
  const storage = memoryStorage();
  const state = newGameState({ seed: 7 });
  assert.equal(createSaveService(storage).save(state).ok, true);
  const loaded = createSaveService(storage).load();
  assert.equal(loaded.source, 'v2');
  assert.deepEqual(loaded.state, state);
  assert.equal(storage.get(STAGING_KEY), null);
});

test('[persist.save.failed-write-keeps-old] a write that fails leaves the previous save in place', () => {
  const storage = memoryStorage();
  const service = createSaveService(storage);
  service.save(newGameState());
  const before = storage.get(SAVE_KEY);
  const failing = memoryStorage(Object.fromEntries(storage.data), { failOn: (key) => key === SAVE_KEY });
  const second = createSaveService(failing);
  second.load();
  const result = second.save(withRevision(newGameState(), 1));
  assert.equal(result.error, 'save_write_failed');
  assert.equal(failing.get(SAVE_KEY), before);
});

test('[persist.save.conflict] a save made elsewhere meanwhile is not overwritten', () => {
  const storage = memoryStorage();
  const tabA = createSaveService(storage);
  const tabB = createSaveService(storage);
  tabA.save(newGameState());
  tabB.load();
  tabA.load();
  assert.equal(tabA.save(withRevision(newGameState(), 1)).ok, true);
  const result = tabB.save(withRevision(newGameState(), 1));
  assert.equal(result.error, 'save_conflict');
});

test('[persist.save.newer-version-kept] a save from a newer game version is neither loaded nor overwritten', () => {
  const newer = JSON.stringify({ format: 'ars_bellum_save', schemaVersion: 99, revision: 3, state: {} });
  const storage = memoryStorage({ [SAVE_KEY]: newer });
  const service = createSaveService(storage);
  assert.equal(service.load().error, 'save_from_newer_version');
  assert.equal(service.save(newGameState()).error, 'save_refused_newer_version_stored');
  assert.equal(storage.get(SAVE_KEY), newer);
});

test('[persist.save.damage-detected] a changed or broken save is reported, and kept unless replacing is asked for', () => {
  const tampered = JSON.parse(encodeSave(newGameState(), 'now'));
  tampered.state.world.finance.accounts.legacy_player_personal_account.balance = 999999;
  const raw = JSON.stringify(tampered);
  const storage = memoryStorage({ [SAVE_KEY]: raw });
  const service = createSaveService(storage);
  assert.equal(service.load().error, 'save_digest_mismatch');
  assert.equal(service.save(newGameState()).error, 'save_refused_stored_save_unreadable');
  assert.equal(storage.get(SAVE_KEY), raw);
  assert.equal(service.save(newGameState(), { replaceUnreadable: true }).ok, true);
  assert.equal(createSaveService(memoryStorage({ [SAVE_KEY]: '{not json' })).load().error, 'save_not_json');
});

test('[persist.v1.imports-earlier-save] a new-game save of the earlier version loads as the same game', () => {
  const migrated = migrateV1Envelope(JSON.parse(v1NewGame));
  assert.equal(migrated.ok, true);
  assert.deepEqual(validateState(migrated.state), { ok: true });
  const fresh = newGameState();
  assert.deepEqual(migrated.state.world, fresh.world);
  assert.deepEqual(migrated.state.playerControl, fresh.playerControl);
  assert.deepEqual(migrated.state.calendar, fresh.calendar);
  assert.deepEqual(migrated.state.legacy.v1.worldMigration.completedSteps, ['new_game_bootstrap_v1']);
});

test('[persist.v1.key-untouched] loading and saving never changes the earlier version\'s save', () => {
  const storage = memoryStorage({ [V1_SAVE_KEY]: v1NewGame });
  const service = createSaveService(storage);
  const loaded = service.load();
  assert.equal(loaded.source, 'v1');
  assert.equal(service.save(withRevision(loaded.state, loaded.state.revision + 1)).ok, true);
  assert.equal(storage.get(V1_SAVE_KEY), v1NewGame);
  assert.equal(createSaveService(storage).load().source, 'v2');
});

test('[persist.save.readback-restores] if the final save does not read back intact, the previous save is put back', () => {
  const storage = memoryStorage();
  createSaveService(storage).save(newGameState());
  const before = storage.get(SAVE_KEY);
  // Storage that silently damages the next final write (e.g. a full or faulty disk).
  let damageNext = true;
  const flaky = {
    get: (key) => storage.get(key),
    remove: (key) => storage.remove(key),
    set: (key, value) => storage.set(key, key === SAVE_KEY && damageNext && value !== before ? (damageNext = false, value.slice(0, 20)) : value),
  };
  const service = createSaveService(flaky);
  service.load();
  assert.equal(service.save(withRevision(newGameState(), 1)).error, 'save_final_readback_failed');
  assert.equal(storage.get(SAVE_KEY), before);
});

test('[persist.v1.no-catch-up-flood] an earlier-version save on a later day does not replay every past day', () => {
  const envelope = JSON.parse(v1NewGame);
  envelope.gameClock.day = 40;
  const migrated = migrateV1Envelope(envelope);
  assert.equal(migrated.state.calendar.day, 40);
  assert.equal(migrated.state.lastProcessedDay, 39);
});
