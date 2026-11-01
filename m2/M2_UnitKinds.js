// What each soldier fights as: on foot with spear or sword ("infantry"), with a crossbow ("crossbow") or on
// a horse ("cavalry"). The launch snapshot has no field for it yet, so the kind comes with the formation:
// each side's loose formation carries crossbows and its column rides. Formations not listed are infantry.

// Pace: soldiers run to their places (speedScale is the running speed against a man on foot) and walk
// (walkScale of it) only for the last walkDistance metres, settling into line. A blow lands every
// meleeCooldownTicks (1.5 s), not every half second. Blows are meant to hurt (the owner, 2026-11-01: "a sword,
// not a pencil"): a man without armour has hpScale times his vitality in hit points, about 30, and falls to
// three or four blows; what he wears (M2_ARMOR_VALUES) makes him last longer, and what keeps a fight going
// for about two minutes is that men stop most blows aimed at their front (M2_Defense.js). Each soldier is a circle of radius (m) on the field that others cannot enter; mass says who gives
// way when two push. Every enemy body a soldier presses against slows him by crowdDrag of his speed, so a horse
// breaks through a line one man deep but is held by a block two or more deep (the owner's season-2 design:
// cavalry that hits a thick block is trapped).
export const M2_UNIT_KINDS = Object.freeze({
  infantry: Object.freeze({
    id: "infantry",
    hpScale: 0.5,
    speedScale: 1,
    walkScale: 0.45,
    walkDistance: 3,
    crowdDrag: 0.25,
    spacingScale: 1,
    radius: 0.35,
    mass: 1,
    meleeRange: 1.6,
    meleeDamage: 9,
    meleeCooldownTicks: 30
  }),
  // A crossbowman shoots the nearest enemy in range when his formation is ordered to attack, and keeps his
  // distance (standOff, m) instead of closing in. The cooldown is the shot and the reload as drawn (the
  // "x_shoot" and "x_reload" clips, 1.2 s + 3.2 s at 20 ticks a second).
  crossbow: Object.freeze({
    id: "crossbow",
    hpScale: 0.4,
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
    boltDamage: 24,
    boltMaxRange: 24,
    reloadTicks: 88
  }),
  // A horseman moves at about a canter's pace and reaches further from the saddle. Striking after riding
  // faster than chargeSpeed (m/s) for chargeRunTicks in a row (a run-up of about 5 m) is a charge:
  // chargeScale times the damage. The charge is spent on that blow; riding on through the enemy at speed
  // does not renew it, only a new run-up does.
  cavalry: Object.freeze({
    id: "cavalry",
    hpScale: 0.6,
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
    meleeDamage: 12,
    chargeSpeed: 3.5,
    chargeRunTicks: 20,
    chargeScale: 2.5
  })
});

// The subtypes (병종) of the owner's season-2 design (전투 엔진 시즌 2 재설계 기획서, section 2): each is one of
// the three kinds above (its kindId: how it fights, which shapes and orders it has, which commander leads it)
// with its own body and equipment. No added effects (the owner, 2026-10-31): a subtype differs only in what it
// carries and how it is built (armor, weight, reach, reload, range, bolts), not in multipliers on its blows.
// - shield (방패병): heavy shield and mail, heavy to push; his shield is up against bolts from the front.
// - pike (장창병): a long pike that reaches a horseman before the horseman reaches him.
// - shock (충격보병): in leather, heavy blows.
// - skirmisher (척후병): in leather, weak; his wide sight (visionRange) is for the fog of war (a later step).
// - crossbow (석궁병): slow to reload, few bolts, bolts that go through armor.
// - longbow (장궁병): quick to shoot and far, many arrows that armor and shields stop.
// - light_cav (경기병): quick and quick to a charge, in leather.
// - heavy_cav (중기병): slow to a charge, heavy and armored, long to bring down.
// Armour is what he wears (armorId: M2_ARMOR_VALUES, as the hero's: armor 20 halves a blow); armorPierce: the share of the target's
// armor a bolt goes through. ammo: bolts or arrows carried; with none left the man fights with his short
// sword (sidearm). frontShield: his shield stops bolts and arrows from in front as a block does.
// armorId and helmId: what he is drawn wearing (mail, leather or plate; the nasal helm, a leather cap or the
// great helm: M2_RendererThree.js), the kind's mail and nasal helm unless the subtype says otherwise. A
// formation's launch snapshot can change either (formation.armorId, formation.helmId), so they can be swapped
// at any time, and what he wears is what stops blows: mail 15, leather 7, plate 30 (the owner, 2026-11-01:
// better armour, harder to bring down).
export const M2_ARMORS = Object.freeze(["mail", "leather", "plate"]);
export const M2_HELMS = Object.freeze(["nasal", "leather", "great"]);
export const M2_ARMOR_VALUES = Object.freeze({ mail: 15, leather: 7, plate: 30 });
const SIDEARM = Object.freeze({ meleeRange: 1.4, meleeDamage: 6 });
const subtype = (kindId, label, values) => Object.freeze({ ...M2_UNIT_KINDS[kindId], id: values.id, kindId, label, ...values });
export const M2_UNIT_TYPES = Object.freeze({
  shield: subtype("infantry", "방패병", { id: "shield", hpScale: 0.5, meleeDamage: 6, mass: 2.5, speedScale: 0.9, frontShield: true }),
  pike: subtype("infantry", "장창병", { id: "pike", hpScale: 0.45, meleeDamage: 9, meleeRange: 2.8 }),
  shock: subtype("infantry", "충격보병", { id: "shock", hpScale: 0.4, meleeDamage: 15, speedScale: 1.1, armorId: "leather", helmId: "leather" }),
  skirmisher: subtype("infantry", "척후병", { id: "skirmisher", hpScale: 0.35, meleeDamage: 6, speedScale: 1.15, visionRange: 45, armorId: "leather", helmId: "leather" }),
  crossbow: subtype("crossbow", "석궁병", { id: "crossbow", armorPierce: 0.8, ammo: 15, sidearm: SIDEARM }),
  longbow: subtype("crossbow", "장궁병", { id: "longbow", hpScale: 0.35, range: 26, standOff: 18, boltSpeed: 34, boltMaxRange: 30, boltDamage: 18, reloadTicks: 44, armorPierce: 0, ammo: 30, sidearm: SIDEARM, armorId: "leather", helmId: "leather" }),
  light_cav: subtype("cavalry", "경기병", { id: "light_cav", hpScale: 0.5, meleeDamage: 10, speedScale: 2.0, mass: 3, chargeRunTicks: 12, armorId: "leather", helmId: "leather" }),
  heavy_cav: subtype("cavalry", "중기병", { id: "heavy_cav", hpScale: 0.7, meleeDamage: 14, speedScale: 1.55, mass: 6, chargeRunTicks: 24, armorId: "plate", helmId: "great" })
});

// The weapons a soldier carries (the soldier model's clip sets: M2_RendererThree.js), given to the men of each
// subtype or kind in turn: spear or sword with a shield ("spear", "sword"), a spear in both hands
// ("spear_free"), a sword alone ("sword_free"), a longsword ("great"), the crossbow, the lance or the sword on
// horseback ("cav", "cavs"). Shock foot carry the axe (in the sword's place) or the glaive (in the spear's).
export const M2_LOADOUTS = Object.freeze({
  infantry: Object.freeze(["spear", "sword", "spear_free", "sword_free", "great"]),
  crossbow: Object.freeze(["xbow"]),
  cavalry: Object.freeze(["cav", "cavs"]),
  shield: Object.freeze(["sword"]),
  pike: Object.freeze(["spear", "sword", "spear_free", "sword_free", "great"]),
  shock: Object.freeze(["sword_free", "spear_free"]),
  skirmisher: Object.freeze(["sword"]),
  crossbow_type: Object.freeze(["xbow"]),
  longbow: Object.freeze(["xbow"]),
  light_cav: Object.freeze(["cavs"]),
  heavy_cav: Object.freeze(["cav"])
});
export function m2LoadoutsFor(unit) {
  if (unit.unitTypeId === "crossbow") return M2_LOADOUTS.crossbow_type;
  return M2_LOADOUTS[unit.unitTypeId] || M2_LOADOUTS[unit.kindId] || M2_LOADOUTS.infantry;
}
// What a loadout defends with: a shield (spear or sword with a shield, and the shield-bearers' sword), a
// weapon held in both hands (a better parry), or a weapon in one hand alone.
export function m2LoadoutGuard(loadout) {
  if (loadout === "spear" || loadout === "sword") return "shield";
  if (loadout === "spear_free" || loadout === "great" || loadout === "cav") return "two_handed";
  return "one_handed";
}

const FORMATION_KINDS = Object.freeze({
  ally_loose: "crossbow",
  enemy_loose: "crossbow",
  ally_column: "cavalry",
  enemy_column: "cavalry"
});

// (A larger battle numbers its formations: "ally_loose_2" carries crossbows as "ally_loose" does.)
export function m2UnitKindForFormation(formationId) {
  return FORMATION_KINDS[String(formationId).replace(/_\d+$/, "")] || "infantry";
}

// A formation's subtype: the one its snapshot names (formation.unitTypeId), if it is of the formation's kind;
// otherwise none (the kind's own soldiers, as before subtypes).
export function m2UnitTypeForFormation(source) {
  const type = M2_UNIT_TYPES[source?.unitTypeId];
  return type && type.kindId === m2UnitKindForFormation(source.formationId) ? type.id : null;
}

// What a formation's men are drawn wearing: the snapshot's choice for the formation, else its subtype's, else
// mail and the nasal helm.
export function m2AppearanceForFormation(source) {
  const type = M2_UNIT_TYPES[m2UnitTypeForFormation(source)];
  return {
    armorId: M2_ARMORS.includes(source?.armorId) ? source.armorId : type?.armorId || "mail",
    helmId: M2_HELMS.includes(source?.helmId) ? source.helmId : type?.helmId || "nasal"
  };
}

// A soldier's (or formation's) numbers: its subtype's, else its kind's. Given a string, the kind of that id
// (or, failing that, the subtype): "crossbow" is the kind, the crossbowmen of before subtypes, without the
// 석궁병's bolt count or armor-piercing bolts.
export function m2UnitKind(unitOrKindId) {
  if (typeof unitOrKindId === "string") return M2_UNIT_KINDS[unitOrKindId] || M2_UNIT_TYPES[unitOrKindId] || M2_UNIT_KINDS.infantry;
  return M2_UNIT_TYPES[unitOrKindId?.unitTypeId] || M2_UNIT_KINDS[unitOrKindId?.kindId] || M2_UNIT_KINDS.infantry;
}
