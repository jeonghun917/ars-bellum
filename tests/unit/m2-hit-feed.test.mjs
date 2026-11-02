// What befell the player's blows and the blows at him, for the note at the top of the screen
// (m2/M2_CombatSystem.js getPlayerFeed; the owner, 2026-11-02: he could not tell whether his blows landed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { battle, tick, members } from './m2-sim-helpers.mjs';

const put = (u, x, z) => { u.position = { x, y: 0, z }; u.previousPosition = { ...u.position }; u.slotTarget = { x, z }; };

// The hero with one enemy soldier a metre in front of him, everyone else far off.
function duel() {
  const b = battle();
  const hero = b.state.getUnit(b.state.playerCharacterId);
  const foe = members(b, 'enemy_line').find((u) => !u.commander);
  b.state.getUnitIdsStable().map((id) => b.state.getUnit(id)).forEach((u, i) => { if (u !== hero && u !== foe) put(u, 300 + i * 4, 300); });
  b.formation.updateSlots = () => {};
  put(hero, 0, 0);
  hero.heading = 0;
  put(foe, 0, 1);
  foe.heading = Math.PI;
  b.grid.rebuild(b.state);
  return { b, hero, foe };
}
let seq = 0;
const swing = (b, hero, aimHeading = 0) => b.queue.enqueue({ commandId: `swing_${seq += 1}`, type: 'player_melee_attack', actorUnitId: hero.unitId, aimHeading }, b.state);

test('[m2.feed.player-blows] each swing of the player is noted: a hit with the damage done, stopped, or at nobody', () => {
  const { b, hero, foe } = duel();
  foe.attackCooldownTicks = 9999;
  const seen = new Set();
  for (let i = 0; i < 30 && !(seen.has('hit') && seen.has('stopped')); i += 1) {
    hero.attackCooldownTicks = 0;
    foe.attackCooldownTicks = 9999;
    const hp = foe.hp;
    swing(b, hero);
    tick(b);
    const feed = b.combat.getPlayerFeed();
    assert.equal(feed.length, 1, JSON.stringify(feed));
    const [note] = feed;
    seen.add(note.kind);
    assert.equal(note.unitId, foe.unitId);
    if (note.kind === 'hit') assert.ok(Math.abs(note.damage - (hp - foe.hp)) < 1e-9 && note.damage > 0, JSON.stringify({ note, hp, now: foe.hp }));
    else assert.equal(note.kind, 'stopped');
    if (foe.hp < 60) foe.hp = foe.maxHp;
  }
  assert.ok(seen.has('hit') && seen.has('stopped'), [...seen].join());
  // Turned away from him, the swing reaches nobody.
  hero.attackCooldownTicks = 0;
  swing(b, hero, Math.PI);
  tick(b);
  assert.deepEqual(b.combat.getPlayerFeed(), [{ kind: 'miss' }]);
  // A tick with no blow notes nothing.
  tick(b);
  assert.deepEqual(b.combat.getPlayerFeed(), []);
});

test('[m2.feed.blows-at-him] a blow at the player is noted with the damage he took', () => {
  const { b, hero, foe } = duel();
  hero.attackCooldownTicks = 9999;
  const hp = hero.hp;
  let note = null;
  for (let i = 0; i < 200 && !note; i += 1) {
    hero.attackCooldownTicks = 9999;
    tick(b);
    note = b.combat.getPlayerFeed().find((entry) => entry.kind === 'struck') || null;
  }
  assert.ok(note, 'he was struck');
  assert.equal(note.unitId, foe.unitId);
  assert.ok(Math.abs(note.damage - (hp - hero.hp)) < 1e-9 && note.damage > 0, JSON.stringify({ note, hp, now: hero.hp }));
});

test('[m2.feed.blocked] a blow the player takes on his block is noted as blocked, with what got through', () => {
  const { b, hero, foe } = duel();
  const hp = hero.hp;
  let note = null;
  for (let i = 0; i < 200 && !note; i += 1) {
    hero.attackCooldownTicks = 9999;
    // Blocking, facing him.
    hero.blocking = true;
    hero.heading = 0;
    tick(b);
    note = b.combat.getPlayerFeed().find((entry) => entry.kind === 'blocked' || entry.kind === 'struck') || null;
  }
  assert.equal(note?.kind, 'blocked', JSON.stringify(note));
  assert.equal(note.unitId, foe.unitId);
  assert.ok(Math.abs(note.damage - (hp - hero.hp)) < 1e-9, JSON.stringify({ note, hp, now: hero.hp }));
});
