// 3D battle prototype checks. Each test title starts with its check id from tests/checks.json.
import { test, expect } from '@playwright/test';
import {
  openBattle, diagnostics, snapshot, player, formation, waitTicks, pointer, tap, switchToTactical, loadVariant, noPageErrors,
} from './m2-helpers.mjs';

// Allies start just short of their retreat edge (z >= 18); enemies stay well inside theirs (z <= -18),
// so only the ally side can finish by retreating.
const RETREAT_SETUP = `
  snapshot.battleId = 'test_retreat';
  for (const c of snapshot.characters) c.spawn = { ...c.spawn, z: c.sideId === 'ally' ? 17.7 : -12, heading: c.sideId === 'ally' ? 0 : Math.PI };
  for (const f of snapshot.formations) { f.anchor = { ...f.anchor, z: f.sideId === 'ally' ? 17.7 : -12 }; f.order = 'hold'; delete f.target; }
`;

// Puts the whole ally side in retreat and waits for the battle result.
async function finishByRetreat(page) {
  await loadVariant(page, RETREAT_SETUP);
  const issued = await page.evaluate(() => window.ArsM2Battle.getSnapshot().formations
    .filter((f) => f.sideId === 'ally')
    .map((f, i) => window.ArsM2Battle.issueCommand({ commandId: `retreat_${i}`, type: 'formation_retreat', formationId: f.formationId })));
  expect(issued.every((receipt) => receipt.ok), JSON.stringify(issued)).toBe(true);
  await page.waitForFunction(() => window.ArsM2Battle.getResult(), null, { timeout: 10_000 });
  return page.evaluate(() => window.ArsM2Battle.getResult());
}

test.describe('3D battle', () => {
  let errors;
  test.beforeEach(async ({ page }) => { errors = await openBattle(page); });

  test('[m2.render.webgl2] the battle canvas gets a WebGL2 context', async ({ page }) => {
    expect(await page.evaluate(() => !!document.getElementById('m2Canvas').getContext('webgl2'))).toBe(true);
  });

  test('[m2.render.all-units] all 40 units exist and are drawn', async ({ page }) => {
    const [s, g] = [await snapshot(page), await diagnostics(page)];
    expect(s.totalUnits).toBe(40);
    expect(g.renderedUnits).toBe(40);
  });

  test('[m2.camera.starts-third-person] the camera starts behind the player with input attached', async ({ page }) => {
    const g = await diagnostics(page);
    expect(g.cameraMode).toBe('third_person');
    expect(g.inputListenerCount).toBeGreaterThan(0);
  });

  test('[m2.player.move-key] holding W moves the player', async ({ page }) => {
    const before = (await player(page)).position;
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true })));
    await waitTicks(page, 2);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true })));
    const after = (await player(page)).position;
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(1e-4);
  });

  // Decision 2026-10-28: a sword swing costs its cooldown even when it hits nothing.
  test('[m2.player.melee-cooldown-on-miss] a sword swing with no enemy in reach still starts the cooldown', async ({ page }) => {
    await tap(page, '#m2Attack');
    await waitTicks(page, 1);
    expect((await player(page)).attackCooldownTicks).toBeGreaterThan(0);
  });

  test('[m2.player.block] block holds while pressed and ends on release', async ({ page }) => {
    await pointer(page, '#m2Block', 'pointerdown');
    await waitTicks(page, 1);
    const blocking = (await player(page)).blocking;
    await pointer(page, '#m2Block', 'pointerup');
    await waitTicks(page, 1);
    expect(blocking).toBe(true);
    expect((await player(page)).blocking).toBe(false);
  });

  test('[m2.player.bow] the bow button launches an arrow', async ({ page }) => {
    const before = (await diagnostics(page)).projectileLaunchCount;
    await tap(page, '#m2Bow');
    await waitTicks(page, 1);
    expect((await diagnostics(page)).projectileLaunchCount).toBeGreaterThan(before);
  });

  test('[m2.camera.tactical-switch] switching to the tactical view starts a new input context', async ({ page }) => {
    const before = (await diagnostics(page)).inputContextRevision;
    await switchToTactical(page);
    expect((await diagnostics(page)).inputContextRevision).toBe(before + 1);
  });

  test('[m2.orders.move-by-click] in tactical view a click on the field orders the selected formation to move', async ({ page }) => {
    await switchToTactical(page);
    const selected = await page.inputValue('#m2FriendlyFormation');
    const box = await page.locator('#m2Canvas').boundingBox();
    await tap(page, '#m2Canvas', { pointerId: 701, pointerType: 'mouse', clientX: box.x + box.width * 0.7, clientY: box.y + box.height * 0.55 });
    await waitTicks(page, 1);
    expect((await formation(page, selected)).order.type).toBe('move');
  });

  test('[m2.orders.attack] the attack order targets the enemy', async ({ page }) => {
    await switchToTactical(page);
    const selected = await page.inputValue('#m2FriendlyFormation');
    await tap(page, '#m2AttackOrder');
    await waitTicks(page, 1);
    expect((await formation(page, selected)).order.type).toBe('attack_target');
  });

  test('[m2.orders.formation-shape] line, column and loose buttons change the formation shape', async ({ page }) => {
    await switchToTactical(page);
    const selected = await page.inputValue('#m2FriendlyFormation');
    for (const [button, shape] of [['#m2Line', 'line'], ['#m2Column', 'column'], ['#m2Loose', 'loose']]) {
      await tap(page, button);
      await waitTicks(page, 1);
      expect((await formation(page, selected)).formationTypeId, button).toBe(shape);
    }
  });

  test('[m2.time.pause] time scale 0 stops the simulation and 1 resumes it', async ({ page }) => {
    await tap(page, '#m2Time0');
    const t0 = (await diagnostics(page)).fixedTickCount;
    await page.waitForTimeout(220);
    const t1 = (await diagnostics(page)).fixedTickCount;
    await tap(page, '#m2Time1');
    await waitTicks(page, 1);
    expect(t1).toBe(t0);
  });

  test('[m2.input.touch-release] touch stick and camera drag release every pointer', async ({ page }) => {
    const stick = await page.locator('#m2VirtualStick').boundingBox();
    const canvas = await page.locator('#m2Canvas').boundingBox();
    const middle = { clientX: stick.x + stick.width / 2, clientY: stick.y + stick.height / 2 };
    await pointer(page, '#m2VirtualStick', 'pointerdown', { pointerId: 801, ...middle });
    await pointer(page, '#m2VirtualStick', 'pointermove', { pointerId: 801, clientX: stick.x + stick.width - 2, clientY: middle.clientY });
    await waitTicks(page, 1);
    await pointer(page, '#m2VirtualStick', 'pointerup', { pointerId: 801 });
    for (const [type, dx] of [['pointerdown', 400], ['pointermove', 500], ['pointerup', 500]]) {
      await pointer(page, '#m2Canvas', type, { pointerId: 803, clientX: canvas.x + dx, clientY: canvas.y + 300 });
    }
    await expect.poll(async () => (await diagnostics(page)).activePointerCount).toBe(0);
  });

  test('[m2.lifecycle.dispose] dispose releases the battle, input and pointers', async ({ page }) => {
    await page.click('#m2Dispose');
    await expect.poll(async () => (await diagnostics(page)).cameraMode).toBe('disposed');
    const g = await diagnostics(page);
    expect(await snapshot(page)).toBeNull();
    expect(g.inputListenerCount).toBe(0);
    expect(g.activePointerCount).toBe(0);
  });

  test('[m2.lifecycle.restart-same-canvas] restart after dispose reuses the same canvas and reattaches input', async ({ page }) => {
    await page.evaluate(() => { window.__canvas = document.getElementById('m2Canvas'); });
    await page.click('#m2Dispose');
    await expect.poll(async () => (await diagnostics(page)).cameraMode).toBe('disposed');
    await page.click('#m2Restart');
    await page.waitForFunction(() => window.ArsM2Battle.getSnapshot()?.totalUnits === 40);
    await waitTicks(page, 1);
    expect(await page.evaluate(() => document.getElementById('m2Canvas') === window.__canvas)).toBe(true);
    expect((await diagnostics(page)).inputListenerCount).toBeGreaterThan(0);
  });

  test('[m2.hud.morale-matches-state] the morale and routing numbers on screen match the battle state', async ({ page }) => {
    await page.waitForTimeout(250);
    const [g, morale, routing] = await page.evaluate(() => [
      window.ArsM2Diagnostics.getSnapshot(),
      Number(document.getElementById('m2MoraleAlly').textContent),
      Number(document.getElementById('m2RoutingAlly').textContent),
    ]);
    expect(morale).toBe(g.moraleSummary.ally);
    expect(routing).toBe(g.routingCounts.ally);
  });

  test('[m2.orders.retreat-routs] the retreat order makes the formation withdraw and its units run away', async ({ page }) => {
    await switchToTactical(page);
    const selected = await page.inputValue('#m2FriendlyFormation');
    await tap(page, '#m2Retreat');
    await waitTicks(page, 1);
    const f = await formation(page, selected);
    expect(f.order.type).toBe('withdraw');
    const routing = await page.evaluate((ids) => {
      const units = window.ArsM2Battle.getSnapshot().units;
      return ids.map((id) => units.find((u) => u.unitId === id)).filter((u) => u.state === 'routing').map((u) => ({ id: u.unitId, z: u.position.z }));
    }, f.memberUnitIds);
    expect(routing.length).toBeGreaterThan(0);
    await waitTicks(page, 2);
    const z1 = await page.evaluate((id) => window.ArsM2Battle.getSnapshot().units.find((u) => u.unitId === id).position.z, routing[0].id);
    expect(z1).toBeGreaterThan(routing[0].z);
  });

  test('[m2.orders.rally] the rally order brings routing units back', async ({ page }) => {
    await switchToTactical(page);
    await tap(page, '#m2Retreat');
    await waitTicks(page, 3);
    const before = (await diagnostics(page)).routingCounts.ally;
    await tap(page, '#m2Rally');
    await waitTicks(page, 2);
    expect(before).toBeGreaterThan(0);
    expect((await diagnostics(page)).routingCounts.ally).toBeLessThan(before);
  });

  test('[m2.runtime.isolation] the runtime owns the animation loop and touches no network or saved data', async ({ page }) => {
    const g = await diagnostics(page);
    expect(g.animationOwner).toBe('M2BattleRuntime');
    expect(g.runtimeNetworkImport).toBeFalsy();
    expect(g.persistenceAccess).toBeFalsy();
  });

  test('[m2.result.retreat-outcome] a full ally retreat ends the battle as ally_retreat and shows it', async ({ page }) => {
    const result = await finishByRetreat(page);
    expect(result.outcome).toBe('ally_retreat');
    await expect(page.locator('#m2Result')).toHaveText(result.outcome);
    expect((await diagnostics(page)).status).toBe('finalized');
  });

  test('[m2.result.rejects-commands] after the result, commands are refused and nothing changes', async ({ page }) => {
    await finishByRetreat(page);
    const { rejected, same } = await page.evaluate(() => {
      const before = JSON.stringify(window.ArsM2Battle.getSnapshot());
      const formationId = window.ArsM2Battle.getSnapshot().formations.find((f) => f.sideId === 'ally').formationId;
      const rejected = window.ArsM2Battle.issueCommand({ commandId: 'after_result', type: 'formation_hold', formationId });
      return { rejected, same: before === JSON.stringify(window.ArsM2Battle.getSnapshot()) };
    });
    expect(rejected).toMatchObject({ ok: false, error: 'm2_command_battle_finalized' });
    expect(same).toBe(true);
  });

  test('[m2.result.immutable] the final result cannot be changed', async ({ page }) => {
    await finishByRetreat(page);
    const { same, frozen } = await page.evaluate(() => {
      const result = window.ArsM2Battle.getResult();
      const before = JSON.stringify(result);
      try { result.outcome = 'enemy_victory'; } catch { /* frozen objects throw in strict code */ }
      return { same: before === JSON.stringify(window.ArsM2Battle.getResult()), frozen: Object.isFrozen(window.ArsM2Battle.getResult()) };
    });
    expect(same).toBe(true);
    expect(frozen).toBe(true);
  });

  test('[m2.result.stops-simulation] after the result, start and time-scale are refused and ticks stop', async ({ page }) => {
    await finishByRetreat(page);
    const tick = (await diagnostics(page)).fixedTickCount;
    const { start, scale } = await page.evaluate(() => ({ start: window.ArsM2Battle.start(), scale: window.ArsM2Battle.setTimeScale(1) }));
    await page.waitForTimeout(300);
    expect((await diagnostics(page)).fixedTickCount).toBe(tick);
    expect(start).toMatchObject({ ok: false, error: 'm2_runtime_finalized' });
    expect(scale).toMatchObject({ ok: false, error: 'm2_runtime_finalized' });
  });

  test('[m2.lifecycle.restart-after-result] restart after a result clears it on the same canvas', async ({ page }) => {
    await finishByRetreat(page);
    const listeners = (await diagnostics(page)).inputListenerCount;
    await page.evaluate(() => { window.__canvas = document.getElementById('m2Canvas'); });
    await page.click('#m2Restart');
    await page.waitForFunction(() => window.ArsM2Battle.getResult() === null && window.ArsM2Battle.getSnapshot()?.totalUnits === 40);
    await waitTicks(page, 1);
    expect(await page.evaluate(() => document.getElementById('m2Canvas') === window.__canvas)).toBe(true);
    expect((await diagnostics(page)).inputListenerCount).toBe(listeners);
  });

  test('[m2.result.no-enemies-victory] a battle with no enemies is an ally victory with enemy morale 0', async ({ page }) => {
    await loadVariant(page, `
      snapshot.battleId = 'test_zero_enemy';
      snapshot.characters = snapshot.characters.filter((c) => c.sideId === 'ally');
      const ids = new Set(snapshot.characters.map((c) => c.characterId));
      snapshot.formations = snapshot.formations.filter((f) => f.sideId === 'ally')
        .map((f) => ({ ...f, memberUnitIds: f.memberUnitIds.filter((id) => ids.has(id)) }));
    `);
    await page.waitForFunction(() => window.ArsM2Battle.getResult(), null, { timeout: 5_000 });
    await page.waitForTimeout(220);
    const [result, g, shown] = await page.evaluate(() => [
      window.ArsM2Battle.getResult(), window.ArsM2Diagnostics.getSnapshot(), Number(document.getElementById('m2MoraleEnemy').textContent),
    ]);
    expect(result.outcome).toBe('ally_victory');
    expect(g.moraleSummary.enemy).toBe(0);
    expect(shown).toBe(0);
  });

  test('[m2.page.no-errors] loading and playing the battle raises no page errors', async ({ page }) => {
    await tap(page, '#m2Attack');
    await tap(page, '#m2Bow');
    await waitTicks(page, 5);
    await noPageErrors(page, errors);
  });
});
