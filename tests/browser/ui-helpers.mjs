// Shared setup for the ui-*.spec.mjs files (play.html, the new campaign screens).
import fs from 'node:fs';
import { expect } from '@playwright/test';
import { newCampaignState } from '../../src/game/campaign.js';
import { SAVE_KEY, V1_SAVE_KEY, encodeSave } from '../../src/persist/save.js';
import { PLAYER_GROUP_ID } from '../../src/game/new-game.js';

export { SAVE_KEY, V1_SAVE_KEY, PLAYER_GROUP_ID };
export const V1_FIXTURE = fs.readFileSync(new URL('../fixtures/v1-new-game-save.json', import.meta.url), 'utf8');

// Collects everything that must not happen on a healthy page: script errors, console errors and
// browser dialogs (alert / confirm, which the new screens never use).
export function watch(page) {
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
  page.on('dialog', async (dialog) => { problems.push(`dialog: ${dialog.type()} ${dialog.message()}`); await dialog.dismiss(); });
  return problems;
}

// An encoded save of a (possibly edited) new campaign, as the page's storage holds it.
export function savedGame(edit, revision) {
  const state = newCampaignState({ seed: 3 });
  edit?.(state);
  if (revision !== undefined) state.revision = revision;
  return encodeSave(state, '2026-10-28T00:00:00.000Z');
}

export function standAt(state, x, y) {
  const group = state.world.mobileGroups[PLAYER_GROUP_ID];
  group.worldPosition = { x, y };
  group.movement.targetX = x;
  group.movement.targetY = y;
}
export const atCastle = (state) => standAt(state, 800, 1200);

// A game whose days pass in a blink: 0.1 real ms per game minute.
export const fastClock = (state, speed = 4) => {
  state.clock.realMsPerGameMinute = 0.1;
  state.clock.speed = speed;
};
export const paused = (state) => { state.clock.speed = 0; };

export function giveMaterials(state, id = 'test_castle') {
  Object.assign(state.world.settlements[id].inventory, { timber: 200, planks: 100, clay: 100, pottery: 50, iron_ingot: 20 });
}

// Opens play.html with the given localStorage entries in place (everything else cleared).
export async function openWith(page, entries = {}, url = '/play.html') {
  await page.goto(url);
  await page.evaluate((items) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(items)) localStorage.setItem(key, value);
  }, entries);
  await page.goto(url);
  await expect(page.locator('#btn-main-game')).toBeVisible();
}

export async function startMainGame(page) {
  await page.locator('#btn-main-game').click();
  await expect(page.locator('#screen-world')).toBeVisible();
  await expect(page.locator('#world-canvas')).toHaveAttribute('data-zoom', /\d/);
}

export const storageDump = (page) => page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
export const storedSave = (page, key = SAVE_KEY) => page.evaluate((k) => {
  const raw = localStorage.getItem(k);
  return raw === null ? null : JSON.parse(raw);
}, key);

// Clicks the map at a world point (the view is read from the canvas, so zoom and pan do not matter).
export async function clickWorld(page, x, y) {
  const canvas = page.locator('#world-canvas');
  const box = await canvas.boundingBox();
  const view = await canvas.evaluate((c) => ({ zoom: Number(c.dataset.zoom), x: Number(c.dataset.viewX), y: Number(c.dataset.viewY) }));
  await page.mouse.click(box.x + view.x + x * view.zoom, box.y + view.y + y * view.zoom);
}

export const NODE_POSITIONS = { test_castle: [800, 1200], test_city: [2000, 1500], test_village: [3500, 1800] };
export const clickNode = (page, id) => clickWorld(page, ...NODE_POSITIONS[id]);

export const number = (text) => Number(String(text).replace(/[^\d.-]/g, ''));
export async function hud(page) {
  const text = (id) => page.locator(id).innerText();
  return {
    gold: number(await text('#hud-gold')),
    food: number(await text('#hud-food')),
    manpower: number(await text('#hud-manpower')),
    territory: number(await text('#hud-territory')),
    day: number(await text('#hud-day')),
  };
}

export async function waitForArrival(page, nodeId) {
  await expect(page.locator('#party-status')).toHaveAttribute('data-at', nodeId, { timeout: 15_000 });
}
