// The larger battle used to measure the 3D battle at scale (m2/fixtures/m2_scale_fixture.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScaleSnapshot, M2_SCALE_COMBAT_PROFILES } from '../../m2/fixtures/m2_scale_fixture.js';
import { validateBattleLaunchSnapshot } from '../../m2/M2_BattleSnapshot.js';
import { createCombatProfileCatalog } from '../../m2/M2_CombatProfiles.js';
import { M2BattleState } from '../../m2/M2_BattleState.js';

test('[m2.scale.fixture] a 100-against-100 battle of the same kinds is a valid launch snapshot, everyone inside the field', () => {
  const catalog = createCombatProfileCatalog(M2_SCALE_COMBAT_PROFILES);
  // (Up to 100 a side the armies fit inside the field as laid out; larger ones would need it wider.)
  for (const perSide of [20, 60, 100]) {
    const snapshot = buildScaleSnapshot({ perSide });
    const checked = validateBattleLaunchSnapshot(snapshot, catalog);
    assert.equal(checked.ok, true, JSON.stringify(checked.issues));
    const state = new M2BattleState(checked.snapshot, catalog);
    const units = state.getUnitIdsStable().map((id) => state.getUnit(id));
    assert.equal(units.length, perSide * 2);
    for (const side of ['ally', 'enemy']) {
      const kinds = units.filter((u) => u.sideId === side).reduce((m, u) => ({ ...m, [u.kindId]: (m[u.kindId] || 0) + 1 }), {});
      assert.deepEqual(Object.keys(kinds).sort(), ['cavalry', 'crossbow', 'infantry'], side);
    }
    // Inside each side's retreat edge (18 m), so no one starts as having left the field.
    assert.ok(units.every((u) => Math.abs(u.position.z) < 18), `perSide ${perSide}`);
  }
});
