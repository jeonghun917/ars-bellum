// Unit data: soldier stats per sub-type and the squad kinds the armies are built from.

// hp, armor (subtracted from each blow), dmg (melee blow), mass (pushing), radius (body size).
// Archers and crossbowmen also carry ammo, a ranged damage and how much of the target's armor they ignore.
export const SOLDIER_STATS = Object.freeze({
  shield: { hp: 180, armor: 8, dmg: 1.5, mass: 5.0, radius: 9 },
  shock: { hp: 55, armor: 3, dmg: 9, mass: 1.5, radius: 8 },
  pike: { hp: 45, armor: 2, dmg: 5, mass: 3.5, radius: 8 },
  heavy_cav: { hp: 250, armor: 8, dmg: 2.5, mass: 12.0, radius: 13 },
  light_cav: { hp: 45, armor: 2, dmg: 3, mass: 2.0, radius: 10 },
  crossbow: { hp: 35, armor: 2, dmg: 4, mass: 1.0, radius: 7, ammo: 15, rangedDmg: 12, armorPierce: 0.8 },
  archer: { hp: 25, armor: 0, dmg: 4, mass: 0.8, radius: 7, ammo: 40, rangedDmg: 8, armorPierce: 0 },
});

// Everything else (skirmishers, spearmen): light infantry.
export const DEFAULT_SOLDIER_STATS = Object.freeze({ hp: 30, armor: 1, dmg: 3, mass: 1.0, radius: 8 });

// type groups sub-types for speed and vision; tier 1 squads break and run when their morale drops.
export const SQUAD_KINDS = Object.freeze({
  shield: { type: 'infantry', tier: 2, label: '방패병' },
  shock: { type: 'infantry', tier: 2, label: '충격보병' },
  pike: { type: 'infantry', tier: 2, label: '장창병' },
  archer: { type: 'archer', tier: 1, label: '궁병대' },
  crossbow: { type: 'archer', tier: 1, label: '석궁병' },
  skirmisher: { type: 'skirmisher', tier: 1, label: '척후병' },
  heavy_cav: { type: 'cavalry', tier: 3, label: '중기병' },
  light_cav: { type: 'cavalry', tier: 2, label: '경기병' },
});

export const SQUAD_SUBTYPES = Object.freeze(Object.keys(SQUAD_KINDS));

export function statsFor(subType) {
  return SOLDIER_STATS[subType] || DEFAULT_SOLDIER_STATS;
}
