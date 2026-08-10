import { m2Receipt } from "./M2_Config.js";

function validId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_.:-]*$/i.test(value);
}

function normalizeTarget(target) {
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z)) return null;
  return Object.freeze({ x: Number(target.x), z: Number(target.z) });
}

function normalizeMove(move) {
  if (!move || !Number.isFinite(move.x) || !Number.isFinite(move.z)) return null;
  let x = Math.max(-1, Math.min(1, Number(move.x)));
  let z = Math.max(-1, Math.min(1, Number(move.z)));
  const magnitude = Math.hypot(x, z);
  if (magnitude > 1) {
    x /= magnitude;
    z /= magnitude;
  }
  return Object.freeze({ x, z });
}

function normalizeRevision(value) {
  if (value === undefined || value === null) return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : NaN;
}

const ALLOWED_TYPES = new Set([
  "formation_move",
  "formation_hold",
  "formation_attack",
  "formation_set_type",
  "player_move",
  "player_melee_attack",
  "player_block",
  "player_bow_fire"
]);

export class M2CommandQueue {
  #queue = [];
  #seenCommandIds = new Set();

  beginBattleEpoch() {
    this.#queue.length = 0;
    this.#seenCommandIds.clear();
  }

  enqueue(command, battleState) {
    if (!command || typeof command !== "object" || Array.isArray(command) || !validId(command.commandId)) {
      return m2Receipt(false, { error: "m2_command_invalid" });
    }
    if (this.#seenCommandIds.has(command.commandId)) {
      return m2Receipt(true, { commandId: command.commandId, queued: false, idempotent: true });
    }
    if (!ALLOWED_TYPES.has(command.type)) {
      return m2Receipt(false, { error: "m2_command_not_available_m2_1_02", commandId: command.commandId });
    }

    const inputContextRevision = normalizeRevision(command.inputContextRevision);
    if (Number.isNaN(inputContextRevision)) {
      return m2Receipt(false, { error: "m2_command_invalid_input_revision", commandId: command.commandId });
    }

    let normalized = null;
    if (command.type.startsWith("formation_")) {
      if (!validId(command.formationId) || !battleState.hasFormation(command.formationId)) {
        return m2Receipt(false, { error: "m2_command_unknown_formation", commandId: command.commandId });
      }
      const source = battleState.getFormation(command.formationId);
      if (command.type === "formation_move") {
        const target = normalizeTarget(command.target);
        if (!target) return m2Receipt(false, { error: "m2_command_invalid_target", commandId: command.commandId });
        normalized = { commandId: command.commandId, type: command.type, inputContextRevision, formationId: command.formationId, target };
      } else if (command.type === "formation_hold") {
        normalized = { commandId: command.commandId, type: command.type, inputContextRevision, formationId: command.formationId };
      } else if (command.type === "formation_set_type") {
        if (!["line", "column", "loose"].includes(command.formationTypeId)) {
          return m2Receipt(false, { error: "m2_command_invalid_formation_type", commandId: command.commandId });
        }
        normalized = { commandId: command.commandId, type: command.type, inputContextRevision, formationId: command.formationId, formationTypeId: command.formationTypeId };
      } else {
        if (!validId(command.targetFormationId) || !battleState.hasFormation(command.targetFormationId)) {
          return m2Receipt(false, { error: "m2_command_unknown_target_formation", commandId: command.commandId });
        }
        const target = battleState.getFormation(command.targetFormationId);
        if (source.formationId === target.formationId || source.sideId === target.sideId) {
          return m2Receipt(false, { error: "m2_command_invalid_attack_target", commandId: command.commandId });
        }
        normalized = { commandId: command.commandId, type: command.type, inputContextRevision, formationId: command.formationId, targetFormationId: command.targetFormationId };
      }
    } else {
      if (!validId(command.actorUnitId) || command.actorUnitId !== battleState.playerCharacterId) {
        return m2Receipt(false, { error: "m2_command_invalid_player_actor", commandId: command.commandId });
      }
      if (command.type === "player_move") {
        const move = normalizeMove(command.move);
        if (!move) return m2Receipt(false, { error: "m2_command_invalid_move", commandId: command.commandId });
        normalized = { commandId: command.commandId, type: command.type, inputContextRevision, actorUnitId: command.actorUnitId, move };
      } else if (command.type === "player_block") {
        if (typeof command.active !== "boolean" || !Number.isFinite(command.aimHeading)) {
          return m2Receipt(false, { error: "m2_command_invalid_block", commandId: command.commandId });
        }
        normalized = { commandId: command.commandId, type: command.type, inputContextRevision, actorUnitId: command.actorUnitId, active: command.active, aimHeading: Number(command.aimHeading) };
      } else {
        if (!Number.isFinite(command.aimHeading)) {
          return m2Receipt(false, { error: "m2_command_invalid_aim", commandId: command.commandId });
        }
        normalized = { commandId: command.commandId, type: command.type, inputContextRevision, actorUnitId: command.actorUnitId, aimHeading: Number(command.aimHeading) };
      }
    }

    this.#seenCommandIds.add(command.commandId);
    this.#queue.push(Object.freeze(normalized));
    return m2Receipt(true, { commandId: command.commandId, queued: true, idempotent: false });
  }

  drain(activeRevision = null) {
    const commands = [];
    let staleDropped = 0;
    for (const command of this.#queue) {
      if (
        command.inputContextRevision !== null &&
        Number.isSafeInteger(activeRevision) &&
        command.inputContextRevision < activeRevision
      ) {
        staleDropped += 1;
      } else {
        commands.push(command);
      }
    }
    this.#queue = [];
    return Object.freeze({ commands, staleDropped });
  }

  clearPending() {
    this.#queue.length = 0;
  }

  dispose() {
    this.#queue.length = 0;
    this.#seenCommandIds.clear();
  }

  get pendingCount() { return this.#queue.length; }
  hasSeen(commandId) { return this.#seenCommandIds.has(commandId); }
}
