// The battlefield's surroundings (m2/M2_SceneryLayout.js; the owner, 2026-11-07: the background). They are only
// drawn: the battle is fought on flat ground, and nothing that could hide a man stands where it is fought.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAT, PLAY, ROAD_HALF_WIDTH, groundHeight, inPlayArea, roadZ, sceneryLayout } from '../../m2/M2_SceneryLayout.js';
import { M2_MORALE_DEFINITION } from '../../m2/M2_Definitions.js';
import { buildScaleSnapshot } from '../../m2/fixtures/m2_scale_fixture.js';

test('[m2.scenery.field-clear] the play area holds every army drawn up and its retreat edges, and only grass tufts stand in it', () => {
  // Every soldier of the largest battle, and both retreat edges, are inside it.
  for (const c of buildScaleSnapshot({ perSide: 100 }).characters) assert.ok(inPlayArea(c.spawn.x, c.spawn.z), `${c.characterId} ${c.spawn.x},${c.spawn.z}`);
  assert.ok(PLAY.z > M2_MORALE_DEFINITION.retreatEdgeZ + 5);
  const layout = sceneryLayout();
  for (const kind of ['trees', 'bushes', 'rocks', 'haystacks', 'houses', 'fence']) {
    assert.ok(layout[kind].length > 0, kind);
    for (const p of layout[kind]) assert.equal(inPlayArea(p.x, p.z, 1), false, `${kind} at ${p.x},${p.z}`);
  }
  assert.equal(inPlayArea(layout.tower.x, layout.tower.z, 20), false);
  for (const m of layout.mountains) assert.ok(Math.hypot(m.x, m.z) > 180, `mountain at ${m.x},${m.z}`);
  assert.ok(layout.tufts.some((t) => inPlayArea(t.x, t.z)));
});

test('[m2.scenery.flat-ground] the ground is flat where the battle is fought and around it, and rises into hills only beyond', () => {
  for (let x = -FLAT.x; x <= FLAT.x; x += 4) for (let z = -FLAT.z; z <= FLAT.z; z += 4) assert.equal(groundHeight(x, z), 0, `${x},${z}`);
  assert.ok(groundHeight(FLAT.x + 45, 0) > 3);
  assert.ok(groundHeight(0, -(FLAT.z + 45)) > 3);
  // Everything stands on the ground where it is.
  const layout = sceneryLayout();
  for (const p of [...layout.trees, ...layout.rocks, ...layout.houses]) assert.equal(p.y, groundHeight(p.x, p.z));
});

test('[m2.scenery.road-and-repeat] nothing stands on the road, and the surroundings are the same every time', () => {
  const layout = sceneryLayout();
  for (const kind of ['trees', 'bushes', 'rocks', 'tufts']) {
    for (const p of layout[kind]) assert.ok(Math.abs(p.z - roadZ(p.x)) > ROAD_HALF_WIDTH, `${kind} on the road at ${p.x},${p.z}`);
  }
  assert.deepEqual(sceneryLayout(), layout);
});
