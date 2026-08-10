function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

export class M2BattleState {
  #battleId;
  #seed;
  #playerCharacterId;
  #units = new Map();
  #formations = new Map();
  #tick = 0;

  constructor(snapshot, combatProfiles) {
    this.#battleId = snapshot.battleId;
    this.#seed = snapshot.seed;
    this.#playerCharacterId = snapshot.playerCharacterId;

    for (const character of snapshot.characters) {
      const profile = combatProfiles.get(character.combatProfileId);
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
        hp: profile?.stats?.vitality ?? 0,
        morale: profile?.stats?.morale ?? 0,
        state: "idle",
        attackCooldownTicks: 0,
        targetUnitId: null,
        revision: 0,
        slotTarget: { x: character.spawn.x, z: character.spawn.z }
      });
    }

    for (const source of snapshot.formations) {
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
          commandId: null
        },
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

  hasFormation(formationId) { return this.#formations.has(formationId); }
  getFormation(formationId) { return this.#formations.get(formationId) || null; }
  getUnit(unitId) { return this.#units.get(unitId) || null; }

  getUnitIdsStable() {
    return [...this.#units.keys()].sort();
  }

  getFormationIdsStable() {
    return [...this.#formations.keys()].sort();
  }

  forEachUnitStable(callback) {
    for (const unitId of this.getUnitIdsStable()) callback(this.#units.get(unitId));
  }

  forEachFormationStable(callback) {
    for (const formationId of this.getFormationIdsStable()) callback(this.#formations.get(formationId));
  }

  markTick() {
    this.#tick += 1;
  }

  getSnapshot() {
    const units = this.getUnitIdsStable().map((unitId) => {
      const unit = this.#units.get(unitId);
      return {
        unitId: unit.unitId,
        sideId: unit.sideId,
        formationId: unit.formationId,
        position: clone(unit.position),
        previousPosition: clone(unit.previousPosition),
        heading: unit.heading,
        velocity: clone(unit.velocity),
        hp: unit.hp,
        morale: unit.morale,
        state: unit.state,
        attackCooldownTicks: unit.attackCooldownTicks,
        targetUnitId: unit.targetUnitId,
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
        anchor: clone(formation.anchor),
        facing: formation.facing,
        formationTypeId: formation.formationTypeId,
        spacing: formation.spacing,
        order: clone(formation.order),
        revision: formation.revision
      };
    });

    return freezeDeep({
      schema: "ARS_BELLUM_M2_1_01_RUNTIME_STATE_V1",
      phase: "M2-1/01",
      battleId: this.#battleId,
      seed: this.#seed,
      playerCharacterId: this.#playerCharacterId,
      tick: this.#tick,
      activeUnits: units.length,
      formationCount: formations.length,
      units,
      formations
    });
  }
}
