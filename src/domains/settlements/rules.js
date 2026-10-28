// Actions on a settlement's goods, money, settings and buildings. Construction actions are in
// construction.js. Each takes (draft, input) and returns ok(...) or fail('settlements_...'); a failure
// changes nothing.
import { isId } from '../../core/ids.js';
import { ok, fail } from '../../core/result.js';
import { MAX_PROSPERITY, MAX_TAX_RATE, MAX_WAGE_INDEX } from './config.js';
import { getBuilding } from './buildings.js';
import { isKnownResource } from './resources.js';
import { getSettlement, round2, round4 } from './records.js';
import { isMoneyAccount, isStockAmount, pay, putInInventory, refund, shortfall, normalizeCost } from './stock.js';

const isInput = (input) => input !== null && typeof input === 'object' && !Array.isArray(input);

function find(draft, input) {
  if (!isInput(input) || !isId(input.settlementId)) return { error: fail('settlements_invalid_input', { field: 'settlementId' }) };
  const settlement = getSettlement(draft, input.settlementId);
  if (!settlement) return { error: fail('settlements_unknown_settlement', { settlementId: input.settlementId }) };
  return { settlement };
}

// Can the treasury and stock pay this cost? Reads only.
export function canAfford(stateOrDraft, input) {
  const found = find(stateOrDraft, input);
  if (found.error) return found.error;
  const normalized = normalizeCost(input.cost);
  if (!normalized.ok) return normalized;
  return ok({ cost: normalized.cost, ...shortfall(found.settlement, normalized.cost) });
}

// Pays a cost all at once: the gold from the treasury and every resource from the stock, or nothing.
export function payCost(draft, input) {
  const found = find(draft, input);
  if (found.error) return found.error;
  return pay(found.settlement, input.cost);
}

export function refundCost(draft, input) {
  const found = find(draft, input);
  if (found.error) return found.error;
  return refund(found.settlement, input.cost, input.rate);
}

function checkResourceInput(input) {
  if (!isId(input.resourceId) || !isKnownResource(input.resourceId)) return fail('settlements_unknown_resource', { resourceId: input.resourceId });
  if (!isStockAmount(input.amount) || input.amount <= 0) return fail('settlements_invalid_amount', { amount: input.amount });
  return null;
}

export function addResource(draft, input) {
  const found = find(draft, input);
  if (found.error) return found.error;
  const bad = checkResourceInput(input);
  if (bad) return bad;
  putInInventory(found.settlement, input.resourceId, round4(input.amount));
  return ok({ amount: found.settlement.inventory[input.resourceId] });
}

export function removeResource(draft, input) {
  const found = find(draft, input);
  if (found.error) return found.error;
  const bad = checkResourceInput(input);
  if (bad) return bad;
  const available = found.settlement.inventory[input.resourceId] ?? 0;
  const amount = round4(input.amount);
  if (available < amount) return fail('settlements_insufficient_resource', { resourceId: input.resourceId, requested: amount, available });
  const left = round4(available - amount);
  if (left > 0) found.settlement.inventory[input.resourceId] = left;
  else delete found.settlement.inventory[input.resourceId];
  return ok({ amount: left });
}

// Moves gold between the accounts of one settlement.
export function moveMoney(draft, input) {
  const found = find(draft, input);
  if (found.error) return found.error;
  if (!isMoneyAccount(input.from) || !isMoneyAccount(input.to) || input.from === input.to) {
    return fail('settlements_unknown_account', { from: input.from, to: input.to });
  }
  if (!isStockAmount(input.amount) || input.amount <= 0) return fail('settlements_invalid_amount', { amount: input.amount });
  const amount = round2(input.amount);
  const money = found.settlement.money;
  if (money[input.from] < amount) {
    return fail('settlements_insufficient_money', { account: input.from, requested: amount, available: money[input.from] });
  }
  money[input.from] = round2(money[input.from] - amount);
  money[input.to] = round2(money[input.to] + amount);
  return ok({ balances: { ...money } });
}

// Adds gold to (or takes gold from) one account, e.g. for a trade settled outside this area.
export function changeMoney(draft, input) {
  const found = find(draft, input);
  if (found.error) return found.error;
  if (!isMoneyAccount(input.account)) return fail('settlements_unknown_account', { account: input.account });
  if (typeof input.delta !== 'number' || !Number.isFinite(input.delta) || input.delta === 0) {
    return fail('settlements_invalid_amount', { amount: input.delta });
  }
  const money = found.settlement.money;
  const next = round2(money[input.account] + input.delta);
  if (next < 0) return fail('settlements_insufficient_money', { account: input.account, requested: -input.delta, available: money[input.account] });
  money[input.account] = next;
  return ok({ balance: next });
}

const INDEX_LIMITS = Object.freeze({ taxRate: MAX_TAX_RATE, wageIndex: MAX_WAGE_INDEX, prosperity: MAX_PROSPERITY });

export function setEconomyIndex(draft, input) {
  const found = find(draft, input);
  if (found.error) return found.error;
  if (!Object.hasOwn(INDEX_LIMITS, input.key)) return fail('settlements_unknown_index', { key: input.key });
  if (typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < 0 || input.value > INDEX_LIMITS[input.key]) {
    return fail('settlements_index_out_of_range', { key: input.key, value: input.value, maximum: INDEX_LIMITS[input.key] });
  }
  found.settlement.economy[input.key] = input.value;
  return ok({ key: input.key, value: input.value });
}

// A switched-off building gives no effects, jobs or products but still costs upkeep.
export function setBuildingEnabled(draft, input) {
  const found = find(draft, input);
  if (found.error) return found.error;
  if (!isId(input.buildingId) || !getBuilding(input.buildingId)) return fail('settlements_unknown_building', { buildingId: input.buildingId });
  const state = found.settlement.buildings[input.buildingId];
  if (!state) return fail('settlements_building_not_built', { buildingId: input.buildingId });
  if (typeof input.enabled !== 'boolean') return fail('settlements_invalid_input', { field: 'enabled' });
  state.enabled = input.enabled;
  return ok({ enabled: input.enabled });
}
