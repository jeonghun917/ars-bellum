import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openCampaign, newCampaignState } from '../../src/game/campaign.js';
import { validateState } from '../../src/persist/schema.js';
import { memoryStorage } from '../../src/persist/storage.js';
import { V1_SAVE_KEY } from '../../src/persist/save.js';
import { DAILY_STEPS } from '../../src/game/areas.js';

const v1NewGame = fs.readFileSync(new URL('../fixtures/v1-new-game-save.json', import.meta.url), 'utf8');

test('[game.campaign.new-has-settlements] a new campaign starts with the map\'s settlements and passes every area check', () => {
  const state = newCampaignState();
  assert.ok(Object.keys(state.world.settlements).length >= 3);
  assert.deepEqual(validateState(state), { ok: true });
});

test('[game.campaign.daily-steps-wired] settlements, finance and follow-ups each run in the day change, in that order', () => {
  const names = DAILY_STEPS.map((step) => step.name);
  assert.ok(names.some((n) => n.startsWith('settlements')) && names.includes('finance.mark_overdue_debts') && names.includes('followups.drain'));
  const orders = DAILY_STEPS.map((step) => step.order);
  assert.ok(Math.max(...DAILY_STEPS.filter((s) => s.name.startsWith('settlements')).map((s) => s.order)) < 500);
  assert.equal(new Set(names).size, names.length);
  assert.ok(orders.every(Number.isFinite));
});

test('[game.campaign.days-pass] ten game days pass: every day is processed once and the state stays valid', () => {
  const opened = openCampaign(memoryStorage());
  assert.equal(opened.ok, true);
  const { campaign } = opened;
  const before = structuredClone(campaign.getState().world.settlements);
  const result = campaign.advanceMinutes(10 * 24 * 60);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.processed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(campaign.getState().lastProcessedDay, 10);
  assert.notDeepEqual(campaign.getState().world.settlements, before);
  assert.deepEqual(validateState(campaign.getState()), { ok: true });
});

test('[game.campaign.save-and-reopen] a campaign saved after some days reopens exactly as it was', () => {
  const storage = memoryStorage();
  const first = openCampaign(storage).campaign;
  first.advanceMinutes(3 * 24 * 60 + 17);
  assert.equal(first.save().ok, true);
  const again = openCampaign(storage);
  assert.equal(again.source, 'v2');
  assert.deepEqual(again.campaign.getState(), first.getState());
});

test('[game.campaign.earlier-save-gets-settlements] an earlier-version save opens with the map\'s settlements added', () => {
  const opened = openCampaign(memoryStorage({ [V1_SAVE_KEY]: v1NewGame }));
  assert.equal(opened.ok, true);
  assert.equal(opened.source, 'v1');
  assert.ok(Object.keys(opened.campaign.getState().world.settlements).length >= 3);
  assert.equal(opened.campaign.advanceMinutes(24 * 60).ok, true);
});
