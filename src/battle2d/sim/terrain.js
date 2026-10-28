// Battle map: a grid of terrain cells, height rules, line of sight and map generation.
import { TERRAIN_TYPES } from './terrain-types.js';

const OUTSIDE_CELL = Object.freeze({ type: 'plain', obs: false, h: 0 });

// One shared, frozen description per terrain type, so looking a cell up never allocates.
const CELL_INFO = {};
for (const [type, definition] of Object.entries(TERRAIN_TYPES)) {
  CELL_INFO[type] = Object.freeze({ type, ...definition });
}

function cellInfo(type) {
  return CELL_INFO[type] || Object.freeze({ type, obs: false, h: 0 });
}

class PerlinNoise {
  // seed is a number in [0, 1); the permutation table is shuffled with a small LCG.
  constructor(seed) {
    this.p = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) perm[i] = i;
    let s = seed * 10000;
    for (let i = 255; i > 0; i -= 1) {
      s = (s * 9301 + 49297) % 233280;
      const j = Math.floor((s / 233280) * (i + 1));
      const swap = perm[i];
      perm[i] = perm[j];
      perm[j] = swap;
    }
    for (let i = 0; i < 512; i += 1) this.p[i] = perm[i & 255];
  }

  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  lerp(t, a, b) {
    return a + t * (b - a);
  }

  grad(hash, x, y) {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  get(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const u = this.fade(fx);
    const v = this.fade(fy);
    const A = this.p[X] + Y;
    const B = this.p[X + 1] + Y;
    return this.lerp(v,
      this.lerp(u, this.grad(this.p[A], fx, fy), this.grad(this.p[B], fx - 1, fy)),
      this.lerp(u, this.grad(this.p[A + 1], fx, fy - 1), this.grad(this.p[B + 1], fx - 1, fy - 1)));
  }
}

export class Terrain {
  constructor(width, height, cellSize) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.grid = [];
    this.fillPlain();
  }

  fillPlain() {
    this.grid = [];
    for (let r = 0; r < this.rows; r += 1) {
      const row = [];
      for (let c = 0; c < this.cols; c += 1) row.push({ type: 'plain' });
      this.grid.push(row);
    }
  }

  // The hand-made campaign map: forest, a ridge, a plateau and a wall with two gates, laid out on a
  // 40x40 design grid and centred on the (larger) real grid.
  generateFixed() {
    this.fillPlain();
    const rowOffset = Math.floor((this.rows - 40) / 2);
    const colOffset = Math.floor((this.cols - 40) / 2);
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) {
        const origR = r - rowOffset;
        const origC = c - colOffset;
        let type = 'plain';
        if (origR >= 4 && origR <= 16 && origC >= 4 && origC <= 16) type = 'forest';
        const isRidge = origC >= 12 && origC <= 38 && origR === Math.floor(24 + Math.sin(origC * 0.3) * 5);
        if (isRidge && origC !== 25) type = 'hill';
        if (origR >= 10 && origR <= 40 && origC >= 38 && origC <= 48) {
          type = (origR === 10 || origR === 40 || origC === 38 || origC === 48) ? 'cliff' : 'highland';
        }
        if (origC === 25 && origR >= 5 && origR <= 45) {
          const isGate = (origR >= 22 && origR <= 24) || (origR >= 26 && origR <= 28);
          type = isGate ? 'stairs' : 'wall';
        }
        this.grid[r][c].type = type;
      }
    }
  }

  // The practice map: noise-based hills, cliffs and forest in one of three themes.
  // random is the battle's seeded generator, so a seed always gives the same map.
  generateRandom(random) {
    this.fillPlain();
    const elevationNoise = new PerlinNoise(random.next());
    const forestNoise = new PerlinNoise(random.next());
    const themes = ['forest', 'mountain', 'plains'];
    const theme = themes[Math.floor(random.next() * themes.length)];
    let elevationThreshold = 0.55;
    let forestThreshold = 0.55;
    if (theme === 'forest') {
      elevationThreshold = 0.80;
      forestThreshold = 0.3;
    } else if (theme === 'mountain') {
      elevationThreshold = 0.35;
      forestThreshold = 0.80;
    }
    this.theme = theme;
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) {
        const elevation = elevationNoise.get(c * 0.08, r * 0.08) + 0.3 * elevationNoise.get(c * 0.2, r * 0.2);
        const forest = forestNoise.get(c * 0.1, r * 0.1);
        const isEdgeZone = c < 8 || c > this.cols - 8;
        const distanceToCenter = Math.hypot(c - this.cols / 2, r - this.rows / 2);
        const centerSoften = Math.max(0, 1 - distanceToCenter / 8) * 0.15;
        if (isEdgeZone) continue;
        const finalElevation = elevation - centerSoften;
        const finalForest = forest - centerSoften;
        let type = 'plain';
        if (finalElevation > elevationThreshold + 0.22) type = 'highland';
        else if (finalElevation > elevationThreshold + 0.12) type = 'cliff';
        else if (finalElevation > elevationThreshold) type = 'hill';
        else if (finalForest > forestThreshold) type = 'forest';
        this.grid[r][c].type = type;
      }
    }
    // Some cliffs are opened into hill paths so a ridge is never a perfect wall.
    const pathNoise = new PerlinNoise(random.next());
    for (let r = 2; r < this.rows - 2; r += 1) {
      for (let c = 2; c < this.cols - 2; c += 1) {
        if (this.grid[r][c].type === 'cliff' && pathNoise.get(c * 0.15, r * 0.15) > 0.6) {
          this.grid[r][c].type = 'hill';
        }
      }
    }
  }

  getCR(x, y) {
    return {
      c: Math.floor((x + this.width / 2) / this.cellSize),
      r: Math.floor((y + this.height / 2) / this.cellSize),
    };
  }

  inGrid(c, r) {
    return c >= 0 && c < this.cols && r >= 0 && r < this.rows;
  }

  getAt(x, y) {
    const { c, r } = this.getCR(x, y);
    if (!this.inGrid(c, r)) return OUTSIDE_CELL;
    return cellInfo(this.grid[r][c].type);
  }

  canMoveTo(x1, y1, x2, y2) {
    const from = this.getAt(x1, y1);
    const to = this.getAt(x2, y2);
    if (to.obs) return false;
    const heightDifference = Math.abs(to.h - from.h);
    if (heightDifference > 1 && from.type !== 'stairs' && to.type !== 'stairs') return false;
    return true;
  }

  // Line of sight: an obstacle at least as high as the observer's cell blocks it.
  raycast(x1, y1, x2, y2) {
    const from = this.getCR(x1, y1);
    const to = this.getCR(x2, y2);
    const dx = Math.abs(to.c - from.c);
    const sx = from.c < to.c ? 1 : -1;
    const dy = -Math.abs(to.r - from.r);
    const sy = from.r < to.r ? 1 : -1;
    let err = dx + dy;
    let c = from.c;
    let r = from.r;
    const observerHeight = this.getAt(x1, y1).h;
    for (;;) {
      if (this.inGrid(c, r)) {
        const cell = cellInfo(this.grid[r][c].type);
        if (cell.obs && cell.h >= observerHeight) return false;
      }
      if (c === to.c && r === to.r) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        c += sx;
      }
      if (e2 <= dx) {
        err += dx;
        r += sy;
      }
    }
    return true;
  }

  // The nearest point that is not an obstacle. Soldiers placed inside a wall or cliff could never
  // step out of it (every neighbour is more than one level lower), so deployment moves them first.
  nearestOpenPoint(x, y) {
    if (!this.getAt(x, y).obs) return { x, y };
    const step = this.cellSize;
    for (let ring = 1; ring <= 12; ring += 1) {
      let best = null;
      let bestDistance = Infinity;
      for (let i = -ring; i <= ring; i += 1) {
        for (let j = -ring; j <= ring; j += 1) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
          const px = x + i * step;
          const py = y + j * step;
          if (this.getAt(px, py).obs) continue;
          const distance = Math.hypot(i, j);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = { x: px, y: py };
          }
        }
      }
      if (best) return best;
    }
    return { x, y };
  }
}

// kind: 'random' (practice map), 'fixed' (campaign map) or 'flat' (all plain, used by tests).
export function createTerrain({ kind, random, width = 6000, height = 6000, cellSize = 40 }) {
  const terrain = new Terrain(width, height, cellSize);
  if (kind === 'random') terrain.generateRandom(random);
  else if (kind === 'fixed') terrain.generateFixed();
  return terrain;
}
