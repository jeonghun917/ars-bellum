function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function validId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_.:-]*$/i.test(value);
}

export function validateBattleLaunchSnapshot(snapshot, combatProfiles) {
  const issues = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { ok: false, error: "m2_snapshot_invalid", issues: ["snapshot_not_object"] };
  }
  if (snapshot.schemaVersion !== 1) issues.push("invalid_schema_version");
  if (!validId(snapshot.battleId)) issues.push("invalid_battle_id");
  if (!Number.isSafeInteger(snapshot.seed) || snapshot.seed < 0) issues.push("invalid_seed");
  if (!validId(snapshot.playerCharacterId)) issues.push("invalid_player_character_id");
  if (snapshot.sourceScope !== "M2_TEST_ONLY") issues.push("invalid_source_scope");
  if (snapshot.canonical !== false) issues.push("canonical_must_be_false");
  if (!Array.isArray(snapshot.characters) || snapshot.characters.length === 0) {
    issues.push("invalid_characters");
  } else {
    const ids = new Set();
    for (const character of snapshot.characters) {
      if (!character || typeof character !== "object" || Array.isArray(character)) {
        issues.push("invalid_character_record");
        continue;
      }
      if (!validId(character.characterId)) issues.push("invalid_character_id");
      else if (ids.has(character.characterId)) issues.push(`duplicate_character:${character.characterId}`);
      else ids.add(character.characterId);
      if (!["ally", "enemy"].includes(character.sideId)) issues.push(`invalid_side:${character.characterId || "unknown"}`);
      if (!validId(character.roleId)) issues.push(`invalid_role:${character.characterId || "unknown"}`);
      if (!validId(character.combatProfileId) || !combatProfiles.has(character.combatProfileId)) {
        issues.push(`missing_combat_profile:${character.characterId || "unknown"}`);
      }
      const spawn = character.spawn;
      if (!spawn || ![spawn.x, spawn.z, spawn.heading].every(Number.isFinite)) {
        issues.push(`invalid_spawn:${character.characterId || "unknown"}`);
      }
    }
    if (!ids.has(snapshot.playerCharacterId)) issues.push("player_character_missing");
  }
  return issues.length
    ? { ok: false, error: "m2_snapshot_invalid", issues: [...new Set(issues)].sort() }
    : { ok: true, snapshot: freezeDeep(clone(snapshot)) };
}
