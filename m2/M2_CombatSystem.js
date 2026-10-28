import {
  M2_MELEE_DEFINITION,
  M2_BLOCK_DEFINITION,
  M2_BOW_DEFINITION,
  M2_PROJECTILE_DEFINITION
} from "./M2_Definitions.js";
import { isM2UnitActive } from "./M2_BattleState.js";

const TAU = Math.PI * 2;

function wrapAngle(angle) {
  let value = angle % TAU;
  if (value > Math.PI) value -= TAU;
  if (value < -Math.PI) value += TAU;
  return value;
}

function inFacingArc(heading, dx, dz, arcDegrees) {
  if (dx === 0 && dz === 0) return true;
  const targetHeading = Math.atan2(dx, dz);
  return Math.abs(wrapAngle(targetHeading - heading)) <= (arcDegrees * Math.PI / 180) / 2;
}

function hashLaunchSeed(seed, commandId, actorUnitId, processingTick) {
  const text = `${seed}|${commandId}|${actorUnitId}|${processingTick}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function segmentCircleHit(previous, current, center, radius) {
  const dx = current.x - previous.x;
  const dz = current.z - previous.z;
  const fx = previous.x - center.x;
  const fz = previous.z - center.z;
  const a = dx * dx + dz * dz;
  if (a <= 1e-12) {
    const distanceSq = fx * fx + fz * fz;
    return distanceSq <= radius * radius ? { t: 0, distanceSq } : null;
  }
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  const candidates = [t1, t2].filter((value) => value >= 0 && value <= 1).sort((x, y) => x - y);
  if (!candidates.length) return null;
  const t = candidates[0];
  const hitX = previous.x + dx * t;
  const hitZ = previous.z + dz * t;
  const distanceSq = (hitX - center.x) ** 2 + (hitZ - center.z) ** 2;
  return { t, distanceSq };
}

function damageAfterBlock(target, attackerPosition, baseDamage) {
  if (!target.blocking) return Math.max(0, Math.round(baseDamage));
  const incomingX = attackerPosition.x - target.position.x;
  const incomingZ = attackerPosition.z - target.position.z;
  if (!inFacingArc(target.heading, incomingX, incomingZ, M2_BLOCK_DEFINITION.frontArcDegrees)) {
    return Math.max(0, Math.round(baseDamage));
  }
  return Math.max(0, Math.round(baseDamage * M2_BLOCK_DEFINITION.damageMultiplier));
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function collectMeleeCandidateFacts(battleState, spatialGrid, actor, aimHeading) {
  const candidates = [];
  for (const unitId of spatialGrid.queryNearby(actor.position.x, actor.position.z, M2_MELEE_DEFINITION.range)) {
    const target = battleState.getUnit(unitId);
    if (!isM2UnitActive(target) || target.sideId === actor.sideId || target.unitId === actor.unitId) continue;
    const dx = target.position.x - actor.position.x;
    const dz = target.position.z - actor.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > M2_MELEE_DEFINITION.range) continue;
    if (!inFacingArc(aimHeading, dx, dz, M2_MELEE_DEFINITION.facingArcDegrees)) continue;
    candidates.push({ unitId: target.unitId, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.unitId.localeCompare(b.unitId));
  return candidates;
}

function collectContactCandidateFacts(battleState, spatialGrid, attacker) {
  const candidates = [];
  for (const unitId of spatialGrid.queryNearby(attacker.position.x, attacker.position.z, M2_MELEE_DEFINITION.range)) {
    const target = battleState.getUnit(unitId);
    if (!isM2UnitActive(target) || target.sideId === attacker.sideId || target.unitId === attacker.unitId) continue;
    const dx = target.position.x - attacker.position.x;
    const dz = target.position.z - attacker.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= M2_MELEE_DEFINITION.range) candidates.push({ unitId: target.unitId, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.unitId.localeCompare(b.unitId));
  return candidates;
}

function collectProjectileStepFacts(battleState, spatialGrid, projectile, deltaSeconds) {
  const previousPosition = { ...projectile.position };
  const travel = Math.min(projectile.remainingRange, projectile.speed * deltaSeconds);
  const nextPosition = {
    x: projectile.position.x + projectile.direction.x * travel,
    y: projectile.position.y,
    z: projectile.position.z + projectile.direction.z * travel
  };
  const nextRemainingRange = Math.max(0, projectile.remainingRange - travel);
  const midX = (previousPosition.x + nextPosition.x) / 2;
  const midZ = (previousPosition.z + nextPosition.z) / 2;
  const radius = travel / 2 + M2_PROJECTILE_DEFINITION.hitRadius + 0.75;
  const candidates = [];

  for (const unitId of spatialGrid.queryNearby(midX, midZ, radius)) {
    const target = battleState.getUnit(unitId);
    if (!isM2UnitActive(target) || target.sideId === projectile.sideId || target.unitId === projectile.ownerUnitId) continue;
    const hit = segmentCircleHit(previousPosition, nextPosition, target.position, M2_PROJECTILE_DEFINITION.hitRadius);
    if (hit) candidates.push({ unitId: target.unitId, t: hit.t, distanceSq: hit.distanceSq });
  }

  candidates.sort((a, b) => a.t - b.t || a.distanceSq - b.distanceSq || a.unitId.localeCompare(b.unitId));
  return {
    projectileId: projectile.projectileId,
    previousPosition,
    nextPosition,
    nextRemainingRange,
    candidates,
    selectedTargetUnitId: candidates[0]?.unitId || null
  };
}

function potentialBowProjectile(battleState, command) {
  const actor = battleState.getUnit(command.actorUnitId);
  if (!actor || !actor.isPlayer || !isM2UnitActive(actor)) return null;
  return {
    projectileId: `projectile:${command.commandId}`,
    ownerUnitId: actor.unitId,
    sideId: actor.sideId,
    position: { x: actor.position.x, y: 1.25, z: actor.position.z },
    direction: { x: Math.sin(command.aimHeading), z: Math.cos(command.aimHeading) },
    speed: M2_PROJECTILE_DEFINITION.speed,
    remainingRange: M2_PROJECTILE_DEFINITION.maxRange
  };
}

export class M2CombatSystem {
  #projectileLaunchCount = 0;
  #projectileHitCount = 0;
  #projectileOverflowCount = 0;
  #attackEventCount = 0;

  getObservation(battleState) {
    return Object.freeze({
      projectileLaunchCount: this.#projectileLaunchCount,
      activeProjectileCount: battleState.projectileCount,
      projectileHitCount: this.#projectileHitCount,
      projectileOverflowCount: this.#projectileOverflowCount,
      attackEventCount: this.#attackEventCount
    });
  }

  // Fixed-tick phase 5 only:
  // 1) decrement active cooldowns exactly once, then
  // 2) collect all spatial/contact facts into a battle-tick-local plain plan.
  prepareTick(battleState, spatialGrid, commands, deltaSeconds) {
    battleState.forEachUnitStable((unit) => {
      if (!isM2UnitActive(unit)) return;
      unit.attackCooldownTicks = Math.max(0, unit.attackCooldownTicks - 1);
    });

    const playerMelee = [];
    for (const command of commands) {
      if (command.type !== "player_melee_attack") continue;
      const actor = battleState.getUnit(command.actorUnitId);
      const candidates = actor && actor.isPlayer && isM2UnitActive(actor)
        ? collectMeleeCandidateFacts(battleState, spatialGrid, actor, command.aimHeading)
        : [];
      playerMelee.push({
        commandId: command.commandId,
        actorUnitId: command.actorUnitId,
        candidates,
        selectedTargetUnitId: candidates[0]?.unitId || null
      });
    }

    const nonPlayerMelee = [];
    for (const attackerId of battleState.getUnitIdsStable()) {
      const attacker = battleState.getUnit(attackerId);
      if (!isM2UnitActive(attacker) || attacker.isPlayer) continue;
      const formation = battleState.getFormation(attacker.formationId);
      if (!formation || formation.order.type !== "attack_target") continue;
      const candidates = collectContactCandidateFacts(battleState, spatialGrid, attacker);
      nonPlayerMelee.push({
        attackerUnitId: attacker.unitId,
        candidates,
        selectedTargetUnitId: candidates[0]?.unitId || null
      });
    }

    const projectileSteps = [];
    const plannedProjectileIds = new Set();
    for (const projectileId of battleState.getProjectileIdsStable()) {
      const projectile = battleState.getProjectile(projectileId);
      if (!projectile) continue;
      projectileSteps.push(collectProjectileStepFacts(battleState, spatialGrid, projectile, deltaSeconds));
      plannedProjectileIds.add(projectileId);
    }

    // Bow commands can create a projectile in phase 6 before projectile progression.
    // Pre-collect the first swept-segment candidates here so phase 6 still performs no grid query.
    for (const command of commands) {
      if (command.type !== "player_bow_fire") continue;
      const projectile = potentialBowProjectile(battleState, command);
      if (!projectile || plannedProjectileIds.has(projectile.projectileId)) continue;
      projectileSteps.push(collectProjectileStepFacts(battleState, spatialGrid, projectile, deltaSeconds));
      plannedProjectileIds.add(projectile.projectileId);
    }
    projectileSteps.sort((a, b) => a.projectileId.localeCompare(b.projectileId));

    return freezeDeep({
      playerMelee,
      nonPlayerMelee,
      projectileSteps
    });
  }

  applyBlockCommands(battleState, commands) {
    for (const command of commands) {
      if (command.type !== "player_block") continue;
      const unit = battleState.getUnit(command.actorUnitId);
      if (!unit || !unit.isPlayer || !isM2UnitActive(unit)) continue;
      unit.blocking = command.active;
      unit.heading = command.aimHeading;
      unit.revision += 1;
    }
  }

  resolvePlayerMelee(battleState, commands, candidatePlan, damageEvents) {
    const byCommandId = new Map(candidatePlan.playerMelee.map((record) => [record.commandId, record]));
    for (const command of commands) {
      if (command.type !== "player_melee_attack") continue;
      const actor = battleState.getUnit(command.actorUnitId);
      if (!actor || !actor.isPlayer || !isM2UnitActive(actor) || actor.attackCooldownTicks !== 0) continue;
      // A swing costs its cooldown whether or not it reaches anyone (owner decision 2026-10-28),
      // the same as the bow; otherwise tapping attack out of reach could be repeated every tick.
      actor.heading = command.aimHeading;
      actor.attackCooldownTicks = M2_MELEE_DEFINITION.cooldownTicks;
      actor.state = "attacking";
      actor.revision += 1;
      const targetId = byCommandId.get(command.commandId)?.selectedTargetUnitId || null;
      const target = targetId ? battleState.getUnit(targetId) : null;
      if (!isM2UnitActive(target) || target.sideId === actor.sideId) continue;
      const damage = damageAfterBlock(target, actor.position, M2_MELEE_DEFINITION.baseDamage);
      damageEvents.push({
        damageEventId: `melee:${command.commandId}:${target.unitId}`,
        sourceUnitId: actor.unitId,
        targetUnitId: target.unitId,
        damage
      });
      this.#attackEventCount += 1;
    }
  }

  resolveBowLaunch(battleState, commands, processingTick) {
    for (const command of commands) {
      if (command.type !== "player_bow_fire") continue;
      const actor = battleState.getUnit(command.actorUnitId);
      if (!actor || !actor.isPlayer || !isM2UnitActive(actor) || actor.attackCooldownTicks !== 0) continue;
      if (battleState.projectileCount >= M2_PROJECTILE_DEFINITION.maxActive) {
        this.#projectileOverflowCount += 1;
        continue;
      }
      const projectileId = `projectile:${command.commandId}`;
      if (battleState.getProjectile(projectileId)) continue;
      const launchSeed = hashLaunchSeed(battleState.seed, command.commandId, actor.unitId, processingTick);
      const direction = { x: Math.sin(command.aimHeading), z: Math.cos(command.aimHeading) };
      const projectile = {
        projectileId,
        projectileTypeId: M2_PROJECTILE_DEFINITION.id,
        ownerUnitId: actor.unitId,
        sideId: actor.sideId,
        launchSeed,
        position: { x: actor.position.x, y: 1.25, z: actor.position.z },
        previousPosition: { x: actor.position.x, y: 1.25, z: actor.position.z },
        direction,
        speed: M2_PROJECTILE_DEFINITION.speed,
        remainingRange: M2_PROJECTILE_DEFINITION.maxRange,
        damage: M2_BOW_DEFINITION.baseDamage,
        revision: 0
      };
      if (battleState.addProjectile(projectile)) {
        actor.attackCooldownTicks = M2_BOW_DEFINITION.cooldownTicks;
        actor.heading = command.aimHeading;
        actor.state = "attacking";
        actor.revision += 1;
        this.#projectileLaunchCount += 1;
      }
    }
  }

  resolveNonPlayerContactMelee(battleState, candidatePlan, damageEvents, processingTick) {
    const byAttackerId = new Map(candidatePlan.nonPlayerMelee.map((record) => [record.attackerUnitId, record]));
    for (const attackerId of battleState.getUnitIdsStable()) {
      const attacker = battleState.getUnit(attackerId);
      if (!isM2UnitActive(attacker) || attacker.isPlayer || attacker.attackCooldownTicks !== 0) continue;
      const formation = battleState.getFormation(attacker.formationId);
      if (!formation || formation.order.type !== "attack_target") continue;
      const targetId = byAttackerId.get(attacker.unitId)?.selectedTargetUnitId || null;
      const target = targetId ? battleState.getUnit(targetId) : null;
      if (!isM2UnitActive(target) || target.sideId === attacker.sideId) continue;

      attacker.heading = Math.atan2(target.position.x - attacker.position.x, target.position.z - attacker.position.z);
      damageEvents.push({
        damageEventId: `auto_melee:${processingTick}:${attacker.unitId}:${target.unitId}`,
        sourceUnitId: attacker.unitId,
        targetUnitId: target.unitId,
        damage: damageAfterBlock(target, attacker.position, M2_MELEE_DEFINITION.baseDamage)
      });
      attacker.attackCooldownTicks = M2_MELEE_DEFINITION.cooldownTicks;
      attacker.state = "attacking";
      attacker.revision += 1;
      this.#attackEventCount += 1;
    }
  }

  progressProjectiles(battleState, candidatePlan, damageEvents) {
    for (const step of candidatePlan.projectileSteps) {
      const projectile = battleState.getProjectile(step.projectileId);
      if (!projectile) continue;

      projectile.previousPosition = { ...step.previousPosition };
      projectile.position = { ...step.nextPosition };
      projectile.remainingRange = step.nextRemainingRange;
      projectile.revision += 1;

      const target = step.selectedTargetUnitId ? battleState.getUnit(step.selectedTargetUnitId) : null;
      if (target && isM2UnitActive(target) && target.sideId !== projectile.sideId && target.unitId !== projectile.ownerUnitId) {
        damageEvents.push({
          damageEventId: `projectile:${projectile.projectileId}:${target.unitId}`,
          sourceUnitId: projectile.ownerUnitId,
          targetUnitId: target.unitId,
          damage: damageAfterBlock(target, step.previousPosition, projectile.damage)
        });
        battleState.removeProjectile(projectile.projectileId);
        this.#projectileHitCount += 1;
      } else if (projectile.remainingRange <= 0) {
        battleState.removeProjectile(projectile.projectileId);
      }
    }
  }

  applyDamageEvents(battleState, damageEvents) {
    const receipts = [];
    for (const event of [...damageEvents].sort((a, b) => a.damageEventId.localeCompare(b.damageEventId))) {
      const source = battleState.getUnit(event.sourceUnitId);
      const target = battleState.getUnit(event.targetUnitId);
      if (!target || (source && source.sideId === target.sideId)) {
        receipts.push({ damageEventId: event.damageEventId, applied: false, damage: 0, friendlyFireRejected: true });
        continue;
      }
      receipts.push({ damageEventId: event.damageEventId, ...battleState.applyDamageEvent(event) });
    }
    return receipts;
  }
}

export const M2_COMBAT_INTERNALS_FOR_TEST = Object.freeze({
  hashLaunchSeed,
  segmentCircleHit,
  damageAfterBlock,
  inFacingArc,
  collectMeleeCandidateFacts,
  collectContactCandidateFacts,
  collectProjectileStepFacts
});
