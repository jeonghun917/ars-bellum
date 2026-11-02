function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// How far each view may tilt, and how far it stands from what it looks at. There is no zoom (the owner,
// 2026-11-02): the view behind the player stands as close as it used to be allowed (3.5 m), the tactical view
// high and far enough back to show both armies. Each view keeps its own tilt, so switching back returns to it.
const LIMITS = Object.freeze({
  third_person: Object.freeze({ pitch: [-0.9, -0.12], distance: 3.5 }),
  tactical: Object.freeze({ pitch: [-1.3, -0.55], distance: 26 })
});

export class M2CameraController {
  #mode = "third_person";
  #heading = 0;
  #pitch = -0.38;
  #distance = LIMITS.third_person.distance;
  #heightOffset = 1.55;
  #center = { x: 0, z: 0 };
  #saved = { third_person: { pitch: -0.38 }, tactical: { pitch: -0.98 } };
  #disposed = false;

  get mode() { return this.#disposed ? "disposed" : this.#mode; }

  switchMode(mode, playerPosition = null) {
    if (this.#disposed || !["third_person", "tactical"].includes(mode)) return false;
    this.#saved[this.#mode] = { pitch: this.#pitch };
    this.#mode = mode;
    if (mode === "tactical" && playerPosition) this.#center = { x: playerPosition.x, z: playerPosition.z };
    const limits = LIMITS[mode];
    this.#pitch = clamp(this.#saved[mode].pitch, ...limits.pitch);
    this.#distance = limits.distance;
    return true;
  }

  toggle(playerPosition = null) {
    return this.switchMode(this.#mode === "third_person" ? "tactical" : "third_person", playerPosition);
  }

  rotate(deltaHeading, deltaPitch) {
    if (this.#disposed) return;
    this.#heading += Number(deltaHeading) || 0;
    this.#pitch += Number(deltaPitch) || 0;
    this.#pitch = clamp(this.#pitch, ...LIMITS[this.#mode].pitch);
  }

  pan(x, z) {
    if (this.#disposed || this.#mode !== "tactical") return;
    this.#center.x += Number(x) || 0;
    this.#center.z += Number(z) || 0;
  }

  getPose(renderSnapshot, interpolationAlpha = 1) {
    if (this.#disposed) return null;
    const playerUnit = renderSnapshot?.units?.find((unit) => unit.unitId === renderSnapshot.playerUnitId) || null;
    const alpha = Math.max(0, Math.min(1, Number(interpolationAlpha) || 0));
    const player = playerUnit ? {
      x: playerUnit.previousPosition.x + (playerUnit.position.x - playerUnit.previousPosition.x) * alpha,
      y: playerUnit.previousPosition.y + (playerUnit.position.y - playerUnit.previousPosition.y) * alpha,
      z: playerUnit.previousPosition.z + (playerUnit.position.z - playerUnit.previousPosition.z) * alpha
    } : (renderSnapshot?.playerPosition || { x: 0, y: 0, z: 0 });
    const target = this.#mode === "third_person"
      ? { x: player.x, y: (player.y || 0) + this.#heightOffset, z: player.z }
      : { x: this.#center.x, y: 0.3, z: this.#center.z };

    const horizontal = Math.cos(this.#pitch) * this.#distance;
    const vertical = -Math.sin(this.#pitch) * this.#distance;
    const x = target.x - Math.sin(this.#heading) * horizontal;
    const z = target.z - Math.cos(this.#heading) * horizontal;
    return Object.freeze({
      mode: this.#mode,
      position: Object.freeze({ x, y: Math.max(0.75, target.y + vertical), z }),
      target: Object.freeze(target),
      heading: this.#heading,
      pitch: this.#pitch,
      distance: this.#distance
    });
  }

  getSnapshot() {
    return Object.freeze({
      mode: this.mode,
      heading: this.#heading,
      pitch: this.#pitch,
      distance: this.#distance,
      heightOffset: this.#heightOffset,
      center: Object.freeze({ ...this.#center })
    });
  }

  dispose() {
    this.#disposed = true;
  }
}
