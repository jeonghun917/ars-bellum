// Loads the soldier models made in Blender (tools/blender/build_men.py → assets/models/*.glb): a rigged
// human in mail with a shield and spear, and its animations. The battle starts without them if they fail
// to load: the renderer then draws its simple box soldiers.
import { GLTFLoader } from "../vendor/three/r184/addons/loaders/GLTFLoader.js";

// Each model is one man who can fight with a spear or with a sword (both with a shield). The spear clips
// have plain names; the sword clips start with "s_", and "draw" takes the sword out of its scabbard.
export const SOLDIER_ANIMATIONS = Object.freeze([
  "idle", "walk", "run", "attack", "block", "death",
  "s_idle", "s_walk", "s_run", "s_attack", "s_block", "s_death", "draw"
]);

// Which model each side's foot soldiers wear.
const BATTLE_MODELS = Object.freeze({ ally: "infantry_ally", enemy: "infantry_enemy" });

export async function loadSoldierModels(baseUrl = new URL("../assets/models/", import.meta.url)) {
  const loader = new GLTFLoader();
  const entries = await Promise.all(Object.entries(BATTLE_MODELS).map(async ([side, name]) => {
    const gltf = await loader.loadAsync(new URL(`${name}.glb`, baseUrl).href);
    const clips = Object.fromEntries(gltf.animations.map((clip) => [clip.name, clip]));
    for (const clip of SOLDIER_ANIMATIONS) {
      if (!clips[clip]) throw new Error(`m2_model_animation_missing:${name}:${clip}`);
    }
    let skinned = 0;
    gltf.scene.traverse((object) => {
      if (object.isSkinnedMesh) skinned += 1;
    });
    if (!skinned) throw new Error(`m2_model_not_skinned:${name}`);
    // The ground speed (m/s) of the walk and run clips, written into the skeleton by the build: played at
    // (the soldier's speed / this), a foot on the ground stays put on it.
    let gait = null;
    gltf.scene.traverse((object) => {
      const { walk_speed: walk, run_speed: run } = object.userData || {};
      if (Number.isFinite(walk) && Number.isFinite(run) && walk > 0 && run > walk) gait = Object.freeze({ walk, run });
    });
    if (!gait) throw new Error(`m2_model_gait_missing:${name}`);
    return [side, Object.freeze({ scene: gltf.scene, clips: Object.freeze(clips), gait })];
  }));
  return Object.freeze(Object.fromEntries(entries));
}
