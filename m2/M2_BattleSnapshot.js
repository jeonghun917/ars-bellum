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

function validPointXZ(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.z);
}

const FORMATION_TYPES = new Set(["line", "column", "loose"]);
const FORMATION_ORDERS = new Set(["hold", "move"]);

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

  const characterIds = new Set();
  const characterSideById = new Map();
  const characterFormationById = new Map();

  if (!Array.isArray(snapshot.characters) || snapshot.characters.length === 0) {
    issues.push("invalid_characters");
  } else {
    for (const character of snapshot.characters) {
      if (!character || typeof character !== "object" || Array.isArray(character)) {
        issues.push("invalid_character_record");
        continue;
      }
      if (!validId(character.characterId)) issues.push("invalid_character_id");
      else if (characterIds.has(character.characterId)) issues.push(`duplicate_character:${character.characterId}`);
      else {
        characterIds.add(character.characterId);
        characterSideById.set(character.characterId, character.sideId);
        characterFormationById.set(character.characterId, character.formationId);
      }
      if (!["ally", "enemy"].includes(character.sideId)) issues.push(`invalid_side:${character.characterId || "unknown"}`);
      if (!validId(character.roleId)) issues.push(`invalid_role:${character.characterId || "unknown"}`);
      if (!validId(character.formationId)) issues.push(`invalid_formation_ref:${character.characterId || "unknown"}`);
      if (!validId(character.combatProfileId) || !combatProfiles.has(character.combatProfileId)) {
        issues.push(`missing_combat_profile:${character.characterId || "unknown"}`);
      }
      const spawn = character.spawn;
      if (!spawn || ![spawn.x, spawn.z, spawn.heading].every(Number.isFinite)) {
        issues.push(`invalid_spawn:${character.characterId || "unknown"}`);
      }
    }
    if (!characterIds.has(snapshot.playerCharacterId)) issues.push("player_character_missing");
  }

  const formationIds = new Set();
  const membership = new Map();
  if (!Array.isArray(snapshot.formations) || snapshot.formations.length === 0) {
    issues.push("invalid_formations");
  } else {
    for (const formation of snapshot.formations) {
      if (!formation || typeof formation !== "object" || Array.isArray(formation)) {
        issues.push("invalid_formation_record");
        continue;
      }
      if (!validId(formation.formationId)) issues.push("invalid_formation_id");
      else if (formationIds.has(formation.formationId)) issues.push(`duplicate_formation:${formation.formationId}`);
      else formationIds.add(formation.formationId);

      if (!["ally", "enemy"].includes(formation.sideId)) issues.push(`invalid_formation_side:${formation.formationId || "unknown"}`);
      if (!validId(formation.commanderUnitId)) issues.push(`invalid_formation_commander:${formation.formationId || "unknown"}`);
      if (!FORMATION_TYPES.has(formation.formationTypeId)) issues.push(`invalid_formation_type:${formation.formationId || "unknown"}`);
      if (!Number.isFinite(formation.spacing) || formation.spacing <= 0) issues.push(`invalid_formation_spacing:${formation.formationId || "unknown"}`);
      if (!validPointXZ(formation.anchor) || !Number.isFinite(formation.facing)) issues.push(`invalid_formation_pose:${formation.formationId || "unknown"}`);
      if (!FORMATION_ORDERS.has(formation.order || "hold")) issues.push(`invalid_formation_order:${formation.formationId || "unknown"}`);

      if (!Array.isArray(formation.memberUnitIds) || formation.memberUnitIds.length === 0) {
        issues.push(`invalid_formation_members:${formation.formationId || "unknown"}`);
        continue;
      }

      const local = new Set();
      for (const unitId of formation.memberUnitIds) {
        if (!validId(unitId)) {
          issues.push(`invalid_formation_member:${formation.formationId || "unknown"}`);
          continue;
        }
        if (local.has(unitId)) issues.push(`duplicate_formation_member:${formation.formationId}:${unitId}`);
        local.add(unitId);
        if (!characterIds.has(unitId)) issues.push(`formation_member_missing:${formation.formationId}:${unitId}`);
        if (membership.has(unitId)) issues.push(`unit_in_multiple_formations:${unitId}`);
        membership.set(unitId, formation.formationId);
        if (characterSideById.get(unitId) !== formation.sideId) issues.push(`formation_side_mismatch:${formation.formationId}:${unitId}`);
      }
      if (!local.has(formation.commanderUnitId)) issues.push(`commander_not_member:${formation.formationId || "unknown"}`);
    }
  }

  for (const unitId of characterIds) {
    const formationId = characterFormationById.get(unitId);
    if (!formationIds.has(formationId)) issues.push(`character_formation_missing:${unitId}`);
    if (membership.get(unitId) !== formationId) issues.push(`character_formation_membership_mismatch:${unitId}`);
  }

  return issues.length
    ? { ok: false, error: "m2_snapshot_invalid", issues: [...new Set(issues)].sort() }
    : { ok: true, snapshot: freezeDeep(clone(snapshot)) };
}
