import { M2_CONFIG, m2Receipt } from "./M2_Config.js";
import { validateBattleLaunchSnapshot } from "./M2_BattleSnapshot.js";
import { M2RendererThree } from "./M2_RendererThree.js";

export class M2BattleRuntime {
  #renderer;
  #diagnostics;
  #combatProfiles;
  #snapshot = null;
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
    this.#snapshot = validation.snapshot;
    this.#renderer.loadSnapshot(this.#snapshot, this.#combatProfiles);
    this.#diagnostics.setActiveCharacters(this.#snapshot.characters.length);
    return m2Receipt(true, { battleId: this.#snapshot.battleId, characters: this.#snapshot.characters.length });
  }

  start() {
    if (this.#disposed) return m2Receipt(false, { error: "m2_runtime_disposed" });
    if (!this.#snapshot) return m2Receipt(false, { error: "m2_snapshot_missing" });
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

  issueCommand() {
    return this.#disposed
      ? m2Receipt(false, { error: "m2_runtime_disposed" })
      : m2Receipt(false, { error: "m2_command_not_available_m2_0" });
  }

  getSnapshot() {
    return this.#snapshot ? JSON.parse(JSON.stringify(this.#snapshot)) : null;
  }

  getResult() { return null; }

  getStatus() {
    return Object.freeze({ status: this.#status, timeScale: this.#timeScale, disposed: this.#disposed });
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
        this.#diagnostics.markTick();
        catchUp += 1;
      }
      if (this.#accumulatorMs >= M2_CONFIG.fixedTickMs) {
        const dropped = Math.floor(this.#accumulatorMs / M2_CONFIG.fixedTickMs);
        this.#accumulatorMs %= M2_CONFIG.fixedTickMs;
        this.#diagnostics.markDroppedTicks(dropped);
      }
    }

    this.#renderer.render(this.#elapsedSeconds + this.#accumulatorMs / 1000);
    this.#diagnostics.sampleFrame(frameDelta, this.#renderer.getInfo());
  }

  dispose() {
    if (this.#disposed) return m2Receipt(true, { idempotent: true });
    this.#renderer.setAnimationLoop(null);
    document.removeEventListener("visibilitychange", this.#visibilityHandler);
    this.#renderer.dispose();
    this.#snapshot = null;
    this.#status = "disposed";
    this.#timeScale = 0;
    this.#disposed = true;
    this.#diagnostics.markStatus(this.#status);
    return m2Receipt(true, { status: this.#status });
  }
}
