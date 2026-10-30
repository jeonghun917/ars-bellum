// Loads the soldier models made in Blender (tools/blender/build_soldiers.py → assets/models/*.glb).
// The battle starts without them if they fail to load: the renderer then draws its simple box soldiers.
import { GLTFLoader } from "../vendor/three/r184/addons/loaders/GLTFLoader.js";

const PARTS = Object.freeze(["body", "arm_l", "arm_r", "leg_l", "leg_r"]);

// Which model each side's foot soldiers wear. The crossbowman and the knight are built too, but the battle
// has no crossbow or cavalry rules yet, so they are not used here.
const BATTLE_MODELS = Object.freeze({ ally: "infantry_ally", enemy: "infantry_enemy" });

export async function loadSoldierModels(baseUrl = new URL("../assets/models/", import.meta.url)) {
  const loader = new GLTFLoader();
  const entries = await Promise.all(Object.entries(BATTLE_MODELS).map(async ([side, name]) => {
    const gltf = await loader.loadAsync(new URL(`${name}.glb`, baseUrl).href);
    const root = gltf.scene;
    for (const part of PARTS) {
      if (!root.getObjectByName(part)) throw new Error(`m2_model_part_missing:${name}:${part}`);
    }
    root.traverse((object) => {
      if (object.isMesh) object.material.flatShading = true;
    });
    return [side, root];
  }));
  return Object.freeze(Object.fromEntries(entries));
}
