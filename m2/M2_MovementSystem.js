import { isM2UnitActive, isM2UnitAlive } from "./M2_BattleState.js";
import { m2UnitKind } from "./M2_UnitKinds.js";

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
      const maxSpeed = this.#maxSpeed * m2UnitKind(unit).speedScale;
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
        const target = unit.slotTarget || { x: unit.position.x, z: unit.position.z };
        dx = target.x - unit.position.x;
        dz = target.z - unit.position.z;
      }

      const distance = Math.hypot(dx, dz);
      if (!direct && distance <= this.#arrivalEpsilon) {
        unit.position.x += dx;
        unit.position.z += dz;
        unit.velocity.x = 0;
        unit.velocity.z = 0;
        unit.state = "idle";
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
      const travel = direct ? maxSpeed * deltaSeconds : Math.min(distance, maxSpeed * deltaSeconds);
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
