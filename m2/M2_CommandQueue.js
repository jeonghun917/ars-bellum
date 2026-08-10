import { m2Receipt } from "./M2_Config.js";

function validId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_.:-]*$/i.test(value);
}

function normalizeTarget(target) {
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z)) return null;
  return Object.freeze({ x: Number(target.x), z: Number(target.z) });
}

export class M2CommandQueue {
  #queue = [];
  #seenCommandIds = new Set();

  enqueue(command, battleState) {
    if (!command || typeof command !== "object" || Array.isArray(command) || !validId(command.commandId)) {
      return m2Receipt(false, { error: "m2_command_invalid" });
    }

    if (this.#seenCommandIds.has(command.commandId)) {
      return m2Receipt(true, { commandId: command.commandId, queued: false, idempotent: true });
    }

    if (!["formation_move", "formation_hold"].includes(command.type)) {
      return m2Receipt(false, { error: "m2_command_not_available_m2_1_01", commandId: command.commandId });
    }

    if (!validId(command.formationId) || !battleState.hasFormation(command.formationId)) {
      return m2Receipt(false, { error: "m2_command_unknown_formation", commandId: command.commandId });
    }

    let normalized;
    if (command.type === "formation_move") {
      const target = normalizeTarget(command.target);
      if (!target) return m2Receipt(false, { error: "m2_command_invalid_target", commandId: command.commandId });
      normalized = Object.freeze({
        commandId: command.commandId,
        type: command.type,
        formationId: command.formationId,
        target
      });
    } else {
      normalized = Object.freeze({
        commandId: command.commandId,
        type: command.type,
        formationId: command.formationId
      });
    }

    this.#seenCommandIds.add(command.commandId);
    this.#queue.push(normalized);
    return m2Receipt(true, { commandId: command.commandId, queued: true, idempotent: false });
  }

  drain() {
    const commands = this.#queue;
    this.#queue = [];
    return commands;
  }

  clear() {
    this.#queue.length = 0;
    this.#seenCommandIds.clear();
  }

  get pendingCount() {
    return this.#queue.length;
  }
}
