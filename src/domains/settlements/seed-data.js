// The settlements of the starting world, as the earlier version's W_Data.js listed them (only the
// fields the simulation uses; names, map positions and colours belong to the map).
// createSettlementsFromWorldData reads this unless the caller hands it other data of the same shape.
export const WORLD_SETTLEMENT_DATA = Object.freeze({
  settlements: Object.freeze([
    {
      id: 'test_city',
      type: 'city',
      tags: ['urban', 'market', 'river'],
      population: { current: 8000, capacity: 12000 },
      economy: { prosperity: 50, foodStock: 500 },
    },
    {
      id: 'test_castle',
      type: 'castle',
      tags: ['fortified', 'mountain_pass'],
      population: { current: 1800, capacity: 3000 },
      economy: { prosperity: 35, foodStock: 280 },
    },
    {
      id: 'test_village',
      type: 'village',
      tags: ['rural', 'farmland'],
      population: { current: 900, capacity: 1600 },
      economy: { prosperity: 25, foodStock: 350 },
    },
  ]),
});
