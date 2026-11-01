// Stopping blows (the owner, 2026-11-01: blows hurt like a sword, and what keeps a man up is that he stops
// them). A soldier facing the blow catches it on his shield, or parries it with his weapon; one struck from
// the side or behind, or running, cannot. How often he stops one:
// - by what he carries (M2_UnitKinds.js: his loadout; a commander's or the hero's sheet): a shield best, a
//   weapon in both hands next, one in one hand least; only a shield stops bolts and arrows (a shield-bearer's
//   big shield most of them);
// - better with his guard (a soldier's combat profile) or his weapon skill (a commander's or the hero's sheet);
// - better in a shield wall (shields locked), worse against a horseman's charge (its weight goes through).
// A stopped blow does no harm. Whether a given blow is stopped is decided from the battle's seed and the
// blow's own id, so the same battle plays out the same way.
import { isM2UnitActive } from "./M2_BattleState.js";
import { m2LoadoutGuard, m2UnitKind } from "./M2_UnitKinds.js";

export const M2_DEFENSE = Object.freeze({
  frontArcDegrees: 120,
  // From the side (up to sideArcDegrees off his front) he stops a blow sideScale as often; from behind, never.
  sideArcDegrees: 240,
  sideScale: 0.5,
  // Against a blow, by what he defends with.
  melee: Object.freeze({ shield: 0.55, two_handed: 0.42, one_handed: 0.3 }),
  // Against a bolt or an arrow from in front: a shield, a shield-bearer's big shield (frontShield).
  shot: Object.freeze({ shield: 0.4, big_shield: 0.8 }),
  // Guard 50 (an ordinary man) adds nothing; each point over adds 0.4%, each under takes it.
  guardPerPoint: 0.004,
  // A commander's or the hero's skill with his weapon: 50 adds nothing, 100 adds 0.1.
  skillPerPoint: 0.002,
  shieldWall: 0.2,
  chargeScale: 0.5,
  most: 0.9
});

const TAU = Math.PI * 2;
// 1 for a blow from in front, sideScale from the side, 0 from behind.
function facing(defender, from) {
  const dx = from.x - defender.position.x;
  const dz = from.z - defender.position.z;
  if (dx === 0 && dz === 0) return 1;
  let a = (Math.atan2(dx, dz) - defender.heading) % TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  const off = Math.abs(a) * 180 / Math.PI;
  if (off <= M2_DEFENSE.frontArcDegrees / 2) return 1;
  if (off <= M2_DEFENSE.sideArcDegrees / 2) return M2_DEFENSE.sideScale;
  return 0;
}

// What he defends with, and how good he is with it (as a share added to his chance).
function guardOf(defender) {
  const sheet = defender.commander?.combat || defender.hero;
  if (sheet) {
    const guard = sheet.blockMultiplier < 0.7 ? "shield" : sheet.melee?.weaponClass === "two_handed" || sheet.melee?.weaponClass === "polearm" ? "two_handed" : "one_handed";
    return { guard, bonus: ((sheet.melee?.skill ?? 50) - 50) * M2_DEFENSE.skillPerPoint };
  }
  return { guard: m2LoadoutGuard(defender.loadout), bonus: ((defender.guard ?? 50) - 50) * M2_DEFENSE.guardPerPoint };
}

// The chance (0 to most) that defender stops a blow or shot coming from `from`.
export function stopChance(battleState, defender, from, { shot = false, charging = false } = {}) {
  if (!isM2UnitActive(defender) || defender.isPlayer) return 0;
  const toward = facing(defender, from);
  if (toward === 0) return 0;
  const { guard, bonus } = guardOf(defender);
  let chance;
  if (shot) {
    if (m2UnitKind(defender).frontShield) chance = M2_DEFENSE.shot.big_shield;
    else if (guard === "shield") chance = M2_DEFENSE.shot.shield;
    else return 0;
  } else {
    chance = M2_DEFENSE.melee[guard] + bonus;
  }
  const formation = defender.formationId ? battleState.getFormation(defender.formationId) : null;
  if (formation?.formationTypeId === "shield_wall" && defender.blocking) chance += M2_DEFENSE.shieldWall;
  if (charging) chance *= M2_DEFENSE.chargeScale;
  chance *= toward;
  return Math.max(0, Math.min(M2_DEFENSE.most, chance));
}

// A number in [0, 1) from the battle's seed and a blow's id.
export function roll(seed, id) {
  const text = `${seed}|stop|${id}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  return (hash >>> 0) / 4294967296;
}

// Whether this blow (id) from `from` is stopped.
export function stopped(battleState, defender, from, id, options) {
  const chance = stopChance(battleState, defender, from, options);
  return chance > 0 && roll(battleState.seed, id) < chance;
}
