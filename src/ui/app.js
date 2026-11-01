// Puts the screens together: main menu, campaign screen, battles and their result panel.
// Everything it needs from outside arrives as arguments (storage, the battle starter, a seed
// source), so src/main.js is the only place that knows about the browser and the battle module.
import { createStore } from '../core/store.js';
import { fail } from '../core/result.js';
import { createCampaign, newCampaignState, openCampaign } from '../game/campaign.js';
import { defaultWorld } from '../domains/world/index.js';
import { createSaveService } from '../persist/save.js';
import { validateState } from '../persist/schema.js';
import { applyCampaignVictory, describeBattleEnd } from './battle-result.js';
import { runBattle } from './battle-flow.js';
import { el } from './dom.js';
import { describeFailure } from './messages.js';
import { renderMenu } from './menu-screen.js';
import { createWorldScreen } from './world-screen.js';
import { buildHeroSheet } from '../game/battle-hero.js';
import { PLAYER_CHARACTER_ID } from '../game/new-game.js';

// storage: { get, set, remove }. startBattle: see battle-flow.js. newSeed(): a whole number for a new game or practice battle.
// battleView: { get() -> '2d' | '3d', set(view) } when the player may choose how battles are drawn (src/main.js).
export function mountApp({ root, storage, startBattle, newSeed = () => Date.now() >>> 0, world = defaultWorld, battleView = null }) {
  const menuRoot = el('section', { id: 'screen-menu', class: 'screen menu' });
  const worldRoot = el('section', { id: 'screen-world', class: 'screen world', hidden: true });
  const battleHost = el('div', { id: 'battle-host', class: 'overlay battle-host', hidden: true });
  const battleContainer = el('div', { id: 'battle-container', class: 'battle-container' });
  battleHost.append(battleContainer);
  const resultOverlay = el('div', { id: 'battle-result', class: 'overlay result', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'battle-result-title' });
  root.replaceChildren(menuRoot, worldRoot, battleHost, resultOverlay);

  let worldScreen = null;
  let busy = false;

  // ---- saves
  function openSave() {
    try {
      return openCampaign(storage, { seed: newSeed() });
    } catch (error) {
      return fail('storage_unavailable', String(error?.message ?? error));
    }
  }

  // A new campaign on this storage, for starting over an unreadable save.
  function freshCampaign() {
    const store = createStore(newCampaignState({ seed: newSeed() }), { validate: validateState });
    return createCampaign(store, createSaveService(storage));
  }

  // ---- screens
  function menuHandlers() {
    return {
      onPractice: startPractice, onMainGame, onStartNew,
      // 2D or 3D battles: remembered for next time, and the menu shows the choice.
      onToggleBattleView: battleView ? () => { battleView.set(battleView.get() === '3d' ? '2d' : '3d'); showMenu(); } : null,
    };
  }

  function showMenu(notice = '') {
    worldScreen?.dispose();
    worldScreen = null;
    worldRoot.hidden = true;
    menuRoot.hidden = false;
    renderMenu(menuRoot, { opened: openSave(), notice, handlers: menuHandlers(), battleView: battleView?.get() ?? null });
  }

  function enterCampaign(campaign) {
    menuRoot.hidden = true;
    worldRoot.hidden = false;
    worldScreen = createWorldScreen({
      root: worldRoot,
      campaign,
      world,
      onExit: () => showMenu(),
      onBattle: () => startCampaignBattle(campaign),
    });
  }

  function onMainGame() {
    const opened = openSave();
    if (opened.ok) enterCampaign(opened.campaign);
    else renderMenu(menuRoot, { opened, notice: '', handlers: menuHandlers(), battleView: battleView?.get() ?? null });
  }

  // The player chose to start over an unreadable save: the one place that may replace it.
  function onStartNew() {
    const campaign = freshCampaign();
    const saved = campaign.save({ replaceUnreadable: true });
    if (!saved.ok) {
      const opened = openSave();
      renderMenu(menuRoot, {
        opened: opened.ok ? fail('save_refused_stored_save_unreadable') : opened,
        notice: `새로 시작하지 못했습니다: ${describeFailure(saved)}`,
        handlers: menuHandlers(),
        battleView: battleView?.get() ?? null,
      });
      return;
    }
    enterCampaign(campaign);
  }

  // ---- battles
  function showResult({ title, lines, outcome, kind }) {
    return new Promise((resolve) => {
      const ok = el('button', { id: 'battle-result-ok', type: 'button', text: '확인' });
      ok.addEventListener('click', () => {
        resultOverlay.hidden = true;
        resultOverlay.replaceChildren();
        resolve();
      });
      resultOverlay.replaceChildren(el('div', { class: 'dialog' },
        el('h2', { id: 'battle-result-title', text: title }),
        el('div', { id: 'battle-result-message', dataset: { outcome, kind } }, lines.map((line) => el('p', { text: line }))),
        ok));
      resultOverlay.hidden = false;
      ok.focus();
    });
  }

  async function fight({ mode, seed, options = {} }) {
    battleHost.hidden = false;
    const ended = await runBattle({ startBattle, container: battleContainer, mode, seed, options });
    battleHost.hidden = true;
    return ended;
  }

  async function startPractice() {
    if (busy) return;
    busy = true;
    try {
      menuRoot.hidden = true;
      // Practice reads and writes nothing of the saved game.
      const ended = await fight({ mode: 'practice', seed: newSeed() });
      if (!ended.ok) await showResult({ title: '전투를 마치지 못했습니다', lines: [describeFailure(ended), '아무것도 기록하지 않았습니다.'], kind: 'error' });
      else await showResult({ ...describeBattleEnd({ mode: 'practice', result: ended.result }), outcome: ended.result.outcome, kind: 'practice' });
    } finally {
      busy = false;
      showMenu();
    }
  }

  async function startCampaignBattle(campaign) {
    if (busy) return;
    busy = true;
    worldScreen?.pause();
    try {
      const state = campaign.getState();
      // The player's hero fights with his own skills and equipment (the 3D battle; the 2D ignores it).
      const heroSheet = buildHeroSheet(state, PLAYER_CHARACTER_ID);
      const ended = await fight({ mode: 'campaign', seed: (state.rng.state ^ state.revision) >>> 0, options: { heroSheet } });
      if (!ended.ok) {
        await showResult({ title: '전투를 마치지 못했습니다', lines: [describeFailure(ended), '아무것도 기록하지 않았습니다.'], kind: 'error' });
        return;
      }
      const { result } = ended;
      let reward = null;
      let failure = null;
      if (result.outcome === 'victory') {
        const applied = applyCampaignVictory(campaign, result);
        if (applied.ok) reward = applied;
        else failure = applied;
      }
      await showResult({
        ...describeBattleEnd({ mode: 'campaign', result, reward, failure }),
        outcome: result.outcome,
        kind: failure ? 'error' : 'campaign',
      });
    } finally {
      busy = false;
      worldScreen?.resume();
    }
  }

  showMenu();
  return { dispose() { worldScreen?.dispose(); root.replaceChildren(); } };
}
