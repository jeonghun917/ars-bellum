import { M2_CONFIG, m2Receipt } from "./M2_Config.js";
import { validateBattleLaunchSnapshot } from "./M2_BattleSnapshot.js";
import { M2BattleState, isM2UnitAlive } from "./M2_BattleState.js";
import { M2CommandQueue } from "./M2_CommandQueue.js";
import { M2SpatialGrid } from "./M2_SpatialGrid.js";
import { M2FormationSystem } from "./M2_FormationSystem.js";
import { M2MovementSystem } from "./M2_MovementSystem.js";
import { M2CombatSystem } from "./M2_CombatSystem.js";
import { M2MoraleSystem } from "./M2_MoraleSystem.js";
import { M2ResultSystem } from "./M2_ResultSystem.js";
import { M2EnemyAI } from "./M2_EnemyAI.js";
import { M2CollisionSystem } from "./M2_CollisionSystem.js";
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
  #movementSystem = new M2MovementSystem({ maxSpeed: M2_CONFIG.unitMaxSpeed, arrivalEpsilon: M2_CONFIG.arrivalEpsilon });
  #combatSystem = new M2CombatSystem();
  #moraleSystem = new M2MoraleSystem();
  #resultSystem = new M2ResultSystem();
  #enemyAI = new M2EnemyAI();
  #collisionSystem = new M2CollisionSystem();
  #renderSnapshot = null;
  #cameraController = null;
  #inputController = null;
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

  attachControllers({ cameraController = null, inputController = null } = {}) {
    this.#cameraController = cameraController;
    this.#inputController = inputController;
  }

  loadSnapshot(snapshot) {
    if (this.#disposed) return m2Receipt(false, { error: "m2_runtime_disposed" });
    const validation = validateBattleLaunchSnapshot(snapshot, this.#combatProfiles);
    if (!validation.ok) return m2Receipt(false, validation);

    const wasFinalized = this.#status === "finalized" || this.#battleState?.getResult() !== null;
    const candidateState = new M2BattleState(validation.snapshot, this.#combatProfiles);
    this.#formationSystem.updateSlots(candidateState);
    // Start everyone on his place in the formation: the snapshot spaces horsemen like men on foot.
    candidateState.forEachUnitStable((unit) => {
      if (!unit.slotTarget) return;
      unit.position.x = unit.previousPosition.x = unit.slotTarget.x;
      unit.position.z = unit.previousPosition.z = unit.slotTarget.z;
    });
    this.#spatialGrid.rebuild(candidateState);
    const candidateRenderSnapshot = createRenderSnapshot(candidateState);

    this.#launchSnapshot = validation.snapshot;
    this.#battleState = candidateState;
    // A new battle: the enemy waits to be attacked again.
    this.#enemyAI = new M2EnemyAI();
    this.#commandQueue.beginBattleEpoch();
    this.#renderSnapshot = candidateRenderSnapshot;
    this.#renderer.loadRenderSnapshot(this.#renderSnapshot, this.#combatProfiles);
    this.#diagnostics.setActiveCharacters(this.#battleState.unitCount);
    this.#accumulatorMs = 0;
    this.#elapsedSeconds = 0;
    this.#diagnostics.setCombatObservation(this.#combatSystem.getObservation(this.#battleState));
    this.#diagnostics.setBattleObservation(this.#renderSnapshot);
    if (wasFinalized) {
      this.#status = "paused";
      this.#timeScale = 0;
      this.#lastFrameTime = null;
      this.#diagnostics.markStatus(this.#status);
    }

    return m2Receipt(true, { battleId: this.#battleState.battleId, characters: this.#battleState.unitCount, formations: this.#battleState.formationCount });
  }

  start() {
    if (this.#disposed) return m2Receipt(false, { error: "m2_runtime_disposed" });
    if (!this.#battleState) return m2Receipt(false, { error: "m2_snapshot_missing" });
    if (this.#battleState.getResult() !== null) return m2Receipt(false, { error: "m2_runtime_finalized" });
    this.#status = "running";
    this.#timeScale = this.#timeScale || M2_CONFIG.defaultTimeScale;
    this.#lastFrameTime = null;
    this.#renderer.setAnimationLoop(this.#boundFrame);
    this.#diagnostics.markStatus(this.#status);
    return m2Receipt(true, { status: this.#status });
  }

  pause() {
    if (this.#disposed) return m2Receipt(false, { error: "m2_runtime_disposed" });
    if (this.#battleState?.getResult() !== null) {
      this.#status = "finalized";
      this.#timeScale = 0;
      this.#diagnostics.markStatus(this.#status);
      return m2Receipt(true, { status: this.#status, timeScale: 0, idempotent: true });
    }
    this.#status = "paused";
    this.#timeScale = 0;
    this.#diagnostics.markStatus(this.#status);
    return m2Receipt(true, { status: this.#status });
  }

  setTimeScale(scale) {
    if (this.#disposed) return m2Receipt(false, { error: "m2_runtime_disposed" });
    if (![0, 0.25, 0.5, 1].includes(scale)) return m2Receipt(false, { error: "m2_runtime_invalid_time_scale" });
    if (this.#battleState?.getResult() !== null) {
      this.#status = "finalized";
      this.#timeScale = 0;
      this.#diagnostics.markStatus(this.#status);
      return scale === 0 ? m2Receipt(true, { status: this.#status, timeScale: 0, idempotent: true }) : m2Receipt(false, { error: "m2_runtime_finalized" });
    }
    this.#timeScale = scale;
    this.#status = scale === 0 ? "paused" : "running";
    this.#diagnostics.markStatus(this.#status);
    return m2Receipt(true, { status: this.#status, timeScale: scale });
  }

  issueCommand(command) {
    if (this.#disposed) return m2Receipt(false, { error: "m2_runtime_disposed" });
    if (!this.#battleState) return m2Receipt(false, { error: "m2_snapshot_missing" });
    if (this.#battleState.getResult() !== null) return m2Receipt(false, { error: "m2_command_battle_finalized" });
    return this.#commandQueue.enqueue(command, this.#battleState);
  }

  screenPointToGround(clientX, clientY) { return this.#renderer.screenPointToGround(clientX, clientY); }
  getSnapshot() { return this.#battleState ? this.#battleState.getSnapshot() : null; }
  getResult() { return this.#battleState?.getResult() || null; }
  getStatus() { return Object.freeze({ status: this.#status, timeScale: this.#timeScale, disposed: this.#disposed, pendingCommands: this.#commandQueue.pendingCount }); }

  #fixedTick() {
    if (!this.#battleState) return false;
    const processingTick = this.#battleState.tick + 1;
    const activeRevision = this.#inputController?.inputContextRevision ?? null;

    const drained = this.#commandQueue.drain(activeRevision);
    if (drained.staleDropped > 0) this.#diagnostics.markStaleInputCommandsDropped(drained.staleDropped);
    const commands = drained.commands;

    for (const command of commands) if (command.type.startsWith("formation_")) this.#formationSystem.applyCommand(this.#battleState, command);
    this.#enemyAI.step(this.#battleState, processingTick);
    this.#formationSystem.updateAttackGoals(this.#battleState);
    this.#formationSystem.updateSlots(this.#battleState);

    for (const command of commands) if (command.type === "player_move") this.#movementSystem.applyCommand(this.#battleState, command);
    this.#movementSystem.step(this.#battleState, M2_CONFIG.fixedTickMs / 1000);

    this.#spatialGrid.rebuild(this.#battleState);
    // No two soldiers stand in the same place (pushes rebuild the grid as they go).
    this.#collisionSystem.step(this.#battleState, this.#spatialGrid, M2_CONFIG.fixedTickMs / 1000);

    const candidatePlan = this.#combatSystem.prepareTick(this.#battleState, this.#spatialGrid, commands, M2_CONFIG.fixedTickMs / 1000, processingTick);
    const damageEvents = [];
    this.#combatSystem.applyBlockCommands(this.#battleState, commands);
    this.#combatSystem.resolvePlayerMelee(this.#battleState, commands, candidatePlan, damageEvents);
    this.#combatSystem.resolveBowLaunch(this.#battleState, commands, processingTick);
    this.#combatSystem.resolveCrossbowVolleys(this.#battleState, candidatePlan, processingTick);
    this.#combatSystem.resolveNonPlayerContactMelee(this.#battleState, candidatePlan, damageEvents, processingTick);
    this.#combatSystem.progressProjectiles(this.#battleState, candidatePlan, damageEvents);

    const prePhase7LivingIds = this.#battleState.getUnitIdsStable().filter((unitId) => isM2UnitAlive(this.#battleState.getUnit(unitId)));
    this.#combatSystem.applyDamageEvents(this.#battleState, damageEvents);
    const newlyLostThisTick = prePhase7LivingIds.filter((unitId) => !isM2UnitAlive(this.#battleState.getUnit(unitId))).map((unitId) => {
      const unit = this.#battleState.getUnit(unitId);
      return { unitId: unit.unitId, sideId: unit.sideId, formationId: unit.formationId, position: { x: unit.position.x, z: unit.position.z } };
    });

    this.#moraleSystem.step(this.#battleState, { newlyLostThisTick, commands, processingTick });

    let finalizedThisTick = false;
    if (this.#battleState.getResult() === null) {
      const outcome = this.#resultSystem.evaluate(this.#battleState, { commands });
      if (outcome !== null) {
        const acceptedCommandLog = this.#commandQueue.getAcceptedCommandLog();
        const candidate = this.#resultSystem.build(this.#battleState, { outcome, acceptedCommandLog });
        const validation = this.#resultSystem.validate(candidate, this.#battleState, acceptedCommandLog);
        if (!validation.ok) throw new Error(validation.error);
        const commit = this.#battleState.commitFinalResult(validation.result);
        finalizedThisTick = commit.applied === true;
      }
    }

    this.#renderSnapshot = createRenderSnapshot(this.#battleState, { tick: processingTick, selectedFormationId: this.#inputController?.selectedFormationId ?? null });
    this.#diagnostics.setCombatObservation({ ...this.#combatSystem.getObservation(this.#battleState), ...this.#enemyAI.getObservation() });
    this.#diagnostics.setBattleObservation(this.#renderSnapshot);
    this.#diagnostics.markTick(processingTick);
    this.#battleState.markTick(processingTick);
    return finalizedThisTick;
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
        const finalizedThisTick = this.#fixedTick();
        catchUp += 1;
        if (finalizedThisTick) {
          this.#status = "finalized";
          this.#timeScale = 0;
          this.#accumulatorMs = 0;
          this.#diagnostics.markStatus(this.#status);
          break;
        }
      }
      if (this.#timeScale > 0 && this.#accumulatorMs >= M2_CONFIG.fixedTickMs) {
        const dropped = Math.floor(this.#accumulatorMs / M2_CONFIG.fixedTickMs);
        this.#accumulatorMs %= M2_CONFIG.fixedTickMs;
        this.#diagnostics.markDroppedTicks(dropped);
      }
    }

    const interpolationAlpha = M2_CONFIG.fixedTickMs > 0 ? this.#accumulatorMs / M2_CONFIG.fixedTickMs : 0;
    const cameraPose = this.#cameraController?.getPose(this.#renderSnapshot, interpolationAlpha) || null;
    if (cameraPose) this.#renderer.applyCameraPose(cameraPose);
    if (this.#cameraController || this.#inputController) {
      this.#diagnostics.setControlObservation({ cameraMode: this.#cameraController?.mode || "third_person", inputContextRevision: this.#inputController?.inputContextRevision ?? 0, activePointerCount: this.#inputController?.activePointerCount ?? 0, inputListenerCount: this.#inputController?.inputListenerCount ?? 0 });
    }
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
    this.#commandQueue.dispose();
    this.#cameraController = null;
    this.#inputController = null;
    this.#status = "disposed";
    this.#timeScale = 0;
    this.#disposed = true;
    this.#diagnostics.markStatus(this.#status);
    return m2Receipt(true, { status: this.#status });
  }
}
