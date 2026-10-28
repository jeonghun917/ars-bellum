// 2D battle checks on the main game page. Each test title starts with its check id.
import { test, expect } from '@playwright/test';

const savedGold = (page) => page.evaluate(() => {
  const save = JSON.parse(localStorage.getItem('ars_bellum_save_v1'));
  return Object.values(save.gameState.world.finance.accounts).find((a) => a.accountTypeId === 'personal').balance;
});

// Starts a battle in the given mode, skips preparation and removes every enemy, then returns the
// first message the game shows.
async function winBattle(page, startButton) {
  const dialogs = [];
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.accept(); });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.ArsSaveService && localStorage.getItem('ars_bellum_save_v1'));
  const gold = await savedGold(page);
  await page.click(startButton);
  await page.waitForFunction(() => Array.isArray(window.currentSquads) && window.currentSquads.length > 0);
  await page.evaluate(() => {
    window.isPreparationPhase = false;
    for (const squad of window.currentSquads) if (squad.team === 'enemy') squad.units = [];
  });
  await expect.poll(() => dialogs.length, { timeout: 10_000 }).toBeGreaterThan(0);
  return { message: dialogs[0], goldBefore: gold, goldAfter: await savedGold(page), dialogs };
}

test('[m1.battle.practice-no-reward] winning a practice battle records no gold or territory', async ({ page }) => {
  const { message, goldBefore, goldAfter } = await winBattle(page, '#btn-practice-mode');
  expect(message).toContain('연습');
  expect(goldAfter).toBe(goldBefore);
});

test('[m1.battle.campaign-win-rewards] winning a main-game battle saves the gold reward once', async ({ page }) => {
  const { message, goldBefore, goldAfter, dialogs } = await winBattle(page, '#btn-main-game-mode');
  expect(message).toContain('전투 승리');
  expect(goldAfter).toBeGreaterThanOrEqual(goldBefore + 1500);
  expect(goldAfter).toBeLessThan(goldBefore + 2500);
  await page.waitForTimeout(500);
  expect(dialogs.length).toBe(1);
});

test('[m1.battle.failed-win-save-stops] if saving a win fails, the game says so once and does not retry', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.accept(); });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.ArsSaveService && localStorage.getItem('ars_bellum_save_v1'));
  const goldBefore = await savedGold(page);
  await page.click('#btn-main-game-mode');
  await page.waitForFunction(() => Array.isArray(window.currentSquads) && window.currentSquads.length > 0);
  await page.evaluate(() => {
    // The save service object is frozen, so make the storage itself refuse writes (e.g. a full disk).
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith('ars_bellum_save')) throw new Error('test_storage_full');
      return setItem.call(this, key, value);
    };
    window.isPreparationPhase = false;
    for (const squad of window.currentSquads) if (squad.team === 'enemy') squad.units = [];
  });
  await expect.poll(() => dialogs.length, { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]).toContain('승리 기록 실패');
  expect(await savedGold(page)).toBe(goldBefore);
});
