// What the buildings of a settlement add up to: effects, jobs and upkeep.
// A building works at its operating factor: 0 when switched off, otherwise its condition (0..1).
// Upkeep does not depend on it (a switched-off building still has to be kept).
import { getBuilding, effectsAtLevel, jobsAtLevel, maintenanceAtLevel, EFFECT_KEYS } from './buildings.js';
import { emptyLaborMap } from './labor-types.js';
import { round2, round4, sortedSettlementIds } from './records.js';

export const operatingFactor = (building) => (building.enabled ? building.condition : 0);

export function developmentSnapshot(buildings) {
  const effects = Object.fromEntries(EFFECT_KEYS.map((key) => [key, 0]));
  const jobs = emptyLaborMap();
  let maintenanceGold = 0;
  for (const id of Object.keys(buildings).sort()) {
    const state = buildings[id];
    if (!getBuilding(id) || state.level <= 0) continue;
    const factor = operatingFactor(state);
    const levelEffects = effectsAtLevel(id, state.level);
    for (const key of Object.keys(levelEffects)) effects[key] = round4(effects[key] + levelEffects[key] * factor);
    const levelJobs = jobsAtLevel(id, state.level);
    for (const jobId of Object.keys(jobs)) jobs[jobId] = round4(jobs[jobId] + levelJobs[jobId] * factor);
    maintenanceGold += maintenanceAtLevel(id, state.level);
  }
  return { effects, jobs, maintenanceGold: round2(maintenanceGold) };
}

// Housing from buildings raises how many people the settlement holds.
export function applyDevelopmentEffects(settlement) {
  const { effects } = developmentSnapshot(settlement.buildings);
  const population = settlement.population;
  population.effectiveCapacity = Math.max(1, Math.floor(population.baseCapacity + effects.housingCapacity));
  return effects;
}

export function developmentEffectsStep(draft) {
  for (const id of sortedSettlementIds(draft)) applyDevelopmentEffects(draft.world.settlements[id]);
}
