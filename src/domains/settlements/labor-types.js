// The one table of job types. Baseline jobs and labor supply are built from it, and the catalog
// tests check that every job id used by a building, a recipe or a wage is in it.
// share: part of a settlement's baseline jobs. supplyWeight: part of the workforce that is able to
// do that kind of work. Both are the earlier version's numbers (S_Labor.js); each column sums to 1.
export const LABOR_TYPES = Object.freeze([
  { id: 'peasants', name: '농민', share: 0.45, supplyWeight: 0.34 },
  { id: 'laborers', name: '노동자', share: 0.24, supplyWeight: 0.24 },
  { id: 'artisans', name: '장인', share: 0.08, supplyWeight: 0.12 },
  { id: 'merchants', name: '상인', share: 0.08, supplyWeight: 0.07 },
  { id: 'administrators', name: '행정관', share: 0.05, supplyWeight: 0.05 },
  { id: 'guards', name: '경비 인력', share: 0.04, supplyWeight: 0.05 },
  { id: 'soldiers', name: '직업 군인', share: 0.02, supplyWeight: 0.06 },
  { id: 'clergy', name: '성직자', share: 0.02, supplyWeight: 0.03 },
  { id: 'nobles', name: '귀족', share: 0.02, supplyWeight: 0.04 },
]);

export const LABOR_TYPE_IDS = Object.freeze(LABOR_TYPES.map((type) => type.id));

export function emptyLaborMap() {
  return Object.fromEntries(LABOR_TYPE_IDS.map((id) => [id, 0]));
}

export function sumLaborMap(map) {
  return LABOR_TYPE_IDS.reduce((total, id) => total + (map[id] || 0), 0);
}

// Splits a whole number between job types in proportion to `weights` (largest remainder; ties go
// to the type listed first), so the parts always add up to exactly `total`.
export function distributeByWeight(total, weights) {
  const result = emptyLaborMap();
  const whole = Math.floor(total);
  if (whole <= 0) return result;
  const weightSum = LABOR_TYPE_IDS.reduce((sum, id) => sum + weights[id], 0);
  const parts = LABOR_TYPE_IDS.map((id, index) => {
    const exact = (whole * weights[id]) / weightSum;
    return { id, index, floor: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = whole;
  for (const part of parts) {
    result[part.id] = part.floor;
    left -= part.floor;
  }
  parts.sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (let i = 0; left > 0; i = (i + 1) % parts.length) {
    result[parts[i].id] += 1;
    left -= 1;
  }
  return result;
}

export const SUPPLY_WEIGHTS = Object.freeze(Object.fromEntries(LABOR_TYPES.map((type) => [type.id, type.supplyWeight])));
export const BASELINE_SHARES = Object.freeze(Object.fromEntries(LABOR_TYPES.map((type) => [type.id, type.share])));
