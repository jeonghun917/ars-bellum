// Loads the soldier models made in Blender (tools/blender/build_men.py → assets/models/*.glb): a rigged
// human in mail with a shield and spear, and its animations. The battle starts without them if they fail
// to load: the renderer then draws its simple box soldiers.
import { GLTFLoader } from "../vendor/three/r184/addons/loaders/GLTFLoader.js";

export const SOLDIER_ANIMATIONS = Object.freeze(["idle", "walk", "attack", "block", "death"]);

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
    return [side, Object.freeze({ scene: gltf.scene, clips: Object.freeze(clips) })];
  }));
  return Object.freeze(Object.fromEntries(entries));
}
