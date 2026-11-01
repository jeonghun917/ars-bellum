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
  await page.waitForFunction(() => window.ArsM2Battle.getResult(), null, { timeout: 20_000 });
  return page.evaluate(() => window.ArsM2Battle.getResult());
}

// The sword cooldown lasts only half a second (10 ticks), so it is watched on every animation frame;
// sampling it after a tick wait can miss it on a slow machine.
async function swingCooldownSeen(page) {
  await page.waitForFunction(() => {
    const s = window.ArsM2Battle.getSnapshot();
    return s.units.find((u) => u.unitId === s.playerCharacterId).attackCooldownTicks > 0;
  }, null, { polling: 'raf', timeout: 20_000 });
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

  test('[m2.render.soldier-models] the soldiers are drawn with the rigged Blender models, both sides, with their animations', async ({ page }) => {
    expect((await diagnostics(page)).soldierModel).toBe('blender');
    const models = await page.evaluate(async () => {
      const { loadSoldierModels } = await import('/m2/M2_SoldierModels.js');
      const loaded = await loadSoldierModels();
      return Object.fromEntries(Object.entries(loaded).map(([side, model]) => {
        let skinned = 0;
        model.scene.traverse((object) => { if (object.isSkinnedMesh) skinned += 1; });
        let horse = 0;
        model.horse.scene.traverse((object) => { if (object.isSkinnedMesh) horse += 1; });
        return [side, { skinned, clips: Object.keys(model.clips).sort(), gait: model.gait,
          horse: { skinned: horse, clips: Object.keys(model.horse.clips).sort(), gait: model.horse.gait } }];
      }));
    });
    for (const side of ['ally', 'enemy']) {
      expect(models[side].skinned).toBeGreaterThan(0);
      expect(models[side].clips).toEqual([
        'attack', 'attack_over', 'block', 'death', 'draw', 'f_block', 'f_death', 'f_idle', 'f_overhead', 'f_run',
        'f_swing_l', 'f_swing_r', 'f_thrust', 'f_walk', 'idle', 'low_idle', 'low_run', 'low_walk', 'm_attack',
        'm_block', 'm_death', 'm_gallop', 'm_idle', 'm_trot', 'm_walk', 'ms_block', 'ms_death', 'ms_gallop',
        'ms_idle', 'ms_swing', 'ms_trot', 'ms_walk', 'n_attack', 'n_attack_over', 'n_block', 'n_death', 'n_idle',
        'n_run', 'n_walk', 'run', 's_block', 's_death', 's_idle', 's_low_idle', 's_low_run', 's_low_walk',
        's_overhead', 's_run', 's_swing_l', 's_swing_r', 's_thrust', 's_walk', 't_block', 't_death', 't_idle',
        't_overhead', 't_run', 't_swing_l', 't_swing_r', 't_thrust', 't_walk', 'walk', 'x_block', 'x_death',
        'x_idle', 'x_reload', 'x_run', 'x_shoot', 'x_walk',
      ]);
      // The walk and run clips say how fast their feet move, so the renderer can match the soldiers' speed.
      expect(models[side].gait.walk).toBeGreaterThan(0.5);
      expect(models[side].gait.run).toBeGreaterThan(models[side].gait.walk);
      // The horse the side's horsemen ride, with its gaits and their speeds.
      expect(models[side].horse.skinned).toBeGreaterThan(0);
      expect(models[side].horse.clips).toEqual(['death', 'gallop', 'idle', 'trot', 'walk']);
      expect(models[side].horse.gait.trot).toBeGreaterThan(models[side].horse.gait.walk);
    }
  });

  test('[m2.render.cavalry] the horsemen ride drawn horses that gallop with them when they charge', async ({ page }) => {
    // 7 horsemen a side, each on a horse standing at the start.
    await expect.poll(async () => (await diagnostics(page)).horseAnimations?.idle || 0).toBe(14);
    const receipt = await page.evaluate(() => window.ArsM2Battle.issueCommand({
      commandId: 'charge', type: 'formation_attack', formationId: 'ally_column', targetFormationId: 'enemy_line' }));
    expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
    // Horse and rider gallop together (the rider's "m_gallop"/"ms_gallop" rides the horse's "gallop").
    await page.waitForFunction(() => {
      const g = window.ArsM2Diagnostics.getSnapshot();
      return (g.horseAnimations.gallop || 0) > 0 && ((g.soldierAnimations.m_gallop || 0) + (g.soldierAnimations.ms_gallop || 0)) > 0;
    }, null, { polling: 'raf', timeout: 30_000 });
    await expect.poll(async () => (await diagnostics(page)).chargeHitCount, { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test('[m2.render.crossbow] crossbowmen ordered to attack shoot bolts by themselves', async ({ page }) => {
    const s = await snapshot(page);
    const enemyHp = s.units.filter((u) => u.sideId === 'enemy').reduce((sum, u) => sum + u.hp, 0);
    const receipt = await page.evaluate(() => window.ArsM2Battle.issueCommand({
      commandId: 'volley', type: 'formation_attack', formationId: 'ally_loose', targetFormationId: 'enemy_line' }));
    expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
    await expect.poll(async () => (await diagnostics(page)).crossbowLaunchCount, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await snapshot(page)).units.filter((u) => u.sideId === 'enemy').reduce((sum, u) => sum + u.hp, 0),
      { timeout: 30_000 }).toBeLessThan(enemyHp);
  });

  test('[m2.render.soldier-gait] soldiers crossing the field run, and walk only to settle into place', async ({ page }) => {
    // Sent 15 m forward, the ally foot soldiers run (3.2 m/s; the walk clip's feet move at about 1.3 m/s, so
    // walking would skate), then walk the last few metres.
    const receipt = await page.evaluate(() => {
      const f = window.ArsM2Battle.getSnapshot().formations.find((item) => item.formationId === 'ally_line');
      return window.ArsM2Battle.issueCommand({ commandId: 'gait_move', type: 'formation_move', formationId: f.formationId,
        target: { x: f.anchor.x, z: f.anchor.z - 15 } });
    });
    expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
    // (The check runs in the page, so the clip pattern is passed in. Run clips are "run", "low_run",
    // "s_low_run", ...; walk clips likewise.)
    const playing = (pattern) => Object.entries(window.ArsM2Diagnostics.getSnapshot().soldierAnimations || {})
      .some(([clip, count]) => new RegExp(pattern).test(clip) && count > 0);
    await page.waitForFunction(playing, 'run$', { polling: 'raf', timeout: 20_000 });
    await page.waitForFunction(playing, 'walk$', { polling: 'raf', timeout: 30_000 });
  });

  test('[m2.render.shield-low] with no enemy near, soldiers carry their shields low at their side', async ({ page }) => {
    // The armies start more than 12 m apart: shields are carried low until an enemy comes within 9 m.
    await page.waitForFunction(() => Object.entries(window.ArsM2Diagnostics.getSnapshot().soldierAnimations || {})
      .some(([clip, count]) => /^(s_)?low_/.test(clip) && count > 0), null, { timeout: 20_000 });
  });

  test('[m2.ai.enemy-fights-back] once attacked, the enemy army is ordered into the fight and moves', async ({ page }) => {
    // Left alone, the enemy holds.
    await waitTicks(page, 25);
    expect((await diagnostics(page)).enemyAwake).toBe(false);
    expect((await snapshot(page)).formations.filter((f) => f.sideId === 'enemy').every((f) => f.order.type === 'hold')).toBe(true);
    const receipt = await page.evaluate(() => window.ArsM2Battle.issueCommand({
      commandId: 'provoke', type: 'formation_attack', formationId: 'ally_line', targetFormationId: 'enemy_line' }));
    expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
    await expect.poll(async () => (await diagnostics(page)).enemyAwake, { timeout: 20_000 }).toBe(true);
    const enemies = (s) => s.units.filter((u) => u.sideId === 'enemy').map((u) => `${u.position.x.toFixed(2)},${u.position.z.toFixed(2)}`).join(';');
    const s = await snapshot(page);
    expect(s.formations.filter((f) => f.sideId === 'enemy').every((f) => f.order.type === 'attack_target')).toBe(true);
    const before = enemies(s);
    await expect.poll(async () => enemies(await snapshot(page)), { timeout: 20_000 }).not.toBe(before);
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
    await swingCooldownSeen(page);
  });

  test('[m2.player.melee-hit] a sword swing with an enemy in reach damages it', async ({ page }) => {
    // Put one enemy one metre in front of the player (reach 1.6 m, 120 degree arc) and keep every
    // formation holding still, so the enemy is still in reach when the swing happens even on a busy machine.
    await loadVariant(page, `
      snapshot.battleId = 'test_melee_hit';
      const me = snapshot.characters.find((c) => c.characterId === snapshot.playerCharacterId);
      const commanders = new Set(snapshot.formations.map((f) => f.commanderUnitId));
      const foe = snapshot.characters.find((c) => c.sideId === 'enemy' && !commanders.has(c.characterId));
      const heading = me.spawn.heading ?? 0;
      foe.spawn = { ...foe.spawn, x: me.spawn.x + Math.sin(heading), z: me.spawn.z + Math.cos(heading) };
      foe.formationId = 'test_lone_foe';
      for (const f of snapshot.formations) { f.order = 'hold'; delete f.target; }
      const foeFormation = snapshot.formations.find((f) => f.memberUnitIds.includes(foe.characterId));
      foeFormation.memberUnitIds = foeFormation.memberUnitIds.filter((id) => id !== foe.characterId);
      foeFormation.anchor = { ...foeFormation.anchor, z: -30 };
      snapshot.formations.push({ ...foeFormation, formationId: 'test_lone_foe', memberUnitIds: [foe.characterId],
        commanderUnitId: foe.characterId, anchor: { ...foeFormation.anchor, x: foe.spawn.x, z: foe.spawn.z } });
      window.__foeId = foe.characterId;
    `);
    await page.evaluate(() => window.ArsM2Battle.setTimeScale(0));
    const foeId = await page.evaluate(() => window.__foeId);
    const unit = (id) => page.evaluate((unitId) => window.ArsM2Battle.getSnapshot().units.find((u) => u.unitId === unitId), id);
    const [me, foe] = [await player(page), await unit(foeId)];
    expect(Math.hypot(foe.position.x - me.position.x, foe.position.z - me.position.z)).toBeLessThan(1.6);
    await tap(page, '#m2Attack');
    await page.evaluate(() => window.ArsM2Battle.setTimeScale(1));
    await swingCooldownSeen(page);
    expect((await unit(foeId)).hp).toBeLessThan(foe.hp);
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

  test('[m2.orders.tactic] the order list offers the selected formation\'s orders, and choosing one gives it', async ({ page }) => {
    await switchToTactical(page);
    const selected = await page.inputValue('#m2FriendlyFormation');
    expect(selected).toBe('ally_line');
    // Charge any formation can be given; an ordinary commander (tactics 30) adds one: braced spears.
    expect(await page.locator('#m2Tactic option').allTextContents()).toEqual(['없음', '돌격', '장창 대기']);
    await page.selectOption('#m2Tactic', 'spear_brace');
    await waitTicks(page, 1);
    expect((await formation(page, selected)).tactic).toBe('spear_brace');
    await page.selectOption('#m2Tactic', '');
    await waitTicks(page, 1);
    expect((await formation(page, selected)).tactic).toBe(null);
  });

  test('[m2.orders.plan] the plan list offers the battle plans the army can use, and choosing one puts it to work', async ({ page }) => {
    await switchToTactical(page);
    // Ordinary commanders (tactics 30): frontal push and two plans, for foot, horse and crossbows.
    expect(await page.locator('#m2Plan option').allTextContents()).toEqual(['없음', '정면 압박', '모루와 망치', '견제 후 돌격']);
    await page.selectOption('#m2Plan', 'anvil_hammer');
    await waitTicks(page, 2);
    const s = await snapshot(page);
    expect(s.plans.ally.planId).toBe('anvil_hammer');
    expect(s.formations.filter((f) => f.sideId === 'ally').every((f) => f.underPlan && f.order.type === 'attack_target')).toBe(true);
  });

  test('[m2.orders.formation-shape] line, column and loose buttons change the formation shape', async ({ page }) => {
    await switchToTactical(page);
    const selected = await page.inputValue('#m2FriendlyFormation');
    for (const [button, shape] of [['#m2Line', 'line'], ['#m2Column', 'column'], ['#m2Loose', 'loose'],
      ['#m2ShieldWall', 'shield_wall'], ['#m2Wedge', 'wedge'], ['#m2Circle', 'circle']]) {
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
    // The screen is redrawn every 200 ms but the state changes every frame, so stop the clock first.
    await page.waitForTimeout(250);
    expect((await page.evaluate(() => window.ArsM2Battle.setTimeScale(0))).ok).toBe(true);
    await page.waitForTimeout(450);
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
    await page.waitForFunction(() => window.ArsM2Battle.getResult(), null, { timeout: 20_000 });
    const [result, g] = await page.evaluate(() => [window.ArsM2Battle.getResult(), window.ArsM2Diagnostics.getSnapshot()]);
    expect(result.outcome).toBe('ally_victory');
    expect(g.moraleSummary.enemy).toBe(0);
    // The screen is redrawn every 200 ms, so wait for the redraw rather than a fixed time.
    await expect(page.locator('#m2MoraleEnemy')).toHaveText('0');
  });

  test('[m2.page.no-errors] loading and playing the battle raises no page errors', async ({ page }) => {
    await tap(page, '#m2Attack');
    await tap(page, '#m2Bow');
    await waitTicks(page, 5);
    await noPageErrors(page, errors);
  });
});
