// Event follow-ups: the ledger of what must happen after game events, and its daily run.
// Other areas import only from here.
import { registerAreaCheck } from '../../persist/schema.js';
import { checkFollowups } from './checks.js';

export {
  ACTIVITY_DAILY_BUDGET,
  CATCH_UP_DAY_LIMIT,
  DEFAULT_MAX_RECORDS,
  FOLLOWUP_DAILY_BUDGET,
  FOLLOWUP_HANDLERS,
  MAX_RETRY_DELAY_DAYS,
  RECORD_STATUSES,
} from './shared.js';
export { FOLLOWUP_EVENT_TYPES, normalizeFromEvent } from './events.js';
export {
  FOLLOWUPS_DAILY_ORDER,
  dailySteps,
  enqueueEvent,
  enqueueNormalizedFollowup,
  getFollowup,
  listDueFollowups,
  runFollowups,
} from './rules.js';
export { checkFollowups, checkFollowupDigests } from './checks.js';

registerAreaCheck('followups', checkFollowups);
