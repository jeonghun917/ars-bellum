// Small builders for the 2D battle's headless tests: squads of a few soldiers on a flat map,
// with a "random" source that always answers 0.5 so positions and cooldowns are exact.
import { Squad } from '../../src/battle2d/sim/squad.js';
import { Terrain } from '../../src/battle2d/sim/terrain.js';
import { Battle } from '../../src/battle2d/sim/battle.js';
import { BattleEngine } from '../../src/battle2d/sim/engine.js';

export const half = { next: () => 0.5 };

let counter = 0;

// A squad of `soldiers` soldiers standing exactly on (x, y) (no starting jitter with the 0.5 source).
export function squad(team, subType, x, y, soldiers = 1) {
  counter += 1;
  return new Squad({ id: `${team}-${subType}-${counter}`, name: `${team} ${subType}`, team, subType, x, y, soldiers }, half);
}

// A flat map; the centre of the world is (0, 0) and each cell is 40 wide.
export function flatTerrain(size = 1200) {
  return new Terrain(size, size, 40);
}

// Puts a terrain type on the cell that contains the world point (x, y).
export function paint(terrain, x, y, type) {
  const { c, r } = terrain.getCR(x, y);
  terrain.grid[r][c].type = type;
}

export function engineOn(terrain = null) {
  return new BattleEngine({ random: half, terrain });
}

export function battleOf(squads, { terrain = flatTerrain(), random = half, economy = null } = {}) {
  return new Battle({ random, terrain, squads, mode: 'practice', economy });
}

// A battle already past deployment.
export function fightingBattle(squads, options) {
  const battle = battleOf(squads, options);
  battle.beginBattle();
  return battle;
}

export function runSeconds(battle, seconds, dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps && !battle.isOver; i += 1) battle.step(dt);
}

export function killAll(squadToKill) {
  for (const unit of squadToKill.units) unit.hp = 0;
}

// Two soldiers of opposing teams standing in reach of each other, both ready to strike.
export function duel(subType = 'shock') {
  const a = squad('ally', subType, 100, 100);
  const b = squad('enemy', subType, 110, 100);
  return { engine: engineOn(null), a, b, u1: a.units[0], u2: b.units[0] };
}

// Everything that matters about a battle's state, as text, so two runs can be compared exactly.
export function fingerprint(battle) {
  return JSON.stringify({
    phase: battle.phase,
    elapsed: battle.elapsed,
    random: battle.random.getState ? battle.random.getState() : null,
    squads: battle.allSquads.map((s) => ({
      id: s.id, state: s.state, morale: s.morale, x: s.x, y: s.y, angle: s.angle, momentum: s.momentum,
      units: s.roster.map((u) => [u.x, u.y, u.hp, u.ammo ?? null, u.routed, u.escaped]),
    })),
    result: battle.result,
  });
}
