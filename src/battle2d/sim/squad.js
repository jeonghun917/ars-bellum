// A squad: up to twelve soldiers moving as one body (formation, waypoints, morale, routing).
import { Soldier } from './soldier.js';
import { formationSlots } from './formations.js';
import { updateEnemyAi } from './ai.js';
import { SQUAD_KINDS } from './unit-stats.js';

const MORALE_LOSS_PER_DEATH = 20;
const ROUT_MORALE = 30;

function specialFormationFor(subType) {
  if (subType === 'light_cav' || subType === 'heavy_cav') return 'wedge';
  if (subType === 'shield') return 'shield_wall';
  if (subType === 'pike') return 'phalanx';
  if (subType === 'shock') return 'oblique';
  if (subType === 'archer' || subType === 'crossbow') return 'skirmish';
  return 'line';
}

function aiRoleFor(team, type, subType) {
  if (team !== 'enemy') return null;
  if (subType === 'light_cav' || type === 'archer') return 'skirmisher';
  if (subType === 'heavy_cav') return 'flanker';
  return 'anvil';
}

export class Squad {
  // spec: { id, name, team, subType, x, y, soldiers }. type and tier come from SQUAD_KINDS.
  constructor(spec, random) {
    const kind = SQUAD_KINDS[spec.subType];
    this.id = spec.id;
    this.name = spec.name || spec.id;
    this.team = spec.team;
    this.subType = spec.subType;
    this.type = kind ? kind.type : 'infantry';
    this.tier = kind ? kind.tier : 2;
    this.x = spec.x;
    this.y = spec.y;
    this.angle = 0;
    this.morale = 100;
    this.state = 'idle';
    this.selected = false;
    this.waypoints = [];
    this.targetSquad = null;
    this.formationWidth = 120;
    this.momentum = 0;
    this.visible = true;
    this.aiRole = aiRoleFor(this.team, this.type, this.subType);
    this.currentFormation = 'line';
    this.specialFormation = specialFormationFor(this.subType);

    if (this.type === 'cavalry') {
      this.speed = this.subType === 'heavy_cav' ? 0.80 : 1.10;
      this.vision = 300;
    } else if (this.type === 'archer') {
      this.speed = 0.6;
      this.vision = 450;
    } else {
      this.speed = 0.5;
      this.vision = 250;
    }

    const soldiers = spec.soldiers === undefined ? 12 : spec.soldiers;
    this.units = Array.from({ length: soldiers }, () => new Soldier(this, random));
    // Every soldier the squad started with, for the casualty count at the end.
    this.roster = this.units.slice();
    this.lastUnitCount = soldiers;
  }

  get centerX() {
    if (this.units.length === 0) return this.x;
    let sum = 0;
    for (const unit of this.units) sum += unit.x;
    return sum / this.units.length;
  }

  get centerY() {
    if (this.units.length === 0) return this.y;
    let sum = 0;
    for (const unit of this.units) sum += unit.y;
    return sum / this.units.length;
  }

  // The squad breaks and runs for its own map edge.
  rout() {
    this.state = 'routing';
    this.selected = false;
    this.targetSquad = null;
    for (const unit of this.units) unit.routed = true;
  }

  // context: { terrain, squads (the battle's current list), preparation (true while deploying) }.
  update(dt, context) {
    const { terrain } = context;
    this.units = this.units.filter((unit) => unit.hp > 0);
    const count = this.units.length;
    if (count === 0) return;

    if (count < this.lastUnitCount) {
      this.morale -= (this.lastUnitCount - count) * MORALE_LOSS_PER_DEATH;
      this.lastUnitCount = count;
    }
    if (this.tier === 1 && this.morale < ROUT_MORALE && this.state !== 'routing') this.rout();

    if (this.state === 'routing') {
      for (const unit of this.units) {
        unit.routed = true;
        unit.update(0, 0, dt, terrain, true);
      }
      return;
    }

    if (context.preparation) {
      this.targetSquad = null;
      if (this.state === 'combat') this.state = 'idle';
      for (const unit of this.units) unit.attackCooldown = 2.0;
      // The enemy stands where it was deployed but still forms up around its anchor.
      if (this.team === 'enemy') this.waypoints = [];
    } else if (this.team === 'enemy') {
      updateEnemyAi(this, context.squads);
    }

    this.followTarget();
    this.moveAlongWaypoints(dt, terrain);
    this.holdFormation(dt, terrain);
  }

  // A target in sight range turns into combat; a distant one is chased by waypoint.
  followTarget() {
    if (!this.targetSquad) return;
    if (this.targetSquad.units.length === 0 || this.targetSquad.state === 'routing') {
      this.targetSquad = null;
      this.state = 'idle';
      return;
    }
    const distance = Math.hypot(this.centerX - this.targetSquad.centerX, this.centerY - this.targetSquad.centerY);
    if (distance < this.vision * 0.8) {
      this.waypoints = [];
      this.state = 'combat';
    } else {
      this.waypoints = [{ x: this.targetSquad.centerX, y: this.targetSquad.centerY }];
    }
  }

  moveAlongWaypoints(dt, terrain) {
    if (this.waypoints.length === 0) {
      if (this.momentum > 0 && this.state !== 'combat') this.momentum -= dt * 100;
      if (this.momentum < 0) this.momentum = 0;
      return;
    }
    const waypoint = this.waypoints[0];
    const distance = Math.hypot(waypoint.x - this.x, waypoint.y - this.y);
    if (distance <= 5) {
      this.formationWidth = waypoint.width || this.formationWidth;
      if (!this.targetSquad) this.waypoints.shift();
      return;
    }

    this.angle = Math.atan2(waypoint.y - this.y, waypoint.x - this.x);
    let squadSpeed = this.speed;
    if (this.currentFormation === 'shield_wall' || this.currentFormation === 'square') squadSpeed *= 0.3;
    else if (this.currentFormation === 'column') squadSpeed *= 1.15;

    const moveDistance = squadSpeed * dt * 60;
    let nextX = this.x + Math.cos(this.angle) * moveDistance;
    let nextY = this.y + Math.sin(this.angle) * moveDistance;
    if (terrain) {
      const limitX = terrain.width / 2 - 15;
      const limitY = terrain.height / 2 - 15;
      nextX = Math.max(-limitX, Math.min(limitX, nextX));
      nextY = Math.max(-limitY, Math.min(limitY, nextY));
    }

    const canStepTo = (nx, ny) => {
      if (!terrain) return true;
      const nextCell = terrain.getAt(nx, ny);
      const currentCell = terrain.getAt(this.x, this.y);
      if (nextCell.type === 'wall' || nextCell.type === 'cliff') return false;
      const heightStep = Math.abs((nextCell.h || 0) - (currentCell.h || 0));
      if (heightStep > 1 && currentCell.type !== 'stairs' && nextCell.type !== 'stairs') return false;
      return true;
    };
    if (canStepTo(nextX, nextY)) {
      this.x = nextX;
      this.y = nextY;
    } else if (canStepTo(nextX, this.y)) {
      this.x = nextX;
    } else if (canStepTo(this.x, nextY)) {
      this.y = nextY;
    }

    if (this.type === 'cavalry') {
      this.momentum = Math.min(100, this.momentum + dt * (this.subType === 'light_cav' ? 50 : 25));
    }
  }

  holdFormation(dt, terrain) {
    const slots = formationSlots(this.currentFormation, this.units.length, this.formationWidth);
    const cos = Math.cos(this.angle - Math.PI / 2);
    const sin = Math.sin(this.angle - Math.PI / 2);
    for (let i = 0; i < this.units.length; i += 1) {
      const slotX = this.x + (slots[i].x * cos - slots[i].y * sin);
      const slotY = this.y + (slots[i].x * sin + slots[i].y * cos);
      this.units[i].update(slotX, slotY, dt, terrain, false);
    }
  }
}
