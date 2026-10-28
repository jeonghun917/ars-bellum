import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacer } from '../../src/ui/pacer.js';
import { boundsOf, centerOn, clampView, fitView, hitNode, panBy, screenToWorld, worldToScreen, zoomAt } from '../../src/ui/camera.js';
import { defaultWorld } from '../../src/domains/world/index.js';

test('[ui.pacer.whole-minutes] real time becomes whole game minutes by speed; the remainder is kept, paused gives none', () => {
  const pacer = createPacer();
  assert.equal(pacer.take(100, 1, 1000), 0);
  assert.equal(pacer.take(200, 1, 1000), 0);
  assert.equal(pacer.take(250, 1, 1000), 0);
  assert.equal(pacer.take(250, 1, 1000), 0);
  assert.equal(pacer.take(250, 1, 1000), 1); // 1050 ms at 1x: one minute, 50 ms left over
  assert.ok(Math.abs(pacer.fraction - 0.05) < 1e-9);
  assert.equal(pacer.take(250, 4, 1000), 1); // 4x: 250 ms is one minute
  assert.equal(pacer.take(250, 2, 1000), 0);
  assert.equal(pacer.take(250, 2, 1000), 1);
  assert.equal(pacer.take(1000, 0, 1000), 0); // paused
  assert.equal(pacer.take(-5, 1, 1000), 0);
  assert.equal(pacer.take(100, 1, 0), 0);
});

test('[ui.pacer.long-frame-capped] a frame that took very long (hidden tab) hands out little time, and never more than a day', () => {
  const pacer = createPacer();
  assert.equal(pacer.take(60_000, 1, 1000), 0); // counted as 250 ms
  assert.equal(pacer.take(250, 1, 1000), 0);
  assert.equal(pacer.take(250, 1, 1000), 0);
  assert.equal(pacer.take(250, 1, 1000), 1);
  const fast = createPacer();
  assert.equal(fast.take(250, 8, 0.001), 1440);
  assert.equal(fast.fraction, 0);
});

const viewport = { width: 1000, height: 600 };
const map = defaultWorld.map;

test('[ui.camera.zoom-keeps-anchor] zooming keeps the world point under the pointer where it is, within the zoom limits', () => {
  const start = fitView(map, viewport);
  const anchor = { x: 400, y: 300 };
  const before = screenToWorld(start, anchor);
  const zoomed = zoomAt(start, anchor, 2, map, viewport);
  assert.ok(zoomed.zoom > start.zoom);
  const after = screenToWorld(zoomed, anchor);
  assert.ok(Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6);
  // Away from the edges nothing is clamped, so the anchor stays exactly where it was on both axes.
  const inside = { zoom: 0.5, x: -300, y: -200 };
  const grown = zoomAt(inside, { x: 500, y: 300 }, 1.5, map, viewport);
  assert.equal(grown.zoom, 0.75);
  assert.deepEqual({ x: grown.x, y: grown.y }, { x: -700, y: -450 });
  assert.equal(zoomAt(start, anchor, 0.001, map, viewport).zoom, start.zoom, 'cannot zoom out past the whole map');
  assert.equal(zoomAt(start, anchor, 1e6, map, viewport).zoom, 2, 'cannot zoom in past the limit');
});

test('[ui.camera.pan-stays-on-map] panning cannot push the map off the screen and a small map stays centred', () => {
  const zoomed = zoomAt(fitView(map, viewport), { x: 500, y: 300 }, 4, map, viewport);
  const far = panBy(zoomed, 1e6, 1e6, map, viewport);
  assert.equal(far.x, 0);
  assert.equal(far.y, 0);
  const other = panBy(zoomed, -1e6, -1e6, map, viewport);
  assert.ok(Math.abs(other.x - (viewport.width - map.width * zoomed.zoom)) < 1e-6);
  const whole = fitView(map, viewport);
  assert.ok(whole.x > 0 && whole.y === 0, 'a wide viewport centres the square map sideways');
  const roundTrip = screenToWorld(whole, worldToScreen(whole, { x: 123, y: 456 }));
  assert.ok(Math.abs(roundTrip.x - 123) < 1e-9 && Math.abs(roundTrip.y - 456) < 1e-9);
  assert.deepEqual(clampView(whole, map, viewport), whole);
  const focused = fitView(map, viewport, boundsOf(defaultWorld.nodes, 350));
  assert.ok(focused.zoom > whole.zoom, 'the first view is closer than the whole map');
  const centred = centerOn(focused, { x: 2000, y: 1500 }, map, viewport);
  const mid = worldToScreen(centred, { x: 2000, y: 1500 });
  assert.ok(Math.abs(mid.x - 500) < 1 && Math.abs(mid.y - 300) < 1);
});

test('[ui.camera.hit-small-settlement] a small settlement is still easy to hit: a minimum hit size, and the nearest one wins', () => {
  const view = fitView(map, viewport);
  const village = defaultWorld.nodeById.get('test_village');
  const at = worldToScreen(view, village);
  assert.equal(hitNode(view, defaultWorld.nodes, at)?.id, 'test_village');
  assert.equal(hitNode(view, defaultWorld.nodes, { x: at.x + 10, y: at.y })?.id, 'test_village');
  assert.equal(hitNode(view, defaultWorld.nodes, { x: at.x + 60, y: at.y + 60 }), null);
  const close = [{ id: 'a', x: 0, y: 0, radius: 10 }, { id: 'b', x: 10, y: 0, radius: 10 }];
  assert.equal(hitNode({ zoom: 1, x: 0, y: 0 }, close, { x: 7, y: 0 })?.id, 'b');
});
