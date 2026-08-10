const STAT_KEYS = Object.freeze([
  "vitality",
  "power",
  "guard",
  "mobility",
  "morale",
  "command"
]);

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

export function validateCombatProfile(profile) {
  const issues = [];
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return { ok: false, issues: ["profile_not_object"] };
  }
  if (!validId(profile.combatProfileId)) issues.push("invalid_combat_profile_id");
  if (profile.sourceScope !== "M2_TEST_ONLY") issues.push("invalid_source_scope");
  if (profile.canonical !== false) issues.push("canonical_must_be_false");
  if (!profile.stats || typeof profile.stats !== "object" || Array.isArray(profile.stats)) {
    issues.push("invalid_stats_root");
  } else {
    for (const key of STAT_KEYS) {
      const value = profile.stats[key];
      if (!Number.isInteger(value) || value < 0 || value > 100) issues.push(`invalid_stat:${key}`);
    }
    const extra = Object.keys(profile.stats).filter((key) => !STAT_KEYS.includes(key));
    if (extra.length) issues.push(`unexpected_stats:${extra.sort().join(",")}`);
  }
  if (!Array.isArray(profile.skillRefs)) {
    issues.push("invalid_skill_refs");
  } else {
    const normalized = [...new Set(profile.skillRefs)].sort();
    if (JSON.stringify(normalized) !== JSON.stringify(profile.skillRefs)) issues.push("skill_refs_not_sorted_unique");
    if (profile.skillRefs.some((id) => !validId(id) || !id.startsWith("m2_test_"))) {
      issues.push("invalid_skill_ref");
    }
  }
  return issues.length ? { ok: false, issues: [...new Set(issues)].sort() } : { ok: true };
}

export function createCombatProfileCatalog(profiles) {
  if (!Array.isArray(profiles)) throw new Error("m2_profile_catalog_invalid");
  const byId = new Map();
  for (const raw of profiles) {
    const checked = validateCombatProfile(raw);
    if (!checked.ok) throw new Error(`m2_profile_invalid:${checked.issues.join("|")}`);
    if (byId.has(raw.combatProfileId)) throw new Error(`m2_profile_duplicate:${raw.combatProfileId}`);
    byId.set(raw.combatProfileId, freezeDeep(clone(raw)));
  }
  return Object.freeze({
    get(profileId) { return byId.get(profileId) || null; },
    has(profileId) { return byId.has(profileId); },
    list() { return [...byId.values()].map(clone); },
    size: byId.size,
    sourceScope: "M2_TEST_ONLY"
  });
}

export const M2_COMBAT_PROFILE_CONTRACT = Object.freeze({
  sourceScope: "M2_TEST_ONLY",
  canonical: false,
  statKeys: STAT_KEYS,
  skillRule: "skillRefs are test identifiers only; canonical effects are deferred to M9 integration"
});
