// The battle itself, without any drawing or input: squads, terrain, the fixed-step update, the
// player's orders and how it ends. It runs the same in a browser and in Node.
//
// A battle starts in the preparation phase (the player may move their squads, nobody fights),
// goes to 'fighting' on beginBattle(), and to 'ended' exactly once; the result is kept in .result.
import { createRandom } from './random.js';
import { createTerrain } from './terrain.js';
import { Squad } from './squad.js';
import { BattleEngine } from './engine.js';
import { detectOutcome, countForces, buildResult } from './outcome.js';
import { decide, normalizeBattleState, aliveUnitCount } from './diplomacy.js';
import { rosterForStrength, validateRoster, squadSpecs, MAX_SOLDIERS_PER_SQUAD } from './army.js';

const FORMATIONS = Object.freeze(['line', 'column', 'square', 'loose', 'special']);
const SELECT_RADIUS = 50;
const ATTACK_PICK_RADIUS = 60;
const SQUAD_SPACING_ON_MOVE = 140;

export class Battle {
  // random, terrain and squads are made by createBattle(); tests may pass their own.
  constructor({ random, terrain, squads, mode = 'practice', economy = null, collectEvents = false }) {
    this.random = random;
    this.terrain = terrain;
    this.mode = mode;
    this.economy = { gold: Number(economy && economy.gold) || 0, food: Number(economy && economy.food) || 0 };
    this.allSquads = squads.slice();
    this.squads = squads.slice();
    this.phase = 'preparation';
    // Battle time: only the fighting counts, not the deployment before it.
    this.elapsed = 0;
    this.result = null;
    this.events = collectEvents ? [] : null;
    this.engine = new BattleEngine({
      random,
      terrain,
      onEvent: collectEvents ? (event) => this.events.push(event) : null,
    });
    this.moveOutOfObstacles();
    this.baseline = this.countSides();
    this.engine.updateVision(this.squads);
  }

  // Soldiers placed in a wall or cliff could never leave it, so the start positions are nudged out.
  moveOutOfObstacles() {
    for (const squad of this.allSquads) {
      const anchor = this.terrain.nearestOpenPoint(squad.x, squad.y);
      const shiftX = anchor.x - squad.x;
      const shiftY = anchor.y - squad.y;
      squad.x += shiftX;
      squad.y += shiftY;
      for (const unit of squad.units) {
        unit.x += shiftX;
        unit.y += shiftY;
        const open = this.terrain.nearestOpenPoint(unit.x, unit.y);
        unit.x = open.x;
        unit.y = open.y;
      }
    }
  }

  countSides() {
    const count = (team) => this.squads.filter((squad) => squad.team === team).reduce((sum, squad) => sum + aliveUnitCount(squad), 0);
    return { allyStart: count('ally'), enemyStart: count('enemy') };
  }

  get isOver() {
    return this.phase === 'ended';
  }

  // Advances the battle by dt seconds of battle time. Callers use a fixed dt so a battle replays exactly.
  step(dt) {
    if (this.phase === 'ended' || !(dt > 0)) return;
    const fighting = this.phase === 'fighting';
    this.engine.update(this.squads, dt, fighting);
    const context = { terrain: this.terrain, squads: this.squads, preparation: !fighting };
    for (const squad of this.squads) squad.update(dt, context);
    this.removeEmptySquads();
    this.engine.updateVision(this.squads);
    if (fighting) this.elapsed += dt;
    this.checkEnd();
  }

  // Removed in place, so anyone holding battle.squads always sees the current list.
  removeEmptySquads() {
    for (let i = this.squads.length - 1; i >= 0; i -= 1) {
      if (this.squads[i].units.length === 0) {
        this.squads[i].selected = false;
        this.squads.splice(i, 1);
      }
    }
  }

  beginBattle() {
    if (this.phase === 'preparation') this.phase = 'fighting';
  }

  // Ends the battle if one side has nothing left to fight with. Only while fighting.
  checkEnd() {
    if (this.phase !== 'fighting') return this.result;
    const outcome = detectOutcome(this.squads);
    return outcome ? this.finish(outcome) : null;
  }

  // Ends the battle (once) and builds the result. lordCaptured is only ever decided for a victory,
  // from the enemy soldiers still running, with the battle's own generator.
  finish(outcome, diplomacy = null) {
    if (this.phase === 'ended') return this.result;
    let lordCaptured = false;
    if (outcome === 'victory') {
      const fleeing = countForces(this.squads).enemyRouting;
      lordCaptured = this.random.next() < Math.min(0.5, fleeing / 50);
    }
    this.phase = 'ended';
    for (const squad of this.allSquads) squad.selected = false;
    this.result = buildResult({ outcome, allSquads: this.allSquads, lordCaptured, diplomacy });
    return this.result;
  }

  drainEvents() {
    if (!this.events) return [];
    return this.events.splice(0, this.events.length);
  }

  summary() {
    const side = (team) => {
      const squads = this.squads.filter((squad) => squad.team === team);
      return { squads: squads.length, soldiers: squads.reduce((sum, squad) => sum + aliveUnitCount(squad), 0) };
    };
    return { phase: this.phase, elapsed: this.elapsed, ally: side('ally'), enemy: side('enemy') };
  }

  // ---- Orders. Each does nothing once the battle has ended. ----

  selectedAllies() {
    return this.squads.filter((squad) => squad.selected && squad.team === 'ally');
  }

  deselectAll() {
    for (const squad of this.squads) squad.selected = false;
  }

  selectSquad(squad) {
    if (this.isOver) return;
    for (const other of this.squads) other.selected = other === squad;
  }

  selectBySubType(subType) {
    if (this.isOver) return;
    for (const squad of this.squads) squad.selected = squad.team === 'ally' && squad.subType === subType;
  }

  // Moving a squad cancels the attack it was ordered to carry out.
  releaseTargets(squads) {
    for (const squad of squads) {
      squad.targetSquad = null;
      if (squad.state === 'combat') squad.state = 'idle';
    }
  }

  // A tap on one of your squads selects it; a tap on open ground sends the selected squads there,
  // side by side. In waypoint mode the point is added to their route instead.
  tap(point, { waypointMode = false } = {}) {
    if (this.isOver) return { type: 'none' };
    const clicked = this.squads.find((squad) => squad.team === 'ally' && squad.units.length > 0
      && Math.hypot(squad.centerX - point.x, squad.centerY - point.y) < SELECT_RADIUS);
    if (clicked) {
      this.selectSquad(clicked);
      return { type: 'select', squad: clicked };
    }
    const selected = this.selectedAllies();
    if (selected.length === 0) return { type: 'none' };
    this.releaseTargets(selected);
    if (waypointMode) {
      for (const squad of selected) {
        squad.waypoints.push({ x: point.x, y: point.y, width: squad.formationWidth, angle: squad.angle });
      }
    } else {
      selected.forEach((squad, index) => {
        const offsetX = (index - (selected.length - 1) / 2) * SQUAD_SPACING_ON_MOVE;
        squad.waypoints = [{ x: point.x + offsetX, y: point.y, width: squad.formationWidth, angle: squad.angle }];
      });
    }
    return { type: 'move', squads: selected };
  }

  // A line drawn on the ground: with squads selected, they spread along it as one front.
  // With none selected, it is a box that selects the squads inside.
  dragLine(start, end, { waypointMode = false } = {}) {
    if (this.isOver) return { type: 'none' };
    const selected = this.selectedAllies();
    if (selected.length > 0) {
      this.releaseTargets(selected);
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const width = Math.max(30, length / selected.length);
      selected.forEach((squad, index) => {
        const t = selected.length === 1 ? 0.5 : index / (selected.length - 1);
        const waypoint = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t, width, angle: angle + Math.PI / 2 };
        if (waypointMode) {
          squad.waypoints.push(waypoint);
        } else {
          squad.formationWidth = width;
          squad.waypoints = [waypoint];
        }
      });
      return { type: 'line', squads: selected };
    }
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    for (const squad of this.squads) {
      squad.selected = squad.team === 'ally' && squad.units.length > 0
        && squad.centerX > minX && squad.centerX < maxX && squad.centerY > minY && squad.centerY < maxY;
    }
    return { type: 'box' };
  }

  // Attack: on an enemy squad, the selected squads go for it; on open ground, they go there.
  attack(point) {
    if (this.isOver) return { type: 'none' };
    const allies = this.selectedAllies();
    if (allies.length === 0) return { type: 'none' };
    const enemy = this.squads.find((squad) => squad.team === 'enemy'
      && Math.hypot(squad.centerX - point.x, squad.centerY - point.y) < ATTACK_PICK_RADIUS);
    if (enemy) {
      for (const squad of allies) {
        squad.targetSquad = enemy;
        squad.waypoints = [];
        squad.state = 'combat';
      }
      return { type: 'attack', target: enemy };
    }
    for (const squad of allies) {
      squad.targetSquad = null;
      squad.waypoints = [{ x: point.x, y: point.y, width: squad.formationWidth, angle: squad.angle }];
    }
    return { type: 'move', squads: allies };
  }

  setFacing(angle) {
    if (this.isOver) return;
    for (const squad of this.selectedAllies()) {
      squad.angle = angle;
      squad.waypoints = [];
      squad.targetSquad = null;
    }
  }

  setFormation(name) {
    if (this.isOver || !FORMATIONS.includes(name)) return;
    for (const squad of this.selectedAllies()) {
      squad.currentFormation = name === 'special' ? squad.specialFormation : name;
      // A squad standing still re-forms around its centre.
      if (squad.waypoints.length === 0 && squad.state !== 'combat') {
        squad.waypoints = [{ x: squad.centerX, y: squad.centerY }];
      }
    }
  }

  clearWaypoints() {
    if (this.isOver) return;
    for (const squad of this.squads) if (squad.selected) squad.waypoints = [];
  }

  // Every ally squad breaks and runs. While fighting this ends the battle at the next check;
  // while still deploying it ends it at once (nothing was fought).
  orderRetreat() {
    if (this.isOver) return;
    for (const squad of this.squads) if (squad.team === 'ally') squad.rout();
    if (this.phase === 'preparation') this.finish('retreat');
    else this.checkEnd();
  }

  surrender() {
    if (this.isOver) return null;
    return this.finish('surrender');
  }

  // ---- Diplomacy ----

  // What the lord would answer to this message right now. Changes nothing.
  evaluateDiplomacy(message, economy = this.economy) {
    return decide(message, economy, normalizeBattleState(this.squads, this.baseline, this.isOver));
  }

  // A fingerprint of the field, to notice that it changed while an answer was being prepared.
  signature() {
    return JSON.stringify(this.squads.map((squad) => ({ team: squad.team, state: squad.state, units: aliveUnitCount(squad) })));
  }

  // Carries out a decision. 'attack' makes every enemy squad press the attack; the retreats send the
  // enemy running and end the battle, with the offer to charge in result.diplomacy.
  applyDiplomacy(decision) {
    if (this.isOver) return { applied: false, reason: 'battle_over' };
    if (decision.action === 'attack') {
      for (const squad of this.squads) if (squad.team === 'enemy') squad.aiRole = 'flanker';
      return { applied: true, ended: false };
    }
    if (decision.action === 'negotiated_retreat' || decision.action === 'strategic_retreat') {
      for (const squad of this.squads) if (squad.team === 'enemy') squad.rout();
      const paid = decision.action === 'negotiated_retreat';
      const result = this.finish(decision.action, {
        action: decision.action,
        reason: decision.reason,
        offer: { gold: paid ? decision.offer.gold : 0, food: paid ? decision.offer.food : 0 },
      });
      return { applied: true, ended: true, result };
    }
    return { applied: true, ended: false };
  }
}

function soldiersPerSquad(value) {
  if (value === undefined) return MAX_SOLDIERS_PER_SQUAD;
  if (!Number.isInteger(value) || value < 1 || value > MAX_SOLDIERS_PER_SQUAD) {
    throw new RangeError(`battle2d: soldiersPerSquad must be a whole number from 1 to ${MAX_SOLDIERS_PER_SQUAD}`);
  }
  return value;
}

// Builds a battle from the public settings. The seed decides the map (practice), every soldier's
// starting jitter and everything random during the fight.
export function createBattle({ seed, mode = 'practice', enemyStrength, allyStrength, options = {} }) {
  const random = createRandom(seed);
  const terrainKind = options.terrain || (mode === 'campaign' ? 'fixed' : 'random');
  if (!['random', 'fixed', 'flat'].includes(terrainKind)) throw new RangeError(`battle2d: unknown terrain "${terrainKind}"`);
  const terrain = createTerrain({ kind: terrainKind, random });
  const allyRoster = options.allySquads ? validateRoster(options.allySquads) : rosterForStrength(allyStrength);
  const enemyRoster = options.enemySquads ? validateRoster(options.enemySquads) : rosterForStrength(enemyStrength);
  const soldiers = soldiersPerSquad(options.soldiersPerSquad);
  const specs = [...squadSpecs('ally', allyRoster, soldiers), ...squadSpecs('enemy', enemyRoster, soldiers)];
  const squads = specs.map((spec) => new Squad(spec, random));
  return new Battle({ random, terrain, squads, mode, economy: options.economy, collectEvents: Boolean(options.collectEvents) });
}
