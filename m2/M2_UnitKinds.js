// What each soldier fights as: on foot with spear or sword ("infantry"), with a crossbow ("crossbow") or on
// a horse ("cavalry"). The launch snapshot has no field for it yet, so the kind comes with the formation:
// each side's loose formation carries crossbows and its column rides. Formations not listed are infantry.

// Pace: soldiers run to their places (speedScale is the running speed against a man on foot) and walk
// (walkScale of it) only for the last walkDistance metres, settling into line. A blow lands every
// meleeCooldownTicks (1.5 s), not every half second. A soldier stands hpScale times his vitality in hits:
// mail and a horse, in place of the equipment the battle does not carry yet; a 20-v-20 fight lasts about two
// minutes. Each soldier is a circle of radius (m) on the field that others cannot enter; mass says who gives
// way when two push. Every enemy body a soldier presses against slows him by crowdDrag of his speed, so a horse
// breaks through a line one man deep but is held by a block two or more deep (the owner's season-2 design:
// cavalry that hits a thick block is trapped).
export const M2_UNIT_KINDS = Object.freeze({
  infantry: Object.freeze({
    id: "infantry",
    hpScale: 2.5,
    speedScale: 1,
    walkScale: 0.45,
    walkDistance: 3,
    crowdDrag: 0.25,
    spacingScale: 1,
    radius: 0.35,
    mass: 1,
    meleeRange: 1.6,
    meleeDamage: 3,
    meleeCooldownTicks: 30
  }),
  // A crossbowman shoots the nearest enemy in range when his formation is ordered to attack, and keeps his
  // distance (standOff, m) instead of closing in. The cooldown is the shot and the reload as drawn (the
  // "x_shoot" and "x_reload" clips, 1.2 s + 3.2 s at 20 ticks a second).
  crossbow: Object.freeze({
    id: "crossbow",
    hpScale: 2,
    speedScale: 1,
    walkScale: 0.45,
    walkDistance: 3,
    crowdDrag: 0.25,
    spacingScale: 1,
    radius: 0.35,
    mass: 1,
    meleeCooldownTicks: 30,
    meleeRange: 0,
    meleeDamage: 0,
    standOff: 14,
    range: 20,
    boltSpeed: 30,
    boltDamage: 8,
    boltMaxRange: 24,
    reloadTicks: 88
  }),
  // A horseman moves at about a canter's pace and reaches further from the saddle. Striking after riding
  // faster than chargeSpeed (m/s) for chargeRunTicks in a row (a run-up of about 5 m) is a charge:
  // chargeScale times the damage. The charge is spent on that blow; riding on through the enemy at speed
  // does not renew it, only a new run-up does.
  cavalry: Object.freeze({
    id: "cavalry",
    hpScale: 3,
    speedScale: 1.75,
    // Walking (1.7 m/s, the horse's walking clip) only to settle into place; a gallop otherwise.
    walkScale: 0.3,
    walkDistance: 4,
    crowdDrag: 0.25,
    radius: 0.8,
    mass: 4,
    meleeCooldownTicks: 30,
    // A horse is about 2.4 m long: a column at the infantry's 1.25 m would stack them on one another.
    spacingScale: 2.2,
    meleeRange: 2.2,
    meleeDamage: 4,
    chargeSpeed: 3.5,
    chargeRunTicks: 20,
    chargeScale: 2.5
  })
});

const FORMATION_KINDS = Object.freeze({
  ally_loose: "crossbow",
  enemy_loose: "crossbow",
  ally_column: "cavalry",
  enemy_column: "cavalry"
});

export function m2UnitKindForFormation(formationId) {
  return FORMATION_KINDS[formationId] || "infantry";
}

export function m2UnitKind(unitOrKindId) {
  const id = typeof unitOrKindId === "string" ? unitOrKindId : unitOrKindId?.kindId;
  return M2_UNIT_KINDS[id] || M2_UNIT_KINDS.infantry;
}
