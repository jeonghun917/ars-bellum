import { isM2UnitActive, isM2UnitAlive } from "./M2_BattleState.js";
import { m2UnitKind } from "./M2_UnitKinds.js";
import { pursuitTarget } from "./M2_Pursuit.js";

// Under a charge order (M2_Orders.js) against a formation, the nearest of its men still fighting.
function chargeTarget(battleState, unit) {
  const formation = unit.formationId ? battleState.getFormation(unit.formationId) : null;
  if (formation?.tactic !== "charge" || formation.order.type !== "attack_target") return null;
  const target = battleState.getFormation(formation.order.targetFormationId);
  let best = null;
  for (const id of target?.memberUnitIds || []) {
    const enemy = battleState.getUnit(id);
    if (!isM2UnitActive(enemy)) continue;
    const d = Math.hypot(enemy.position.x - unit.position.x, enemy.position.z - unit.position.z);
    if (!best || d < best.d) best = { d, x: enemy.position.x, z: enemy.position.z };
  }
  return best;
}

// How far (m) a soldier standing at his place may be pushed before he steps back to it.
const SETTLED_DISTANCE = 0.5;

export class M2MovementSystem {
  #maxSpeed;
  #arrivalEpsilon;

  constructor({ maxSpeed, arrivalEpsilon }) {
    if (!Number.isFinite(maxSpeed) || maxSpeed <= 0) throw new Error("m2_movement_invalid_speed");
    if (!Number.isFinite(arrivalEpsilon) || arrivalEpsilon < 0) throw new Error("m2_movement_invalid_epsilon");
    this.#maxSpeed = maxSpeed;
    this.#arrivalEpsilon = arrivalEpsilon;
  }

  applyCommand(battleState, command) {
    if (command.type !== "player_move") return;
    const unit = battleState.getUnit(command.actorUnitId);
    if (!unit || !unit.isPlayer || !isM2UnitActive(unit)) return;
    unit.directMoveIntent = { x: command.move.x, z: command.move.z };
    unit.revision += 1;
  }

  step(battleState, deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;

    battleState.forEachUnitStable((unit) => {
      unit.previousPosition.x = unit.position.x;
      unit.previousPosition.y = unit.position.y;
      unit.previousPosition.z = unit.position.z;

      // A horseman moves faster than a man on foot (M2_UnitKinds.js).
      const maxSpeed = unit.hero ? unit.hero.moveSpeed : this.#maxSpeed * m2UnitKind(unit).speedScale;
      if (!isM2UnitAlive(unit)) {
        unit.velocity.x = 0;
        unit.velocity.z = 0;
        return;
      }

      if (unit.state === "routing") {
        const target = unit.routeTarget;
        if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z)) {
          unit.velocity.x = 0;
          unit.velocity.z = 0;
          return;
        }
        const dx = target.x - unit.position.x;
        const dz = target.z - unit.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance <= this.#arrivalEpsilon) {
          unit.position.x = target.x;
          unit.position.z = target.z;
          unit.velocity.x = 0;
          unit.velocity.z = 0;
          return;
        }
        const nx = dx / distance;
        const nz = dz / distance;
        const travel = Math.min(distance, maxSpeed * deltaSeconds);
        const moveX = nx * travel;
        const moveZ = nz * travel;
        unit.position.x += moveX;
        unit.position.z += moveZ;
        unit.velocity.x = moveX / deltaSeconds;
        unit.velocity.z = moveZ / deltaSeconds;
        unit.heading = Math.atan2(nx, nz);
        unit.revision += 1;
        return;
      }

      if (!isM2UnitActive(unit)) {
        unit.velocity.x = 0;
        unit.velocity.z = 0;
        return;
      }

      let dx;
      let dz;
      let direct = false;
      if (unit.isPlayer && Math.hypot(unit.directMoveIntent.x, unit.directMoveIntent.z) > 0) {
        dx = unit.directMoveIntent.x;
        dz = unit.directMoveIntent.z;
        direct = true;
      } else {
        // Stepping or riding back first (M2_Orders.js: a horseman wheeling away after a charge, a
        // crossbowman keeping his distance); then his place, or under a charge order the nearest enemy of the
        // formation he is sent against, or, pursuing a broken formation, the nearest of its runners
        // (M2_Pursuit.js; crossbowmen near enough to shoot at them).
        if (unit.withdrawTo && Math.hypot(unit.withdrawTo.x - unit.position.x, unit.withdrawTo.z - unit.position.z) <= 1) unit.withdrawTo = null;
        const chase = pursuitTarget(battleState, unit, m2UnitKind(unit).standOff || 0);
        const target = unit.withdrawTo || chargeTarget(battleState, unit) || chase || unit.slotTarget || { x: unit.position.x, z: unit.position.z };
        dx = target.x - unit.position.x;
        dz = target.z - unit.position.z;
      }

      const distance = Math.hypot(dx, dz);
      if (!direct && distance <= this.#arrivalEpsilon) {
        unit.position.x += dx;
        unit.position.z += dz;
        unit.velocity.x = 0;
        unit.velocity.z = 0;
        // Arrived at his place, he turns to face where the formation faces (outward, in a ring).
        if (unit.state !== "idle" && Number.isFinite(unit.slotTarget?.facing)) unit.heading = unit.slotTarget.facing;
        unit.state = "idle";
        return;
      }
      // A man standing at his place who has been jostled a little stays where he is rather than shoving back
      // to the exact spot (two places that overlap would otherwise have him and his neighbour push at each
      // other for ever).
      if (!direct && unit.state === "idle" && distance <= SETTLED_DISTANCE) {
        unit.velocity.x = 0;
        unit.velocity.z = 0;
        return;
      }
      if (distance <= 0) {
        unit.velocity.x = 0;
        unit.velocity.z = 0;
        unit.state = "idle";
        return;
      }

      const nx = dx / distance;
      const nz = dz / distance;
      // The player runs where he is steered. Soldiers run to their places and walk the last few metres;
      // bodies pressing against them last tick hold them back (M2_UnitKinds.js).
      const kind = m2UnitKind(unit);
      // A shield wall keeps its shape only at a walk. Settling into place, men walk the last few metres; sent
      // against the enemy they go in at full pace (a horseman slowing to a walk would lose his charge).
      const formation = unit.formationId ? battleState.getFormation(unit.formationId) : null;
      const attacking = formation?.order.type === "attack_target";
      const walking = formation?.formationTypeId === "shield_wall" || (!direct && !attacking && distance <= kind.walkDistance);
      const pace = walking ? maxSpeed * kind.walkScale : maxSpeed;
      const speed = pace * Math.max(0, 1 - kind.crowdDrag * (unit.crowd || 0));
      const travel = direct ? speed * deltaSeconds : Math.min(distance, speed * deltaSeconds);
      const moveX = nx * travel;
      const moveZ = nz * travel;
      unit.position.x += moveX;
      unit.position.z += moveZ;
      unit.velocity.x = moveX / deltaSeconds;
      unit.velocity.z = moveZ / deltaSeconds;
      unit.heading = Math.atan2(nx, nz);
      unit.state = "moving";
      unit.revision += 1;
    });
  }
}
