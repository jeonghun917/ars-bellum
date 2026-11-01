function stopEvent(event) {
  event.preventDefault?.();
  event.stopPropagation?.();
}

function keyVector(keys) {
  let x = 0;
  let z = 0;
  if (keys.has("KeyA")) x -= 1;
  if (keys.has("KeyD")) x += 1;
  if (keys.has("KeyW")) z += 1;
  if (keys.has("KeyS")) z -= 1;
  const magnitude = Math.hypot(x, z);
  return magnitude > 1 ? { x: x / magnitude, z: z / magnitude } : { x, z };
}

export class M2InputController {
  #runtime;
  #camera;
  #diagnostics;
  #elements;
  #listeners = [];
  #activePointers = new Map();
  #keys = new Set();
  #virtualStick = { x: 0, z: 0 };
  #inputContextRevision = 0;
  #commandSequence = 0;
  #selectedFormationId = null;
  #selectedEnemyFormationId = null;
  #disposed = false;
  #lastPinchDistance = null;
  #canvasGestureMoved = false;

  constructor({ runtime, cameraController, diagnostics, elements }) {
    this.#runtime = runtime;
    this.#camera = cameraController;
    this.#diagnostics = diagnostics;
    this.#elements = elements;
    this.refreshFormationLists();
    this.#install();
    this.#observe();
  }

  get inputContextRevision() { return this.#inputContextRevision; }
  get activePointerCount() { return this.#activePointers.size; }
  get inputListenerCount() { return this.#listeners.length; }
  get selectedFormationId() { return this.#selectedFormationId; }

  #nextCommandId() {
    this.#commandSequence += 1;
    return `input:${this.#inputContextRevision}:${this.#commandSequence}`;
  }

  #issue(type, payload = {}) {
    if (this.#disposed) return { ok: false, error: "m2_input_disposed" };
    return this.#runtime.issueCommand({
      commandId: this.#nextCommandId(),
      type,
      inputContextRevision: this.#inputContextRevision,
      ...payload
    });
  }

  #playerId() {
    return this.#runtime.getSnapshot()?.playerCharacterId || null;
  }

  #aimHeading() {
    return this.#camera.getSnapshot().heading;
  }

  #listen(target, type, handler, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, options);
    this.#listeners.push({ target, type, handler, options });
  }

  #observe() {
    this.#diagnostics.setControlObservation({
      cameraMode: this.#camera.mode,
      inputContextRevision: this.#inputContextRevision,
      activePointerCount: this.#activePointers.size,
      inputListenerCount: this.#listeners.length
    });
  }

  #queueMove(move) {
    const actorUnitId = this.#playerId();
    if (!actorUnitId) return;
    this.#issue("player_move", { actorUnitId, move });
  }

  #queueBlock(active) {
    const actorUnitId = this.#playerId();
    if (!actorUnitId) return;
    this.#issue("player_block", { actorUnitId, active, aimHeading: this.#aimHeading() });
  }

  resetInputContext({ enqueueReleases = true } = {}) {
    if (this.#disposed) return;
    this.#inputContextRevision += 1;
    this.#activePointers.clear();
    this.#keys.clear();
    this.#virtualStick = { x: 0, z: 0 };
    this.#lastPinchDistance = null;
    if (enqueueReleases) {
      this.#queueMove({ x: 0, z: 0 });
      this.#queueBlock(false);
    }
    this.#observe();
  }

  switchMode() {
    if (this.#disposed) return;
    this.resetInputContext({ enqueueReleases: true });
    // The tactical view opens over the middle of everyone still standing, so both armies are in frame.
    const standing = (this.#runtime.getSnapshot()?.units || []).filter((unit) => unit.state !== "dead");
    const middle = standing.length ? {
      x: standing.reduce((sum, unit) => sum + unit.position.x, 0) / standing.length,
      z: standing.reduce((sum, unit) => sum + unit.position.z, 0) / standing.length
    } : null;
    this.#camera.toggle(middle);
    if (this.#camera.mode === "tactical") this.refreshFormationLists();
    this.#observe();
  }

  refreshFormationLists() {
    const snapshot = this.#runtime.getSnapshot();
    if (!snapshot) return;
    const player = snapshot.units.find((unit) => unit.isPlayer);
    const friendly = snapshot.formations.filter((formation) => formation.sideId === player?.sideId).sort((a,b)=>a.formationId.localeCompare(b.formationId));
    const enemy = snapshot.formations.filter((formation) => formation.sideId !== player?.sideId).sort((a,b)=>a.formationId.localeCompare(b.formationId));
    if (!this.#selectedFormationId || !friendly.some((entry)=>entry.formationId===this.#selectedFormationId)) {
      this.#selectedFormationId = (friendly.find((entry)=>entry.formationTypeId==="line") || friendly[0])?.formationId || friendly[0]?.formationId || null;
    }
    if (!this.#selectedEnemyFormationId || !enemy.some((entry)=>entry.formationId===this.#selectedEnemyFormationId)) {
      this.#selectedEnemyFormationId = enemy[0]?.formationId || null;
    }

    const fill = (select, rows, selected) => {
      if (!select) return;
      select.textContent = "";
      for (const row of rows) {
        const option = document.createElement("option");
        option.value = row.formationId;
        option.textContent = row.formationId;
        option.selected = row.formationId === selected;
        select.appendChild(option);
      }
    };
    fill(this.#elements.friendlyFormation, friendly, this.#selectedFormationId);
    fill(this.#elements.enemyFormation, enemy, this.#selectedEnemyFormationId);
  }

  #install() {
    const canvas = this.#elements.canvas;
    this.#listen(window, "keydown", (event) => {
      if (event.repeat && ["KeyJ","KeyL","Tab","Digit1","Digit2","Digit3"].includes(event.code)) return;
      if (["KeyW","KeyA","KeyS","KeyD"].includes(event.code)) {
        this.#keys.add(event.code);
        const vector = keyVector(this.#keys);
        if (this.#camera.mode === "third_person") this.#queueMove(vector);
        else this.#camera.pan(vector.x * 0.8, vector.z * 0.8);
        this.#observe();
      } else if (event.code === "KeyJ") {
        this.#issue("player_melee_attack", { actorUnitId: this.#playerId(), aimHeading: this.#aimHeading() });
      } else if (event.code === "KeyK") {
        this.#queueBlock(true);
      } else if (event.code === "KeyL") {
        this.#issue("player_bow_fire", { actorUnitId: this.#playerId(), aimHeading: this.#aimHeading() });
      } else if (event.code === "Tab") {
        stopEvent(event);
        this.switchMode();
      } else if (this.#camera.mode === "tactical" && ["Digit1","Digit2","Digit3"].includes(event.code)) {
        const formationTypeId = { Digit1: "line", Digit2: "column", Digit3: "loose" }[event.code];
        if (this.#selectedFormationId) this.#issue("formation_set_type", { formationId: this.#selectedFormationId, formationTypeId });
      }
    });

    this.#listen(window, "keyup", (event) => {
      if (["KeyW","KeyA","KeyS","KeyD"].includes(event.code)) {
        this.#keys.delete(event.code);
        const vector = keyVector(this.#keys);
        if (this.#camera.mode === "third_person") this.#queueMove(vector);
      } else if (event.code === "KeyK") {
        this.#queueBlock(false);
      }
      this.#observe();
    });

    this.#listen(window, "blur", () => this.resetInputContext({ enqueueReleases: true }));
    this.#listen(document, "visibilitychange", () => {
      if (document.hidden) this.resetInputContext({ enqueueReleases: true });
    });
    this.#listen(window, "pagehide", () => {
      if (!this.#disposed) this.resetInputContext({ enqueueReleases: true });
    });

    this.#listen(canvas, "contextmenu", stopEvent);
    this.#listen(canvas, "pointerdown", (event) => {
      stopEvent(event);
      try { canvas.setPointerCapture(event.pointerId); } catch {}
      this.#activePointers.set(event.pointerId, {
        x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
        pointerType: event.pointerType, button: event.button
      });
      this.#canvasGestureMoved = false;
      this.#lastPinchDistance = null;
      this.#observe();
    });

    this.#listen(canvas, "pointermove", (event) => {
      const entry = this.#activePointers.get(event.pointerId);
      if (!entry) return;
      stopEvent(event);
      const dx = event.clientX - entry.x;
      const dy = event.clientY - entry.y;
      if (Math.hypot(event.clientX - entry.startX, event.clientY - entry.startY) > 6) this.#canvasGestureMoved = true;
      entry.x = event.clientX;
      entry.y = event.clientY;

      const pointers = [...this.#activePointers.values()];
      if (pointers.length >= 2) {
        const distance = Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
        if (this.#lastPinchDistance !== null) this.#camera.zoom((this.#lastPinchDistance - distance) * 0.03);
        this.#lastPinchDistance = distance;
      } else {
        this.#camera.rotate(-dx * 0.006, dy * 0.004);
      }
      this.#observe();
    });

    const finishCanvasPointer = (event, cancelled = false) => {
      const entry = this.#activePointers.get(event.pointerId);
      if (!entry) return;
      stopEvent(event);
      this.#activePointers.delete(event.pointerId);
      this.#lastPinchDistance = null;
      if (
        !cancelled &&
        this.#camera.mode === "tactical" &&
        !this.#canvasGestureMoved &&
        this.#selectedFormationId
      ) {
        const target = this.#runtime.screenPointToGround(event.clientX, event.clientY);
        if (target) this.#issue("formation_move", { formationId: this.#selectedFormationId, target });
      }
      this.#observe();
    };
    this.#listen(canvas, "pointerup", (event) => finishCanvasPointer(event, false));
    this.#listen(canvas, "pointercancel", (event) => {
      finishCanvasPointer(event, true);
      this.resetInputContext({ enqueueReleases: true });
    });
    this.#listen(canvas, "lostpointercapture", () => this.resetInputContext({ enqueueReleases: true }));

    const control = (element, type, handler) => this.#listen(element, type, (event) => { stopEvent(event); handler(event); });
    control(this.#elements.attack, "pointerdown", () => this.#issue("player_melee_attack", { actorUnitId: this.#playerId(), aimHeading: this.#aimHeading() }));
    control(this.#elements.block, "pointerdown", () => this.#queueBlock(true));
    for (const type of ["pointerup","pointercancel","lostpointercapture"]) control(this.#elements.block, type, () => this.#queueBlock(false));
    control(this.#elements.bow, "pointerdown", () => this.#issue("player_bow_fire", { actorUnitId: this.#playerId(), aimHeading: this.#aimHeading() }));
    control(this.#elements.tactical, "pointerdown", () => this.switchMode());
    control(this.#elements.attackOrder, "pointerdown", () => {
      if (this.#selectedFormationId && this.#selectedEnemyFormationId) {
        this.#issue("formation_attack", { formationId: this.#selectedFormationId, targetFormationId: this.#selectedEnemyFormationId });
      }
    });
    control(this.#elements.rally, "pointerdown", () => {
      if (this.#selectedFormationId) this.#issue("formation_rally", { formationId: this.#selectedFormationId });
    });
    control(this.#elements.retreat, "pointerdown", () => {
      if (this.#selectedFormationId) this.#issue("formation_retreat", { formationId: this.#selectedFormationId });
    });

    for (const [element, formationTypeId] of [
      [this.#elements.line, "line"], [this.#elements.column, "column"], [this.#elements.loose, "loose"]
    ]) {
      control(element, "pointerdown", () => {
        if (this.#selectedFormationId) this.#issue("formation_set_type", { formationId: this.#selectedFormationId, formationTypeId });
      });
    }

    for (const [element, scale] of [
      [this.#elements.time0, 0], [this.#elements.time025, 0.25], [this.#elements.time05, 0.5], [this.#elements.time1, 1]
    ]) control(element, "pointerdown", () => this.#runtime.setTimeScale(scale));

    this.#listen(this.#elements.friendlyFormation, "change", (event) => {
      this.#selectedFormationId = event.target.value || null;
    });
    this.#listen(this.#elements.enemyFormation, "change", (event) => {
      this.#selectedEnemyFormationId = event.target.value || null;
    });

    const stick = this.#elements.virtualStick;
    this.#listen(stick, "pointerdown", (event) => {
      stopEvent(event);
      try { stick.setPointerCapture(event.pointerId); } catch {}
      this.#activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY, stick: true });
      this.#updateStick(event);
    });
    this.#listen(stick, "pointermove", (event) => {
      if (!this.#activePointers.get(event.pointerId)?.stick) return;
      stopEvent(event);
      this.#updateStick(event);
    });
    const finishStick = (event) => {
      if (!this.#activePointers.get(event.pointerId)?.stick) return;
      stopEvent(event);
      this.#activePointers.delete(event.pointerId);
      this.#virtualStick = { x: 0, z: 0 };
      if (this.#camera.mode === "third_person") this.#queueMove(this.#virtualStick);
      this.#observe();
    };
    this.#listen(stick, "pointerup", finishStick);
    this.#listen(stick, "pointercancel", (event) => {
      finishStick(event);
      this.resetInputContext({ enqueueReleases: true });
    });
  }

  #updateStick(event) {
    const rect = this.#elements.virtualStick.getBoundingClientRect();
    const x = (event.clientX - (rect.left + rect.width / 2)) / Math.max(1, rect.width / 2);
    const z = -((event.clientY - (rect.top + rect.height / 2)) / Math.max(1, rect.height / 2));
    const magnitude = Math.hypot(x, z);
    this.#virtualStick = magnitude > 1 ? { x: x / magnitude, z: z / magnitude } : { x, z };
    if (this.#camera.mode === "third_person") this.#queueMove(this.#virtualStick);
    else this.#camera.pan(this.#virtualStick.x * 0.5, this.#virtualStick.z * 0.5);
    this.#observe();
  }

  dispose() {
    if (this.#disposed) return;
    this.resetInputContext({ enqueueReleases: true });
    for (const { target, type, handler, options } of this.#listeners.splice(0)) {
      target.removeEventListener(type, handler, options);
    }
    this.#activePointers.clear();
    this.#disposed = true;
    this.#diagnostics.setControlObservation({
      cameraMode: "disposed",
      inputContextRevision: this.#inputContextRevision,
      activePointerCount: 0,
      inputListenerCount: 0
    });
  }
}
