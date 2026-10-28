// Browser checks of the 2D battle on its dev page (battle2d.html). Each test title starts with its check id.
import { test, expect } from '@playwright/test';

// Tracks what the page does around the battle: Math.random calls, pending animation frames, timers and
// event listeners on the window, the document and the container, so a test can see what dispose() left behind.
const PROBE = () => {
  const probe = { randomCalls: 0, frames: new Set(), timers: new Set(), listeners: new Map() };
  window.__probe = probe;
  const random = Math.random;
  Math.random = function probedRandom() {
    probe.randomCalls += 1;
    return random.call(Math);
  };
  const raf = window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    const id = raf((time) => {
      probe.frames.delete(id);
      callback(time);
    });
    probe.frames.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    probe.frames.delete(id);
    caf(id);
  };
  for (const name of ['setTimeout', 'setInterval']) {
    const original = window[name].bind(window);
    window[name] = (callback, delay, ...rest) => {
      const id = original((...args) => {
        if (name === 'setTimeout') probe.timers.delete(id);
        callback(...args);
      }, delay, ...rest);
      probe.timers.add(id);
      return id;
    };
  }
  window.clearTimeout = ((original) => (id) => {
    probe.timers.delete(id);
    original(id);
  })(window.clearTimeout.bind(window));
  window.clearInterval = ((original) => (id) => {
    probe.timers.delete(id);
    original(id);
  })(window.clearInterval.bind(window));
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const keyOf = (type, listener, options) => `${type}|${typeof options === 'object' ? Boolean(options && options.capture) : Boolean(options)}|${listener && listener.__id}`;
  let nextId = 1;
  EventTarget.prototype.addEventListener = function probedAdd(type, listener, options) {
    if (listener && !listener.__id && typeof listener === 'function') Object.defineProperty(listener, '__id', { value: nextId++ });
    if (!probe.listeners.has(this)) probe.listeners.set(this, new Set());
    probe.listeners.get(this).add(keyOf(type, listener, options));
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function probedRemove(type, listener, options) {
    if (probe.listeners.has(this)) probe.listeners.get(this).delete(keyOf(type, listener, options));
    return remove.call(this, type, listener, options);
  };
};

// Loads the dev page with the given settings and collects page errors, console errors and dialogs.
async function openBattle(page, query = '', { started = true } = {}) {
  const problems = [];
  const dialogs = [];
  const navigations = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  await page.addInitScript(PROBE);
  await page.goto(`/battle2d.html?${query}`);
  if (started) await page.waitForSelector('[data-b2d="root"]');
  else await page.waitForSelector('body[data-state="idle"]');
  return { problems, dialogs, navigations };
}

// Waits for two animation frames, so the HUD has caught up with the last click before a "not selected" check.
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const hud = (page, name) => page.locator(`[data-b2d="${name}"]`);
const chip = (page, id) => page.locator(`[data-b2d="squad"][data-squad-id="${id}"]`);
const endCount = (page) => page.evaluate(() => Number(document.body.dataset.endCount));
const endResult = (page) => page.evaluate(() => JSON.parse(document.body.dataset.result));

// Where a world point (the centre of the map is 0, 0, zoom 1) is on the page.
async function screenPoint(page, worldX, worldY, zoom = 1, pan = { x: 0, y: 0 }) {
  const box = await page.locator('[data-b2d="canvas"]').boundingBox();
  return { x: box.x + box.width / 2 + (worldX + pan.x) * zoom, y: box.y + box.height / 2 + (worldY + pan.y) * zoom };
}

// A small fast battle that the allies win by standing still: the enemy comes to them.
const WINNABLE = 'terrain=flat&seed=7&allySquads=shock,shock&enemySquads=skirmisher&timeScale=8';

test('[battle2d.page.loads-clean] the dev page loads, draws the battlefield and its controls, and raises no errors', async ({ page }) => {
  const { problems, dialogs } = await openBattle(page, 'seed=3');
  await expect(hud(page, 'canvas')).toBeVisible();
  await expect(hud(page, 'start')).toBeVisible();
  await expect(page.locator('[data-b2d="squad"]')).toHaveCount(6);
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector('[data-b2d="canvas"]');
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const colours = new Set();
    for (let i = 0; i < data.length; i += 4 * 997) colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return { width: canvas.width, height: canvas.height, colours: colours.size };
  });
  expect(painted.width).toBeGreaterThan(300);
  expect(painted.colours).toBeGreaterThan(3);
  await page.waitForTimeout(800);
  expect(problems).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('[battle2d.page.deploy-and-start] squads can be moved while deploying, nothing fights, and the start button begins the battle', async ({ page }) => {
  await openBattle(page, 'terrain=flat&seed=2&timeScale=4');
  await expect(hud(page, 'prep')).toBeVisible();
  await expect(page.locator('[data-b2d="root"]')).toHaveAttribute('data-phase', 'preparation');
  const start = { x: Number(await chip(page, 'ally-1').getAttribute('data-x')), y: Number(await chip(page, 'ally-1').getAttribute('data-y')) };
  await page.mouse.click(...Object.values(await screenPoint(page, -200, -50)));
  await expect(chip(page, 'ally-1')).toHaveAttribute('data-selected', 'true');
  await page.mouse.click(...Object.values(await screenPoint(page, -100, 90)));
  await expect.poll(async () => Number(await chip(page, 'ally-1').getAttribute('data-y')), { timeout: 8000 }).toBeGreaterThan(start.y + 60);
  await expect(page.locator('[data-b2d="root"]')).toHaveAttribute('data-phase', 'preparation');
  await expect(chip(page, 'ally-1')).toHaveAttribute('data-units', '12');
  await hud(page, 'start').click();
  await expect(page.locator('[data-b2d="root"]')).toHaveAttribute('data-phase', 'fighting');
  await expect(hud(page, 'prep')).toBeHidden();
  await expect(hud(page, 'status')).toContainText('전투 중');
});

test.describe('mouse', () => {
  test('[battle2d.page.mouse-select-move] a mouse click selects a squad, a click on ground moves it, dragging pans, a right drag selects a box', async ({ page }) => {
    const { problems } = await openBattle(page, 'terrain=flat&seed=2&timeScale=4');
    await page.mouse.click(...Object.values(await screenPoint(page, -200, 100)));
    await expect(chip(page, 'ally-2')).toHaveAttribute('data-selected', 'true');
    await settle(page);
    await expect(chip(page, 'ally-1')).toHaveAttribute('data-selected', 'false');
    await expect(hud(page, 'command-bar')).toBeVisible();
    const before = Number(await chip(page, 'ally-2').getAttribute('data-y'));
    await page.mouse.click(...Object.values(await screenPoint(page, -200, 250)));
    await expect.poll(async () => Number(await chip(page, 'ally-2').getAttribute('data-y')), { timeout: 8000 }).toBeGreaterThan(before + 60);

    // Dragging the ground pans the view: the squad that was at world (-200,-50) is now 120 px to the right.
    await hud(page, 'cmd-deselect').click();
    const from = await screenPoint(page, 100, 250);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y, { steps: 4 });
    await page.mouse.move(from.x + 120, from.y, { steps: 4 });
    await page.mouse.up();
    await settle(page);
    await expect(chip(page, 'ally-1')).toHaveAttribute('data-selected', 'false');
    await page.mouse.click(...Object.values(await screenPoint(page, -200, -50, 1, { x: 120, y: 0 })));
    await expect(chip(page, 'ally-1')).toHaveAttribute('data-selected', 'true');

    // The wheel zooms around the pointer (here the screen centre), so the view is about twice as close.
    await hud(page, 'cmd-deselect').click();
    const centre = await screenPoint(page, 0, 0);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, -460);
    await page.waitForTimeout(150);
    const zoom = Math.exp(460 * 0.0015);
    await page.mouse.click(...Object.values(await screenPoint(page, -300, 100, 1, { x: 120, y: 0 })));
    await settle(page);
    await expect(chip(page, 'ally-4')).toHaveAttribute('data-selected', 'false');
    await page.mouse.click(...Object.values(await screenPoint(page, -300, 100, zoom, { x: 120, y: 0 })));
    await expect(chip(page, 'ally-4')).toHaveAttribute('data-selected', 'true');
    expect(problems).toEqual([]);
  });

  test('[battle2d.page.mouse-right-drag-box] a right-button drag with nothing selected selects the squads inside the box', async ({ page }) => {
    await openBattle(page, 'terrain=flat&seed=2');
    const a = await screenPoint(page, -260, -120);
    const b = await screenPoint(page, -140, 180);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up({ button: 'right' });
    await expect(chip(page, 'ally-1')).toHaveAttribute('data-selected', 'true');
    await expect(chip(page, 'ally-2')).toHaveAttribute('data-selected', 'true');
    await settle(page);
    await expect(chip(page, 'ally-3')).toHaveAttribute('data-selected', 'false');
  });
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('[battle2d.page.touch-select-move] a tap selects a squad, a tap on ground moves it, one finger pans, two fingers zoom', async ({ page }) => {
    const { problems } = await openBattle(page, 'terrain=flat&seed=2&timeScale=4');
    await page.touchscreen.tap(...Object.values(await screenPoint(page, -200, 100)));
    await expect(chip(page, 'ally-2')).toHaveAttribute('data-selected', 'true');
    const before = Number(await chip(page, 'ally-2').getAttribute('data-y'));
    await page.touchscreen.tap(...Object.values(await screenPoint(page, -200, 250)));
    await expect.poll(async () => Number(await chip(page, 'ally-2').getAttribute('data-y')), { timeout: 8000 }).toBeGreaterThan(before + 60);

    await hud(page, 'cmd-deselect').click();
    const client = await page.context().newCDPSession(page);
    const touch = async (type, points) => client.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })) });
    // One finger drags the ground 100 px to the right.
    await touch('touchStart', [{ x: 900, y: 450 }]);
    await touch('touchMove', [{ x: 950, y: 450 }]);
    await touch('touchMove', [{ x: 1000, y: 450 }]);
    await touch('touchEnd', []);
    await page.touchscreen.tap(...Object.values(await screenPoint(page, -200, -50, 1, { x: 100, y: 0 })));
    await expect(chip(page, 'ally-1')).toHaveAttribute('data-selected', 'true');

    // Two fingers pinch the view out. A pinch is not a tap, so the selected squad is given no orders.
    const centre = await screenPoint(page, 0, 0);
    await touch('touchStart', [{ x: centre.x - 50, y: centre.y }, { x: centre.x + 50, y: centre.y }]);
    await touch('touchMove', [{ x: centre.x - 100, y: centre.y }, { x: centre.x + 100, y: centre.y }]);
    await touch('touchEnd', []);
    await page.waitForTimeout(150);
    await expect(chip(page, 'ally-1')).toHaveAttribute('data-waypoints', '0');
    // Zoom is 2 now (100 px apart became 200 px); the squad is where the zoomed, panned view puts it.
    await hud(page, 'cmd-deselect').click();
    await page.touchscreen.tap(...Object.values(await screenPoint(page, -200, -50, 2, { x: 100, y: 0 })));
    await expect(chip(page, 'ally-1')).toHaveAttribute('data-selected', 'true');
    expect(problems).toEqual([]);
  });
});

test('[battle2d.page.win-calls-onend-once] winning ends the battle in its own HUD and calls onEnd once with a victory, without any alert', async ({ page }) => {
  const { problems, dialogs } = await openBattle(page, WINNABLE);
  await hud(page, 'start').click();
  await expect.poll(() => endCount(page), { timeout: 25_000 }).toBe(1);
  const result = await endResult(page);
  expect(result.outcome).toBe('victory');
  expect(Object.keys(result).sort()).toEqual(['allyLostUnits', 'allySurvivingUnits', 'diplomacy', 'enemyKilledUnits', 'enemyRoutedUnits', 'lordCaptured', 'outcome']);
  expect(result.enemyKilledUnits + result.enemyRoutedUnits).toBe(12);
  expect(result.allyLostUnits + result.allySurvivingUnits).toBe(24);
  expect(typeof result.lordCaptured).toBe('boolean');
  expect(result.diplomacy).toBeNull();
  await expect(hud(page, 'end')).toBeVisible();
  await expect(hud(page, 'end-title')).toHaveText('전투 승리');
  await expect(page.locator('[data-b2d="root"]')).toHaveAttribute('data-ended', 'true');
  await page.waitForTimeout(1200);
  expect(await endCount(page)).toBe(1);
  expect(dialogs).toEqual([]);
  expect(problems).toEqual([]);
});

test('[battle2d.page.end-waits-for-confirm] with confirmEnd the end screen waits for its button before onEnd is called', async ({ page }) => {
  await openBattle(page, `${WINNABLE}&confirmEnd=1`);
  await hud(page, 'start').click();
  await expect(hud(page, 'end')).toBeVisible({ timeout: 25_000 });
  await page.waitForTimeout(500);
  expect(await endCount(page)).toBe(0);
  await hud(page, 'end-continue').click();
  await expect.poll(() => endCount(page)).toBe(1);
  await hud(page, 'end-continue').click({ force: true });
  expect(await endCount(page)).toBe(1);
});

test('[battle2d.page.surrender-no-reload] surrender asks inside the battle, ends with "surrender", and does not reload the page', async ({ page }) => {
  const { problems, dialogs, navigations } = await openBattle(page, 'terrain=flat&seed=5');
  await page.evaluate(() => { window.__stillHere = 'yes'; });
  await hud(page, 'start').click();
  await hud(page, 'more').click();
  await hud(page, 'surrender').click();
  await expect(hud(page, 'surrender-confirm')).toBeVisible();
  await hud(page, 'surrender-no').click();
  await expect(hud(page, 'surrender-confirm')).toBeHidden();
  expect(await endCount(page)).toBe(0);
  await hud(page, 'more').click();
  await hud(page, 'surrender').click();
  await hud(page, 'surrender-yes').click();
  await expect.poll(() => endCount(page)).toBe(1);
  expect((await endResult(page)).outcome).toBe('surrender');
  await expect(hud(page, 'end-title')).toHaveText('항복');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__stillHere)).toBe('yes');
  expect(navigations).toHaveLength(1);
  expect(await endCount(page)).toBe(1);
  expect(dialogs).toEqual([]);
  expect(problems).toEqual([]);
});

test('[battle2d.page.retreat-ends] the retreat button ends the battle as a retreat with every ally counted as a survivor', async ({ page }) => {
  await openBattle(page, 'terrain=flat&seed=5');
  await hud(page, 'start').click();
  await hud(page, 'more').click();
  await hud(page, 'retreat').click();
  await expect.poll(() => endCount(page)).toBe(1);
  const result = await endResult(page);
  expect(result.outcome).toBe('retreat');
  expect(result.allyLostUnits).toBe(0);
  expect(result.allySurvivingUnits).toBe(72);
});

test.describe('negotiation', () => {
  test('[battle2d.page.diplomacy-offline] the enemy lord answers by fixed rules and stock lines, with no network request and no key', async ({ page }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await openBattle(page, 'terrain=flat&seed=5&ally=2&enemy=0.5');
    await hud(page, 'start').click();
    await hud(page, 'more').click();
    await hud(page, 'negotiate').click();
    await expect(hud(page, 'diplomacy')).toBeVisible();
    await hud(page, 'chat-input').fill('말해 보시오');
    await hud(page, 'chat-send').click();
    await expect.poll(() => endCount(page)).toBe(1);
    const result = await endResult(page);
    expect(result.outcome).toBe('strategic_retreat');
    expect(result.diplomacy.offer).toEqual({ gold: 0, food: 0 });
    await expect(hud(page, 'chat')).toContainText('후퇴한다');
    expect(requests.filter((url) => !url.startsWith('http://127.0.0.1'))).toEqual([]);
  });

  test('[battle2d.page.diplomacy-offer-reported] an accepted offer ends the battle as a negotiated retreat and is reported for the caller to charge', async ({ page }) => {
    await openBattle(page, 'terrain=flat&seed=5&gold=500&food=10');
    await hud(page, 'start').click();
    await hud(page, 'more').click();
    await hud(page, 'negotiate').click();
    await hud(page, 'chat-input').fill('금화 300 주겠다');
    await hud(page, 'chat-input').press('Enter');
    await expect.poll(() => endCount(page)).toBe(1);
    const result = await endResult(page);
    expect(result.outcome).toBe('negotiated_retreat');
    expect(result.diplomacy).toEqual({ action: 'negotiated_retreat', reason: 'offer_accepted', offer: { gold: 300, food: 0 } });
    await expect(hud(page, 'end-text')).toContainText('금화 300');
  });
});

test('[battle2d.page.dispose-leaves-nothing] dispose removes the canvas, HUD and styles and leaves no frame, timer or listener, and onEnd is not called', async ({ page }) => {
  const { problems } = await openBattle(page, 'seed=9&autostart=0', { started: false });
  const survey = () => page.evaluate(() => {
    const container = document.getElementById('battle-box');
    const listenersOn = (target) => (window.__probe.listeners.get(target) || new Set()).size;
    return {
      children: container.childElementCount,
      containerPosition: container.style.position,
      battleElements: document.querySelectorAll('[data-b2d], .b2d-root, canvas').length,
      styles: document.querySelectorAll('style').length,
      frames: window.__probe.frames.size,
      timers: window.__probe.timers.size,
      listeners: [window, document, document.body, document.documentElement, container].map(listenersOn),
      endCount: Number(document.body.dataset.endCount || 0),
    };
  });
  const before = await survey();
  expect(before.battleElements).toBe(0);
  await page.click('#dev-restart');
  await expect(hud(page, 'canvas')).toBeVisible();
  await hud(page, 'start').click();
  await page.waitForTimeout(400);
  const during = await survey();
  expect(during.frames).toBeGreaterThan(0);
  expect(during.battleElements).toBeGreaterThan(10);
  expect(during.containerPosition).toBe('relative');
  await page.click('#dev-dispose');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'disposed');
  const after = await survey();
  expect(after).toEqual({ ...before, endCount: 0 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__probe.frames.size)).toBe(0);
  // A second battle in the same container works, and disposing it again leaves nothing either.
  await page.click('#dev-restart');
  await expect(hud(page, 'canvas')).toBeVisible();
  await page.click('#dev-dispose');
  expect(await survey()).toEqual({ ...before, endCount: 0 });
  expect(problems).toEqual([]);
});

test('[battle2d.page.no-math-random] a whole battle in the page, with the random map, never calls Math.random', async ({ page }) => {
  await openBattle(page, 'seed=13&timeScale=8&ally=1&enemy=0.5');
  await hud(page, 'start').click();
  await page.waitForTimeout(2500);
  await hud(page, 'more').click();
  await hud(page, 'surrender').click();
  await hud(page, 'surrender-yes').click();
  await expect.poll(() => endCount(page)).toBe(1);
  expect(await page.evaluate(() => window.__probe.randomCalls)).toBe(0);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 700 }, hasTouch: true });

  test('[battle2d.page.fits-phone] on a phone screen the page does not scroll sideways and the controls are on screen', async ({ page }) => {
    await openBattle(page, 'terrain=flat&seed=2');
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
    for (const name of ['start', 'speed-1', 'more', 'select-infantry']) {
      const box = await hud(page, name).boundingBox();
      expect(box, name).not.toBeNull();
      expect(box.x, name).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, name).toBeLessThanOrEqual(widths.inner + 0.5);
    }
  });
});
