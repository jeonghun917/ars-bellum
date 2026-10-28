// Headless checks of a whole 2D battle: morale and routing, how it ends, the enemy AI, the player's
// orders, negotiation, and that a seed always replays the same. No browser, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from '../../src/battle2d/sim/battle.js';
import { updateEnemyAi } from '../../src/battle2d/sim/ai.js';
import { parsePlayerOffer } from '../../src/battle2d/sim/diplomacy.js';
import { normalizeAiDialogue, requestLordDialogue } from '../../src/battle2d/sim/lord-dialogue.js';
import {
  squad, flatTerrain, fightingBattle, battleOf, runSeconds, killAll, fingerprint,
} from '../support/battle2d-fixtures.mjs';
import { Terrain } from '../../src/battle2d/sim/terrain.js';

const context = (squads, preparation = false) => ({ terrain: flatTerrain(), squads, preparation });

// ---- Morale and routing ----

test('[battle2d.sim.morale-rout] a first-tier squad breaks when morale falls under 30; sturdier squads never do', () => {
  const lose = (subType, dead) => {
    const group = squad('ally', subType, 0, 0, 12);
    for (let i = 0; i < dead; i += 1) group.units[i].hp = 0;
    group.update(1 / 60, context([group]));
    return group;
  };
  assert.equal(lose('archer', 3).state, 'idle', 'three losses leave morale at 40');
  assert.equal(lose('archer', 3).morale, 40);
  const broken = lose('archer', 4);
  assert.equal(broken.morale, 20);
  assert.equal(broken.state, 'routing');
  assert.ok(broken.units.every((unit) => unit.routed));
  assert.equal(lose('shock', 11).state, 'idle', 'a second-tier squad keeps standing');
});

test('[battle2d.sim.rout-to-edge] routing soldiers run to their own map edge and leave alive, not killed', () => {
  const terrain = new Terrain(600, 600, 40);
  const mine = squad('ally', 'archer', 0, 0, 3);
  const theirs = squad('enemy', 'archer', 0, 100, 3);
  mine.rout();
  theirs.rout();
  const ctx = { terrain, squads: [mine, theirs], preparation: false };
  for (let i = 0; i < 60 * 12 && (mine.units.length || theirs.units.length); i += 1) {
    mine.update(1 / 60, ctx);
    theirs.update(1 / 60, ctx);
  }
  assert.equal(mine.units.length + theirs.units.length, 0, 'everyone reached the edge');
  assert.ok(mine.roster.every((u) => u.escaped && u.routed && !u.killed));
  assert.ok(mine.roster.every((u) => u.x <= -210), 'allies leave on the left');
  assert.ok(theirs.roster.every((u) => u.x >= 210), 'enemies leave on the right');
});

test('[battle2d.sim.dead-do-not-fight-on] soldiers killed during a step are gone from the squad next step', () => {
  const mine = squad('ally', 'shock', 0, 0, 5);
  mine.units[0].hp = 0;
  mine.update(1 / 60, context([mine]));
  assert.equal(mine.units.length, 4);
  assert.equal(mine.roster.length, 5);
  assert.ok(mine.roster[0].killed);
});

// ---- How a battle ends ----

test('[battle2d.sim.outcome-victory] the battle is won when no enemy is left fighting, and the result counts everyone', () => {
  const mine = squad('ally', 'shock', -100, 0, 4);
  const theirs = squad('enemy', 'shock', 100, 0, 4);
  const battle = fightingBattle([mine, theirs]);
  mine.units[0].hp = 0;
  killAll(theirs);
  battle.step(1 / 60);
  assert.equal(battle.phase, 'ended');
  assert.deepEqual(battle.result, {
    outcome: 'victory', enemyRoutedUnits: 0, enemyKilledUnits: 4, allyLostUnits: 1, allySurvivingUnits: 3, lordCaptured: false, diplomacy: null,
  });
});

test('[battle2d.sim.outcome-victory-by-rout] enemies who ran are counted as routed, not killed, and still win the battle', () => {
  const mine = squad('ally', 'shock', -100, 0, 3);
  const theirs = squad('enemy', 'archer', 100, 0, 6);
  const battle = fightingBattle([mine, theirs]);
  theirs.units[0].hp = 0;
  theirs.units[1].hp = 0;
  theirs.rout();
  battle.step(1 / 60);
  assert.equal(battle.result.outcome, 'victory');
  assert.equal(battle.result.enemyKilledUnits, 2);
  assert.equal(battle.result.enemyRoutedUnits, 4);
});

test('[battle2d.sim.outcome-defeat] the battle is lost when no ally is left, and a mutual wipe-out counts as a win', () => {
  const lost = fightingBattle([squad('ally', 'shock', -100, 0, 3), squad('enemy', 'shock', 100, 0, 3)]);
  killAll(lost.squads[0]);
  lost.step(1 / 60);
  assert.equal(lost.result.outcome, 'defeat');
  assert.equal(lost.result.allyLostUnits, 3);
  assert.equal(lost.result.allySurvivingUnits, 0);
  const both = fightingBattle([squad('ally', 'shock', -100, 0, 3), squad('enemy', 'shock', 100, 0, 3)]);
  killAll(both.squads[0]);
  killAll(both.squads[1]);
  both.step(1 / 60);
  assert.equal(both.result.outcome, 'victory');
});

test('[battle2d.sim.outcome-retreat] when the surviving allies are all running, the battle ends as a retreat and they count as survivors', () => {
  const battle = fightingBattle([squad('ally', 'shock', -100, 0, 5), squad('enemy', 'shock', 100, 0, 5)]);
  battle.orderRetreat();
  assert.equal(battle.phase, 'ended');
  assert.equal(battle.result.outcome, 'retreat');
  assert.equal(battle.result.allyLostUnits, 0);
  assert.equal(battle.result.allySurvivingUnits, 5);
  assert.equal(battle.result.lordCaptured, false);
});

test('[battle2d.sim.retreat-while-deploying] a retreat ordered before the fight ends the battle at once, with nobody lost', () => {
  const battle = battleOf([squad('ally', 'shock', -100, 0, 5), squad('enemy', 'shock', 100, 0, 5)]);
  battle.orderRetreat();
  assert.equal(battle.result.outcome, 'retreat');
  assert.equal(battle.result.allySurvivingUnits, 5);
});

test('[battle2d.sim.outcome-surrender] surrender ends the battle at once with the surrender outcome', () => {
  const battle = fightingBattle([squad('ally', 'shock', -100, 0, 5), squad('enemy', 'shock', 100, 0, 5)]);
  const result = battle.surrender();
  assert.equal(result.outcome, 'surrender');
  assert.equal(battle.phase, 'ended');
  assert.equal(result.allySurvivingUnits, 5);
});

test('[battle2d.sim.ends-once] after the end nothing changes the result: steps, orders, surrender and a second finish are ignored', () => {
  const battle = fightingBattle([squad('ally', 'shock', -100, 0, 3), squad('enemy', 'shock', 100, 0, 3)]);
  killAll(battle.squads[1]);
  battle.step(1 / 60);
  const first = battle.result;
  const copy = JSON.stringify(first);
  battle.step(1 / 60);
  battle.surrender();
  battle.orderRetreat();
  battle.tap({ x: 0, y: 0 });
  assert.equal(battle.finish('defeat'), first);
  assert.equal(battle.result, first);
  assert.equal(JSON.stringify(battle.result), copy);
});

test('[battle2d.sim.deploy-ends-nothing] while deploying, a missing enemy does not end the battle; it ends once the fight begins', () => {
  const battle = battleOf([squad('ally', 'shock', -100, 0, 3), squad('enemy', 'shock', 100, 0, 3)]);
  killAll(battle.squads[1]);
  runSeconds(battle, 0.5);
  assert.equal(battle.phase, 'preparation');
  assert.equal(battle.result, null);
  battle.beginBattle();
  battle.step(1 / 60);
  assert.equal(battle.result.outcome, 'victory');
});

test('[battle2d.sim.deploy-enemy-holds] while deploying the enemy stands still, your squads can be moved, and nobody is hurt', () => {
  const mine = squad('ally', 'shock', -50, 0, 3);
  const theirs = squad('enemy', 'shock', 50, 0, 3);
  const battle = battleOf([mine, theirs]);
  const enemyStart = { x: theirs.x, y: theirs.y };
  theirs.waypoints = [{ x: -300, y: 0 }];
  theirs.targetSquad = mine;
  battle.selectSquad(mine);
  battle.tap({ x: -300, y: 200 });
  runSeconds(battle, 4);
  assert.deepEqual({ x: theirs.x, y: theirs.y }, enemyStart);
  assert.deepEqual([theirs.waypoints.length, theirs.targetSquad], [0, null], 'orders the enemy had are dropped until the fight begins');
  assert.ok(mine.x < -50, 'the ally squad deployed to its new place');
  assert.ok([...mine.roster, ...theirs.roster].every((u) => u.hp === u.maxHp));
});

test('[battle2d.sim.lord-capture-seeded] the lord is captured by chance that grows with the enemy still running, drawn from the seeded generator', () => {
  const outcomeFor = (seed, runners) => {
    const battle = createBattle({ seed, mode: 'practice', allyStrength: 0, enemyStrength: 0, options: { terrain: 'flat' } });
    const mine = squad('ally', 'shock', -100, 0, 3);
    const theirs = squad('enemy', 'archer', 100, 0, runners || 1);
    battle.allSquads.push(mine, theirs);
    battle.squads.push(mine, theirs);
    battle.beginBattle();
    if (runners) theirs.rout();
    else killAll(theirs);
    battle.step(1 / 60);
    return battle.result.lordCaptured;
  };
  const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
  assert.ok(seeds.every((seed) => outcomeFor(seed, 0) === false), 'nobody fled: the lord is never captured');
  const captured = seeds.filter((seed) => outcomeFor(seed, 12) === true).length;
  assert.ok(captured > 0 && captured < seeds.length, `12 runners give some chance (${captured}/60)`);
  assert.deepEqual(seeds.map((seed) => outcomeFor(seed, 12)), seeds.map((seed) => outcomeFor(seed, 12)), 'same seed, same answer');
});

// ---- Enemy AI ----

test('[battle2d.sim.ai-uses-live-squads] the enemy picks its target from the squads in the battle now, not from an old list', () => {
  const near = squad('ally', 'shock', 100, 0, 3);
  const far = squad('ally', 'shock', 500, 0, 3);
  const foe = squad('enemy', 'shock', 0, 0, 3);
  const battle = fightingBattle([near, far, foe]);
  const list = battle.squads;
  battle.step(1 / 60);
  assert.equal(foe.targetSquad, near);
  killAll(near);
  battle.step(1 / 60);
  battle.step(1 / 60);
  assert.equal(battle.squads.includes(near), false, 'the dead squad left the list');
  assert.equal(foe.targetSquad, far);
  assert.equal(battle.squads, list, 'the list itself is kept, so whoever holds it always sees the current squads');
});

test('[battle2d.sim.ai-roles] flankers go for archers, skirmishers keep their distance, everyone else keeps a target', () => {
  const archers = squad('ally', 'archer', 600, 0, 3);
  const nearInfantry = squad('ally', 'shock', 100, 0, 3);
  const flanker = squad('enemy', 'heavy_cav', 0, 0, 3);
  updateEnemyAi(flanker, [nearInfantry, archers, flanker]);
  assert.equal(flanker.aiRole, 'flanker');
  assert.equal(flanker.targetSquad, archers);

  const bow = squad('enemy', 'archer', 0, 0, 3);
  assert.equal(bow.aiRole, 'skirmisher');
  const press = squad('ally', 'shock', 100, 0, 3);
  updateEnemyAi(bow, [press, bow]);
  assert.equal(bow.targetSquad, null);
  assert.ok(bow.waypoints[0].x < bow.centerX, 'steps back from a squad within 120');
  const middle = squad('ally', 'shock', 300, 0, 3);
  updateEnemyAi(bow, [middle, bow]);
  assert.equal(bow.targetSquad, middle, 'within sight: stands and shoots');
  const distant = squad('ally', 'shock', 1500, 0, 3);
  updateEnemyAi(bow, [distant, bow]);
  assert.equal(bow.targetSquad, null);
  assert.equal(bow.waypoints[0].x, 1500, 'beyond sight: walks closer');

  const anvil = squad('enemy', 'shock', 0, 0, 3);
  const first = squad('ally', 'shock', 200, 0, 3);
  const second = squad('ally', 'shock', 100, 0, 3);
  anvil.targetSquad = first;
  updateEnemyAi(anvil, [first, second, anvil]);
  assert.equal(anvil.targetSquad, first, 'keeps its target while it stands');
  first.state = 'routing';
  updateEnemyAi(anvil, [first, second, anvil]);
  assert.equal(anvil.targetSquad, second, 'takes the nearest when the target breaks');
});

// ---- The player's orders ----

test('[battle2d.sim.order-select-move] a tap on your squad selects it; a tap on ground moves the selected squads side by side', () => {
  const a = squad('ally', 'shock', -100, 0, 3);
  const b = squad('ally', 'shield', -100, 100, 3);
  const battle = fightingBattle([a, b, squad('enemy', 'shock', 400, 0, 3)]);
  assert.equal(battle.tap({ x: 0, y: 400 }).type, 'none', 'nothing selected: nothing to move');
  assert.equal(battle.tap({ x: a.centerX + 10, y: a.centerY }).type, 'select');
  assert.deepEqual([a.selected, b.selected], [true, false]);
  battle.tap({ x: b.centerX, y: b.centerY });
  assert.deepEqual([a.selected, b.selected], [false, true], 'selecting another deselects the first');
  a.selected = true;
  b.selected = true;
  battle.tap({ x: 0, y: 300 });
  assert.deepEqual([a.waypoints[0].x, b.waypoints[0].x], [-70, 70]);
  assert.deepEqual([a.waypoints[0].y, b.waypoints[0].y], [300, 300]);
  battle.tap({ x: 50, y: 50 }, { waypointMode: true });
  assert.equal(a.waypoints.length, 2, 'in waypoint mode the point is added to the route');
});

test('[battle2d.sim.order-line-and-box] a dragged line spreads the selected squads along it; with none selected it is a selection box', () => {
  const a = squad('ally', 'shock', -100, 0, 3);
  const b = squad('ally', 'shield', -100, 100, 3);
  const battle = fightingBattle([a, b, squad('enemy', 'shock', 400, 0, 3)]);
  assert.equal(battle.dragLine({ x: -200, y: -50 }, { x: 0, y: 150 }).type, 'box');
  assert.deepEqual([a.selected, b.selected], [true, true]);
  battle.dragLine({ x: 0, y: 200 }, { x: 200, y: 200 });
  assert.deepEqual([a.waypoints[0].x, b.waypoints[0].x], [0, 200]);
  assert.equal(a.formationWidth, 100);
  assert.equal(a.waypoints[0].width, 100);
});

test('[battle2d.sim.order-attack] attack on an enemy squad locks the target; a move order or facing order cancels it; selecting does not', () => {
  const a = squad('ally', 'shock', -100, 0, 3);
  const b = squad('ally', 'shield', -100, 100, 3);
  const foe = squad('enemy', 'shock', 300, 0, 3);
  const battle = fightingBattle([a, b, foe]);
  battle.selectSquad(a);
  assert.equal(battle.attack({ x: foe.centerX + 20, y: foe.centerY }).type, 'attack');
  assert.equal(a.targetSquad, foe);
  assert.equal(a.state, 'combat');
  battle.tap({ x: b.centerX, y: b.centerY });
  assert.equal(a.targetSquad, foe, 'selecting another squad leaves the first one fighting');
  battle.selectSquad(a);
  battle.tap({ x: 0, y: 300 });
  assert.equal(a.targetSquad, null);
  assert.equal(a.state, 'idle');
  battle.selectSquad(a);
  battle.attack({ x: 0, y: -200 });
  assert.deepEqual([a.targetSquad, a.waypoints[0].x, a.waypoints[0].y], [null, 0, -200], 'attack on open ground is a move');
  battle.setFacing(1.5);
  assert.deepEqual([a.angle, a.waypoints.length], [1.5, 0]);
});

test('[battle2d.sim.order-formation] a formation order changes the selected squads, "special" picks the squad\'s own, and idle squads re-form', () => {
  const wall = squad('ally', 'shield', -100, 0, 3);
  const bow = squad('ally', 'archer', -100, 100, 3);
  const battle = fightingBattle([wall, bow, squad('enemy', 'shock', 400, 0, 3)]);
  wall.selected = true;
  bow.selected = true;
  battle.setFormation('special');
  assert.deepEqual([wall.currentFormation, bow.currentFormation], ['shield_wall', 'skirmish']);
  assert.equal(wall.waypoints.length, 1, 'a standing squad gets a waypoint at its centre');
  battle.setFormation('loose');
  assert.equal(wall.currentFormation, 'loose');
  battle.setFormation('nonsense');
  assert.equal(wall.currentFormation, 'loose', 'unknown formations are ignored');
  battle.clearWaypoints();
  assert.equal(wall.waypoints.length, 0);
  battle.deselectAll();
  assert.deepEqual([wall.selected, bow.selected], [false, false]);
});

// ---- Negotiation ----

// n ally and m enemy soldiers in squads of up to 12, in a battle that has started.
function armies(allies, enemies, economy = { gold: 500, food: 10 }) {
  const make = (team, total, x) => {
    const squads = [];
    for (let left = total, i = 0; left > 0; left -= 12, i += 1) squads.push(squad(team, 'shock', x, i * 60, Math.min(12, left)));
    return squads;
  };
  return fightingBattle([...make('ally', allies, -100), ...make('enemy', enemies, 100)], { economy });
}

test('[battle2d.sim.diplomacy-offer-parse] offers are read only when clear: one gold and/or one food amount, paid by the player', () => {
  assert.deepEqual(parsePlayerOffer('금화 100 주겠다'), { ok: true, reason: 'parsed_offer', gold: 100, food: 0 });
  assert.deepEqual(parsePlayerOffer('식량 4 와 금화 1,200 바치겠다'), { ok: true, reason: 'parsed_offer', gold: 1200, food: 4 });
  for (const text of ['금화 100 달라', '금화 100 과 금화 200 주겠다', '금화 1.5 주겠다', '전부 주겠다', '그냥 물러나라', '금화 0 주겠다']) {
    assert.equal(parsePlayerOffer(text).ok, false, text);
  }
});

test('[battle2d.sim.diplomacy-accepts-offer] an offer worth enough ends the battle as a negotiated retreat; the offer is reported, no money moves here', () => {
  const economy = { gold: 500, food: 10 };
  const battle = armies(12, 12, economy);
  const decision = battle.evaluateDiplomacy('금화 100 주겠다');
  assert.equal(decision.action, 'negotiated_retreat');
  assert.equal(decision.minimumAcceptValue, 90);
  const applied = battle.applyDiplomacy(decision);
  assert.equal(applied.ended, true);
  assert.equal(battle.result.outcome, 'negotiated_retreat');
  assert.deepEqual(battle.result.diplomacy, { action: 'negotiated_retreat', reason: 'offer_accepted', offer: { gold: 100, food: 0 } });
  assert.equal(battle.result.enemyRoutedUnits, 12, 'the withdrawing enemy counts as having left the field');
  assert.deepEqual(economy, { gold: 500, food: 10 });
  assert.deepEqual(battle.economy, { gold: 500, food: 10 });
});

test('[battle2d.sim.diplomacy-refuses] too little, more than you own, or nothing: the lord does not withdraw and the battle goes on', () => {
  const battle = armies(12, 12);
  assert.equal(battle.evaluateDiplomacy('금화 50 주겠다').reason, 'offer_insufficient');
  assert.equal(battle.evaluateDiplomacy('금화 5000 주겠다').reason, 'insufficient_resources');
  const talk = battle.evaluateDiplomacy('물러나라');
  assert.deepEqual([talk.action, talk.reason], ['negotiate', 'continue_negotiation']);
  battle.applyDiplomacy(talk);
  assert.equal(battle.phase, 'fighting');
  assert.equal(battle.result, null);
});

test('[battle2d.sim.diplomacy-forced-retreat] an enemy far outnumbered withdraws on its own, owing nothing; one far stronger turns aggressive', () => {
  const losing = armies(40, 12);
  const decision = losing.evaluateDiplomacy('말해 보시오');
  assert.equal(decision.action, 'strategic_retreat');
  losing.applyDiplomacy(decision);
  assert.deepEqual(losing.result.diplomacy, { action: 'strategic_retreat', reason: 'forced_strategic_retreat', offer: { gold: 0, food: 0 } });
  assert.equal(losing.result.outcome, 'strategic_retreat');

  const offering = armies(40, 12);
  const refused = offering.evaluateDiplomacy('금화 100 주겠다');
  assert.equal(refused.action, 'strategic_retreat', 'the offer is too small to be taken, but the enemy withdraws anyway');
  offering.applyDiplomacy(refused);
  assert.deepEqual(offering.result.diplomacy.offer, { gold: 0, food: 0 }, 'so nothing is owed');

  const winning = armies(12, 24);
  const attack = winning.evaluateDiplomacy('말해 보시오');
  assert.equal(attack.action, 'attack');
  winning.applyDiplomacy(attack);
  assert.ok(winning.squads.filter((s) => s.team === 'enemy').every((s) => s.aiRole === 'flanker'));
  assert.equal(winning.phase, 'fighting');
});

test('[battle2d.sim.diplomacy-baseline-survives] the enemy\'s losses are measured from the start of the battle, even after wiped squads leave the list', () => {
  const battle = armies(12, 24);
  killAll(battle.squads.filter((s) => s.team === 'enemy')[0]);
  battle.step(1 / 60);
  const state = battle.evaluateDiplomacy('말해 보시오').battle;
  assert.equal(state.ok, true);
  assert.equal(state.enemyStart, 24);
  assert.equal(state.lossRate, 0.5);
});

test('[battle2d.sim.diplomacy-text-is-cosmetic] a spoken line that contradicts the decision is replaced; a key goes in a header, never the address', async () => {
  const accepted = { action: 'negotiated_retreat', reason: 'offer_accepted', offer: { gold: 100, food: 0 } };
  assert.equal(normalizeAiDialogue({ emotion: '만족', dialogue: '금화 100을 받았다. 물러나지.' }, accepted).emotion, '만족');
  assert.equal(normalizeAiDialogue({ emotion: '만족', dialogue: '금화 900을 받았다.' }, accepted).emotion, '냉정', 'wrong amount');
  assert.equal(normalizeAiDialogue({ emotion: '분노', dialogue: '공격한다, 기습이다' }, { action: 'negotiate', offer: {} }).dialogue, '아직 조건이 마음에 들지 않는군.');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"emotion":"냉정","dialogue":"조건이 부족하군."}' }] } }] }) };
  };
  const line = await requestLordDialogue({ apiKey: 'secret-key', decision: { action: 'negotiate', reason: 'x', offer: {} }, history: [], fetchImpl });
  assert.equal(line.dialogue, '조건이 부족하군.');
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].url.includes('secret-key'));
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'secret-key');
  await assert.rejects(requestLordDialogue({ apiKey: 'k', decision: { action: 'negotiate', offer: {} }, history: [], fetchImpl: async () => ({ ok: false, status: 500 }) }), /HTTP 500/);
});

// ---- Replay and randomness ----

function scripted(seed, collectEvents = false) {
  const battle = createBattle({ seed, mode: 'practice', allyStrength: 1, enemyStrength: 1, options: { collectEvents } });
  battle.eventCount = 0;
  battle.beginBattle();
  battle.selectBySubType('heavy_cav');
  battle.attack({ x: 200, y: -50 });
  battle.selectBySubType('shock');
  battle.tap({ x: -50, y: 0 });
  for (let i = 0; i < 900; i += 1) {
    battle.step(1 / 60);
    battle.eventCount += battle.drainEvents().length;
  }
  return battle;
}

test('[battle2d.sim.same-seed-same-result] the same seed and orders give exactly the same battle; another seed does not', () => {
  const first = fingerprint(scripted(21));
  assert.equal(fingerprint(scripted(21)), first);
  assert.notEqual(fingerprint(scripted(22)), first);
});

test('[battle2d.sim.events-do-not-change-fight] collecting the effects events for a renderer does not change the battle', () => {
  const watched = scripted(21, true);
  assert.ok(watched.eventCount > 0, 'the fight produced effects to show');
  assert.equal(fingerprint(watched), fingerprint(scripted(21, false)));
});

test('[battle2d.sim.no-math-random] a whole battle, with a random map, shooting, charges and talks, never calls Math.random', () => {
  const original = Math.random;
  let calls = 0;
  Math.random = () => {
    calls += 1;
    return 0.123;
  };
  try {
    const battle = createBattle({ seed: 4, mode: 'practice', allyStrength: 2, enemyStrength: 2, options: { collectEvents: true } });
    battle.beginBattle();
    battle.selectBySubType('light_cav');
    battle.attack({ x: 200, y: -50 });
    for (let i = 0; i < 1200; i += 1) {
      battle.step(1 / 60);
      battle.drainEvents();
    }
    battle.applyDiplomacy(battle.evaluateDiplomacy('금화 10 주겠다'));
    battle.surrender();
    assert.ok(battle.isOver);
    Math.random();
    assert.equal(calls, 1, 'only the deliberate call above');
  } finally {
    Math.random = original;
  }
});
