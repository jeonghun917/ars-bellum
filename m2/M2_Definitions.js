export const M2_MELEE_DEFINITION = Object.freeze({
  id: "m2_test_melee",
  sourceScope: "M2_TEST_ONLY",
  canonical: false,
  range: 1.6,
  facingArcDegrees: 120,
  cooldownTicks: 10,
  baseDamage: 10
});

export const M2_BLOCK_DEFINITION = Object.freeze({
  id: "m2_test_block",
  sourceScope: "M2_TEST_ONLY",
  canonical: false,
  frontArcDegrees: 120,
  damageMultiplier: 0.4
});

export const M2_BOW_DEFINITION = Object.freeze({
  id: "m2_test_bow",
  sourceScope: "M2_TEST_ONLY",
  canonical: false,
  cooldownTicks: 16,
  baseDamage: 12,
  projectileTypeId: "m2_test_arrow"
});

export const M2_PROJECTILE_DEFINITION = Object.freeze({
  id: "m2_test_arrow",
  sourceScope: "M2_TEST_ONLY",
  canonical: false,
  speed: 12,
  maxRange: 22,
  hitRadius: 0.35,
  maxActive: 64
});

export const M2_FORMATION_ATTACK_DEFINITION = Object.freeze({
  id: "m2_test_formation_attack",
  sourceScope: "M2_TEST_ONLY",
  canonical: false,
  attackStopRange: 1.8
});
