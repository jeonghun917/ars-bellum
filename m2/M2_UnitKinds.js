// What each soldier fights as: on foot with spear or sword ("infantry"), with a crossbow ("crossbow") or on
// a horse ("cavalry"). The launch snapshot has no field for it yet, so the kind comes with the formation:
// each side's loose formation carries crossbows and its column rides. Formations not listed are infantry.

export const M2_UNIT_KINDS = Object.freeze({
  infantry: Object.freeze({
    id: "infantry",
    speedScale: 1,
    spacingScale: 1,
    meleeRange: 1.6,
    meleeDamage: 10
  }),
  // A crossbowman shoots the nearest enemy in range when his formation is ordered to attack, and keeps his
  // distance (standOff, m) instead of closing in. The cooldown is the shot and the reload as drawn (the
  // "x_shoot" and "x_reload" clips, 1.2 s + 3.2 s at 20 ticks a second).
  crossbow: Object.freeze({
    id: "crossbow",
    speedScale: 1,
    spacingScale: 1,
    meleeRange: 0,
    meleeDamage: 0,
    standOff: 14,
    range: 20,
    boltSpeed: 30,
    boltDamage: 18,
    boltMaxRange: 24,
    reloadTicks: 88
  }),
  // A horseman moves at about a canter's pace and reaches further from the saddle. Striking after riding
  // faster than chargeSpeed (m/s) for chargeRunTicks in a row (a run-up of about 5 m) is a charge:
  // chargeScale times the damage. The charge is spent on that blow; riding on through the enemy at speed
  // does not renew it, only a new run-up does.
  cavalry: Object.freeze({
    id: "cavalry",
    speedScale: 1.75,
    // A horse is about 2.4 m long: a column at the infantry's 1.25 m would stack them on one another.
    spacingScale: 2.2,
    meleeRange: 2.2,
    meleeDamage: 12,
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
