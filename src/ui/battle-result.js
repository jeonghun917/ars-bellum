// What the campaign does with the end of a battle.
//
// A battle module reports { outcome, enemyRoutedUnits, enemyKilledUnits, allyLostUnits,
// allySurvivingUnits, lordCaptured }. Practice battles never touch the saved game. In the campaign
// only a victory changes anything: gold, manpower and territory are recorded in one transaction
// and saved; if the save fails the transaction is undone and nothing has changed.
import { draw } from '../core/rng.js';
import { fail, ok } from '../core/result.js';
import { playerAccountIdOf, recordBattleVictory } from '../domains/finance/index.js';
import { describeFailure } from './messages.js';

export const OUTCOMES = Object.freeze(['victory', 'defeat', 'retreat', 'surrender', 'negotiated_retreat']);
const COUNT_FIELDS = Object.freeze(['enemyRoutedUnits', 'enemyKilledUnits', 'allyLostUnits', 'allySurvivingUnits']);

// The rules of the earlier version's victory (index.html victoryAtomic).
export const REWARD = Object.freeze({ baseGold: 1500, goldSpread: 1000, manpowerPerRoutedUnit: 0.4, territory: 1 });

// Checks what the battle module reported. A result we cannot trust pays nothing.
export function normalizeBattleResult(raw) {
  if (raw === null || typeof raw !== 'object' || !OUTCOMES.includes(raw.outcome)) return fail('battle_result_invalid', { field: 'outcome' });
  const counts = {};
  for (const field of COUNT_FIELDS) {
    const value = raw[field];
    if (!Number.isSafeInteger(value) || value < 0) return fail('battle_result_invalid', { field });
    counts[field] = value;
  }
  if (typeof raw.lordCaptured !== 'boolean') return fail('battle_result_invalid', { field: 'lordCaptured' });
  return ok({ result: { outcome: raw.outcome, ...counts, lordCaptured: raw.lordCaptured } });
}

// Records the victory reward in the campaign and saves it. Returns
// ok({ gold, manpower, territory, revision }) or a failure; on failure the campaign is as it was.
export function applyCampaignVictory(campaign, result) {
  const before = campaign.getState();
  const manpower = Math.floor(result.enemyRoutedUnits * REWARD.manpowerPerRoutedUnit);
  const recorded = campaign.store.transact('battle victory', (draft) => {
    const accountId = playerAccountIdOf(draft);
    if (accountId === null) return fail('finance_account_missing', { accountId });
    const gold = REWARD.baseGold + Math.floor(draw(draft.rng) * REWARD.goldSpread);
    const paid = recordBattleVictory(draft, { accountId, gold, manpower, territory: REWARD.territory });
    if (!paid.ok) return paid;
    return ok({ gold, manpower, territory: REWARD.territory });
  });
  if (!recorded.ok) return recorded;
  const saved = campaign.save();
  if (saved.ok) return ok({ gold: recorded.gold, manpower: recorded.manpower, territory: recorded.territory, revision: recorded.revision });
  // The reward could not be kept on disk: take it back, so what is on screen is what is saved.
  const restored = campaign.store.replace(before);
  return fail('battle_reward_not_saved', { cause: saved, restored: restored.ok });
}

// The text a finished battle shows. `reward` is applyCampaignVictory's result, `failure` its failure.
export function describeBattleEnd({ mode, result, reward = null, failure = null }) {
  const practice = mode === 'practice';
  const lord = result.lordCaptured ? '적 영주를 생포했습니다.' : '적 영주는 도망쳤습니다.';
  switch (result.outcome) {
    case 'victory':
      if (practice) return { title: '연습 승리', lines: ['연습장 전투라 전리품과 영지는 기록되지 않습니다.'] };
      if (failure) {
        return {
          title: '전투에서 이겼지만 보상을 기록하지 못했습니다',
          lines: [describeFailure(failure), '저장된 게임과 화면의 수치는 바뀌지 않았습니다.'],
        };
      }
      return {
        title: '전투 승리',
        lines: [`전리품: 금 ${reward.gold}`, `획득한 인력: ${reward.manpower}명`, `점령한 영지: ${reward.territory}곳`, lord],
      };
    case 'defeat':
      return { title: '전투 패배', lines: [practice ? '연습장 전투라 아무것도 기록되지 않습니다.' : '아군이 전멸하거나 흩어졌습니다. 이번 패배는 저장된 게임에 기록되지 않았고, 아무것도 잃지 않았습니다.'] };
    case 'retreat':
      return { title: '퇴각', lines: [practice ? '연습장 전투라 아무것도 기록되지 않습니다.' : '아군이 전장을 이탈했습니다. 저장된 게임은 바뀌지 않았습니다.'] };
    case 'surrender':
      return { title: '항복', lines: [practice ? '연습장 전투라 아무것도 기록되지 않습니다.' : '항복했습니다. 저장된 게임은 바뀌지 않았습니다.'] };
    default:
      return { title: '협상 후 퇴각', lines: [practice ? '연습장 전투라 아무것도 기록되지 않습니다.' : '협상 끝에 군을 물렸습니다. 저장된 게임은 바뀌지 않았습니다.'] };
  }
}
