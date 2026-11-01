// Composition root: the one place that knows about the browser, the saved-game storage and the
// battle module. Everything else receives what it needs as arguments.
//
//   index.html                       the real game
//   index.html?fakeBattle=victory    a stand-in battle with a button that ends it (tests); also
//                                   defeat | retreat | surrender | negotiated_retreat,
//                                   &routed=N &double=1 (report the end twice)
//   index.html?seed=7                the seed of a new game
//   index.html?terrain=test          the map with the old test terrain (forest, mountain, river)
//   index.html?battle=3d             battles in 3D (m2_prototype.html in a frame, src/battle3d/); battle=2d
//                                   the 2D battle. Without it, the player's choice on the menu (kept in
//                                   storage), 2D at first.
import { browserStorage } from './persist/storage.js';
import { TEST_ZONES, createWorld, defaultWorld } from './domains/world/index.js';
import { mountApp } from './ui/app.js';
import { createFakeBattle } from './ui/fake-battle.js';

const params = new URLSearchParams(location.search);

// A browser that refuses storage (blocked cookies, some private modes) throws on first use; the
// menu reports that instead of the page failing to start.
function pageStorage() {
  try {
    return browserStorage();
  } catch (error) {
    const refuse = () => { throw error; };
    return { get: refuse, set: refuse, remove: refuse };
  }
}

// How battles are drawn: the query, else the player's choice kept in storage.
const BATTLE_VIEW_KEY = 'ars-bellum-battle-view';
const storage = pageStorage();
const battleView = {
  get() {
    const asked = params.get('battle');
    if (asked === '2d' || asked === '3d') return asked;
    try { return storage.get(BATTLE_VIEW_KEY) === '3d' ? '3d' : '2d'; } catch { return '2d'; }
  },
  set(view) {
    try { storage.set(BATTLE_VIEW_KEY, view); } catch { /* a storage that refuses: the choice lasts this visit only */ }
  },
};

// The battle is loaded when the first battle starts, so the campaign screens do not wait for it.
const startBattle = params.has('fakeBattle')
  ? createFakeBattle(location.search)
  : async (options) => {
    const battle = battleView.get() === '3d' ? await import('./battle3d/index.js') : await import('./battle2d/index.js');
    return battle.startBattle(options);
  };

const seed = params.has('seed') && Number.isInteger(Number(params.get('seed'))) ? Number(params.get('seed')) : null;

mountApp({
  root: document.getElementById('app'),
  storage,
  battleView,
  startBattle,
  newSeed: seed === null ? undefined : () => seed,
  world: params.get('terrain') === 'test' ? createWorld({ zones: TEST_ZONES }) : defaultWorld,
});
