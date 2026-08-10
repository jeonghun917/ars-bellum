export class M2MovementSystem {
  #maxSpeed;
  #arrivalEpsilon;

  constructor({ maxSpeed, arrivalEpsilon }) {
    if (!Number.isFinite(maxSpeed) || maxSpeed <= 0) throw new Error("m2_movement_invalid_speed");
    if (!Number.isFinite(arrivalEpsilon) || arrivalEpsilon < 0) throw new Error("m2_movement_invalid_epsilon");
    this.#maxSpeed = maxSpeed;
    this.#arrivalEpsilon = arrivalEpsilon;
  }

  step(battleState, deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;

    battleState.forEachUnitStable((unit) => {
      unit.previousPosition.x = unit.position.x;
      unit.previousPosition.y = unit.position.y;
      unit.previousPosition.z = unit.position.z;

      const target = unit.slotTarget || { x: unit.position.x, z: unit.position.z };
      const dx = target.x - unit.position.x;
      const dz = target.z - unit.position.z;
      const distance = Math.hypot(dx, dz);

      if (distance <= this.#arrivalEpsilon) {
        unit.position.x = target.x;
        unit.position.z = target.z;
        unit.velocity.x = 0;
        unit.velocity.z = 0;
        unit.state = "idle";
        return;
      }

      const maxDistance = this.#maxSpeed * deltaSeconds;
      const travel = Math.min(distance, maxDistance);
      const nx = dx / distance;
      const nz = dz / distance;
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
