import { M2_MORALE_DEFINITION } from "./M2_Definitions.js";
import { isM2UnitActive, isM2UnitAlive } from "./M2_BattleState.js";

const TAU = Math.PI * 2;

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function round2(value) { return Math.round(value * 100) / 100; }
function wrapAngle(angle) { let value = angle % TAU; if (value > Math.PI) value -= TAU; if (value < -Math.PI) value += TAU; return value; }
function retreatTarget(unit) { return { x: unit.position.x, z: unit.sideId === "ally" ? M2_MORALE_DEFINITION.retreatEdgeZ : -M2_MORALE_DEFINITION.retreatEdgeZ }; }
function formationRetreatTarget(formation) { return { x: formation.anchor.x, z: formation.sideId === "ally" ? M2_MORALE_DEFINITION.retreatEdgeZ : -M2_MORALE_DEFINITION.retreatEdgeZ }; }

function setUnitRouting(unit, reasonId, { preserveManual = false } = {}) {
  if (!isM2UnitAlive(unit)) return false;
  const priorReason = unit.routeReasonId;
  const reason = preserveManual && priorReason === "m2_route_manual_retreat" ? priorReason : reasonId;
  const target = unit.routeTarget && unit.state === "routing" ? { x: unit.routeTarget.x, z: unit.routeTarget.z } : retreatTarget(unit);
  const changed = unit.state !== "routing" || unit.routeReasonId !== reason || !unit.routeTarget || unit.routeTarget.x !== target.x || unit.routeTarget.z !== target.z || unit.blocking || unit.directMoveIntent.x !== 0 || unit.directMoveIntent.z !== 0 || unit.targetUnitId !== null;
  unit.state = "routing";
  unit.routeReasonId = reason;
  unit.routeTarget = target;
  unit.blocking = false;
  unit.directMoveIntent = { x: 0, z: 0 };
  unit.targetUnitId = null;
  if (changed) unit.revision += 1;
  return changed;
}

function calculateCohesion(battleState, formation) {
  const originalCount = formation.memberUnitIds.length;
  const activeIds = formation.memberUnitIds.filter((unitId) => isM2UnitActive(battleState.getUnit(unitId))).sort();
  if (activeIds.length === 0) return 0;
  const strengthScore = 100 * activeIds.length / Math.max(1, originalCount);
  let errorTotal = 0;
  for (const unitId of activeIds) {
    const unit = battleState.getUnit(unitId);
    const target = unit.slotTarget || unit.position;
    const error = Math.hypot(unit.position.x - target.x, unit.position.z - target.z);
    errorTotal += clamp(error, 0, M2_MORALE_DEFINITION.cohesionSlotErrorCap);
  }
  const meanSlotError = errorTotal / activeIds.length;
  const slotScore = clamp(100 - meanSlotError * M2_MORALE_DEFINITION.cohesionSlotErrorScale, 0, 100);
  return round2(clamp(slotScore * M2_MORALE_DEFINITION.cohesionSlotWeight + strengthScore * M2_MORALE_DEFINITION.cohesionStrengthWeight, 0, 100));
}

function calculateFormationMorale(battleState, formation) {
  const values = formation.memberUnitIds.map((unitId) => battleState.getUnit(unitId)).filter((unit) => isM2UnitAlive(unit)).map((unit) => unit.morale);
  if (!values.length) return 0;
  return round2(clamp(values.reduce((sum, value) => sum + value, 0) / values.length, M2_MORALE_DEFINITION.minMorale, M2_MORALE_DEFINITION.maxMorale));
}

function commanderContribution(battleState, formation) {
  const commander = battleState.getUnit(formation.commanderUnitId);
  if (isM2UnitActive(commander)) return M2_MORALE_DEFINITION.commanderActiveBonus;
  if (isM2UnitAlive(commander) && commander.state === "routing") return -M2_MORALE_DEFINITION.commanderRoutingPenalty;
  return -M2_MORALE_DEFINITION.commanderLostPenalty;
}

function adjacentDeathContribution(unit, newlyLostThisTick) {
  let count = 0;
  for (const lost of newlyLostThisTick) {
    if (lost.sideId !== unit.sideId || lost.unitId === unit.unitId) continue;
    const distance = Math.hypot(unit.position.x - lost.position.x, unit.position.z - lost.position.z);
    if (distance <= M2_MORALE_DEFINITION.adjacentDeathRadius) count += 1;
  }
  return -M2_MORALE_DEFINITION.adjacentDeathPenalty * Math.min(count, M2_MORALE_DEFINITION.adjacentDeathCountCap);
}

function flankContribution(battleState, unit) {
  let count = 0;
  const halfArc = (M2_MORALE_DEFINITION.frontArcDegrees * Math.PI / 180) / 2;
  for (const enemyId of battleState.getUnitIdsStable()) {
    const enemy = battleState.getUnit(enemyId);
    if (!isM2UnitActive(enemy) || enemy.sideId === unit.sideId) continue;
    const dx = enemy.position.x - unit.position.x;
    const dz = enemy.position.z - unit.position.z;
    if (Math.hypot(dx, dz) > M2_MORALE_DEFINITION.flankThreatRadius) continue;
    const targetHeading = Math.atan2(dx, dz);
    if (Math.abs(wrapAngle(targetHeading - unit.heading)) > halfArc) count += 1;
  }
  return -M2_MORALE_DEFINITION.flankThreatPenalty * Math.min(count, M2_MORALE_DEFINITION.flankThreatCountCap);
}

function battleBalanceContribution(unit, activeCounts) {
  const friendly = activeCounts[unit.sideId] || 0;
  const enemySide = unit.sideId === "ally" ? "enemy" : "ally";
  const enemy = activeCounts[enemySide] || 0;
  const balance = clamp((friendly - enemy) / Math.max(1, friendly + enemy), -1, 1);
  return balance * M2_MORALE_DEFINITION.battleBalanceContributionScale;
}

export class M2MoraleSystem {
  step(battleState, { newlyLostThisTick = [], commands = [], processingTick = battleState.tick + 1 } = {}) {
    if (!Number.isSafeInteger(processingTick) || processingTick < 1) throw new Error("m2_morale_tick_invalid");
    const stableLosses = [...newlyLostThisTick].map((loss) => ({ unitId: loss.unitId, sideId: loss.sideId, formationId: loss.formationId, position: { x: Number(loss.position.x), z: Number(loss.position.z) } })).sort((a, b) => a.unitId.localeCompare(b.unitId));

    for (const formationId of battleState.getFormationIdsStable()) {
      const formation = battleState.getFormation(formationId);
      const next = calculateCohesion(battleState, formation);
      if (formation.cohesion !== next) { formation.cohesion = next; formation.revision += 1; }
    }

    const activeCounts = { ally: 0, enemy: 0 };
    for (const unitId of battleState.getUnitIdsStable()) {
      const unit = battleState.getUnit(unitId);
      if (isM2UnitActive(unit)) activeCounts[unit.sideId] = (activeCounts[unit.sideId] || 0) + 1;
    }

    for (const unitId of battleState.getUnitIdsStable()) {
      const unit = battleState.getUnit(unitId);
      if (!isM2UnitAlive(unit)) continue;
      const formation = battleState.getFormation(unit.formationId);
      if (!formation) continue;
      if (formation.order.type === "rally" && unit.state === "routing") continue;
      const hpRatio = unit.maxHp > 0 ? unit.hp / unit.maxHp : 0;
      const targetMorale = clamp(unit.initialMorale + adjacentDeathContribution(unit, stableLosses) + (formation.cohesion - 50) * M2_MORALE_DEFINITION.cohesionContributionWeight + commanderContribution(battleState, formation) + flankContribution(battleState, unit) + (hpRatio - 0.5) * M2_MORALE_DEFINITION.hpContributionScale + battleBalanceContribution(unit, activeCounts), M2_MORALE_DEFINITION.minMorale, M2_MORALE_DEFINITION.maxMorale);
      const rawDelta = targetMorale - unit.morale;
      const delta = clamp(rawDelta, -M2_MORALE_DEFINITION.moraleFallCapPerTick, M2_MORALE_DEFINITION.moraleRiseCapPerTick);
      const next = round2(clamp(unit.morale + delta, M2_MORALE_DEFINITION.minMorale, M2_MORALE_DEFINITION.maxMorale));
      if (next !== unit.morale) { unit.morale = next; unit.revision += 1; }
    }

    for (const formationId of battleState.getFormationIdsStable()) {
      const formation = battleState.getFormation(formationId);
      const next = calculateFormationMorale(battleState, formation);
      if (formation.morale !== next) { formation.morale = next; formation.revision += 1; }
    }

    for (const unitId of battleState.getUnitIdsStable()) {
      const unit = battleState.getUnit(unitId);
      if (isM2UnitAlive(unit) && unit.state !== "routing" && unit.morale <= M2_MORALE_DEFINITION.unitRouteThreshold) setUnitRouting(unit, "m2_route_morale_threshold");
    }

    for (const formationId of battleState.getFormationIdsStable()) {
      const formation = battleState.getFormation(formationId);
      if (formation.order.type === "rally") continue;
      const living = formation.memberUnitIds.map((id) => battleState.getUnit(id)).filter((unit) => isM2UnitAlive(unit));
      const routingLiving = living.filter((unit) => unit.state === "routing").length;
      const broken = formation.morale <= M2_MORALE_DEFINITION.formationRouteThreshold || routingLiving / Math.max(1, living.length) >= M2_MORALE_DEFINITION.formationRoutingRatioThreshold;
      if (!broken || living.length === 0) continue;
      const target = formationRetreatTarget(formation);
      const orderChanged = formation.order.type !== "withdraw" || formation.order.target?.x !== target.x || formation.order.target?.z !== target.z || formation.order.targetFormationId !== null;
      formation.order = { type: "withdraw", target, targetFormationId: null, commandId: formation.order.commandId || null };
      if (orderChanged) formation.revision += 1;
      for (const unit of living.sort((a, b) => a.unitId.localeCompare(b.unitId))) setUnitRouting(unit, "m2_route_formation_break", { preserveManual: true });
    }

    const manualRetreatIds = commands.filter((command) => command.type === "formation_retreat").map((command) => command.formationId).sort();
    for (const formationId of manualRetreatIds) {
      const formation = battleState.getFormation(formationId);
      if (!formation) continue;
      for (const unitId of [...formation.memberUnitIds].sort()) {
        const unit = battleState.getUnit(unitId);
        if (isM2UnitAlive(unit)) setUnitRouting(unit, "m2_route_manual_retreat");
      }
    }

    for (const formationId of battleState.getFormationIdsStable()) {
      const formation = battleState.getFormation(formationId);
      if (formation.order.type !== "rally") continue;
      const commander = battleState.getUnit(formation.commanderUnitId);
      if (!isM2UnitAlive(commander)) continue;
      for (const unitId of [...formation.memberUnitIds].sort()) {
        const unit = battleState.getUnit(unitId);
        if (!isM2UnitAlive(unit) || unit.state !== "routing") continue;
        const next = round2(Math.min(M2_MORALE_DEFINITION.maxMorale, unit.morale + M2_MORALE_DEFINITION.rallyRecoveryPerTick));
        if (next !== unit.morale) { unit.morale = next; unit.revision += 1; }
        if (unit.morale >= M2_MORALE_DEFINITION.rallyExitMorale) {
          unit.state = "idle";
          unit.routeReasonId = null;
          unit.routeTarget = null;
          unit.velocity = { x: 0, z: 0 };
          unit.revision += 1;
        }
      }
    }

    for (const formationId of battleState.getFormationIdsStable()) {
      const formation = battleState.getFormation(formationId);
      if (formation.order.type !== "rally") continue;
      const routingLiving = formation.memberUnitIds.map((id) => battleState.getUnit(id)).filter((unit) => isM2UnitAlive(unit) && unit.state === "routing").length;
      if (routingLiving === 0 && formation.morale >= M2_MORALE_DEFINITION.rallyFormationHoldMorale) {
        formation.order = { type: "hold", target: null, targetFormationId: null, commandId: formation.order.commandId || null };
        formation.revision += 1;
      }
    }

    const routingCounts = { ally: 0, enemy: 0, total: 0 };
    battleState.forEachUnitStable((unit) => {
      if (!isM2UnitAlive(unit) || unit.state !== "routing") return;
      routingCounts[unit.sideId] = (routingCounts[unit.sideId] || 0) + 1;
      routingCounts.total += 1;
    });
    return Object.freeze({ processingTick, newlyLostCount: stableLosses.length, routingCounts: Object.freeze(routingCounts) });
  }
}

export const M2_MORALE_INTERNALS_FOR_TEST = Object.freeze({ calculateCohesion, calculateFormationMorale, adjacentDeathContribution, commanderContribution, flankContribution, battleBalanceContribution });
