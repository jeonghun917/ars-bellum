import { M2UnitPanel } from "./M2_UnitPanel.js";
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
  // The formations selected (several only in the tactical view), the battalions the player has made of them
  // ({ groupId, name, members }), and the battalion selected, if one is (M2_UnitPanel.js).
  #selected = [];
  #groups = [];
  #selectedGroupId = null;
  #panel = null;
  #disposed = false;
  #canvasGestureMoved = false;
  // The player cleared the selection himself (none is chosen for him again).
  #deselected = false;
  // The player's weapon in hand ("melee" or "bow") and whether his shield is up: both switched with a tap
  // (the owner, 2026-11-02: one button swaps weapon and bow at once; the shield is raised and lowered).
  #weapon = "melee";
  #shieldUp = false;

  constructor({ runtime, cameraController, diagnostics, elements }) {
    this.#runtime = runtime;
    this.#camera = cameraController;
    this.#diagnostics = diagnostics;
    this.#elements = elements;
    this.#panel = new M2UnitPanel(elements.unitPanel || {}, {
      listen: (target, type, handler) => this.#listen(target, type, handler),
      select: (ids) => this.#select(ids),
      selectGroup: (groupId) => this.#selectGroup(groupId),
      attackEnemy: (formationId) => this.#forSelected((id) => this.#issue("formation_attack", { formationId: id, targetFormationId: formationId })),
      command: (name, value) => {
        if (name === "tactic") this.#forSelected((id) => this.#issue("formation_set_tactic", { formationId: id, tacticId: value }));
        if (name === "plan") this.#issue("army_set_plan", { planId: value });
      },
      redraw: () => this.refreshFormationLists()
    });
    this.refreshFormationLists();
    this.#install();
    this.#observe();
  }

  get inputContextRevision() { return this.#inputContextRevision; }
  get activePointerCount() { return this.#activePointers.size; }
  get inputListenerCount() { return this.#listeners.length; }
  get selectedFormationId() { return this.#selected[0] ?? null; }
  get selectedFormationIds() { return [...this.#selected]; }
  get panelOpen() { return Boolean(this.#panel?.open); }
  get groups() { return this.#groups.map((g) => ({ ...g, members: [...g.members] })); }

  // Gives each selected formation an order.
  #forSelected(give) {
    for (const id of this.#selected) give(id);
    this.refreshFormationLists();
  }

  // A tap on a formation's circle: in the tactical view it joins the selection or leaves it; behind the player
  // it is the only one selected (the owner, 2026-11-02: several at once only in the tactical view).
  #select(ids) {
    const [id] = ids;
    if (this.#camera.mode === "tactical") this.#selected = this.#selected.includes(id) ? this.#selected.filter((x) => x !== id) : [...this.#selected, id];
    else this.#selected = [id];
    this.#selectedGroupId = null;
    this.refreshFormationLists();
  }

  #selectGroup(groupId) {
    const group = this.#groups.find((g) => g.groupId === groupId);
    if (!group) return;
    this.#selected = [...group.members];
    this.#selectedGroupId = groupId;
    this.refreshFormationLists();
  }

  // 묶기: the selected formations (two or more) become a battalion, leaving any other they were in.
  #makeGroup() {
    if (this.#selected.length < 2) return;
    this.#groups = this.#groups.map((g) => ({ ...g, members: g.members.filter((id) => !this.#selected.includes(id)) })).filter((g) => g.members.length >= 2);
    let n = 1;
    while (this.#groups.some((g) => g.name === `${n}대대`)) n += 1;
    const group = { groupId: `group_${n}`, name: `${n}대대`, members: [...this.#selected] };
    this.#groups = [...this.#groups, group].sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
    this.#selectedGroupId = group.groupId;
    this.refreshFormationLists();
  }

  #breakGroup() {
    if (!this.#selectedGroupId) return;
    this.#groups = this.#groups.filter((g) => g.groupId !== this.#selectedGroupId);
    this.#selectedGroupId = null;
    this.refreshFormationLists();
  }
  get weapon() { return this.#weapon; }
  get shieldUp() { return this.#shieldUp; }

  // The attack button and J: a swing of the weapon in hand, or an arrow from the bow.
  #attack() {
    const type = this.#weapon === "bow" ? "player_bow_fire" : "player_melee_attack";
    this.#issue(type, { actorUnitId: this.#playerId(), aimHeading: this.#aimHeading() });
  }

  // The weapon button and L: weapon to bow and back, at once (a player without a bow keeps his weapon). With
  // the bow in hand, a circle shows where the arrow will come down (M2_RendererThree.js setAim).
  #switchWeapon() {
    const player = (this.#runtime.getSnapshot()?.units || []).find((unit) => unit.isPlayer);
    const hasBow = Boolean(player?.hero?.ranged);
    this.#weapon = this.#weapon === "bow" || !hasBow ? "melee" : "bow";
    this.#runtime.setAiming?.(this.#weapon === "bow");
    this.#showHands();
  }

  // The shield button and K: up, and down again.
  #toggleShield() {
    this.#shieldUp = !this.#shieldUp;
    this.#queueBlock(this.#shieldUp);
    this.#showHands();
  }

  #showHands() {
    const { bow, block } = this.#elements;
    if (bow) { bow.dataset.weapon = this.#weapon; bow.firstChild.textContent = this.#weapon === "bow" ? "활" : "근접"; }
    if (block) { block.setAttribute("aria-pressed", String(this.#shieldUp)); block.firstChild.textContent = "방패"; }
    this.#observe();
  }

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

  // A stick or keys direction (x right, z up the screen) on the ground, as the camera faces: up the screen is
  // the way the camera looks, right is the screen's right (the owner, 2026-11-02: the stick went by the map's
  // north instead of the view).
  #onGround(vector) {
    const heading = this.#camera.getSnapshot().heading;
    const forward = { x: Math.sin(heading), z: Math.cos(heading) };
    const right = { x: -Math.cos(heading), z: Math.sin(heading) };
    return { x: vector.x * right.x + vector.z * forward.x, z: vector.x * right.z + vector.z * forward.z };
  }

  #queueMove(move) {
    const actorUnitId = this.#playerId();
    if (!actorUnitId) return;
    this.#issue("player_move", { actorUnitId, move: this.#onGround(move) });
  }

  // The direction the stick or the keys hold now (the stick first).
  #heldDirection() {
    return this.#virtualStick.x || this.#virtualStick.z ? this.#virtualStick : keyVector(this.#keys);
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
    if (enqueueReleases) {
      this.#queueMove({ x: 0, z: 0 });
      // The shield stays as he set it (a toggle, not held): sent again in the new context.
      this.#queueBlock(this.#shieldUp);
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

  // The selected formations to a point on the field, each keeping its place relative to the others.
  #moveSelected(target) {
    const formations = (this.#runtime.getSnapshot()?.formations || []).filter((f) => this.#selected.includes(f.formationId));
    if (!formations.length) return;
    const mid = { x: formations.reduce((s, f) => s + f.anchor.x, 0) / formations.length, z: formations.reduce((s, f) => s + f.anchor.z, 0) / formations.length };
    for (const f of formations) this.#issue("formation_move", { formationId: f.formationId, target: { x: target.x + f.anchor.x - mid.x, z: target.z + f.anchor.z - mid.z } });
  }

  // Redraws the formations' row and menu (M2_UnitPanel.js), keeping the selection to formations that exist.
  refreshFormationLists() {
    const snapshot = this.#runtime.getSnapshot();
    if (!snapshot) return;
    const player = snapshot.units.find((unit) => unit.isPlayer);
    const sideId = player?.sideId || "ally";
    const friendly = snapshot.formations.filter((formation) => formation.sideId === sideId).sort((a, b) => a.formationId.localeCompare(b.formationId));
    const exists = (id) => friendly.some((entry) => entry.formationId === id);
    this.#selected = this.#selected.filter(exists);
    this.#groups = this.#groups.map((g) => ({ ...g, members: g.members.filter(exists) })).filter((g) => g.members.length >= 2);
    if (!this.#groups.some((g) => g.groupId === this.#selectedGroupId)) this.#selectedGroupId = null;
    if (!this.#selected.length && !this.#deselected) {
      const first = friendly.find((entry) => entry.formationTypeId === "line") || friendly[0];
      if (first) this.#selected = [first.formationId];
    }
    this.#panel?.draw({ snapshot, selected: this.#selected, groups: this.#groups, selectedGroupId: this.#selectedGroupId, sideId });
    this.#observe();
  }

  #install() {
    const canvas = this.#elements.canvas;
    this.#listen(window, "keydown", (event) => {
      if (event.repeat && ["KeyJ","KeyK","KeyL","Tab","Digit1","Digit2","Digit3","Digit4","Digit5","Digit6"].includes(event.code)) return;
      if (["KeyW","KeyA","KeyS","KeyD"].includes(event.code)) {
        this.#keys.add(event.code);
        const vector = keyVector(this.#keys);
        if (this.#camera.mode === "third_person") this.#queueMove(vector);
        else { const step = this.#onGround(vector); this.#camera.pan(step.x * 0.8, step.z * 0.8); }
        this.#observe();
      } else if (event.code === "KeyJ") {
        this.#attack();
      } else if (event.code === "KeyK") {
        this.#toggleShield();
      } else if (event.code === "KeyL") {
        this.#switchWeapon();
      } else if (event.code === "Tab") {
        stopEvent(event);
        this.switchMode();
      } else if (this.#camera.mode === "tactical" && ["Digit1","Digit2","Digit3","Digit4","Digit5","Digit6"].includes(event.code)) {
        const formationTypeId = { Digit1: "line", Digit2: "column", Digit3: "loose", Digit4: "shield_wall", Digit5: "wedge", Digit6: "circle" }[event.code];
        this.#forSelected((id) => this.#issue("formation_set_type", { formationId: id, formationTypeId }));
      }
    });

    this.#listen(window, "keyup", (event) => {
      if (["KeyW","KeyA","KeyS","KeyD"].includes(event.code)) {
        this.#keys.delete(event.code);
        const vector = keyVector(this.#keys);
        if (this.#camera.mode === "third_person") this.#queueMove(vector);
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

      // A drag turns the view: sideways round, and up the screen tilts it down (the owner, 2026-11-02). There is
      // no zoom (M2_CameraController.js): two fingers on the field (the stick's aside) do nothing.
      if ([...this.#activePointers.values()].filter((p) => !p.stick).length > 1) return;
      this.#camera.rotate(-dx * 0.006, -dy * 0.004);
      // Turning the view turns the way a held stick walks him.
      if (this.#camera.mode === "third_person") {
        const held = this.#heldDirection();
        if (held.x || held.z) this.#queueMove(held);
      }
      this.#observe();
    });

    const finishCanvasPointer = (event, cancelled = false) => {
      const entry = this.#activePointers.get(event.pointerId);
      if (!entry) return;
      stopEvent(event);
      this.#activePointers.delete(event.pointerId);
        if (
        !cancelled &&
        this.#camera.mode === "tactical" &&
        !this.#canvasGestureMoved &&
        this.#selected.length
      ) {
        const target = this.#runtime.screenPointToGround(event.clientX, event.clientY);
        if (target) this.#moveSelected(target);
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
    control(this.#elements.attack, "pointerdown", () => this.#attack());
    control(this.#elements.block, "pointerdown", () => this.#toggleShield());
    control(this.#elements.bow, "pointerdown", () => this.#switchWeapon());
    this.#showHands();
    control(this.#elements.tactical, "pointerdown", () => this.switchMode());
    // 목표 공격 opens the row of enemy formations to pick from (M2_UnitPanel.js).
    control(this.#elements.attackOrder, "pointerdown", () => this.#panel.pickEnemy(true));
    control(this.#elements.holdOrder, "pointerdown", () => this.#forSelected((id) => this.#issue("formation_hold", { formationId: id })));
    control(this.#elements.rally, "pointerdown", () => this.#forSelected((id) => this.#issue("formation_rally", { formationId: id })));
    control(this.#elements.retreat, "pointerdown", () => this.#forSelected((id) => this.#issue("formation_retreat", { formationId: id })));
    control(this.#elements.pursuit, "pointerdown", () => {
      const pursue = this.#elements.pursuit.getAttribute("aria-pressed") !== "true";
      this.#forSelected((id) => this.#issue("formation_set_pursuit", { formationId: id, pursue }));
      // (Shown at once; the battle takes it on its next tick.)
      this.#elements.pursuit.setAttribute("aria-pressed", String(pursue));
      this.#elements.pursuit.textContent = pursue ? "추격: 켬" : "추격: 끔";
    });
    control(this.#elements.deselect, "pointerdown", () => { this.#selected = []; this.#selectedGroupId = null; this.#deselected = true; this.refreshFormationLists(); });
    control(this.#elements.group, "pointerdown", () => this.#makeGroup());
    control(this.#elements.ungroup, "pointerdown", () => this.#breakGroup());

    for (const [element, formationTypeId] of [
      [this.#elements.line, "line"], [this.#elements.column, "column"], [this.#elements.loose, "loose"],
      [this.#elements.shieldWall, "shield_wall"], [this.#elements.wedge, "wedge"], [this.#elements.circle, "circle"]
    ]) {
      control(element, "pointerdown", () => this.#forSelected((id) => this.#issue("formation_set_type", { formationId: id, formationTypeId })));
    }

    for (const [element, scale] of [
      [this.#elements.time0, 0], [this.#elements.time025, 0.25], [this.#elements.time05, 0.5], [this.#elements.time1, 1]
    ]) control(element, "pointerdown", () => this.#runtime.setTimeScale(scale));

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
    else { const step = this.#onGround(this.#virtualStick); this.#camera.pan(step.x * 0.5, step.z * 0.5); }
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
