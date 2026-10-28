// A stand-in for the 2D battle, for tests and for trying the screens without the battle module.
// Chosen with a query flag in src/main.js:  index.html?fakeBattle=victory[&routed=13][&double=1]
// It shows one button; pressing it ends the battle with the chosen outcome. fakeBattle=throw makes
// the start itself fail, to see how the screens report a battle that cannot start.
import { el } from './dom.js';
import { OUTCOMES } from './battle-result.js';

export function createFakeBattle(search) {
  const params = new URLSearchParams(search);
  const outcome = params.get('fakeBattle');
  const number = (name, fallback) => {
    const value = Number(params.get(name));
    return params.has(name) && Number.isFinite(value) ? value : fallback;
  };
  const resultFor = () => ({
    outcome: OUTCOMES.includes(outcome) ? outcome : 'victory',
    enemyRoutedUnits: number('routed', 10),
    enemyKilledUnits: number('killed', 5),
    allyLostUnits: number('lost', 2),
    allySurvivingUnits: number('survived', 8),
    lordCaptured: params.get('lord') === '1',
  });

  return function startFakeBattle({ container, mode, seed, enemyStrength, allyStrength, onEnd }) {
    if (outcome === 'throw') throw new Error('가짜 전투가 시작되지 않았습니다');
    const finish = el('button', { id: 'fake-battle-finish', type: 'button', text: '가짜 전투 끝내기' });
    const panel = el(
      'div',
      { id: 'fake-battle', class: 'fake-battle', dataset: { mode, seed, enemyStrength, allyStrength } },
      el('p', { text: `가짜 전투 (${mode}, 시드 ${seed}, 적 ${enemyStrength}, 아군 ${allyStrength})` }),
      finish,
    );
    finish.addEventListener('click', () => {
      finish.disabled = true;
      onEnd(resultFor());
      // A misbehaving battle module may report twice; the game must count it once.
      if (params.get('double') === '1') onEnd(resultFor());
    });
    container.append(panel);
    return { dispose() { panel.remove(); } };
  };
}
