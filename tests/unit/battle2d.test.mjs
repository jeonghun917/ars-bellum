// Checks of the 2D battle (BattleEngine.js / Squad.js), loaded as the browser loads them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadBattle() {
  let seed = 1;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const context = vm.createContext({ Math: Object.assign(Object.create(Math), { random }), console });
  for (const file of ['Squad.js', 'BattleEngine.js']) {
    vm.runInContext(fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), context, { filename: file });
  }
  vm.runInContext('this.Squad = Squad; this.BattleEngine = BattleEngine;', context);
  return context;
}

// Two one-soldier infantry squads standing touching each other, both ready to strike.
function duel() {
  const { Squad, BattleEngine } = loadBattle();
  const a = new Squad('a', 'player', 'infantry', 'shock', 1, 100, 100);
  const b = new Squad('b', 'enemy', 'infantry', 'shock', 1, 110, 100);
  a.units = [a.units[0]];
  b.units = [b.units[0]];
  Object.assign(a.units[0], { x: 100, y: 100, attackCooldown: 0 });
  Object.assign(b.units[0], { x: 110, y: 100, attackCooldown: 0 });
  return { engine: new BattleEngine(), a, b, u1: a.units[0], u2: b.units[0], renderer: {} };
}

test('[battle2d.melee.dead-cannot-strike] a soldier already dead this frame deals no damage', () => {
  const { engine, a, b, u1, u2, renderer } = duel();
  u2.hp = 0;
  const before = u1.hp;
  engine.update([a, b], 0.016, renderer, null);
  assert.equal(u1.hp, before);
});

test('[battle2d.melee.killed-cannot-strike-back] a soldier killed by a blow does not strike back in the same exchange', () => {
  const { engine, a, b, u1, u2, renderer } = duel();
  u2.hp = 1;
  u1.dmg = 1000;
  const before = u1.hp;
  engine.update([a, b], 0.016, renderer, null);
  assert.ok(u2.hp <= 0, 'the blow lands');
  assert.equal(u1.hp, before);
});

test('[battle2d.melee.both-alive-trade-blows] two living soldiers in reach both strike', () => {
  const { engine, a, b, u1, u2, renderer } = duel();
  const [h1, h2] = [u1.hp, u2.hp];
  engine.update([a, b], 0.016, renderer, null);
  assert.ok(u1.hp < h1 && u2.hp < h2);
});
