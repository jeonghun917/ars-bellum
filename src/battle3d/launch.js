// From the campaign to the 3D battle and back (pure; no page, no saved game).
//
// launchSnapshot: the battle the campaign starts. The campaign keeps no list of soldiers yet (only a manpower
// count), so the armies are those of the 3D battle's 20-against-20 fixture, as the 2D battle uses its own
// defaults; what comes from the campaign is the seed and the player's hero (his skills and equipped items,
// src/game/battle-hero.js).
//
// campaignResult: the battle's end in the shape the campaign reads (src/ui/battle-result.js): an outcome, the
// enemy routed and killed, the allies lost and still standing, and whether the enemy lord was taken (the 3D
// battle has no lord to take yet: always false).

const OUTCOMES = Object.freeze({
  ally_victory: 'victory',
  enemy_retreat: 'victory',
  enemy_victory: 'defeat',
  ally_retreat: 'retreat',
  // Stopped before either side won or ran: nothing to record, as a retreat records nothing.
  aborted: 'retreat',
});

export function launchSnapshot(fixture, { seed, mode, heroSheet = null }) {
  const snapshot = JSON.parse(JSON.stringify(fixture));
  snapshot.seed = Number.isSafeInteger(seed) && seed >= 0 ? seed : fixture.seed;
  snapshot.battleId = `${mode === 'campaign' ? 'campaign' : 'practice'}_${snapshot.seed}`;
  if (heroSheet) snapshot.heroSheet = heroSheet;
  return snapshot;
}

const alive = (unit) => unit.hp > 0 && unit.state !== 'incapacitated' && unit.state !== 'dead';

// result: the 3D battle's final result (its outcome); state: its snapshot at the end.
export function campaignResult(result, state) {
  const units = state?.units || [];
  const enemy = units.filter((unit) => unit.sideId === 'enemy');
  const ally = units.filter((unit) => unit.sideId === 'ally');
  return {
    outcome: OUTCOMES[result?.outcome] || 'retreat',
    enemyRoutedUnits: enemy.filter((unit) => alive(unit) && unit.state === 'routing').length,
    enemyKilledUnits: enemy.filter((unit) => !alive(unit)).length,
    allyLostUnits: ally.filter((unit) => !alive(unit)).length,
    allySurvivingUnits: ally.filter(alive).length,
    lordCaptured: false,
  };
}
