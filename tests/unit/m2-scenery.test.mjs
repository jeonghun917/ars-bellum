// The battlefield's surroundings (m2/M2_SceneryLayout.js; the owner, 2026-11-07: the background). They are only
// drawn: the battle is fought on flat ground, and nothing that could hide a man stands where it is fought.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAT, PLAY, groundHeight, inPlayArea, sceneryLayout } from '../../m2/M2_SceneryLayout.js';
import { M2_MORALE_DEFINITION } from '../../m2/M2_Definitions.js';
import { buildScaleSnapshot } from '../../m2/fixtures/m2_scale_fixture.js';

test('[m2.scenery.field-clear] the play area holds every army drawn up and its retreat edges, and only grass stands in it', () => {
  // Every soldier of the largest battle, and both retreat edges, are inside it.
  for (const c of buildScaleSnapshot({ perSide: 100 }).characters) assert.ok(inPlayArea(c.spawn.x, c.spawn.z), `${c.characterId} ${c.spawn.x},${c.spawn.z}`);
  assert.ok(PLAY.z > M2_MORALE_DEFINITION.retreatEdgeZ + 5);
  const layout = sceneryLayout();
  assert.ok(layout.trees.length > 0);
  // Trees stand only far off: in clumps and tree lines well clear of the field.
  for (const t of layout.trees) assert.equal(inPlayArea(t.x, t.z, 20), false, `tree at ${t.x},${t.z}`);
  for (const h of layout.hills) assert.ok(Math.hypot(h.x, h.z) - h.radius > 60, `hill at ${h.x},${h.z}`);
  assert.ok(layout.tufts.length > 0);
});

test('[m2.scenery.flat-ground] the ground is flat where the battle is fought and around it, and swells only beyond', () => {
  for (let x = -FLAT.x; x <= FLAT.x; x += 4) for (let z = -FLAT.z; z <= FLAT.z; z += 4) assert.equal(groundHeight(x, z), 0, `${x},${z}`);
  // Beyond, the meadow swells: on average a few metres up all round (some points lie in a dip).
  const ring = Array.from({ length: 72 }, (_, i) => { const a = (i / 72) * Math.PI * 2; return groundHeight(Math.cos(a) * 140, Math.sin(a) * 140); });
  assert.ok(ring.reduce((s, h) => s + h, 0) / ring.length > 2.5, JSON.stringify(ring.map((h) => +h.toFixed(1))));
  assert.ok(ring.every((h) => h > 0));
  // Every tree stands on the ground where it is.
  for (const t of sceneryLayout().trees) assert.equal(t.y, groundHeight(t.x, t.z));
});

test('[m2.scenery.road-and-repeat] the surroundings are the same every time', () => {
  assert.deepEqual(sceneryLayout(), sceneryLayout());
});
