// A running campaign: the store, its save service, and the actions that touch the whole state
// (start, advance time, save). Screens talk to this, never to the store's internals.
import { createStore } from '../core/store.js';
import { advance } from '../core/calendar.js';
import { ok, fail } from '../core/result.js';
import { validateState } from '../persist/schema.js';
import { createSaveService } from '../persist/save.js';
import { createSettlementsFromWorldData } from '../domains/settlements/index.js';
import { newGameState } from './new-game.js';
import { runDueDays } from './daily.js';
import { DAILY_STEPS, DAILY_CONTEXT } from './areas.js';

// A new campaign with the map's settlements in place.
export function newCampaignState(options) {
  const state = newGameState(options);
  const seeded = createSettlementsFromWorldData(state);
  if (!seeded.ok) throw new Error(`settlement seeding failed: ${seeded.error}`);
  return state;
}

// Loads the saved campaign (current or earlier version) or starts a new one. A save that cannot
// be read is reported and left untouched; the caller decides whether to start fresh.
export function openCampaign(storage, { seed = 1, now } = {}) {
  const saves = createSaveService(storage, now ? { now } : {});
  const loaded = saves.load();
  if (!loaded.ok) return loaded;
  let state = loaded.state;
  if (state === null) state = newCampaignState({ seed });
  else if (Object.keys(state.world.settlements).length === 0) {
    // The earlier version saved before its settlements existed; give such saves the map's settlements.
    const seeded = createSettlementsFromWorldData(state);
    if (!seeded.ok) return fail('campaign_settlement_seed_failed', seeded);
  }
  const store = createStore(state, { validate: validateState });
  return ok({ campaign: createCampaign(store, saves), source: loaded.source });
}

export function createCampaign(store, saves) {
  return {
    store,
    getState: store.getState,
    // Moves game time on by whole minutes, then processes every day that ended.
    advanceMinutes(minutes) {
      const moved = store.transact('advance time', (draft) => { draft.calendar = advance(draft.calendar, minutes).calendar; });
      if (!moved.ok) return moved;
      return runDueDays(store, DAILY_STEPS, DAILY_CONTEXT);
    },
    save: (options) => saves.save(store.getState(), options),
  };
}
