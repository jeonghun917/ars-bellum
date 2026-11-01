// Battle plans (작전): how a whole side uses its formations together, by what kinds it has (the owner's design:
// the mix of foot, horse and crossbows decides which plans there are). A side holds one plan at a time, or
// none. While it holds one, each of its formations still under the plan is given its order, its formation
// order (M2_Orders.js) and sometimes its shape, every tick, as the plan's stage calls for; a formation the
// player orders by hand leaves the plan. No plan makes anything stronger: it only decides who goes where and
// when.
//
// - frontal_push (정면 압박): everyone attacks the nearest enemy formation, the horse the enemy's crossbowmen
//   while any stand. Any side can use it.
// - anvil_hammer (모루와 망치, foot + horse): the foot attack the enemy (the anvil); the horse go round and
//   strike it from behind (the hammer).
// - shoot_then_charge (견제 후 돌격, crossbows + foot or horse): the crossbows shoot; the rest wait (the foot in a
//   shield wall) until the target has lost a third of its men, or forty seconds have passed, then charge.
// - screen_archers (궁병 호위, crossbows + horse): the crossbows shoot; the horse keep between them and the
//   enemy and charge any formation that comes within 10 m of them (they shoot from 14 m: a formation nearer
//   than that is coming for them).
// - defend_counter (버티다 역습, foot + horse): the foot hold in a shield wall; the crossbows shoot; the horse
//   wait behind the foot until the enemy is locked with them, then go round and strike it.
// - double_envelopment (양익 포위, three formations or more, foot among them): the foot attack the enemy's
//   front; two other formations go round it, one on each side.
// - feigned_retreat (거짓 후퇴, horse + foot or crossbows): the horse ride at the enemy, turn and fall back
//   behind their own foot to draw it on, and charge again when it has followed (or after thirty seconds);
//   the foot hold in a shield wall and the crossbows shoot.
//
// Frontal push any side can use; the rest, two for each of its best commander's tacticSlots (M2_Commanders.js:
// two for an ordinary commander, all six at tactics 67), of those its kinds allow, in the order listed.
import { isM2UnitActive } from "./M2_BattleState.js";
import { pursuedFormation } from "./M2_Pursuit.js";
import { ordersFor } from "./M2_Orders.js";

export const M2_PLANS = Object.freeze({
  frontal_push: Object.freeze({ id: "frontal_push", label: "정면 압박", needs: () => true }),
  anvil_hammer: Object.freeze({ id: "anvil_hammer", label: "모루와 망치", needs: (k) => k.infantry && k.cavalry }),
  shoot_then_charge: Object.freeze({ id: "shoot_then_charge", label: "견제 후 돌격", needs: (k) => k.crossbow && (k.infantry || k.cavalry), releaseLoss: 1 / 3, releaseTicks: 800 }),
  screen_archers: Object.freeze({ id: "screen_archers", label: "궁병 호위", needs: (k) => k.crossbow && k.cavalry, guardRadius: 10, screenDistance: 6 }),
  defend_counter: Object.freeze({ id: "defend_counter", label: "버티다 역습", needs: (k) => k.infantry && k.cavalry, lockedDistance: 6, waitBehind: 8 }),
  double_envelopment: Object.freeze({ id: "double_envelopment", label: "양익 포위", needs: (k) => k.infantry && k.count >= 3 }),
  feigned_retreat: Object.freeze({ id: "feigned_retreat", label: "거짓 후퇴", needs: (k) => k.cavalry && (k.infantry || k.crossbow), turnDistance: 6, fallBack: 10, followedDistance: 12, waitTicks: 600 })
});
const PLANS_PER_SLOT = 2;
const LEARNED = Object.freeze(["anvil_hammer", "shoot_then_charge", "screen_archers", "defend_counter", "double_envelopment", "feigned_retreat"]);

function centre(battleState, formation) {
  const ids = battleState.getActiveFormationMemberIds(formation);
  if (!ids.length) return null;
  return {
    x: ids.reduce((s, id) => s + battleState.getUnit(id).position.x, 0) / ids.length,
    z: ids.reduce((s, id) => s + battleState.getUnit(id).position.z, 0) / ids.length
  };
}
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// A side's formations still able to fight, with where they stand.
function fieldOf(battleState, sideId) {
  const out = [];
  battleState.forEachFormationStable((formation) => {
    if (formation.sideId !== sideId || formation.order.type === "withdraw" || formation.order.type === "rally") return;
    const at = centre(battleState, formation);
    if (at) out.push({ formation, at });
  });
  return out;
}

// The plans this side can use now: frontal push, and as many of the others as its best commander's tactics
// allow, of those its kinds of soldier make possible.
export function plansFor(battleState, sideId) {
  const field = fieldOf(battleState, sideId);
  const kinds = { infantry: false, cavalry: false, crossbow: false, count: field.length };
  let slots = 0;
  for (const { formation } of field) {
    kinds[formation.kindId] = true;
    const commander = battleState.getUnit(formation.commanderUnitId);
    if (isM2UnitActive(commander)) slots = Math.max(slots, formation.command?.tacticSlots ?? 0);
  }
  return ["frontal_push", ...LEARNED.filter((id) => M2_PLANS[id].needs(kinds)).slice(0, PLANS_PER_SLOT * Math.max(1, slots))];
}

// Sets a side's plan (or none) and puts all its formations under it.
export function setPlan(battleState, sideId, planId, processingTick) {
  battleState.setPlan(sideId, planId ? { planId, startTick: processingTick, stage: 0 } : null);
  battleState.forEachFormationStable((formation) => {
    if (formation.sideId !== sideId) return;
    formation.underPlan = Boolean(planId);
    formation.flankSide = null;
  });
}

export class M2PlanSystem {
  // Once per fixed tick, after the commands (and the enemy commander) and before the formations move.
  step(battleState, processingTick) {
    for (const sideId of ["ally", "enemy"]) {
      const plan = battleState.getPlan(sideId);
      if (plan) this.#carryOut(battleState, sideId, plan, processingTick);
    }
  }

  #carryOut(battleState, sideId, plan, tick) {
    // (A formation pursuing a broken one keeps after it until it is done: M2_Pursuit.js.)
    const own = fieldOf(battleState, sideId).filter((entry) => entry.formation.underPlan && !pursuedFormation(battleState, entry.formation));
    const enemies = fieldOf(battleState, sideId === "ally" ? "enemy" : "ally");
    if (!own.length || !enemies.length) return;
    const def = M2_PLANS[plan.planId];
    const foot = own.filter((e) => e.formation.kindId === "infantry");
    const horse = own.filter((e) => e.formation.kindId === "cavalry");
    const bows = own.filter((e) => e.formation.kindId === "crossbow");
    const middle = (list) => (list.length ? { x: list.reduce((s, e) => s + e.at.x, 0) / list.length, z: list.reduce((s, e) => s + e.at.z, 0) / list.length } : null);
    const ownMiddle = middle(own);
    const nearestTo = (point) => [...enemies].sort((a, b) => gap(a.at, point) - gap(b.at, point) || a.formation.formationId.localeCompare(b.formation.formationId))[0];
    // The target: the enemy formation nearest the side's foot (or, without foot, its middle).
    const target = nearestTo(middle(foot) || ownMiddle);
    const attack = (entry, enemy, tacticId) => this.#direct(entry.formation, { type: "attack_target", targetFormationId: enemy.formation.formationId }, tacticId);
    const hold = (entry, tacticId, shapeId) => this.#direct(entry.formation, { type: "hold" }, tacticId, shapeId);
    const moveTo = (entry, point, tacticId) => this.#direct(entry.formation, { type: "move", target: point }, tacticId);
    const away = (from, point, distance) => {
      const d = gap(from, point) || 1;
      return { x: from.x + ((from.x - point.x) / d) * distance, z: from.z + ((from.z - point.z) / d) * distance };
    };
    const may = (entry, tacticId) => (ordersFor(entry.formation).includes(tacticId) ? tacticId : null);

    if (plan.planId === "frontal_push") {
      // Each at the enemy nearest it; the horse at the enemy's crossbowmen while any stand.
      const enemyBows = enemies.filter((e) => e.formation.kindId === "crossbow").sort((a, b) => a.formation.formationId.localeCompare(b.formation.formationId));
      for (const entry of own) {
        const prey = entry.formation.kindId === "cavalry" && enemyBows.length ? [...enemyBows].sort((a, b) => gap(a.at, entry.at) - gap(b.at, entry.at))[0] : nearestTo(entry.at);
        attack(entry, prey);
      }
    } else if (plan.planId === "anvil_hammer") {
      for (const entry of [...foot, ...bows]) attack(entry, target);
      for (const entry of horse) attack(entry, target, may(entry, "flank"));
    } else if (plan.planId === "shoot_then_charge") {
      const lost = this.#lostShare(battleState, target.formation);
      if (plan.stage === 0 && (lost >= def.releaseLoss || tick - plan.startTick >= def.releaseTicks)) plan.stage = 1;
      for (const entry of bows) attack(entry, target, may(entry, "volley") || may(entry, "focus_fire"));
      for (const entry of [...foot, ...horse]) {
        if (plan.stage === 1) attack(entry, target, may(entry, "charge"));
        else hold(entry, null, entry.formation.kindId === "infantry" ? "shield_wall" : undefined);
      }
    } else if (plan.planId === "screen_archers") {
      for (const entry of bows) attack(entry, target);
      const guard = middle(bows);
      const intruder = enemies.filter((e) => gap(e.at, guard) <= def.guardRadius).sort((a, b) => gap(a.at, guard) - gap(b.at, guard))[0];
      for (const entry of horse) {
        if (intruder) attack(entry, intruder, may(entry, "charge"));
        else moveTo(entry, away(guard, target.at, -def.screenDistance));
      }
      for (const entry of foot) attack(entry, target);
    } else if (plan.planId === "defend_counter") {
      for (const entry of foot) hold(entry, null, "shield_wall");
      for (const entry of bows) attack(entry, target);
      const wall = middle(foot);
      const locked = wall ? enemies.filter((e) => gap(e.at, wall) <= def.lockedDistance).sort((a, b) => gap(a.at, wall) - gap(b.at, wall))[0] : null;
      for (const entry of horse) {
        if (locked) attack(entry, locked, may(entry, "flank"));
        else moveTo(entry, away(wall || ownMiddle, target.at, def.waitBehind));
      }
    } else if (plan.planId === "double_envelopment") {
      for (const entry of foot.slice(0, 1)) attack(entry, target);
      const wings = own.filter((e) => e !== foot[0]);
      wings.forEach((entry, i) => {
        if (i < 2) {
          entry.formation.flankSide = i === 0 ? 1 : -1;
          attack(entry, target, may(entry, "flank"));
        } else attack(entry, target);
      });
    } else if (plan.planId === "feigned_retreat") {
      for (const entry of foot) hold(entry, null, "shield_wall");
      for (const entry of bows) attack(entry, target);
      const home = middle(foot) || middle(bows);
      for (const entry of horse) {
        if (plan.stage === 0 && gap(entry.at, target.at) <= def.turnDistance) { plan.stage = 1; plan.turnTick = tick; }
        if (plan.stage === 1 && (gap(target.at, home) <= def.followedDistance || tick - plan.turnTick >= def.waitTicks)) plan.stage = 2;
        if (plan.stage === 1) moveTo(entry, away(home, target.at, def.fallBack));
        else attack(entry, target, may(entry, "charge"));
      }
    }
  }

  #lostShare(battleState, formation) {
    const all = formation.memberUnitIds.length || 1;
    return formation.memberUnitIds.filter((id) => !isM2UnitActive(battleState.getUnit(id))).length / all;
  }

  // Gives a formation its order, and its formation order and shape where the plan says (undefined: leave as
  // it is). Only what changes is written.
  #direct(formation, order, tacticId, shapeId) {
    let changed = false;
    const current = formation.order;
    const same = current.type === order.type
      && (order.type !== "attack_target" || current.targetFormationId === order.targetFormationId)
      && (order.type !== "move" || (current.target && gap(current.target, order.target) < 0.5));
    if (!same) {
      formation.order = { type: order.type, target: order.type === "move" ? { ...order.target } : null, targetFormationId: order.targetFormationId || null, commandId: `plan:${formation.formationId}` };
      if (order.type === "move") { formation.anchor.x = order.target.x; formation.anchor.z = order.target.z; }
      if (order.type === "attack_target") formation.flankStage = 0;
      changed = true;
    }
    if (tacticId !== undefined && formation.tactic !== tacticId) { formation.tactic = tacticId; formation.flankStage = 0; changed = true; }
    if (shapeId !== undefined && formation.formationTypeId !== shapeId) { formation.formationTypeId = shapeId; changed = true; }
    if (changed) formation.revision += 1;
  }
}
