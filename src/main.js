// Composition root: the one place that knows about the browser, the saved-game storage and the
// battle module. Everything else receives what it needs as arguments.
//
//   index.html                       the real game
//   index.html?fakeBattle=victory    a stand-in battle with a button that ends it (tests); also
//                                   defeat | retreat | surrender | negotiated_retreat,
//                                   &routed=N &double=1 (report the end twice)
//   index.html?seed=7                the seed of a new game
//   index.html?terrain=test          the map with the old test terrain (forest, mountain, river)
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

// The 2D battle is loaded when the first battle starts, so the campaign screens do not wait for it.
const startBattle = params.has('fakeBattle')
  ? createFakeBattle(location.search)
  : async (options) => {
    const battle = await import('./battle2d/index.js');
    return battle.startBattle(options);
  };

const seed = params.has('seed') && Number.isInteger(Number(params.get('seed'))) ? Number(params.get('seed')) : null;

mountApp({
  root: document.getElementById('app'),
  storage: pageStorage(),
  startBattle,
  newSeed: seed === null ? undefined : () => seed,
  world: params.get('terrain') === 'test' ? createWorld({ zones: TEST_ZONES }) : defaultWorld,
});
