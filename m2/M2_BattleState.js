function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

export function isM2UnitAlive(unit) {
  return Boolean(unit) && unit.hp > 0 && unit.state !== "incapacitated" && unit.state !== "dead";
}

export function isM2UnitActive(unit) {
  return isM2UnitAlive(unit) && unit.state !== "routing";
}

export class M2BattleState {
  #battleId;
  #seed;
  #playerCharacterId;
  #units = new Map();
  #formations = new Map();
  #projectiles = new Map();
  #appliedDamageEventIds = new Set();
  #finalResult = null;
  #tick = 0;

  constructor(snapshot, combatProfiles) {
    this.#battleId = snapshot.battleId;
    this.#seed = snapshot.seed;
    this.#playerCharacterId = snapshot.playerCharacterId;

    for (const character of snapshot.characters) {
      const profile = combatProfiles.get(character.combatProfileId);
      const maxHp = profile?.stats?.vitality ?? 0;
      const initialMorale = Number(profile?.stats?.morale ?? 0);
      this.#units.set(character.characterId, {
        unitId: character.characterId,
        sideId: character.sideId,
        formationId: character.formationId,
        roleId: character.roleId,
        combatProfileId: character.combatProfileId,
        isPlayer: character.characterId === snapshot.playerCharacterId,
        position: { x: character.spawn.x, y: 0, z: character.spawn.z },
        previousPosition: { x: character.spawn.x, y: 0, z: character.spawn.z },
        heading: character.spawn.heading,
        velocity: { x: 0, z: 0 },
        hp: maxHp,
        maxHp,
        initialMorale,
        morale: initialMorale,
        blocking: false,
        directMoveIntent: { x: 0, z: 0 },
        state: "idle",
        attackCooldownTicks: 0,
        targetUnitId: null,
        routeReasonId: null,
        routeTarget: null,
        revision: 0,
        slotTarget: { x: character.spawn.x, z: character.spawn.z }
      });
    }

    for (const source of snapshot.formations) {
      const livingMorales = source.memberUnitIds
        .map((unitId) => this.#units.get(unitId))
        .filter((unit) => isM2UnitAlive(unit))
        .map((unit) => unit.morale);
      const morale = livingMorales.length
        ? round2(livingMorales.reduce((sum, value) => sum + value, 0) / livingMorales.length)
        : 0;
      this.#formations.set(source.formationId, {
        formationId: source.formationId,
        sideId: source.sideId,
        commanderUnitId: source.commanderUnitId,
        memberUnitIds: [...source.memberUnitIds],
        anchor: { x: source.anchor.x, z: source.anchor.z },
        facing: source.facing,
        formationTypeId: source.formationTypeId,
        spacing: source.spacing,
        order: {
          type: source.order || "hold",
          target: source.order === "move" && source.target ? { x: source.target.x, z: source.target.z } : null,
          targetFormationId: null,
          commandId: null
        },
        cohesion: 100,
        morale,
        revision: 0
      });
    }
  }

  get battleId() { return this.#battleId; }
  get seed() { return this.#seed; }
  get playerCharacterId() { return this.#playerCharacterId; }
  get tick() { return this.#tick; }
  get unitCount() { return this.#units.size; }
  get formationCount() { return this.#formations.size; }
  get projectileCount() { return this.#projectiles.size; }
  get appliedDamageEventCount() { return this.#appliedDamageEventIds.size; }

  hasFormation(formationId) { return this.#formations.has(formationId); }
  getFormation(formationId) { return this.#formations.get(formationId) || null; }
  getUnit(unitId) { return this.#units.get(unitId) || null; }
  getProjectile(projectileId) { return this.#projectiles.get(projectileId) || null; }
  getResult() { return this.#finalResult; }

  getUnitIdsStable() { return [...this.#units.keys()].sort(); }
  getFormationIdsStable() { return [...this.#formations.keys()].sort(); }
  getProjectileIdsStable() { return [...this.#projectiles.keys()].sort(); }

  getActiveFormationMemberIds(formation) {
    return [...formation.memberUnitIds]
      .filter((unitId) => isM2UnitActive(this.#units.get(unitId)))
      .sort();
  }

  forEachUnitStable(callback) {
    for (const unitId of this.getUnitIdsStable()) callback(this.#units.get(unitId));
  }

  forEachFormationStable(callback) {
    for (const formationId of this.getFormationIdsStable()) callback(this.#formations.get(formationId));
  }

  forEachProjectileStable(callback) {
    for (const projectileId of this.getProjectileIdsStable()) callback(this.#projectiles.get(projectileId));
  }

  addProjectile(projectile) {
    if (this.#projectiles.has(projectile.projectileId)) return false;
    this.#projectiles.set(projectile.projectileId, projectile);
    return true;
  }

  removeProjectile(projectileId) {
    return this.#projectiles.delete(projectileId);
  }

  applyDamageEvent(event) {
    if (!event || typeof event.damageEventId !== "string") return { applied: false, error: "m2_damage_event_invalid" };
    if (this.#appliedDamageEventIds.has(event.damageEventId)) {
      return { applied: false, idempotent: true, damage: 0 };
    }
    this.#appliedDamageEventIds.add(event.damageEventId);
    const target = this.#units.get(event.targetUnitId);
    if (!isM2UnitActive(target)) return { applied: false, idempotent: false, damage: 0 };
    const damage = Math.max(0, Math.round(Number(event.damage) || 0));
    const before = target.hp;
    target.hp = Math.max(0, Math.min(target.maxHp, target.hp - damage));
    const applied = before - target.hp;
    if (target.hp <= 0) {
      target.hp = 0;
      target.state = "incapacitated";
      target.blocking = false;
      target.directMoveIntent = { x: 0, z: 0 };
      target.velocity.x = 0;
      target.velocity.z = 0;
    }
    target.revision += applied > 0 ? 1 : 0;
    return { applied: applied > 0, idempotent: false, damage: applied };
  }

  hasAppliedDamageEvent(damageEventId) {
    return this.#appliedDamageEventIds.has(damageEventId);
  }

  commitFinalResult(validatedResult) {
    if (this.#finalResult !== null) {
      return Object.freeze({ applied: false, idempotent: true, finalized: true, result: this.#finalResult });
    }
    this.#finalResult = freezeDeep(clone(validatedResult));
    return Object.freeze({ applied: true, idempotent: false, finalized: true, result: this.#finalResult });
  }

  markTick(processingTick = this.#tick + 1) {
    if (!Number.isSafeInteger(processingTick) || processingTick !== this.#tick + 1) {
      throw new Error("m2_tick_sequence_invalid");
    }
    this.#tick = processingTick;
  }

  getSnapshot() {
    const units = this.getUnitIdsStable().map((unitId) => {
      const unit = this.#units.get(unitId);
      return {
        unitId: unit.unitId,
        sideId: unit.sideId,
        formationId: unit.formationId,
        isPlayer: unit.isPlayer,
        position: clone(unit.position),
        previousPosition: clone(unit.previousPosition),
        heading: unit.heading,
        velocity: clone(unit.velocity),
        hp: unit.hp,
        maxHp: unit.maxHp,
        hpRatio: unit.maxHp > 0 ? unit.hp / unit.maxHp : 0,
        initialMorale: unit.initialMorale,
        morale: unit.morale,
        blocking: unit.blocking,
        directMoveIntent: clone(unit.directMoveIntent),
        state: unit.state,
        attackCooldownTicks: unit.attackCooldownTicks,
        targetUnitId: unit.targetUnitId,
        routeReasonId: unit.routeReasonId,
        routeTarget: unit.routeTarget ? clone(unit.routeTarget) : null,
        revision: unit.revision
      };
    });

    const formations = this.getFormationIdsStable().map((formationId) => {
      const formation = this.#formations.get(formationId);
      return {
        formationId: formation.formationId,
        sideId: formation.sideId,
        commanderUnitId: formation.commanderUnitId,
        memberUnitIds: [...formation.memberUnitIds],
        activeMemberUnitIds: this.getActiveFormationMemberIds(formation),
        anchor: clone(formation.anchor),
        facing: formation.facing,
        formationTypeId: formation.formationTypeId,
        spacing: formation.spacing,
        order: clone(formation.order),
        cohesion: formation.cohesion,
        morale: formation.morale,
        revision: formation.revision
      };
    });

    const projectiles = this.getProjectileIdsStable().map((projectileId) => clone(this.#projectiles.get(projectileId)));
    const activeUnits = units.filter((unit) => unit.hp > 0 && unit.state !== "incapacitated" && unit.state !== "dead").length;
    const combatActiveUnits = units.filter((unit) => unit.hp > 0 && unit.state !== "incapacitated" && unit.state !== "dead" && unit.state !== "routing").length;
    const routingUnits = units.filter((unit) => unit.hp > 0 && unit.state === "routing").length;

    return freezeDeep({
      schema: "ARS_BELLUM_M2_1_03_RUNTIME_STATE_V1",
      phase: "M2-1/03",
      battleId: this.#battleId,
      seed: this.#seed,
      playerCharacterId: this.#playerCharacterId,
      tick: this.#tick,
      activeUnits,
      combatActiveUnits,
      routingUnits,
      totalUnits: units.length,
      formationCount: formations.length,
      activeProjectileCount: projectiles.length,
      appliedDamageEventCount: this.#appliedDamageEventIds.size,
      battleResultOutcome: this.#finalResult?.outcome || null,
      units,
      formations,
      projectiles
    });
  }
}
