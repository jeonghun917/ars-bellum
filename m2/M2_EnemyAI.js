// The enemy commander. The enemy army stands in its places until it is attacked: an ally formation ordered
// to attack, or an enemy soldier hurt. From then on it fights: every second each enemy formation that is not
// withdrawing or rallying is ordered to attack an ally formation, chosen by what it is:
// - horsemen go for the ally crossbowmen while any stand, then the nearest formation;
// - crossbowmen and foot soldiers go for the nearest formation (the crossbowmen shoot from their distance).
// Orders are set directly on the formations, as the formation system does for the player's commands; they are
// the enemy's own and are not part of the player's command log. Everything here depends only on the battle
// state, so the same battle plays out the same way.
import { isM2UnitAlive } from "./M2_BattleState.js";
import { stancesFor } from "./M2_Stances.js";

const AI_SIDE = "enemy";
const THINK_EVERY_TICKS = 20;

function centre(battleState, formation) {
  const ids = battleState.getActiveFormationMemberIds(formation);
  if (!ids.length) return null;
  let x = 0;
  let z = 0;
  for (const id of ids) {
    const unit = battleState.getUnit(id);
    x += unit.position.x;
    z += unit.position.z;
  }
  return { x: x / ids.length, z: z / ids.length };
}

export class M2EnemyAI {
  #awake = false;
  #lastThinkTick = -Infinity;
  #woke = null;

  get awake() {
    return this.#awake;
  }

  getObservation() {
    return Object.freeze({ enemyAwake: this.#awake, enemyWokeAtTick: this.#woke });
  }

  // Called once per fixed tick, after the player's formation commands and before the formations move.
  step(battleState, processingTick) {
    if (!this.#awake && this.#attacked(battleState)) {
      this.#awake = true;
      this.#woke = processingTick;
      this.#lastThinkTick = -Infinity;
    }
    if (!this.#awake || processingTick - this.#lastThinkTick < THINK_EVERY_TICKS) return;
    this.#lastThinkTick = processingTick;

    const allies = [];
    battleState.forEachFormationStable((formation) => {
      if (formation.sideId === AI_SIDE) return;
      const at = centre(battleState, formation);
      if (at) allies.push({ formation, at });
    });
    if (!allies.length) return;

    battleState.forEachFormationStable((formation) => {
      if (formation.sideId !== AI_SIDE) return;
      if (formation.order.type === "withdraw" || formation.order.type === "rally") return;
      const at = centre(battleState, formation);
      if (!at) return;
      const byDistance = [...allies].sort((a, b) =>
        Math.hypot(a.at.x - at.x, a.at.z - at.z) - Math.hypot(b.at.x - at.x, b.at.z - at.z)
        || a.formation.formationId.localeCompare(b.formation.formationId));
      const crossbows = byDistance.find((entry) => entry.formation.kindId === "crossbow");
      const target = (formation.kindId === "cavalry" && crossbows) || byDistance[0];
      this.#chooseStance(formation, at, allies);
      const current = formation.order;
      if (current.type === "attack_target" && current.targetFormationId === target.formation.formationId) return;
      formation.order = {
        type: "attack_target",
        target: null,
        targetFormationId: target.formation.formationId,
        commandId: `enemy_ai:${processingTick}:${formation.formationId}`
      };
      formation.revision += 1;
    });
  }

  // Each formation takes the stance the moment calls for, among those its commander can use
  // (M2_Stances.js): foot brace spears when horsemen come near and close up behind shields on the way in;
  // horsemen hit and run if they can, else charge in a wedge; crossbowmen loose in volleys.
  #chooseStance(formation, at, allies) {
    const can = stancesFor(formation);
    let wanted = null;
    if (formation.kindId === "infantry") {
      // Shields up on the way in, under the bolts; open order to fight once they meet the enemy.
      const distance = (entry) => Math.hypot(entry.at.x - at.x, entry.at.z - at.z);
      const horseNear = allies.some((entry) => entry.formation.kindId === "cavalry" && distance(entry) < 15);
      const closing = allies.every((entry) => distance(entry) > 10);
      wanted = horseNear && can.includes("spear_brace") ? "spear_brace" : closing && can.includes("shield_wall") ? "shield_wall" : null;
    } else if (formation.kindId === "cavalry") {
      wanted = can.includes("hit_and_run") ? "hit_and_run" : can.includes("wedge") ? "wedge" : null;
    } else if (formation.kindId === "crossbow") {
      wanted = can.includes("volley") ? "volley" : null;
    }
    if (formation.stance !== wanted) {
      formation.stance = wanted;
      formation.revision += 1;
    }
  }

  #attacked(battleState) {
    let attacked = false;
    battleState.forEachFormationStable((formation) => {
      if (formation.sideId !== AI_SIDE && formation.order.type === "attack_target") attacked = true;
    });
    if (attacked) return true;
    battleState.forEachUnitStable((unit) => {
      if (unit.sideId === AI_SIDE && (unit.hp < unit.maxHp || !isM2UnitAlive(unit))) attacked = true;
    });
    return attacked;
  }
}
