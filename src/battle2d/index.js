// The public face of the 2D battle: one function that starts a battle in a container.
//
//   const { dispose } = startBattle({ container, mode, seed, enemyStrength, allyStrength, onEnd, options });
//
// The battle draws its own canvas and controls inside the container and removes them on dispose().
// It never reads or writes saved game state and never moves money: loot, gold and territory are
// worked out by the caller from the result passed to onEnd (called once, when the battle ends).
//
// options (all optional):
//   terrain        'random' | 'fixed' | 'flat'   default: random for practice, fixed for campaign
//   allySquads, enemySquads   explicit squad lists, e.g. ['shield', 'pike'], instead of a strength
//   soldiersPerSquad          1 to 12 (default 12)
//   economy        { gold, food }   what the player could offer in negotiation (default none)
//   geminiApiKey   turns on generated lines for the enemy lord; off without it
//   fetch          replacement for fetch, used only with geminiApiKey
//   timeScale      starting speed (default 1)
//   confirmEnd     true: onEnd waits until the player presses the end screen's button
import { createBattle } from './sim/battle.js';
import { createSession } from './ui/session.js';

const MODES = ['practice', 'campaign'];

export function startBattle({ container, mode, seed, enemyStrength, allyStrength, onEnd, options = {} }) {
  if (!container || container.nodeType !== 1 || !container.ownerDocument || !container.ownerDocument.defaultView) {
    throw new TypeError('battle2d: container must be an element in a page');
  }
  if (!MODES.includes(mode)) throw new RangeError(`battle2d: mode must be one of ${MODES.join(', ')}`);
  if (onEnd !== undefined && typeof onEnd !== 'function') throw new TypeError('battle2d: onEnd must be a function');
  // The screen always wants the effects events (damage numbers, impacts) to draw.
  const battle = createBattle({ seed, mode, enemyStrength, allyStrength, options: { ...options, collectEvents: true } });
  return createSession({ container, battle, mode, onEnd, options: { ...options, seed } });
}
