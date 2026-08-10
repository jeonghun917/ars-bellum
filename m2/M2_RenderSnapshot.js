function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

export function createRenderSnapshot(battleState) {
  const units = battleState.getUnitIdsStable().map((unitId) => {
    const unit = battleState.getUnit(unitId);
    return {
      unitId: unit.unitId,
      sideId: unit.sideId,
      combatProfileId: unit.combatProfileId,
      isPlayer: unit.isPlayer,
      position: { x: unit.position.x, y: unit.position.y, z: unit.position.z },
      previousPosition: { x: unit.previousPosition.x, y: unit.previousPosition.y, z: unit.previousPosition.z },
      heading: unit.heading,
      state: unit.state
    };
  });

  return freezeDeep({
    schema: "ARS_BELLUM_M2_RENDER_SNAPSHOT_V1",
    phase: "M2-1/01",
    battleId: battleState.battleId,
    tick: battleState.tick,
    activeUnits: units.length,
    units
  });
}
