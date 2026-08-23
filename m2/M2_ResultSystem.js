import { M2_MORALE_DEFINITION, M2_RESULT_DEFINITION } from "./M2_Definitions.js";

function isM2UnitAlive(unit) { return Boolean(unit) && unit.hp > 0 && unit.state !== "incapacitated" && unit.state !== "dead"; }
const HASH_PATTERN = /^fnv1a32:[0-9a-f]{8}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9_.:-]*$/i;
const TOP_LEVEL_KEYS = Object.freeze(["battleId","outcome","unitLosses","experienceDeltas","moraleDeltas","lootPreview","commandLogHash","resultSummaryHash"].sort());
function round2(value) { return Math.round(value * 100) / 100; }
function isPlainObject(value) { if (!value || typeof value !== "object" || Array.isArray(value)) return false; const proto = Object.getPrototypeOf(value); return proto === Object.prototype || proto === null; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function freezeDeep(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freezeDeep(child); return value; }
function canonicalSerialize(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError("m2_result_non_finite_number"); return JSON.stringify(Object.is(value, -0) ? 0 : value); }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalSerialize(entry)).join(",")}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalSerialize(value[key])}`).join(",")}}`;
  throw new TypeError("m2_result_non_canonical_value");
}
function fnv1a32(text) { let hash = 0x811c9dc5; for (const byte of new TextEncoder().encode(text)) { hash ^= byte; hash = Math.imul(hash, 0x01000193); } return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`; }
function hashCanonical(value) { return fnv1a32(canonicalSerialize(value)); }
function sideRetreatComplete(battleState, sideId) {
  const living = battleState.getUnitIdsStable().map((id) => battleState.getUnit(id)).filter((unit) => unit.sideId === sideId && isM2UnitAlive(unit));
  if (!living.length) return false;
  return sideId === "ally" ? living.every((unit) => unit.position.z >= M2_MORALE_DEFINITION.retreatEdgeZ) : living.every((unit) => unit.position.z <= -M2_MORALE_DEFINITION.retreatEdgeZ);
}
function exactKeys(object, expected) { return JSON.stringify(Object.keys(object).sort()) === JSON.stringify(expected); }

export class M2ResultSystem {
  evaluate(battleState, { commands = [] } = {}) {
    if (battleState.getResult() !== null) return null;
    if (commands.some((command) => command.type === "battle_abort")) return "aborted";
    let allyLiving = 0, enemyLiving = 0;
    battleState.forEachUnitStable((unit) => { if (!isM2UnitAlive(unit)) return; if (unit.sideId === "ally") allyLiving += 1; else if (unit.sideId === "enemy") enemyLiving += 1; });
    if (allyLiving === 0 && enemyLiving === 0) return "aborted";
    if (enemyLiving === 0 && allyLiving > 0) return "ally_victory";
    if (allyLiving === 0 && enemyLiving > 0) return "enemy_victory";
    const allyRetreat = sideRetreatComplete(battleState, "ally"), enemyRetreat = sideRetreatComplete(battleState, "enemy");
    if (allyRetreat && enemyRetreat) return "aborted";
    if (allyRetreat) return "ally_retreat";
    if (enemyRetreat) return "enemy_retreat";
    return null;
  }

  build(battleState, { outcome, acceptedCommandLog = [] } = {}) {
    if (!M2_RESULT_DEFINITION.outcomes.includes(outcome)) throw new Error("m2_result_outcome_invalid");
    const unitLosses = [], moraleDeltas = [];
    for (const unitId of battleState.getUnitIdsStable()) {
      const unit = battleState.getUnit(unitId);
      if (unit.state === "incapacitated" || unit.state === "dead") unitLosses.push({ unitId: unit.unitId, sideId: unit.sideId, finalState: unit.state });
      const from = Number(unit.initialMorale), to = Number(unit.morale);
      moraleDeltas.push({ unitId: unit.unitId, sideId: unit.sideId, from, to, delta: round2(to - from) });
    }
    const commandLogHash = hashCanonical(acceptedCommandLog);
    const summary = { battleId: battleState.battleId, outcome, unitLosses, experienceDeltas: [], moraleDeltas, lootPreview: [], commandLogHash };
    return freezeDeep({ ...summary, resultSummaryHash: hashCanonical(summary) });
  }

  validate(candidate, battleState, acceptedCommandLog = []) {
    const fail = (error) => Object.freeze({ ok: false, error });
    if (!isPlainObject(candidate) || !exactKeys(candidate, TOP_LEVEL_KEYS)) return fail("m2_result_schema_keys_invalid");
    if (!ID_PATTERN.test(candidate.battleId) || candidate.battleId !== battleState.battleId) return fail("m2_result_battle_id_invalid");
    if (!M2_RESULT_DEFINITION.outcomes.includes(candidate.outcome)) return fail("m2_result_outcome_invalid");
    if (!Array.isArray(candidate.unitLosses) || !Array.isArray(candidate.experienceDeltas) || !Array.isArray(candidate.moraleDeltas) || !Array.isArray(candidate.lootPreview)) return fail("m2_result_arrays_invalid");
    if (candidate.experienceDeltas.length !== 0 || candidate.lootPreview.length !== 0) return fail("m2_result_noncanonical_preview_invalid");
    if (!HASH_PATTERN.test(candidate.commandLogHash) || !HASH_PATTERN.test(candidate.resultSummaryHash)) return fail("m2_result_hash_format_invalid");

    let previous = null; const lossIds = new Set();
    for (const loss of candidate.unitLosses) {
      if (!isPlainObject(loss) || !exactKeys(loss, ["finalState","sideId","unitId"])) return fail("m2_result_unit_loss_schema_invalid");
      if (!ID_PATTERN.test(loss.unitId) || !["ally","enemy"].includes(loss.sideId) || !["incapacitated","dead"].includes(loss.finalState)) return fail("m2_result_unit_loss_value_invalid");
      if (previous !== null && previous.localeCompare(loss.unitId) >= 0) return fail("m2_result_unit_loss_order_invalid");
      previous = loss.unitId;
      if (lossIds.has(loss.unitId)) return fail("m2_result_unit_loss_duplicate");
      lossIds.add(loss.unitId);
      const unit = battleState.getUnit(loss.unitId);
      if (!unit || unit.sideId !== loss.sideId || unit.state !== loss.finalState) return fail("m2_result_unit_loss_state_mismatch");
    }
    const expectedLossIds = battleState.getUnitIdsStable().filter((id) => { const state = battleState.getUnit(id).state; return state === "incapacitated" || state === "dead"; });
    if (JSON.stringify([...lossIds]) !== JSON.stringify(expectedLossIds)) return fail("m2_result_unit_loss_membership_invalid");

    const expectedUnitIds = battleState.getUnitIdsStable();
    if (candidate.moraleDeltas.length !== expectedUnitIds.length) return fail("m2_result_morale_membership_invalid");
    for (let index = 0; index < expectedUnitIds.length; index += 1) {
      const delta = candidate.moraleDeltas[index], unitId = expectedUnitIds[index];
      if (!isPlainObject(delta) || !exactKeys(delta, ["delta","from","sideId","to","unitId"])) return fail("m2_result_morale_schema_invalid");
      if (delta.unitId !== unitId) return fail("m2_result_morale_order_invalid");
      const unit = battleState.getUnit(unitId);
      if (delta.sideId !== unit.sideId || ![delta.from, delta.to, delta.delta].every(Number.isFinite)) return fail("m2_result_morale_value_invalid");
      if (delta.from !== unit.initialMorale || delta.to !== unit.morale || delta.delta !== round2(delta.to - delta.from)) return fail("m2_result_morale_state_mismatch");
    }

    if (candidate.commandLogHash !== hashCanonical(acceptedCommandLog)) return fail("m2_result_command_hash_invalid");
    const summary = { battleId: candidate.battleId, outcome: candidate.outcome, unitLosses: candidate.unitLosses, experienceDeltas: candidate.experienceDeltas, moraleDeltas: candidate.moraleDeltas, lootPreview: candidate.lootPreview, commandLogHash: candidate.commandLogHash };
    if (candidate.resultSummaryHash !== hashCanonical(summary)) return fail("m2_result_summary_hash_invalid");
    return Object.freeze({ ok: true, result: freezeDeep(clone(candidate)) });
  }
}
export const M2_RESULT_INTERNALS_FOR_TEST = Object.freeze({ canonicalSerialize, fnv1a32, hashCanonical, sideRetreatComplete });
