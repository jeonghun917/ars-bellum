function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

export function createRenderSnapshot(battleState, { tick = battleState.tick, selectedFormationId = null } = {}) {
  const units = battleState.getUnitIdsStable().map((unitId) => {
    const unit = battleState.getUnit(unitId);
    return {
      unitId: unit.unitId,
      sideId: unit.sideId,
      formationId: unit.formationId,
      combatProfileId: unit.combatProfileId,
      isPlayer: unit.isPlayer,
      position: { ...unit.position },
      previousPosition: { ...unit.previousPosition },
      heading: unit.heading,
      hp: unit.hp,
      maxHp: unit.maxHp,
      hpRatio: unit.maxHp > 0 ? unit.hp / unit.maxHp : 0,
      blocking: unit.blocking,
      state: unit.state
    };
  });

  const formations = battleState.getFormationIdsStable().map((formationId) => {
    const formation = battleState.getFormation(formationId);
    return {
      formationId: formation.formationId,
      sideId: formation.sideId,
      anchor: { ...formation.anchor },
      formationTypeId: formation.formationTypeId,
      order: { type: formation.order.type, targetFormationId: formation.order.targetFormationId || null },
      selected: formation.formationId === selectedFormationId
    };
  });

  const projectiles = battleState.getProjectileIdsStable().map((projectileId) => {
    const projectile = battleState.getProjectile(projectileId);
    return {
      projectileId: projectile.projectileId,
      projectileTypeId: projectile.projectileTypeId,
      sideId: projectile.sideId,
      position: { ...projectile.position },
      previousPosition: { ...projectile.previousPosition }
    };
  });

  const player = battleState.getUnit(battleState.playerCharacterId);
  return freezeDeep({
    schema: "ARS_BELLUM_M2_RENDER_SNAPSHOT_V1",
    phase: "M2-1/02",
    battleId: battleState.battleId,
    tick,
    activeUnits: units.filter((unit) => unit.hp > 0 && unit.state !== "incapacitated" && unit.state !== "dead").length,
    units,
    formations,
    projectiles,
    playerUnitId: battleState.playerCharacterId,
    playerPosition: player ? { ...player.position } : null,
    selectedFormationId
  });
}
