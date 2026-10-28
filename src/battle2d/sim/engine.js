// Combat between soldiers: arrows and bolts, cavalry charges, melee blows and pushing, and
// which enemy squads the allies can see.
//
// The engine only changes the simulation (hp, morale, momentum, positions) and reports what a
// player would see as plain events through onEvent. It never draws, and the randomness it uses
// (blow cooldowns) comes from the battle's seeded generator.

const CHARGE_DAMAGE = 15;
const CHARGE_MIN_MOMENTUM = 20;
const CHARGE_MORALE_HIT = 2;
const SHIELD_FRONT_ARC = Math.PI / 3;
const SHIELD_FRONT_MULTIPLIER = 0.2;
const RECOIL = 4;

const RANGED_PROFILES = Object.freeze({
  archer: { range: 250, heightRangeBonus: 50, cooldownMin: 1.5, cooldownMax: 2.0, defaultPierce: 0, color: '#e67e22' },
  crossbow: { range: 220, heightRangeBonus: 35, cooldownMin: 2.4, cooldownMax: 3.0, defaultPierce: 0.8, color: '#9b59b6' },
});

export class BattleEngine {
  // random: the battle's generator. terrain: optional. onEvent: optional, called with
  // { type: 'impact'|'text', x, y, text?, color?, chance } (chance is how often a viewer should show it).
  constructor({ random, terrain = null, onEvent = null }) {
    this.random = random;
    this.terrain = terrain;
    this.onEvent = onEvent;
  }

  emit(event) {
    if (this.onEvent) this.onEvent(event);
  }

  // A shield takes 80% off blows that come from its front arc.
  getDamageMultiplier(attacker, defender) {
    if (defender.squad.subType !== 'shield') return 1.0;
    const angleToAttacker = Math.atan2(attacker.y - defender.y, attacker.x - defender.x);
    const rawDifference = Math.abs(angleToAttacker - defender.squad.angle);
    const angleDifference = Math.abs(Math.atan2(Math.sin(rawDifference), Math.cos(rawDifference)));
    return angleDifference < SHIELD_FRONT_ARC ? SHIELD_FRONT_MULTIPLIER : 1.0;
  }

  getRangedProfile(soldier) {
    if (!soldier || !soldier.squad) return null;
    const profile = RANGED_PROFILES[soldier.squad.subType];
    if (!profile) return null;
    return {
      range: profile.range,
      heightRangeBonus: profile.heightRangeBonus,
      cooldownMin: profile.cooldownMin,
      cooldownMax: profile.cooldownMax,
      damage: Number(soldier.rangedDmg) || Number(soldier.dmg) || 1,
      armorPierce: Math.max(0, Math.min(1, Number(soldier.armorPierce) || profile.defaultPierce)),
      color: profile.color,
    };
  }

  heightAt(x, y) {
    return this.terrain ? Number(this.terrain.getAt(x, y).h || 0) : 0;
  }

  nearestEnemySoldier(attacker, squads) {
    let target = null;
    let nearest = Infinity;
    for (const squad of squads) {
      if (squad.team === attacker.squad.team) continue;
      for (const unit of squad.units) {
        if (unit.hp <= 0) continue;
        const distance = Math.hypot(unit.x - attacker.x, unit.y - attacker.y);
        if (distance < nearest) {
          nearest = distance;
          target = unit;
        }
      }
    }
    return target;
  }

  updateRangedAttacks(squads, soldiers) {
    for (const attacker of soldiers) {
      if (attacker.hp <= 0 || attacker.attackCooldown > 0) continue;
      const profile = this.getRangedProfile(attacker);
      if (!profile) continue;
      const ammo = Number(attacker.ammo);
      if (Number.isFinite(ammo) && ammo <= 0) continue;

      const target = this.nearestEnemySoldier(attacker, squads);
      if (!target) continue;

      // Shooting downhill reaches further and hits harder.
      const heightBonus = Math.max(0, this.heightAt(attacker.x, attacker.y) - this.heightAt(target.x, target.y));
      const maximumRange = profile.range + heightBonus * profile.heightRangeBonus;
      const distance = Math.hypot(target.x - attacker.x, target.y - attacker.y);
      const hasLineOfSight = !this.terrain || this.terrain.raycast(attacker.x, attacker.y, target.x, target.y);
      if (distance >= maximumRange || !hasLineOfSight) continue;

      const blockMultiplier = this.getDamageMultiplier(attacker, target);
      const effectiveArmor = Math.max(0, Number(target.armor) || 0) * (1 - profile.armorPierce);
      const actualDamage = Math.max(1, profile.damage - effectiveArmor) * blockMultiplier * (1 + heightBonus * 0.5);

      target.hp -= actualDamage;
      if (Number.isFinite(ammo)) attacker.ammo = Math.max(0, ammo - 1);
      attacker.attackCooldown = profile.cooldownMin + this.random.next() * (profile.cooldownMax - profile.cooldownMin);

      if (blockMultiplier < 1) {
        this.emit({ type: 'text', x: target.x, y: target.y, text: 'BLOCKED!', color: '#bdc3c7', chance: 0.4 });
      } else {
        this.emit({ type: 'text', x: target.x, y: target.y, text: `-${actualDamage.toFixed(1)}`, color: profile.color, chance: 0.4 });
      }
      this.emit({ type: 'impact', x: target.x, y: target.y, chance: 1 });
    }
  }

  // One cavalry soldier running into one enemy soldier.
  charge(rider, victim) {
    const wedgeBonus = rider.squad.currentFormation === 'wedge' ? 1.5 : 1.0;
    victim.hp -= CHARGE_DAMAGE * this.getDamageMultiplier(rider, victim) * wedgeBonus;
    victim.squad.morale -= CHARGE_MORALE_HIT;
    rider.squad.momentum -= victim.mass * 0.5;
    this.emit({ type: 'impact', x: victim.x, y: victim.y, chance: 0.3 });
  }

  // A normal blow: armor takes off damage (at least 1), the striker steps back a little.
  strike(striker, victim, towardX, towardY, distance) {
    const damage = Math.max(1, striker.dmg - victim.armor) * this.getDamageMultiplier(striker, victim);
    victim.hp -= damage;
    striker.attackCooldown = 1.0 + this.random.next() * 0.5;
    const recoilX = striker.x - towardX * RECOIL;
    const recoilY = striker.y - towardY * RECOIL;
    if (!this.terrain || this.terrain.canMoveTo(striker.x, striker.y, recoilX, recoilY)) {
      striker.x = recoilX;
      striker.y = recoilY;
    }
    this.emit({ type: 'text', x: victim.x, y: victim.y, text: `-${damage.toFixed(1)}`, color: '#ff7675', chance: 0.3 });
  }

  tryMove(unit, x, y) {
    if (!this.terrain || this.terrain.canMoveTo(unit.x, unit.y, x, y)) {
      unit.x = x;
      unit.y = y;
    }
  }

  // Two touching soldiers of opposing teams: charges first, then each blow whose cooldown is over.
  // Anyone who died earlier in the exchange takes no further part.
  fight(u1, u2, dx, dy, dist) {
    const u1Charges = u1.squad.type === 'cavalry' && u1.squad.momentum > CHARGE_MIN_MOMENTUM;
    const u2Charges = u2.squad.type === 'cavalry' && u2.squad.momentum > CHARGE_MIN_MOMENTUM;
    if (u1Charges && u1.hp > 0 && u2.hp > 0) this.charge(u1, u2);
    if (u2Charges && u1.hp > 0 && u2.hp > 0) this.charge(u2, u1);
    if (u1.attackCooldown <= 0 && u1.hp > 0 && u2.hp > 0) this.strike(u1, u2, dx / dist, dy / dist, dist);
    if (u2.attackCooldown <= 0 && u2.hp > 0 && u1.hp > 0) this.strike(u2, u1, -dx / dist, -dy / dist, dist);
  }

  // Overlapping soldiers push each other apart in proportion to mass; a shield wall counts five times heavier.
  separate(u1, u2, dx, dy, dist, overlap) {
    const m1 = u1.squad.currentFormation === 'shield_wall' ? u1.mass * 5 : u1.mass;
    const m2 = u2.squad.currentFormation === 'shield_wall' ? u2.mass * 5 : u2.mass;
    const push1 = (m2 / (m1 + m2)) * overlap;
    const push2 = (m1 / (m1 + m2)) * overlap;
    this.tryMove(u1, u1.x - (dx / dist) * push1, u1.y - (dy / dist) * push1);
    this.tryMove(u2, u2.x + (dx / dist) * push2, u2.y + (dy / dist) * push2);
  }

  // combatEnabled is false while the armies deploy: soldiers still push each other apart,
  // but nobody shoots, charges or strikes.
  update(squads, dt, combatEnabled = true) {
    if (dt === 0) return;
    const soldiers = squads.flatMap((squad) => squad.units);
    if (combatEnabled) this.updateRangedAttacks(squads, soldiers);

    for (let i = 0; i < soldiers.length; i += 1) {
      for (let j = i + 1; j < soldiers.length; j += 1) {
        const u1 = soldiers[i];
        const u2 = soldiers[j];
        // A soldier killed earlier this step (by arrows or an earlier pair) neither strikes,
        // charges, is struck nor pushes others.
        if (u1.hp <= 0 || u2.hp <= 0) continue;
        const dx = u2.x - u1.x;
        const dy = u2.y - u1.y;
        const dist = Math.hypot(dx, dy);
        const engageDist = u1.radius + u2.radius + 2;
        if (dist >= engageDist || dist <= 0) continue;
        if (combatEnabled && u1.squad.team !== u2.squad.team) this.fight(u1, u2, dx, dy, dist);
        this.separate(u1, u2, dx, dy, dist, engageDist - dist);
      }
    }
  }

  // An enemy squad is visible when any of its soldiers is inside some living ally squad's
  // vision radius with a clear line of sight.
  updateVision(squads) {
    const allies = squads.filter((squad) => squad.team === 'ally' && squad.units.length > 0);
    for (const enemy of squads) {
      if (enemy.team !== 'enemy' || enemy.units.length === 0) continue;
      enemy.visible = false;
      for (const unit of enemy.units) {
        for (const ally of allies) {
          const inRange = Math.hypot(unit.x - ally.centerX, unit.y - ally.centerY) < ally.vision;
          if (inRange && (!this.terrain || this.terrain.raycast(ally.centerX, ally.centerY, unit.x, unit.y))) {
            enemy.visible = true;
            break;
          }
        }
        if (enemy.visible) break;
      }
    }
  }
}
