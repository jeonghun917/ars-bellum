import { isM2UnitAlive } from "./M2_BattleState.js";
import { m2LastSeen, m2Sees } from "./M2_Vision.js";
function freezeDeep(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freezeDeep(child); return value; }
function round2(value) { return Math.round(value * 100) / 100; }
// What the player's side sees of a unit (M2_Vision.js): seen, or not, and then where it was last seen (drawn
// there faded), or null if never.
function sightOf(battleState, unit) {
  if (m2Sees(battleState, "ally", unit)) return { seen: true, lastSeen: null };
  const last = m2LastSeen(battleState, "ally", unit);
  return { seen: false, lastSeen: last ? { x: last.x, z: last.z, heading: last.heading, alive: last.alive } : null };
}
export function createRenderSnapshot(battleState, { tick = battleState.tick, selectedFormationIds = [] } = {}) {
  const units = battleState.getUnitIdsStable().map((unitId) => { const unit = battleState.getUnit(unitId); return { unitId: unit.unitId, sideId: unit.sideId, formationId: unit.formationId, kindId: unit.kindId, unitTypeId: unit.unitTypeId || null, loadout: unit.loadout || null, armorId: unit.armorId || null, helmId: unit.helmId || null, combatProfileId: unit.combatProfileId, isPlayer: unit.isPlayer, heroAppearance: unit.hero ? unit.hero.appearance : null, bowRange: unit.isPlayer ? (unit.hero ? unit.hero.ranged?.range ?? null : null) : null, isCommander: Boolean(unit.commander), commanderAppearance: unit.commander ? (unit.kindId === "crossbow" ? "xbow" : unit.commander.combat.appearance) : null, position: { ...unit.position }, previousPosition: { ...unit.previousPosition }, heading: unit.heading, velocity: { ...unit.velocity }, hp: unit.hp, maxHp: unit.maxHp, hpRatio: unit.maxHp > 0 ? unit.hp / unit.maxHp : 0, morale: unit.morale, routeReasonId: unit.routeReasonId, blocking: unit.blocking, attackCooldownTicks: unit.attackCooldownTicks || 0, state: unit.state, ...sightOf(battleState, unit) }; });
  const formations = battleState.getFormationIdsStable().map((formationId) => { const formation = battleState.getFormation(formationId); return { formationId: formation.formationId, sideId: formation.sideId, anchor: { ...formation.anchor }, formationTypeId: formation.formationTypeId, order: { type: formation.order.type, targetFormationId: formation.order.targetFormationId || null }, cohesion: formation.cohesion, morale: formation.morale, selected: selectedFormationIds.includes(formation.formationId) }; });
  const projectiles = battleState.getProjectileIdsStable().map((projectileId) => { const projectile = battleState.getProjectile(projectileId); return { projectileId: projectile.projectileId, projectileTypeId: projectile.projectileTypeId, sideId: projectile.sideId, position: { ...projectile.position }, previousPosition: { ...projectile.previousPosition } }; });
  const livingBySide = { ally: [], enemy: [] }; const routingCounts = { ally: 0, enemy: 0, total: 0 };
  for (const unitId of battleState.getUnitIdsStable()) { const unit = battleState.getUnit(unitId); if (!isM2UnitAlive(unit)) continue; if (livingBySide[unit.sideId]) livingBySide[unit.sideId].push(unit.morale); if (unit.state === "routing") { routingCounts[unit.sideId] = (routingCounts[unit.sideId] || 0) + 1; routingCounts.total += 1; } }
  const mean = (values) => values.length ? round2(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  const moraleSummary = { ally: mean(livingBySide.ally), enemy: mean(livingBySide.enemy) };
  const player = battleState.getUnit(battleState.playerCharacterId);
  return freezeDeep({ schema: "ARS_BELLUM_M2_RENDER_SNAPSHOT_V1", phase: "M2-1/03", battleId: battleState.battleId, tick, activeUnits: units.filter((unit) => unit.hp > 0 && unit.state !== "incapacitated" && unit.state !== "dead").length, moraleSummary, routingCounts, sight: { enemySeen: units.filter((u) => u.sideId !== "ally" && u.seen).length, enemyFaded: units.filter((u) => !u.seen && u.lastSeen).length }, battleResultOutcome: battleState.getResult()?.outcome || null, units, formations, projectiles, playerUnitId: battleState.playerCharacterId, playerPosition: player ? { ...player.position } : null, selectedFormationIds: [...selectedFormationIds] });
}
