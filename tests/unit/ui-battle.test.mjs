import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCampaignVictory, describeBattleEnd, normalizeBattleResult } from '../../src/ui/battle-result.js';
import { runBattle } from '../../src/ui/battle-flow.js';
import { memoryStorage } from '../../src/persist/storage.js';
import { SAVE_KEY, decodeSave } from '../../src/persist/save.js';
import { getCampaignMetrics, playerAccountIdOf } from '../../src/domains/finance/index.js';
import { countCommits, openFresh } from './ui-helpers.mjs';

const victory = (extra = {}) => ({
  outcome: 'victory', enemyRoutedUnits: 13, enemyKilledUnits: 4, allyLostUnits: 1, allySurvivingUnits: 9, lordCaptured: false, ...extra,
});
const gold = (campaign) => campaign.getState().world.finance.accounts[playerAccountIdOf(campaign.getState())].balance;

test('[ui.battle.result-validated] only a complete, sane battle result is accepted; anything else pays nothing', () => {
  assert.equal(normalizeBattleResult(victory()).ok, true);
  for (const outcome of ['defeat', 'retreat', 'surrender', 'negotiated_retreat']) assert.equal(normalizeBattleResult(victory({ outcome })).ok, true);
  const bad = [null, 'victory', victory({ outcome: 'won' }), victory({ enemyRoutedUnits: -1 }), victory({ enemyRoutedUnits: 2.5 }),
    victory({ allyLostUnits: '3' }), victory({ lordCaptured: 'yes' }), { ...victory(), enemyKilledUnits: undefined }];
  for (const raw of bad) {
    const result = normalizeBattleResult(raw);
    assert.equal(result.ok, false, JSON.stringify(raw));
    assert.equal(result.error, 'battle_result_invalid');
  }
  assert.deepEqual(normalizeBattleResult({ ...victory(), extra: 1 }).result, victory());
});

test('[ui.battle.victory-reward-one-transaction] a campaign victory adds 1500..2499 gold, manpower 40% of the routed and one territory in one transaction, then saves', () => {
  const { campaign, storage } = openFresh();
  const accountId = playerAccountIdOf(campaign.getState());
  const commits = countCommits(campaign);
  const applied = applyCampaignVictory(campaign, normalizeBattleResult(victory()).result);
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(commits.count, 1);
  assert.deepEqual(commits.labels, ['battle victory']);
  assert.ok(applied.gold >= 1500 && applied.gold <= 2499);
  assert.equal(gold(campaign), 500 + applied.gold);
  assert.deepEqual(getCampaignMetrics(campaign.getState(), accountId), { manpower: 5, territory: 1 });
  assert.equal(applied.manpower, 5);
  const saved = decodeSave(storage.get(SAVE_KEY));
  assert.equal(saved.ok, true);
  assert.equal(saved.state.world.finance.accounts[accountId].balance, 500 + applied.gold);
  assert.equal(saved.revision, campaign.getState().revision);
});

test('[ui.battle.reward-gold-range] over many seeds the gold of a victory is always 1500..2499 and spreads over the range', () => {
  const rewards = [];
  for (let seed = 1; seed <= 80; seed += 1) {
    const applied = applyCampaignVictory(openFresh(memoryStorage(), seed).campaign, victory());
    assert.equal(applied.ok, true);
    rewards.push(applied.gold);
  }
  assert.ok(Math.min(...rewards) >= 1500, `lowest ${Math.min(...rewards)}`);
  assert.ok(Math.max(...rewards) <= 2499, `highest ${Math.max(...rewards)}`);
  assert.ok(Math.min(...rewards) < 1700 && Math.max(...rewards) > 2300, 'the whole range is used');
  assert.ok(new Set(rewards).size > 40);
});

test('[ui.battle.victory-reward-uses-seeded-draw] the gold of a victory comes from the game\'s own seeded random numbers, so it repeats for the same seed and state', () => {
  const rewards = [openFresh(memoryStorage(), 5), openFresh(memoryStorage(), 5), openFresh(memoryStorage(), 6)]
    .map(({ campaign }) => applyCampaignVictory(campaign, victory()).gold);
  assert.equal(rewards[0], rewards[1]);
  assert.notEqual(rewards[0], rewards[2]);
});

test('[ui.battle.victory-save-failure-changes-nothing] if the reward cannot be saved the campaign is exactly as before and the failure says why', () => {
  let failing = false;
  const storage = memoryStorage({}, { failOn: () => failing });
  const { campaign } = openFresh(storage);
  const before = campaign.getState();
  const stored = JSON.stringify([...storage.data.entries()]);
  failing = true;
  const applied = applyCampaignVictory(campaign, victory());
  failing = false;
  assert.equal(applied.ok, false);
  assert.equal(applied.error, 'battle_reward_not_saved');
  assert.equal(applied.detail.cause.error, 'save_write_failed');
  assert.deepEqual(campaign.getState(), before);
  assert.equal(gold(campaign), 500);
  assert.equal(JSON.stringify([...storage.data.entries()]), stored);
  // The game goes on: a later victory works and the earlier failure left nothing behind.
  const again = applyCampaignVictory(campaign, victory());
  assert.equal(again.ok, true);
  assert.equal(gold(campaign), 500 + again.gold);
});

test('[ui.battle.victory-save-conflict-changes-nothing] a save that another tab got ahead of is refused and the reward is not kept', () => {
  const storage = memoryStorage();
  const { campaign } = openFresh(storage);
  assert.equal(campaign.save().ok, true);
  const other = openFresh(storage).campaign;
  other.store.transact('other tab', (draft) => { draft.prefs.worldScale = 2; });
  assert.equal(other.save().ok, true);
  const before = campaign.getState();
  const applied = applyCampaignVictory(campaign, victory());
  assert.equal(applied.ok, false);
  assert.equal(applied.detail.cause.error, 'save_conflict');
  assert.deepEqual(campaign.getState(), before);
});

test('[ui.battle.other-outcomes-text-and-no-state] defeat, retreat, surrender and negotiated retreat describe themselves honestly and the campaign has no reward step for them', () => {
  for (const outcome of ['defeat', 'retreat', 'surrender', 'negotiated_retreat']) {
    const text = describeBattleEnd({ mode: 'campaign', result: victory({ outcome }) });
    assert.ok(text.title.length > 0);
    assert.ok(text.lines.some((line) => /바뀌지 않았|잃지 않았/.test(line)), `${outcome}: ${text.lines.join(' ')}`);
    assert.ok(!text.lines.some((line) => /영지를 빼앗/.test(line)), 'no claim of a loss that is not recorded');
  }
  const practice = describeBattleEnd({ mode: 'practice', result: victory() });
  assert.match(practice.lines.join(' '), /기록되지 않습니다/);
  const reward = describeBattleEnd({ mode: 'campaign', result: victory({ lordCaptured: true }), reward: { gold: 1700, manpower: 5, territory: 1 } });
  assert.match(reward.lines.join(' '), /1700/);
  assert.match(reward.lines.join(' '), /생포/);
  const failed = describeBattleEnd({ mode: 'campaign', result: victory(), failure: { ok: false, error: 'battle_reward_not_saved', detail: { cause: { ok: false, error: 'save_conflict' } } } });
  assert.match(failed.lines.join(' '), /save_conflict/);
  assert.match(failed.lines.join(' '), /바뀌지 않았습니다/);
});

// A stand-in for the container the battle draws into.
const container = () => ({ cleared: 0, replaceChildren() { this.cleared += 1; } });

test('[ui.battle.flow-counts-end-once] the end of a battle is honoured once, the battle is disposed once, a second report is ignored', async () => {
  const box = container();
  let disposed = 0;
  let received;
  const startBattle = (options) => {
    received = options;
    return { dispose() { disposed += 1; } };
  };
  const pending = runBattle({ startBattle, container: box, mode: 'campaign', seed: 77 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(received.mode, 'campaign');
  assert.equal(received.seed, 77);
  assert.equal(received.container, box);
  assert.equal(typeof received.enemyStrength, 'number');
  assert.equal(typeof received.allyStrength, 'number');
  received.onEnd(victory());
  received.onEnd(victory({ outcome: 'defeat' }));
  const ended = await pending;
  assert.equal(ended.ok, true);
  assert.equal(ended.result.outcome, 'victory');
  assert.equal(disposed, 1);
  assert.equal(box.cleared, 1);
});

test('[ui.battle.flow-end-before-start-returns] a battle that reports its end before startBattle even returns is still closed properly, also when startBattle is async', async () => {
  let disposed = 0;
  const syncEnd = runBattle({
    startBattle: ({ onEnd }) => { onEnd(victory()); return { dispose() { disposed += 1; } }; },
    container: container(), mode: 'practice', seed: 1,
  });
  assert.equal((await syncEnd).ok, true);
  // A battle that reports twice before startBattle returned: the first report counts.
  const twice = await runBattle({
    startBattle: ({ onEnd }) => { onEnd(victory()); onEnd(victory({ outcome: 'defeat' })); return { dispose() { disposed += 1; } }; },
    container: container(), mode: 'practice', seed: 1,
  });
  assert.equal(twice.result.outcome, 'victory');
  const asyncStart = runBattle({
    startBattle: async ({ onEnd }) => { onEnd(victory({ outcome: 'retreat' })); await null; return { dispose() { disposed += 1; } }; },
    container: container(), mode: 'practice', seed: 1,
  });
  assert.equal((await asyncStart).result.outcome, 'retreat');
  assert.equal(disposed, 3);
});

test('[ui.battle.flow-start-failure] a battle that cannot start, or reports nonsense, resolves as a failure and pays nothing', async () => {
  const throwing = await runBattle({ startBattle: () => { throw new Error('module missing'); }, container: container(), mode: 'campaign', seed: 1 });
  assert.equal(throwing.ok, false);
  assert.equal(throwing.error, 'battle_start_failed');
  assert.match(throwing.detail, /module missing/);
  const rejecting = await runBattle({ startBattle: () => Promise.reject(new Error('404')), container: container(), mode: 'campaign', seed: 1 });
  assert.equal(rejecting.error, 'battle_start_failed');
  const nonsense = await runBattle({ startBattle: ({ onEnd }) => { onEnd({ outcome: 'victory' }); return { dispose() {} }; }, container: container(), mode: 'campaign', seed: 1 });
  assert.equal(nonsense.ok, false);
  assert.equal(nonsense.error, 'battle_result_invalid');
});
