// Turns a save written by the earlier version (schemaVersion 1, key ars_bellum_save_v1) into the
// current state shape. The world records keep their shape; only the wrapping changes. Nothing is
// dropped: the old migration notes are kept under legacy.v1.
import { isRecord, clone } from '../core/data.js';
import { ok, fail } from '../core/result.js';
import { seedFrom } from '../core/rng.js';
import { SCHEMA_VERSION } from '../game/new-game.js';

export function migrateV1Envelope(envelope) {
  if (!isRecord(envelope) || envelope.schemaVersion !== 1) return fail('v1_not_a_v1_save');
  const gameState = envelope.gameState;
  if (!isRecord(gameState) || !isRecord(gameState.world) || !isRecord(gameState.playerControl)) return fail('v1_game_state_missing');
  const clock = isRecord(envelope.gameClock) ? envelope.gameClock : {};
  const prefs = isRecord(envelope.simulationPreferences) ? envelope.simulationPreferences : {};
  const { migration: worldMigration = null, ...world } = clone(gameState.world);
  const day = Number.isInteger(clock.day) && clock.day >= 1 ? clock.day : 1;
  return ok({
    state: {
      schemaVersion: SCHEMA_VERSION,
      revision: Number.isInteger(envelope.revision) && envelope.revision >= 0 ? envelope.revision : 0,
      saveId: typeof envelope.saveId === 'string' && envelope.saveId ? envelope.saveId : 'campaign_default',
      createdAt: typeof envelope.createdAt === 'string' ? envelope.createdAt : '1970-01-01T00:00:00.000Z',
      calendar: {
        day,
        hour: Number.isInteger(clock.hour) && clock.hour >= 0 && clock.hour < 24 ? clock.hour : 8,
        minute: Number.isInteger(clock.minute) && clock.minute >= 0 && clock.minute < 60 ? clock.minute : 0,
      },
      // The earlier version never ran daily processing, so days before the current one count as done.
      lastProcessedDay: day - 1,
      clock: {
        speed: Number.isFinite(clock.speed) && clock.speed >= 0 ? clock.speed : 1,
        realMsPerGameMinute: Number.isFinite(clock.realMsPerGameMinute) && clock.realMsPerGameMinute > 0 ? clock.realMsPerGameMinute : 1000,
      },
      prefs: {
        worldScale: Number.isFinite(prefs.worldScale) && prefs.worldScale > 0 ? prefs.worldScale : 1,
        battleScale: Number.isFinite(prefs.battleScale) && prefs.battleScale > 0 ? prefs.battleScale : 1,
      },
      rng: seedFrom(1),
      playerControl: clone(gameState.playerControl),
      world,
      legacy: { v1: { worldMigration, migration: clone(envelope.migration ?? null), sourceBuild: clone(envelope.sourceBuild ?? null) } },
    },
  });
}
