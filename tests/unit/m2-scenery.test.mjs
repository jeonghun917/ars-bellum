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
  // Trees stand only well clear of the field; the woods on the horizon.
  for (const t of layout.trees) assert.equal(inPlayArea(t.x, t.z, 20), false, `tree at ${t.x},${t.z}`);
  for (const w of layout.woods) assert.ok(Math.hypot(w.x, w.z) > 100, `woods at ${w.x},${w.z}`);
  assert.ok(layout.grass.count > 0);
});

test('[m2.scenery.flat-ground] the ground is flat where the battle is fought and around it, and rises only a little far off', () => {
  for (let x = -FLAT.x; x <= FLAT.x; x += 4) for (let z = -FLAT.z; z <= FLAT.z; z += 4) assert.equal(groundHeight(x, z), 0, `${x},${z}`);
  // (A flat horizon, as in the owner's picture: under 2 m anywhere.)
  for (let a = 0; a < 72; a += 1) {
    const h = groundHeight(Math.cos(a / 72 * Math.PI * 2) * 170, Math.sin(a / 72 * Math.PI * 2) * 170);
    assert.ok(h >= 0 && h < 2, `${h}`);
  }
  for (const t of sceneryLayout().trees) assert.equal(t.y, groundHeight(t.x, t.z));
});

test('[m2.scenery.road-and-repeat] the surroundings are the same every time', () => {
  assert.deepEqual(sceneryLayout(), sceneryLayout());
});
