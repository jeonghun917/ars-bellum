import * as THREE from "../vendor/three/r184/three.module.min.js";
import { M2_CONFIG } from "./M2_Config.js";

function createMaterial(color) {
  return new THREE.MeshLambertMaterial({ color });
}

function createHumanoid(material, markerMaterial = null) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.82, 0.34), material);
  body.position.y = 1.22;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 1), material);
  head.position.y = 1.92;

  const armGeometry = new THREE.BoxGeometry(0.16, 0.72, 0.16);
  const legGeometry = new THREE.BoxGeometry(0.18, 0.78, 0.2);
  const leftArm = new THREE.Mesh(armGeometry, material);
  const rightArm = new THREE.Mesh(armGeometry, material);
  const leftLeg = new THREE.Mesh(legGeometry, material);
  const rightLeg = new THREE.Mesh(legGeometry, material);
  leftArm.position.set(-0.4, 1.25, 0);
  rightArm.position.set(0.4, 1.25, 0);
  leftLeg.position.set(-0.17, 0.48, 0);
  rightLeg.position.set(0.17, 0.48, 0);

  group.add(body, head, leftArm, rightArm, leftLeg, rightLeg);
  if (markerMaterial) {
    const marker = new THREE.Mesh(new THREE.RingGeometry(0.48, 0.62, 24), markerMaterial);
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
  #units = [];
  #sharedGeometries = new Set();
  #materials = [];
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

    const groundMaterial = new THREE.MeshLambertMaterial({ color: M2_CONFIG.groundColor });
    const groundGeometry = new THREE.PlaneGeometry(42, 42);
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    this.#scene.add(ground);
    this.#sharedGeometries.add(groundGeometry);
    this.#materials.push(groundMaterial);

    const grid = new THREE.GridHelper(42, 42, 0x73806a, 0x596153);
    grid.position.y = 0.012;
    this.#scene.add(grid);

    this.#resizeHandler = () => this.resize();
    window.addEventListener("resize", this.#resizeHandler, { passive: true });
    this.resize();
  }

  loadSnapshot(snapshot, combatProfiles) {
    if (this.#disposed) throw new Error("m2_runtime_disposed");
    for (const unit of this.#units) this.#scene.remove(unit.group);
    this.#units.length = 0;

    const allyMaterial = createMaterial(M2_CONFIG.allyColor);
    const enemyMaterial = createMaterial(M2_CONFIG.enemyColor);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: M2_CONFIG.playerMarkerColor, side: THREE.DoubleSide });
    this.#materials.push(allyMaterial, enemyMaterial, markerMaterial);

    for (const character of snapshot.characters) {
      const material = character.sideId === "ally" ? allyMaterial : enemyMaterial;
      const group = createHumanoid(material, character.characterId === snapshot.playerCharacterId ? markerMaterial : null);
      group.position.set(character.spawn.x, 0, character.spawn.z);
      group.rotation.y = character.spawn.heading;
      const profile = combatProfiles.get(character.combatProfileId);
      group.scale.setScalar(0.9 + (profile.stats.vitality / 100) * 0.18);
      this.#scene.add(group);
      this.#units.push({ group, character, profile, phaseOffset: this.#units.length * 0.73 });
      group.traverse((object) => {
        if (object.geometry) this.#sharedGeometries.add(object.geometry);
      });
    }
  }

  setAnimationLoop(callback) {
    if (this.#disposed && callback) throw new Error("m2_runtime_disposed");
    this.#renderer.setAnimationLoop(callback);
  }

  render(elapsedSeconds) {
    if (this.#disposed) return;
    for (const unit of this.#units) {
      const swing = Math.sin(elapsedSeconds * 2.2 + unit.phaseOffset) * 0.13;
      const parts = unit.group.userData.parts;
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
    return { drawCalls: info.calls, triangles: info.triangles };
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
    for (const geometry of this.#sharedGeometries) geometry.dispose();
    for (const material of this.#materials) material.dispose();
    this.#renderer.dispose();
    this.#units.length = 0;
    this.#disposed = true;
  }
}
