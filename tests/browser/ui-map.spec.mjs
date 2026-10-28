// Campaign screens (play.html): page start, map, movement, time and the top bar.
import { test, expect } from '@playwright/test';
import {
  atCastle, clickNode, clickWorld, fastClock, hud, openWith, savedGame, standAt, startMainGame, storedSave, SAVE_KEY, waitForArrival, watch,
} from './ui-helpers.mjs';

test('[ui.page.loads-clean] play.html loads to its menu and into the campaign with no script errors, console errors or dialogs', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/play.html');
  await expect(page.locator('#btn-practice')).toHaveText('연습장');
  await expect(page.locator('#btn-main-game')).toBeVisible();
  await page.waitForTimeout(300);
  await page.locator('#btn-main-game').click();
  await expect(page.locator('#world-canvas')).toBeVisible();
  await page.waitForTimeout(600);
  expect(problems).toEqual([]);
});

test('[ui.menu.new-game-day1-gold500] a new game opens on day 1 with 500 gold, 10 days of food, no manpower or territory, at 1일 08:00', async ({ page }) => {
  const problems = watch(page);
  await openWith(page);
  await expect(page.locator('#btn-main-game')).toContainText('새 게임');
  await startMainGame(page);
  expect(await hud(page)).toEqual({ gold: 500, food: 10, manpower: 0, territory: 0, day: 1 });
  await expect(page.locator('#time-label')).toContainText('1일 08:');
  await expect(page.locator('#speed-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#settlement-panel')).toBeHidden();
  expect(problems).toEqual([]);
});

test('[ui.map.click-to-move] clicking a settlement sends the group there along the road; it arrives, says so in the page and the settlement panel opens', async ({ page }) => {
  const problems = watch(page);
  await openWith(page);
  await startMainGame(page);
  await page.locator('#speed-4').click();
  await clickNode(page, 'test_castle');
  await expect(page.locator('#map-message')).toContainText('카멜롯 성');
  await expect(page.locator('#party-status')).toHaveAttribute('data-moving', 'true');
  await waitForArrival(page, 'test_castle');
  await expect(page.locator('#map-message')).toHaveText('카멜롯 성에 도착했습니다.');
  await expect(page.locator('#party-status')).toHaveAttribute('data-x', '800.0');
  await expect(page.locator('#party-status')).toHaveAttribute('data-y', '1200.0');
  await expect(page.locator('#settlement-panel')).toBeVisible();
  await expect(page.locator('#sp-name')).toHaveText('카멜롯 성');
  expect(problems).toEqual([]);
});

test('[ui.map.click-ground-moves] clicking bare ground sends the group to that point', async ({ page }) => {
  const problems = watch(page);
  await openWith(page);
  await startMainGame(page);
  await page.locator('#speed-4').click();
  await clickWorld(page, 1500, 1100);
  await expect(page.locator('#map-message')).toContainText('지정한 위치');
  await expect(page.locator('#map-message')).toHaveText('목적지에 도착했습니다.', { timeout: 15_000 });
  const status = page.locator('#party-status');
  await expect(status).toHaveAttribute('data-moving', 'false');
  expect(Math.abs(Number(await status.getAttribute('data-x')) - 1500)).toBeLessThan(2.5);
  expect(Math.abs(Number(await status.getAttribute('data-y')) - 1100)).toBeLessThan(2.5);
  await expect(page.locator('#settlement-panel')).toBeHidden();
  expect(problems).toEqual([]);
});

test('[ui.map.second-order-replaces-first] a new click while walking changes the destination', async ({ page }) => {
  const problems = watch(page);
  await openWith(page);
  await startMainGame(page);
  await page.locator('#speed-4').click();
  await clickNode(page, 'test_village');
  await page.waitForTimeout(150);
  await clickNode(page, 'test_castle');
  await waitForArrival(page, 'test_castle');
  expect(problems).toEqual([]);
});

test('[ui.map.paused-group-stands-still] while paused an ordered group does not move; when time runs again it walks on', async ({ page }) => {
  const problems = watch(page);
  await openWith(page);
  await startMainGame(page);
  await page.locator('#speed-4').click();
  await clickNode(page, 'test_village');
  await page.waitForTimeout(250);
  await page.locator('#speed-0').click();
  const status = page.locator('#party-status');
  const where = async () => [await status.getAttribute('data-x'), await status.getAttribute('data-y')];
  const stopped = await where();
  expect(stopped).not.toEqual(['1000.0', '1000.0']);
  await page.waitForTimeout(500);
  expect(await where()).toEqual(stopped);
  await expect(status).toHaveAttribute('data-moving', 'true');
  await page.locator('#speed-4').click();
  await expect.poll(where).not.toEqual(stopped);
  expect(problems).toEqual([]);
});

test('[ui.map.blocked-message] walking into impassable terrain stops the group and the page says which terrain blocked it', async ({ page }) => {
  const problems = watch(page);
  const save = savedGame((state) => { standAt(state, 3300, 3100); state.clock.speed = 4; });
  await openWith(page, { [SAVE_KEY]: save }, '/play.html?terrain=test');
  await startMainGame(page);
  await clickWorld(page, 3600, 3100);
  const message = page.locator('#map-message');
  await expect(message).toContainText('산맥', { timeout: 15_000 });
  await expect(message).toHaveAttribute('data-kind', 'warn');
  await expect(page.locator('#party-status')).toHaveAttribute('data-moving', 'false');
  const x = Number(await page.locator('#party-status').getAttribute('data-x'));
  expect(x).toBeGreaterThan(3300);
  expect(x).toBeLessThan(3400);
  expect(problems).toEqual([]);
});

test('[ui.time.controls-advance-days] pause, 1x, 2x and 4x set the pace; days pass, the day and hour show, and the settlement changes day by day', async ({ page }) => {
  const problems = watch(page);
  const save = savedGame((state) => { atCastle(state); fastClock(state, 0); });
  await openWith(page, { [SAVE_KEY]: save });
  await startMainGame(page);
  await expect(page.locator('#speed-0')).toHaveAttribute('aria-pressed', 'true');
  const before = {
    clock: await page.locator('#time-label').innerText(),
    treasury: await page.locator('#sp-treasury').innerText(),
    stock: await page.locator('#sp-stock').innerText(),
    population: await page.locator('#sp-population').innerText(),
  };
  await page.waitForTimeout(300);
  expect(await page.locator('#time-label').innerText()).toBe(before.clock);
  expect(await hud(page)).toMatchObject({ day: 1 });

  await page.locator('#speed-4').click();
  await expect(page.locator('#speed-4')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#speed-0')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#hud-day')).not.toHaveText('1');
  await expect.poll(async () => (await hud(page)).day, { timeout: 10_000 }).toBeGreaterThanOrEqual(4);
  await page.locator('#speed-0').click();
  const day = (await hud(page)).day;
  const clockAfter = await page.locator('#time-label').innerText();
  expect(clockAfter).not.toBe(before.clock);
  expect(clockAfter).toMatch(new RegExp(`^${day}일 \\d\\d:\\d\\d$`));
  await page.waitForTimeout(300);
  expect((await hud(page)).day).toBe(day);
  expect(await page.locator('#time-label').innerText()).toBe(clockAfter);

  expect(await page.locator('#sp-treasury').innerText()).not.toBe(before.treasury);
  expect(await page.locator('#sp-stock').innerText()).not.toBe(before.stock);
  await expect(page.locator('#sp-report')).toContainText(`${day - 1}일차`);

  await page.locator('#speed-2').click();
  await expect(page.locator('#speed-2')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#speed-1').click();
  await expect(page.locator('#speed-1')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#speed-0').click();
  expect(problems).toEqual([]);
});

test('[ui.time.speed-is-saved] the chosen pace belongs to the game state: pause, save, reopen and the game is still paused', async ({ page }) => {
  const problems = watch(page);
  await openWith(page);
  await startMainGame(page);
  await page.locator('#speed-0').click();
  await page.locator('#btn-save').click();
  await expect(page.locator('#save-status')).toContainText('저장했습니다');
  expect((await storedSave(page)).state.clock.speed).toBe(0);
  await page.reload();
  await startMainGame(page);
  await expect(page.locator('#speed-0')).toHaveAttribute('aria-pressed', 'true');
  expect(problems).toEqual([]);
});
