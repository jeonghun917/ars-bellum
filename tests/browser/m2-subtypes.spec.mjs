// The mixed battle of subtypes (병종, m2/M2_UnitKinds.js) in the browser. Each test title starts with its check id
// from tests/checks.json.
import { test, expect } from '@playwright/test';
import { openBattle, snapshot, diagnostics, switchToTactical, noPageErrors, tap } from './m2-helpers.mjs';

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
  // The formations' row names each by its subtype; so does the row of enemies to attack.
  await tap(page, '#m2UnitsToggle');
  expect(await page.locator('#m2UnitStrip [data-formation="ally_line"]').getAttribute('aria-label')).toBe('방패병');
  expect(await page.locator('#m2UnitStrip [data-formation="ally_loose_2"]').getAttribute('aria-label')).toBe('장궁병');
  await tap(page, '#m2AttackOrder');
  expect(await page.locator('#m2EnemyPicker [data-formation="enemy_column"]').getAttribute('aria-label')).toBe('경기병');
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

test('[m2.subtypes.gear] each subtype shows its own weapons (javelins with the shield-bearers, axe or glaive with shock foot), and each man the armour and helmet he wears', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openBattle(page, '/m2_prototype.html?mixed');
  expect((await diagnostics(page)).soldierModel).toBe('blender');
  const s = await snapshot(page);
  // Soldiers of a subtype, not their commander nor the player (who wear their own equipment).
  const men = s.units.filter((u) => !u.commander && !u.isPlayer);
  const count = (test) => men.filter(test).length;
  const gear = (await diagnostics(page)).soldierGear;
  expect(gear.prop_javelins).toBe(count((u) => u.formationId === 'ally_line'));
  expect(gear.prop_axe).toBeGreaterThan(0);
  expect(gear.prop_glaive).toBeGreaterThan(0);
  expect(gear.prop_axe + gear.prop_glaive).toBe(count((u) => u.formationId === 'enemy_line'));
  // Armour and helmet: each man draws the one he wears, and only that one.
  for (const [armorId, mesh] of [['mail', 'gear_armor_mail'], ['leather', 'gear_armor_leather'], ['plate', 'gear_armor_plate']]) {
    expect(gear[mesh] || 0, mesh).toBe(count((u) => u.armorId === armorId));
  }
  expect(count((u) => u.armorId === 'plate')).toBe(count((u) => u.formationId === 'ally_column'));
  expect(gear.prop_greathelm).toBe(count((u) => u.helmId === 'great'));
  expect(gear.prop_leathercap).toBe(count((u) => u.helmId === 'leather'));
  expect(count((u) => u.helmId === 'leather')).toBeGreaterThan(0);
  // What the gear replaces stays hidden (the sword and its scabbard for the axe, the spear for the glaive,
  // the nasal helm under another helmet).
  for (const replaced of ['prop_sword', 'prop_sheath', 'prop_spear', 'prop_helm']) expect(gear[replaced] || 0, replaced).toBe(0);
  await noPageErrors(page, errors);
});

test('[m2.subtypes.swap-armor] a formation\'s armour and helmet can be changed in the launch snapshot', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openBattle(page);
  const loaded = await page.evaluate(async () => {
    const { buildScaleSnapshot } = await import('/m2/fixtures/m2_scale_fixture.js');
    const snapshot = buildScaleSnapshot({ perSide: 20, mixed: true });
    for (const f of snapshot.formations) if (f.formationId === 'ally_line') Object.assign(f, { armorId: 'plate', helmId: 'great' });
    for (const f of snapshot.formations) if (f.formationId === 'ally_column') Object.assign(f, { armorId: 'leather', helmId: 'leather' });
    return window.ArsM2Battle.loadSnapshot(snapshot);
  });
  expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
  const s = await snapshot(page);
  const line = s.units.filter((u) => u.formationId === 'ally_line' && !u.commander && !u.isPlayer);
  const horse = s.units.filter((u) => u.formationId === 'ally_column' && !u.commander);
  expect(line.every((u) => u.armorId === 'plate' && u.helmId === 'great')).toBe(true);
  expect(horse.every((u) => u.armorId === 'leather' && u.helmId === 'leather')).toBe(true);
  await expect.poll(async () => (await diagnostics(page)).soldierGear.gear_armor_plate || 0, { timeout: 30_000 }).toBe(line.length);
  await noPageErrors(page, errors);
});
