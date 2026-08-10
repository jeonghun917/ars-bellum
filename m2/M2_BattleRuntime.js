import { M2_CONFIG, m2Receipt } from "./M2_Config.js";
import { validateBattleLaunchSnapshot } from "./M2_BattleSnapshot.js";
import { M2BattleState } from "./M2_BattleState.js";
import { M2CommandQueue } from "./M2_CommandQueue.js";
import { M2SpatialGrid } from "./M2_SpatialGrid.js";
import { M2FormationSystem } from "./M2_FormationSystem.js";
import { M2MovementSystem } from "./M2_MovementSystem.js";
import { createRenderSnapshot } from "./M2_RenderSnapshot.js";
import { M2RendererThree } from "./M2_RendererThree.js";

export class M2BattleRuntime {
  #renderer;
  #diagnostics;
  #combatProfiles;
  #launchSnapshot = null;
  #battleState = null;
  #commandQueue = new M2CommandQueue();
  #spatialGrid = new M2SpatialGrid(M2_CONFIG.spatialCellSize);
  #formationSystem = new M2FormationSystem();
  #movementSystem = new M2MovementSystem({
    maxSpeed: M2_CONFIG.unitMaxSpeed,
    arrivalEpsilon: M2_CONFIG.arrivalEpsilon
  });
  #renderSnapshot = null;
  #status = "created";
  #timeScale = M2_CONFIG.defaultTimeScale;
  #lastFrameTime = null;
  #accumulatorMs = 0;
  #elapsedSeconds = 0;
  #disposed = false;
  #boundFrame;
  #visibilityHandler;

  constructor({ canvas, diagnostics, combatProfiles }) {
    this.#diagnostics = diagnostics;
    this.#combatProfiles = combatProfiles;
    this.#renderer = new M2RendererThree(canvas);
    this.#boundFrame = (timeMs) => this.#frame(timeMs);
    this.#visibilityHandler = () => {
      this.#lastFrameTime = null;
      if (document.hidden) this.#diagnostics.markStatus("background");
      else this.#diagnostics.markStatus(this.#status);
    };
    document.addEventListener("visibilitychange", this.#visibilityHandler);
  }

  loadSnapshot(snapshot) {
    if (this.#disposed) return m2Receipt(false, { error: "m2_runtime_disposed" });
    const validation = validateBattleLaunchSnapshot(snapshot, this.#combatProfiles);
    if (!validation.ok) return m2Receipt(false, validation);

    this.#launchSnapshot = validation.snapshot;
    this.#battleState = new M2BattleState(this.#launchSnapshot, this.#combatProfiles);
    this.#commandQueue.clear();
    this.#formationSystem.updateSlots(this.#battleState);
    this.#spatialGrid.rebuild(this.#battleState);
    this.#renderSnapshot = createRenderSnapshot(this.#battleState);
    this.#renderer.loadRenderSnapshot(this.#renderSnapshot, this.#combatProfiles);
    this.#diagnostics.setActiveCharacters(this.#battleState.unitCount);
    this.#accumulatorMs = 0;
    this.#elapsedSeconds = 0;

    return m2Receipt(true, {
      battleId: this.#battleState.battleId,
      characters: this.#battleState.unitCount,
      formations: this.#battleState.formationCount
    });
  }

  start() {
    if (this.#disposed) return m2Receipt(false, { error: "m2_runtime_disposed" });
    if (!this.#battleState) return m2Receipt(false, { error: "m2_snapshot_missing" });
    this.#status = "running";
    this.#timeScale = this.#timeScale || M2_CONFIG.defaultTimeScale;
    this.#lastFrameTime = null;
    this.#renderer.setAnimationLoop(this.#boundFrame);
    this.#diagnostics.markStatus(this.#status);
    return m2Receipt(true, { status: this.#status });
  }

  pause() {
    if (this.#disposed) return m2Receipt(false, { error: "m2_runtime_disposed" });
    this.#status = "paused";
    this.#timeScale = 0;
    this.#diagnostics.markStatus(this.#status);
    return m2Receipt(true, { status: this.#status });
  }

  setTimeScale(scale) {
    if (this.#disposed) return m2Receipt(false, { error: "m2_runtime_disposed" });
    if (![0, 0.25, 0.5, 1].includes(scale)) return m2Receipt(false, { error: "m2_runtime_invalid_time_scale" });
    this.#timeScale = scale;
    this.#status = scale === 0 ? "paused" : "running";
    this.#diagnostics.markStatus(this.#status);
    return m2Receipt(true, { status: this.#status, timeScale: scale });
  }

  issueCommand(command) {
    if (this.#disposed) return m2Receipt(false, { error: "m2_runtime_disposed" });
    if (!this.#battleState) return m2Receipt(false, { error: "m2_snapshot_missing" });
    return this.#commandQueue.enqueue(command, this.#battleState);
  }

  getSnapshot() {
    return this.#battleState ? this.#battleState.getSnapshot() : null;
  }

  getResult() { return null; }

  getStatus() {
    return Object.freeze({
      status: this.#status,
      timeScale: this.#timeScale,
      disposed: this.#disposed,
      pendingCommands: this.#commandQueue.pendingCount
    });
  }

  #fixedTick() {
    const commands = this.#commandQueue.drain();
    for (const command of commands) this.#formationSystem.applyCommand(this.#battleState, command);
    this.#formationSystem.updateSlots(this.#battleState);
    this.#movementSystem.step(this.#battleState, M2_CONFIG.fixedTickMs / 1000);
    this.#spatialGrid.rebuild(this.#battleState);
    this.#battleState.markTick();
    this.#renderSnapshot = createRenderSnapshot(this.#battleState);
    this.#diagnostics.markTick();
  }

  #frame(timeMs) {
    if (this.#disposed) return;
    if (this.#lastFrameTime === null) this.#lastFrameTime = timeMs;
    const rawDelta = Math.max(0, timeMs - this.#lastFrameTime);
    const frameDelta = Math.min(rawDelta, M2_CONFIG.maxFrameDeltaMs);
    this.#lastFrameTime = timeMs;

    if (this.#timeScale > 0) {
      this.#accumulatorMs += frameDelta * this.#timeScale;
      let catchUp = 0;
      while (this.#accumulatorMs >= M2_CONFIG.fixedTickMs && catchUp < M2_CONFIG.maxCatchUpTicks) {
        this.#accumulatorMs -= M2_CONFIG.fixedTickMs;
        this.#elapsedSeconds += M2_CONFIG.fixedTickMs / 1000;
        this.#fixedTick();
        catchUp += 1;
      }
      if (this.#accumulatorMs >= M2_CONFIG.fixedTickMs) {
        const dropped = Math.floor(this.#accumulatorMs / M2_CONFIG.fixedTickMs);
        this.#accumulatorMs %= M2_CONFIG.fixedTickMs;
        this.#diagnostics.markDroppedTicks(dropped);
      }
    }

    const interpolationAlpha = M2_CONFIG.fixedTickMs > 0
      ? this.#accumulatorMs / M2_CONFIG.fixedTickMs
      : 0;
    this.#renderer.render(this.#renderSnapshot, interpolationAlpha, this.#elapsedSeconds + this.#accumulatorMs / 1000);
    this.#diagnostics.sampleFrame(frameDelta, this.#renderer.getInfo());
  }

  dispose() {
    if (this.#disposed) return m2Receipt(true, { idempotent: true });
    this.#renderer.setAnimationLoop(null);
    document.removeEventListener("visibilitychange", this.#visibilityHandler);
    this.#renderer.dispose();
    this.#launchSnapshot = null;
    this.#battleState = null;
    this.#renderSnapshot = null;
    this.#commandQueue.clear();
    this.#status = "disposed";
    this.#timeScale = 0;
    this.#disposed = true;
    this.#diagnostics.markStatus(this.#status);
    return m2Receipt(true, { status: this.#status });
  }
}
