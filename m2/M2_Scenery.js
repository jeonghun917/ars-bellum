// Draws the battlefield's surroundings (the owner, 2026-11-10: the drawn grass looked stiff and computer-made;
// use existing assets) from M2_SceneryLayout.js. The meadow is photographed grass: real blades and tufts from
// Poly Haven's CC0 scans, cut out and stood on cards (tools/scenery/build_grass_cards.py, assets/scenery/), tens
// of thousands of cards round the view in three draw calls, swaying with one wind field that rolls across the
// meadow and lightens the grass where a gust lays it over, under drifting patches of sun and cloud shade. The
// sky is a photographed sky (Poly Haven, CC0). Woods along the horizon. Nothing in it touches the battle.
import * as THREE from "three";
import { GRASS_TILE, GROUND_SIZE, groundHeight, sceneryLayout } from "./M2_SceneryLayout.js";

// The colours (sRGB hex).
export const SCENERY_COLORS = Object.freeze({
  ground: 0x6f7a44, groundFar: 0x7a8650,
  haze: 0xaab4c2
});
const C = SCENERY_COLORS;
// Where the wind blows to (x, z), and the wind field shared by the blades and the ground (GLSL).
const WIND_TO = [0.83, 0.56];
const WIND_GLSL = `
  uniform float windTime;
  uniform vec2 viewAt;
  float windHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float windNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(windHash(i), windHash(i + vec2(1.0, 0.0)), u.x), mix(windHash(i + vec2(0.0, 1.0)), windHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // 0 (still) to 1 (a gust laying the grass over), rolling downwind.
  float windField(vec2 p, float t) {
    vec2 to = vec2(${WIND_TO[0]}, ${WIND_TO[1]});
    float down = dot(p, to);
    float across = dot(p, vec2(-to.y, to.x));
    // Long ridges across the wind (as in the owner's picture of grass in waves), rolling downwind.
    vec2 q = vec2(down * 0.11 - t * 0.7, across * 0.035);
    return clamp(0.7 * windNoise(q) + 0.3 * windNoise(q * 2.3 + 13.0), 0.0, 1.0);
  }
  // Sunlight through broken cloud: 0 in a cloud's shadow, 1 in sun; big patches drifting slowly.
  float sunlit(vec2 p, float t) {
    float n = windNoise(p * 0.04 + vec2(${WIND_TO[0]}, ${WIND_TO[1]}) * t * -0.05) * 0.7 + windNoise(p * 0.11 + 4.0) * 0.3;
    return smoothstep(0.32, 0.6, n);
  }`;

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

// Where the scenery's pictures are (next to the page, assets/scenery/).
const ASSET = (name) => new URL(`../assets/scenery/${name}`, import.meta.url).href;
function photo(name, { repeat = false } = {}) {
  const texture = new THREE.TextureLoader().load(ASSET(name));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Three cards crossing at 60°, standing on the ground, normals up (lit like the meadow they stand in).
function grassCardGeometry(count) {
  const positions = [];
  const uvs = [];
  const normals = [];
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI;
    const dx = Math.cos(a) / 2;
    const dz = Math.sin(a) / 2;
    const quad = [[-dx, 0, -dz, 0, 0], [dx, 0, dz, 1, 0], [dx, 1, dz, 1, 1], [-dx, 0, -dz, 0, 0], [dx, 1, dz, 1, 1], [-dx, 1, -dz, 0, 1]];
    for (const [x, y, z, u, v] of quad) { positions.push(x, y, z); uvs.push(u, v); normals.push(0, 1, 0); }
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.instanceCount = count;
  return geometry;
}

// The grass round the view: GRASS_TILE metres square of cards, wrapping round the camera (so it is always in
// the middle of the meadow), lower towards the square's edge where the ground's colour takes over. Each card is
// turned, sized and tinted by its own numbers; the wind bends its top downwind and lightens it in a gust.
function grassMeshes(layout, wind, viewAt) {
  const { count, seed } = layout.grass;
  const rnd = variation(seed);
  const half = (GRASS_TILE / 2).toFixed(1);
  return [0, 1, 2].map((kind) => {
    const share = Math.floor(count / 3);
    const roots = new Float32Array(share * 4);
    for (let i = 0; i < share; i += 1) roots.set([(rnd() - 0.5) * GRASS_TILE, (rnd() - 0.5) * GRASS_TILE, rnd(), rnd()], i * 4);
    const geometry = grassCardGeometry(share);
    geometry.setAttribute("root", new THREE.InstancedBufferAttribute(roots, 4));
    const material = new THREE.MeshLambertMaterial({ map: photo(`grass_card_${kind}.webp`), alphaTest: 0.45, alphaToCoverage: true, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.windTime = wind;
      shader.uniforms.viewAt = viewAt;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>
          attribute vec4 root;
          varying float vAlong;
          varying float vGust;
          varying float vSun;
          varying float vTint;
          ${WIND_GLSL}`)
        .replace("#include <begin_vertex>", `
          vec2 wrapped = mod(root.xy - viewAt + ${half}, ${GRASS_TILE.toFixed(1)}) - ${half};
          vec2 standsAt = wrapped + viewAt;
          float away = length(wrapped);
          float edge = 1.0 - smoothstep(${(GRASS_TILE * 0.3).toFixed(1)}, ${(GRASS_TILE * 0.5).toFixed(1)}, away);
          float along = position.y;
          float turn = root.w * 6.2832;
          float wide = 1.2 + root.z * 0.5;
          float tall = (0.42 + root.z * 0.22) * edge;
          vec2 spread = vec2(cos(turn) * position.x - sin(turn) * position.z, sin(turn) * position.x + cos(turn) * position.z) * wide;
          float gust = windField(standsAt, windTime);
          float flutter = sin(windTime * 2.3 + root.z * 30.0) * 0.05;
          float lie = (0.12 + 0.5 * gust + flutter) * along * along;
          vec2 bend = vec2(${WIND_TO[0]}, ${WIND_TO[1]}) * lie * tall;
          vec3 transformed = vec3(standsAt.x + spread.x + bend.x, along * tall * (1.0 - 0.25 * lie), standsAt.y + spread.y + bend.y);
          vAlong = along;
          vGust = gust;
          vSun = sunlit(standsAt, windTime);
          vTint = root.z;`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
          varying float vAlong;
          varying float vGust;
          varying float vSun;
          varying float vTint;`)
        // Both faces of a card lit alike, as the meadow (otherwise the back faces turn dark: black specks).
        .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n          normal = normalize(vNormal);")
        .replace("#include <map_fragment>", `#include <map_fragment>
          // The photograph's colour, a little greener or yellower card by card; lit in sun, shaded under cloud;
          // brighter along the blades where a gust lays them over.
          diffuseColor.rgb *= mix(vec3(0.84, 1.08, 0.72), vec3(0.98, 1.06, 0.7), vTint);
          diffuseColor.rgb *= mix(0.82, 1.12, vSun) * (0.9 + 0.1 * vAlong) * (1.0 + vGust * vAlong * 0.35);`);
    };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `scenery_grass_${kind}`;
    mesh.frustumCulled = false;
    return mesh;
  });
}

// The ground: the meadow seen from further than the blades reach, green, with the wind's waves running over it
// as over the blades; darker close round the camera, where it is the shade under the blades.
function groundMesh(wind, viewAt) {
  const segments = 90;
  const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, segments, segments).rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) position.setY(i, groundHeight(position.getX(i), position.getZ(i)));
  geometry.computeVertexNormals();
  const uniforms = { windTime: wind, viewAt, near: { value: new THREE.Color(C.ground) }, far: { value: new THREE.Color(C.groundFar) } };
  const material = new THREE.MeshLambertMaterial();
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGroundAt;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGroundAt = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform vec3 near; uniform vec3 far;
        varying vec2 vGroundAt;
        ${WIND_GLSL}`)
      .replace("#include <color_fragment>", `
        float away = length(vGroundAt - viewAt);
        vec3 meadow = mix(near, far, smoothstep(${(GRASS_TILE * 0.25).toFixed(1)}, ${(GRASS_TILE * 0.55).toFixed(1)}, away));
        float mottle = windNoise(vGroundAt * 0.035 + 3.0);
        meadow *= 0.9 + 0.2 * mottle;
        // A fine grain of grass, so the meadow beyond the blades (and seen from high up) is not a flat colour.
        meadow *= 0.86 + 0.18 * windNoise(vGroundAt * 3.1) + 0.1 * windNoise(vGroundAt * vec2(9.0, 2.2) + 5.0);
        meadow *= mix(0.74, 1.15, sunlit(vGroundAt, windTime));
        meadow *= 1.0 + 0.25 * windField(vGroundAt, windTime) * smoothstep(${(GRASS_TILE * 0.25).toFixed(1)}, ${(GRASS_TILE * 0.5).toFixed(1)}, away);
        diffuseColor.rgb = meadow;`);
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "scenery_ground";
  return mesh;
}

// A stretch of woodland, painted: round-topped crowns crowded together, darker below, lighter where the light
// falls on their tops; transparent above the skyline.
function woodsTexture(kind) {
  return canvasTexture(1024, 256, (ctx, w, h) => {
    const rnd = variation(101 + kind * 17);
    const dark = ["#2a4a1e", "#305424", "#3a5e2a", "#436a30"];
    const light = ["#6a9440", "#78a24a", "#86ad58"];
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
      ctx.fillStyle = rnd() < 0.5 ? "rgba(20,36,14,0.3)" : "rgba(140,170,90,0.22)";
      ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
    // Deeper shade at the foot of the woods.
    const foot = ctx.createLinearGradient(0, h * 0.6, 0, h);
    foot.addColorStop(0, "rgba(16,22,12,0)");
    foot.addColorStop(1, "rgba(16,30,12,0.55)");
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
      ctx.fillStyle = ["#2a4a1e", "#305424", "#3a5e2a", "#436a30"][Math.floor(rnd() * 4)];
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.85, 14 + rnd() * 22, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let b = 0; b < 26; b += 1) {
      ctx.fillStyle = "rgba(120,160,80,0.5)";
      ctx.beginPath();
      ctx.arc(cx + (rnd() - 0.65) * w * 0.5, cy - rnd() * h * 0.28, 6 + rnd() * 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-atop";
    for (let i = 0; i < 3000; i += 1) {
      ctx.fillStyle = rnd() < 0.5 ? "rgba(18,34,12,0.35)" : "rgba(140,170,90,0.22)";
      ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
    ctx.globalCompositeOperation = "source-over";
  });
}

// The sky: a photographed sky (Poly Haven, "Kloofendal 48d Partly Cloudy (Pure Sky)", CC0) on a dome that
// follows the camera.
function skyDome() {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(240, 48, 24),
    new THREE.MeshBasicMaterial({ map: photo("sky_partly_cloudy.jpg"), side: THREE.BackSide, fog: false, depthWrite: false })
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
  const look = new THREE.Vector3();

  add(groundMesh(wind, viewAt));
  const sky = add(skyDome());
  for (const mesh of grassMeshes(layout, wind, viewAt)) add(mesh);
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
  const counts = { woods: layout.woods.length, trees: layout.trees.length, grass: layout.grass.count };
  return {
    counts,
    layout,
    // Each frame: the sky stays centred on the camera, the grass square follows it and sways.
    follow(camera, seconds = 0) {
      sky.position.copy(camera.position);
      wind.value = seconds;
      // The blades centred between the camera and the ground it looks at (from high up, on what it sees).
      camera.getWorldDirection(look);
      const reach = look.y < -0.05 ? Math.min(60, camera.position.y / -look.y) : 0;
      const shift = Math.min(reach * 0.6, GRASS_TILE * 0.5);
      const flat = Math.hypot(look.x, look.z) || 1;
      viewAt.value.set(camera.position.x + (look.x / flat) * shift, camera.position.z + (look.z / flat) * shift);
    },
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
