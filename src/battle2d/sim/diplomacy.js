// The enemy lord's answer to a message from the player. These rules are pure: the same message,
// purse and battle numbers always give the same decision. Any spoken text is cosmetic and lives in
// lord-dialogue.js; it can never change what is decided here.
//
// The battle never moves money. A decision that accepts an offer says what was offered, and the
// caller charges it.

export const DIPLOMACY_RULES = Object.freeze({
  FOOD_VALUE: 25,
  LORD_SURVIVAL_VALUE: 2000,
  UNIT_PRESERVATION_VALUE: 20,
  TERRITORY_RISK_HIGH: 3000,
  TERRITORY_RISK_MEDIUM: 1500,
  FORCE_RETREAT_RATIO: 0.35,
  FORCE_RETREAT_LOSS: 0.65,
  FORCE_RETREAT_COMBINED_RATIO: 0.60,
  FORCE_RETREAT_COMBINED_LOSS: 0.40,
  ATTACK_RATIO: 1.25,
  ATTACK_MAX_LOSS: 0.40,
  OFFER_MIN: 1,
  OFFER_MAX: 999999,
  HISTORY_MAX_MESSAGES: 8,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const NO_OFFER = Object.freeze({ ok: false, gold: 0, food: 0 });

export function aliveUnitCount(squad) {
  if (!squad || !Array.isArray(squad.units)) return 0;
  return squad.units.filter((unit) => unit && Number(unit.hp) > 0).length;
}

// The numbers the lord weighs: forces still fighting, and the enemy's losses since the battle began.
// baseline is { allyStart, enemyStart }, recorded when the battle was created.
export function normalizeBattleState(squads, baseline, isOver) {
  let allyForce = 0;
  let enemyForce = 0;
  let enemyAlive = 0;
  for (const squad of squads || []) {
    const count = aliveUnitCount(squad);
    if (squad.team === 'ally' && squad.state !== 'routing') allyForce += count;
    if (squad.team === 'enemy') {
      enemyAlive += count;
      if (squad.state !== 'routing') enemyForce += count;
    }
  }
  if (isOver || enemyForce === 0) return { ok: false, reason: 'battle_already_terminal', allyForce, enemyForce, enemyAlive, terminal: true };
  if (allyForce === 0) return { ok: true, reason: 'ally_force_zero', allyForce, enemyForce, enemyAlive, noAlly: true };
  if (!baseline || !Number.isFinite(baseline.enemyStart) || baseline.enemyStart <= 0) {
    return { ok: false, reason: 'baseline_missing', allyForce, enemyForce, enemyAlive };
  }
  const forceRatio = enemyForce / Math.max(allyForce, 1);
  const lossRate = clamp((baseline.enemyStart - enemyAlive) / Math.max(baseline.enemyStart, 1), 0, 1);
  const survivalRisk = clamp(0.6 * (1 - clamp(forceRatio, 0, 1)) + 0.4 * lossRate, 0, 1);
  return { ok: true, allyForce, enemyForce, enemyAlive, enemyStart: baseline.enemyStart, forceRatio, lossRate, survivalRisk };
}

// Reads "금화 500 주겠다" style offers. Anything unclear (two amounts of one kind, decimals, "all of it",
// the enemy being asked to pay) is rejected rather than guessed.
export function parsePlayerOffer(message) {
  const text = String(message || '').trim();
  const payVerb = /(주겠다|줄게|바치겠다|내겠다|지급하겠다|넘기겠다)/;
  const receiveVerb = /(받겠다|달라|내놔|줘라|받을|돌려줘|돌려주라)/;
  const enemyPays = /(?:적이|영주가|당신이|너희가|네가)[^.!?]{0,30}(?:주겠다|줄게|바치겠다|내겠다|지급하겠다|넘기겠다)/;
  if (!payVerb.test(text) || receiveVerb.test(text) || enemyPays.test(text)) return { ...NO_OFFER, reason: 'unparsed_offer' };
  if (/[.-]\d|\d\.\d|\b0\b|전부|두\s*배|조금/.test(text)) return { ...NO_OFFER, reason: 'unparsed_offer' };

  const matches = [];
  for (const pattern of [/(금화|식량)\s*([0-9][0-9,]*)/g, /([0-9][0-9,]*)\s*(금화|식량)/g]) {
    let match = pattern.exec(text);
    while (match) {
      const resource = match[1] === '금화' || match[1] === '식량' ? match[1] : match[2];
      const raw = resource === match[1] ? match[2] : match[1];
      matches.push({ resource, value: Number(raw.replace(/,/g, '')), index: match.index });
      match = pattern.exec(text);
    }
  }
  const unique = [];
  for (const match of matches.sort((a, b) => a.index - b.index)) {
    if (!unique.some((other) => other.index === match.index && other.resource === match.resource)) unique.push(match);
  }
  const byResource = { 금화: [], 식량: [] };
  for (const match of unique) byResource[match.resource].push(match.value);
  if (byResource.금화.length > 1 || byResource.식량.length > 1 || byResource.금화.length + byResource.식량.length === 0) {
    return { ...NO_OFFER, reason: 'unparsed_offer' };
  }
  const gold = byResource.금화[0] || 0;
  const food = byResource.식량[0] || 0;
  const inRange = (value) => Number.isInteger(value) && value >= 0 && value <= DIPLOMACY_RULES.OFFER_MAX;
  if (!inRange(gold) || !inRange(food) || (gold && gold < DIPLOMACY_RULES.OFFER_MIN) || (food && food < DIPLOMACY_RULES.OFFER_MIN)) {
    return { ...NO_OFFER, reason: 'unparsed_offer' };
  }
  return { ok: true, reason: 'parsed_offer', gold, food };
}

// message: what the player wrote. economy: { gold, food } the player could pay with.
// Returns { action, reason, offer, battle, ... } with action one of
// 'negotiate' (talk goes on), 'attack' (talks are over, the enemy presses), 'negotiated_retreat' (the
// enemy withdraws for the offer) or 'strategic_retreat' (the enemy withdraws because it is losing).
export function decide(message, economy, battleState) {
  const battle = battleState;
  if (battle.terminal) return { action: 'negotiate', reason: 'battle_already_terminal', offer: { ...NO_OFFER }, battle, discarded: true };
  if (battle.noAlly) return { action: 'attack', reason: 'ally_force_zero', offer: { ...NO_OFFER }, battle };
  if (!battle.ok) return { action: 'negotiate', reason: battle.reason, offer: { ...NO_OFFER }, battle };

  const offer = parsePlayerOffer(message);
  const offerValue = offer.gold + offer.food * DIPLOMACY_RULES.FOOD_VALUE;
  let territoryRiskValue = 0;
  if (battle.forceRatio < 0.75 || battle.lossRate >= 0.50) territoryRiskValue = DIPLOMACY_RULES.TERRITORY_RISK_HIGH;
  else if (battle.forceRatio < 1.00 || battle.lossRate >= 0.25) territoryRiskValue = DIPLOMACY_RULES.TERRITORY_RISK_MEDIUM;
  const preservationValue = DIPLOMACY_RULES.LORD_SURVIVAL_VALUE + battle.enemyAlive * DIPLOMACY_RULES.UNIT_PRESERVATION_VALUE + territoryRiskValue;
  const confidenceMultiplier = clamp(1 + Math.max(0, battle.forceRatio - 1) * 2, 1, 3);
  const minimumAcceptValue = Math.ceil(preservationValue * 0.04 * (1 - 0.75 * battle.survivalRisk) * confidenceMultiplier);
  const gold = Number(economy && economy.gold) || 0;
  const food = Number(economy && economy.food) || 0;
  const payable = offer.ok && gold >= offer.gold && food >= offer.food;
  const forced = battle.forceRatio <= DIPLOMACY_RULES.FORCE_RETREAT_RATIO
    || battle.lossRate >= DIPLOMACY_RULES.FORCE_RETREAT_LOSS
    || (battle.forceRatio <= DIPLOMACY_RULES.FORCE_RETREAT_COMBINED_RATIO && battle.lossRate >= DIPLOMACY_RULES.FORCE_RETREAT_COMBINED_LOSS);
  const accepted = offer.ok && payable && offerValue >= minimumAcceptValue;

  let action = 'negotiate';
  let reason = 'continue_negotiation';
  if (forced && accepted) {
    action = 'negotiated_retreat';
    reason = 'offer_accepted_under_retreat';
  } else if (forced) {
    action = 'strategic_retreat';
    reason = 'forced_strategic_retreat';
  } else if (accepted) {
    action = 'negotiated_retreat';
    reason = 'offer_accepted';
  } else if (battle.forceRatio >= DIPLOMACY_RULES.ATTACK_RATIO && battle.lossRate < DIPLOMACY_RULES.ATTACK_MAX_LOSS) {
    action = 'attack';
    reason = 'enemy_combat_advantage';
  } else if (offer.ok && !payable) {
    reason = 'insufficient_resources';
  } else if (offer.ok) {
    reason = 'offer_insufficient';
  } else if (/금화|식량|주겠다|줄게|바치겠다|내겠다|지급하겠다|넘기겠다/.test(String(message || ''))) {
    reason = 'unparsed_offer';
  }
  return { action, reason, offer, battle, offerValue, territoryRiskValue, preservationValue, confidenceMultiplier, minimumAcceptValue, payable };
}
