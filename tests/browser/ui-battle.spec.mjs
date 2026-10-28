// Campaign screens (play.html): battles, with a stand-in battle (?fakeBattle=...) in place of the 2D battle.
import { test, expect } from '@playwright/test';
import { SAVE_KEY, hud, openWith, savedGame, startMainGame, storageDump, storedSave, watch } from './ui-helpers.mjs';

const fake = (kind, extra = '') => `/play.html?fakeBattle=${kind}${extra}`;
const finishBattle = async (page) => {
  await expect(page.locator('#fake-battle')).toBeVisible();
  await page.locator('#fake-battle-finish').click();
  await expect(page.locator('#battle-result')).toBeVisible();
};
const goldOf = (save) => save.state.world.finance.accounts.legacy_player_personal_account.balance;
const metricsOf = (save) => save.state.world.finance.accounts.legacy_player_personal_account.customData.m18CampaignMetrics;

test('[ui.battle.practice-changes-nothing] a practice battle changes nothing in the saved game and nothing on the campaign screen', async ({ page }) => {
  const problems = watch(page);
  const save = savedGame((state) => {
    state.world.finance.accounts.legacy_player_personal_account.balance = 777;
    state.clock.speed = 0;
  });
  await openWith(page, { [SAVE_KEY]: save }, fake('victory', '&routed=20'));
  const before = await storageDump(page);
  await page.locator('#btn-practice').click();
  await expect(page.locator('#fake-battle')).toHaveAttribute('data-mode', 'practice');
  await finishBattle(page);
  await expect(page.locator('#battle-result-title')).toHaveText('연습 승리');
  await expect(page.locator('#battle-result-message')).toContainText('기록되지 않습니다');
  await page.locator('#battle-result-ok').click();
  await expect(page.locator('#screen-menu')).toBeVisible();
  await expect(page.locator('#battle-host')).toBeHidden();
  expect(await storageDump(page)).toEqual(before);

  await startMainGame(page);
  expect(await hud(page)).toEqual({ gold: 777, food: 10, manpower: 0, territory: 0, day: 1 });
  expect(await storageDump(page)).toEqual(before);
  expect(problems).toEqual([]);
});

test('[ui.battle.practice-without-save-writes-nothing] practice with no saved game at all leaves storage empty', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, {}, fake('defeat'));
  await page.locator('#btn-practice').click();
  await finishBattle(page);
  await expect(page.locator('#battle-result-title')).toHaveText('전투 패배');
  await page.locator('#battle-result-ok').click();
  await expect(page.locator('#screen-menu')).toBeVisible();
  expect(await storageDump(page)).toEqual({});
  expect(problems).toEqual([]);
});

test('[ui.battle.campaign-victory-reward-once] a campaign victory adds 1500..2499 gold, 40% of the routed as manpower and one territory, once, and saves it', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, {}, fake('victory', '&routed=13&lord=1&double=1'));
  await startMainGame(page);
  await page.locator('#speed-0').click();
  expect(await hud(page)).toMatchObject({ gold: 500, manpower: 0, territory: 0 });
  await page.locator('#btn-battle').click();
  await expect(page.locator('#fake-battle')).toHaveAttribute('data-mode', 'campaign');
  await finishBattle(page);
  const message = page.locator('#battle-result-message');
  await expect(page.locator('#battle-result-title')).toHaveText('전투 승리');
  await expect(message).toContainText('획득한 인력: 5명');
  await expect(message).toContainText('점령한 영지: 1곳');
  await expect(message).toContainText('생포');
  await expect(page.locator('#battle-result')).toHaveCount(1);
  await page.locator('#battle-result-ok').click();
  await expect(page.locator('#battle-result')).toBeHidden();

  const after = await hud(page);
  expect(after.gold).toBeGreaterThanOrEqual(500 + 1500);
  expect(after.gold).toBeLessThanOrEqual(500 + 2499);
  expect(after.manpower).toBe(5);
  expect(after.territory).toBe(1);
  const reward = after.gold - 500;
  await expect(message).toHaveCount(0);

  const stored = await storedSave(page);
  expect(goldOf(stored)).toBe(after.gold);
  expect(metricsOf(stored)).toMatchObject({ manpower: 5, territory: 1 });
  // One transfer for the loot, however often the battle reported its end.
  const transfers = Object.values(stored.state.world.finance.transfers).filter((t) => t.reasonTypeId === 'battle_victory');
  expect(transfers).toHaveLength(1);
  expect(transfers[0].amount).toBe(reward);
  await page.waitForTimeout(300);
  expect((await hud(page)).gold).toBe(after.gold);
  await expect(page.locator('#save-status')).toHaveText('아직 저장하지 않았습니다.');
  expect(problems).toEqual([]);
});

test('[ui.battle.reward-save-failure-one-message] if the reward cannot be saved the page says so once and nothing changes, on screen or in storage', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, {}, fake('victory', '&routed=20'));
  await startMainGame(page);
  await page.locator('#speed-0').click();
  await page.locator('#btn-battle').click();
  await expect(page.locator('#fake-battle')).toBeVisible();
  // Another tab saves while the battle is going on.
  const other = savedGame(undefined, 9);
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [SAVE_KEY, other]);
  await page.locator('#fake-battle-finish').click();
  await expect(page.locator('#battle-result')).toBeVisible();
  await expect(page.locator('#battle-result-title')).toHaveText('전투에서 이겼지만 보상을 기록하지 못했습니다');
  const message = page.locator('#battle-result-message');
  await expect(message).toHaveCount(1);
  await expect(message).toHaveAttribute('data-kind', 'error');
  await expect(message).toContainText('save_conflict');
  await expect(message).toContainText('바뀌지 않았습니다');
  await expect(page.locator('[role="alert"], [data-kind="error"]')).toHaveCount(1);
  await page.locator('#battle-result-ok').click();
  expect(await hud(page)).toEqual({ gold: 500, food: 10, manpower: 0, territory: 0, day: 1 });
  expect((await storageDump(page))[SAVE_KEY]).toBe(other);
  await expect(page.locator('#save-status')).toHaveText('아직 저장하지 않았습니다.');
  await expect(page.locator('#battle-result')).toBeHidden();
  expect(problems).toEqual([]);
});

for (const [kind, title] of [['defeat', '전투 패배'], ['retreat', '퇴각'], ['surrender', '항복'], ['negotiated_retreat', '협상 후 퇴각']]) {
  test(`[ui.battle.${kind.replace('_', '-')}-changes-nothing] ${kind} in the campaign changes nothing and says honestly that nothing was recorded`, async ({ page }) => {
    const problems = watch(page);
    await openWith(page, {}, fake(kind));
    await startMainGame(page);
    await page.locator('#speed-0').click();
    await page.locator('#btn-save').click();
    await expect(page.locator('#save-status')).toContainText('저장했습니다');
    const before = await storageDump(page);
    await page.locator('#btn-battle').click();
    await finishBattle(page);
    await expect(page.locator('#battle-result-title')).toHaveText(title);
    await expect(page.locator('#battle-result-message')).toContainText(/바뀌지 않았|잃지 않았/);
    await expect(page.locator('#battle-result-message')).not.toContainText('빼앗');
    await page.locator('#battle-result-ok').click();
    expect(await hud(page)).toEqual({ gold: 500, food: 10, manpower: 0, territory: 0, day: 1 });
    expect(await storageDump(page)).toEqual(before);
    expect(problems).toEqual([]);
  });
}

test('[ui.battle.start-failure-shown] a battle that cannot start is reported in the page and the game goes on unchanged', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, {}, fake('throw'));
  await startMainGame(page);
  await page.locator('#speed-0').click();
  await page.locator('#btn-battle').click();
  await expect(page.locator('#battle-result-title')).toHaveText('전투를 마치지 못했습니다');
  await expect(page.locator('#battle-result-message')).toContainText('battle_start_failed');
  await expect(page.locator('#battle-result-message')).toContainText('아무것도 기록하지 않았습니다');
  await page.locator('#battle-result-ok').click();
  await expect(page.locator('#screen-world')).toBeVisible();
  expect(await hud(page)).toMatchObject({ gold: 500, territory: 0 });
  await expect(page.locator('#btn-battle')).toBeEnabled();
  expect(problems).toEqual([]);
});

test('[ui.battle.time-stops-during-battle] game time does not run while a battle is on and runs again afterwards', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, {}, fake('retreat'));
  await startMainGame(page);
  await page.locator('#speed-4').click();
  await page.locator('#btn-battle').click();
  await expect(page.locator('#fake-battle')).toBeVisible();
  const during = await page.locator('#time-label').innerText();
  await page.waitForTimeout(800);
  expect(await page.locator('#time-label').innerText()).toBe(during);
  await page.locator('#fake-battle-finish').click();
  await page.locator('#battle-result-ok').click();
  await expect.poll(() => page.locator('#time-label').innerText(), { timeout: 10_000 }).not.toBe(during);
  expect(problems).toEqual([]);
});
