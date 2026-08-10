import { M2_CONFIG } from "./M2_Config.js";

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export class M2Diagnostics {
  #frames = [];
  #status = "created";
  #fixedTickCount = 0;
  #droppedTicks = 0;
  #lastFrameMs = 0;
  #drawCalls = 0;
  #triangles = 0;
  #activeCharacters = 0;
  #renderedUnits = 0;
  #lastError = null;

  markStatus(status) { this.#status = status; }
  markError(error) { this.#lastError = String(error?.message || error); this.#status = "error"; }
  markTick() { this.#fixedTickCount += 1; }
  markDroppedTicks(count) { this.#droppedTicks += Math.max(0, count | 0); }
  setActiveCharacters(count) { this.#activeCharacters = Math.max(0, count | 0); }

  sampleFrame(frameMs, rendererInfo = {}) {
    this.#lastFrameMs = frameMs;
    this.#frames.push(frameMs);
    if (this.#frames.length > 120) this.#frames.shift();
    this.#drawCalls = Number(rendererInfo.drawCalls || 0);
    this.#triangles = Number(rendererInfo.triangles || 0);
    this.#renderedUnits = Number(rendererInfo.renderedUnits || 0);
  }

  getSnapshot() {
    const averageFrameMs = this.#frames.length
      ? this.#frames.reduce((sum, value) => sum + value, 0) / this.#frames.length
      : 0;
    return Object.freeze({
      phase: M2_CONFIG.phase,
      status: this.#status,
      fps: averageFrameMs > 0 ? round(1000 / averageFrameMs, 1) : 0,
      frameMs: round(this.#lastFrameMs, 2),
      fixedTickCount: this.#fixedTickCount,
      droppedTicks: this.#droppedTicks,
      drawCalls: this.#drawCalls,
      triangles: this.#triangles,
      activeCharacters: this.#activeCharacters,
      renderedUnits: this.#renderedUnits,
      animationOwner: "M2BattleRuntime",
      runtimeNetworkImport: false,
      persistenceAccess: false,
      lastError: this.#lastError
    });
  }
}
