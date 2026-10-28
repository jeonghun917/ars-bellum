// How a battle ends, and what the caller is told about it. Pure functions of the squads.
import { aliveUnitCount } from './diplomacy.js';

export const END_OUTCOMES = Object.freeze(['victory', 'defeat', 'retreat', 'surrender', 'negotiated_retreat', 'strategic_retreat']);

// Forces still in the fight. A routing squad counts as fleeing, not fighting.
export function countForces(squads) {
  const forces = { allyActive: 0, allyRouting: 0, enemyActive: 0, enemyRouting: 0 };
  for (const squad of squads) {
    const alive = aliveUnitCount(squad);
    if (squad.team === 'ally') {
      if (squad.state === 'routing') forces.allyRouting += alive;
      else forces.allyActive += alive;
    } else if (squad.team === 'enemy') {
      if (squad.state === 'routing') forces.enemyRouting += alive;
      else forces.enemyActive += alive;
    }
  }
  return forces;
}

// 'victory' when no enemy is left fighting, 'defeat' when no ally is (or 'retreat' when the
// allies that are left are running), otherwise null: the battle goes on.
// The enemy is checked first, so a mutual wipe-out is a victory.
export function detectOutcome(squads) {
  const forces = countForces(squads);
  if (forces.enemyActive === 0) return 'victory';
  if (forces.allyActive === 0) return forces.allyRouting > 0 ? 'retreat' : 'defeat';
  return null;
}

// Casualties from the soldiers every squad started with.
//   killed: died of wounds. routed: ran and was not killed (still running, or left the field).
//   Soldiers who left the field alive are survivors, so a retreating army keeps its men.
export function countCasualties(squads) {
  const tally = {
    ally: { total: 0, killed: 0, routed: 0 },
    enemy: { total: 0, killed: 0, routed: 0 },
  };
  for (const squad of squads) {
    const side = tally[squad.team];
    if (!side) continue;
    for (const soldier of squad.roster) {
      side.total += 1;
      if (soldier.killed) side.killed += 1;
      else if (soldier.routed) side.routed += 1;
    }
  }
  return tally;
}

// The plain object handed to onEnd. Loot, gold and territory are the caller's to work out.
export function buildResult({ outcome, allSquads, lordCaptured = false, diplomacy = null }) {
  const casualties = countCasualties(allSquads);
  return {
    outcome,
    enemyRoutedUnits: casualties.enemy.routed,
    enemyKilledUnits: casualties.enemy.killed,
    allyLostUnits: casualties.ally.killed,
    allySurvivingUnits: casualties.ally.total - casualties.ally.killed,
    lordCaptured,
    diplomacy,
  };
}
