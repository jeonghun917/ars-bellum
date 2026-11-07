// Draws the battlefield's surroundings (the owner, 2026-11-07: the background, after his pictures of open
// meadows) from M2_SceneryLayout.js: bright yellow-green grass with wind streaks and cart tracks, long grass that
// sways, far tree lines and clumps of round trees, soft hills fading into blue haze, a big blue sky with a few
// small clouds. Everything of one kind is one instanced mesh (one draw call); nothing in it touches the battle.
import * as THREE from "three";
import { GROUND_SIZE, TRACK_GAP, groundHeight, sceneryLayout, trackZ } from "./M2_SceneryLayout.js";

// The style sheet's colours (the owner's pictures).
export const SCENERY_COLORS = Object.freeze({
  grass: 0x84bb3f, grassDeep: 0x5a9030, grassLight: 0xc0dc6a, rut: 0x6e8a35,
  trunk: 0x4e3b2a, leaves: 0x2f5a26, leavesLight: 0x4a7a32,
  hillNear: 0x2f5a3a, hillFar: 0x6f8f9a,
  skyTop: "#1f6fd1", skyMid: "#5ea6e8", horizon: "#cfe6f2", haze: 0xcfe6f2
});
const C = SCENERY_COLORS;

// A fixed random sequence for colour and shape variation (the layout has its own).
function variation(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

// The ground: the meadow, bright yellow-green with long streaks where the wind combs the grass, darker patches,
// the cart ruts; a fine grass texture over it.
function groundMesh() {
  const segments = 110;
  const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, segments, segments).rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const grass = new THREE.Color(C.grass);
  const deep = new THREE.Color(C.grassDeep);
  const light = new THREE.Color(C.grassLight);
  const rut = new THREE.Color(C.rut);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, groundHeight(x, z));
    // Wind streaks: long bands across the field, broken up.
    const streak = Math.sin((x * 0.8 + z * 0.35) * 0.05 + Math.sin(z * 0.03) * 3) * (0.6 + 0.4 * Math.cos(x * 0.011 - z * 0.017));
    const patch = Math.sin(x * 0.045 + 0.5) * Math.cos(z * 0.06) + 0.6 * Math.sin((x - z) * 0.031);
    color.copy(grass).lerp(streak > 0 ? light : deep, Math.min(1, Math.abs(streak) * 0.8)).lerp(deep, Math.max(0, -patch) * 0.35);
    for (const which of [0, 1]) {
      const off = Math.abs(Math.abs(z - trackZ(x, which)) - TRACK_GAP / 2);
      if (off < 0.6) color.lerp(rut, ((0.6 - off) / 0.6) * 0.7);
    }
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const texture = grassTexture();
  texture.repeat.set(GROUND_SIZE / 2.5, GROUND_SIZE / 2.5);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, map: texture }));
  mesh.name = "scenery_ground";
  return mesh;
}

// Grass blades, light on a lighter ground, all leaning one way (the wind), to multiply the ground's colours with.
function grassTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e8e8e8";
  ctx.fillRect(0, 0, size, size);
  const rnd = variation(7);
  for (let i = 0; i < 1400; i += 1) {
    const x = rnd() * size;
    const y = rnd() * size;
    const shade = 165 + Math.floor(rnd() * 90);
    ctx.strokeStyle = `rgb(${shade},${shade},${shade})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 1.5 + rnd() * 2.5, y - 3 - rnd() * 5);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// The sky: a dome that follows the camera, deep blue overhead, paler down to the horizon haze, with a few small
// fair-weather clouds low over the horizon and the sun's soft glow.
function skyDome(sunDirection) {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, C.skyTop);
  gradient.addColorStop(0.3, C.skyMid);
  gradient.addColorStop(0.49, C.horizon);
  gradient.addColorStop(1, C.horizon);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const u = (Math.atan2(sunDirection.x, sunDirection.z) / (Math.PI * 2) + 0.5) * width;
  const v = (Math.acos(Math.min(1, Math.max(-1, sunDirection.y))) / Math.PI) * height;
  const glow = ctx.createRadialGradient(u, v, 0, u, v, 140);
  glow.addColorStop(0, "rgba(255,255,245,0.9)");
  glow.addColorStop(0.2, "rgba(255,255,240,0.35)");
  glow.addColorStop(1, "rgba(255,255,240,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  // Small fair-weather clouds: a few white puffs each, scattered low over the horizon.
  const rnd = variation(11);
  for (let c = 0; c < 26; c += 1) {
    const cx = rnd() * width;
    const cy = height * (0.36 + rnd() * 0.1);
    const w = 14 + rnd() * 24;
    for (let b = 0; b < 7; b += 1) {
      const bx = cx + (rnd() - 0.5) * w * 1.6;
      const by = cy - rnd() * w * 0.25;
      const r = w * (0.25 + rnd() * 0.3);
      for (const dx of [0, -width, width]) {
        const blob = ctx.createRadialGradient(bx + dx, by, 0, bx + dx, by, r);
        blob.addColorStop(0, "rgba(255,255,255,1)");
        blob.addColorStop(0.75, "rgba(250,252,255,0.9)");
        blob.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = blob;
        ctx.beginPath();
        ctx.arc(bx + dx, by, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(240, 32, 16),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  mesh.name = "scenery_sky";
  mesh.renderOrder = -10;
  return mesh;
}

// One instanced mesh of `geometry` for the given places; `shape(place, matrix)` sets each one's transform,
// `tint(place, color)` its colour.
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

// Long grass: a few tall thin blades, yellow-green, lighter at the tips.
function tuftGeometry() {
  const positions = [];
  const colors = [];
  // (Roots in the ground's own green, so the grass melts into it; tips pale.)
  const root = new THREE.Color(0x7aae3a);
  const tip = new THREE.Color(0xd8ec9a);
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2 + 0.4;
    const w = 0.014;
    const h = 0.24 + ((i * 3) % 4) * 0.05;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    positions.push(-w * cz + cx * 0.05, 0, w * cx + cz * 0.05, w * cz + cx * 0.05, 0, -w * cx + cz * 0.05, cx * 0.16 + 0.1, h, cz * 0.16);
    colors.push(root.r, root.g, root.b, root.r, root.g, root.b, tip.r, tip.g, tip.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// The long grass near the view: GRASS_TILE metres square of tufts that moves with the camera (each tuft wraps
// round the tile, so the camera is always in the middle of thick grass), shorter towards the tile's edge so it
// melts into the ground's colour, swaying with the wind.
const GRASS_TILE = 44;
function grassMaterial(wind, viewAt) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = wind;
    shader.uniforms.viewAt = viewAt;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float windTime;\nuniform vec2 viewAt;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vec3 rootAt = instanceMatrix[3].xyz;
        // Where this tuft stands now: its place in the tile, wrapped round the camera.
        vec2 wrapped = mod(rootAt.xz - viewAt + ${(GRASS_TILE / 2).toFixed(1)}, ${GRASS_TILE.toFixed(1)}) - ${(GRASS_TILE / 2).toFixed(1)};
        float edge = 1.0 - smoothstep(${(GRASS_TILE * 0.3).toFixed(1)}, ${(GRASS_TILE * 0.5).toFixed(1)}, length(wrapped));
        // Each tuft its own turn and size (from its place: the instance moves it only, so the offsets below are
        // in the world's metres).
        float seed = fract(sin(dot(rootAt.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float turn = seed * 6.2832;
        transformed = vec3(cos(turn) * transformed.x - sin(turn) * transformed.z, transformed.y, sin(turn) * transformed.x + cos(turn) * transformed.z)
          * (0.7 + seed * 0.7) * edge;
        float sway = sin(windTime * 1.7 + (wrapped.x + viewAt.x) * 0.35 + (wrapped.y + viewAt.y) * 0.2) * 0.6 + sin(windTime * 3.1 + (wrapped.x + viewAt.x) * 1.3) * 0.25;
        transformed.x += sway * 0.22 * position.y;
        transformed.z += sway * 0.07 * position.y;
        transformed.xz += wrapped + viewAt - rootAt.xz;`);
  };
  return material;
}

// A round broadleaf crown: a few lumpy balls.
function roundCrown() {
  const balls = [[0, 3.6, 0, 1.9], [1.1, 3.1, 0.4, 1.4], [-1.0, 3.2, -0.3, 1.5], [0.2, 4.6, 0.2, 1.3]];
  return merge(balls.map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 0).translate(x, y, z)));
}

export function buildScenery(scene, { sunDirection = new THREE.Vector3(14, 18, 8).normalize() } = {}) {
  const layout = sceneryLayout();
  const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const objects = [];
  const add = (mesh) => { objects.push(mesh); scene.add(mesh); return mesh; };
  const wind = { value: 0 };

  add(groundMesh());
  const sky = add(skyDome(sunDirection));

  const rnd = variation(23);
  const leafTint = (t, color) => color.setHex(C.leaves).lerp(new THREE.Color(C.leavesLight), rnd() * 0.6);
  const round = layout.trees.filter((t) => t.kind === "round");
  const tall = layout.trees.filter((t) => t.kind === "tall");
  add(instances("scenery_trunks", new THREE.CylinderGeometry(0.18, 0.28, 2.6, 6).translate(0, 1.3, 0), lambert(C.trunk),
    layout.trees, (t, m) => at(m, t.x, t.y, t.z, t.turn, t.scale)));
  add(instances("scenery_round_trees", roundCrown(), lambert(0xffffff),
    round, (t, m) => at(m, t.x, t.y, t.z, t.turn, t.scale), leafTint));
  add(instances("scenery_tall_trees", new THREE.IcosahedronGeometry(1, 0).scale(1.3, 3.2, 1.3).translate(0, 4.6, 0), lambert(0xffffff),
    tall, (t, m) => at(m, t.x, t.y, t.z, t.turn, t.scale), leafTint));
  const viewAt = { value: new THREE.Vector2() };
  add(instances("scenery_grass", tuftGeometry(), grassMaterial(wind, viewAt),
    layout.tufts, (t, m) => at(m, t.x, 0, t.z, 0, 1)));
  // Soft hills: smooth domes, greener the nearer, fading into the haze (drawn without the fog: they stand past it).
  const near = new THREE.Color(C.hillNear);
  const far = new THREE.Color(C.hillFar);
  add(instances("scenery_hills", hillGeometry(),
    new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false, emissive: 0x1a2a2e, vertexColors: true }),
    layout.hills, (h, m) => at(m, h.x, -1, h.z, 0, h.radius, h.height, h.radius),
    (h, color) => color.copy(near).lerp(far, Math.min(1, Math.max(0, (Math.hypot(h.x, h.z) - 200) / 80)))));

  const counts = { trees: layout.trees.length, hills: layout.hills.length, grass: layout.tufts.length };
  return {
    counts,
    layout,
    // Each frame: the sky stays centred on the camera, the grass sways.
    follow(camera, seconds = 0) { sky.position.copy(camera.position); wind.value = seconds; viewAt.value.set(camera.position.x, camera.position.z); },
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

// A forested hill: a soft cone (rounded top, long gentle foot), its surface lumpy with treetops, darker in the
// hollows (vertex colours multiply the hill's own colour).
function hillGeometry() {
  const geometry = new THREE.CylinderGeometry(0, 1, 1, 48, 10, true).translate(0, 0.5, 0);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const r = Math.hypot(x, z);
    // Height by distance from the middle: rounded top, concave flanks.
    const t = Math.min(1, r);
    const h = Math.pow(Math.cos((t * Math.PI) / 2), 1.6);
    const bump = 0.035 * Math.sin(x * 23 + z * 7) * Math.cos(z * 19 - x * 5) * (1 - t * 0.5);
    position.setY(i, Math.max(0, h + bump));
    const shade = 0.82 + 0.18 * Math.sin(x * 31 + z * 17) * Math.cos(z * 29);
    colors.set([shade, shade, shade], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Geometries as one (all made non-indexed; the attributes they share).
function merge(parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const geometry = new THREE.BufferGeometry();
  for (const name of Object.keys(flat[0].attributes)) {
    if (!flat.every((g) => g.attributes[name])) continue;
    const total = flat.reduce((n, g) => n + g.attributes[name].array.length, 0);
    const array = new Float32Array(total);
    let offset = 0;
    for (const g of flat) { array.set(g.attributes[name].array, offset); offset += g.attributes[name].array.length; }
    geometry.setAttribute(name, new THREE.BufferAttribute(array, flat[0].attributes[name].itemSize));
  }
  return geometry;
}
