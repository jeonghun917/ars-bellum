// Pursuit (추격, the owner's ordered plan step 4). A formation set to pursue (formation.pursuit) that is sent
// against an enemy formation goes on when that formation breaks: once none of its men still fights and some
// are running, its men chase the runners and cut them down (a running man does not fight back), and its
// crossbowmen shoot at them. They chase no further than the runners' own edge of the field. A formation not
// set to pursue lets them go and keeps its place. Horsemen pursue unless told otherwise; foot and crossbowmen
// do not (the owner, 2026-11-01).
import { isM2UnitActive, isM2UnitAlive } from "./M2_BattleState.js";
import { M2_MORALE_DEFINITION } from "./M2_Definitions.js";

const EDGE = M2_MORALE_DEFINITION.retreatEdgeZ;
// A running man still on the field: one who has reached his side's edge has got away (the battle counts him
// as fled), and is out of reach.
const isRunning = (unit) => isM2UnitAlive(unit) && unit.state === "routing"
  && (unit.sideId === "ally" ? unit.position.z < EDGE : unit.position.z > -EDGE);
// Pursuers ride no closer than this to the runners' edge (m).
const EDGE_MARGIN = 2;

// The broken formation this formation is pursuing, or null: it is set to pursue, sent against that
// formation, none of whose men still fights, and some of whom are running.
export function pursuedFormation(battleState, formation) {
  if (!formation?.pursuit || formation.order.type !== "attack_target") return null;
  const target = battleState.getFormation(formation.order.targetFormationId);
  if (!target || target.sideId === formation.sideId) return null;
  let running = false;
  for (const id of target.memberUnitIds) {
    const unit = battleState.getUnit(id);
    if (isM2UnitActive(unit)) return null;
    if (isRunning(unit)) running = true;
  }
  return running ? target : null;
}

// Whether attacker may strike (or shoot at) target: any enemy still fighting; a running one only if the
// attacker's formation is pursuing his formation, or the attacker is the hero (the player chooses whom he cuts down).
export function mayStrike(battleState, attacker, target) {
  if (!target || target.sideId === attacker.sideId) return false;
  if (isM2UnitActive(target)) return true;
  if (!isRunning(target)) return false;
  if (attacker.isPlayer) return true;
  const own = attacker.formationId ? battleState.getFormation(attacker.formationId) : null;
  return pursuedFormation(battleState, own)?.formationId === target.formationId;
}

// Where a pursuing soldier runs: at the nearest runner of the pursued formation (a crossbowman only until he
// is within standOff of him, to shoot), but not up to the runners' edge of the field.
export function pursuitTarget(battleState, unit, standOff = 0) {
  const formation = unit.formationId ? battleState.getFormation(unit.formationId) : null;
  const pursued = pursuedFormation(battleState, formation);
  if (!pursued) return null;
  const edge = EDGE - EDGE_MARGIN;
  let best = null;
  for (const id of pursued.memberUnitIds) {
    const enemy = battleState.getUnit(id);
    if (!isRunning(enemy)) continue;
    const d = Math.hypot(enemy.position.x - unit.position.x, enemy.position.z - unit.position.z);
    if (!best || d < best.d || (d === best.d && id < best.id)) best = { d, id, x: enemy.position.x, z: enemy.position.z };
  }
  if (!best) return null;
  let { x, z } = best;
  if (standOff > 0) {
    if (best.d <= standOff) return { x: unit.position.x, z: unit.position.z };
    const k = (best.d - standOff) / best.d;
    x = unit.position.x + (best.x - unit.position.x) * k;
    z = unit.position.z + (best.z - unit.position.z) * k;
  }
  z = pursued.sideId === "ally" ? Math.min(z, edge) : Math.max(z, -edge);
  return { x, z };
}
