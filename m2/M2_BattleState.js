import { m2AppearanceForFormation, m2UnitKind, m2UnitKindForFormation, m2UnitTypeForFormation } from "./M2_UnitKinds.js";
import { plansFor } from "./M2_Plans.js";
import { ordersFor } from "./M2_Orders.js";
import { DEFAULT_HERO_SHEET, damageThroughArmor, heroCombat } from "./M2_HeroLoadout.js";
import { DEFAULT_COMMANDER_SHEETS, commanderFromSheet } from "./M2_Commanders.js";

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
  // Each side's battle plan (M2_Plans.js): { planId, startTick, stage }, or null.
  #plans = { ally: null, enemy: null };
  #tick = 0;

  constructor(snapshot, combatProfiles) {
    this.#battleId = snapshot.battleId;
    this.#seed = snapshot.seed;
    this.#playerCharacterId = snapshot.playerCharacterId;

    // Each formation's subtype (병종), if its snapshot names one (M2_UnitKinds.js).
    const unitTypes = new Map(snapshot.formations.map((source) => [source.formationId, m2UnitTypeForFormation(source)]));
    // And what its men are drawn wearing.
    const appearances = new Map(snapshot.formations.map((source) => [source.formationId, m2AppearanceForFormation(source)]));
    for (const character of snapshot.characters) {
      const profile = combatProfiles.get(character.combatProfileId);
      // Vitality is the man; hpScale is what he wears and rides (mail, a horse), until equipment comes in
      // (M2_UnitKinds.js).
      // The player is a hero of his own (M2_HeroLoadout.js): his sheet, not a formation, says how he fights.
      const isPlayer = character.characterId === snapshot.playerCharacterId;
      const hero = isPlayer ? heroCombat(snapshot.heroSheet || DEFAULT_HERO_SHEET) : null;
      const kindId = hero ? (hero.mounted ? "cavalry" : "infantry") : m2UnitKindForFormation(character.formationId);
      const unitTypeId = hero ? null : unitTypes.get(character.formationId) || null;
      const type = m2UnitKind({ kindId, unitTypeId });
      const maxHp = hero ? hero.maxHp : Math.round((profile?.stats?.vitality ?? 0) * type.hpScale);
      const initialMorale = Number(profile?.stats?.morale ?? 0);
      this.#units.set(character.characterId, {
        unitId: character.characterId,
        sideId: character.sideId,
        // The hero belongs to no formation: the snapshot places every character in one, and the battle takes
        // him out of it (below).
        formationId: hero ? null : character.formationId,
        roleId: character.roleId,
        kindId,
        unitTypeId,
        hero,
        commander: null,
        armor: hero ? hero.armor : type.armor || 0,
        // Body armour and helmet as drawn (the hero and commanders wear their own equipment).
        ...(hero ? { armorId: null, helmId: null } : appearances.get(character.formationId) || { armorId: "mail", helmId: "nasal" }),
        // Bolts or arrows left (a subtype that counts them: M2_UnitKinds.js), or null: never runs out.
        ammo: hero ? null : type.ammo ?? null,
        combatProfileId: character.combatProfileId,
        isPlayer,
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
        // Ticks in a row a horseman has ridden at charging speed without striking (M2_UnitKinds.js).
        chargeRunTicks: 0,
        // How many bodies pressed against him in the last tick (M2_CollisionSystem.js); slows him.
        crowd: 0,
        // Where he steps or rides back to before taking his place again (a horseman wheeling away after a
        // charge, a crossbowman keeping his distance: M2_Orders.js); null otherwise.
        withdrawTo: null,
        targetUnitId: null,
        routeReasonId: null,
        routeTarget: null,
        revision: 0,
        // The hero goes where he is steered and stays where he stops: he has no place in a line.
        slotTarget: hero ? null : { x: character.spawn.x, z: character.spawn.z }
      });
    }

    for (const source of snapshot.formations) {
      // Without the hero: if he led this formation, the next man (by id) leads it.
      const memberUnitIds = source.memberUnitIds.filter((unitId) => unitId !== snapshot.playerCharacterId);
      const commanderUnitId = source.commanderUnitId === snapshot.playerCharacterId ? ([...memberUnitIds].sort()[0] ?? null) : source.commanderUnitId;
      const livingMorales = memberUnitIds
        .map((unitId) => this.#units.get(unitId))
        .filter((unit) => isM2UnitAlive(unit))
        .map((unit) => unit.morale);
      const morale = livingMorales.length
        ? round2(livingMorales.reduce((sum, value) => sum + value, 0) / livingMorales.length)
        : 0;
      this.#formations.set(source.formationId, {
        formationId: source.formationId,
        sideId: source.sideId,
        commanderUnitId,
        memberUnitIds,
        anchor: { x: source.anchor.x, z: source.anchor.z },
        facing: source.facing,
        formationTypeId: source.formationTypeId,
        // Horses need more room than men on foot (M2_UnitKinds.js).
        spacing: source.spacing * m2UnitKind(m2UnitKindForFormation(source.formationId)).spacingScale,
        kindId: m2UnitKindForFormation(source.formationId),
        unitTypeId: m2UnitTypeForFormation(source),
        // Whether it pursues an enemy it breaks (M2_Pursuit.js): as the snapshot says, else horse do and foot
        // and crossbowmen do not (the owner, 2026-11-01).
        pursuit: typeof source.pursuit === "boolean" ? source.pursuit : m2UnitKindForFormation(source.formationId) === "cavalry",
        order: {
          type: source.order || "hold",
          target: source.order === "move" && source.target ? { x: source.target.x, z: source.target.z } : null,
          targetFormationId: null,
          commandId: null
        },
        // A formation order (M2_Orders.js: charge, braced spears, a volley...), or none; and how far a flank
        // march has come (0: going round the side, 1: turning in on the rear).
        tactic: null,
        flankStage: 0,
        // Under its side's battle plan (M2_Plans.js), and on which side a plan sends it round (1 right, -1
        // left, null: the nearer).
        underPlan: false,
        flankSide: null,
        cohesion: 100,
        morale,
        revision: 0
      });
    }

    // Each formation's commander (부대장) is his own man: his sheet sets how he fights and how he leads
    // (M2_Commanders.js). The formation carries what his command skills give it.
    for (const formation of this.#formations.values()) {
      const unit = this.#units.get(formation.commanderUnitId);
      if (!unit) { formation.command = null; continue; }
      const sheet = snapshot.commanderSheets?.[formation.formationId] || DEFAULT_COMMANDER_SHEETS[formation.kindId] || DEFAULT_COMMANDER_SHEETS.infantry;
      const commander = commanderFromSheet(sheet);
      unit.commander = commander;
      unit.maxHp = commander.combat.maxHp;
      unit.hp = commander.combat.maxHp;
      unit.armor = commander.combat.armor;
      formation.command = Object.freeze({ commanderUnitId: unit.unitId, command: commander.command, leadership: commander.leadership, tactics: commander.tactics, tacticSlots: commander.tacticSlots });
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
  getPlan(sideId) { return this.#plans[sideId] || null; }
  setPlan(sideId, plan) { this.#plans[sideId] = plan; }

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
    // (A running man can be struck too, by those pursuing him: M2_Pursuit.js decides who may.)
    if (!isM2UnitAlive(target)) return { applied: false, idempotent: false, damage: 0 };
    // Armor takes its share of the blow (M2_HeroLoadout.js), less what an armor-piercing bolt goes through
    // (M2_UnitKinds.js).
    const pierce = Math.min(1, Math.max(0, Number(event.armorPierce) || 0));
    const damage = Math.max(0, Math.round(damageThroughArmor(Number(event.damage) || 0, (target.armor || 0) * (1 - pierce))));
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
        kindId: unit.kindId,
        unitTypeId: unit.unitTypeId,
        armorId: unit.armorId,
        helmId: unit.helmId,
        isPlayer: unit.isPlayer,
        hero: unit.hero,
        commander: unit.commander,
        armor: unit.armor,
        ammo: unit.ammo,
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
        kindId: formation.kindId,
        unitTypeId: formation.unitTypeId,
        pursuit: formation.pursuit,
        command: formation.command,
        tactic: formation.tactic,
        underPlan: formation.underPlan,
        tactics: ordersFor(formation),
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
      projectiles,
      plans: { ally: this.#plans.ally ? clone(this.#plans.ally) : null, enemy: this.#plans.enemy ? clone(this.#plans.enemy) : null },
      plansAvailable: { ally: plansFor(this, "ally"), enemy: plansFor(this, "enemy") }
    });
  }
}
