// Bodies on the field: no two living soldiers overlap. After everyone has moved, each pair closer than the
// sum of their radii (M2_UnitKinds.js) is pushed apart along the line between them, the lighter one giving
// way more (a horse shoves a man aside; two men share the step). The fallen lie where they fell and take no
// room, and so do men running from the field: a rout scatters and does not jostle (otherwise the first to
// reach the edge would push the rest back from it, and the retreat would never end). Pairs are taken in a fixed order (by soldier id) and each push is applied at once, so a crowd settles
// in few rounds and the same battle always settles the same way.
import { isM2UnitAlive } from "./M2_BattleState.js";
import { m2UnitKind } from "./M2_UnitKinds.js";

const takesRoom = (unit) => isM2UnitAlive(unit) && unit.state !== "routing";

// Rounds of pushing per tick: a crowd pressed from both sides (two columns of horses meeting head on) needs
// several to settle; a round with no push ends the step early.
const PASSES = 6;
const LARGEST_RADIUS = 0.8;

export class M2CollisionSystem {
  #pushCount = 0;

  get pushCount() {
    return this.#pushCount;
  }

  // spatialGrid must hold this tick's positions; it is rebuilt after each round of pushes. A push also
  // changes the soldier's velocity: a horse pressed back by a crowd is not riding fast, whatever its legs do
  // (so it cannot keep charging while stuck).
  step(battleState, spatialGrid, deltaSeconds) {
    for (let pass = 0; pass < PASSES; pass += 1) {
      let pushed = false;
      battleState.forEachUnitStable((unit) => {
        if (!takesRoom(unit)) return;
        const kind = m2UnitKind(unit);
        for (const otherId of spatialGrid.queryNearby(unit.position.x, unit.position.z, kind.radius + LARGEST_RADIUS)) {
          if (otherId <= unit.unitId) continue;
          const other = battleState.getUnit(otherId);
          if (!takesRoom(other)) continue;
          const otherKind = m2UnitKind(other);
          let dx = other.position.x - unit.position.x;
          let dz = other.position.z - unit.position.z;
          let distance = Math.hypot(dx, dz);
          const overlap = kind.radius + otherKind.radius - distance;
          if (overlap <= 0) continue;
          if (distance < 1e-6) {
            // Standing on the same spot: part them along a fixed direction.
            dx = 1;
            dz = 0;
            distance = 1;
          }
          const nx = dx / distance;
          const nz = dz / distance;
          const total = kind.mass + otherKind.mass;
          this.#move(unit, -nx * overlap * (otherKind.mass / total), -nz * overlap * (otherKind.mass / total), deltaSeconds);
          this.#move(other, nx * overlap * (kind.mass / total), nz * overlap * (kind.mass / total), deltaSeconds);
          pushed = true;
        }
      });
      // The grid lists everyone where they stood before this round; a push is at most a body's width, so
      // the neighbours found are still the right ones within the round.
      spatialGrid.rebuild(battleState);
      if (!pushed) return;
    }
  }

  #move(unit, x, z, deltaSeconds) {
    unit.position.x += x;
    unit.position.z += z;
    if (deltaSeconds > 0) {
      unit.velocity.x += x / deltaSeconds;
      unit.velocity.z += z / deltaSeconds;
    }
    this.#pushCount += 1;
  }
}
