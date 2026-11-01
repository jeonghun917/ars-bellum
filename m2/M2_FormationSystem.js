import { M2_FORMATION_ATTACK_DEFINITION, M2_MORALE_DEFINITION } from "./M2_Definitions.js";
import { M2_ORDERS } from "./M2_Orders.js";
import { isM2UnitActive } from "./M2_BattleState.js";
import { m2UnitKind } from "./M2_UnitKinds.js";

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

// Men in a shield wall stand this close (m): two bodies' width, shields overlapping.
const SHIELD_WALL_SPACING = 0.75;
// How near (m) a flanking formation's middle must come to its point abeam of the target before it turns in.
const FLANK_ARRIVED = 3;

// Which shapes each kind of soldier can take: horse cannot make a shield wall or a ring.
const FORMATION_TYPES_BY_KIND = Object.freeze({
  infantry: Object.freeze(["line", "column", "loose", "shield_wall", "wedge", "circle"]),
  crossbow: Object.freeze(["line", "column", "loose", "circle"]),
  cavalry: Object.freeze(["line", "column", "loose", "wedge"])
});
export function formationTypesFor(formation) {
  return FORMATION_TYPES_BY_KIND[formation?.kindId] || FORMATION_TYPES_BY_KIND.infantry;
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
  // A shield wall (방패진): the men shoulder to shoulder in three ranks, close enough for shields to overlap
  // (two bodies' width apart: 0.75 m), front rank on the anchor.
  if (formation.formationTypeId === "shield_wall") {
    const ranks = Math.min(3, ids.length);
    const perRank = Math.ceil(ids.length / ranks);
    const close = SHIELD_WALL_SPACING;
    ids.forEach((unitId, index) => {
      const rank = Math.floor(index / perRank);
      const file = index % perRank;
      const inRank = Math.min(perRank, ids.length - rank * perRank);
      const offset = rotateLocal((file - (inRank - 1) / 2) * close, -rank * close, formation.facing);
      slots.set(unitId, { x: formation.anchor.x + offset.x, z: formation.anchor.z + offset.z, facing: formation.facing });
    });
    return slots;
  }
  // A wedge (쐐기진): one man at the point, two behind him, three behind them, and so on.
  if (formation.formationTypeId === "wedge") {
    let row = 0;
    let placed = 0;
    while (placed < ids.length) {
      const inRow = Math.min(row + 1, ids.length - placed);
      for (let i = 0; i < inRow; i += 1) {
        const offset = rotateLocal((i - row / 2) * spacing, -row * spacing, formation.facing);
        slots.set(ids[placed + i], { x: formation.anchor.x + offset.x, z: formation.anchor.z + offset.z, facing: formation.facing });
      }
      placed += inRow;
      row += 1;
    }
    return slots;
  }
  // A ring (원진): the men round the anchor, each facing out, so there is no flank or rear to strike.
  if (formation.formationTypeId === "circle") {
    const radius = Math.max(1.5, (ids.length * spacing) / (2 * Math.PI));
    ids.forEach((unitId, index) => {
      const angle = formation.facing + (index / ids.length) * 2 * Math.PI;
      slots.set(unitId, { x: formation.anchor.x + Math.sin(angle) * radius, z: formation.anchor.z + Math.cos(angle) * radius, facing: angle });
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
    // A formation ordered by hand leaves its side's battle plan (a change of shape alone does not take it out).
    if (command.type !== "formation_set_type") formation.underPlan = false;

    if (command.type === "formation_move") {
      // Marching off, braced spearmen take up their spears.
      if (formation.tactic === "spear_brace") formation.tactic = null;
      formation.anchor.x = command.target.x;
      formation.anchor.z = command.target.z;
      formation.order = { type: "move", target: { ...command.target }, targetFormationId: null, commandId: command.commandId };
    } else if (command.type === "formation_hold") {
      formation.order = { type: "hold", target: null, targetFormationId: null, commandId: command.commandId };
    } else if (command.type === "formation_attack") {
      formation.order = { type: "attack_target", target: null, targetFormationId: command.targetFormationId, commandId: command.commandId };
      formation.flankStage = 0;
    } else if (command.type === "formation_set_type") {
      formation.formationTypeId = command.formationTypeId;
    } else if (command.type === "formation_set_tactic") {
      formation.tactic = command.tacticId;
      formation.flankStage = 0;
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
      // Braced spears stand where they are, facing the enemy (M2_Orders.js).
      if (formation.tactic === "spear_brace") {
        if (distance > 0) formation.facing = Math.atan2(dx, dz);
        return;
      }
      // Crossbowmen stop at shooting distance; everyone else closes in.
      const stopRange = m2UnitKind(formation.kindId).standOff ?? M2_FORMATION_ATTACK_DEFINITION.attackStopRange;
      // A flank march (M2_Orders.js): first abeam of the target, out on the nearer side, then in on its rear.
      if (formation.tactic === "flank" && m2UnitKind(formation.kindId).standOff === undefined) {
        this.#flank(battleState, formation, target, stopRange);
        formation.revision += 1;
        return;
      }
      if (distance > 0) formation.facing = Math.atan2(dx, dz);
      if (distance > stopRange) {
        const nx = dx / distance;
        const nz = dz / distance;
        formation.anchor.x = targetAnchor.x - nx * stopRange;
        formation.anchor.z = targetAnchor.z - nz * stopRange;
      }
      formation.revision += 1;
    });
  }

  #flank(battleState, formation, target, stopRange) {
    const ids = battleState.getActiveFormationMemberIds(formation);
    const centre = ids.length
      ? { x: ids.reduce((s, id) => s + battleState.getUnit(id).position.x, 0) / ids.length, z: ids.reduce((s, id) => s + battleState.getUnit(id).position.z, 0) / ids.length }
      : { ...formation.anchor };
    const forward = { x: Math.sin(target.facing), z: Math.cos(target.facing) };
    const right = { x: Math.cos(target.facing), z: -Math.sin(target.facing) };
    // A battle plan may say which side to go round (M2_Plans.js); else the nearer.
    const side = formation.flankSide ?? ((centre.x - target.anchor.x) * right.x + (centre.z - target.anchor.z) * right.z >= 0 ? 1 : -1);
    const abeam = {
      x: target.anchor.x + right.x * side * M2_ORDERS.flank.sideDistance,
      z: target.anchor.z + right.z * side * M2_ORDERS.flank.sideDistance
    };
    if (formation.flankStage === 0 && Math.hypot(centre.x - abeam.x, centre.z - abeam.z) <= FLANK_ARRIVED) formation.flankStage = 1;
    const goal = formation.flankStage === 0 ? abeam : { x: target.anchor.x - forward.x * stopRange, z: target.anchor.z - forward.z * stopRange };
    const heading = formation.flankStage === 0 ? Math.atan2(goal.x - centre.x, goal.z - centre.z) : target.facing;
    if (Number.isFinite(heading)) formation.facing = heading;
    formation.anchor.x = goal.x;
    formation.anchor.z = goal.z;
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
