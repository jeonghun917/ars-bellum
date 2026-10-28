// One soldier: stats, movement towards a target point, and the terrain rules for stepping.
import { statsFor } from './unit-stats.js';

const SOLDIER_SPREAD = 20;

export class Soldier {
  constructor(squad, random) {
    const stats = statsFor(squad.subType);
    this.squad = squad;
    this.x = squad.x + (random.next() - 0.5) * SOLDIER_SPREAD;
    this.y = squad.y + (random.next() - 0.5) * SOLDIER_SPREAD;
    this.attackCooldown = 0;
    this.hp = stats.hp;
    this.maxHp = stats.hp;
    this.armor = stats.armor;
    this.dmg = stats.dmg;
    this.baseMass = stats.mass;
    this.mass = stats.mass;
    this.radius = stats.radius;
    if (stats.ammo !== undefined) {
      this.ammo = stats.ammo;
      this.rangedDmg = stats.rangedDmg;
      this.armorPierce = stats.armorPierce;
    }
    // routed: the squad broke and this soldier ran. escaped: it reached the map edge and left the field alive.
    this.routed = false;
    this.escaped = false;
  }

  // Killed by damage, as opposed to having left the field.
  get killed() {
    return this.hp <= 0 && !this.escaped;
  }

  update(targetX, targetY, dt, terrain, isRouting) {
    if (this.hp <= 0) return;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    this.mass = this.baseMass;
    let speedMultiplier = isRouting ? 1.5 : 1.0;
    const formation = this.squad.currentFormation;

    if (formation === 'column') {
      speedMultiplier *= 1.15;
    } else if (formation === 'square' || formation === 'shield_wall') {
      speedMultiplier *= 0.3;
      this.mass = this.baseMass * 2.5;
    } else if (formation === 'phalanx') {
      speedMultiplier *= 0.4;
      this.mass = this.baseMass * 2.0;
    } else if (formation === 'wedge') {
      this.mass = this.baseMass * 1.5;
    }

    if (this.squad.type === 'cavalry') {
      const ratio = this.squad.momentum / 100;
      if (this.squad.subType === 'light_cav') speedMultiplier *= 2.0 + ratio * ratio * 2.8;
      else if (this.squad.subType === 'heavy_cav') speedMultiplier *= 0.7 + ratio * 0.2;
    }

    // A phalanx of pikes stops light cavalry: close to one, the horsemen crawl and lose all momentum.
    const chased = this.squad.targetSquad;
    if (this.squad.subType === 'light_cav' && chased && chased.subType === 'pike' && chased.currentFormation === 'phalanx') {
      const distanceToPikes = Math.hypot(this.x - chased.centerX, this.y - chased.centerY);
      if (distanceToPikes < 120) {
        speedMultiplier *= 0.1;
        this.squad.momentum = 0;
      }
    }

    if (isRouting) {
      const escapeLimitX = terrain ? terrain.width / 2 + 50 : 2500;
      targetX = this.squad.team === 'ally' ? -escapeLimitX : escapeLimitX;
      const reachedEdge = this.squad.team === 'ally' ? this.x <= -escapeLimitX + 70 : this.x >= escapeLimitX - 70;
      if (reachedEdge) {
        this.hp = 0;
        this.escaped = true;
        return;
      }
    }

    const isStationary = this.squad.waypoints.length === 0 && this.squad.state !== 'combat' && !this.squad.targetSquad;
    let tx = targetX;
    let ty = targetY;
    if (!isStationary && this.squad.targetSquad) {
      tx = this.squad.targetSquad.centerX;
      ty = this.squad.targetSquad.centerY;
    }

    // Soldiers of one squad push each other apart so they do not stack on one point.
    let separationX = 0;
    let separationY = 0;
    let neighbours = 0;
    if (!isStationary) {
      for (const other of this.squad.units) {
        if (other === this || other.hp <= 0) continue;
        const distance = Math.hypot(this.x - other.x, this.y - other.y);
        if (distance > 0 && distance < this.radius * 1.2) {
          separationX += (this.x - other.x) / distance;
          separationY += (this.y - other.y) / distance;
          neighbours += 1;
        }
      }
    }

    let dx = tx - this.x;
    let dy = ty - this.y;
    if (neighbours > 0) {
      dx += (separationX / neighbours) * 8;
      dy += (separationY / neighbours) * 8;
    }

    const distance = Math.hypot(dx, dy);
    let deadzone = isStationary ? 2.0 : 0.5;
    if (formation === 'shield_wall' || formation === 'square') deadzone = 4.0;
    if (distance <= deadzone) return;

    const currentCell = terrain ? terrain.getAt(this.x, this.y) : null;
    if (currentCell) {
      if (currentCell.type === 'forest') speedMultiplier *= 0.5;
      else if (currentCell.type === 'hill') speedMultiplier *= 0.8;
    }

    const baseSpeed = isRouting ? this.squad.speed * 80 : this.squad.speed * 60;
    const moveDistance = Math.min(baseSpeed * speedMultiplier * dt, distance);
    let nextX = this.x + (dx / distance) * moveDistance;
    let nextY = this.y + (dy / distance) * moveDistance;

    // The map edge holds everyone but routing soldiers, who are meant to leave it.
    if (!isRouting && terrain) {
      const limitX = terrain.width / 2 - this.radius;
      const limitY = terrain.height / 2 - this.radius;
      nextX = Math.max(-limitX, Math.min(limitX, nextX));
      nextY = Math.max(-limitY, Math.min(limitY, nextY));
    }

    const canStepTo = (nx, ny) => {
      if (!terrain) return true;
      const nextCell = terrain.getAt(nx, ny);
      if (nextCell.type === 'wall' || nextCell.type === 'cliff') return false;
      if (!currentCell) return true;
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
  }
}
