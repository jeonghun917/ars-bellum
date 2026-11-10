// Draws the battlefield's surroundings (the owner, 2026-11-07, after his pictures: a lush green meadow of long
// grass that flows in the wind, a blue sky with soft clouds, woods along the horizon; no fence) from
// M2_SceneryLayout.js. The grass is single blades, many tens of thousands, drawn in one call: each blade is
// bent by one wind field that rolls across the meadow, and lightens where the wind lays it over, so waves of
// light run through the grass; the ground beyond the blades carries the same waves. Nothing in it touches the
// battle.
import * as THREE from "three";
import { GRASS_TILE, GROUND_SIZE, groundHeight, sceneryLayout } from "./M2_SceneryLayout.js";

// The colours (sRGB hex).
export const SCENERY_COLORS = Object.freeze({
  bladeRoot: 0x3f5d24, bladeMid: 0x7ea445, bladeTip: 0xcadc86, bladeDry: 0xdcd894, flower: 0xf2d81c,
  ground: 0x4a6a2c, groundFar: 0x627f36,
  skyTop: "#4f8ad0", horizon: "#cfe2ef", haze: 0xc9dce8
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
  // Patches of rapeseed in flower (the owner's picture): 0 none, 1 a full yellow field; more of them away
  // from where the battle is fought.
  float flowerField(vec2 p) {
    float n = windNoise(p * 0.028 + 9.0) * 0.8 + windNoise(p * 0.09 + 2.0) * 0.2;
    float afar = smoothstep(25.0, 70.0, length(p));
    return smoothstep(0.6 - 0.1 * afar, 0.7 - 0.1 * afar, n);
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

// One blade: a strip from the root (y 0) to a point (y 1), four segments, x across it from -0.5 to 0.5. Its
// normals point up, so a blade is lit like the meadow it stands in (no hard facets).
function bladeGeometry(count) {
  const positions = [];
  const normals = [];
  const index = [];
  const levels = [0, 0.38, 0.72];
  for (const y of levels) {
    positions.push(-0.5, y, 0, 0.5, y, 0);
    normals.push(0, 1, 0, 0, 1, 0);
  }
  positions.push(0, 1, 0);
  normals.push(0, 1, 0);
  for (let i = 0; i < levels.length - 1; i += 1) {
    const a = i * 2;
    index.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  index.push(4, 5, 6);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(index);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.instanceCount = count;
  return geometry;
}

// The blades round the view: GRASS_TILE metres square, wrapping round the camera (so it is always in the middle
// of the meadow), lower towards the square's edge where the ground's colour takes over. Each blade: where it
// grows, its height, its own lean and tint; the wind bends it downwind and lightens its tip as it lies over.
function grassMesh(layout, wind, viewAt) {
  const { count, seed } = layout.grass;
  const roots = new Float32Array(count * 4);
  const rnd = variation(seed);
  for (let i = 0; i < count; i += 1) roots.set([(rnd() - 0.5) * GRASS_TILE, (rnd() - 0.5) * GRASS_TILE, rnd(), rnd()], i * 4);
  const geometry = bladeGeometry(count);
  geometry.setAttribute("root", new THREE.InstancedBufferAttribute(roots, 4));
  const colour = (hex) => new THREE.Color(hex);
  const uniforms = {
    windTime: wind, viewAt,
    bladeRoot: { value: colour(C.bladeRoot) }, bladeMid: { value: colour(C.bladeMid) },
    bladeTip: { value: colour(C.bladeTip) }, bladeDry: { value: colour(C.bladeDry) }, flower: { value: colour(C.flower) }
  };
  const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  const half = (GRASS_TILE / 2).toFixed(1);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
        attribute vec4 root;
        varying float vAlong;
        varying float vGust;
        varying float vTint;
        varying float vSun;
        varying float vBloom;
        ${WIND_GLSL}`)
      .replace("#include <begin_vertex>", `
        vec2 wrapped = mod(root.xy - viewAt + ${half}, ${GRASS_TILE.toFixed(1)}) - ${half};
        vec2 standsAt = wrapped + viewAt;
        float away = length(wrapped);
        float edge = 1.0 - smoothstep(${(GRASS_TILE * 0.3).toFixed(1)}, ${(GRASS_TILE * 0.5).toFixed(1)}, away);
        float along = position.y;
        float bloom = flowerField(standsAt) * step(0.35, root.w);
        float tall = (0.34 + root.z * 0.34) * (1.0 + 0.45 * bloom) * edge;
        // Wider further off, so the far blades still close up into a meadow.
        float wide = (0.02 + root.w * 0.016) * (1.0 + away * 0.13) * (1.0 - along * 0.9);
        // A flowering stalk carries a head of small yellow flowers at its top.
        wide = mix(wide, (0.07 + root.z * 0.05) * (1.0 + away * 0.1), bloom * step(0.6, along));
        float turn = fract(root.w * 7.31) * 6.2832;
        vec2 across = vec2(cos(turn), sin(turn));
        float gust = windField(standsAt, windTime);
        float flutter = sin(windTime * 3.1 + root.z * 40.0) * 0.06 + sin(windTime * 1.7 + root.w * 25.0) * 0.04;
        float lie = (0.3 + 1.1 * gust + flutter) * along * along;
        lie *= 1.0 - 0.6 * bloom;
        vec2 ownLean = vec2(cos(turn * 1.7), sin(turn * 1.7)) * 0.1 * along * along;
        vec2 bend = (vec2(${WIND_TO[0]}, ${WIND_TO[1]}) * lie + ownLean) * tall;
        vec3 transformed = vec3(standsAt.x + across.x * position.x * wide + bend.x, along * tall * (1.0 - 0.3 * lie), standsAt.y + across.y * position.x * wide + bend.y);
        vAlong = along;
        vGust = gust;
        vSun = sunlit(standsAt, windTime);
        vBloom = bloom;
        vTint = root.z;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform vec3 bladeRoot; uniform vec3 bladeMid; uniform vec3 bladeTip; uniform vec3 bladeDry;
        varying float vAlong;
        varying float vGust;
        varying float vTint;
        varying float vSun;
        varying float vBloom;
        uniform vec3 flower;`)
      .replace("#include <color_fragment>", `
        vec3 tip = mix(bladeTip, bladeDry, smoothstep(0.75, 1.0, vTint));
        vec3 blade = vAlong < 0.5 ? mix(bladeRoot, bladeMid, vAlong * 2.0) : mix(bladeMid, tip, (vAlong - 0.5) * 2.0);
        // Laid over by a gust, the blade shows the sky's light along its length.
        // Each blade its own shade (some darker, some yellower), so the mass is not one flat green.
        blade *= 0.72 + 0.4 * fract(vTint * 13.7);
        blade = mix(blade, blade * vec3(1.12, 1.05, 0.7), smoothstep(0.55, 1.0, fract(vTint * 5.3)) * 0.6);
        // A gust lays the blades over and they catch the light along their length; in sun the tips glow warm
        // (light through the blade), in a cloud's shadow the whole blade sinks into deep green.
        float shine = vGust * vAlong;
        blade = mix(blade, blade * vec3(1.35, 1.28, 0.8) + vec3(0.1, 0.1, 0.02), shine);
        blade *= mix(0.74, 1.18, vSun) * (0.8 + 0.2 * smoothstep(0.0, 0.6, vAlong));
        blade += vec3(0.05, 0.05, 0.0) * vSun * vAlong * vAlong;
        blade = mix(blade, flower * mix(0.8, 1.1, vSun) * (0.9 + 0.2 * vTint), vBloom * smoothstep(0.55, 0.7, vAlong));
        diffuseColor.rgb = blade;`);
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "scenery_grass";
  mesh.frustumCulled = false;
  return mesh;
}

// The ground: the meadow seen from further than the blades reach, green, with the wind's waves running over it
// as over the blades; darker close round the camera, where it is the shade under the blades.
function groundMesh(wind, viewAt) {
  const segments = 90;
  const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, segments, segments).rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) position.setY(i, groundHeight(position.getX(i), position.getZ(i)));
  geometry.computeVertexNormals();
  const uniforms = { windTime: wind, viewAt, near: { value: new THREE.Color(C.ground) }, far: { value: new THREE.Color(C.groundFar) }, flower: { value: new THREE.Color(C.flower) } };
  const material = new THREE.MeshLambertMaterial();
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGroundAt;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGroundAt = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform vec3 near; uniform vec3 far; uniform vec3 flower;
        varying vec2 vGroundAt;
        ${WIND_GLSL}`)
      .replace("#include <color_fragment>", `
        float away = length(vGroundAt - viewAt);
        vec3 meadow = mix(near, far, smoothstep(${(GRASS_TILE * 0.25).toFixed(1)}, ${(GRASS_TILE * 0.55).toFixed(1)}, away));
        float mottle = windNoise(vGroundAt * 0.035 + 3.0);
        meadow *= 0.9 + 0.2 * mottle;
        // A fine grain of grass, so the meadow beyond the blades (and seen from high up) is not a flat colour.
        meadow *= 0.86 + 0.18 * windNoise(vGroundAt * 3.1) + 0.1 * windNoise(vGroundAt * vec2(9.0, 2.2) + 5.0);
        meadow = mix(meadow, flower * (0.6 + 0.35 * windNoise(vGroundAt * 0.9)), flowerField(vGroundAt) * 0.7 * smoothstep(${(GRASS_TILE * 0.3).toFixed(1)}, ${(GRASS_TILE * 0.55).toFixed(1)}, away));
        meadow *= mix(0.74, 1.15, sunlit(vGroundAt, windTime));
        meadow *= 1.0 + 0.45 * windField(vGroundAt, windTime) * smoothstep(${(GRASS_TILE * 0.25).toFixed(1)}, ${(GRASS_TILE * 0.5).toFixed(1)}, away);
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

// The sky: a dome that follows the camera, deep blue overhead, pale at the horizon, with soft white clouds.
function skyDome() {
  const texture = canvasTexture(1024, 512, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, C.skyTop);
    gradient.addColorStop(0.36, "#8db7e2");
    gradient.addColorStop(0.5, C.horizon);
    gradient.addColorStop(1, C.horizon);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    const rnd = variation(11);
    // Clouds: clusters of soft puffs, flattened, thicker towards the horizon.
    for (let c = 0; c < 26; c += 1) {
      const cx = rnd() * w;
      const cy = h * (0.12 + rnd() * 0.34);
      const size = 30 + rnd() * 60 * (cy / h + 0.4);
      for (let p = 0; p < 14; p += 1) {
        for (const shift of [-w, 0, w]) {
          const x = cx + (rnd() - 0.5) * size * 2.6 + shift;
          const y = cy + (rnd() - 0.5) * size * 0.5;
          const r = size * (0.35 + rnd() * 0.5);
          const puff = ctx.createRadialGradient(x, y, 0, x, y, r);
          puff.addColorStop(0, "rgba(255,255,255,0.5)");
          puff.addColorStop(0.6, "rgba(250,252,255,0.22)");
          puff.addColorStop(1, "rgba(250,252,255,0)");
          ctx.fillStyle = puff;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
      }
    }
  });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(240, 48, 24),
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
  const look = new THREE.Vector3();

  add(groundMesh(wind, viewAt));
  const sky = add(skyDome());
  add(grassMesh(layout, wind, viewAt));
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
