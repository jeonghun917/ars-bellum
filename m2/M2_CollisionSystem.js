// Bodies on the field: no two living soldiers overlap. After everyone has moved, each pair closer than the
// sum of their radii (M2_UnitKinds.js) is pushed apart along the line between them, the lighter one giving
// way more (a horse shoves a man aside; two men share the step). The fallen lie where they fell and take no
// room, and so do men running from the field: a rout scatters and does not jostle (otherwise the first to
// reach the edge would push the rest back from it, and the retreat would never end). Pairs are taken in a fixed order (by soldier id) and each push is applied at once, so a crowd settles
// in few rounds and the same battle always settles the same way.
import { isM2UnitAlive } from "./M2_BattleState.js";
import { M2_ORDERS } from "./M2_Orders.js";
import { m2UnitKind } from "./M2_UnitKinds.js";

function massOf(battleState, unit, kind) {
  const formation = unit.formationId ? battleState.getFormation(unit.formationId) : null;
  return formation?.tactic === "spear_brace" ? M2_ORDERS.spear_brace.braceMass : kind.mass;
}

const takesRoom = (unit) => isM2UnitAlive(unit) && unit.state !== "routing";

// Rounds of pushing per tick: a crowd pressed from both sides (two columns of horses meeting head on) needs
// several to settle; a round with no push ends the step early.
const PASSES = 8;
const LARGEST_RADIUS = 0.8;
// Faster than this (m/s) a soldier is on the move; how far, for each metre of overlap, comrades edge sideways.
const MOVING = 0.3;
const SIDESTEP = 0.5;

export class M2CollisionSystem {
  #pushCount = 0;

  get pushCount() {
    return this.#pushCount;
  }

  // spatialGrid must hold this tick's positions; it is rebuilt after each round of pushes. A push also
  // changes the soldier's velocity: a horse pressed back by a crowd is not riding fast, whatever its legs do
  // (so it cannot keep charging while stuck).
  // Each soldier's crowd is how many enemy bodies he ran into this tick (ahead of him, as he was moving);
  // the movement system slows him by it next tick.
  step(battleState, spatialGrid, deltaSeconds) {
    // Where each was going by his own legs this tick, before anyone pushed him (pushes add to velocity).
    const own = new Map();
    battleState.forEachUnitStable((unit) => {
      unit.crowd = 0;
      own.set(unit.unitId, { x: unit.velocity.x, z: unit.velocity.z });
    });
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
          // Only the enemy holds a man back: his own side steps aside (and is pushed aside below).
          if (pass === 0 && unit.sideId !== other.sideId) {
            const a = own.get(unit.unitId);
            const c = own.get(other.unitId);
            if (a.x * nx + a.z * nz > 0) unit.crowd += 1;
            if (c.x * nx + c.z * nz < 0) other.crowd += 1;
          }
          // A spearman braced against horse (M2_Orders.js) has planted his feet: he does not give way.
          const unitMass = massOf(battleState, unit, kind);
          const otherMass = massOf(battleState, other, otherKind);
          const total = unitMass + otherMass;
          let unitShare = otherMass / total;
          let otherShare = unitMass / total;
          // Two of the same side: the one standing steps aside for the one on the move, and both edge
          // sideways so the mover goes round instead of pressing into him (without this a man running to his
          // place stalls against a comrade holding his).
          // (sx, sz): the sideways step, at right angles to the mover's way, taken by the mover; the comrade
          // takes the opposite one.
          let sx = 0;
          let sz = 0;
          let unitIsMover = false;
          if (unit.sideId === other.sideId) {
            const unitWay = own.get(unit.unitId);
            const otherWay = own.get(other.unitId);
            const unitSpeed = Math.hypot(unitWay.x, unitWay.z);
            const otherSpeed = Math.hypot(otherWay.x, otherWay.z);
            if ((unitSpeed > MOVING) !== (otherSpeed > MOVING)) {
              unitIsMover = unitSpeed > MOVING;
              unitShare = unitIsMover ? 0 : 1;
              otherShare = 1 - unitShare;
              const way = unitIsMover ? unitWay : otherWay;
              const speed = unitIsMover ? unitSpeed : otherSpeed;
              let px = way.z / speed;
              let pz = -way.x / speed;
              // Toward the side away from the comrade (the direction from mover to comrade is n, or -n).
              const toComrade = unitIsMover ? 1 : -1;
              if ((px * nx + pz * nz) * toComrade > 0) { px = -px; pz = -pz; }
              const step = overlap * SIDESTEP;
              sx = px * step;
              sz = pz * step;
            }
          }
          const unitSide = unitIsMover ? 1 : -1;
          this.#move(unit, -nx * overlap * unitShare + sx * unitSide, -nz * overlap * unitShare + sz * unitSide, deltaSeconds);
          this.#move(other, nx * overlap * otherShare - sx * unitSide, nz * overlap * otherShare - sz * unitSide, deltaSeconds);
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
