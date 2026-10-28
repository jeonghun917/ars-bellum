function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// How far each view may tilt and zoom. The tactical view starts high and far enough back to show both
// 20-man armies; each view keeps its own tilt and zoom, so switching back returns to where it was.
const LIMITS = Object.freeze({
  third_person: Object.freeze({ pitch: [-0.9, -0.12], distance: [3.5, 14] }),
  tactical: Object.freeze({ pitch: [-1.3, -0.55], distance: [10, 44] })
});

export class M2CameraController {
  #mode = "third_person";
  #heading = 0;
  #pitch = -0.38;
  #distance = 8.5;
  #heightOffset = 1.55;
  #center = { x: 0, z: 0 };
  #saved = { third_person: { pitch: -0.38, distance: 8.5 }, tactical: { pitch: -0.98, distance: 26 } };
  #disposed = false;

  get mode() { return this.#disposed ? "disposed" : this.#mode; }

  switchMode(mode, playerPosition = null) {
    if (this.#disposed || !["third_person", "tactical"].includes(mode)) return false;
    this.#saved[this.#mode] = { pitch: this.#pitch, distance: this.#distance };
    this.#mode = mode;
    if (mode === "tactical" && playerPosition) this.#center = { x: playerPosition.x, z: playerPosition.z };
    const limits = LIMITS[mode];
    this.#pitch = clamp(this.#saved[mode].pitch, ...limits.pitch);
    this.#distance = clamp(this.#saved[mode].distance, ...limits.distance);
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

  zoom(delta) {
    if (this.#disposed) return;
    this.#distance = clamp(this.#distance + (Number(delta) || 0), ...LIMITS[this.#mode].distance);
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
