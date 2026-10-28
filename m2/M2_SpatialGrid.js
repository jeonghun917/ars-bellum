function cellKey(x, z, cellSize) {
  return `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
}

export class M2SpatialGrid {
  #cellSize;
  #cells = new Map();
  #membershipCount = 0;

  constructor(cellSize) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error("m2_spatial_grid_invalid_cell_size");
    this.#cellSize = cellSize;
  }

  rebuild(battleState) {
    this.#cells.clear();
    this.#membershipCount = 0;
    battleState.forEachUnitStable((unit) => {
      const key = cellKey(unit.position.x, unit.position.z, this.#cellSize);
      let members = this.#cells.get(key);
      if (!members) {
        members = [];
        this.#cells.set(key, members);
      }
      members.push(unit.unitId);
      this.#membershipCount += 1;
    });
    for (const members of this.#cells.values()) members.sort();
  }

  queryNearby(x, z, radius) {
    if (![x, z, radius].every(Number.isFinite) || radius < 0) return [];
    const minX = Math.floor((x - radius) / this.#cellSize);
    const maxX = Math.floor((x + radius) / this.#cellSize);
    const minZ = Math.floor((z - radius) / this.#cellSize);
    const maxZ = Math.floor((z + radius) / this.#cellSize);
    const found = new Set();

    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      for (let cellZ = minZ; cellZ <= maxZ; cellZ += 1) {
        for (const unitId of this.#cells.get(`${cellX},${cellZ}`) || []) found.add(unitId);
      }
    }
    return [...found].sort();
  }

  get membershipCount() {
    return this.#membershipCount;
  }

  get cellSize() {
    return this.#cellSize;
  }
}
