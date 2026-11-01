// Formation orders (부대 명령): how a formation fights, beside where it goes (its move or attack order) and
// what shape it stands in (its formation type: line, column, loose, shield wall, wedge, ring). None of them
// makes a blow or a bolt stronger (the owner, 2026-11-01: no added effects); each changes what the men do,
// and what follows comes from that.
//
// Foot and horse:
// - charge (돌격): break ranks and run every man at the nearest enemy of the target, instead of keeping his
//   place in the formation.
// - spear_brace (장창 대기, foot): plant the spears and stand: the formation does not move, each man faces the
//   nearest horseman, and he does not give way when a horse runs into him (a horse is held by a wall of men
//   who will not step aside).
// - hit_and_run (치고 빠지기, horse): after each charge, wheel 18 m away and come again (a new run-up, so a
//   new charge).
// - flank (측면 우회, foot and horse): attack round the side of the target and into its rear, instead of
//   straight at its front.
// Crossbowmen:
// - hold_fire (사격 중지): do not shoot.
// - focus_fire (집중 사격): shoot only at the formation they are ordered to attack.
// - volley (일제 사격): wait until every man has spanned his crossbow, then all loose together.
// - skirmish (견제 사격): keep shooting, and step back 8 m from any enemy who comes within 10.
//
// The first order of each kind (charge; hold fire) any formation can be given. The rest, a formation can be
// given as many as its commander's tacticSlots (M2_Commanders.js: one, two at tactics 34, three at 67), in
// the order listed. A formation carries out one order at a time, or none.

export const M2_ORDERS = Object.freeze({
  charge: Object.freeze({ id: "charge", label: "돌격" }),
  spear_brace: Object.freeze({ id: "spear_brace", label: "장창 대기", braceMass: 50 }),
  hit_and_run: Object.freeze({ id: "hit_and_run", label: "치고 빠지기", withdrawDistance: 18 }),
  flank: Object.freeze({ id: "flank", label: "측면 우회", sideDistance: 12 }),
  hold_fire: Object.freeze({ id: "hold_fire", label: "사격 중지" }),
  focus_fire: Object.freeze({ id: "focus_fire", label: "집중 사격" }),
  volley: Object.freeze({ id: "volley", label: "일제 사격" }),
  skirmish: Object.freeze({ id: "skirmish", label: "견제 사격", keepAway: 10, stepBack: 8 })
});

const ALWAYS = Object.freeze({ infantry: ["charge"], cavalry: ["charge"], crossbow: ["hold_fire"] });
const LEARNED = Object.freeze({
  infantry: ["spear_brace", "flank"],
  cavalry: ["hit_and_run", "flank"],
  crossbow: ["focus_fire", "volley", "skirmish"]
});

// The orders this formation can be given.
export function ordersFor(formation) {
  const kind = formation?.kindId;
  const slots = formation?.command?.tacticSlots ?? 1;
  return [...(ALWAYS[kind] || []), ...(LEARNED[kind] || []).slice(0, slots)];
}

export function orderOf(formation) {
  return formation?.tactic ? M2_ORDERS[formation.tactic] || null : null;
}

// The order of the formation a unit belongs to (none for the hero, who belongs to none).
export function unitOrder(battleState, unit) {
  return unit?.formationId ? orderOf(battleState.getFormation(unit.formationId)) : null;
}
