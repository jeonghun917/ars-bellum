import {
  M2_MELEE_DEFINITION,
  M2_BLOCK_DEFINITION,
  M2_BOW_DEFINITION,
  M2_PROJECTILE_DEFINITION
} from "./M2_Definitions.js";
import { isM2UnitActive } from "./M2_BattleState.js";
import { m2UnitKind } from "./M2_UnitKinds.js";
import { M2_ORDERS, orderOf } from "./M2_Orders.js";
import { mayStrike, pursuedFormation } from "./M2_Pursuit.js";
import { stopped } from "./M2_Defense.js";

// A bolt or arrow hits a man still fighting; a running one only if it was shot in pursuit of his formation
// (or by the hero: M2_Pursuit.js).
function shotMayHit(projectile, target) {
  if (isM2UnitActive(target)) return true;
  if (!target || target.hp <= 0 || target.state !== "routing") return false;
  return projectile.pursuing === "any" || (Boolean(projectile.pursuing) && projectile.pursuing === target.formationId);
}

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

// The player, holding his block (or shield) up, takes a share of a blow from in front. Everyone else stops a
// blow or none of it (M2_Defense.js).
function damageAfterBlock(target, attackerPosition, baseDamage) {
  const shielded = target.isPlayer && target.blocking;
  if (!shielded) return Math.max(0, Math.round(baseDamage));
  const incomingX = attackerPosition.x - target.position.x;
  const incomingZ = attackerPosition.z - target.position.z;
  if (!inFacingArc(target.heading, incomingX, incomingZ, M2_BLOCK_DEFINITION.frontArcDegrees)) {
    return Math.max(0, Math.round(baseDamage));
  }
  // The hero blocks as well as his shield (or weapon) allows (M2_HeroLoadout.js).
  return Math.max(0, Math.round(baseDamage * (target.hero?.blockMultiplier ?? M2_BLOCK_DEFINITION.damageMultiplier)));
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

// The hero's weapon reaches as far as it is long (a spear further than a sword).
const reachOf = (actor) => actor.hero?.melee.reach ?? M2_MELEE_DEFINITION.range;

function collectMeleeCandidateFacts(battleState, spatialGrid, actor, aimHeading) {
  const candidates = [];
  const reach = reachOf(actor);
  for (const unitId of spatialGrid.queryNearby(actor.position.x, actor.position.z, reach)) {
    const target = battleState.getUnit(unitId);
    if (!mayStrike(battleState, actor, target) || target.unitId === actor.unitId) continue;
    const dx = target.position.x - actor.position.x;
    const dz = target.position.z - actor.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > reach) continue;
    if (!inFacingArc(aimHeading, dx, dz, M2_MELEE_DEFINITION.facingArcDegrees)) continue;
    candidates.push({ unitId: target.unitId, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.unitId.localeCompare(b.unitId));
  return candidates;
}

function collectContactCandidateFacts(battleState, spatialGrid, attacker, range = M2_MELEE_DEFINITION.range) {
  const candidates = [];
  for (const unitId of spatialGrid.queryNearby(attacker.position.x, attacker.position.z, range)) {
    const target = battleState.getUnit(unitId);
    if (!mayStrike(battleState, attacker, target) || target.unitId === attacker.unitId) continue;
    const dx = target.position.x - attacker.position.x;
    const dz = target.position.z - attacker.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= range) candidates.push({ unitId: target.unitId, distance });
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
    if (!shotMayHit(projectile, target) || target.sideId === projectile.sideId || target.unitId === projectile.ownerUnitId) continue;
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

// The hero's bow or crossbow (M2_HeroLoadout.js); without a sheet, the test bow.
function rangedOf(actor) {
  if (!actor.hero) return { damage: M2_BOW_DEFINITION.baseDamage, reloadTicks: M2_BOW_DEFINITION.cooldownTicks, speed: M2_PROJECTILE_DEFINITION.speed, range: M2_PROJECTILE_DEFINITION.maxRange };
  return actor.hero.ranged;
}

function potentialBowProjectile(battleState, command) {
  const actor = battleState.getUnit(command.actorUnitId);
  if (!actor || !actor.isPlayer || !isM2UnitActive(actor)) return null;
  const ranged = rangedOf(actor);
  if (!ranged) return null;
  return {
    projectileId: `projectile:${command.commandId}`,
    ownerUnitId: actor.unitId,
    sideId: actor.sideId,
    position: { x: actor.position.x, y: 1.25, z: actor.position.z },
    direction: { x: Math.sin(command.aimHeading), z: Math.cos(command.aimHeading) },
    speed: ranged.speed,
    remainingRange: ranged.range,
    pursuing: "any"
  };
}

// A crossbowman whose crossbow is spanned: the nearest living enemy within range he may shoot, and the bolt he
// would shoot at him this tick. Ordered to attack, he shoots any enemy; otherwise only enemies who are
// themselves attacking (their formation ordered to attack), so he returns fire but does not start a fight.
function potentialCrossbowShot(battleState, spatialGrid, shooter, processingTick) {
  const kind = m2UnitKind(shooter);
  const own = battleState.getFormation(shooter.formationId);
  const anyEnemy = own?.order.type === "attack_target";
  // Pursuing a broken formation (M2_Pursuit.js), he shoots at its runners, as under focused fire.
  const pursued = pursuedFormation(battleState, own)?.formationId || null;
  const focus = pursued || (orderOf(own)?.id === "focus_fire" && anyEnemy ? own.order.targetFormationId : null);
  let best = null;
  for (const unitId of spatialGrid.queryNearby(shooter.position.x, shooter.position.z, kind.range)) {
    const target = battleState.getUnit(unitId);
    if (!mayStrike(battleState, shooter, target)) continue;
    if (!anyEnemy && battleState.getFormation(target.formationId)?.order.type !== "attack_target") continue;
    // Focused fire: only the formation they are sent against (M2_Orders.js).
    if (focus && target.formationId !== focus) continue;
    const distance = Math.hypot(target.position.x - shooter.position.x, target.position.z - shooter.position.z);
    if (distance > kind.range || distance <= 0) continue;
    if (!best || distance < best.distance || (distance === best.distance && unitId < best.unitId)) best = { unitId, distance };
  }
  if (!best) return null;
  const target = battleState.getUnit(best.unitId);
  const aimHeading = Math.atan2(target.position.x - shooter.position.x, target.position.z - shooter.position.z);
  return {
    shooterUnitId: shooter.unitId,
    targetUnitId: best.unitId,
    aimHeading,
    projectile: {
      projectileId: `bolt:${String(processingTick).padStart(8, "0")}:${shooter.unitId}`,
      ownerUnitId: shooter.unitId,
      sideId: shooter.sideId,
      position: { x: shooter.position.x, y: 1.25, z: shooter.position.z },
      direction: { x: Math.sin(aimHeading), z: Math.cos(aimHeading) },
      speed: kind.boltSpeed,
      remainingRange: kind.boltMaxRange,
      pursuing: pursued
    }
  };
}

// How a soldier strikes in melee: with his kind's weapon, or, a bowman whose bolts are spent, with his short
// sword (M2_UnitKinds.js).
function meleeOf(unit) {
  const kind = m2UnitKind(unit);
  return unit.ammo === 0 && kind.sidearm ? kind.sidearm : kind;
}

// Formations that fight where they meet the enemy: all but one withdrawing (its men are running).
function fights(formation) {
  return Boolean(formation) && formation.order.type !== "withdraw";
}

// planning: in the plan (phase 5), a volley also waits for every man; when the shots are made (phase 6) the
// plan has already decided, and the first shot must not hold back the rest.
function shootsCrossbow(battleState, unit, { planning = true } = {}) {
  if (!isM2UnitActive(unit) || unit.isPlayer || unit.kindId !== "crossbow" || unit.attackCooldownTicks !== 0 || unit.ammo === 0) return false;
  const formation = battleState.getFormation(unit.formationId);
  if (!fights(formation)) return false;
  const order = orderOf(formation);
  if (order?.id === "hold_fire") return false;
  // A volley waits until every man still fighting has spanned his crossbow (M2_Orders.js).
  if (planning && order?.id === "volley") {
    return battleState.getActiveFormationMemberIds(formation).every((id) => battleState.getUnit(id).attackCooldownTicks === 0);
  }
  return true;
}

// The nearest active enemy within radius (m) that passes the test, or null.
function nearestEnemy(battleState, spatialGrid, unit, radius, test = () => true) {
  let best = null;
  for (const id of spatialGrid.queryNearby(unit.position.x, unit.position.z, radius)) {
    const enemy = battleState.getUnit(id);
    if (!isM2UnitActive(enemy) || enemy.sideId === unit.sideId || !test(enemy)) continue;
    const d = Math.hypot(enemy.position.x - unit.position.x, enemy.position.z - unit.position.z);
    if (d <= radius && (!best || d < best.d || (d === best.d && id < best.enemy.unitId))) best = { d, enemy };
  }
  return best?.enemy || null;
}

// A shield wall keeps its shields up at a walk or slower (m/s); braced spearmen watch for horse this far (m).
const SHIELD_WALL_BLOCK_SPEED = 1.7;
const BRACE_WATCH = 12;
// A man keeps his face to an enemy this near (m) while he moves no faster than a walk (m/s).
const FACE_FOE_DISTANCE = 3;
const FACE_FOE_SPEED = 1.8;

export class M2CombatSystem {
  #projectileLaunchCount = 0;
  #projectileHitCount = 0;
  #projectileOverflowCount = 0;
  #attackEventCount = 0;
  #crossbowLaunchCount = 0;
  #chargeHitCount = 0;
  #stoppedCount = 0;

  getObservation(battleState) {
    return Object.freeze({
      projectileLaunchCount: this.#projectileLaunchCount,
      activeProjectileCount: battleState.projectileCount,
      projectileHitCount: this.#projectileHitCount,
      projectileOverflowCount: this.#projectileOverflowCount,
      attackEventCount: this.#attackEventCount,
      crossbowLaunchCount: this.#crossbowLaunchCount,
      chargeHitCount: this.#chargeHitCount,
      // Blows and shots stopped by a shield or a parry (M2_Defense.js).
      stoppedCount: this.#stoppedCount
    });
  }

  // Fixed-tick phase 5 only:
  // 1) decrement active cooldowns exactly once, then
  // 2) collect all spatial/contact facts into a battle-tick-local plain plan.
  prepareTick(battleState, spatialGrid, commands, deltaSeconds, processingTick = battleState.tick + 1) {
    battleState.forEachUnitStable((unit) => {
      if (!isM2UnitActive(unit)) return;
      unit.attackCooldownTicks = Math.max(0, unit.attackCooldownTicks - 1);
      // A horseman's run-up: how long he has ridden at charging speed (the movement of this tick included).
      const chargeSpeed = m2UnitKind(unit).chargeSpeed;
      if (chargeSpeed > 0) {
        unit.chargeRunTicks = Math.hypot(unit.velocity.x, unit.velocity.z) >= chargeSpeed ? (unit.chargeRunTicks || 0) + 1 : 0;
      }
      if (unit.isPlayer || !unit.formationId) return;
      const formation = battleState.getFormation(unit.formationId);
      // In a shield wall the men keep their shields up, standing or walking (they block as a man blocking does).
      unit.blocking = formation?.formationTypeId === "shield_wall" && Math.hypot(unit.velocity.x, unit.velocity.z) <= SHIELD_WALL_BLOCK_SPEED;
      // A man with an enemy at arm's length keeps his face to him, even while he steps back into his place
      // (or is pushed about): he can stop only the blows he faces (M2_Defense.js). One running (charging,
      // wheeling away, closing in) looks where he runs.
      if (!unit.withdrawTo && Math.hypot(unit.velocity.x, unit.velocity.z) <= FACE_FOE_SPEED) {
        const foe = nearestEnemy(battleState, spatialGrid, unit, FACE_FOE_DISTANCE);
        if (foe) unit.heading = Math.atan2(foe.position.x - unit.position.x, foe.position.z - unit.position.z);
      }
      const order = orderOf(formation);
      // Braced spearmen turn to face the nearest horseman coming at them.
      if (order?.id === "spear_brace") {
        const horse = nearestEnemy(battleState, spatialGrid, unit, BRACE_WATCH, (enemy) => m2UnitKind(enemy).chargeSpeed > 0);
        if (horse) unit.heading = Math.atan2(horse.position.x - unit.position.x, horse.position.z - unit.position.z);
      }
      // Skirmishers step back from an enemy who comes too near.
      if (order?.id === "skirmish" && !unit.withdrawTo) {
        const near = nearestEnemy(battleState, spatialGrid, unit, order.keepAway);
        if (near) {
          const away = Math.atan2(unit.position.x - near.position.x, unit.position.z - near.position.z);
          unit.withdrawTo = { x: unit.position.x + Math.sin(away) * order.stepBack, z: unit.position.z + Math.cos(away) * order.stepBack };
        }
      }
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
      // Crossbowmen shoot instead (below).
      // A commander strikes with his own weapon (M2_Commanders.js); a crossbowman's commander shoots too.
      const weapon = meleeOf(attacker);
      const reach = attacker.commander && weapon.meleeRange > 0 ? Math.max(weapon.meleeRange, attacker.commander.combat.melee.reach) : weapon.meleeRange;
      if (!(reach > 0)) continue;
      const formation = battleState.getFormation(attacker.formationId);
      // A soldier strikes an enemy within reach whatever his formation's order, unless it is withdrawing:
      // ordered to hold, he still defends himself.
      if (!fights(formation)) continue;
      const candidates = collectContactCandidateFacts(battleState, spatialGrid, attacker, reach);
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
    const crossbowShots = [];
    for (const shooterId of battleState.getUnitIdsStable()) {
      const shooter = battleState.getUnit(shooterId);
      if (!shootsCrossbow(battleState, shooter)) continue;
      const shot = potentialCrossbowShot(battleState, spatialGrid, shooter, processingTick);
      if (!shot) continue;
      crossbowShots.push(shot);
      if (plannedProjectileIds.has(shot.projectile.projectileId)) continue;
      projectileSteps.push(collectProjectileStepFacts(battleState, spatialGrid, shot.projectile, deltaSeconds));
      plannedProjectileIds.add(shot.projectile.projectileId);
    }
    projectileSteps.sort((a, b) => a.projectileId.localeCompare(b.projectileId));

    return freezeDeep({
      playerMelee,
      nonPlayerMelee,
      crossbowShots,
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
      actor.attackCooldownTicks = actor.hero?.melee.cooldownTicks ?? M2_MELEE_DEFINITION.cooldownTicks;
      actor.state = "attacking";
      actor.revision += 1;
      const targetId = byCommandId.get(command.commandId)?.selectedTargetUnitId || null;
      const target = targetId ? battleState.getUnit(targetId) : null;
      // A mounted hero at the end of a run-up charges, as a horseman does (M2_UnitKinds.js).
      const horse = m2UnitKind("cavalry");
      const charging = Boolean(actor.hero?.mounted) && actor.chargeRunTicks >= horse.chargeRunTicks;
      if (actor.hero?.mounted) actor.chargeRunTicks = 0;
      if (!mayStrike(battleState, actor, target)) continue;
      const base = (actor.hero?.melee.damage ?? M2_MELEE_DEFINITION.baseDamage) * (charging ? horse.chargeScale : 1);
      if (charging) this.#chargeHitCount += 1;
      // The man struck at may stop it (M2_Defense.js).
      if (stopped(battleState, target, actor.position, `melee:${command.commandId}:${target.unitId}`, { charging })) {
        this.#stoppedCount += 1;
        continue;
      }
      const damage = damageAfterBlock(target, actor.position, base);
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
      // No bow, no shot (and no cooldown spent).
      const ranged = rangedOf(actor);
      if (!ranged) continue;
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
        speed: ranged.speed,
        remainingRange: ranged.range,
        damage: ranged.damage,
        // The hero shoots whom he chooses, running or not (M2_Pursuit.js).
        pursuing: "any",
        revision: 0
      };
      if (battleState.addProjectile(projectile)) {
        actor.attackCooldownTicks = ranged.reloadTicks;
        actor.heading = command.aimHeading;
        actor.state = "attacking";
        actor.revision += 1;
        this.#projectileLaunchCount += 1;
      }
    }
  }

  // Crossbowmen of formations ordered to attack shoot the enemy the plan found for them, then reload.
  resolveCrossbowVolleys(battleState, candidatePlan, processingTick) {
    for (const shot of candidatePlan.crossbowShots || []) {
      const shooter = battleState.getUnit(shot.shooterUnitId);
      if (!shootsCrossbow(battleState, shooter, { planning: false })) continue;
      if (battleState.projectileCount >= M2_PROJECTILE_DEFINITION.maxActive) {
        this.#projectileOverflowCount += 1;
        continue;
      }
      if (battleState.getProjectile(shot.projectile.projectileId)) continue;
      const kind = m2UnitKind(shooter);
      const start = shot.projectile.position;
      const projectile = {
        projectileId: shot.projectile.projectileId,
        projectileTypeId: "m2_test_bolt",
        ownerUnitId: shooter.unitId,
        sideId: shooter.sideId,
        launchSeed: hashLaunchSeed(battleState.seed, shot.projectile.projectileId, shooter.unitId, processingTick),
        position: { ...start },
        previousPosition: { ...start },
        direction: { ...shot.projectile.direction },
        speed: kind.boltSpeed,
        remainingRange: kind.boltMaxRange,
        damage: kind.boltDamage,
        armorPierce: kind.armorPierce || 0,
        pursuing: shot.projectile.pursuing,
        revision: 0
      };
      if (battleState.addProjectile(projectile)) {
        shooter.attackCooldownTicks = kind.reloadTicks;
        if (shooter.ammo !== null && shooter.ammo !== undefined) shooter.ammo -= 1;
        shooter.heading = shot.aimHeading;
        shooter.targetUnitId = shot.targetUnitId;
        shooter.state = "attacking";
        shooter.revision += 1;
        this.#projectileLaunchCount += 1;
        this.#crossbowLaunchCount += 1;
      }
    }
  }

  resolveNonPlayerContactMelee(battleState, candidatePlan, damageEvents, processingTick) {
    const byAttackerId = new Map(candidatePlan.nonPlayerMelee.map((record) => [record.attackerUnitId, record]));
    for (const attackerId of battleState.getUnitIdsStable()) {
      const attacker = battleState.getUnit(attackerId);
      if (!isM2UnitActive(attacker) || attacker.isPlayer || attacker.attackCooldownTicks !== 0) continue;
      const formation = battleState.getFormation(attacker.formationId);
      // A soldier strikes an enemy within reach whatever his formation's order, unless it is withdrawing:
      // ordered to hold, he still defends himself.
      if (!fights(formation)) continue;
      const targetId = byAttackerId.get(attacker.unitId)?.selectedTargetUnitId || null;
      const target = targetId ? battleState.getUnit(targetId) : null;
      if (!mayStrike(battleState, attacker, target)) continue;

      attacker.heading = Math.atan2(target.position.x - attacker.position.x, target.position.z - attacker.position.z);
      // A horseman who strikes at the end of a run-up charges: his horse's weight is behind the blow.
      const kind = m2UnitKind(attacker);
      const charging = kind.chargeSpeed > 0 && attacker.chargeRunTicks >= kind.chargeRunTicks;
      const baseDamage = attacker.commander ? attacker.commander.combat.melee.damage : meleeOf(attacker).meleeDamage;
      const eventId = `auto_melee:${processingTick}:${attacker.unitId}:${target.unitId}`;
      // The man struck at may stop the blow (M2_Defense.js); it is spent all the same.
      const blocked = stopped(battleState, target, attacker.position, eventId, { charging });
      if (blocked) this.#stoppedCount += 1;
      else damageEvents.push({
        damageEventId: eventId,
        sourceUnitId: attacker.unitId,
        targetUnitId: target.unitId,
        damage: damageAfterBlock(target, attacker.position, baseDamage * (charging ? kind.chargeScale : 1))
      });
      if (charging) this.#chargeHitCount += 1;
      if (kind.chargeSpeed > 0) attacker.chargeRunTicks = 0;
      // Hit and run (M2_Orders.js): after the charge, wheel away from the enemy and come again.
      if (charging && orderOf(formation)?.id === "hit_and_run") {
        const away = Math.atan2(attacker.position.x - target.position.x, attacker.position.z - target.position.z);
        attacker.withdrawTo = {
          x: attacker.position.x + Math.sin(away) * M2_ORDERS.hit_and_run.withdrawDistance,
          z: attacker.position.z + Math.cos(away) * M2_ORDERS.hit_and_run.withdrawDistance
        };
      }
      attacker.attackCooldownTicks = kind.meleeCooldownTicks;
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
      if (target && shotMayHit(projectile, target) && target.sideId !== projectile.sideId && target.unitId !== projectile.ownerUnitId) {
        // A shield from in front may stop it (M2_Defense.js); either way the bolt is spent.
        if (stopped(battleState, target, step.previousPosition, `projectile:${projectile.projectileId}:${target.unitId}`, { shot: true })) {
          this.#stoppedCount += 1;
          battleState.removeProjectile(projectile.projectileId);
          continue;
        }
        damageEvents.push({
          damageEventId: `projectile:${projectile.projectileId}:${target.unitId}`,
          sourceUnitId: projectile.ownerUnitId,
          targetUnitId: target.unitId,
          damage: damageAfterBlock(target, step.previousPosition, projectile.damage),
          ...(projectile.armorPierce ? { armorPierce: projectile.armorPierce } : {})
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
  collectProjectileStepFacts,
  potentialCrossbowShot
});
