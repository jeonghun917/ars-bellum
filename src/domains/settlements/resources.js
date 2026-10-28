// Resources and production recipes: data from the earlier version's ResourceCatalog.js, plus the
// lookups the rules use. Unit prices are in gold. perishRate is the share of a stock lost per day.

export const RESOURCE_DATA = [
  { id: 'grain', name: '곡물', category: 'food', unit: '자루', basePrice: 8, weight: 1, perishRate: 0.003, essential: true },
  { id: 'bread', name: '빵', category: 'food', unit: '바구니', basePrice: 14, weight: 0.8, perishRate: 0.08, essential: true },
  { id: 'meat', name: '고기', category: 'food', unit: '묶음', basePrice: 22, weight: 1.2, perishRate: 0.12, essential: false },
  { id: 'fish', name: '생선', category: 'food', unit: '바구니', basePrice: 18, weight: 1, perishRate: 0.18, essential: false },
  { id: 'vegetables', name: '채소', category: 'food', unit: '바구니', basePrice: 10, weight: 0.9, perishRate: 0.1, essential: false },
  { id: 'grapes', name: '포도', category: 'food', unit: '바구니', basePrice: 13, weight: 0.9, perishRate: 0.12, essential: false },
  { id: 'salt', name: '소금', category: 'food', unit: '자루', basePrice: 20, weight: 0.7, perishRate: 0, essential: true },
  { id: 'timber', name: '목재', category: 'raw', unit: '묶음', basePrice: 12, weight: 2, perishRate: 0, essential: false },
  { id: 'iron_ore', name: '철광석', category: 'raw', unit: '자루', basePrice: 18, weight: 2.5, perishRate: 0, essential: false },
  { id: 'silver_ore', name: '은광석', category: 'raw', unit: '자루', basePrice: 55, weight: 2, perishRate: 0, essential: false },
  { id: 'wool', name: '양모', category: 'raw', unit: '꾸러미', basePrice: 16, weight: 0.8, perishRate: 0.001, essential: false },
  { id: 'hides', name: '가죽 원피', category: 'raw', unit: '묶음', basePrice: 15, weight: 1.1, perishRate: 0.03, essential: false },
  { id: 'clay', name: '점토', category: 'raw', unit: '자루', basePrice: 6, weight: 2.2, perishRate: 0, essential: false },
  { id: 'planks', name: '판재', category: 'processed', unit: '묶음', basePrice: 24, weight: 1.6, perishRate: 0, essential: false },
  { id: 'charcoal', name: '목탄', category: 'processed', unit: '자루', basePrice: 16, weight: 0.7, perishRate: 0.002, essential: false },
  { id: 'iron_ingot', name: '철괴', category: 'processed', unit: '덩이', basePrice: 48, weight: 1.8, perishRate: 0, essential: false },
  { id: 'cloth', name: '직물', category: 'processed', unit: '두루마리', basePrice: 38, weight: 0.5, perishRate: 0.002, essential: false },
  { id: 'leather', name: '가죽', category: 'processed', unit: '두루마리', basePrice: 34, weight: 0.7, perishRate: 0.005, essential: false },
  { id: 'pottery', name: '도기', category: 'processed', unit: '상자', basePrice: 20, weight: 1.2, perishRate: 0, essential: false },
  { id: 'weapons', name: '무기', category: 'military', unit: '세트', basePrice: 120, weight: 1.5, perishRate: 0, essential: false },
  { id: 'armor', name: '갑옷', category: 'military', unit: '세트', basePrice: 180, weight: 2.5, perishRate: 0, essential: false },
  { id: 'arrows', name: '화살', category: 'military', unit: '묶음', basePrice: 26, weight: 0.4, perishRate: 0, essential: false },
  { id: 'horses', name: '군마', category: 'military', unit: '마리', basePrice: 260, weight: 8, perishRate: 0.002, essential: false },
  { id: 'wine', name: '포도주', category: 'luxury', unit: '통', basePrice: 65, weight: 1.4, perishRate: 0.001, essential: false },
  { id: 'spices', name: '향신료', category: 'luxury', unit: '상자', basePrice: 140, weight: 0.3, perishRate: 0.001, essential: false },
  { id: 'jewelry', name: '장신구', category: 'luxury', unit: '상자', basePrice: 320, weight: 0.2, perishRate: 0, essential: false },
  { id: 'travel_rations', name: '여행용 건량', category: 'food', unit: '배급', basePrice: 10, weight: 0.75, perishRate: 0.01, essential: true },
];

// A recipe belongs to one building. Per day a building of level L at full rate uses
// inputs * L / cycleDays and makes outputs * L / cycleDays, with laborPerCycle * L workers.
export const RECIPE_DATA = [
  { id: 'grain_farming', name: '곡물 재배', buildingId: 'farm', laborType: 'peasants', laborPerCycle: 12, inputs: {}, outputs: { grain: 30 }, cycleDays: 1, minimumOperatingRate: 0.25 },
  { id: 'vegetable_farming', name: '채소 재배', buildingId: 'vegetable_farm', laborType: 'peasants', laborPerCycle: 10, inputs: {}, outputs: { vegetables: 22 }, cycleDays: 1, minimumOperatingRate: 0.25 },
  { id: 'vineyard_farming', name: '포도 재배', buildingId: 'vineyard', laborType: 'peasants', laborPerCycle: 14, inputs: {}, outputs: { grapes: 24 }, cycleDays: 3, minimumOperatingRate: 0.3 },
  { id: 'fishing', name: '어업', buildingId: 'fishery', laborType: 'laborers', laborPerCycle: 8, inputs: {}, outputs: { fish: 18 }, cycleDays: 1, minimumOperatingRate: 0.25 },
  { id: 'salt_harvesting', name: '소금 생산', buildingId: 'saltworks', laborType: 'laborers', laborPerCycle: 8, inputs: {}, outputs: { salt: 12 }, cycleDays: 3, minimumOperatingRate: 0.25 },
  { id: 'logging', name: '벌목', buildingId: 'lumber_camp', laborType: 'laborers', laborPerCycle: 10, inputs: {}, outputs: { timber: 16 }, cycleDays: 2, minimumOperatingRate: 0.25 },
  { id: 'iron_mining', name: '철광 채굴', buildingId: 'iron_mine', laborType: 'laborers', laborPerCycle: 14, inputs: {}, outputs: { iron_ore: 10 }, cycleDays: 3, minimumOperatingRate: 0.3 },
  { id: 'silver_mining', name: '은광 채굴', buildingId: 'silver_mine', laborType: 'laborers', laborPerCycle: 18, inputs: {}, outputs: { silver_ore: 4 }, cycleDays: 5, minimumOperatingRate: 0.35 },
  { id: 'clay_digging', name: '점토 채취', buildingId: 'clay_pit', laborType: 'laborers', laborPerCycle: 7, inputs: {}, outputs: { clay: 18 }, cycleDays: 2, minimumOperatingRate: 0.25 },
  { id: 'sheep_ranching', name: '목축', buildingId: 'sheep_ranch', laborType: 'peasants', laborPerCycle: 12, inputs: { grain: 2 }, outputs: { wool: 8, meat: 4, hides: 2 }, cycleDays: 7, minimumOperatingRate: 0.3 },
  { id: 'bread_baking', name: '제빵', buildingId: 'bakery', laborType: 'artisans', laborPerCycle: 6, inputs: { grain: 4, salt: 0.1 }, outputs: { bread: 5 }, cycleDays: 1, minimumOperatingRate: 0.3 },
  { id: 'wine_making', name: '포도주 양조', buildingId: 'winery', laborType: 'artisans', laborPerCycle: 8, inputs: { grapes: 5 }, outputs: { wine: 3 }, cycleDays: 4, minimumOperatingRate: 0.35 },
  { id: 'sawmilling', name: '판재 가공', buildingId: 'sawmill', laborType: 'laborers', laborPerCycle: 8, inputs: { timber: 4 }, outputs: { planks: 3 }, cycleDays: 2, minimumOperatingRate: 0.3 },
  { id: 'charcoal_burning', name: '목탄 생산', buildingId: 'charcoal_kiln', laborType: 'laborers', laborPerCycle: 6, inputs: { timber: 3 }, outputs: { charcoal: 2 }, cycleDays: 2, minimumOperatingRate: 0.25 },
  { id: 'iron_smelting', name: '철 제련', buildingId: 'smelter', laborType: 'artisans', laborPerCycle: 10, inputs: { iron_ore: 4, charcoal: 2 }, outputs: { iron_ingot: 2 }, cycleDays: 3, minimumOperatingRate: 0.4 },
  { id: 'cloth_weaving', name: '직물 생산', buildingId: 'weaver', laborType: 'artisans', laborPerCycle: 8, inputs: { wool: 3 }, outputs: { cloth: 2 }, cycleDays: 3, minimumOperatingRate: 0.35 },
  { id: 'leather_tanning', name: '가죽 무두질', buildingId: 'tannery', laborType: 'artisans', laborPerCycle: 8, inputs: { hides: 3, salt: 0.2 }, outputs: { leather: 2 }, cycleDays: 3, minimumOperatingRate: 0.35 },
  { id: 'pottery_firing', name: '도기 제작', buildingId: 'pottery_kiln', laborType: 'artisans', laborPerCycle: 7, inputs: { clay: 4, charcoal: 0.5 }, outputs: { pottery: 3 }, cycleDays: 2, minimumOperatingRate: 0.3 },
  { id: 'weapon_smithing', name: '무기 제작', buildingId: 'weaponsmith', laborType: 'artisans', laborPerCycle: 12, inputs: { iron_ingot: 2, timber: 0.5 }, outputs: { weapons: 1 }, cycleDays: 4, minimumOperatingRate: 0.45 },
  { id: 'armor_smithing', name: '갑옷 제작', buildingId: 'armorsmith', laborType: 'artisans', laborPerCycle: 15, inputs: { iron_ingot: 3, leather: 1 }, outputs: { armor: 1 }, cycleDays: 6, minimumOperatingRate: 0.5 },
  { id: 'arrow_fletching', name: '화살 제작', buildingId: 'fletcher', laborType: 'artisans', laborPerCycle: 6, inputs: { timber: 0.5, iron_ingot: 0.1 }, outputs: { arrows: 20 }, cycleDays: 1, minimumOperatingRate: 0.3 },
  { id: 'horse_breeding', name: '군마 사육', buildingId: 'horse_ranch', laborType: 'peasants', laborPerCycle: 16, inputs: { grain: 20 }, outputs: { horses: 1 }, cycleDays: 30, minimumOperatingRate: 0.4 },
  { id: 'jewelry_crafting', name: '장신구 제작', buildingId: 'jeweler', laborType: 'artisans', laborPerCycle: 12, inputs: { silver_ore: 2 }, outputs: { jewelry: 1 }, cycleDays: 7, minimumOperatingRate: 0.5 },
];

const resourcesById = new Map(RESOURCE_DATA.map((resource) => [resource.id, resource]));
const recipesByBuilding = new Map(RECIPE_DATA.map((recipe) => [recipe.buildingId, recipe]));

export const RESOURCE_IDS = Object.freeze(RESOURCE_DATA.map((resource) => resource.id));
export const isKnownResource = (id) => resourcesById.has(id);
export const getResource = (id) => resourcesById.get(id) ?? null;
export const getRecipeForBuilding = (buildingId) => recipesByBuilding.get(buildingId) ?? null;
export const basePriceOf = (id) => resourcesById.get(id)?.basePrice ?? 0;
export const perishRateOf = (id) => resourcesById.get(id)?.perishRate ?? 0;
