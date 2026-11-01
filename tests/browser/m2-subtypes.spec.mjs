// The mixed battle of subtypes (병종, m2/M2_UnitKinds.js) in the browser. Each test title starts with its check id
// from tests/checks.json.
import { test, expect } from '@playwright/test';
import { openBattle, snapshot, switchToTactical, noPageErrors } from './m2-helpers.mjs';

test('[m2.subtypes.mixed-page] m2_prototype.html?mixed opens a battle of subtypes, named in the formation lists, and fights it', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await openBattle(page, '/m2_prototype.html?mixed');
  const s = await snapshot(page);
  expect(s.units.length).toBe(80);
  const types = Object.fromEntries(s.formations.map((f) => [f.formationId, f.unitTypeId]));
  expect(types).toEqual({
    ally_line: 'shield', ally_line_2: 'pike', ally_loose: 'crossbow', ally_loose_2: 'longbow', ally_column: 'heavy_cav',
    enemy_line: 'shock', enemy_line_2: 'pike', enemy_loose: 'longbow', enemy_loose_2: 'crossbow', enemy_column: 'light_cav',
  });
  await switchToTactical(page);
  const friendly = await page.locator('#m2FriendlyFormation option').allTextContents();
  expect(friendly).toContain('ally_line (방패병)');
  expect(friendly).toContain('ally_loose_2 (장궁병)');
  expect(await page.locator('#m2EnemyFormation option').allTextContents()).toContain('enemy_column (경기병)');
  // Sent in, both sides fight: blows land and bolts fly.
  await page.evaluate(() => {
    for (const f of window.ArsM2Battle.getSnapshot().formations.filter((x) => x.sideId === 'ally')) {
      window.ArsM2Battle.issueCommand({ commandId: `go_${f.formationId}`, type: 'formation_attack', formationId: f.formationId, targetFormationId: f.formationId.replace('ally', 'enemy') });
    }
  });
  // (80 men drawn in software in CI: slow frames, so a long wait; it checks that they fight, not how fast.)
  const start = s.units.reduce((sum, u) => sum + u.hp, 0);
  await expect.poll(async () => (await snapshot(page)).units.reduce((sum, u) => sum + u.hp, 0), { timeout: 150_000, intervals: [2000] }).toBeLessThan(start);
  await noPageErrors(page, errors);
});
