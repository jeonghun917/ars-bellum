import * as THREE from "../vendor/three/r184/three.module.min.js";
import { M2_CONFIG } from "./M2_Config.js";
import { clone as cloneSkinned } from "../vendor/three/r184/addons/utils/SkeletonUtils.js";

// Soldier models made in Blender (see M2_SoldierModels.js), one per side. Set before the runtime starts;
// without them the renderer draws the simple box soldiers below.
let soldierModels = null;
export function useSoldierModels(models) {
  soldierModels = models || null;
}

// A Blender soldier: its own copy of the side's rigged model (the skeleton is copied, meshes and materials
// are shared), the same ground shadow and player ring as the box soldier, and an animator.
function createModelSoldier(model, markerMaterial, geometries, shadowMaterial, loadout) {
  const group = new THREE.Group();
  const soldier = cloneSkinned(model.scene);
  soldier.traverse((object) => {
    // The bounds of a skinned mesh are those of its rest pose; a fallen soldier lies outside them.
    if (object.isSkinnedMesh) object.frustumCulled = false;
  });
  // Near the camera the full model, further than FAR_MODEL_DISTANCE the simpler one. Both are bound to the
  // same skeleton, so one animator moves whichever is shown.
  const near = soldier.getObjectByName("soldier");
  const far = soldier.getObjectByName("soldier_far");
  if (near && far) {
    const lod = new THREE.LOD();
    near.parent.add(lod);
    lod.addLevel(near, 0);
    lod.addLevel(far, FAR_MODEL_DISTANCE);
  }
  group.add(soldier);
  const shadow = new THREE.Mesh(geometries.shadow, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  group.add(shadow);
  if (markerMaterial) {
    const marker = new THREE.Mesh(geometries.marker, markerMaterial);
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.02;
    group.add(marker);
  }
  group.userData.animator = new SoldierAnimator(soldier, model.clips, loadout, model.gait);
  return group;
}

// Beyond this distance (metres) from the camera a soldier is drawn with the simpler model.
const FAR_MODEL_DISTANCE = 14;

// Which clip plays each role, for a spearman and for a swordsman.
const LOADOUT_CLIPS = Object.freeze({
  spear: Object.freeze({ idle: "idle", walk: "walk", run: "run", attack: "attack", block: "block", death: "death" }),
  sword: Object.freeze({ idle: "s_idle", walk: "s_walk", run: "s_run", attack: "s_attack", block: "s_block", death: "s_death" })
});

// Below this speed (m/s) a soldier who is meant to be moving stands.
const STANDING_SPEED = 0.15;

// Picks a soldier's animation from its state each frame: idle, walk or run by how fast he actually moves
// (played at his speed / the clip's, so his feet keep to the ground), block (held), death (held), and an
// attack played once each time the attack cooldown restarts. A swordsman first draws his sword.
class SoldierAnimator {
  #mixer;
  #actions;
  #base = null;
  #attack;
  #lastCooldown = 0;
  #draw = null;

  #gait;

  constructor(root, clips, loadout = "spear", gait = { walk: 1.3, run: 3.2 }) {
    this.#gait = gait;
    this.#mixer = new THREE.AnimationMixer(root);
    const roles = LOADOUT_CLIPS[loadout] || LOADOUT_CLIPS.spear;
    this.#actions = Object.fromEntries(Object.entries(roles).map(([role, name]) => [role, this.#mixer.clipAction(clips[name])]));
    for (const name of ["block", "death"]) {
      this.#actions[name].setLoop(THREE.LoopOnce, 1);
      this.#actions[name].clampWhenFinished = true;
    }
    this.#attack = this.#actions.attack;
    this.#attack.setLoop(THREE.LoopOnce, 1);
    if (loadout === "sword" && clips.draw) {
      this.#draw = this.#mixer.clipAction(clips.draw);
      this.#draw.setLoop(THREE.LoopOnce, 1);
      this.#draw.clampWhenFinished = true;
      this.#draw.play();
      this.#base = "draw";
    } else {
      this.#play("idle");
    }
  }

  #play(name) {
    if (this.#base === name) return;
    const next = this.#actions[name];
    next.reset().play();
    const previous = this.#base === "draw" ? this.#draw : this.#actions[this.#base];
    // Between walking and running, carry on from the same point of the stride: the feet stay in step.
    if (previous && (name === "walk" || name === "run") && (this.#base === "walk" || this.#base === "run")) {
      next.time = (previous.time / previous.getClip().duration) * next.getClip().duration;
    }
    if (previous) next.crossFadeFrom(previous, name === "death" ? 0.12 : 0.25, false);
    this.#base = name;
  }

  get playing() {
    return this.#base;
  }

  // speed: how fast (m/s) the soldier is moving across the ground, as drawn.
  update(unit, deltaSeconds, speed = 0) {
    const down = unit.state === "dead" || unit.state === "incapacitated";
    // The draw plays to the end before anything but a fall interrupts it.
    if (this.#base === "draw" && !down && this.#draw.time < this.#draw.getClip().duration) {
      this.#mixer.update(deltaSeconds);
      return;
    }
    if (down) this.#play("death");
    else if (unit.blocking) this.#play("block");
    else if ((unit.state === "moving" || unit.state === "routing") && speed > STANDING_SPEED) {
      const gait = speed > (this.#gait.walk + this.#gait.run) / 2 ? "run" : "walk";
      this.#play(gait);
      const range = gait === "run" ? [0.6, 1.5] : [0.4, 1.7];
      this.#actions[gait].timeScale = Math.min(range[1], Math.max(range[0], speed / this.#gait[gait]));
    } else this.#play("idle");
    const cooldown = unit.attackCooldownTicks || 0;
    if (!down && cooldown > this.#lastCooldown) this.#attack.reset().setEffectiveWeight(1).fadeIn(0.06).play();
    this.#lastCooldown = cooldown;
    this.#mixer.update(deltaSeconds);
  }
}

// A soft round shadow under each soldier: much cheaper than real shadows and enough to ground them.
function createHumanoid(material, markerMaterial, geometries, shadowMaterial) {
  const group = new THREE.Group();
  const shadow = new THREE.Mesh(geometries.shadow, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  group.add(shadow);
  const body = new THREE.Mesh(geometries.body, material);
  body.position.y = 1.22;
  const head = new THREE.Mesh(geometries.head, material);
  head.position.y = 1.92;
  const leftArm = new THREE.Mesh(geometries.arm, material);
  const rightArm = new THREE.Mesh(geometries.arm, material);
  const leftLeg = new THREE.Mesh(geometries.leg, material);
  const rightLeg = new THREE.Mesh(geometries.leg, material);
  leftArm.position.set(-0.4, 1.25, 0);
  rightArm.position.set(0.4, 1.25, 0);
  leftLeg.position.set(-0.17, 0.48, 0);
  rightLeg.position.set(0.17, 0.48, 0);
  group.add(body, head, leftArm, rightArm, leftLeg, rightLeg);
  if (markerMaterial) {
    const marker = new THREE.Mesh(geometries.marker, markerMaterial);
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.02;
    group.add(marker);
  }
  group.userData.parts = { body, leftArm, rightArm, leftLeg, rightLeg };
  group.userData.bodyBaseY = body.position.y;
  return group;
}

// Sky: a vertical gradient from deep blue overhead to a pale haze at the horizon (the fog colour).
function createSkyTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, "#3d6f9c");
  gradient.addColorStop(0.55, "#8fb3cc");
  gradient.addColorStop(1, "#" + M2_CONFIG.backgroundColor.toString(16).padStart(6, "0"));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Ground: a wide field with gentle patches of lighter and darker grass. The pattern is fixed (no random
// numbers), so every load looks the same.
function createGroundGeometry() {
  const geometry = new THREE.PlaneGeometry(180, 180, 90, 90);
  const base = new THREE.Color(M2_CONFIG.groundColor);
  const dry = new THREE.Color(0x8a8a55);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const patch = Math.sin(x * 0.11) * Math.cos(y * 0.13) + Math.sin((x + y) * 0.047) * 0.8;
    const fine = Math.sin(x * 0.9 + y * 0.37) * Math.cos(y * 0.83 - x * 0.21);
    color.copy(base).lerp(dry, Math.max(0, patch) * 0.32);
    color.multiplyScalar(0.94 + fine * 0.05 + Math.min(0, patch) * 0.06);
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export class M2RendererThree {
  #canvas;
  #renderer;
  #scene;
  #camera;
  #units = new Map();
  #projectiles = new Map();
  #formationMarkers = new Map();
  #geometries;
  #materials;
  #resizeHandler;
  #raycaster = new THREE.Raycaster();
  #groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  #skyTexture = null;
  #lastElapsed = null;
  #disposed = false;

  constructor(canvas) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("m2_render_canvas_missing");
    this.#canvas = canvas;
    const context = canvas.getContext("webgl2", { antialias: true, alpha: false, powerPreference: "high-performance" });
    if (!context) throw new Error("m2_render_webgl2_unavailable");
    this.#renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: false });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.#renderer.setClearColor(M2_CONFIG.backgroundColor, 1);
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.#scene = new THREE.Scene();
    this.#skyTexture = createSkyTexture();
    this.#scene.background = this.#skyTexture;
    this.#scene.fog = new THREE.Fog(M2_CONFIG.backgroundColor, 45, 120);
    this.#camera = new THREE.PerspectiveCamera(M2_CONFIG.camera.fov, 1, M2_CONFIG.camera.near, M2_CONFIG.camera.far);
    this.#camera.position.set(M2_CONFIG.camera.x, M2_CONFIG.camera.y, M2_CONFIG.camera.z);
    this.#camera.lookAt(0, 0.9, 0);

    const hemisphere = new THREE.HemisphereLight(0xcfe2f0, 0x4a5236, 1.9);
    const sun = new THREE.DirectionalLight(0xffe6bf, 2.4);
    sun.position.set(14, 18, 8);
    this.#scene.add(hemisphere, sun);

    this.#geometries = Object.freeze({
      body: new THREE.BoxGeometry(0.55, 0.82, 0.34),
      head: new THREE.IcosahedronGeometry(0.24, 1),
      arm: new THREE.BoxGeometry(0.16, 0.72, 0.16),
      leg: new THREE.BoxGeometry(0.18, 0.78, 0.2),
      marker: new THREE.RingGeometry(0.48, 0.62, 24),
      projectile: new THREE.SphereGeometry(0.09, 8, 6),
      formation: new THREE.RingGeometry(0.72, 0.82, 24),
      shadow: new THREE.CircleGeometry(0.42, 16),
      ground: createGroundGeometry()
    });
    this.#materials = Object.freeze({
      ground: new THREE.MeshLambertMaterial({ vertexColors: true }),
      shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
      ally: new THREE.MeshLambertMaterial({ color: M2_CONFIG.allyColor }),
      enemy: new THREE.MeshLambertMaterial({ color: M2_CONFIG.enemyColor }),
      marker: new THREE.MeshBasicMaterial({ color: M2_CONFIG.playerMarkerColor, side: THREE.DoubleSide }),
      projectileAlly: new THREE.MeshBasicMaterial({ color: M2_CONFIG.projectileAllyColor }),
      projectileEnemy: new THREE.MeshBasicMaterial({ color: M2_CONFIG.projectileEnemyColor }),
      formation: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.55 })
    });

    const ground = new THREE.Mesh(this.#geometries.ground, this.#materials.ground);
    ground.rotation.x = -Math.PI / 2;
    this.#scene.add(ground);

    this.#resizeHandler = () => this.resize();
    window.addEventListener("resize", this.#resizeHandler, { passive: true });
    this.resize();
  }

  loadRenderSnapshot(renderSnapshot, combatProfiles) {
    if (this.#disposed) throw new Error("m2_runtime_disposed");
    for (const entry of this.#units.values()) this.#scene.remove(entry.group);
    this.#units.clear();
    for (const unit of renderSnapshot.units) {
      const marker = unit.isPlayer ? this.#materials.marker : null;
      const model = soldierModels?.[unit.sideId === "ally" ? "ally" : "enemy"];
      // Every other soldier on each side fights with the sword, the rest (and the player) with the spear.
      const loadout = !unit.isPlayer && this.#units.size % 2 === 1 ? "sword" : "spear";
      const group = model
        ? createModelSoldier(model, marker, this.#geometries, this.#materials.shadow, loadout)
        : createHumanoid(unit.sideId === "ally" ? this.#materials.ally : this.#materials.enemy, marker, this.#geometries, this.#materials.shadow);
      const profile = combatProfiles.get(unit.combatProfileId);
      group.scale.setScalar(0.9 + ((profile?.stats?.vitality || 0) / 100) * 0.18);
      this.#scene.add(group);
      this.#units.set(unit.unitId, { group, phaseOffset: this.#units.size * 0.73 });
      // Start each soldier's idle at a different point, so a rank does not breathe in step.
      group.userData.animator?.update(unit, (this.#units.size * 0.37) % 2);
    }
    // Prepare every material's shader now, while the battle is loading, instead of stalling the first frame.
    this.#renderer.compile(this.#scene, this.#camera);
  }

  setAnimationLoop(callback) {
    if (this.#disposed && callback) throw new Error("m2_runtime_disposed");
    this.#renderer.setAnimationLoop(callback);
  }

  applyCameraPose(pose) {
    if (this.#disposed || !pose) return;
    this.#camera.position.set(pose.position.x, Math.max(0.1, pose.position.y), pose.position.z);
    this.#camera.lookAt(pose.target.x, Math.max(0, pose.target.y), pose.target.z);
  }

  screenPointToGround(clientX, clientY) {
    if (this.#disposed) return null;
    const rect = this.#canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1)
    );
    this.#raycaster.setFromCamera(ndc, this.#camera);
    const hit = new THREE.Vector3();
    if (!this.#raycaster.ray.intersectPlane(this.#groundPlane, hit)) return null;
    return { x: hit.x, z: hit.z };
  }

  #syncProjectiles(renderSnapshot, alpha) {
    const current = new Set();
    for (const projectile of renderSnapshot.projectiles) {
      current.add(projectile.projectileId);
      let mesh = this.#projectiles.get(projectile.projectileId);
      if (!mesh) {
        const material = projectile.sideId === "ally" ? this.#materials.projectileAlly : this.#materials.projectileEnemy;
        mesh = new THREE.Mesh(this.#geometries.projectile, material);
        this.#scene.add(mesh);
        this.#projectiles.set(projectile.projectileId, mesh);
      }
      mesh.position.set(
        projectile.previousPosition.x + (projectile.position.x - projectile.previousPosition.x) * alpha,
        projectile.previousPosition.y + (projectile.position.y - projectile.previousPosition.y) * alpha,
        projectile.previousPosition.z + (projectile.position.z - projectile.previousPosition.z) * alpha
      );
    }
    for (const [id, mesh] of this.#projectiles) {
      if (!current.has(id)) {
        this.#scene.remove(mesh);
        this.#projectiles.delete(id);
      }
    }
  }

  #syncFormationMarkers(renderSnapshot) {
    const current = new Set();
    for (const formation of renderSnapshot.formations) {
      if (!formation.selected) continue;
      current.add(formation.formationId);
      let marker = this.#formationMarkers.get(formation.formationId);
      if (!marker) {
        marker = new THREE.Mesh(this.#geometries.formation, this.#materials.formation);
        marker.rotation.x = -Math.PI / 2;
        marker.position.y = 0.03;
        this.#scene.add(marker);
        this.#formationMarkers.set(formation.formationId, marker);
      }
      marker.position.x = formation.anchor.x;
      marker.position.z = formation.anchor.z;
    }
    for (const [id, marker] of this.#formationMarkers) {
      if (!current.has(id)) {
        this.#scene.remove(marker);
        this.#formationMarkers.delete(id);
      }
    }
  }

  render(renderSnapshot, interpolationAlpha, elapsedSeconds) {
    if (this.#disposed || !renderSnapshot) return;
    const alpha = Math.max(0, Math.min(1, Number(interpolationAlpha) || 0));
    const now = Number(elapsedSeconds) || 0;
    const deltaSeconds = this.#lastElapsed === null ? 0 : Math.max(0, Math.min(0.1, now - this.#lastElapsed));
    this.#lastElapsed = now;
    for (const unit of renderSnapshot.units) {
      const actor = this.#units.get(unit.unitId);
      if (!actor) continue;
      const group = actor.group;
      const lastX = group.position.x;
      const lastZ = group.position.z;
      group.position.set(
        unit.previousPosition.x + (unit.position.x - unit.previousPosition.x) * alpha,
        unit.previousPosition.y + (unit.position.y - unit.previousPosition.y) * alpha,
        unit.previousPosition.z + (unit.position.z - unit.previousPosition.z) * alpha
      );
      // Ground speed as drawn, smoothed over about a tenth of a second (ticks and frames do not line up).
      if (deltaSeconds > 0 && actor.placed) {
        const measured = Math.hypot(group.position.x - lastX, group.position.z - lastZ) / deltaSeconds;
        actor.speed = (actor.speed || 0) + (measured - (actor.speed || 0)) * Math.min(1, deltaSeconds * 10);
      }
      actor.placed = true;
      group.rotation.y = unit.heading;
      const animator = group.userData.animator;
      if (animator) {
        // A Blender soldier stays on the field when he falls; his animator plays the fall.
        animator.update(unit, deltaSeconds, actor.speed || 0);
        continue;
      }
      group.visible = unit.state !== "dead";
      const parts = group.userData.parts;
      const movementWeight = unit.state === "moving" ? 1 : 0;
      const swing = Math.sin(elapsedSeconds * 6 + actor.phaseOffset) * 0.18 * movementWeight;
      parts.body.position.y = group.userData.bodyBaseY + Math.abs(swing) * 0.05;
      parts.leftArm.rotation.x = unit.blocking ? -0.9 : swing;
      parts.rightArm.rotation.x = unit.blocking ? -0.9 : -swing;
      parts.leftLeg.rotation.x = -swing * 0.7;
      parts.rightLeg.rotation.x = swing * 0.7;
      group.scale.y = unit.state === "incapacitated" ? 0.25 : 1;
    }
    this.#syncProjectiles(renderSnapshot, alpha);
    this.#syncFormationMarkers(renderSnapshot);
    this.#renderer.render(this.#scene, this.#camera);
  }

  getInfo() {
    const info = this.#renderer.info.render;
    // How many Blender soldiers are playing each animation (idle, walk, run, ...).
    const soldierAnimations = {};
    for (const { group } of this.#units.values()) {
      const playing = group.userData.animator?.playing;
      if (playing) soldierAnimations[playing] = (soldierAnimations[playing] || 0) + 1;
    }
    return {
      soldierAnimations,
      drawCalls: info.calls,
      triangles: info.triangles,
      renderedUnits: this.#units.size,
      renderedProjectiles: this.#projectiles.size,
      soldierModel: soldierModels ? "blender" : "box"
    };
  }

  resize() {
    if (this.#disposed) return;
    const width = Math.max(1, this.#canvas.clientWidth);
    const height = Math.max(1, this.#canvas.clientHeight);
    this.#renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    // An upright phone screen is narrow: widen the view so the same soldiers stay in frame.
    this.#camera.fov = this.#camera.aspect < 1 ? 76 : M2_CONFIG.camera.fov;
    this.#camera.updateProjectionMatrix();
  }

  dispose() {
    if (this.#disposed) return;
    this.#renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.#resizeHandler);
    for (const geometry of Object.values(this.#geometries)) geometry.dispose();
    for (const material of Object.values(this.#materials)) material.dispose();
    this.#skyTexture?.dispose();
    this.#renderer.dispose();
    this.#units.clear();
    this.#projectiles.clear();
    this.#formationMarkers.clear();
    this.#disposed = true;
  }
}
