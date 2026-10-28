// The settlements' part of each game day. The runner calls these for every ended day, in order,
// inside one transaction; if any step fails the whole day is discarded.
// Orders 200..270 sit before the finance area's debt step (500).
import { constructionStep } from './construction.js';
import { developmentEffectsStep } from './effects.js';
import { demographyStep } from './demography.js';
import { financeStep } from './finance.js';
import { laborStep } from './labor.js';
import { consumptionStep, productionStep, spoilageStep } from './production.js';

export const dailySteps = Object.freeze([
  { order: 200, name: 'settlements.construction', run: constructionStep },
  { order: 210, name: 'settlements.development_effects', run: developmentEffectsStep },
  { order: 220, name: 'settlements.labor', run: laborStep },
  { order: 230, name: 'settlements.production', run: productionStep },
  { order: 240, name: 'settlements.consumption', run: consumptionStep },
  { order: 250, name: 'settlements.spoilage', run: spoilageStep },
  { order: 260, name: 'settlements.finance', run: financeStep },
  { order: 270, name: 'settlements.population', run: demographyStep },
]);
