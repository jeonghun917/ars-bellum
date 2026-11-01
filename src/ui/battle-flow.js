// Runs one battle through the injected startBattle function and reports how it ended.
//
// startBattle({ container, mode, seed, enemyStrength, allyStrength, onEnd, options }) -> { dispose() }
// (it may also return a promise of that). onEnd(result) is honoured once; a second call is ignored.
// Resolves with ok({ result }) or a failure when the battle could not start or reported nonsense.
import { fail, ok } from '../core/result.js';
import { normalizeBattleResult } from './battle-result.js';

export const BATTLE_DEFAULTS = Object.freeze({ enemyStrength: 1, allyStrength: 1 });

// options: what the campaign gives the battle (the 3D battle reads options.heroSheet; the 2D ignores it).
export function runBattle({ startBattle, container, mode, seed, options = {} }) {
  return new Promise((resolve) => {
    let handle = null;
    let started = false; // startBattle has returned (or failed)
    let outcome = null; // set by the first onEnd, or by a failed start
    let closed = false;

    const close = () => {
      if (closed || !started || outcome === null) return;
      closed = true;
      try { handle?.dispose(); } catch { /* a battle that cannot be disposed must not block the screen */ }
      container.replaceChildren();
      resolve(outcome);
    };
    const onEnd = (raw) => {
      if (outcome !== null) return;
      const normalized = normalizeBattleResult(raw);
      outcome = normalized.ok ? ok({ result: normalized.result }) : normalized;
      close();
    };

    Promise.resolve()
      .then(() => startBattle({ container, mode, seed, ...BATTLE_DEFAULTS, onEnd, options }))
      .then((returned) => {
        handle = returned ?? null;
        started = true;
        close();
      })
      .catch((error) => {
        started = true;
        if (outcome === null) outcome = fail('battle_start_failed', String(error?.message ?? error));
        close();
      });
  });
}
