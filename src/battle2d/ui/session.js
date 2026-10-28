// Runs one battle on screen: builds the canvas and HUD inside the container, steps the battle at a
// fixed rate, draws it, turns input and button presses into orders, runs negotiations, and reports
// the end exactly once. dispose() removes everything it added.
import { createCamera } from './camera.js';
import { createRenderer } from './renderer.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { BATTLE_CSS } from './styles.js';
import { createCosmeticRandom } from '../sim/random.js';
import { DIPLOMACY_RULES } from '../sim/diplomacy.js';
import { defaultDialogue, requestLordDialogue } from '../sim/lord-dialogue.js';

// The battle advances in equal slices, so what happens depends only on how many slices have run.
const STEP = 1 / 60;
// A long pause (a hidden tab) must not become one huge jump.
const MAX_FRAME_SECONDS = 0.1;
const MAX_STEPS_PER_FRAME = 40;
const COMMAND_MODES = ['move', 'attack', 'direction'];

function endLines(result, mode) {
  const lines = [];
  if (result.outcome === 'victory') {
    lines.push('전장을 지배했습니다!');
    lines.push(result.lordCaptured ? '👑 적 영주를 생포했습니다!' : '💨 적 영주가 간신히 도망쳤습니다.');
    if (mode === 'practice') lines.push('연습장 전투라 전리품과 영지는 기록되지 않습니다.');
  } else if (result.outcome === 'defeat') {
    lines.push('아군이 모두 전멸하거나 흩어졌습니다.');
  } else if (result.outcome === 'retreat') {
    lines.push('아군이 전장을 이탈했습니다.');
  } else if (result.outcome === 'surrender') {
    lines.push('항복했습니다. 영주가 사로잡혔습니다.');
  } else if (result.outcome === 'negotiated_retreat') {
    lines.push('협상이 성립해 적군이 전장에서 물러났습니다.');
    const offer = result.diplomacy && result.diplomacy.offer;
    if (offer) lines.push(`지불 조건: 금화 ${offer.gold}, 식량 ${offer.food}`);
  } else if (result.outcome === 'strategic_retreat') {
    lines.push('불리해진 적군이 전략적으로 후퇴했습니다.');
  }
  lines.push(`적 격파 ${result.enemyKilledUnits} · 적 도주 ${result.enemyRoutedUnits} · 아군 손실 ${result.allyLostUnits} · 아군 생존 ${result.allySurvivingUnits}`);
  return lines;
}

export function createSession({ container, battle, mode, onEnd, options = {} }) {
  const doc = container.ownerDocument;
  const view = doc.defaultView;
  const camera = createCamera();

  // The container must be a positioning context for the battle to fill it.
  const previousPosition = container.style.position;
  const addedPosition = view.getComputedStyle(container).position === 'static';
  if (addedPosition) container.style.position = 'relative';

  const root = doc.createElement('div');
  root.className = 'b2d-root';
  root.setAttribute('data-b2d', 'root');
  root.setAttribute('data-mode', mode);
  const style = doc.createElement('style');
  style.textContent = BATTLE_CSS;
  const canvas = doc.createElement('canvas');
  canvas.className = 'b2d-canvas';
  canvas.setAttribute('data-b2d', 'canvas');
  root.append(style, canvas);
  container.appendChild(root);

  // On a narrow screen the deployment area would be mostly off screen: start on the allies, a little further out.
  if (root.clientWidth > 0 && root.clientWidth < 700) {
    camera.zoom = Math.max(0.5, Math.min(1, root.clientWidth / 700));
    camera.x = 300;
  }

  const renderer = createRenderer({
    canvas,
    doc,
    view,
    camera,
    terrain: battle.terrain,
    cosmeticRandom: createCosmeticRandom(options.seed >>> 0),
  });

  let disposed = false;
  let frameId = null;
  let lastTimestamp = null;
  let accumulator = 0;
  let userTimeScale = Number.isFinite(options.timeScale) && options.timeScale >= 0 ? options.timeScale : 1;
  let openDialogs = 0;
  let commandMode = 'move';
  let waypointMode = false;
  let endShown = false;
  let endDelivered = false;
  const abort = typeof view.AbortController === 'function' ? new view.AbortController() : null;

  const fetchImpl = options.fetch || (view.fetch ? view.fetch.bind(view) : null);
  const apiKey = typeof options.geminiApiKey === 'string' ? options.geminiApiKey.trim() : '';
  const talk = { sequence: 0, pending: false, history: [] };

  const effectiveTimeScale = () => (openDialogs > 0 ? 0 : userTimeScale);

  function deliverEnd() {
    if (endDelivered || disposed) return;
    endDelivered = true;
    if (typeof onEnd === 'function') onEnd(JSON.parse(JSON.stringify(battle.result)));
  }

  function showEnd() {
    if (endShown) return;
    endShown = true;
    const waitForConfirm = Boolean(options.confirmEnd);
    hud.showEnd(battle.result, { lines: endLines(battle.result, mode), waitForConfirm });
    renderFrame(0);
    if (!waitForConfirm) deliverEnd();
  }

  // Called after anything that can end the battle: the HUD shows the end, then onEnd is called.
  function afterCommand() {
    battle.checkEnd();
    if (battle.isOver) showEnd();
  }

  function pauseForDialog() {
    openDialogs += 1;
  }

  function resumeAfterDialog() {
    openDialogs = Math.max(0, openDialogs - 1);
  }

  async function sendDiplomacy(text) {
    if (battle.isOver || talk.pending) return;
    const decision = battle.evaluateDiplomacy(text);
    talk.sequence += 1;
    hud.addChatLine('player', text);
    talk.history.push({ role: 'player', text });
    talk.history = talk.history.slice(-DIPLOMACY_RULES.HISTORY_MAX_MESSAGES);
    if (decision.reason === 'baseline_missing' || decision.reason === 'invalid_battle_state') {
      hud.addChatLine('notice', '[외교 불가] 전투 기준 상태를 확인하지 못했습니다. 전투를 다시 시작해 주세요.');
      return;
    }
    let spoken = defaultDialogue(decision, false);
    if (apiKey && fetchImpl) {
      const signature = battle.signature();
      talk.pending = true;
      const waiting = hud.addChatLine('lord', '"..." (영주가 답을 고르고 있습니다)');
      try {
        spoken = await requestLordDialogue({ apiKey, decision, history: talk.history, fetchImpl, signal: abort ? abort.signal : undefined });
      } catch (error) {
        spoken = defaultDialogue(decision, true);
      }
      talk.pending = false;
      if (disposed) return;
      waiting.remove();
      // The field moved on while the answer was being written: that answer no longer applies.
      if (battle.isOver || battle.signature() !== signature) {
        hud.addChatLine('notice', '[외교 응답 무효] 전장 상태가 바뀌어 이번 응답을 적용하지 않았습니다. 다시 시도해 주세요.');
        return;
      }
    }
    if (decision.discarded) {
      hud.addChatLine('notice', '[외교 응답 무효] 이미 전투가 끝났습니다.');
      return;
    }
    const applied = battle.applyDiplomacy(decision);
    const shown = applied.applied ? spoken : defaultDialogue({ action: 'negotiate' }, false);
    hud.addChatLine('lord', `[${shown.emotion}] "${shown.dialogue}"`);
    talk.history.push({ role: 'lord', text: shown.dialogue });
    talk.history = talk.history.slice(-DIPLOMACY_RULES.HISTORY_MAX_MESSAGES);
    if (applied.ended) {
      hud.showDiplomacy(false);
      afterCommand();
    }
  }

  const controller = {
    startFight() {
      battle.beginBattle();
    },
    setTimeScale(scale) {
      userTimeScale = scale;
    },
    getCommandMode: () => commandMode,
    setCommandMode(next) {
      if (COMMAND_MODES.includes(next)) commandMode = next;
    },
    toggleWaypointMode() {
      waypointMode = !waypointMode;
      commandMode = 'move';
    },
    clearWaypoints: () => battle.clearWaypoints(),
    deselectAll: () => battle.deselectAll(),
    selectSubType: (subType) => battle.selectBySubType(subType),
    setFormation: (name) => battle.setFormation(name),
    retreat() {
      battle.orderRetreat();
      afterCommand();
    },
    requestSurrender() {
      if (battle.isOver) return;
      pauseForDialog();
      hud.showSurrender(true);
    },
    confirmSurrender() {
      hud.showSurrender(false);
      resumeAfterDialog();
      battle.surrender();
      afterCommand();
    },
    cancelSurrender() {
      hud.showSurrender(false);
      resumeAfterDialog();
    },
    openDiplomacy() {
      if (battle.isOver) return;
      pauseForDialog();
      hud.showDiplomacy(true);
    },
    closeDiplomacy() {
      hud.showDiplomacy(false);
      resumeAfterDialog();
    },
    sendDiplomacy,
    confirmEnd: deliverEnd,
  };

  const hud = createHud({ doc, root, mode, controller });

  const input = createInput({
    canvas,
    camera,
    getCommandMode: controller.getCommandMode,
    setCommandMode: controller.setCommandMode,
    onAction(action) {
      if (battle.isOver) return;
      if (action.type === 'tap') battle.tap(action.point, { waypointMode });
      else if (action.type === 'attack') battle.attack(action.point);
      else if (action.type === 'drag') battle.dragLine(action.start, action.end, { waypointMode });
      else if (action.type === 'direction') battle.setFacing(action.angle);
    },
  });

  function hudState() {
    const allies = battle.squads.filter((squad) => squad.team === 'ally');
    return {
      phase: battle.phase,
      timeScale: userTimeScale,
      commandMode,
      waypointMode,
      elapsed: battle.elapsed,
      ally: allies.map((squad) => ({
        id: squad.id,
        name: squad.name,
        soldiers: squad.units.length,
        morale: squad.morale,
        state: squad.state,
        selected: squad.selected,
        waypoints: squad.waypoints.length,
        x: squad.centerX,
        y: squad.centerY,
      })),
    };
  }

  function renderFrame(realDt) {
    for (const event of battle.drainEvents()) renderer.addEvent(event);
    hud.update(hudState());
    root.setAttribute('data-phase', battle.phase);
    root.setAttribute('data-ended', battle.isOver ? 'true' : 'false');
    root.setAttribute('data-time-scale', String(userTimeScale));
    renderer.draw(battle.squads, realDt, input.getDrawing());
  }

  function frame(timestamp) {
    frameId = null;
    if (disposed) return;
    const realDt = lastTimestamp === null ? 0 : Math.min(MAX_FRAME_SECONDS, Math.max(0, (timestamp - lastTimestamp) / 1000));
    lastTimestamp = timestamp;
    if (!battle.isOver) {
      accumulator += realDt * effectiveTimeScale();
      let steps = 0;
      while (accumulator >= STEP && steps < MAX_STEPS_PER_FRAME && !battle.isOver) {
        battle.step(STEP);
        accumulator -= STEP;
        steps += 1;
      }
      if (steps >= MAX_STEPS_PER_FRAME) accumulator = 0;
      // Also checked while paused or still deploying, as the original did every frame.
      battle.checkEnd();
    }
    if (battle.isOver && !endShown) {
      showEnd();
      if (disposed) return;
    }
    renderFrame(realDt);
    frameId = view.requestAnimationFrame(frame);
  }

  renderFrame(0);
  frameId = view.requestAnimationFrame(frame);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frameId !== null) view.cancelAnimationFrame(frameId);
      frameId = null;
      if (abort) abort.abort();
      input.dispose();
      hud.dispose();
      renderer.dispose();
      root.remove();
      if (addedPosition) container.style.position = previousPosition;
    },
  };
}
