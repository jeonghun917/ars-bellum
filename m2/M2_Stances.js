// Formation stances: orders a formation carries out beyond where to go (the owner's season-2 design: the
// shield wall, the wedge, and the rest). Each kind of soldier has its own, in the order a commander learns
// them; how many a formation can use is its commander's tacticSlots (M2_Commanders.js: one, two at tactics
// 34, three at 67). A formation holds one stance at a time, or none.
//
// - shield_wall (방패진, foot): the men close up behind their shields; standing or advancing at a walk, each
//   one takes only blockMultiplier of the blows and bolts from his front; they move at half pace.
// - spear_brace (장창 대기, foot): spears set against horse; a horseman riding in fast is met with three times
//   the blow and his charge is broken, and his charge bonus is lost against them from the front; they hardly
//   move (a third of their pace).
// - wedge (쐐기진, horse): a tighter, harder charge: the charge strikes 1.3 times as hard and a crowd holds
//   them back half as much.
// - hit_and_run (치고 빠지기, horse): after each charge they wheel away 18 m and come again (a new run-up, a
//   new charge).
// - volley (일제 사격, crossbow): they hold until every man has spanned, then all loose together, each bolt
//   1.2 times as hard (the shock of a volley).

export const M2_STANCES = Object.freeze({
  shield_wall: Object.freeze({ id: "shield_wall", label: "방패진", kind: "infantry", speedScale: 0.5, blockMultiplier: 0.6, blockSpeed: 1.7 }),
  spear_brace: Object.freeze({ id: "spear_brace", label: "장창 대기", kind: "infantry", speedScale: 1 / 3, braceScale: 3 }),
  wedge: Object.freeze({ id: "wedge", label: "쐐기진", kind: "cavalry", speedScale: 1, chargeScale: 1.3, crowdDragScale: 0.5 }),
  hit_and_run: Object.freeze({ id: "hit_and_run", label: "치고 빠지기", kind: "cavalry", speedScale: 1, withdrawDistance: 18 }),
  volley: Object.freeze({ id: "volley", label: "일제 사격", kind: "crossbow", speedScale: 1, boltScale: 1.2 })
});

// Each kind's stances, in the order a commander learns them.
const BY_KIND = Object.freeze({
  infantry: Object.freeze(["shield_wall", "spear_brace"]),
  cavalry: Object.freeze(["wedge", "hit_and_run"]),
  crossbow: Object.freeze(["volley"])
});

// The stances this formation can use: as many of its kind's as its commander's tactics allow (one without
// a commander).
export function stancesFor(formation) {
  const slots = formation?.command?.tacticSlots ?? 1;
  return (BY_KIND[formation?.kindId] || []).slice(0, slots);
}

export function stanceOf(formation) {
  return formation?.stance ? M2_STANCES[formation.stance] || null : null;
}

// The stance of the formation a unit belongs to (none for the hero, who belongs to none).
export function unitStance(battleState, unit) {
  return unit?.formationId ? stanceOf(battleState.getFormation(unit.formationId)) : null;
}
