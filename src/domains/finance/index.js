// Finance: accounts, money movements, campaign metrics and debts. Other areas import from here only.
import { registerAreaCheck } from '../../persist/schema.js';
import { checkFinance } from './checks.js';
import { markOverdueDebts } from './rules.js';

export {
  checkFinance, definitionOf, refExists, isCampaignMetrics, isKnownOwnerType, ownerTypeCanOwnAccounts, playerAccountIdOf, METRICS_KEY, DEBT_STATUSES,
} from './checks.js';
export {
  createAccount, setAccountFrozen, setAuthorizedSpenders, changeAccountOwner,
  transferFunds, mintFunds, spendFunds,
  getCampaignMetrics, changeCampaignMetrics, moveCampaignMetrics, recordBattleVictory,
  createDebt, recordDebtPayment, payDebt, markDebtOverdue, renegotiateDebt, markOverdueDebts,
} from './rules.js';

registerAreaCheck('finance', checkFinance);

export const dailySteps = Object.freeze([
  { order: 500, name: 'finance.mark_overdue_debts', run: (draft, day) => markOverdueDebts(draft, day) },
]);
