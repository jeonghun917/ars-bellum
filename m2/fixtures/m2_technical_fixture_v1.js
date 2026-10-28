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

function rotateLocal(localX, localZ, facing) {
  const rightX = Math.cos(facing);
  const rightZ = -Math.sin(facing);
  const forwardX = Math.sin(facing);
  const forwardZ = Math.cos(facing);
  return {
    x: localX * rightX + localZ * forwardX,
    z: localX * rightZ + localZ * forwardZ
  };
}

function formationSlots(memberIds, formationTypeId, anchor, facing, spacing) {
  const ids = [...memberIds].sort();
  const slots = new Map();

  if (formationTypeId === "line") {
    const center = (ids.length - 1) / 2;
    ids.forEach((unitId, index) => {
      const offset = rotateLocal((index - center) * spacing, 0, facing);
      slots.set(unitId, { x: anchor.x + offset.x, z: anchor.z + offset.z });
    });
  } else if (formationTypeId === "column") {
    const center = (ids.length - 1) / 2;
    ids.forEach((unitId, index) => {
      const offset = rotateLocal(0, (center - index) * spacing, facing);
      slots.set(unitId, { x: anchor.x + offset.x, z: anchor.z + offset.z });
    });
  } else {
    const columns = Math.ceil(Math.sqrt(ids.length));
    const rows = Math.ceil(ids.length / columns);
    const looseSpacing = spacing * 1.6;
    ids.forEach((unitId, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const offset = rotateLocal(
        (column - (columns - 1) / 2) * looseSpacing,
        ((rows - 1) / 2 - row) * looseSpacing,
        facing
      );
      slots.set(unitId, { x: anchor.x + offset.x, z: anchor.z + offset.z });
    });
  }
  return slots;
}

function freezeRecord(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeRecord));
  if (value && typeof value === "object") {
    const copy = {};
    for (const [key, child] of Object.entries(value)) copy[key] = freezeRecord(child);
    return Object.freeze(copy);
  }
  return value;
}

const allyIds = Object.freeze([
  "m2_fixture_player",
  ...Array.from({ length: 19 }, (_, index) => `m2_fixture_ally_${String(index + 2).padStart(2, "0")}`)
]);
const enemyIds = Object.freeze(
  Array.from({ length: 20 }, (_, index) => `m2_fixture_enemy_${String(index + 1).padStart(2, "0")}`)
);

const formationDefinitions = [
  { formationId: "ally_line", sideId: "ally", commanderUnitId: "m2_fixture_player", memberUnitIds: allyIds.slice(0, 7), anchor: { x: -5, z: 5 }, facing: 0, formationTypeId: "line", spacing: 1.25, order: "hold" },
  { formationId: "ally_column", sideId: "ally", commanderUnitId: allyIds[7], memberUnitIds: allyIds.slice(7, 14), anchor: { x: -8, z: 0 }, facing: 0, formationTypeId: "column", spacing: 1.25, order: "hold" },
  { formationId: "ally_loose", sideId: "ally", commanderUnitId: allyIds[14], memberUnitIds: allyIds.slice(14), anchor: { x: -3, z: 0 }, facing: 0, formationTypeId: "loose", spacing: 1.25, order: "hold" },
  { formationId: "enemy_line", sideId: "enemy", commanderUnitId: enemyIds[0], memberUnitIds: enemyIds.slice(0, 7), anchor: { x: 5, z: -5 }, facing: Math.PI, formationTypeId: "line", spacing: 1.25, order: "hold" },
  { formationId: "enemy_column", sideId: "enemy", commanderUnitId: enemyIds[7], memberUnitIds: enemyIds.slice(7, 14), anchor: { x: 8, z: 0 }, facing: Math.PI, formationTypeId: "column", spacing: 1.25, order: "hold" },
  { formationId: "enemy_loose", sideId: "enemy", commanderUnitId: enemyIds[14], memberUnitIds: enemyIds.slice(14), anchor: { x: 3, z: 0 }, facing: Math.PI, formationTypeId: "loose", spacing: 1.25, order: "hold" }
];

const formationByUnitId = new Map();
const spawnByUnitId = new Map();
for (const formation of formationDefinitions) {
  const slots = formationSlots(formation.memberUnitIds, formation.formationTypeId, formation.anchor, formation.facing, formation.spacing);
  for (const unitId of formation.memberUnitIds) {
    formationByUnitId.set(unitId, formation.formationId);
    spawnByUnitId.set(unitId, { ...slots.get(unitId), heading: formation.facing });
  }
}

const characters = [];
for (const [index, unitId] of allyIds.entries()) {
  characters.push({
    characterId: unitId,
    displayName: unitId === "m2_fixture_player" ? "Player Fixture" : `Ally Fixture ${String(index + 1).padStart(2, "0")}`,
    sideId: "ally",
    formationId: formationByUnitId.get(unitId),
    roleId: unitId === "m2_fixture_player" ? "player_commander" : (index === 7 || index === 14 ? "major_npc" : "unit_test"),
    combatProfileId: unitId === "m2_fixture_player" ? "profile_player_test" : "profile_ally_captain_test",
    spawn: spawnByUnitId.get(unitId)
  });
}
for (const [index, unitId] of enemyIds.entries()) {
  characters.push({
    characterId: unitId,
    displayName: `Enemy Fixture ${String(index + 1).padStart(2, "0")}`,
    sideId: "enemy",
    formationId: formationByUnitId.get(unitId),
    roleId: index === 0 || index === 7 || index === 14 ? "major_npc" : "unit_test",
    combatProfileId: index === 0 || index === 7 || index === 14 ? "profile_enemy_commander_test" : "profile_enemy_guard_test",
    spawn: spawnByUnitId.get(unitId)
  });
}

export const M2_TECHNICAL_SNAPSHOT = freezeRecord({
  schemaVersion: 1,
  battleId: "m2_20v20_runtime_001",
  seed: 184021,
  sourceScope: "M2_TEST_ONLY",
  canonical: false,
  playerCharacterId: "m2_fixture_player",
  source: {
    baseTree: "57fbd34c729ddf2ee16506270a272f415f94fb1e",
    adapter: null,
    persistenceCommit: false
  },
  formations: formationDefinitions,
  characters
});
