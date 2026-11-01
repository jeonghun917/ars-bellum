// What each soldier fights as: on foot with spear or sword ("infantry"), with a crossbow ("crossbow") or on
// a horse ("cavalry"). The launch snapshot has no field for it yet, so the kind comes with the formation:
// each side's loose formation carries crossbows and its column rides. Formations not listed are infantry.

// Pace (the owner's season-2 design: a heavy, slow battlefield): a formation marches at marchScale times
// the running speed and breaks into a run only for the last chargeDistance metres of an attack (and when
// routing). speedScale is the running speed against a man on foot. A blow lands every meleeCooldownTicks
// (1.5 s), not every half second. A soldier stands hpScale times his vitality in hits: mail and a
// horse, in place of the equipment the battle does not carry yet; a 20-v-20 fight lasts about two minutes. Each soldier is a circle of radius (m) on the field that others cannot
// enter; mass says who gives way when two push (a horse shoves men aside).
export const M2_UNIT_KINDS = Object.freeze({
  infantry: Object.freeze({
    id: "infantry",
    hpScale: 2.5,
    speedScale: 1,
    marchScale: 0.45,
    chargeDistance: 10,
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
    marchScale: 0.45,
    chargeDistance: 0,
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
    // A walk (1.7 m/s, the horse's walking clip) until the charge: the last 20 m at a gallop.
    marchScale: 0.3,
    chargeDistance: 20,
    radius: 0.8,
    mass: 6,
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
