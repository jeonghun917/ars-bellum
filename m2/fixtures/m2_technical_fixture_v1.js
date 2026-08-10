export const M2_TECHNICAL_COMBAT_PROFILES = Object.freeze([
  Object.freeze({
    combatProfileId: "profile_player_test",
    sourceScope: "M2_TEST_ONLY",
    canonical: false,
    stats: Object.freeze({ vitality: 68, power: 61, guard: 57, mobility: 66, morale: 72, command: 64 }),
    skillRefs: Object.freeze(["m2_test_focus", "m2_test_guard", "m2_test_rally"])
  }),
  Object.freeze({
    combatProfileId: "profile_ally_captain_test",
    sourceScope: "M2_TEST_ONLY",
    canonical: false,
    stats: Object.freeze({ vitality: 64, power: 55, guard: 63, mobility: 52, morale: 70, command: 73 }),
    skillRefs: Object.freeze(["m2_test_guard", "m2_test_rally"])
  }),
  Object.freeze({
    combatProfileId: "profile_enemy_commander_test",
    sourceScope: "M2_TEST_ONLY",
    canonical: false,
    stats: Object.freeze({ vitality: 70, power: 60, guard: 60, mobility: 54, morale: 76, command: 78 }),
    skillRefs: Object.freeze(["m2_test_focus", "m2_test_rally"])
  }),
  Object.freeze({
    combatProfileId: "profile_enemy_guard_test",
    sourceScope: "M2_TEST_ONLY",
    canonical: false,
    stats: Object.freeze({ vitality: 72, power: 50, guard: 76, mobility: 42, morale: 62, command: 35 }),
    skillRefs: Object.freeze(["m2_test_guard"])
  })
]);

export const M2_TECHNICAL_SNAPSHOT = Object.freeze({
  schemaVersion: 1,
  battleId: "m2_technical_runtime_001",
  seed: 184020,
  sourceScope: "M2_TEST_ONLY",
  canonical: false,
  playerCharacterId: "m2_fixture_player",
  source: Object.freeze({
    baseTree: "57fbd34c729ddf2ee16506270a272f415f94fb1e",
    adapter: null,
    persistenceCommit: false
  }),
  characters: Object.freeze([
    Object.freeze({ characterId: "m2_fixture_player", displayName: "Player Fixture", sideId: "ally", roleId: "player_commander", combatProfileId: "profile_player_test", spawn: Object.freeze({ x: -3.2, z: 1.2, heading: 0 }) }),
    Object.freeze({ characterId: "m2_fixture_ally_captain", displayName: "Ally Captain Fixture", sideId: "ally", roleId: "major_npc", combatProfileId: "profile_ally_captain_test", spawn: Object.freeze({ x: -1.4, z: -1.4, heading: 0.2 }) }),
    Object.freeze({ characterId: "m2_fixture_enemy_commander", displayName: "Enemy Commander Fixture", sideId: "enemy", roleId: "major_npc", combatProfileId: "profile_enemy_commander_test", spawn: Object.freeze({ x: 2.3, z: -0.8, heading: 3.1 }) }),
    Object.freeze({ characterId: "m2_fixture_enemy_guard", displayName: "Enemy Guard Fixture", sideId: "enemy", roleId: "unit_test", combatProfileId: "profile_enemy_guard_test", spawn: Object.freeze({ x: 3.4, z: 1.6, heading: 3.0 }) })
  ])
});
