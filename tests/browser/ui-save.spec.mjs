// Campaign screens (index.html): saving, loading, earlier-version and damaged saves.
import { test, expect } from '@playwright/test';
import {
  V1_FIXTURE, V1_SAVE_KEY, SAVE_KEY, clickNode, fastClock, hud, openWith, paused, savedGame, startMainGame, storageDump, storedSave,
  waitForArrival, watch,
} from './ui-helpers.mjs';

test('[ui.save.button-and-reload-restores] saving and reopening gives back the same game: bar, place, speed, and the stored save is untouched by opening', async ({ page }) => {
  const problems = watch(page);
  await openWith(page);
  await startMainGame(page);
  await page.locator('#speed-4').click();
  await clickNode(page, 'test_castle');
  await waitForArrival(page, 'test_castle');
  await page.locator('#sp-workforce').fill('12');
  await page.locator('#sp-workforce-set').click();
  await expect(page.locator('#sp-crew-info')).toContainText('정한 인원 12명');
  await page.locator('#speed-0').click();

  await expect(page.locator('#save-status')).toHaveText('아직 저장하지 않았습니다.');
  await page.locator('#btn-save').click();
  await expect(page.locator('#save-status')).toContainText('저장했습니다');
  await expect(page.locator('#save-status')).toHaveAttribute('data-kind', 'ok');
  const seen = {
    hud: await hud(page),
    clock: await page.locator('#time-label').innerText(),
    party: await page.locator('#party-status').innerText(),
    crew: await page.locator('#sp-crew-info').innerText(),
    panelName: await page.locator('#sp-name').innerText(),
  };
  const stored = await storageDump(page);
  expect(Object.keys(stored)).toEqual([SAVE_KEY]);

  await page.reload();
  await expect(page.locator('#btn-main-game')).toContainText('이어하기');
  await expect(page.locator('#menu-continue')).toContainText('이어하기');
  await startMainGame(page);
  expect(await hud(page)).toEqual(seen.hud);
  expect(await page.locator('#time-label').innerText()).toBe(seen.clock);
  expect(await page.locator('#party-status').innerText()).toBe(seen.party);
  expect(await page.locator('#sp-crew-info').innerText()).toBe(seen.crew);
  expect(await page.locator('#sp-name').innerText()).toBe(seen.panelName);
  await expect(page.locator('#speed-0')).toHaveAttribute('aria-pressed', 'true');
  expect(await storageDump(page)).toEqual(stored);
  expect(problems).toEqual([]);
});

test('[ui.save.autosave-each-day] the game saves itself once per game day and not while no day passes', async ({ page }) => {
  const problems = watch(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    window.__writes = [];
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === 'ars_bellum_save_v2') window.__writes.push(key);
      return original.call(this, key, value);
    };
  });
  await openWith(page, { [SAVE_KEY]: savedGame((state) => { fastClock(state, 0); }) });
  await startMainGame(page);
  const writes = () => page.evaluate(() => window.__writes.length);
  await page.waitForTimeout(300);
  expect(await writes()).toBe(0);
  await page.locator('#speed-4').click();
  await expect.poll(async () => (await hud(page)).day, { timeout: 10_000 }).toBeGreaterThanOrEqual(4);
  await page.locator('#speed-0').click();
  const countAfter = await writes();
  const stored = await storedSave(page);
  expect(countAfter).toBeGreaterThanOrEqual(1);
  expect(stored.state.lastProcessedDay).toBeGreaterThanOrEqual(1);
  expect(countAfter).toBeLessThanOrEqual(stored.state.lastProcessedDay + 1);
  await expect(page.locator('#save-status')).toHaveAttribute('data-save-kind', 'auto');
  await expect(page.locator('#save-status')).toContainText('자동 저장했습니다');
  await page.waitForTimeout(300);
  expect(await writes()).toBe(countAfter);
  expect(problems).toEqual([]);
});

test('[ui.save.failure-shows-reason] a save another tab got ahead of is refused with its reason, in the page, and the stored save stays', async ({ page }) => {
  const problems = watch(page);
  await openWith(page);
  await startMainGame(page);
  const newer = savedGame(undefined, 9);
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [SAVE_KEY, newer]);
  await page.locator('#btn-save').click();
  const status = page.locator('#save-status');
  await expect(status).toHaveAttribute('data-kind', 'error');
  await expect(status).toContainText('저장하지 못했습니다');
  await expect(status).toContainText('다른 곳');
  await expect(status).toContainText('save_conflict');
  expect((await storageDump(page))[SAVE_KEY]).toBe(newer);
  expect(problems).toEqual([]);
});

test('[ui.save.autosave-failure-shows-reason] when the daily autosave fails the page says so with the reason, and the game keeps running', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, { [SAVE_KEY]: savedGame((state) => fastClock(state, 0)) });
  // From now on the browser refuses to store the game (a full disk, for example).
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key.startsWith('ars_bellum_save_v2')) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await startMainGame(page);
  await page.locator('#speed-4').click();
  const status = page.locator('#save-status');
  await expect(status).toHaveAttribute('data-save-kind', 'auto', { timeout: 10_000 });
  await expect(status).toHaveAttribute('data-kind', 'error');
  await expect(status).toContainText('save_write_failed');
  await expect(status).toContainText('저장 공간');
  await expect.poll(async () => (await hud(page)).day, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  await page.locator('#speed-0').click();
  expect(problems).toEqual([]);
});

test('[ui.save.v1-opens] an earlier version\'s save in localStorage opens as a game; its key is left alone until a new save is made', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, { [V1_SAVE_KEY]: V1_FIXTURE });
  await expect(page.locator('#btn-main-game')).toContainText('이어하기');
  await startMainGame(page);
  expect(await hud(page)).toMatchObject({ gold: 500, day: 1, manpower: 0, territory: 0 });
  await page.locator('#speed-0').click();
  expect(await storageDump(page)).toEqual({ [V1_SAVE_KEY]: V1_FIXTURE });
  await page.locator('#btn-save').click();
  await expect(page.locator('#save-status')).toContainText('저장했습니다');
  const dump = await storageDump(page);
  expect(dump[V1_SAVE_KEY]).toBe(V1_FIXTURE);
  expect(JSON.parse(dump[SAVE_KEY]).format).toBe('ars_bellum_save');
  expect(problems).toEqual([]);
});

test('[ui.save.damaged-message-and-new] a damaged save is explained, left untouched until the player chooses to start new, and only then replaced', async ({ page }) => {
  const problems = watch(page);
  const damaged = '{"format":"ars_bellum_save","schemaVers';
  await openWith(page, { [SAVE_KEY]: damaged });
  await expect(page.locator('#save-problem')).toBeVisible();
  await expect(page.locator('#save-problem-reason')).toContainText('JSON');
  await expect(page.locator('#save-problem-reason')).toContainText('save_not_json');
  await page.locator('#btn-main-game').click();
  await expect(page.locator('#save-problem')).toBeVisible();
  await expect(page.locator('#screen-world')).toBeHidden();
  expect(await storageDump(page)).toEqual({ [SAVE_KEY]: damaged });

  await page.locator('#btn-start-new').click();
  await expect(page.locator('#screen-world')).toBeVisible();
  expect(await hud(page)).toMatchObject({ gold: 500, day: 1 });
  const stored = await storedSave(page);
  expect(stored.format).toBe('ars_bellum_save');
  expect(stored.state.world.finance.accounts.legacy_player_personal_account.balance).toBe(500);
  expect(Object.keys(await storageDump(page))).toEqual([SAVE_KEY]);
  expect(problems).toEqual([]);
});

test('[ui.save.tampered-save-explained] a save whose content no longer matches its check value says so', async ({ page }) => {
  const problems = watch(page);
  const tampered = JSON.stringify({ ...JSON.parse(savedGame()), digest: 'sha256:0000' });
  await openWith(page, { [SAVE_KEY]: tampered });
  await expect(page.locator('#save-problem-reason')).toContainText('검증 값');
  await expect(page.locator('#save-problem-reason')).toContainText('save_digest_mismatch');
  await expect(page.locator('#btn-start-new')).toBeVisible();
  expect(problems).toEqual([]);
});

test('[ui.save.newer-version-never-overwritten] a save from a newer version is explained and never replaced; starting over it is not offered', async ({ page }) => {
  const problems = watch(page);
  const newer = JSON.stringify({ ...JSON.parse(savedGame()), schemaVersion: 3 });
  await openWith(page, { [SAVE_KEY]: newer });
  await expect(page.locator('#save-problem')).toBeVisible();
  await expect(page.locator('#save-problem-reason')).toContainText('새로운 버전');
  await expect(page.locator('#save-problem-reason')).toContainText('save_from_newer_version');
  await expect(page.locator('#btn-start-new')).toHaveCount(0);
  await page.locator('#btn-main-game').click();
  await expect(page.locator('#screen-world')).toBeHidden();
  expect(await storageDump(page)).toEqual({ [SAVE_KEY]: newer });
  // The practice battle is still there.
  await expect(page.locator('#btn-practice')).toBeEnabled();
  expect(problems).toEqual([]);
});

test('[ui.save.leaving-without-save-asks] leaving for the menu saves first; if that fails the player is told why and may still leave', async ({ page }) => {
  const problems = watch(page);
  await openWith(page);
  await startMainGame(page);
  await page.locator('#btn-menu').click();
  await expect(page.locator('#screen-menu')).toBeVisible();
  expect((await storedSave(page)).format).toBe('ars_bellum_save');

  await page.locator('#btn-main-game').click();
  const newer = savedGame(undefined, 12);
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [SAVE_KEY, newer]);
  await page.locator('#btn-menu').click();
  await expect(page.locator('#save-status')).toContainText('save_conflict');
  await expect(page.locator('#screen-world')).toBeVisible();
  await page.locator('#btn-leave-unsaved').click();
  await expect(page.locator('#screen-menu')).toBeVisible();
  expect((await storageDump(page))[SAVE_KEY]).toBe(newer);
  expect(problems).toEqual([]);
});
