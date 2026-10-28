// Campaign screens (index.html): the settlement panel and building.
import { test, expect } from '@playwright/test';
import { BUILDINGS } from '../../src/domains/settlements/index.js';
import { atCastle, fastClock, giveMaterials, number, openWith, paused, savedGame, startMainGame, SAVE_KEY, watch } from './ui-helpers.mjs';

const castleGame = (...edits) => savedGame((state) => { atCastle(state); paused(state); edits.forEach((edit) => edit(state)); });

test('[ui.settlement.panel-shows-state] at a settlement the panel shows people, stock, treasury, buildings and the queue', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, { [SAVE_KEY]: castleGame() });
  await startMainGame(page);
  await expect(page.locator('#settlement-panel')).toBeVisible();
  await expect(page.locator('#sp-name')).toHaveText('카멜롯 성');
  await expect(page.locator('#sp-type')).toHaveText('성');
  await expect(page.locator('#sp-population')).toContainText('1,800 / 3,000');
  await expect(page.locator('#sp-treasury')).toHaveText('금 1,200');
  await expect(page.locator('#sp-stock li[data-resource="grain"]')).toHaveText('곡물 280');
  await expect(page.locator('#sp-buildings')).toContainText('지은 건물이 없습니다');
  await expect(page.locator('#sp-queue')).toContainText('대기 중인 건설이 없습니다');
  await expect(page.locator('#sp-building-select option')).toHaveCount(BUILDINGS.length);
  // The panel can be folded away to see the map.
  await page.locator('#sp-toggle').click();
  await expect(page.locator('#sp-treasury')).toBeHidden();
  await expect(page.locator('#sp-name')).toBeVisible();
  await page.locator('#sp-toggle').click();
  await expect(page.locator('#sp-treasury')).toBeVisible();
  expect(problems).toEqual([]);
});

test('[ui.settlement.panel-hidden-away-from-settlements] away from every settlement there is no panel', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, { [SAVE_KEY]: savedGame(paused) });
  await startMainGame(page);
  await expect(page.locator('#settlement-panel')).toBeHidden();
  expect(problems).toEqual([]);
});

test('[ui.build.enqueue-and-cancel] a building can be queued (cost paid from the settlement) and cancelled (cost refunded); both show in the panel', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, { [SAVE_KEY]: castleGame(giveMaterials) });
  await startMainGame(page);
  await expect(page.locator('#sp-treasury')).toHaveText('금 1,200');
  await page.locator('#sp-building-select').selectOption('farmland_expansion');
  await expect(page.locator('#sp-preview')).toContainText('금 120, 목재 16');
  await page.locator('#sp-enqueue').click();
  await expect(page.locator('#sp-message')).toContainText('농경지 개간 Lv 1 건설을 대기열에 넣었습니다');
  await expect(page.locator('#sp-message')).toHaveAttribute('data-kind', 'ok');
  const job = page.locator('#sp-queue li[data-job-id]');
  await expect(job).toHaveCount(1);
  await expect(job).toContainText('농경지 개간 Lv 0→1');
  await expect(job).toHaveAttribute('data-status', 'queued');
  await expect(page.locator('#sp-treasury')).toHaveText('금 1,080');
  await expect(page.locator('#sp-stock li[data-resource="timber"]')).toHaveText('목재 184');

  await job.locator('button[data-action="cancel"]').click();
  await expect(page.locator('#sp-queue li[data-job-id]')).toHaveCount(0);
  await expect(page.locator('#sp-message')).toContainText('건설을 취소했습니다');
  await expect(page.locator('#sp-treasury')).toHaveText('금 1,200');
  await expect(page.locator('#sp-stock li[data-resource="timber"]')).toHaveText('목재 200');
  expect(problems).toEqual([]);
});

test('[ui.build.refusals-show-reason] every refusal says why: not enough goods, a building the place cannot have, a bad crew size', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, { [SAVE_KEY]: castleGame() });
  await startMainGame(page);
  const message = page.locator('#sp-message');

  await page.locator('#sp-building-select').selectOption('farmland_expansion');
  await page.locator('#sp-enqueue').click();
  await expect(message).toHaveAttribute('data-kind', 'error');
  await expect(message).toContainText('목재 16');
  await expect(message).toContainText('settlements_insufficient_cost');
  await expect(page.locator('#sp-queue li[data-job-id]')).toHaveCount(0);
  await expect(page.locator('#sp-treasury')).toHaveText('금 1,200');

  await page.locator('#sp-building-select').selectOption('fishery');
  await expect(page.locator('#sp-preview')).toContainText('river');
  await page.locator('#sp-enqueue').click();
  await expect(message).toContainText('지을 수 없습니다');
  await expect(message).toContainText('settlements_placement_blocked');

  for (const bad of ['-3', '', '2.5']) {
    await page.locator('#sp-workforce').fill(bad);
    await page.locator('#sp-workforce-set').click();
    await expect(message).toContainText('settlements_invalid_workforce');
  }
  expect(problems).toEqual([]);
});

test('[ui.build.crew-builds-over-days] with a crew set and time running, the queued building is worked on and finishes', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, { [SAVE_KEY]: castleGame(giveMaterials, (state) => fastClock(state, 0)) });
  await startMainGame(page);
  await page.locator('#sp-workforce').fill('30');
  await page.locator('#sp-workforce-set').click();
  await expect(page.locator('#sp-message')).toContainText('30명');
  await expect(page.locator('#sp-crew-info')).toContainText('정한 인원 30명');
  await page.locator('#sp-building-select').selectOption('farmland_expansion');
  await page.locator('#sp-enqueue').click();
  await expect(page.locator('#sp-queue li[data-job-id]')).toHaveCount(1);

  // Let the days run (one real ms is many game minutes in this save).
  await page.evaluate(() => document.querySelector('#speed-4').click());
  await expect(page.locator('#sp-queue li[data-status="active"]')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('#sp-buildings li[data-building="farmland_expansion"]')).toHaveAttribute('data-level', '1', { timeout: 20_000 });
  await expect(page.locator('#sp-buildings')).toContainText('농경지 개간 (Lv 1/10)');
  await expect(page.locator('#sp-queue')).toContainText('대기 중인 건설이 없습니다');
  await page.locator('#speed-0').click();
  expect(problems).toEqual([]);
});

test('[ui.build.no-crew-no-progress] a queued building with no crew set is not worked on, and the panel says a crew of 0 does not build', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, { [SAVE_KEY]: castleGame(giveMaterials, (state) => fastClock(state, 4)) });
  await startMainGame(page);
  await page.locator('#speed-0').click();
  await page.locator('#sp-building-select').selectOption('farmland_expansion');
  await page.locator('#sp-enqueue').click();
  await expect(page.locator('#sp-crew-info')).toContainText('0이면 공사가 진행되지 않습니다');
  await page.locator('#speed-4').click();
  await expect.poll(async () => (await page.locator('#hud-day').innerText()), { timeout: 10_000 }).not.toBe('1');
  await expect.poll(async () => number(await page.locator('#hud-day').innerText()), { timeout: 10_000 }).toBeGreaterThan(3);
  await page.locator('#speed-0').click();
  await expect(page.locator('#sp-queue .job-text')).toContainText('작업 0/210');
  expect(problems).toEqual([]);
});
