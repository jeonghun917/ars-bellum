// The 3D battle opened from the game (index.html): src/battle3d/ opens m2_prototype.html in a frame and
// brings its result back. Named m2-* so it runs where the 3D battle has WebGL (playwright.config.mjs).
import { test, expect } from '@playwright/test';
import { watch } from './ui-helpers.mjs';

test('[m2.campaign.practice-3d] a practice battle in 3D opens the 3D battle with the game\'s seed and brings its end back to the game', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/index.html?battle=3d&seed=7');
  await page.click('#btn-practice');
  await expect(page.locator('#battle3d-frame')).toBeVisible({ timeout: 30_000 });
  // The frame is shown before it has loaded the battle page: look it up each time until the battle is there.
  const battleFrame = () => page.frame({ url: /m2_prototype\.html/ });
  const ask = (fn) => battleFrame()?.evaluate(fn).catch(() => null) ?? null;
  await expect.poll(() => ask(() => window.ArsM2Battle?.getSnapshot()?.battleId ?? null), { timeout: 60_000 }).toBe('practice_7');
  // Stopping the battle ends it with nothing to record (a retreat to the game).
  const receipt = await battleFrame().evaluate(() => window.ArsM2Battle.issueCommand({ commandId: 'stop', type: 'battle_abort' }));
  expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
  await expect(page.locator('#battle-result-title')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#battle-result-message')).toHaveAttribute('data-outcome', 'retreat');
  await page.click('#battle-result-ok');
  await expect(page.locator('#battle3d-frame')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('[m2.campaign.menu-choice] the menu offers 2D or 3D battles and remembers the choice', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#btn-battle-view')).toHaveText('전투 화면: 2D');
  await page.click('#btn-battle-view');
  await expect(page.locator('#btn-battle-view')).toHaveText('전투 화면: 3D');
  expect(await page.evaluate(() => localStorage.getItem('ars-bellum-battle-view'))).toBe('3d');
  await page.reload();
  await expect(page.locator('#btn-battle-view')).toHaveText('전투 화면: 3D');
});
