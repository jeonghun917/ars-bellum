// The on-screen controls of the battle: status, speed, orders, formations, deployment, negotiation,
// surrender confirmation and the end screen. Plain DOM; every text is set as text, never as HTML.
// The HUD only calls the controller it is given and shows the state it is handed.

const SELECT_GROUPS = [
  { type: 'infantry', label: '🛡️ 보병', picks: [['shield', '방패'], ['shock', '충격'], ['pike', '장창'], ['skirmisher', '척후']] },
  { type: 'cavalry', label: '🐎 기병', picks: [['heavy_cav', '중기병'], ['light_cav', '경기병']] },
  { type: 'archer', label: '🏹 궁병', picks: [['archer', '장궁'], ['crossbow', '석궁']] },
];

const FORMATION_BUTTONS = [
  ['line', '➖ 횡대', 'b2d-btn-green'],
  ['column', '▤ 종대', 'b2d-btn-green'],
  ['square', '▣ 방진', 'b2d-btn-green'],
  ['special', '⭐ 특수', 'b2d-btn-green'],
  ['loose', '✖ 산개', 'b2d-btn-cmd'],
];

const OPENING_LINE = '"감히 내 영지에 발을 들이다니, 목숨이 아깝지 않은 모양이군. 할 말이 있다면 들어나 보겠다."';

const END_TITLES = {
  victory: '전투 승리',
  defeat: '전투 패배',
  retreat: '퇴각 완료',
  surrender: '항복',
  negotiated_retreat: '협상 성립',
  strategic_retreat: '적의 후퇴',
};

export function createHud({ doc, root, mode, controller }) {
  const listeners = [];
  let formationOpen = false;

  function make(tag, className, text, attributes) {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    for (const [name, value] of Object.entries(attributes || {})) element.setAttribute(name, value);
    return element;
  }

  function button(label, className, name, onClick) {
    const element = make('button', className, label, { type: 'button', 'data-b2d': name });
    element.addEventListener('click', onClick);
    listeners.push([element, 'click', onClick]);
    return element;
  }

  const layer = make('div', 'b2d-layer');
  root.appendChild(layer);

  // ---- Status and squad list (top left) ----
  const info = make('div', 'b2d-info', undefined, { 'data-b2d': 'info' });
  const title = make('div', 'b2d-title', mode === 'practice' ? '연습장' : '전투');
  const status = make('div', 'b2d-status', undefined, { 'data-b2d': 'status' });
  const roster = make('div', 'b2d-roster', undefined, { 'data-b2d': 'roster' });
  info.append(title, status, roster);

  // ---- Speed and "more" menu (top right) ----
  const topRight = make('div', 'b2d-top-right');
  const speedButtons = {
    1: button('1배속', '', 'speed-1', () => controller.setTimeScale(1)),
    0: button('일시정지', '', 'speed-0', () => controller.setTimeScale(0)),
    2: button('2배속', '', 'speed-2', () => controller.setTimeScale(2)),
  };
  const dropdown = make('div', 'b2d-dropdown');
  const moreButton = button('기타 ▼', '', 'more', () => {
    menu.hidden = !menu.hidden;
  });
  const menu = make('div', 'b2d-dropdown-menu');
  menu.hidden = true;
  const closeMenu = () => {
    menu.hidden = true;
  };
  menu.append(
    button('협상', '', 'negotiate', () => {
      closeMenu();
      controller.openDiplomacy();
    }),
    button('퇴각', '', 'retreat', () => {
      closeMenu();
      controller.retreat();
    }),
    button('항복', '', 'surrender', () => {
      closeMenu();
      controller.requestSurrender();
    }),
  );
  dropdown.append(moreButton, menu);
  topRight.append(speedButtons[1], speedButtons[0], speedButtons[2], dropdown);

  // ---- Deployment banner ----
  const prep = make('div', 'b2d-prep', undefined, { 'data-b2d': 'prep' });
  prep.append(
    make('div', 'b2d-prep-banner', '전력 배치 및 준비 단계'),
    make('div', 'b2d-prep-hint', '아군 부대를 눌러 선택하고 원하는 위치로 옮긴 뒤 전투를 시작하세요.'),
    button('⚔️ 전투 시작', 'b2d-start', 'start', () => controller.startFight()),
  );

  // ---- Bottom bars ----
  const bottom = make('div', 'b2d-bottom');
  const subPanel = make('div', 'b2d-sub-panel');
  subPanel.hidden = true;

  const selectBar = make('div', 'b2d-bar', undefined, { 'data-b2d': 'select-bar' });
  const selectGroup = make('div', 'b2d-group');
  selectGroup.append(make('span', 'b2d-label', '부대 선택'));
  let openGroup = null;
  const groupButtons = new Map();
  for (const group of SELECT_GROUPS) {
    const element = button(group.label, 'b2d-btn', `select-${group.type}`, () => {
      subPanel.replaceChildren();
      if (openGroup === group.type) {
        openGroup = null;
        subPanel.hidden = true;
      } else {
        openGroup = group.type;
        for (const [pick, label] of group.picks) {
          subPanel.appendChild(button(label, 'b2d-btn b2d-btn-pick', `select-${pick}`, () => controller.selectSubType(pick)));
        }
        subPanel.hidden = false;
      }
      for (const [type, other] of groupButtons) other.classList.toggle('is-active', type === openGroup);
    });
    groupButtons.set(group.type, element);
    selectGroup.appendChild(element);
  }
  selectBar.appendChild(selectGroup);

  const commandBar = make('div', 'b2d-bar', undefined, { 'data-b2d': 'command-bar' });
  const commandGroup = make('div', 'b2d-group');
  const attackButton = button('⚔️ 공격', 'b2d-btn b2d-btn-attack', 'cmd-attack', () => controller.setCommandMode(controller.getCommandMode() === 'attack' ? 'move' : 'attack'));
  const directionButton = button('🔄 방향', 'b2d-btn b2d-btn-cmd', 'cmd-direction', () => controller.setCommandMode(controller.getCommandMode() === 'direction' ? 'move' : 'direction'));
  const waypointButton = button('📍 경로예약', 'b2d-btn b2d-btn-cmd', 'cmd-waypoint', () => controller.toggleWaypointMode());
  commandGroup.append(
    make('span', 'b2d-label', '명령'),
    attackButton,
    directionButton,
    button('❖ 진형', 'b2d-btn b2d-btn-green', 'cmd-formation', () => {
      formationOpen = true;
    }),
    waypointButton,
    button('🛑 중단', 'b2d-btn b2d-btn-danger', 'cmd-clear', () => controller.clearWaypoints()),
    button('❌ 해제', 'b2d-btn b2d-btn-danger', 'cmd-deselect', () => controller.deselectAll()),
  );
  commandBar.appendChild(commandGroup);

  const formationBar = make('div', 'b2d-bar', undefined, { 'data-b2d': 'formation-bar' });
  const formationGroup = make('div', 'b2d-group');
  formationGroup.appendChild(make('span', 'b2d-label', '진형선택'));
  for (const [name, label, className] of FORMATION_BUTTONS) {
    formationGroup.appendChild(button(label, `b2d-btn ${className}`, `form-${name}`, () => {
      controller.setFormation(name);
      formationOpen = false;
    }));
  }
  formationGroup.appendChild(button('◀ 닫기', 'b2d-btn b2d-btn-danger', 'form-close', () => {
    formationOpen = false;
  }));
  formationBar.appendChild(formationGroup);
  commandBar.hidden = true;
  formationBar.hidden = true;
  bottom.append(subPanel, selectBar, commandBar, formationBar);

  // ---- Negotiation window ----
  const diplomacy = make('div', 'b2d-modal', undefined, { 'data-b2d': 'diplomacy', role: 'dialog' });
  diplomacy.hidden = true;
  const diplomacyHeader = make('div', 'b2d-modal-header');
  diplomacyHeader.append(make('span', undefined, '적 영주와의 서신'), button('✖', '', 'diplomacy-close', () => controller.closeDiplomacy()));
  const chat = make('div', 'b2d-modal-body b2d-chat', undefined, { 'data-b2d': 'chat' });
  const chatForm = make('div', 'b2d-chat-form');
  const chatInput = make('input', 'b2d-chat-input', undefined, { type: 'text', placeholder: '조건을 입력하세요...', 'data-b2d': 'chat-input' });
  const sendMessage = () => {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    controller.sendDiplomacy(text);
  };
  const onChatKey = (event) => {
    if (event.key === 'Enter') sendMessage();
  };
  chatInput.addEventListener('keydown', onChatKey);
  listeners.push([chatInput, 'keydown', onChatKey]);
  chatForm.append(chatInput, button('전송', 'b2d-send', 'chat-send', sendMessage));
  diplomacy.append(diplomacyHeader, chat, chatForm);
  function resetChat() {
    chat.replaceChildren();
    chat.appendChild(make('div', 'b2d-lord', OPENING_LINE));
  }
  resetChat();

  // ---- Surrender confirmation ----
  const surrender = make('div', 'b2d-modal', undefined, { 'data-b2d': 'surrender-confirm', role: 'dialog' });
  surrender.hidden = true;
  const surrenderBody = make('div', 'b2d-modal-body');
  surrenderBody.append(make('div', undefined, '정말 무기를 버리고 항복하시겠습니까? (즉시 패배)'));
  const surrenderActions = make('div', 'b2d-confirm-actions');
  surrenderActions.append(
    button('항복한다', 'b2d-btn-danger', 'surrender-yes', () => controller.confirmSurrender()),
    button('계속 싸운다', '', 'surrender-no', () => controller.cancelSurrender()),
  );
  surrenderBody.appendChild(surrenderActions);
  surrender.append(make('div', 'b2d-modal-header', '항복'), surrenderBody);

  // ---- End screen ----
  const end = make('div', 'b2d-end', undefined, { 'data-b2d': 'end' });
  end.hidden = true;
  const endCard = make('div', 'b2d-end-card');
  const endTitle = make('div', 'b2d-end-title', undefined, { 'data-b2d': 'end-title' });
  const endText = make('div', 'b2d-end-text', undefined, { 'data-b2d': 'end-text' });
  const endContinue = button('확인', 'b2d-end-continue', 'end-continue', () => controller.confirmEnd());
  endContinue.hidden = true;
  endCard.append(endTitle, endText, endContinue);
  end.appendChild(endCard);

  layer.append(info, topRight, prep, bottom, diplomacy, surrender, end);

  // A press anywhere outside the menu closes it.
  const onPressOutside = (event) => {
    if (!dropdown.contains(event.target)) closeMenu();
  };
  root.addEventListener('pointerdown', onPressOutside);
  listeners.push([root, 'pointerdown', onPressOutside]);

  // ---- Updating ----
  const chips = new Map();
  let lastSignature = '';
  let hadSelection = false;

  function renderRoster(squads) {
    for (const squad of squads) {
      let chip = chips.get(squad.id);
      if (!chip) {
        chip = make('div', 'b2d-chip', undefined, { 'data-b2d': 'squad', 'data-squad-id': squad.id });
        chips.set(squad.id, chip);
        roster.appendChild(chip);
      }
      chip.classList.toggle('is-selected', squad.selected);
      chip.classList.toggle('is-routing', squad.state === 'routing');
      chip.textContent = `${squad.name} ${squad.soldiers}`;
      chip.setAttribute('data-units', String(squad.soldiers));
      chip.setAttribute('data-morale', String(Math.round(squad.morale)));
      chip.setAttribute('data-state', squad.state);
      chip.setAttribute('data-selected', squad.selected ? 'true' : 'false');
      chip.setAttribute('data-waypoints', String(squad.waypoints));
      chip.setAttribute('data-x', String(Math.round(squad.x)));
      chip.setAttribute('data-y', String(Math.round(squad.y)));
    }
    for (const [id, chip] of chips) {
      if (!squads.some((squad) => squad.id === id)) {
        chip.remove();
        chips.delete(id);
      }
    }
  }

  // state: { phase, timeScale, commandMode, waypointMode, elapsed, ally: [squad info] }
  function update(state) {
    const preparing = state.phase === 'preparation';
    prep.hidden = !preparing || state.phase === 'ended';
    const selectedCount = state.ally.filter((squad) => squad.selected).length;
    const phaseLabel = preparing ? '준비 단계' : state.phase === 'ended' ? '종료' : '전투 중';
    const signature = `${phaseLabel}|${Math.floor(state.elapsed)}`;
    if (signature !== lastSignature) {
      lastSignature = signature;
      status.textContent = `${phaseLabel} · ${Math.floor(state.elapsed)}초`;
    }
    status.setAttribute('data-phase', state.phase);
    renderRoster(state.ally);

    for (const [scale, element] of Object.entries(speedButtons)) {
      element.classList.toggle('is-active', Number(scale) === state.timeScale);
    }
    attackButton.classList.toggle('is-active', state.commandMode === 'attack');
    directionButton.classList.toggle('is-active', state.commandMode === 'direction');
    waypointButton.classList.toggle('is-on', state.waypointMode);
    waypointButton.textContent = state.waypointMode ? '📍 예약중(ON)' : '📍 경로예약';

    // The bottom bar shows the select list until something is selected, then the orders.
    const hasSelection = selectedCount > 0;
    if (hasSelection !== hadSelection) {
      hadSelection = hasSelection;
      formationOpen = false;
      openGroup = null;
      subPanel.hidden = true;
      subPanel.replaceChildren();
      for (const element of groupButtons.values()) element.classList.remove('is-active');
    }
    selectBar.hidden = hasSelection;
    commandBar.hidden = !hasSelection || formationOpen;
    formationBar.hidden = !hasSelection || !formationOpen;
    const over = state.phase === 'ended';
    for (const element of [...topRight.querySelectorAll('button'), ...bottom.querySelectorAll('button')]) element.disabled = over;
  }

  function addChatLine(kind, text) {
    const className = { lord: 'b2d-lord', player: 'b2d-player', notice: 'b2d-notice' }[kind];
    const line = make('div', className, text);
    chat.appendChild(line);
    chat.scrollTop = chat.scrollHeight;
    return line;
  }

  function showDiplomacy(open) {
    diplomacy.hidden = !open;
    if (open) chatInput.focus();
  }

  function showSurrender(open) {
    surrender.hidden = !open;
  }

  // lines: the numbers shown under the title; waitForConfirm shows the button that lets the player move on.
  function showEnd(result, { lines, waitForConfirm }) {
    endTitle.textContent = END_TITLES[result.outcome] || '전투 종료';
    endText.textContent = lines.join('\n');
    endContinue.hidden = !waitForConfirm;
    end.hidden = false;
    end.setAttribute('data-outcome', result.outcome);
    diplomacy.hidden = true;
    surrender.hidden = true;
    menu.hidden = true;
  }

  function dispose() {
    for (const [element, type, handler] of listeners) element.removeEventListener(type, handler);
    listeners.length = 0;
    chips.clear();
    layer.remove();
  }

  return { update, addChatLine, showDiplomacy, showSurrender, showEnd, resetChat, dispose, closeMenu, focusChat: () => chatInput.focus() };
}
