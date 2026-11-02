// Morale in the 3D battle (m2/M2_MoraleSystem.js): losses weigh on a formation for as long as they stand, so
// a beaten side breaks and runs before it is wiped out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isM2UnitAlive } from '../../m2/M2_BattleState.js';
import { battle, tick, attack, members } from './m2-sim-helpers.mjs';

const kill = (u) => { u.hp = 0; u.state = 'incapacitated'; };

test('[m2.morale.losses-weigh] a formation that has lost men stays shaken, not just for the moment they fall', () => {
  const run = (losses) => {
    const b = battle();
    tick(b);
    const line = members(b, 'ally_column');
    // Ordinary men, not the commander (losing him is a weight of its own).
    const commander = b.state.getFormation('ally_column').commanderUnitId;
    for (const u of line.filter((x) => x.unitId !== commander).slice(0, losses)) kill(u);
    // Long after the deaths (their moment's shock has passed).
    for (let i = 0; i < 200; i += 1) tick(b);
    const survivors = line.filter(isM2UnitAlive);
    return survivors.reduce((s, u) => s + u.morale, 0) / survivors.length;
  };
  const whole = run(0);
  const half = run(3);
  assert.ok(whole - half >= 10, `whole ${whole}, after losing three of seven ${half}`);
});

test('[m2.morale.side-breaks] a beaten side breaks and runs before it is wiped out, and the battle ends in a retreat', () => {
  for (const orders of [[['ally_line', 'enemy_line']], [['ally_line', 'enemy_line'], ['ally_column', 'enemy_loose'], ['ally_loose', 'enemy_column']]]) {
    const b = battle({ withAI: true });
    for (const [f, t] of orders) attack(b, f, t);
    // How many of each side were running at once, at most (the pursuers may cut some down after: M2_Pursuit.js).
    const ran = { ally: 0, enemy: 0 };
    let i = 0;
    for (; i < 20 * 600 && !b.outcome; i += 1) {
      tick(b);
      for (const side of ['ally', 'enemy']) {
        ran[side] = Math.max(ran[side], b.state.getUnitIdsStable().map((id) => b.state.getUnit(id)).filter((u) => u.sideId === side && isM2UnitAlive(u) && u.state === 'routing').length);
      }
    }
    const loser = b.outcome === 'ally_retreat' ? 'ally' : b.outcome === 'enemy_retreat' ? 'enemy' : null;
    assert.ok(loser, `${b.outcome} after ${i / 20} s`);
    assert.ok(ran[loser] >= 4, `${ran[loser]} of 20 ran`);
    // Still about a minute of fighting first (the owner's choice, 2026-11-01).
    assert.ok(i / 20 >= 45, `ended after ${i / 20} s`);
  }
});
