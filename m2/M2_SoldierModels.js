// Loads the soldier models made in Blender (tools/blender/build_men.py → assets/models/*.glb): a rigged
// human in mail with a shield and spear, and its animations. The battle starts without them if they fail
// to load: the renderer then draws its simple box soldiers.
import { GLTFLoader } from "../vendor/three/r184/addons/loaders/GLTFLoader.js";

// Each model is one man who can fight with spear and shield (plain names), sword and shield ("s_"; "draw"
// takes the sword out of its scabbard), a spear in both hands without a shield ("n_"), the sword alone
// ("f_") or a longsword in both hands ("t_"). "low_" clips carry the shield at the side, out of a fight.
export const SOLDIER_ANIMATIONS = Object.freeze([
  "idle", "walk", "run", "attack", "attack_over", "block", "death", "low_idle", "low_walk", "low_run",
  "s_idle", "s_walk", "s_run", "s_swing_l", "s_swing_r", "s_overhead", "s_thrust", "s_block", "s_death",
  "s_low_idle", "s_low_walk", "s_low_run", "draw",
  "n_idle", "n_walk", "n_run", "n_attack", "n_attack_over", "n_block", "n_death",
  "f_idle", "f_walk", "f_run", "f_swing_l", "f_swing_r", "f_overhead", "f_thrust", "f_block", "f_death",
  "t_idle", "t_walk", "t_run", "t_swing_l", "t_swing_r", "t_overhead", "t_thrust", "t_block", "t_death"
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
