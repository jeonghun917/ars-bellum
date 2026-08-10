function rotateLocal(localX, localZ, facing) {
  const rightX = Math.cos(facing);
  const rightZ = -Math.sin(facing);
  const forwardX = Math.sin(facing);
  const forwardZ = Math.cos(facing);
  return {
    x: localX * rightX + localZ * forwardX,
    z: localX * rightZ + localZ * forwardZ
  };
}

export function calculateFormationSlots(formation) {
  const memberUnitIds = [...formation.memberUnitIds].sort();
  const spacing = formation.spacing;
  const slots = new Map();

  if (formation.formationTypeId === "line") {
    const center = (memberUnitIds.length - 1) / 2;
    memberUnitIds.forEach((unitId, index) => {
      const offset = rotateLocal((index - center) * spacing, 0, formation.facing);
      slots.set(unitId, { x: formation.anchor.x + offset.x, z: formation.anchor.z + offset.z });
    });
    return slots;
  }

  if (formation.formationTypeId === "column") {
    const center = (memberUnitIds.length - 1) / 2;
    memberUnitIds.forEach((unitId, index) => {
      const offset = rotateLocal(0, (center - index) * spacing, formation.facing);
      slots.set(unitId, { x: formation.anchor.x + offset.x, z: formation.anchor.z + offset.z });
    });
    return slots;
  }

  if (formation.formationTypeId === "loose") {
    const columns = Math.ceil(Math.sqrt(memberUnitIds.length));
    const rows = Math.ceil(memberUnitIds.length / columns);
    const looseSpacing = spacing * 1.6;
    memberUnitIds.forEach((unitId, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const localX = (column - (columns - 1) / 2) * looseSpacing;
      const localZ = ((rows - 1) / 2 - row) * looseSpacing;
      const offset = rotateLocal(localX, localZ, formation.facing);
      slots.set(unitId, { x: formation.anchor.x + offset.x, z: formation.anchor.z + offset.z });
    });
    return slots;
  }

  throw new Error(`m2_formation_type_unknown:${formation.formationTypeId}`);
}

export class M2FormationSystem {
  applyCommand(battleState, command) {
    const formation = battleState.getFormation(command.formationId);
    if (!formation) throw new Error("m2_command_unknown_formation");

    if (command.type === "formation_move") {
      formation.anchor.x = command.target.x;
      formation.anchor.z = command.target.z;
      formation.order = {
        type: "move",
        target: { x: command.target.x, z: command.target.z },
        commandId: command.commandId
      };
      formation.revision += 1;
      return;
    }

    if (command.type === "formation_hold") {
      formation.order = { type: "hold", target: null, commandId: command.commandId };
      formation.revision += 1;
      return;
    }

    throw new Error("m2_command_not_available_m2_1_01");
  }

  updateSlots(battleState) {
    battleState.forEachFormationStable((formation) => {
      const slots = calculateFormationSlots(formation);
      for (const [unitId, target] of slots) {
        const unit = battleState.getUnit(unitId);
        if (!unit) throw new Error(`m2_formation_unit_missing:${formation.formationId}:${unitId}`);
        unit.slotTarget = target;
      }
    });
  }
}
