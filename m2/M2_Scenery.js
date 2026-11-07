// Draws the battlefield's surroundings (the owner, 2026-11-07: the background) from M2_SceneryLayout.js: the
// ground with its hills, road and grass, woods, bushes, rocks, grass tufts, a farmstead with haystacks and a
// fence, a watchtower, a ring of mountains and a sky with clouds. Everything of one kind is one instanced mesh (one
// draw call), so the whole scene adds about twenty draw calls; nothing in it touches the battle.
import * as THREE from "three";
import { FLAT, GROUND_SIZE, ROAD_HALF_WIDTH, groundHeight, roadZ, sceneryLayout } from "./M2_SceneryLayout.js";

const COLORS = Object.freeze({
  grass: 0x5d7343, dryGrass: 0x8f8d58, hillGrass: 0x4f6a3c, road: 0x8a7350, mown: 0xa49a5e,
  trunk: 0x5a4330, pine: 0x2f4f2c, oak: 0x48682f, bush: 0x3f5f2e, rock: 0x8a8a84, tuft: 0x6f8a45,
  hay: 0xc9a85a, wood: 0x7a5b3a, wall: 0xd8ccb2, roof: 0x7d3b2a, stone: 0x9d978a,
  mountain: 0x7f93a6, snow: 0xeef2f5, skyTop: "#2f6596", skyMid: "#8db4d0", haze: "#c4d3d6"
});

// A fixed random sequence for colour and shape variation (the layout has its own).
function variation(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

// The ground: hills beyond the flat field, the road, a mown field behind the farm, grass patches; a fine grass
// texture over it for the view close to the player.
function groundMesh() {
  // (About 3 m a square: the hills are gentle; the flat field needs no finer.)
  const segments = 100;
  const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, segments, segments).rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const grass = new THREE.Color(COLORS.grass);
  const dry = new THREE.Color(COLORS.dryGrass);
  const hill = new THREE.Color(COLORS.hillGrass);
  const road = new THREE.Color(COLORS.road);
  const mown = new THREE.Color(COLORS.mown);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = groundHeight(x, z);
    position.setY(i, y);
    const patch = Math.sin(x * 0.11) * Math.cos(z * 0.13) + Math.sin((x + z) * 0.047) * 0.8;
    const fine = Math.sin(x * 0.9 + z * 0.37) * Math.cos(z * 0.83 - x * 0.21);
    color.copy(grass).lerp(dry, Math.max(0, patch) * 0.3).lerp(hill, Math.min(1, y / 10) * 0.6);
    // The mown field behind the farm (where the haystacks stand).
    if (x > 8 && x < 40 && z > 42 && z < 62) color.lerp(mown, 0.55);
    // The road: dirt, its edges blending into the grass.
    const off = Math.abs(z - roadZ(x));
    if (off < ROAD_HALF_WIDTH + 1) color.lerp(road, Math.min(1, (ROAD_HALF_WIDTH + 1 - off) / 1.4));
    color.multiplyScalar(0.94 + fine * 0.05 + Math.min(0, patch) * 0.06);
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const texture = grassTexture();
  texture.repeat.set(GROUND_SIZE / 3, GROUND_SIZE / 3);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, map: texture }));
  mesh.name = "scenery_ground";
  return mesh;
}

// Grass blades on a light background, to multiply the ground's colours with (tiled).
function grassTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e4e4e4";
  ctx.fillRect(0, 0, size, size);
  const rnd = variation(7);
  for (let i = 0; i < 900; i += 1) {
    const x = rnd() * size;
    const y = rnd() * size;
    const shade = 150 + Math.floor(rnd() * 105);
    ctx.strokeStyle = `rgb(${shade},${shade},${shade})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 4);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// The sky: a dome that follows the camera, from deep blue overhead through pale blue to the haze at the horizon,
// with soft clouds and the sun's glow (the sun light's direction).
function skyDome(sunDirection) {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, COLORS.skyTop);
  gradient.addColorStop(0.32, COLORS.skyMid);
  gradient.addColorStop(0.5, COLORS.haze);
  gradient.addColorStop(1, COLORS.haze);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  // The sun's glow: where its direction meets the dome (u around, v from the top).
  const u = (Math.atan2(sunDirection.x, sunDirection.z) / (Math.PI * 2) + 0.5) * width;
  const v = (Math.acos(Math.min(1, Math.max(-1, sunDirection.y))) / Math.PI) * height;
  const glow = ctx.createRadialGradient(u, v, 0, u, v, 120);
  glow.addColorStop(0, "rgba(255,248,225,0.95)");
  glow.addColorStop(0.15, "rgba(255,240,205,0.55)");
  glow.addColorStop(1, "rgba(255,240,205,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  // Clouds: clusters of soft white blobs in the band above the horizon.
  const rnd = variation(11);
  for (let c = 0; c < 22; c += 1) {
    const cx = rnd() * width;
    const cy = height * (0.16 + rnd() * 0.24);
    const spread = 40 + rnd() * 90;
    for (let b = 0; b < 14; b += 1) {
      const bx = cx + (rnd() - 0.5) * spread * 2;
      const by = cy + (rnd() - 0.5) * spread * 0.35;
      const r = 12 + rnd() * 26;
      const blob = ctx.createRadialGradient(bx, by, 0, bx, by, r);
      blob.addColorStop(0, "rgba(255,255,255,0.55)");
      blob.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = blob;
      // (Drawn at both ends of the seam so it does not show.)
      for (const dx of [0, -width, width]) { ctx.beginPath(); ctx.arc(bx + dx, by, r, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(235, 32, 16),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  mesh.name = "scenery_sky";
  mesh.renderOrder = -10;
  return mesh;
}

// One instanced mesh of `geometry` for the given places; `shape(place, matrix)` sets each one's transform,
// `tint(place, color)` its colour (shading the base colour a little each).
function instances(name, geometry, material, places, shape, tint) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, places.length));
  mesh.name = name;
  mesh.count = places.length;
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  places.forEach((place, i) => {
    shape(place, matrix);
    mesh.setMatrixAt(i, matrix);
    if (tint) { tint(place, color, i); mesh.setColorAt(i, color); }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // (Spread over the whole field: the default bounds are those of one copy.)
  mesh.frustumCulled = false;
  return mesh;
}

const at = (matrix, x, y, z, turn, sx, sy, sz) => matrix.compose(
  new THREE.Vector3(x, y, z),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn),
  new THREE.Vector3(sx, sy ?? sx, sz ?? sx)
);

// A tuft: a few thin blades fanning out, coloured darker at the root.
function tuftGeometry() {
  const positions = [];
  const colors = [];
  const root = new THREE.Color(0x4a6230);
  const tip = new THREE.Color(0xb6c77a);
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const lean = 0.08;
    const w = 0.035;
    const h = 0.22 + (i % 2) * 0.08;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    positions.push(-w * cz, 0, w * cx, w * cz, 0, -w * cx, cx * lean, h, cz * lean);
    colors.push(root.r, root.g, root.b, root.r, root.g, root.b, tip.r, tip.g, tip.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// A house: walls and a gabled roof, as two geometries (walls box, roof prism) for two instanced meshes.
function roofGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0, 0.6);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
}

export function buildScenery(scene, { sunDirection = new THREE.Vector3(14, 18, 8).normalize() } = {}) {
  const layout = sceneryLayout();
  const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const tintFrom = (base, spread) => { const rnd = variation(base % 2147483646 + 1); return (place, color) => color.setHex(base).multiplyScalar(1 - spread + rnd() * spread * 2); };
  const objects = [];
  const add = (mesh) => { objects.push(mesh); scene.add(mesh); return mesh; };

  add(groundMesh());
  const sky = add(skyDome(sunDirection));

  // Trees: one trunk mesh for all, a pine crown (two stacked cones) and an oak crown (a lumpy ball).
  const pines = layout.trees.filter((t) => t.kind === "pine");
  const oaks = layout.trees.filter((t) => t.kind === "oak");
  add(instances("scenery_trunks", new THREE.CylinderGeometry(0.16, 0.24, 2.2, 6).translate(0, 1.1, 0), lambert(COLORS.trunk),
    layout.trees, (t, m) => at(m, t.x, t.y, t.z, t.turn, t.scale)));
  const pineCrown = new THREE.ConeGeometry(1.5, 3.4, 8).translate(0, 3.3, 0);
  const pineTop = new THREE.ConeGeometry(1.05, 2.6, 8).translate(0, 4.9, 0);
  add(instances("scenery_pines", mergeTwo(pineCrown, pineTop), lambert(0xffffff, { flatShading: true }),
    pines, (t, m) => at(m, t.x, t.y, t.z, t.turn, t.scale), tintFrom(COLORS.pine, 0.12)));
  add(instances("scenery_oaks", new THREE.IcosahedronGeometry(1.9, 1).scale(1, 0.85, 1).translate(0, 3.3, 0), lambert(0xffffff, { flatShading: true }),
    oaks, (t, m) => at(m, t.x, t.y, t.z, t.turn, t.scale), tintFrom(COLORS.oak, 0.14)));
  add(instances("scenery_bushes", new THREE.IcosahedronGeometry(0.75, 0).scale(1.2, 0.7, 1).translate(0, 0.35, 0), lambert(0xffffff, { flatShading: true }),
    layout.bushes, (b, m) => at(m, b.x, b.y, b.z, b.turn, b.scale), tintFrom(COLORS.bush, 0.15)));
  add(instances("scenery_rocks", new THREE.DodecahedronGeometry(0.6, 0).scale(1.3, 0.6, 1).translate(0, 0.15, 0), lambert(0xffffff, { flatShading: true }),
    layout.rocks, (r, m) => at(m, r.x, r.y, r.z, r.turn, r.scale), tintFrom(COLORS.rock, 0.12)));
  add(instances("scenery_tufts", tuftGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    layout.tufts, (t, m) => at(m, t.x, t.y, t.z, t.turn, t.scale)));
  // The farmstead: haystacks (a round stack with a pointed top), houses, a fence of posts and two rails.
  const hayBody = new THREE.CylinderGeometry(1, 1.15, 1.6, 10).translate(0, 0.8, 0);
  const hayTop = new THREE.ConeGeometry(1.05, 1.1, 10).translate(0, 2.15, 0);
  add(instances("scenery_haystacks", mergeTwo(hayBody, hayTop), lambert(0xffffff),
    layout.haystacks, (h, m) => at(m, h.x, h.y, h.z, h.turn, h.scale), tintFrom(COLORS.hay, 0.08)));
  const houseSize = (h) => (h.kind === "barn" ? { w: 6, d: 9, h: 3.4 } : { w: 4.5, d: 6, h: 2.8 });
  add(instances("scenery_walls", new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), lambert(0xffffff),
    layout.houses, (h, m) => { const s = houseSize(h); at(m, h.x, h.y, h.z, h.turn, s.w, s.h, s.d); },
    (h, color) => color.setHex(h.kind === "barn" ? COLORS.wood : COLORS.wall)));
  add(instances("scenery_roofs", roofGeometry(), lambert(COLORS.roof, { flatShading: true }),
    layout.houses, (h, m) => { const s = houseSize(h); m.compose(new THREE.Vector3(h.x, h.y + s.h, h.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.turn), new THREE.Vector3(s.w * 1.15, s.w * 0.75, s.d * 1.08)); }));
  const rails = layout.fence;
  add(instances("scenery_fence_posts", new THREE.BoxGeometry(0.14, 1.2, 0.14).translate(0, 0.6, 0), lambert(COLORS.wood), rails,
    (f, m) => at(m, f.x, f.y, f.z, f.turn, 1)));
  add(instances("scenery_fence_rails", mergeTwo(new THREE.BoxGeometry(0.06, 0.1, 3).translate(0, 0.95, 1.5), new THREE.BoxGeometry(0.06, 0.1, 3).translate(0, 0.55, 1.5)),
    lambert(COLORS.wood), rails, (f, m) => at(m, f.x, f.y, f.z, f.turn, 1)));
  // The watchtower: a stone round with a battlement and a pointed timber roof.
  const t = layout.tower;
  const tower = new THREE.Group();
  tower.name = "scenery_tower";
  const stone = lambert(COLORS.stone, { flatShading: true });
  tower.add(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 12, 10).translate(0, 6, 0), stone));
  tower.add(new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 1.2, 10).translate(0, 12.6, 0), stone));
  tower.add(new THREE.Mesh(new THREE.ConeGeometry(3.4, 4.2, 10).translate(0, 15.3, 0), lambert(COLORS.roof, { flatShading: true })));
  tower.position.set(t.x, t.y - 0.5, t.z);
  add(tower);
  // Mountains beyond the haze (unfogged, in the blue of distance), with snow on the tallest.
  // (Lit, with flat faces, so their slopes catch the sun; light of their own keeps them pale with distance.)
  const mountainMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false, flatShading: true, emissive: 0x52606e });
  const peak = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
  add(instances("scenery_mountains", peak, mountainMaterial, layout.mountains,
    (p, m) => at(m, p.x, -2, p.z, p.turn, 70 * p.scale, p.height, 60 * p.scale),
    (p, color) => color.setHex(COLORS.mountain).multiplyScalar(0.55 + (p.height / 62) * 0.1)));
  const snowy = layout.mountains.filter((p) => p.height > 45);
  // (A little wider and higher than the peak it caps, so the two surfaces do not fight over the same pixels.)
  add(instances("scenery_snow", new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0),
    new THREE.MeshLambertMaterial({ color: COLORS.snow, fog: false, flatShading: true, emissive: 0x8a96a2 }),
    snowy, (p, m) => at(m, p.x, -2 + p.height * 0.71, p.z, p.turn, 70 * p.scale * 0.3 * 1.05, p.height * 0.3, 60 * p.scale * 0.3 * 1.05)));

  const counts = {
    trees: layout.trees.length, bushes: layout.bushes.length, rocks: layout.rocks.length, tufts: layout.tufts.length,
    houses: layout.houses.length, haystacks: layout.haystacks.length, fence: layout.fence.length, mountains: layout.mountains.length
  };
  return {
    counts,
    layout,
    // The sky dome stays centred on the camera.
    follow(camera) { sky.position.copy(camera.position); },
    dispose() {
      for (const object of objects) {
        object.traverse((o) => {
          o.geometry?.dispose();
          for (const material of [].concat(o.material || [])) { material.map?.dispose(); material.dispose(); }
        });
        scene.remove(object);
      }
    }
  };
}

// Two geometries as one (both non-indexed, same attributes).
function mergeTwo(a, b) {
  const one = a.index ? a.toNonIndexed() : a;
  const two = b.index ? b.toNonIndexed() : b;
  const geometry = new THREE.BufferGeometry();
  for (const name of Object.keys(one.attributes)) {
    if (!two.attributes[name]) continue;
    const x = one.attributes[name];
    const y = two.attributes[name];
    const array = new Float32Array(x.array.length + y.array.length);
    array.set(x.array, 0);
    array.set(y.array, x.array.length);
    geometry.setAttribute(name, new THREE.BufferAttribute(array, x.itemSize));
  }
  return geometry;
}

export { FLAT };
