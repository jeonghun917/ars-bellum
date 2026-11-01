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

export const M2_MORALE_DEFINITION = Object.freeze({
  id: "m2_test_morale_v1",
  sourceScope: "M2_TEST_ONLY",
  canonical: false,
  minMorale: 0,
  maxMorale: 100,
  unitRouteThreshold: 25,
  formationRouteThreshold: 30,
  formationRoutingRatioThreshold: 0.50,
  rallyExitMorale: 40,
  rallyFormationHoldMorale: 45,
  rallyRecoveryPerTick: 6,
  moraleFallCapPerTick: 4,
  moraleRiseCapPerTick: 2,
  adjacentDeathRadius: 4.0,
  adjacentDeathPenalty: 8,
  adjacentDeathCountCap: 2,
  flankThreatRadius: 4.5,
  frontArcDegrees: 120,
  flankThreatPenalty: 6,
  flankThreatCountCap: 2,
  cohesionContributionWeight: 0.08,
  commanderActiveBonus: 2,
  commanderRoutingPenalty: 6,
  commanderLostPenalty: 10,
  hpContributionScale: 16,
  battleBalanceContributionScale: 12,
  // A formation that has lost all its men would weigh this much on the last of them; half, half of it.
  formationLossScale: 35,
  cohesionSlotErrorCap: 5,
  cohesionSlotErrorScale: 20,
  cohesionSlotWeight: 0.70,
  cohesionStrengthWeight: 0.30,
  retreatEdgeZ: 18
});

export const M2_RESULT_DEFINITION = Object.freeze({
  id: "m2_test_result_v1",
  sourceScope: "M2_TEST_ONLY",
  canonical: false,
  outcomes: Object.freeze([
    "aborted",
    "ally_retreat",
    "ally_victory",
    "enemy_retreat",
    "enemy_victory"
  ]),
  hashScheme: "fnv1a32"
});
