// Draws the battlefield's surroundings (the owner, 2026-11-07, after his pictures of meadows; the last sets the
// look: dense long grass going to seed, green below and straw above with a few white flowers, an overcast sky,
// flat soft light, a dark line of round-topped woods on a flat horizon, a post-and-wire fence) from
// M2_SceneryLayout.js. The grass, the woods and the big trees are painted (on canvases, in code) on flat cards
// standing in the scene, so a card shows dozens of blades or a whole stretch of woodland: dense and soft at few
// triangles. One draw call per kind; nothing in it touches the battle.
import * as THREE from "three";
import { GRASS_TILE, GROUND_SIZE, groundHeight, sceneryLayout } from "./M2_SceneryLayout.js";

// The style sheet's colours (the owner's last picture).
export const SCENERY_COLORS = Object.freeze({
  groundOlive: 0x8a8c58, groundGreen: 0x6a7840, groundStraw: 0xb5a674,
  post: 0x6b5a45, wire: 0x8a8c88,
  skyTop: "#d3d9da", horizon: "#e4e7e4", haze: 0xdfe3e1
});
const C = SCENERY_COLORS;

// A fixed random sequence for painting (the layout has its own).
function variation(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

function canvasTexture(width, height, paint, { repeat = false } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext("2d"), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

// A card of long grass: dozens of blades from the bottom edge, curving, dark green below and straw at the top,
// some with seed heads, a few small white flowers; the rest transparent.
function grassCardTexture() {
  return canvasTexture(256, 160, (ctx, w, h) => {
    const rnd = variation(31);
    const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const greens = [[82, 104, 44], [100, 124, 54], [118, 138, 66]];
    const straws = [[196, 178, 124], [212, 196, 142], [182, 172, 118], [170, 156, 124]];
    for (let i = 0; i < 70; i += 1) {
      const x = rnd() * w;
      const tall = 0.45 + rnd() * 0.55;
      const lean = (rnd() - 0.5) * 30;
      const base = greens[Math.floor(rnd() * greens.length)];
      const top = rnd() < 0.7 ? straws[Math.floor(rnd() * straws.length)] : lerp(base, [140, 150, 80], 0.6);
      const steps = 6;
      let px = x;
      let py = h;
      for (let s = 1; s <= steps; s += 1) {
        const t = s / steps;
        const nx = x + lean * t * t;
        const ny = h - h * tall * t;
        const [r, g, b] = lerp(base, top, t);
        ctx.strokeStyle = `rgb(${r},${g},${b})`;
        ctx.lineWidth = (1 - t * 0.55) * (2.2 + rnd() * 1.6);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        px = nx;
        py = ny;
      }
      // A seed head: a slender tuft at the tip.
      if (rnd() < 0.45) {
        const [r, g, b] = rnd() < 0.3 ? [184, 152, 140] : top;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.ellipse(px, py + 4, 1.6, 6 + rnd() * 4, Math.atan2(lean, h) * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let i = 0; i < 7; i += 1) {
      ctx.fillStyle = "rgb(240,238,226)";
      ctx.beginPath();
      ctx.arc(rnd() * w, h * (0.25 + rnd() * 0.45), 1.6 + rnd(), 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// Three cards crossing at 60°, standing on the ground, their normals up (lit like the ground they grow from).
function grassCardGeometry() {
  const positions = [];
  const uvs = [];
  const normals = [];
  const width = 1.1;
  const height = 0.5;
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI;
    const dx = (Math.cos(a) * width) / 2;
    const dz = (Math.sin(a) * width) / 2;
    const quad = [[-dx, 0, -dz, 0, 0], [dx, 0, dz, 1, 0], [dx, height, dz, 1, 1], [-dx, 0, -dz, 0, 0], [dx, height, dz, 1, 1], [-dx, height, -dz, 0, 1]];
    for (const [x, y, z, u, v] of quad) { positions.push(x, y, z); uvs.push(u, v); normals.push(0, 1, 0); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

// The grass round the view: a GRASS_TILE-metre square of cards that wraps round the camera (so the camera is
// always in the middle of the meadow), each turned and sized by where it stands, lower towards the square's edge
// so it melts into the ground, swaying with the wind.
function grassMaterial(wind, viewAt) {
  // (Edges smoothed by the multisampling, alphaToCoverage, so the thin blades do not flicker.)
  const material = new THREE.MeshLambertMaterial({ map: grassCardTexture(), alphaTest: 0.35, alphaToCoverage: true, side: THREE.DoubleSide });
  const half = (GRASS_TILE / 2).toFixed(1);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = wind;
    shader.uniforms.viewAt = viewAt;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float windTime;\nuniform vec2 viewAt;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vec3 rootAt = instanceMatrix[3].xyz;
        vec2 wrapped = mod(rootAt.xz - viewAt + ${half}, ${GRASS_TILE.toFixed(1)}) - ${half};
        vec2 standsAt = wrapped + viewAt;
        float edge = 1.0 - smoothstep(${(GRASS_TILE * 0.32).toFixed(1)}, ${(GRASS_TILE * 0.5).toFixed(1)}, length(wrapped));
        float seed = fract(sin(dot(rootAt.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float turn = seed * 6.2832;
        transformed = vec3(cos(turn) * transformed.x - sin(turn) * transformed.z, transformed.y, sin(turn) * transformed.x + cos(turn) * transformed.z);
        transformed.xz *= 0.8 + seed * 0.5;
        transformed.y *= (0.7 + seed * 0.4) * edge;
        float sway = sin(windTime * 1.3 + standsAt.x * 0.25 + standsAt.y * 0.12) * 0.7 + sin(windTime * 2.9 + standsAt.x * 0.9) * 0.2;
        transformed.x += sway * 0.18 * transformed.y;
        transformed.z += sway * 0.06 * transformed.y;
        transformed.xz += standsAt - rootAt.xz;`);
  };
  return material;
}

// The ground: the meadow seen from further than the grass reaches, olive and straw mottled with green, with a
// fine texture of blades over it.
function groundMesh() {
  const segments = 90;
  const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, segments, segments).rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const olive = new THREE.Color(C.groundOlive);
  const green = new THREE.Color(C.groundGreen);
  const straw = new THREE.Color(C.groundStraw);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, groundHeight(x, z));
    const a = Math.sin(x * 0.043 + 0.5) * Math.cos(z * 0.051) + 0.5 * Math.sin((x - z) * 0.029);
    const b = Math.sin(x * 0.11 + z * 0.07) * Math.cos(z * 0.13 - x * 0.05);
    // Further out, more straw (the seed heads seen across the field).
    const far = Math.min(1, Math.hypot(x, z) / 120);
    color.copy(olive).lerp(green, Math.max(0, a) * 0.5).lerp(straw, Math.max(0, -a) * 0.45 + far * 0.35).multiplyScalar(0.95 + b * 0.05);
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const texture = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#d8d8d8";
    ctx.fillRect(0, 0, w, h);
    const rnd = variation(7);
    for (let i = 0; i < 4000; i += 1) {
      const shade = 140 + Math.floor(rnd() * 115);
      ctx.strokeStyle = `rgb(${shade},${shade},${Math.max(0, shade - 12)})`;
      ctx.lineWidth = 1;
      const x = rnd() * w;
      const y = rnd() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.3) * 3, y - 2 - rnd() * 5);
      ctx.stroke();
    }
  }, { repeat: true });
  texture.repeat.set(GROUND_SIZE / 3, GROUND_SIZE / 3);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, map: texture }));
  mesh.name = "scenery_ground";
  return mesh;
}

// A stretch of woodland, painted: round-topped crowns crowded together, darker below, lighter where the light
// falls on their tops; transparent above the skyline.
function woodsTexture(kind) {
  return canvasTexture(1024, 256, (ctx, w, h) => {
    const rnd = variation(101 + kind * 17);
    const dark = ["#26331d", "#2e3c22", "#34442a", "#3c4c2e"];
    const light = ["#56643c", "#5f6d44", "#6a7650"];
    const crowns = [];
    for (let x = -30; x < w + 30; x += 14 + rnd() * 18) crowns.push({ x, top: h * (0.12 + rnd() * 0.32), r: 26 + rnd() * 34 });
    for (const crown of crowns) {
      for (let b = 0; b < 26; b += 1) {
        const bx = crown.x + (rnd() - 0.5) * crown.r * 1.6;
        const by = crown.top + crown.r * 0.6 + rnd() * (h - crown.top);
        ctx.fillStyle = dark[Math.floor(rnd() * dark.length)];
        ctx.beginPath();
        ctx.arc(bx, by, crown.r * (0.35 + rnd() * 0.45), 0, Math.PI * 2);
        ctx.fill();
      }
      for (let b = 0; b < 10; b += 1) {
        const bx = crown.x + (rnd() - 0.6) * crown.r * 1.1;
        const by = crown.top + crown.r * (0.35 + rnd() * 0.6);
        ctx.fillStyle = light[Math.floor(rnd() * light.length)];
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(bx, by, crown.r * (0.15 + rnd() * 0.25), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // Leaf texture: fine dark and light flecks over the canopy (only where it is painted).
    ctx.globalCompositeOperation = "source-atop";
    for (let i = 0; i < 9000; i += 1) {
      ctx.fillStyle = rnd() < 0.5 ? "rgba(20,28,14,0.35)" : "rgba(110,120,80,0.25)";
      ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
    // Deeper shade at the foot of the woods.
    const foot = ctx.createLinearGradient(0, h * 0.6, 0, h);
    foot.addColorStop(0, "rgba(16,22,12,0)");
    foot.addColorStop(1, "rgba(16,22,12,0.7)");
    ctx.fillStyle = foot;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  });
}

// A big single tree, painted: a trunk and a broad round crown.
function treeTexture(kind) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const rnd = variation(201 + kind * 13);
    ctx.fillStyle = "#3b3226";
    ctx.fillRect(w * 0.47, h * 0.55, w * 0.06, h * 0.45);
    const cx = w / 2;
    const cy = h * 0.42;
    for (let b = 0; b < 70; b += 1) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * w * 0.36;
      ctx.fillStyle = ["#25321c", "#2d3b21", "#364628", "#3e4f2d"][Math.floor(rnd() * 4)];
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.85, 14 + rnd() * 22, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let b = 0; b < 26; b += 1) {
      ctx.fillStyle = "rgba(100,112,72,0.5)";
      ctx.beginPath();
      ctx.arc(cx + (rnd() - 0.65) * w * 0.5, cy - rnd() * h * 0.28, 6 + rnd() * 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-atop";
    for (let i = 0; i < 3000; i += 1) {
      ctx.fillStyle = rnd() < 0.5 ? "rgba(18,24,12,0.4)" : "rgba(120,128,90,0.25)";
      ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
    ctx.globalCompositeOperation = "source-over";
  });
}

// The overcast sky: a dome that follows the camera, pale grey-white, a little brighter at the horizon, with soft
// darker and lighter streaks of cloud.
function skyDome() {
  const texture = canvasTexture(512, 256, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, C.skyTop);
    gradient.addColorStop(0.48, C.horizon);
    gradient.addColorStop(1, C.horizon);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    const rnd = variation(11);
    for (let i = 0; i < 60; i += 1) {
      const x = rnd() * w;
      const y = h * (0.05 + rnd() * 0.4);
      const r = 30 + rnd() * 70;
      const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
      const tone = rnd() < 0.5 ? "190,196,198" : "240,242,240";
      blob.addColorStop(0, `rgba(${tone},0.22)`);
      blob.addColorStop(1, `rgba(${tone},0)`);
      ctx.fillStyle = blob;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(240, 32, 16),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  mesh.name = "scenery_sky";
  mesh.renderOrder = -10;
  return mesh;
}

function instances(name, geometry, material, places, shape) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, places.length));
  mesh.name = name;
  mesh.count = places.length;
  const matrix = new THREE.Matrix4();
  places.forEach((place, i) => { shape(place, matrix); mesh.setMatrixAt(i, matrix); });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

const at = (matrix, x, y, z, turn, sx, sy, sz) => matrix.compose(
  new THREE.Vector3(x, y, z),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn),
  new THREE.Vector3(sx, sy ?? sx, sz ?? sx)
);

// Two painted cards crossed (a big tree holds its shape from any side).
function crossedCards() {
  const one = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).toNonIndexed();
  const two = one.clone().rotateY(Math.PI / 2);
  const geometry = new THREE.BufferGeometry();
  for (const name of ["position", "uv", "normal"]) {
    const a = one.attributes[name];
    const b = two.attributes[name];
    const array = new Float32Array(a.array.length * 2);
    array.set(a.array, 0);
    array.set(b.array, a.array.length);
    geometry.setAttribute(name, new THREE.BufferAttribute(array, a.itemSize));
  }
  return geometry;
}

export function buildScenery(scene) {
  const layout = sceneryLayout();
  const objects = [];
  const add = (mesh) => { objects.push(mesh); scene.add(mesh); return mesh; };
  const wind = { value: 0 };
  const viewAt = { value: new THREE.Vector2() };

  add(groundMesh());
  const sky = add(skyDome());
  add(instances("scenery_grass", grassCardGeometry(), grassMaterial(wind, viewAt), layout.grass, (g, m) => at(m, g.x, 0, g.z, 0, 1)));
  // The woods: painted bands round the horizon (three paintings, used in turn), each facing the field.
  for (let kind = 0; kind < 3; kind += 1) {
    const material = new THREE.MeshBasicMaterial({ map: woodsTexture(kind), alphaTest: 0.5, side: THREE.DoubleSide });
    add(instances(`scenery_woods_${kind}`, new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), material, layout.woods.filter((w) => w.kind === kind),
      (w, m) => at(m, w.x, w.y - 0.5, w.z, w.facing, w.width, w.height, 1)));
  }
  for (let kind = 0; kind < 3; kind += 1) {
    const material = new THREE.MeshBasicMaterial({ map: treeTexture(kind), alphaTest: 0.5, side: THREE.DoubleSide });
    add(instances(`scenery_trees_${kind}`, crossedCards(), material, layout.trees.filter((t) => t.kind === kind),
      (t, m) => at(m, t.x, t.y - 0.2, t.z, 0, 16 * t.scale, 15 * t.scale, 16 * t.scale)));
  }
  // The fence: weathered posts and three wires between them.
  add(instances("scenery_fence_posts", new THREE.BoxGeometry(0.16, 1.3, 0.16).translate(0, 0.62, 0),
    new THREE.MeshLambertMaterial({ color: C.post }), layout.fence, (f, m) => {
      m.compose(new THREE.Vector3(f.x, groundHeight(f.x, f.z), f.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), f.lean), new THREE.Vector3(1, 1, 1));
    }));
  const wire = [];
  for (let i = 1; i < layout.fence.length; i += 1) {
    const a = layout.fence[i - 1];
    const b = layout.fence[i];
    for (const h of [0.45, 0.8, 1.15]) wire.push(a.x, groundHeight(a.x, a.z) + h, a.z, b.x, groundHeight(b.x, b.z) + h - 0.03, b.z);
  }
  const wires = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(wire, 3)),
    new THREE.LineBasicMaterial({ color: C.wire }));
  wires.name = "scenery_fence_wires";
  add(wires);

  const counts = { woods: layout.woods.length, trees: layout.trees.length, fence: layout.fence.length, grass: layout.grass.length };
  return {
    counts,
    layout,
    // Each frame: the sky stays centred on the camera, the grass square follows it and sways.
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
