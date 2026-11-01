// The enemy commander. The enemy army stands in its places until it is attacked: an ally formation ordered
// to attack, or an enemy soldier hurt. From then on it fights: every second each enemy formation that is not
// withdrawing or rallying is ordered to attack an ally formation, chosen by what it is:
// - horsemen go for the ally crossbowmen while any stand, then the nearest formation;
// - crossbowmen and foot soldiers go for the nearest formation (the crossbowmen shoot from their distance).
// Orders are set directly on the formations, as the formation system does for the player's commands; they are
// the enemy's own and are not part of the player's command log. Everything here depends only on the battle
// state, so the same battle plays out the same way.
import { isM2UnitAlive } from "./M2_BattleState.js";
import { plansFor, setPlan } from "./M2_Plans.js";
import { ordersFor } from "./M2_Orders.js";

const AI_SIDE = "enemy";
const THINK_EVERY_TICKS = 20;
// The plans the enemy commander would rather use, best first.
const PLAN_PREFERENCE = Object.freeze(["anvil_hammer", "shoot_then_charge", "defend_counter", "screen_archers", "double_envelopment", "feigned_retreat"]);

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
    // A battle plan for the whole army (M2_Plans.js): the best his commanders know, for what he has.
    if (!battleState.getPlan(AI_SIDE)) {
      const can = plansFor(battleState, AI_SIDE);
      const planId = PLAN_PREFERENCE.find((id) => can.includes(id)) || "frontal_push";
      setPlan(battleState, AI_SIDE, planId, processingTick);
    }

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
      this.#chooseShapeAndOrder(formation, at, allies, target.formation);
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

  // Each formation takes the shape and the order the moment calls for, among those it can (M2_Orders.js,
  // M2_FormationSystem.js): foot plant their spears when horsemen come near, close up into a shield wall on
  // the way in under the enemy's crossbows, and open into a line to fight; horsemen hit and run at foot in
  // close order, or go round it, and charge anything else; crossbowmen step back from an enemy who comes too near, loose in
  // volleys, or pick on one formation.
  #chooseShapeAndOrder(formation, at, allies, target) {
    const can = ordersFor(formation);
    const distance = (entry) => Math.hypot(entry.at.x - at.x, entry.at.z - at.z);
    const nearest = Math.min(...allies.map(distance));
    let shape = formation.formationTypeId;
    let order = null;
    if (formation.kindId === "infantry") {
      const horseNear = allies.some((entry) => entry.formation.kindId === "cavalry" && distance(entry) < 15);
      const boltsComing = allies.some((entry) => entry.formation.kindId === "crossbow");
      if (horseNear && can.includes("spear_brace")) order = "spear_brace";
      shape = boltsComing && nearest > 10 ? "shield_wall" : "line";
    } else if (formation.kindId === "cavalry") {
      // Against foot in close order (where a horse is held fast) they hit and run, or go round; anything
      // else they ride straight into.
      const solidFoot = target?.kindId === "infantry" && ["line", "shield_wall", "circle"].includes(target.formationTypeId);
      order = (solidFoot ? ["hit_and_run", "flank", "charge"] : ["charge"]).find((id) => can.includes(id)) || null;
    } else if (formation.kindId === "crossbow") {
      order = nearest < 15 && can.includes("skirmish") ? "skirmish" : ["volley", "focus_fire"].find((id) => can.includes(id)) || null;
    }
    if (formation.formationTypeId !== shape || formation.tactic !== order) {
      formation.formationTypeId = shape;
      if (formation.tactic !== order) formation.flankStage = 0;
      formation.tactic = order;
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
