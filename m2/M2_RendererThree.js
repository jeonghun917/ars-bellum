import * as THREE from "../vendor/three/r184/three.module.min.js";
import { M2_CONFIG } from "./M2_Config.js";

function createHumanoid(material, markerMaterial, geometries) {
  const group = new THREE.Group();
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
  return group;
}

export class M2RendererThree {
  #canvas;
  #renderer;
  #scene;
  #camera;
  #units = new Map();
  #geometries;
  #materials;
  #resizeHandler;
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
    this.#scene.fog = new THREE.Fog(M2_CONFIG.backgroundColor, 24, 65);
    this.#camera = new THREE.PerspectiveCamera(
      M2_CONFIG.camera.fov,
      1,
      M2_CONFIG.camera.near,
      M2_CONFIG.camera.far
    );
    this.#camera.position.set(M2_CONFIG.camera.x, M2_CONFIG.camera.y, M2_CONFIG.camera.z);
    this.#camera.lookAt(0, 0.9, 0);

    const hemisphere = new THREE.HemisphereLight(0xbfd7e4, 0x3c4432, 1.8);
    const sun = new THREE.DirectionalLight(0xfff1cf, 2.2);
    sun.position.set(8, 14, 6);
    this.#scene.add(hemisphere, sun);

    this.#geometries = Object.freeze({
      body: new THREE.BoxGeometry(0.55, 0.82, 0.34),
      head: new THREE.IcosahedronGeometry(0.24, 1),
      arm: new THREE.BoxGeometry(0.16, 0.72, 0.16),
      leg: new THREE.BoxGeometry(0.18, 0.78, 0.2),
      marker: new THREE.RingGeometry(0.48, 0.62, 24),
      ground: new THREE.PlaneGeometry(42, 42)
    });

    this.#materials = Object.freeze({
      ground: new THREE.MeshLambertMaterial({ color: M2_CONFIG.groundColor }),
      ally: new THREE.MeshLambertMaterial({ color: M2_CONFIG.allyColor }),
      enemy: new THREE.MeshLambertMaterial({ color: M2_CONFIG.enemyColor }),
      marker: new THREE.MeshBasicMaterial({ color: M2_CONFIG.playerMarkerColor, side: THREE.DoubleSide })
    });

    const ground = new THREE.Mesh(this.#geometries.ground, this.#materials.ground);
    ground.rotation.x = -Math.PI / 2;
    this.#scene.add(ground);

    const grid = new THREE.GridHelper(42, 42, 0x73806a, 0x596153);
    grid.position.y = 0.012;
    this.#scene.add(grid);

    this.#resizeHandler = () => this.resize();
    window.addEventListener("resize", this.#resizeHandler, { passive: true });
    this.resize();
  }

  loadRenderSnapshot(renderSnapshot, combatProfiles) {
    if (this.#disposed) throw new Error("m2_runtime_disposed");
    for (const entry of this.#units.values()) this.#scene.remove(entry.group);
    this.#units.clear();

    for (const unit of renderSnapshot.units) {
      const material = unit.sideId === "ally" ? this.#materials.ally : this.#materials.enemy;
      const group = createHumanoid(material, unit.isPlayer ? this.#materials.marker : null, this.#geometries);
      group.position.set(unit.position.x, unit.position.y, unit.position.z);
      group.rotation.y = unit.heading;
      const profile = combatProfiles.get(unit.combatProfileId);
      group.scale.setScalar(0.9 + ((profile?.stats?.vitality || 0) / 100) * 0.18);
      this.#scene.add(group);
      this.#units.set(unit.unitId, {
        group,
        phaseOffset: this.#units.size * 0.73
      });
    }
  }

  setAnimationLoop(callback) {
    if (this.#disposed && callback) throw new Error("m2_runtime_disposed");
    this.#renderer.setAnimationLoop(callback);
  }

  render(renderSnapshot, interpolationAlpha, elapsedSeconds) {
    if (this.#disposed) return;
    const alpha = Math.max(0, Math.min(1, Number(interpolationAlpha) || 0));

    for (const unit of renderSnapshot.units) {
      const actor = this.#units.get(unit.unitId);
      if (!actor) continue;
      const group = actor.group;
      group.position.set(
        unit.previousPosition.x + (unit.position.x - unit.previousPosition.x) * alpha,
        unit.previousPosition.y + (unit.position.y - unit.previousPosition.y) * alpha,
        unit.previousPosition.z + (unit.position.z - unit.previousPosition.z) * alpha
      );
      group.rotation.y = unit.heading;

      const movementWeight = unit.state === "moving" ? 1 : 0;
      const swing = Math.sin(elapsedSeconds * 6 + actor.phaseOffset) * 0.18 * movementWeight;
      const parts = group.userData.parts;
      parts.body.position.y = 1.22 + Math.abs(swing) * 0.05;
      parts.leftArm.rotation.x = swing;
      parts.rightArm.rotation.x = -swing;
      parts.leftLeg.rotation.x = -swing * 0.7;
      parts.rightLeg.rotation.x = swing * 0.7;
    }
    this.#renderer.render(this.#scene, this.#camera);
  }

  getInfo() {
    const info = this.#renderer.info.render;
    return { drawCalls: info.calls, triangles: info.triangles, renderedUnits: this.#units.size };
  }

  resize() {
    if (this.#disposed) return;
    const width = Math.max(1, this.#canvas.clientWidth);
    const height = Math.max(1, this.#canvas.clientHeight);
    this.#renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }

  dispose() {
    if (this.#disposed) return;
    this.#renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.#resizeHandler);
    for (const geometry of Object.values(this.#geometries)) geometry.dispose();
    for (const material of Object.values(this.#materials)) material.dispose();
    this.#renderer.dispose();
    this.#units.clear();
    this.#disposed = true;
  }
}
