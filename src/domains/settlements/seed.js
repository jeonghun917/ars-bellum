// Creates the settlement records of a new world from its map data.
//
// All or nothing: every entry is checked and every record built and checked before the first one
// is put into the draft, so a bad entry leaves the draft exactly as it was. Settlements that
// already exist are left alone, so running it twice (or on a loaded game) changes nothing.
import { isId } from '../../core/ids.js';
import { ok, fail } from '../../core/result.js';
import { MAX_PROSPERITY, MONEY_SEEDS } from './config.js';
import { SETTLEMENT_TYPES } from './buildings.js';
import { settlementIssue } from './checks.js';
import { applyDevelopmentEffects } from './effects.js';
import { recalculateLabor } from './labor.js';
import { newSettlementRecord, round4 } from './records.js';
import { WORLD_SETTLEMENT_DATA } from './seed-data.js';

const isAmount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Turns one map entry into a record. Returns { record } or { issue }.
function buildRecord(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry) || !isId(entry.id)) return { issue: 'id' };
  if (!SETTLEMENT_TYPES.includes(entry.type)) return { issue: 'type' };
  const tags = entry.tags ?? [];
  if (!Array.isArray(tags) || !tags.every(isId)) return { issue: 'tags' };
  const population = entry.population;
  if (!population || !Number.isSafeInteger(population.current) || population.current < 0) return { issue: 'population.current' };
  if (!Number.isSafeInteger(population.capacity) || population.capacity < 1) return { issue: 'population.capacity' };
  const economy = entry.economy ?? {};
  const prosperity = economy.prosperity ?? undefined;
  const prosperityValid = typeof prosperity === 'number' && prosperity >= 0 && prosperity <= MAX_PROSPERITY;
  if (prosperity !== undefined && !prosperityValid) return { issue: 'economy.prosperity' };
  const foodStock = economy.foodStock ?? 0;
  if (!isAmount(foodStock)) return { issue: 'economy.foodStock' };
  const inventory = {};
  for (const [id, amount] of Object.entries(entry.inventory ?? {})) {
    if (!isId(id) || !isAmount(amount)) return { issue: `inventory.${id}` };
    if (amount > 0) inventory[id] = round4(amount);
  }
  if (foodStock > 0) inventory.grain = round4((inventory.grain ?? 0) + foodStock);

  const record = newSettlementRecord({
    id: entry.id,
    type: entry.type,
    tags,
    current: population.current,
    baseCapacity: population.capacity,
    prosperity,
    inventory,
    money: MONEY_SEEDS[entry.type],
  });
  applyDevelopmentEffects(record);
  recalculateLabor(record);
  const problem = settlementIssue(record, record.id);
  return problem ? { issue: `record:${problem}` } : { record };
}

export function createSettlementsFromWorldData(draft, worldData = WORLD_SETTLEMENT_DATA) {
  const source = worldData?.settlements;
  const entries = Array.isArray(source) ? source : source && typeof source === 'object' ? Object.values(source) : null;
  if (!entries) return fail('settlements_seed_invalid', { issue: 'settlements' });
  const built = [];
  const skipped = [];
  const seen = new Set();
  for (const entry of entries) {
    const result = buildRecord(entry);
    if (result.issue) return fail('settlements_seed_invalid', { id: entry?.id ?? null, issue: result.issue });
    const { record } = result;
    if (seen.has(record.id)) return fail('settlements_seed_invalid', { id: record.id, issue: 'duplicate_id' });
    seen.add(record.id);
    if (Object.hasOwn(draft.world.settlements, record.id)) skipped.push(record.id);
    else built.push(record);
  }
  for (const record of built) draft.world.settlements[record.id] = record;
  return ok({ created: built.map((record) => record.id), skipped });
}
