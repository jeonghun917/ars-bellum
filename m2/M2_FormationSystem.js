import { M2_FORMATION_ATTACK_DEFINITION, M2_MORALE_DEFINITION } from "./M2_Definitions.js";
import { isM2UnitActive } from "./M2_BattleState.js";

function rotateLocal(localX, localZ, facing) {
  const rightX = Math.cos(facing);
  const rightZ = -Math.sin(facing);
  const forwardX = Math.sin(facing);
  const forwardZ = Math.cos(facing);
  return { x: localX * rightX + localZ * forwardX, z: localX * rightZ + localZ * forwardZ };
}

function retreatAnchor(formation) {
  return {
    x: formation.anchor.x,
    z: formation.sideId === "ally" ? M2_MORALE_DEFINITION.retreatEdgeZ : -M2_MORALE_DEFINITION.retreatEdgeZ
  };
}

export function calculateFormationSlots(formation, memberUnitIds = formation.memberUnitIds) {
  const ids = [...memberUnitIds].sort();
  const spacing = formation.spacing;
  const slots = new Map();

  if (formation.formationTypeId === "line") {
    const center = (ids.length - 1) / 2;
    ids.forEach((unitId, index) => {
      const offset = rotateLocal((index - center) * spacing, 0, formation.facing);
      slots.set(unitId, { x: formation.anchor.x + offset.x, z: formation.anchor.z + offset.z });
    });
    return slots;
  }
  if (formation.formationTypeId === "column") {
    const center = (ids.length - 1) / 2;
    ids.forEach((unitId, index) => {
      const offset = rotateLocal(0, (center - index) * spacing, formation.facing);
      slots.set(unitId, { x: formation.anchor.x + offset.x, z: formation.anchor.z + offset.z });
    });
    return slots;
  }
  if (formation.formationTypeId === "loose") {
    const columns = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
    const rows = Math.max(1, Math.ceil(ids.length / columns));
    const looseSpacing = spacing * 1.6;
    ids.forEach((unitId, index) => {
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
      formation.order = { type: "move", target: { ...command.target }, targetFormationId: null, commandId: command.commandId };
    } else if (command.type === "formation_hold") {
      formation.order = { type: "hold", target: null, targetFormationId: null, commandId: command.commandId };
    } else if (command.type === "formation_attack") {
      formation.order = { type: "attack_target", target: null, targetFormationId: command.targetFormationId, commandId: command.commandId };
    } else if (command.type === "formation_set_type") {
      formation.formationTypeId = command.formationTypeId;
    } else if (command.type === "formation_rally") {
      formation.order = { type: "rally", target: null, targetFormationId: null, commandId: command.commandId };
    } else if (command.type === "formation_retreat") {
      formation.order = { type: "withdraw", target: retreatAnchor(formation), targetFormationId: null, commandId: command.commandId };
    } else {
      throw new Error("m2_command_not_available_m2_1_03");
    }
    formation.revision += 1;
  }

  updateAttackGoals(battleState) {
    battleState.forEachFormationStable((formation) => {
      if (formation.order.type !== "attack_target" || !formation.order.targetFormationId) return;
      const target = battleState.getFormation(formation.order.targetFormationId);
      if (!target || target.sideId === formation.sideId) return;
      if (battleState.getActiveFormationMemberIds(target).length === 0) return;
      const targetAnchor = target.anchor;
      const dx = targetAnchor.x - formation.anchor.x;
      const dz = targetAnchor.z - formation.anchor.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 0) formation.facing = Math.atan2(dx, dz);
      if (distance > M2_FORMATION_ATTACK_DEFINITION.attackStopRange) {
        const nx = dx / distance;
        const nz = dz / distance;
        formation.anchor.x = targetAnchor.x - nx * M2_FORMATION_ATTACK_DEFINITION.attackStopRange;
        formation.anchor.z = targetAnchor.z - nz * M2_FORMATION_ATTACK_DEFINITION.attackStopRange;
      }
      formation.revision += 1;
    });
  }

  updateSlots(battleState) {
    battleState.forEachFormationStable((formation) => {
      const activeIds = battleState.getActiveFormationMemberIds(formation);
      const slots = calculateFormationSlots(formation, activeIds);
      for (const unitId of formation.memberUnitIds) {
        const unit = battleState.getUnit(unitId);
        if (!unit) throw new Error(`m2_formation_unit_missing:${formation.formationId}:${unitId}`);
        if (!isM2UnitActive(unit)) {
          unit.slotTarget = { x: unit.position.x, z: unit.position.z };
          continue;
        }
        const target = slots.get(unitId);
        if (target) unit.slotTarget = target;
      }
    });
  }
}
