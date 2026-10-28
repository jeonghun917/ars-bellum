// Shared setup for the ui-*.test.mjs files (not a test itself: the runner only takes *.test.mjs).
import { createStore } from '../../src/core/store.js';
import { createCampaign, newCampaignState, openCampaign } from '../../src/game/campaign.js';
import { createSaveService } from '../../src/persist/save.js';
import { validateState } from '../../src/persist/schema.js';
import { memoryStorage } from '../../src/persist/storage.js';
import { PLAYER_GROUP_ID } from '../../src/game/new-game.js';

export { PLAYER_GROUP_ID };

// A campaign on in-memory storage. `edit(state)` may change the starting state first.
export function makeCampaign({ storage = memoryStorage(), edit } = {}) {
  const state = newCampaignState({ seed: 3 });
  if (edit) edit(state);
  const store = createStore(state, { validate: validateState });
  return { campaign: createCampaign(store, createSaveService(storage)), storage };
}

export function openFresh(storage = memoryStorage(), seed = 3) {
  const opened = openCampaign(storage, { seed });
  if (!opened.ok) throw new Error(`open failed: ${opened.error}`);
  return { campaign: opened.campaign, storage };
}

// Counts the transactions the store commits.
export function countCommits(campaign) {
  const counter = { count: 0, labels: [] };
  campaign.store.subscribe(({ label }) => { counter.count += 1; counter.labels.push(label); });
  return counter;
}
