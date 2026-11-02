// The fog of war on the screen (m2/M2_Vision.js, M2_RendererThree.js): an enemy out of the player's side's
// sight is drawn faded where it was last seen, and solid again once seen. Each test title starts with its
// check id from tests/checks.json.
import { test, expect } from '@playwright/test';
import { openBattle, diagnostics, loadVariant, noPageErrors } from './m2-helpers.mjs';

test('[m2.vision.faded] an enemy out of sight is drawn faded where it was last seen, and solid again when the player\'s men come near', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openBattle(page);
  // The enemy horse drawn up 40 m off to the side, beyond every ally's sight.
  await loadVariant(page, `
    for (const c of snapshot.characters) if (snapshot.formations.find((f) => f.formationId === 'enemy_column').memberUnitIds.includes(c.characterId)) c.spawn.x += 40;
    snapshot.formations.find((f) => f.formationId === 'enemy_column').anchor.x += 40;
  `);
  const horse = await page.evaluate(() => window.ArsM2Battle.getSnapshot().formations.find((f) => f.formationId === 'enemy_column').memberUnitIds.length);
  await expect.poll(async () => (await diagnostics(page)).fadedSoldiers, { timeout: 30_000 }).toEqual({ drawn: horse, hidden: 0 });
  expect((await diagnostics(page)).sight.enemyFaded).toBe(horse);
  // The ally horse sent at them ride up, see them, and they are drawn as they are.
  await page.evaluate(() => window.ArsM2Battle.issueCommand({ commandId: 'see_them', type: 'formation_attack', formationId: 'ally_column', targetFormationId: 'enemy_column' }));
  await expect.poll(async () => (await diagnostics(page)).fadedSoldiers.drawn, { timeout: 120_000, intervals: [1000] }).toBe(0);
  expect((await diagnostics(page)).sight.enemyFaded).toBe(0);
  await noPageErrors(page, errors);
});
