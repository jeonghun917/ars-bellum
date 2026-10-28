// Money and goods of one settlement record. These work on a record inside a draft; rules.js wraps
// them as actions, construction.js and the daily steps call them directly.
//
// Every function checks everything first and changes the record only when all of it can be done,
// so a refusal never leaves half a payment behind (also when called on a draft outside a store).
import { isId } from '../../core/ids.js';
import { ok, fail } from '../../core/result.js';
import { MONEY_ACCOUNTS } from './config.js';
import { isKnownResource } from './resources.js';
import { round2, round4 } from './records.js';

const isAmount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// A cost is { gold, resources: { id: amount } }. Unknown resource ids and bad numbers are refused
// (a cost naming a resource nobody has defined can never be paid correctly).
export function normalizeCost(cost) {
  if (cost === null || typeof cost !== 'object' || Array.isArray(cost)) return fail('settlements_invalid_cost');
  const gold = cost.gold ?? 0;
  if (!isAmount(gold)) return fail('settlements_invalid_cost', { field: 'gold' });
  const source = cost.resources ?? {};
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return fail('settlements_invalid_cost', { field: 'resources' });
  const resources = {};
  for (const id of Object.keys(source).sort()) {
    if (!isId(id) || !isKnownResource(id)) return fail('settlements_unknown_resource', { resourceId: id });
    if (!isAmount(source[id])) return fail('settlements_invalid_cost', { field: id });
    if (source[id] > 0) resources[id] = round4(source[id]);
  }
  return ok({ cost: { gold: round2(gold), resources } });
}

export function shortfall(settlement, cost) {
  const missingResources = {};
  for (const [id, amount] of Object.entries(cost.resources)) {
    const missing = round4(amount - (settlement.inventory[id] ?? 0));
    if (missing > 0) missingResources[id] = missing;
  }
  const missingGold = Math.max(0, round2(cost.gold - settlement.money.treasury));
  return { missingGold, missingResources, affordable: missingGold === 0 && Object.keys(missingResources).length === 0 };
}

export function pay(settlement, rawCost) {
  const normalized = normalizeCost(rawCost);
  if (!normalized.ok) return normalized;
  const { cost } = normalized;
  const missing = shortfall(settlement, cost);
  if (!missing.affordable) {
    return fail('settlements_insufficient_cost', { missingGold: missing.missingGold, missingResources: missing.missingResources });
  }
  settlement.money.treasury = round2(settlement.money.treasury - cost.gold);
  for (const [id, amount] of Object.entries(cost.resources)) takeFromInventory(settlement, id, amount);
  return ok({ paid: cost });
}

// Gives back `rate` (0..1) of a cost. A cost naming an unknown resource refuses the whole refund
// instead of silently losing that part.
export function refund(settlement, rawCost, rate) {
  if (typeof rate !== 'number' || !(rate >= 0 && rate <= 1)) return fail('settlements_invalid_refund_rate', { rate });
  const normalized = normalizeCost(rawCost);
  if (!normalized.ok) return normalized;
  const { cost } = normalized;
  const refunded = { gold: round2(cost.gold * rate), resources: {} };
  settlement.money.treasury = round2(settlement.money.treasury + refunded.gold);
  for (const [id, amount] of Object.entries(cost.resources)) {
    const part = round4(amount * rate);
    if (part <= 0) continue;
    refunded.resources[id] = part;
    settlement.inventory[id] = round4((settlement.inventory[id] ?? 0) + part);
  }
  return ok({ refunded });
}

export function takeFromInventory(settlement, id, amount) {
  const left = round4((settlement.inventory[id] ?? 0) - amount);
  if (left > 0) settlement.inventory[id] = left;
  else delete settlement.inventory[id];
}

export function putInInventory(settlement, id, amount) {
  if (amount <= 0) return;
  settlement.inventory[id] = round4((settlement.inventory[id] ?? 0) + amount);
}

export function moveGold(settlement, from, to, amount) {
  settlement.money[from] = round2(settlement.money[from] - amount);
  settlement.money[to] = round2(settlement.money[to] + amount);
}

export const isMoneyAccount = (id) => MONEY_ACCOUNTS.includes(id);
export const isStockAmount = isAmount;
