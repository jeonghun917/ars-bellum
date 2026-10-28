// The settlement's money for one day (NEW: the earlier version computed upkeep but never charged it).
//
//   1. Wages: the treasury pays administrators, guards, soldiers and clergy who have a job, and the
//      laborers on the construction crew, PUBLIC_WAGES / CONSTRUCTION_WAGE per worker times the wage
//      index. The money goes to the people's private wealth.
//   2. Taxes: private wealth pays taxRate * (value of the day's production + wages paid) to the treasury.
//   3. Upkeep: the treasury pays every building's maintenance to the local craftsmen and suppliers,
//      i.e. into private wealth. The gold stays in the settlement, so wages, taxes and upkeep go
//      round in a circle; only construction (paid at queueing) takes gold out.
//
// Nobody can pay more than they have: a short purse pays what it holds and the rest is written
// down as unpaid in the day's report. Money never goes below zero.
import { CONSTRUCTION_WAGE, PUBLIC_WAGES } from './config.js';
import { developmentSnapshot } from './effects.js';
import { reportFor, round2, sortedSettlementIds } from './records.js';
import { moveGold } from './stock.js';

export function wagesDue(settlement) {
  let due = settlement.construction.assigned * CONSTRUCTION_WAGE;
  for (const [jobId, wage] of Object.entries(PUBLIC_WAGES)) due += settlement.population.labor.employedByType[jobId] * wage;
  return round2(due * settlement.economy.wageIndex);
}

export function processFinance(settlement, day) {
  const report = reportFor(settlement, day);
  const money = settlement.money;

  const wages = wagesDue(settlement);
  const wagesPaid = Math.min(wages, money.treasury);
  moveGold(settlement, 'treasury', 'privateWealth', wagesPaid);
  report.wagesPaid = wagesPaid;
  report.wagesUnpaid = round2(wages - wagesPaid);

  const taxes = round2(settlement.economy.taxRate * (report.productionValue + wagesPaid));
  const taxesPaid = Math.min(taxes, money.privateWealth);
  moveGold(settlement, 'privateWealth', 'treasury', taxesPaid);
  report.taxesCollected = taxesPaid;

  const upkeep = developmentSnapshot(settlement.buildings).maintenanceGold;
  const upkeepPaid = Math.min(upkeep, money.treasury);
  moveGold(settlement, 'treasury', 'privateWealth', upkeepPaid);
  report.maintenancePaid = upkeepPaid;
  report.maintenanceUnpaid = round2(upkeep - upkeepPaid);
}

export function financeStep(draft, day) {
  for (const id of sortedSettlementIds(draft)) processFinance(draft.world.settlements[id], day);
}
