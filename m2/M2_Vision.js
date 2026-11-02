// Sight: the fog of war (전장의 안개, the owner's plan step 5; the owner, 2026-11-02: an enemy out of sight is
// left faded where he was last seen, sight is by distance only, and a side shares what any of its men see).
// - Each living soldier sees as far as his kind's visionRange (M2_UnitKinds.js: foot 20 m, crossbowmen 24,
//   horse 28, skirmishers 45). No hills or woods yet: distance only.
// - A side sees an enemy when any of its living men sees him; all the side shares it.
// - Each side knows where the other drew up before the battle (its scouts saw it deploy): at the start every
//   enemy is "last seen" where he stands, so an order against any enemy formation has somewhere to go. What
//   he does after, out of sight, is not known.
// - What a side does not see it does not know. Its commander (the enemy's, M2_EnemyAI.js, and the battle plans
//   of both sides, M2_Plans.js) and its formations sent against an enemy (M2_FormationSystem.js) go by the
//   enemy seen now, or else by where he was last seen. Nobody strikes or
//   shoots at an enemy his side does not see (M2_Pursuit.js mayStrike); a bolt already loosed still hits
//   whoever it meets.
// - The player's screen (M2_RenderSnapshot.js) shows an enemy his side does not see as a faded figure where he
//   was last seen.
// Sight is worked out at the start of every tick (M2_BattleRuntime.js), from where everyone stands, so the same
// battle plays out the same way.
import { isM2UnitActive, isM2UnitAlive } from "./M2_BattleState.js";
import { m2UnitKind } from "./M2_UnitKinds.js";

const SIDES = Object.freeze(["ally", "enemy"]);

function sightOf(unit) {
  return m2UnitKind(unit).visionRange ?? m2UnitKind("infantry").visionRange;
}

// Works out what each side sees now, and remembers where it last saw each enemy.
export function m2UpdateVision(battleState) {
  const previous = battleState.getVision();
  const units = battleState.getUnitIdsStable().map((id) => battleState.getUnit(id));
  const vision = { tick: battleState.tick };
  for (const sideId of SIDES) {
    const watchers = units.filter((u) => u.sideId === sideId && isM2UnitAlive(u)).map((u) => ({ x: u.position.x, z: u.position.z, r: sightOf(u) }));
    const seen = new Set();
    const last = new Map(previous?.[sideId]?.last || []);
    for (const unit of units) {
      if (unit.sideId === sideId) continue;
      const { x, z } = unit.position;
      const sees = watchers.some((w) => (w.x - x) ** 2 + (w.z - z) ** 2 <= w.r * w.r);
      if (!sees && previous) continue;
      if (sees) seen.add(unit.unitId);
      last.set(unit.unitId, Object.freeze({ x, z, heading: unit.heading, tick: battleState.tick, alive: isM2UnitAlive(unit), active: isM2UnitActive(unit) }));
    }
    vision[sideId] = { seen, last };
  }
  battleState.setVision(vision);
  return vision;
}

function visionOf(battleState) {
  return battleState.getVision() || m2UpdateVision(battleState);
}

// Whether sideId sees this unit now (its own men always).
export function m2Sees(battleState, sideId, unit) {
  if (!unit) return false;
  if (unit.sideId === sideId) return true;
  return visionOf(battleState)[sideId]?.seen.has(unit.unitId) ?? false;
}

// Where sideId last saw this enemy ({ x, z, heading, tick, alive, active }), or null if never (only an enemy
// added after the battle began).
export function m2LastSeen(battleState, sideId, unit) {
  return visionOf(battleState)[sideId]?.last.get(unit.unitId) || null;
}

// Where sideId believes a formation stands (the middle of its men still fighting): its own, where they are;
// an enemy's, where the men of it seen now stand, or else where those last seen fighting were seen; null when
// none of them was fighting when last seen.
export function m2KnownCentre(battleState, sideId, formation) {
  let x = 0;
  let z = 0;
  let n = 0;
  const add = (p) => { x += p.x; z += p.z; n += 1; };
  if (formation.sideId === sideId) {
    for (const id of battleState.getActiveFormationMemberIds(formation)) add(battleState.getUnit(id).position);
    return n ? { x: x / n, z: z / n } : null;
  }
  const vision = visionOf(battleState)[sideId];
  for (const id of formation.memberUnitIds) {
    const unit = battleState.getUnit(id);
    if (vision.seen.has(id) && isM2UnitActive(unit)) add(unit.position);
  }
  if (n) return { x: x / n, z: z / n };
  for (const id of formation.memberUnitIds) {
    const seen = vision.last.get(id);
    if (seen?.active) add(seen);
  }
  return n ? { x: x / n, z: z / n } : null;
}

// Whether sideId sees any man of this formation still fighting now.
export function m2SeesFormation(battleState, sideId, formation) {
  if (formation.sideId === sideId) return true;
  const vision = visionOf(battleState)[sideId];
  return formation.memberUnitIds.some((id) => vision.seen.has(id) && isM2UnitActive(battleState.getUnit(id)));
}
