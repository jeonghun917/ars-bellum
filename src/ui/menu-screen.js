// The main menu: practice battle, the main game (continue or new), and what to do when the stored
// save cannot be read.
import { el } from './dom.js';
import { canStartNewOver, describeUnreadableSave } from './messages.js';

// opened: what openCampaign returned ({ ok, campaign, source } or a failure).
// handlers: { onPractice, onMainGame, onStartNew }; notice: text left by the screen we came from.
export function renderMenu(root, { opened, notice, handlers }) {
  const continueText = opened.ok && opened.source !== 'none'
    ? `이어하기: ${opened.campaign.getState().calendar.day}일차`
    : '';
  const mainLabel = opened.ok ? (opened.source === 'none' ? '메인 게임 (새 게임)' : '메인 게임 (이어하기)') : '메인 게임';

  const practice = el('button', { id: 'btn-practice', type: 'button', class: 'menu-btn practice', text: '연습장' });
  const main = el('button', { id: 'btn-main-game', type: 'button', class: 'menu-btn maingame', text: mainLabel });
  practice.addEventListener('click', () => handlers.onPractice());
  main.addEventListener('click', () => handlers.onMainGame());

  const children = [
    el('h1', { text: 'ARS BELLUM' }),
    el('p', { class: 'subtitle', text: '전술 리얼타임 시뮬레이터' }),
    el('div', { class: 'menu-buttons' }, practice, main),
  ];
  if (continueText) children.push(el('p', { id: 'menu-continue', class: 'muted', text: continueText }));
  if (notice) children.push(el('p', { id: 'menu-notice', class: 'notice', role: 'status', text: notice }));

  if (!opened.ok) {
    const box = el('div', { id: 'save-problem', class: 'problem', role: 'alert' },
      el('h2', { text: '저장된 게임을 읽을 수 없습니다' }),
      el('p', { id: 'save-problem-reason', text: describeUnreadableSave(opened) }));
    if (canStartNewOver(opened)) {
      box.append(
        el('p', { class: 'muted', text: '새로 시작하면 읽을 수 없는 저장은 새 게임의 저장으로 바뀝니다. 그때까지는 저장을 건드리지 않습니다.' }),
        el('button', { id: 'btn-start-new', type: 'button', class: 'menu-btn danger', text: '새로 시작 (읽을 수 없는 저장을 덮어씀)', onClick: () => handlers.onStartNew() }),
      );
    } else {
      box.append(el('p', { class: 'muted', text: '이 저장은 지우거나 덮어쓰지 않습니다. 연습장은 그대로 할 수 있습니다.' }));
    }
    children.push(box);
  }
  root.replaceChildren(...children);
}
