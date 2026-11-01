// A formation's 부대장 (commander): a man of his own, set apart from the men he leads (the owner's design).
// He fights in the formation's ranks with his own skills and equipment, as the player's hero does
// (M2_HeroLoadout.js), and his command skills steady the formation:
// - leadership: the heart he puts into his men (a morale bonus while he stands);
// - command: how well he keeps them in hand (losses weigh less on them);
// - tactics: how many battle plans and orders the formation can carry out (tacticSlots, used by the tactics
//   to come).
// If he falls, the formation takes the loss hard (the morale system's commander-lost penalty) and the next
// man of the formation (by id) leads it on: he can rally them, but brings none of the commander's skill.
// The launch snapshot carries commanders' sheets as `commanderSheets` ({ formationId: sheet }); without one,
// a formation's commander gets the default sheet for what it fights as.
import { heroCombat } from "./M2_HeroLoadout.js";
import { isM2UnitActive } from "./M2_BattleState.js";

export const COMMAND_SKILLS = Object.freeze(["command", "leadership", "tactics"]);

const SKILLS = Object.freeze({ command: 40, leadership: 40, tactics: 30, one_handed: 40, polearm: 40, crossbow: 40, riding: 40, athletics: 30 });
export const DEFAULT_COMMANDER_SHEETS = Object.freeze({
  infantry: Object.freeze({
    skills: SKILLS,
    equipment: Object.freeze({
      main_hand: Object.freeze({ itemId: "spear", weaponClass: "polearm", damage: 8, reach: 2.0, cooldownTicks: 16 }),
      off_hand: Object.freeze({ itemId: "kite_shield", kind: "shield", block: 0.3 }),
      ranged: null,
      body: Object.freeze({ itemId: "mail_hauberk", armor: 22 }),
      mount: null
    })
  }),
  crossbow: Object.freeze({
    skills: SKILLS,
    equipment: Object.freeze({
      main_hand: Object.freeze({ itemId: "arming_sword", weaponClass: "one_handed", damage: 7, reach: 1.3, cooldownTicks: 12 }),
      off_hand: null,
      ranged: Object.freeze({ itemId: "crossbow", weaponClass: "crossbow", damage: 18, reloadTicks: 60, speed: 30, range: 24 }),
      body: Object.freeze({ itemId: "mail_shirt", armor: 15 }),
      mount: null
    })
  }),
  cavalry: Object.freeze({
    skills: SKILLS,
    equipment: Object.freeze({
      main_hand: Object.freeze({ itemId: "lance", weaponClass: "polearm", damage: 9, reach: 2.4, cooldownTicks: 20 }),
      off_hand: null,
      ranged: null,
      body: Object.freeze({ itemId: "mail_hauberk", armor: 22 }),
      mount: Object.freeze({ itemId: "destrier", speed: 5.2, hpBonus: 160 })
    })
  })
});

const skill = (sheet, id) => Math.max(0, Math.min(100, Number(sheet?.skills?.[id]) || 0));

// What a commander brings, worked out once when the battle starts.
export function commanderFromSheet(sheet) {
  return Object.freeze({
    command: skill(sheet, "command"),
    leadership: skill(sheet, "leadership"),
    tactics: skill(sheet, "tactics"),
    // One plan or order to start with, one more at tactics 34 and at 67.
    tacticSlots: 1 + Math.floor(skill(sheet, "tactics") / 34),
    combat: heroCombat(sheet)
  });
}

// An ordinary commander has 40 in each command skill: the battle's balance is tuned for him (about two
// minutes, the beaten side running with half its men). Better ones do better, worse ones worse.
export const ORDINARY_COMMAND = 40;
// Morale while the commander stands: leadership 40 adds nothing to the base bonus; 100 adds 6, 0 takes 4.
export const leadershipBonus = (commander) => (commander ? (commander.leadership - ORDINARY_COMMAND) / 10 : 0);
// How much of the formation's losses weighs on the men: command 40 as it is; 100 seven-tenths, 0 1.2 times.
export const commandSteadiness = (commander) => (commander ? 1 - (commander.command - ORDINARY_COMMAND) / 200 : 1);

// Who leads the formation now: its commander while he is fit to, else the next man by id who is.
export function leaderOf(battleState, formation) {
  const commander = battleState.getUnit(formation.commanderUnitId);
  if (isM2UnitActive(commander)) return commander;
  for (const unitId of [...formation.memberUnitIds].sort()) {
    const unit = battleState.getUnit(unitId);
    if (isM2UnitActive(unit)) return unit;
  }
  return null;
}
