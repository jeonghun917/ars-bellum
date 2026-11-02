import { M2_CONFIG } from "./M2_Config.js";

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const PLAYER_FEED_KEPT = 8;

export class M2Diagnostics {
  #frames = [];
  #status = "created";
  #fixedTickCount = 0;
  #logicalTick = 0;
  #droppedTicks = 0;
  #lastFrameMs = 0;
  #drawCalls = 0;
  #triangles = 0;
  #activeCharacters = 0;
  #renderedUnits = 0;
  #soldierModel = "none";
  #soldierGear = Object.freeze({});
  // The player's latest blows and shots and those at him (M2_CombatSystem.js getPlayerFeed), newest last.
  #playerFeed = [];
  #view = Object.freeze({ right: { x: 1, z: 0 }, forward: { x: 0, z: 1 }, lookDown: 0, height: 0 });
  #soldierAnimations = {};
  #horseAnimations = {};
  #lastError = null;
  #cameraMode = "third_person";
  // The player's weapon in hand and his shield (M2_InputController.js), and where the aiming circle stands.
  #hands = Object.freeze({ weapon: "melee", shieldUp: false });
  // The formations the player has selected, and his battalions (M2_InputController.js, M2_UnitPanel.js).
  #selection = Object.freeze({ formationIds: Object.freeze([]), groups: Object.freeze([]) });
  #aim = null;
  #inputContextRevision = 0;
  #activePointerCount = 0;
  #inputListenerCount = 0;
  #staleInputCommandsDropped = 0;
  #projectileLaunchCount = 0;
  #activeProjectileCount = 0;
  #projectileHitCount = 0;
  #projectileOverflowCount = 0;
  #crossbowLaunchCount = 0;
  #chargeHitCount = 0;
  #stoppedCount = 0;
  #enemyAwake = false;
  #moraleSummary = Object.freeze({ ally: 0, enemy: 0 });
  #routingCounts = Object.freeze({ ally: 0, enemy: 0, total: 0 });
  #battleResultOutcome = null;

  markStatus(status) { this.#status = status; }
  markError(error) { this.#lastError = String(error?.message || error); this.#status = "error"; }
  markTick(logicalTick = this.#fixedTickCount + 1) {
    this.#fixedTickCount += 1;
    this.#logicalTick = logicalTick;
  }
  markDroppedTicks(count) { this.#droppedTicks += Math.max(0, count | 0); }
  markStaleInputCommandsDropped(count) { this.#staleInputCommandsDropped += Math.max(0, count | 0); }
  setActiveCharacters(count) { this.#activeCharacters = Math.max(0, count | 0); }

  addPlayerFeed(tick, entries = []) {
    for (const entry of entries) this.#playerFeed.push(Object.freeze({ tick, ...entry }));
    if (this.#playerFeed.length > PLAYER_FEED_KEPT) this.#playerFeed.splice(0, this.#playerFeed.length - PLAYER_FEED_KEPT);
  }

  setControlObservation(observation = {}) {
    if (["third_person", "tactical", "disposed"].includes(observation.cameraMode)) this.#cameraMode = observation.cameraMode;
    if (Array.isArray(observation.selectedFormationIds)) this.#selection = Object.freeze({ formationIds: Object.freeze([...observation.selectedFormationIds]), groups: Object.freeze((observation.groups || []).map((g) => Object.freeze({ ...g, members: Object.freeze([...g.members]) }))) });
    if (["melee", "bow"].includes(observation.weapon)) this.#hands = Object.freeze({ weapon: observation.weapon, shieldUp: Boolean(observation.shieldUp) });
    if (Number.isSafeInteger(observation.inputContextRevision) && observation.inputContextRevision >= 0) this.#inputContextRevision = observation.inputContextRevision;
    if (Number.isSafeInteger(observation.activePointerCount) && observation.activePointerCount >= 0) this.#activePointerCount = observation.activePointerCount;
    if (Number.isSafeInteger(observation.inputListenerCount) && observation.inputListenerCount >= 0) this.#inputListenerCount = observation.inputListenerCount;
  }

  setCombatObservation(observation = {}) {
    this.#projectileLaunchCount = Math.max(0, observation.projectileLaunchCount | 0);
    this.#activeProjectileCount = Math.max(0, observation.activeProjectileCount | 0);
    this.#projectileHitCount = Math.max(0, observation.projectileHitCount | 0);
    this.#projectileOverflowCount = Math.max(0, observation.projectileOverflowCount | 0);
    this.#crossbowLaunchCount = Math.max(0, observation.crossbowLaunchCount | 0);
    this.#chargeHitCount = Math.max(0, observation.chargeHitCount | 0);
    this.#stoppedCount = Math.max(0, observation.stoppedCount | 0);
    this.#enemyAwake = observation.enemyAwake === true;
  }

  setBattleObservation(renderSnapshot = {}) {
    const ally = Number(renderSnapshot.moraleSummary?.ally);
    const enemy = Number(renderSnapshot.moraleSummary?.enemy);
    this.#moraleSummary = Object.freeze({
      ally: Number.isFinite(ally) ? ally : 0,
      enemy: Number.isFinite(enemy) ? enemy : 0
    });
    this.#routingCounts = Object.freeze({
      ally: Math.max(0, renderSnapshot.routingCounts?.ally | 0),
      enemy: Math.max(0, renderSnapshot.routingCounts?.enemy | 0),
      total: Math.max(0, renderSnapshot.routingCounts?.total | 0)
    });
    this.#battleResultOutcome = renderSnapshot.battleResultOutcome || null;
  }

  sampleFrame(frameMs, rendererInfo = {}) {
    this.#lastFrameMs = frameMs;
    this.#frames.push(frameMs);
    if (this.#frames.length > 120) this.#frames.shift();
    this.#drawCalls = Number(rendererInfo.drawCalls || 0);
    this.#triangles = Number(rendererInfo.triangles || 0);
    this.#renderedUnits = Number(rendererInfo.renderedUnits || 0);
    this.#soldierModel = rendererInfo.soldierModel || "none";
    this.#soldierAnimations = Object.freeze({ ...(rendererInfo.soldierAnimations || {}) });
    this.#horseAnimations = Object.freeze({ ...(rendererInfo.horseAnimations || {}) });
    this.#soldierGear = Object.freeze({ ...(rendererInfo.soldierGear || {}) });
    this.#aim = rendererInfo.aim ? Object.freeze({ ...rendererInfo.aim }) : null;
    if (rendererInfo.view) this.#view = Object.freeze({ ...rendererInfo.view, right: { ...rendererInfo.view.right }, forward: { ...rendererInfo.view.forward } });
  }

  getSnapshot() {
    const averageFrameMs = this.#frames.length ? this.#frames.reduce((sum, value) => sum + value, 0) / this.#frames.length : 0;
    return Object.freeze({
      phase: M2_CONFIG.phase,
      status: this.#status,
      fps: averageFrameMs > 0 ? round(1000 / averageFrameMs, 1) : 0,
      frameMs: round(this.#lastFrameMs, 2),
      fixedTickCount: this.#fixedTickCount,
      logicalTick: this.#logicalTick,
      droppedTicks: this.#droppedTicks,
      drawCalls: this.#drawCalls,
      triangles: this.#triangles,
      activeCharacters: this.#activeCharacters,
      renderedUnits: this.#renderedUnits,
      soldierModel: this.#soldierModel,
      soldierAnimations: this.#soldierAnimations,
      horseAnimations: this.#horseAnimations,
      soldierGear: this.#soldierGear,
      playerFeed: Object.freeze([...this.#playerFeed]),
      view: this.#view,
      animationOwner: "M2BattleRuntime",
      runtimeNetworkImport: false,
      persistenceAccess: false,
      cameraMode: this.#cameraMode,
      hands: this.#hands,
      selection: this.#selection,
      aim: this.#aim,
      inputContextRevision: this.#inputContextRevision,
      activePointerCount: this.#activePointerCount,
      inputListenerCount: this.#inputListenerCount,
      staleInputCommandsDropped: this.#staleInputCommandsDropped,
      projectileLaunchCount: this.#projectileLaunchCount,
      activeProjectileCount: this.#activeProjectileCount,
      projectileHitCount: this.#projectileHitCount,
      projectileOverflowCount: this.#projectileOverflowCount,
      crossbowLaunchCount: this.#crossbowLaunchCount,
      chargeHitCount: this.#chargeHitCount,
      // Blows and shots stopped by a shield or a parry (M2_Defense.js).
      stoppedCount: this.#stoppedCount,
      enemyAwake: this.#enemyAwake,
      moraleSummary: this.#moraleSummary,
      routingCounts: this.#routingCounts,
      battleResultOutcome: this.#battleResultOutcome,
      lastError: this.#lastError
    });
  }
}
