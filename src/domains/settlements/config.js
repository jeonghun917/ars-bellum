// Every tunable number of the settlement simulation in one place.
// "earlier" = the earlier version's value, kept as it was. "NEW" = a number added for the daily
// processing that the earlier version never ran; these are first guesses to be tuned.

export const DAYS_PER_YEAR = 365; // earlier

// --- Construction ---------------------------------------------------------------------------
export const REFUND_RATE_QUEUED = 1; // earlier: a job that has not started gets everything back
export const REFUND_RATE_ACTIVE = 0.5; // earlier: a job that has started gets half back
export const CONSTRUCTION_HISTORY_LIMIT = 50; // earlier
export const WORK_PER_LABORER_PER_DAY = 1; // earlier: one laborer adds one unit of work a day

// --- Population (all earlier) -----------------------------------------------------------------
export const PARTICIPATION_RATE = 0.78; // share of working-age people who work
export const START_SHARES = Object.freeze({ children: 0.22, elderly: 0.1 }); // working age is the rest
export const ARRIVAL_SHARES = Object.freeze({ children: 0.22, workingAge: 0.68, elderly: 0.1 });
export const DEFAULT_CONDITIONS = Object.freeze({ foodSatisfaction: 1, health: 0.75, security: 0.5, prosperity: 0.5 });
export const NATURAL_RATES = Object.freeze({ annualBirthRate: 0.028, annualDeathRate: 0.018 });
export const MIGRATION = Object.freeze({
  scale: 0.003,
  overcrowdingWeight: 0.45,
  unemploymentWeight: 0.25,
  foodWeight: 0.15,
  healthWeight: 0.1,
  securityWeight: 0.05,
});

// --- Baseline jobs (earlier numbers) ---------------------------------------------------------
// Jobs every settlement has without any building: population / 4 * multiplier of its type.
// NEW: castle and fort use the 0.62 that the earlier table listed under "fortress" (a type name
// no settlement had); the earlier code therefore gave castles the default 0.78 by accident.
export const BASELINE_JOBS = Object.freeze({
  populationDivisor: 4,
  minimumJobs: 4,
  typeMultipliers: Object.freeze({
    village: 0.72, town: 0.82, city: 0.92, castle: 0.62, fort: 0.62, port: 0.9, default: 0.78,
  }),
});

// --- Starting money by settlement type (earlier) ---------------------------------------------
export const MONEY_SEEDS = Object.freeze({
  village: { treasury: 200, privateWealth: 900, merchantCapital: 120 },
  town: { treasury: 650, privateWealth: 2800, merchantCapital: 750 },
  city: { treasury: 1800, privateWealth: 8500, merchantCapital: 3000 },
  castle: { treasury: 1200, privateWealth: 3200, merchantCapital: 350 },
  fort: { treasury: 850, privateWealth: 1800, merchantCapital: 180 },
  port: { treasury: 1300, privateWealth: 5200, merchantCapital: 2600 },
  default: { treasury: 400, privateWealth: 1500, merchantCapital: 300 },
});
export const MONEY_ACCOUNTS = Object.freeze(['treasury', 'privateWealth', 'merchantCapital']);

// --- Economy indexes (earlier defaults; only these three are used by the rules) --------------
export const DEFAULT_TAX_RATE = 0.1;
export const MAX_TAX_RATE = 0.75;
export const DEFAULT_WAGE_INDEX = 1;
export const MAX_WAGE_INDEX = 3;
export const DEFAULT_PROSPERITY = 50;
export const MAX_PROSPERITY = 200;

// --- Production and food (NEW) ----------------------------------------------------------------
// Grain sacks a worker grows per day with no farm building behind them. A farm gives 2.5 sacks per
// peasant per day (30 sacks for 12 peasants), so this is the small baseline of village farming.
export const SUBSISTENCE_GRAIN_PER_PEASANT = 0.15;
// Food units one person eats per day (a sack of grain is one unit).
export const FOOD_PER_PERSON_PER_DAY = 0.012;
// What people eat, in this order: perishable food first, grain last. One unit of each is one unit
// of food.
export const FOOD_ORDER = Object.freeze(['fish', 'meat', 'vegetables', 'bread', 'grain']);

// --- Wages and taxes (NEW) --------------------------------------------------------------------
// The treasury pays these to people employed by the settlement itself, per worker per day, times
// the wage index. Farmers, artisans and merchants live from what they make and are not paid here.
export const PUBLIC_WAGES = Object.freeze({ administrators: 0.5, guards: 0.3, soldiers: 0.4, clergy: 0.2 });
export const CONSTRUCTION_WAGE = 0.5; // per laborer working on a building
// Tax = tax rate * (value of the day's production + wages paid that day), taken from private wealth.
