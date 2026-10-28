// The campaign screen: the world map on a canvas, the top bar, time controls, the settlement
// panel, saving. It reads the game only through campaign.getState() and changes it only through
// campaign.store.transact (with the world and settlement rules) and campaign.advanceMinutes.
import { defaultWorld, orderGroupTo } from '../domains/world/index.js';
import { boundsOf, centerOn, clampView, fitView, hitNode, panBy, screenToWorld, zoomAt } from './camera.js';
import { el, setText } from './dom.js';
import { SPEED_CHOICES, formatDays, formatInt, speedLabel } from './format.js';
import { runFrame } from './frame.js';
import { drawWorld } from './map-draw.js';
import { describeFailure } from './messages.js';
import { createPacer } from './pacer.js';
import { createSettlementPanel } from './settlement-panel.js';
import {
  describeMoveEvent, describeOrder, isIdle, playerGroupIdOf, readHud, settlementUnderGroup,
} from './view-model.js';

const DRAG_PIXELS = 6;

export function createWorldScreen({ root, campaign, world = defaultWorld, onExit, onBattle }) {
  const groupId = playerGroupIdOf(campaign.getState());
  const pacer = createPacer();
  const castleImage = new Image();
  castleImage.src = new URL('../../castle_icon.png', import.meta.url).href;

  // ---- DOM
  const canvas = el('canvas', { id: 'world-canvas', 'aria-label': '월드맵. 거점이나 땅을 눌러 부대를 이동시킵니다.' });
  const hud = {
    gold: el('span', { id: 'hud-gold' }),
    food: el('span', { id: 'hud-food' }),
    manpower: el('span', { id: 'hud-manpower' }),
    territory: el('span', { id: 'hud-territory' }),
    day: el('span', { id: 'hud-day' }),
  };
  const item = (label, node, unit = '') => el('div', { class: 'hud-item' }, el('span', { class: 'hud-label', text: label }), node, unit && el('span', { class: 'hud-unit', text: unit }));
  const hudBar = el('div', { id: 'hud', class: 'hud' },
    item('소지금', hud.gold, ' 솔리두스'), item('식량', hud.food, '일 치'), item('인력', hud.manpower, '명'), item('영지', hud.territory, '곳'), item('날짜', hud.day, '일차'));

  const timeLabel = el('span', { id: 'time-label', class: 'time-label' });
  const speedButtons = SPEED_CHOICES.map((speed) => el('button', {
    id: `speed-${speed}`, type: 'button', dataset: { speed }, 'aria-pressed': 'false', text: speedLabel(speed),
  }));
  const timeBar = el('div', { id: 'time-controls', class: 'time-controls' }, timeLabel, ...speedButtons);

  const partyStatus = el('div', { id: 'party-status', class: 'party-status' });
  const mapMessage = el('div', { id: 'map-message', class: 'map-message', role: 'status', 'aria-live': 'polite' });
  const panelRoot = el('aside', { id: 'settlement-panel', class: 'panel', 'aria-label': '거점 정보' });
  const saveStatus = el('span', { id: 'save-status', class: 'save-status', role: 'status', 'aria-live': 'polite', text: '아직 저장하지 않았습니다.' });
  const saveButton = el('button', { id: 'btn-save', type: 'button', text: '저장' });
  const battleButton = el('button', { id: 'btn-battle', type: 'button', text: '전투' });
  const centerButton = el('button', { id: 'btn-center', type: 'button', text: '내 위치' });
  const menuButton = el('button', { id: 'btn-menu', type: 'button', text: '메인 메뉴' });
  const leaveButton = el('button', { id: 'btn-leave-unsaved', type: 'button', hidden: true, text: '저장하지 않고 나가기' });
  const toolbar = el('div', { class: 'toolbar' }, saveButton, battleButton, centerButton, menuButton, leaveButton, saveStatus);

  root.replaceChildren(canvas, hudBar, timeBar, partyStatus, panelRoot, mapMessage, toolbar);

  const panel = createSettlementPanel({ root: panelRoot, campaign, getNodeName: (id) => world.nodeById.get(id)?.name ?? id });

  // ---- view
  let viewport = { width: 1, height: 1 };
  let view = { zoom: 1, x: 0, y: 0 };
  let userMovedView = false;
  // The first view shows the settlements (and the party) rather than the whole empty continent.
  const startFocus = boundsOf([...world.nodes, campaign.getState().world.mobileGroups[groupId].worldPosition], 350);
  let dirty = true;
  const ctx = canvas.getContext('2d');

  function measure() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    viewport = { width, height };
    view = userMovedView ? clampView(view, world.map, viewport) : fitView(world.map, viewport, startFocus);
    dirty = true;
  }
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
  resizeObserver?.observe(canvas);

  function say(kind, text) {
    mapMessage.dataset.kind = kind;
    setText(mapMessage, text);
  }

  // ---- saving
  function save(kind) {
    const result = campaign.save();
    const state = campaign.getState();
    saveStatus.dataset.kind = result.ok ? 'ok' : 'error';
    saveStatus.dataset.saveKind = kind;
    setText(saveStatus, result.ok
      ? `${kind === 'auto' ? '자동 저장' : '저장'}했습니다 (${readHud(state).clock}).`
      : `${kind === 'auto' ? '자동 저장' : '저장'}하지 못했습니다: ${describeFailure(result)}`);
    return result;
  }

  // ---- showing the state
  let lastRevision = -1;
  function showState() {
    const state = campaign.getState();
    const info = readHud(state);
    setText(hud.gold, formatInt(info.gold));
    setText(hud.food, formatDays(info.foodDays));
    setText(hud.manpower, formatInt(info.manpower));
    setText(hud.territory, formatInt(info.territory));
    setText(hud.day, info.day);
    setText(timeLabel, info.clock);
    for (const button of speedButtons) button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === info.speed));

    const group = state.world.mobileGroups[groupId];
    const at = settlementUnderGroup(state, world, groupId);
    const idle = isIdle(group);
    partyStatus.dataset.at = at ? at.id : '';
    partyStatus.dataset.moving = String(!idle);
    partyStatus.dataset.x = group.worldPosition.x.toFixed(1);
    partyStatus.dataset.y = group.worldPosition.y.toFixed(1);
    setText(partyStatus, `${group.name}: ${at ? `${at.name}에 머무는 중` : idle ? '정지' : '이동 중'} (${Math.round(group.worldPosition.x)}, ${Math.round(group.worldPosition.y)})`);
    panel.update(state, at ? at.id : null);
    lastRevision = state.revision;
    dirty = true;
  }

  function draw() {
    const state = campaign.getState();
    ctx.setTransform(canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0);
    const at = settlementUnderGroup(state, world, groupId);
    drawWorld(ctx, { view, viewport, world, group: state.world.mobileGroups[groupId], castleImage, selectedNodeId: at ? at.id : null });
    canvas.dataset.zoom = view.zoom.toFixed(4);
    canvas.dataset.viewX = view.x.toFixed(2);
    canvas.dataset.viewY = view.y.toFixed(2);
    dirty = false;
  }

  // ---- orders
  function order(target) {
    const state = campaign.getState();
    const result = campaign.store.transact('order group', (draft) => orderGroupTo(draft, { groupId, ...target }, { world }));
    if (!result.ok) {
      say('error', `이동할 수 없습니다: ${describeFailure(result)}`);
      return;
    }
    const paused = state.clock.speed === 0 ? ' 지금은 일시정지 상태라 시간을 재생하면 움직입니다.' : '';
    const detour = result.routeFailure ? ` (${describeFailure({ ok: false, error: result.routeFailure })})` : '';
    say('info', `${describeOrder(result, world, target.nodeId)}${detour}${paused}`);
    showState();
  }

  function onMapClick(point) {
    const state = campaign.getState();
    const node = hitNode(view, world.nodes, point);
    if (node) {
      const here = settlementUnderGroup(state, world, groupId);
      if (here && here.id === node.id) {
        say('info', `이미 ${node.name}에 있습니다. 아래 거점 정보를 확인하세요.`);
        return;
      }
      order({ nodeId: node.id });
    } else {
      const spot = screenToWorld(view, point);
      order({ x: spot.x, y: spot.y });
    }
  }

  // ---- pointer input: click = order, drag = pan, wheel / two fingers = zoom
  const pointers = new Map();
  let pinchDistance = null;
  const localPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    const p = localPoint(event);
    pointers.set(event.pointerId, { ...p, startX: p.x, startY: p.y, dragged: false });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      for (const entry of pointers.values()) entry.dragged = true;
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    const entry = pointers.get(event.pointerId);
    if (!entry) return;
    const p = localPoint(event);
    const dx = p.x - entry.x;
    const dy = p.y - entry.y;
    entry.x = p.x;
    entry.y = p.y;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance > 0 && distance > 0) {
        view = zoomAt(view, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance / pinchDistance, world.map, viewport);
        userMovedView = true;
        dirty = true;
      }
      pinchDistance = distance;
      return;
    }
    if (!entry.dragged && Math.hypot(p.x - entry.startX, p.y - entry.startY) >= DRAG_PIXELS) entry.dragged = true;
    if (entry.dragged) {
      view = panBy(view, dx, dy, world.map, viewport);
      userMovedView = true;
      dirty = true;
    }
  });
  const release = (event, cancelled) => {
    const entry = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    pinchDistance = null;
    if (entry && !cancelled && !entry.dragged) onMapClick({ x: entry.x, y: entry.y });
  };
  canvas.addEventListener('pointerup', (event) => release(event, false));
  canvas.addEventListener('pointercancel', (event) => release(event, true));
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    view = zoomAt(view, localPoint(event), Math.exp(-event.deltaY * 0.0015), world.map, viewport);
    userMovedView = true;
    dirty = true;
  }, { passive: false });

  // ---- buttons
  let halted = false;
  let retryDays = false;
  function setSpeed(speed) {
    if (campaign.getState().clock.speed !== speed) {
      const result = campaign.store.transact('set speed', (draft) => { draft.clock.speed = speed; });
      if (!result.ok) {
        say('error', `배속을 바꾸지 못했습니다: ${describeFailure(result)}`);
        return;
      }
    }
    if (halted) {
      halted = false;
      retryDays = true;
      say('info', '시간을 다시 흐르게 합니다.');
    }
    showState();
  }
  speedButtons.forEach((button) => button.addEventListener('click', () => setSpeed(Number(button.dataset.speed))));
  saveButton.addEventListener('click', () => save('manual'));
  battleButton.addEventListener('click', () => onBattle());
  centerButton.addEventListener('click', () => {
    const group = campaign.getState().world.mobileGroups[groupId];
    view = centerOn(view, group.worldPosition, world.map, viewport, Math.max(view.zoom, 0.5));
    userMovedView = true;
    dirty = true;
  });
  menuButton.addEventListener('click', () => {
    const result = save('manual');
    if (result.ok) onExit();
    else leaveButton.hidden = false;
  });
  leaveButton.addEventListener('click', () => onExit());

  // ---- the frame loop
  let raf = 0;
  let last = null;
  let running = false;

  function frame(timestamp) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = last === null ? 0 : timestamp - last;
    last = timestamp;
    if (!halted) {
      const result = runFrame({ campaign, groupId, realDtMs: dt, pacer, world, retryDays });
      retryDays = false;
      if (result.event) say(result.event.type === 'blocked' ? 'warn' : 'info', describeMoveEvent(result.event, world));
      if (result.processedDays.length > 0) save('auto');
      if (result.failure) {
        halted = true;
        say('error', `게임 시간이 멈췄습니다: ${describeFailure(result.failure)} 배속 단추를 눌러 다시 시도하세요.`);
      }
    }
    if (campaign.getState().revision !== lastRevision) showState();
    if (dirty) draw();
  }

  function resume() {
    if (running) return;
    running = true;
    last = null;
    pacer.reset();
    measure();
    showState();
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    running = false;
    cancelAnimationFrame(raf);
  }
  function dispose() {
    pause();
    resizeObserver?.disconnect();
    root.replaceChildren();
  }

  castleImage.addEventListener('load', () => { dirty = true; });
  resume();
  return { pause, resume, dispose, say, save, refresh: showState };
}
