// Shared setup for the 3D battle (m2_prototype.html) browser tests.
// Every test opens a fresh page, so no test depends on what an earlier one left behind.
import { expect } from '@playwright/test';

// Opens the prototype (at path: ?mixed, ?scale=N), fails on any page error, and waits until the battle API is
// up and ticking.
export async function openBattle(page, path = '/m2_prototype.html') {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await page.addInitScript(() => {
    window.__testRejections = [];
    window.addEventListener('unhandledrejection', (event) => window.__testRejections.push(String(event.reason)));
  });
  await page.goto(path);
  await page.waitForFunction(() => window.ArsM2Battle && window.ArsM2Diagnostics, null, { timeout: 15_000 });
  // Ready means the battle has drawn and ticked: the soldier models are loaded and their shaders built.
  await page.waitForFunction(() => window.ArsM2Diagnostics.getSnapshot().fixedTickCount > 0, null, { timeout: 30_000 });
  await waitTicks(page, 1);
  return errors;
}

export const diagnostics = (page) => page.evaluate(() => window.ArsM2Diagnostics.getSnapshot());
export const snapshot = (page) => page.evaluate(() => window.ArsM2Battle.getSnapshot());
export const player = (page) => page.evaluate(() => {
  const s = window.ArsM2Battle.getSnapshot();
  return s.units.find((unit) => unit.unitId === s.playerCharacterId);
});
export const formation = (page, id) => page.evaluate((formationId) =>
  window.ArsM2Battle.getSnapshot().formations.find((item) => item.formationId === formationId), id);

// Waits until the fixed simulation tick has advanced by n. CI draws with a software renderer (no GPU), where
// a frame of the full soldier models can take a second or more, so the wait is generous; it measures that
// the simulation advances, not how fast.
export async function waitTicks(page, n, timeout = 20_000) {
  const start = (await diagnostics(page)).fixedTickCount;
  await expect.poll(async () => (await diagnostics(page)).fixedTickCount, { timeout }).toBeGreaterThanOrEqual(start + n);
}

// Pointer helpers dispatch the same PointerEvents a touch screen or mouse would.
export async function pointer(page, selector, type, options = {}) {
  await page.evaluate(({ selector, type, options }) => {
    const element = document.querySelector(selector);
    element.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true,
      pointerId: options.pointerId ?? 1, pointerType: options.pointerType ?? 'touch',
      clientX: options.clientX ?? 0, clientY: options.clientY ?? 0,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
    }));
  }, { selector, type, options });
}

export async function tap(page, selector, options = {}) {
  await pointer(page, selector, 'pointerdown', options);
  await pointer(page, selector, 'pointerup', options);
}

export async function switchToTactical(page) {
  if ((await diagnostics(page)).cameraMode !== 'tactical') {
    await tap(page, '#m2Tactical');
    await waitTicks(page, 1);
  }
}

// Loads a variant of the fixture snapshot (changed in the page by `edit`) and starts it.
export async function loadVariant(page, edit) {
  const result = await page.evaluate(async (editSource) => {
    const { M2_TECHNICAL_SNAPSHOT } = await import('/m2/fixtures/m2_technical_fixture_v1.js');
    const snapshot = JSON.parse(JSON.stringify(M2_TECHNICAL_SNAPSHOT));
    new Function('snapshot', editSource)(snapshot);
    const loaded = window.ArsM2Battle.loadSnapshot(snapshot);
    if (!loaded.ok) return loaded;
    return window.ArsM2Battle.start();
  }, edit);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  // A new battle is drawn afresh (every soldier's model again): in CI, drawing in software, its first tick can
  // be most of a minute away.
  await waitTicks(page, 1, 60_000);
}

export async function noPageErrors(page, errors) {
  const rejections = await page.evaluate(() => window.__testRejections || []);
  expect([...errors, ...rejections.map((reason) => `unhandledrejection: ${reason}`)]).toEqual([]);
}
