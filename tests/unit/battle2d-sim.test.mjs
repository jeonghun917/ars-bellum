// Headless checks of the 2D battle's soldiers and engine (src/battle2d/sim). No browser, no DOM.
// Each test title starts with its check id; the ids are listed in tests/checks.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from '../../src/battle2d/sim/battle.js';
import { statsFor } from '../../src/battle2d/sim/unit-stats.js';
import {
  squad, flatTerrain, paint, engineOn, duel,
} from '../support/battle2d-fixtures.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('[battle2d.sim.dead-cannot-strike] a soldier already dead this frame deals no damage', () => {
  const { engine, a, b, u1, u2 } = duel();
  u2.hp = 0;
  const before = u1.hp;
  engine.update([a, b], 0.016);
  assert.equal(u1.hp, before);
});

test('[battle2d.sim.killed-cannot-strike-back] a soldier killed by a blow does not strike back in the same exchange', () => {
  const { engine, a, b, u1, u2 } = duel();
  u2.hp = 1;
  u1.dmg = 1000;
  const before = u1.hp;
  engine.update([a, b], 0.016);
  assert.ok(u2.hp <= 0, 'the blow lands');
  assert.equal(u1.hp, before);
});

test('[battle2d.sim.trade-blows] two living soldiers in reach both strike', () => {
  const { engine, a, b, u1, u2 } = duel();
  const [h1, h2] = [u1.hp, u2.hp];
  engine.update([a, b], 0.016);
  assert.ok(u1.hp < h1 && u2.hp < h2);
});

test('[battle2d.sim.dead-cannot-charge] a dead rider deals no charge damage', () => {
  const riders = squad('ally', 'light_cav', 100, 100);
  const victims = squad('enemy', 'shock', 110, 100);
  riders.momentum = 80;
  const [rider, victim] = [riders.units[0], victims.units[0]];
  rider.attackCooldown = 5;
  victim.attackCooldown = 5;
  rider.hp = 0;
  const before = victim.hp;
  engineOn().update([riders, victims], 0.016);
  assert.equal(victim.hp, before);
});

test('[battle2d.sim.cavalry-charge] a charging horseman hits for 15 (x1.5 in a wedge), costs momentum and morale, and needs speed', () => {
  const setup = (formation, momentum) => {
    const riders = squad('ally', 'light_cav', 100, 100);
    const victims = squad('enemy', 'shock', 110, 100);
    riders.momentum = momentum;
    riders.currentFormation = formation;
    riders.units[0].attackCooldown = 5;
    victims.units[0].attackCooldown = 5;
    engineOn().update([riders, victims], 0.016);
    return { riders, victims, victim: victims.units[0] };
  };
  const plain = setup('line', 50);
  assert.equal(plain.victim.hp, 55 - 15);
  assert.equal(plain.victims.morale, 98);
  assert.equal(plain.riders.momentum, 50 - 1.5 * 0.5, 'momentum drops by half the victim mass');
  assert.equal(setup('wedge', 50).victim.hp, 55 - 22.5);
  assert.equal(setup('line', 20).victim.hp, 55, 'momentum of 20 or less is not a charge');
});

test('[battle2d.sim.shield-blocks-front] a shield takes 80% off blows from its front and none from behind', () => {
  const blow = (attackerX) => {
    const wall = squad('enemy', 'shield', 100, 100);
    const raiders = squad('ally', 'shock', attackerX, 100);
    wall.angle = 0;
    wall.units[0].attackCooldown = 5;
    raiders.units[0].dmg = 20;
    const before = wall.units[0].hp;
    engineOn().update([wall, raiders], 0.016);
    return before - wall.units[0].hp;
  };
  near(blow(110), (20 - 8) * 0.2);
  near(blow(90), 20 - 8);
});

test('[battle2d.sim.pike-stops-light-cavalry] light cavalry near a pike phalanx slows to a tenth and loses its momentum', () => {
  const advance = (pikeFormation) => {
    const riders = squad('ally', 'light_cav', 0, 0);
    const pikes = squad('enemy', 'pike', 100, 0);
    pikes.currentFormation = pikeFormation;
    riders.targetSquad = pikes;
    riders.momentum = 100;
    const rider = riders.units[0];
    rider.update(0, 0, 0.1, null, false);
    return { moved: Math.hypot(rider.x, rider.y), momentum: riders.momentum };
  };
  const wall = advance('phalanx');
  const open = advance('line');
  assert.ok(Math.abs(wall.moved - open.moved / 10) < 1e-9);
  assert.equal(wall.momentum, 0);
  assert.equal(open.momentum, 100);
});

test('[battle2d.sim.ranged-height-bonus] archers on higher ground reach further and hit harder', () => {
  const shoot = (withHill) => {
    const terrain = flatTerrain();
    if (withHill) paint(terrain, 0, 0, 'hill');
    const bowmen = squad('ally', 'archer', 0, 0);
    const target = squad('enemy', 'shock', 270, 0);
    engineOn(terrain).update([bowmen, target], 0.016);
    return 55 - target.units[0].hp;
  };
  assert.equal(shoot(false), 0, '270 is beyond the base range of 250');
  assert.equal(shoot(true), (8 - 3) * 1.5, 'one level up: range 300 and +50% damage');
});

test('[battle2d.sim.ranged-ammo] a bowman stops shooting when the ammo runs out', () => {
  const bowmen = squad('ally', 'archer', 0, 0);
  const target = squad('enemy', 'shield', 100, 0);
  target.units[0].hp = 10000;
  const archer = bowmen.units[0];
  archer.ammo = 2;
  const engine = engineOn(flatTerrain());
  for (let i = 0; i < 5; i += 1) {
    archer.attackCooldown = 0;
    engine.update([bowmen, target], 0.016);
  }
  assert.equal(archer.ammo, 0);
  assert.equal(10000 - target.units[0].hp, 2, 'exactly two arrows landed, one point each against full armor');
});

test('[battle2d.sim.ranged-needs-line-of-sight] a wall between archer and target stops the arrows', () => {
  const shoot = (blocked) => {
    const terrain = flatTerrain();
    if (blocked) paint(terrain, 75, 0, 'wall');
    const bowmen = squad('ally', 'archer', 0, 0);
    const target = squad('enemy', 'shock', 150, 0);
    engineOn(terrain).update([bowmen, target], 0.016);
    return 55 - target.units[0].hp;
  };
  assert.ok(shoot(false) > 0);
  assert.equal(shoot(true), 0);
});

test('[battle2d.sim.deploy-no-combat] nobody shoots, charges or strikes while the armies deploy', () => {
  const bowmen = squad('ally', 'archer', 0, 0);
  const riders = squad('ally', 'light_cav', 100, 100);
  const victims = squad('enemy', 'shock', 110, 100);
  riders.momentum = 80;
  const target = squad('enemy', 'shock', 100, 0);
  engineOn(flatTerrain()).update([bowmen, riders, victims, target], 0.016, false);
  assert.equal(victims.units[0].hp, 55);
  assert.equal(target.units[0].hp, 55);
  assert.equal(riders.units[0].hp, 45);
});

test('[battle2d.sim.vision-line-of-sight] an enemy is seen only inside an ally squad\'s sight range and with a clear line', () => {
  const seen = (enemyX, wallAt) => {
    const terrain = flatTerrain();
    if (wallAt !== undefined) paint(terrain, wallAt, 0, 'wall');
    const ally = squad('ally', 'shock', 0, 0);
    const enemy = squad('enemy', 'shock', enemyX, 0);
    engineOn(terrain).updateVision([ally, enemy]);
    return enemy.visible;
  };
  assert.equal(seen(200), true);
  assert.equal(seen(300), false, 'beyond 250');
  assert.equal(seen(200, 100), false, 'a wall in the way');
});

test('[battle2d.sim.pike-crossbow-fielded] larger armies field pikes and crossbowmen with their own stats', () => {
  const battle = createBattle({ seed: 3, mode: 'practice', allyStrength: 2, enemyStrength: 2, options: { terrain: 'flat' } });
  const kinds = new Set(battle.allSquads.map((s) => s.subType));
  assert.ok(kinds.has('pike') && kinds.has('crossbow'));
  const crossbow = battle.allSquads.find((s) => s.subType === 'crossbow').units[0];
  assert.deepEqual([crossbow.ammo, crossbow.rangedDmg, crossbow.armorPierce], [15, 12, 0.8]);
  assert.equal(battle.allSquads.find((s) => s.subType === 'pike').units[0].hp, statsFor('pike').hp);
  assert.equal(battle.allSquads.length, 24);
});

test('[battle2d.sim.strength-sets-army-size] strength 1 is the six original squads, 0 is none, and explicit lists win', () => {
  const count = (options) => createBattle({ seed: 1, mode: 'practice', ...options, options: { terrain: 'flat', ...options.options } }).allSquads
    .filter((s) => s.team === 'enemy').length;
  assert.equal(count({ enemyStrength: 1 }), 6);
  assert.equal(count({ enemyStrength: 0.5 }), 3);
  assert.equal(count({ enemyStrength: 0 }), 0);
  assert.equal(count({ enemyStrength: 1, options: { enemySquads: ['pike'] } }), 1);
  assert.throws(() => createBattle({ seed: 1, mode: 'practice', options: { enemySquads: ['dragon'] } }), /unknown squad kind/);
  assert.throws(() => createBattle({ seed: 'x', mode: 'practice' }), /seed/);
});

test('[battle2d.sim.spawn-not-in-wall] no soldier starts inside a wall or cliff, and the campaign enemy can move', () => {
  const battle = createBattle({ seed: 5, mode: 'campaign', allyStrength: 1, enemyStrength: 1 });
  for (const squadOfBattle of battle.allSquads) {
    assert.equal(battle.terrain.getAt(squadOfBattle.x, squadOfBattle.y).obs, false, `${squadOfBattle.id} anchor`);
    for (const unit of squadOfBattle.units) assert.equal(battle.terrain.getAt(unit.x, unit.y).obs, false, `${squadOfBattle.id} soldier`);
  }
  const front = battle.allSquads.find((s) => s.team === 'enemy' && s.subType === 'shield');
  const startX = front.x;
  battle.beginBattle();
  for (let i = 0; i < 600; i += 1) battle.step(1 / 60);
  assert.ok(Math.abs(front.x - startX) > 20, 'the enemy front squad advances');
});

test('[battle2d.sim.practice-map-seeded] the practice map is made from the seed: same seed same map, other seed other map', () => {
  const grid = (seed) => createBattle({ seed, mode: 'practice', allyStrength: 0, enemyStrength: 0 }).terrain.grid.map((row) => row.map((cell) => cell.type[0]).join('')).join('/');
  assert.equal(grid(11), grid(11));
  assert.notEqual(grid(11), grid(12));
});
