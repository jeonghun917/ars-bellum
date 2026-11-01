// The 3D battle as the campaign starts it: the same face as the 2D battle (src/battle2d/index.js),
//
//   const { dispose } = startBattle({ container, mode, seed, onEnd, options: { heroSheet } });
//
// It opens the 3D battle page (m2_prototype.html) in a frame filling the container, gives it the battle to
// fight (src/battle3d/launch.js), and when that battle has a result calls onEnd once with it in the
// campaign's shape. dispose() closes the frame. It never reads or writes the saved game.
import { campaignResult, launchSnapshot } from './launch.js';

const MODES = ['practice', 'campaign'];
const POLL_MS = 250;
const READY_TIMEOUT_MS = 60_000;

export function startBattle({ container, mode, seed, onEnd, options = {} }) {
  if (!container || container.nodeType !== 1 || !container.ownerDocument?.defaultView) throw new TypeError('battle3d: container must be an element in a page');
  if (!MODES.includes(mode)) throw new RangeError(`battle3d: mode must be one of ${MODES.join(', ')}`);
  const page = container.ownerDocument;
  const frame = page.createElement('iframe');
  frame.id = 'battle3d-frame';
  frame.title = '3D 전투';
  frame.src = new URL('../../m2_prototype.html', import.meta.url).href;
  frame.style.cssText = 'border:0;width:100%;height:100%;display:block;';
  container.replaceChildren(frame);

  let timer = null;
  let ended = false;
  const finish = (raw) => {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    onEnd?.(raw);
  };
  const waitReady = () => new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const battle = frame.contentWindow?.ArsM2Battle;
      if (battle && battle.getSnapshot()) return resolve(battle);
      if (Date.now() - started > READY_TIMEOUT_MS) return reject(new Error('battle3d: the 3D battle did not start'));
      setTimeout(check, POLL_MS);
    };
    check();
  });

  return waitReady().then(async (battle) => {
    const { M2_TECHNICAL_SNAPSHOT } = await import('../../m2/fixtures/m2_technical_fixture_v1.js');
    // Made in the frame's own realm, as the battle there expects its own objects.
    const snapshot = frame.contentWindow.JSON.parse(JSON.stringify(launchSnapshot(M2_TECHNICAL_SNAPSHOT, { seed, mode, heroSheet: options.heroSheet })));
    const loaded = battle.loadSnapshot(snapshot);
    if (!loaded.ok) throw new Error(`battle3d: ${loaded.error || 'the battle could not be set up'}`);
    const begun = battle.start();
    if (!begun.ok && begun.error !== 'm2_runtime_finalized') throw new Error(`battle3d: ${begun.error || 'the battle could not start'}`);
    timer = setInterval(() => {
      const result = battle.getResult();
      if (result) finish(campaignResult(result, battle.getSnapshot()));
    }, POLL_MS);
    return {
      dispose() {
        clearInterval(timer);
        try { battle.dispose?.(); } catch { /* a battle that cannot be disposed must not block the screen */ }
        frame.remove();
      },
    };
  });
}
