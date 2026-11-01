// The campaign's way into the 3D battle and back (src/battle3d/launch.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchSnapshot, campaignResult } from '../../src/battle3d/launch.js';
import { validateBattleLaunchSnapshot } from '../../m2/M2_BattleSnapshot.js';
import { createCombatProfileCatalog } from '../../m2/M2_CombatProfiles.js';
import { M2BattleState } from '../../m2/M2_BattleState.js';
import { M2_TECHNICAL_COMBAT_PROFILES, M2_TECHNICAL_SNAPSHOT } from '../../m2/fixtures/m2_technical_fixture_v1.js';
import { newGameState, PLAYER_CHARACTER_ID } from '../../src/game/new-game.js';
import { buildHeroSheet } from '../../src/game/battle-hero.js';

const catalog = createCombatProfileCatalog(M2_TECHNICAL_COMBAT_PROFILES);

test('[battle3d.launch] the campaign\'s battle is the 3D fixture with the campaign\'s seed and the player\'s hero', () => {
  const state = newGameState();
  state.world.characters[PLAYER_CHARACTER_ID].skills.polearm = 60;
  const heroSheet = buildHeroSheet(state, PLAYER_CHARACTER_ID);
  const before = JSON.stringify(M2_TECHNICAL_SNAPSHOT);
  const snapshot = launchSnapshot(M2_TECHNICAL_SNAPSHOT, { seed: 4242, mode: 'campaign', heroSheet });
  assert.equal(JSON.stringify(M2_TECHNICAL_SNAPSHOT), before, 'the fixture is not changed');
  assert.equal(snapshot.seed, 4242);
  assert.equal(snapshot.battleId, 'campaign_4242');
  const checked = validateBattleLaunchSnapshot(snapshot, catalog);
  assert.equal(checked.ok, true, JSON.stringify(checked));
  // The battle reads the hero's sheet: a new character carries nothing, so he fights with his fists.
  const battle = new M2BattleState(checked.snapshot, catalog);
  assert.equal(battle.getUnit(snapshot.playerCharacterId).hero.melee.itemId, null);
  assert.equal(launchSnapshot(M2_TECHNICAL_SNAPSHOT, { seed: -1, mode: 'practice' }).seed, M2_TECHNICAL_SNAPSHOT.seed);
});

test('[battle3d.result] the 3D battle\'s end reaches the campaign in its own terms, with the dead, the routed and the standing counted', () => {
  const unit = (sideId, hp, state = 'idle') => ({ sideId, hp, state });
  const snapshot = { units: [
    unit('enemy', 0, 'incapacitated'), unit('enemy', 0, 'incapacitated'), unit('enemy', 30, 'routing'), unit('enemy', 50),
    unit('ally', 0, 'incapacitated'), unit('ally', 40), unit('ally', 20, 'routing'),
  ] };
  assert.deepEqual(campaignResult({ outcome: 'ally_victory' }, snapshot), {
    outcome: 'victory', enemyRoutedUnits: 1, enemyKilledUnits: 2, allyLostUnits: 1, allySurvivingUnits: 2, lordCaptured: false,
  });
  assert.equal(campaignResult({ outcome: 'enemy_retreat' }, snapshot).outcome, 'victory');
  assert.equal(campaignResult({ outcome: 'enemy_victory' }, snapshot).outcome, 'defeat');
  assert.equal(campaignResult({ outcome: 'ally_retreat' }, snapshot).outcome, 'retreat');
  assert.equal(campaignResult({ outcome: 'aborted' }, snapshot).outcome, 'retreat');
});
