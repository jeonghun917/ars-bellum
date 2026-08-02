// ============================================================
// Ars Bellum - ResourceCatalog.js
//
// 경제 시스템이 공통으로 사용하는 자원·생산 레시피 규격.
// 이 파일은 자원의 정의만 소유한다.
//
// 거점의 실제 재고:
// SettlementEconomy.js
//
// 시장 가격과 주문:
// MarketOrderSystem.js
//
// 상인의 실제 화물:
// WorldMerchantSystem.js
// ============================================================

(function () {
    "use strict";

    const DATA_VERSION = 1;

    // ========================================================
    // 1. 자원 분류
    // ========================================================

    const categories = {
        food: {
            id: "food",
            name: "식량",
            description:
                "주민과 군대가 소비하는 생존 자원"
        },

        raw: {
            id: "raw",
            name: "원료",
            description:
                "농장, 광산, 벌목장 등에서 직접 생산되는 자원"
        },

        processed: {
            id: "processed",
            name: "가공품",
            description:
                "원료를 작업장에서 가공한 생산물"
        },

        military: {
            id: "military",
            name: "군수품",
            description:
                "병력 모집과 보급에 필요한 자원"
        },

        luxury: {
            id: "luxury",
            name: "사치품",
            description:
                "귀족 소비와 거점 번영도에 영향을 주는 자원"
        }
    };

    // ========================================================
    // 2. 자원 정의
    //
    // basePrice:
    // 시장 변동이 적용되기 전 기준 가격
    //
    // weight:
    // 자원 1단위의 화물 무게
    //
    // perishRate:
    // 하루마다 현재 수량에서 손실되는 비율
    // ========================================================

    const resourceDefinitions = [
        {
            id: "grain",
            name: "곡물",
            category: "food",
            unit: "자루",

            basePrice: 8,
            weight: 1,
            perishRate: 0.003,

            essential: true,

            tags: [
                "staple",
                "civilian_food",
                "army_food",
                "farm"
            ]
        },

        {
            id: "bread",
            name: "빵",
            category: "food",
            unit: "바구니",

            basePrice: 14,
            weight: 0.8,
            perishRate: 0.08,

            essential: true,

            tags: [
                "staple",
                "civilian_food",
                "processed_food",
                "bakery"
            ]
        },

        {
            id: "meat",
            name: "고기",
            category: "food",
            unit: "묶음",

            basePrice: 22,
            weight: 1.2,
            perishRate: 0.12,

            essential: false,

            tags: [
                "civilian_food",
                "army_food",
                "protein",
                "livestock"
            ]
        },

        {
            id: "fish",
            name: "생선",
            category: "food",
            unit: "바구니",

            basePrice: 18,
            weight: 1,
            perishRate: 0.18,

            essential: false,

            tags: [
                "civilian_food",
                "protein",
                "river",
                "coast"
            ]
        },

        {
            id: "vegetables",
            name: "채소",
            category: "food",
            unit: "바구니",

            basePrice: 10,
            weight: 0.9,
            perishRate: 0.1,

            essential: false,

            tags: [
                "civilian_food",
                "farm",
                "fresh_food"
            ]
        },

        {
            id: "grapes",
            name: "포도",
            category: "food",
            unit: "바구니",

            basePrice: 13,
            weight: 0.9,
            perishRate: 0.12,

            essential: false,

            tags: [
                "civilian_food",
                "vineyard",
                "wine_input"
            ]
        },

        {
            id: "salt",
            name: "소금",
            category: "food",
            unit: "자루",

            basePrice: 20,
            weight: 0.7,
            perishRate: 0,

            essential: true,

            tags: [
                "preservation",
                "civilian_food",
                "trade_good"
            ]
        },

        {
            id: "timber",
            name: "목재",
            category: "raw",
            unit: "묶음",

            basePrice: 12,
            weight: 2,
            perishRate: 0,

            essential: false,

            tags: [
                "construction",
                "fuel",
                "forest",
                "crafting"
            ]
        },

        {
            id: "iron_ore",
            name: "철광석",
            category: "raw",
            unit: "자루",

            basePrice: 18,
            weight: 2.5,
            perishRate: 0,

            essential: false,

            tags: [
                "mine",
                "metal",
                "smithing_input"
            ]
        },

        {
            id: "silver_ore",
            name: "은광석",
            category: "raw",
            unit: "자루",

            basePrice: 55,
            weight: 2,
            perishRate: 0,

            essential: false,

            tags: [
                "mine",
                "precious_metal",
                "luxury_input"
            ]
        },

        {
            id: "wool",
            name: "양모",
            category: "raw",
            unit: "꾸러미",

            basePrice: 16,
            weight: 0.8,
            perishRate: 0.001,

            essential: false,

            tags: [
                "livestock",
                "textile_input",
                "cold_region"
            ]
        },

        {
            id: "hides",
            name: "가죽 원피",
            category: "raw",
            unit: "묶음",

            basePrice: 15,
            weight: 1.1,
            perishRate: 0.03,

            essential: false,

            tags: [
                "livestock",
                "leather_input"
            ]
        },

        {
            id: "clay",
            name: "점토",
            category: "raw",
            unit: "자루",

            basePrice: 6,
            weight: 2.2,
            perishRate: 0,

            essential: false,

            tags: [
                "construction",
                "pottery_input",
                "river"
            ]
        },

        {
            id: "planks",
            name: "판재",
            category: "processed",
            unit: "묶음",

            basePrice: 24,
            weight: 1.6,
            perishRate: 0,

            essential: false,

            tags: [
                "construction",
                "crafting",
                "timber_product"
            ]
        },

        {
            id: "charcoal",
            name: "목탄",
            category: "processed",
            unit: "자루",

            basePrice: 16,
            weight: 0.7,
            perishRate: 0.002,

            essential: false,

            tags: [
                "fuel",
                "smelting_input",
                "smithing"
            ]
        },

        {
            id: "iron_ingot",
            name: "철괴",
            category: "processed",
            unit: "덩이",

            basePrice: 48,
            weight: 1.8,
            perishRate: 0,

            essential: false,

            tags: [
                "metal",
                "smithing",
                "military_input"
            ]
        },

        {
            id: "cloth",
            name: "직물",
            category: "processed",
            unit: "두루마리",

            basePrice: 38,
            weight: 0.5,
            perishRate: 0.002,

            essential: false,

            tags: [
                "textile",
                "civilian_good",
                "military_input"
            ]
        },

        {
            id: "leather",
            name: "가죽",
            category: "processed",
            unit: "두루마리",

            basePrice: 34,
            weight: 0.7,
            perishRate: 0.005,

            essential: false,

            tags: [
                "leather",
                "civilian_good",
                "military_input"
            ]
        },

        {
            id: "pottery",
            name: "도기",
            category: "processed",
            unit: "상자",

            basePrice: 20,
            weight: 1.2,
            perishRate: 0,

            essential: false,

            tags: [
                "household",
                "trade_good",
                "clay_product"
            ]
        },

        {
            id: "weapons",
            name: "무기",
            category: "military",
            unit: "세트",

            basePrice: 120,
            weight: 1.5,
            perishRate: 0,

            essential: false,

            tags: [
                "recruitment",
                "army_supply",
                "smithing"
            ]
        },

        {
            id: "armor",
            name: "갑옷",
            category: "military",
            unit: "세트",

            basePrice: 180,
            weight: 2.5,
            perishRate: 0,

            essential: false,

            tags: [
                "recruitment",
                "army_supply",
                "smithing"
            ]
        },

        {
            id: "arrows",
            name: "화살",
            category: "military",
            unit: "묶음",

            basePrice: 26,
            weight: 0.4,
            perishRate: 0,

            essential: false,

            tags: [
                "army_supply",
                "ranged_ammunition",
                "fletching"
            ]
        },

        {
            id: "horses",
            name: "군마",
            category: "military",
            unit: "마리",

            basePrice: 260,
            weight: 8,
            perishRate: 0.002,

            essential: false,

            tags: [
                "recruitment",
                "cavalry",
                "live_animal"
            ]
        },

        {
            id: "wine",
            name: "포도주",
            category: "luxury",
            unit: "통",

            basePrice: 65,
            weight: 1.4,
            perishRate: 0.001,

            essential: false,

            tags: [
                "luxury",
                "tavern",
                "noble_demand",
                "trade_good"
            ]
        },

        {
            id: "spices",
            name: "향신료",
            category: "luxury",
            unit: "상자",

            basePrice: 140,
            weight: 0.3,
            perishRate: 0.001,

            essential: false,

            tags: [
                "luxury",
                "import",
                "noble_demand",
                "trade_good"
            ]
        },

        {
            id: "jewelry",
            name: "장신구",
            category: "luxury",
            unit: "상자",

            basePrice: 320,
            weight: 0.2,
            perishRate: 0,

            essential: false,

            tags: [
                "luxury",
                "precious",
                "noble_demand",
                "trade_good"
            ]
        },

        {
            id: "travel_rations",
            name: "여행용 건량",
            category: "food",
            unit: "배급",

            basePrice: 10,
            weight: 0.75,
            volume: 0.8,
            perishRate: 0.01,
            nutritionValue: 1,

            essential: true,
            temporaryBalanceValues: true,

            tags: [
                "food",
                "army_food",
                "travel_food",
                "legacy_food_migration"
            ]
        }
    ];

    // ========================================================
    // 3. 생산 레시피
    //
    // laborPerCycle:
    // 생산 한 주기에 필요한 노동자 수
    //
    // cycleDays:
    // 생산 한 주기가 완료되는 데 필요한 게임 일수
    //
    // minimumOperatingRate:
    // 필요한 노동력 대비 최소 가동 비율
    // ========================================================

    const recipeDefinitions = [
        {
            id: "grain_farming",
            name: "곡물 재배",

            buildingId: "farm",
            laborType: "peasants",
            laborPerCycle: 12,

            inputs: {},

            outputs: {
                grain: 30
            },

            cycleDays: 1,
            minimumOperatingRate: 0.25
        },

        {
            id: "vegetable_farming",
            name: "채소 재배",

            buildingId: "vegetable_farm",
            laborType: "peasants",
            laborPerCycle: 10,

            inputs: {},

            outputs: {
                vegetables: 22
            },

            cycleDays: 1,
            minimumOperatingRate: 0.25
        },

        {
            id: "vineyard_farming",
            name: "포도 재배",

            buildingId: "vineyard",
            laborType: "peasants",
            laborPerCycle: 14,

            inputs: {},

            outputs: {
                grapes: 24
            },

            cycleDays: 3,
            minimumOperatingRate: 0.3
        },

        {
            id: "fishing",
            name: "어업",

            buildingId: "fishery",
            laborType: "laborers",
            laborPerCycle: 8,

            inputs: {},

            outputs: {
                fish: 18
            },

            cycleDays: 1,
            minimumOperatingRate: 0.25
        },

        {
            id: "salt_harvesting",
            name: "소금 생산",

            buildingId: "saltworks",
            laborType: "laborers",
            laborPerCycle: 8,

            inputs: {},

            outputs: {
                salt: 12
            },

            cycleDays: 3,
            minimumOperatingRate: 0.25
        },

        {
            id: "logging",
            name: "벌목",

            buildingId: "lumber_camp",
            laborType: "laborers",
            laborPerCycle: 10,

            inputs: {},

            outputs: {
                timber: 16
            },

            cycleDays: 2,
            minimumOperatingRate: 0.25
        },

        {
            id: "iron_mining",
            name: "철광 채굴",

            buildingId: "iron_mine",
            laborType: "laborers",
            laborPerCycle: 14,

            inputs: {},

            outputs: {
                iron_ore: 10
            },

            cycleDays: 3,
            minimumOperatingRate: 0.3
        },

        {
            id: "silver_mining",
            name: "은광 채굴",

            buildingId: "silver_mine",
            laborType: "laborers",
            laborPerCycle: 18,

            inputs: {},

            outputs: {
                silver_ore: 4
            },

            cycleDays: 5,
            minimumOperatingRate: 0.35
        },

        {
            id: "clay_digging",
            name: "점토 채취",

            buildingId: "clay_pit",
            laborType: "laborers",
            laborPerCycle: 7,

            inputs: {},

            outputs: {
                clay: 18
            },

            cycleDays: 2,
            minimumOperatingRate: 0.25
        },

        {
            id: "sheep_ranching",
            name: "목축",

            buildingId: "sheep_ranch",
            laborType: "peasants",
            laborPerCycle: 12,

            inputs: {
                grain: 2
            },

            outputs: {
                wool: 8,
                meat: 4,
                hides: 2
            },

            cycleDays: 7,
            minimumOperatingRate: 0.3
        },

        {
            id: "bread_baking",
            name: "제빵",

            buildingId: "bakery",
            laborType: "artisans",
            laborPerCycle: 6,

            inputs: {
                grain: 4,
                salt: 0.1
            },

            outputs: {
                bread: 5
            },

            cycleDays: 1,
            minimumOperatingRate: 0.3
        },

        {
            id: "wine_making",
            name: "포도주 양조",

            buildingId: "winery",
            laborType: "artisans",
            laborPerCycle: 8,

            inputs: {
                grapes: 5
            },

            outputs: {
                wine: 3
            },

            cycleDays: 4,
            minimumOperatingRate: 0.35
        },

        {
            id: "sawmilling",
            name: "판재 가공",

            buildingId: "sawmill",
            laborType: "laborers",
            laborPerCycle: 8,

            inputs: {
                timber: 4
            },

            outputs: {
                planks: 3
            },

            cycleDays: 2,
            minimumOperatingRate: 0.3
        },

        {
            id: "charcoal_burning",
            name: "목탄 생산",

            buildingId: "charcoal_kiln",
            laborType: "laborers",
            laborPerCycle: 6,

            inputs: {
                timber: 3
            },

            outputs: {
                charcoal: 2
            },

            cycleDays: 2,
            minimumOperatingRate: 0.25
        },

        {
            id: "iron_smelting",
            name: "철 제련",

            buildingId: "smelter",
            laborType: "artisans",
            laborPerCycle: 10,

            inputs: {
                iron_ore: 4,
                charcoal: 2
            },

            outputs: {
                iron_ingot: 2
            },

            cycleDays: 3,
            minimumOperatingRate: 0.4
        },

        {
            id: "cloth_weaving",
            name: "직물 생산",

            buildingId: "weaver",
            laborType: "artisans",
            laborPerCycle: 8,

            inputs: {
                wool: 3
            },

            outputs: {
                cloth: 2
            },

            cycleDays: 3,
            minimumOperatingRate: 0.35
        },

        {
            id: "leather_tanning",
            name: "가죽 무두질",

            buildingId: "tannery",
            laborType: "artisans",
            laborPerCycle: 8,

            inputs: {
                hides: 3,
                salt: 0.2
            },

            outputs: {
                leather: 2
            },

            cycleDays: 3,
            minimumOperatingRate: 0.35
        },

        {
            id: "pottery_firing",
            name: "도기 제작",

            buildingId: "pottery_kiln",
            laborType: "artisans",
            laborPerCycle: 7,

            inputs: {
                clay: 4,
                charcoal: 0.5
            },

            outputs: {
                pottery: 3
            },

            cycleDays: 2,
            minimumOperatingRate: 0.3
        },

        {
            id: "weapon_smithing",
            name: "무기 제작",

            buildingId: "weaponsmith",
            laborType: "artisans",
            laborPerCycle: 12,

            inputs: {
                iron_ingot: 2,
                timber: 0.5
            },

            outputs: {
                weapons: 1
            },

            cycleDays: 4,
            minimumOperatingRate: 0.45
        },

        {
            id: "armor_smithing",
            name: "갑옷 제작",

            buildingId: "armorsmith",
            laborType: "artisans",
            laborPerCycle: 15,

            inputs: {
                iron_ingot: 3,
                leather: 1
            },

            outputs: {
                armor: 1
            },

            cycleDays: 6,
            minimumOperatingRate: 0.5
        },

        {
            id: "arrow_fletching",
            name: "화살 제작",

            buildingId: "fletcher",
            laborType: "artisans",
            laborPerCycle: 6,

            inputs: {
                timber: 0.5,
                iron_ingot: 0.1
            },

            outputs: {
                arrows: 20
            },

            cycleDays: 1,
            minimumOperatingRate: 0.3
        },

        {
            id: "horse_breeding",
            name: "군마 사육",

            buildingId: "horse_ranch",
            laborType: "peasants",
            laborPerCycle: 16,

            inputs: {
                grain: 20
            },

            outputs: {
                horses: 1
            },

            cycleDays: 30,
            minimumOperatingRate: 0.4
        },

        {
            id: "jewelry_crafting",
            name: "장신구 제작",

            buildingId: "jeweler",
            laborType: "artisans",
            laborPerCycle: 12,

            inputs: {
                silver_ore: 2
            },

            outputs: {
                jewelry: 1
            },

            cycleDays: 7,
            minimumOperatingRate: 0.5
        }
    ];

    // ========================================================
    // 4. 공통 보조 함수
    // ========================================================

    function clone(value) {
        return JSON.parse(
            JSON.stringify(value)
        );
    }

    function freezeDeep(value) {
        if (
            !value ||
            typeof value !== "object" ||
            Object.isFrozen(value)
        ) {
            return value;
        }

        Object.keys(value).forEach(
            function (key) {
                freezeDeep(
                    value[key]
                );
            }
        );

        return Object.freeze(value);
    }

    function finiteNonNegative(
        value,
        fallback
    ) {
        const number =
            Number(value);

        if (
            !Number.isFinite(number) ||
            number < 0
        ) {
            return fallback;
        }

        return number;
    }

    function makeLookup(list) {
        const lookup =
            Object.create(null);

        list.forEach(
            function (item) {
                lookup[item.id] =
                    item;
            }
        );

        return lookup;
    }

    const resources =
        resourceDefinitions.map(
            function (resource) {
                return freezeDeep(
                    clone(resource)
                );
            }
        );

    const recipes =
        recipeDefinitions.map(
            function (recipe) {
                return freezeDeep(
                    clone(recipe)
                );
            }
        );

    const resourcesById =
        makeLookup(resources);

    const recipesById =
        makeLookup(recipes);

    const definitionRegistry = window.ArsDefinitionRegistry || null;

    if (definitionRegistry && !definitionRegistry.hasDomain("resource")) {
        definitionRegistry.registerDomain("resource", {
            validator: function (definition) {
                const errors = [];
                if (typeof definition.name !== "string" || definition.name.trim() === "") { errors.push("invalid_resource_name"); }
                if (typeof definition.category !== "string" || !definition.category) { errors.push("invalid_resource_category"); }
                if (definition.weightUnitId && ["kg", "g", "t"].indexOf(definition.weightUnitId) < 0) { errors.push("unsupported_weight_unit"); }
                if (definition.volumeUnitId && ["l", "ml", "m3"].indexOf(definition.volumeUnitId) < 0) { errors.push("unsupported_volume_unit"); }
                return errors.length ? errors : true;
            }
        });
    }

    if (definitionRegistry) {
        resources.forEach(function (resource) {
            if (!definitionRegistry.hasDefinition("resource", resource.id)) {
                const canonical = clone(resource);
                canonical.volume = finiteNonNegative(canonical.volume, canonical.weight);
                canonical.weightUnitId = "kg";
                canonical.volumeUnitId = "l";
                canonical.nutritionValue = finiteNonNegative(canonical.nutritionValue, canonical.category === "food" ? 1 : 0);
                definitionRegistry.registerDefaultDefinition("resource", canonical);
            }
        });
    }

    function cacheRegistryResource(resourceId) {
        if (!definitionRegistry || resourcesById[resourceId]) { return resourcesById[resourceId] || null; }
        const registered = definitionRegistry.getDefinition("resource", resourceId);
        if (!registered) { return null; }
        const normalized = normalizeRegisteredResource(registered);
        if (!normalized.ok) { return null; }
        const stored = freezeDeep(clone(normalized.value));
        resources.push(stored);
        resourcesById[stored.id] = stored;
        return stored;
    }

    function syncRegistryResources() {
        if (!definitionRegistry) { return; }
        definitionRegistry.listDefinitions("resource").forEach(function (definition) {
            cacheRegistryResource(definition.id);
        });
    }

    // ========================================================
    // 5. 자원 조회
    // ========================================================

    function getResourceById(resourceId) {
        return resourcesById[resourceId] || cacheRegistryResource(resourceId) || null;
    }

    function getResources() {
        syncRegistryResources();
        return resources.slice();
    }

    function getResourcesByCategory(
        categoryId
    ) {
        return resources.filter(
            function (resource) {
                return (
                    resource.category ===
                    categoryId
                );
            }
        );
    }

    function getResourcesByTag(tag) {
        return resources.filter(
            function (resource) {
                return (
                    resource.tags.indexOf(
                        tag
                    ) >= 0
                );
            }
        );
    }

    function isKnownResource(resourceId) {
        return Boolean(
            getResourceById(
                resourceId
            )
        );
    }

    // ========================================================
    // 6. 생산 레시피 조회
    // ========================================================

    function getRecipeById(recipeId) {
        return (
            recipesById[
                recipeId
            ] ||
            null
        );
    }

    function getRecipes() {
        return recipes.slice();
    }

    function getRecipesForBuilding(
        buildingId
    ) {
        return recipes.filter(
            function (recipe) {
                return (
                    recipe.buildingId ===
                    buildingId
                );
            }
        );
    }

    function getRecipesUsing(
        resourceId
    ) {
        return recipes.filter(
            function (recipe) {
                return (
                    Number(
                        recipe.inputs[
                            resourceId
                        ]
                    ) > 0
                );
            }
        );
    }

    function getRecipesProducing(
        resourceId
    ) {
        return recipes.filter(
            function (recipe) {
                return (
                    Number(
                        recipe.outputs[
                            resourceId
                        ]
                    ) > 0
                );
            }
        );
    }

    // ========================================================
    // 7. 재고 형식 정리
    // ========================================================

    function normalizeInventory(source) {
        const result =
            Object.create(null);

        if (
            !source ||
            typeof source !== "object"
        ) {
            return result;
        }

        Object.keys(source).forEach(
            function (resourceId) {
                if (
                    !isKnownResource(
                        resourceId
                    )
                ) {
                    return;
                }

                const amount =
                    finiteNonNegative(
                        source[
                            resourceId
                        ],
                        0
                    );

                if (amount > 0) {
                    result[
                        resourceId
                    ] =
                        amount;
                }
            }
        );

        return result;
    }

    // ========================================================
    // 8. 화물 무게 계산
    // ========================================================

    function calculateCargoWeight(
        inventory
    ) {
        const clean =
            normalizeInventory(
                inventory
            );

        return Object.keys(clean)
            .reduce(
                function (
                    total,
                    resourceId
                ) {
                    const resource =
                        getResourceById(
                            resourceId
                        );

                    return (
                        total +
                        clean[
                            resourceId
                        ] *
                        resource.weight
                    );
                },
                0
            );
    }

    // ========================================================
    // 9. 기준 가치 계산
    // ========================================================

    function calculateBaseValue(
        inventory
    ) {
        const clean =
            normalizeInventory(
                inventory
            );

        return Object.keys(clean)
            .reduce(
                function (
                    total,
                    resourceId
                ) {
                    const resource =
                        getResourceById(
                            resourceId
                        );

                    return (
                        total +
                        clean[
                            resourceId
                        ] *
                        resource.basePrice
                    );
                },
                0
            );
    }

    // ========================================================
    // 10. 부패 계산
    // ========================================================

    function calculateSpoilage(
        resourceId,
        amount,
        elapsedDays
    ) {
        const resource =
            getResourceById(
                resourceId
            );

        const quantity =
            finiteNonNegative(
                amount,
                0
            );

        const days =
            finiteNonNegative(
                elapsedDays,
                0
            );

        if (
            !resource ||
            quantity <= 0 ||
            days <= 0 ||
            resource.perishRate <= 0
        ) {
            return {
                resourceId:
                    resourceId,

                originalAmount:
                    quantity,

                remainingAmount:
                    quantity,

                spoiledAmount:
                    0
            };
        }

        const remaining =
            quantity *
            Math.pow(
                1 -
                    resource.perishRate,
                days
            );

        return {
            resourceId:
                resourceId,

            originalAmount:
                quantity,

            remainingAmount:
                Math.max(
                    0,
                    remaining
                ),

            spoiledAmount:
                Math.max(
                    0,
                    quantity -
                        remaining
                )
        };
    }

    // ========================================================
    // 11. 자원 데이터 검사
    // ========================================================

    function validateResource(
        resource,
        resourceIds
    ) {
        const errors = [];

        if (
            !resource.id ||
            typeof resource.id !==
                "string"
        ) {
            errors.push(
                "ID가 없는 자원이 있습니다."
            );

            return errors;
        }

        if (
            resourceIds.has(
                resource.id
            )
        ) {
            errors.push(
                "자원 ID 중복: " +
                resource.id
            );
        }

        resourceIds.add(
            resource.id
        );

        if (
            !resource.name ||
            typeof resource.name !==
                "string"
        ) {
            errors.push(
                resource.id +
                ": 이름이 없습니다."
            );
        }

        if (
            !categories[
                resource.category
            ]
        ) {
            errors.push(
                resource.id +
                ": 존재하지 않는 분류 " +
                resource.category
            );
        }

        if (
            !resource.unit ||
            typeof resource.unit !==
                "string"
        ) {
            errors.push(
                resource.id +
                ": 단위가 없습니다."
            );
        }

        if (
            !Number.isFinite(
                Number(
                    resource.basePrice
                )
            ) ||
            Number(
                resource.basePrice
            ) < 0
        ) {
            errors.push(
                resource.id +
                ": 기준 가격 오류"
            );
        }

        if (
            !Number.isFinite(
                Number(
                    resource.weight
                )
            ) ||
            Number(
                resource.weight
            ) < 0
        ) {
            errors.push(
                resource.id +
                ": 무게 오류"
            );
        }

        if (
            !Number.isFinite(
                Number(
                    resource.perishRate
                )
            ) ||
            Number(
                resource.perishRate
            ) < 0 ||
            Number(
                resource.perishRate
            ) > 1
        ) {
            errors.push(
                resource.id +
                ": 부패율은 0부터 1 사이여야 합니다."
            );
        }

        if (
            typeof resource.essential !==
            "boolean"
        ) {
            errors.push(
                resource.id +
                ": essential은 참 또는 거짓이어야 합니다."
            );
        }

        if (
            !Array.isArray(
                resource.tags
            )
        ) {
            errors.push(
                resource.id +
                ": tags는 배열이어야 합니다."
            );
        }

        return errors;
    }

    // ========================================================
    // 12. 레시피 자원 목록 검사
    // ========================================================

    function validateResourceMap(
        recipeId,
        mapName,
        resourceMap
    ) {
        const errors = [];

        if (
            !resourceMap ||
            typeof resourceMap !==
                "object" ||
            Array.isArray(
                resourceMap
            )
        ) {
            errors.push(
                recipeId +
                ": " +
                mapName +
                "는 객체여야 합니다."
            );

            return errors;
        }

        Object.keys(resourceMap)
            .forEach(
                function (
                    resourceId
                ) {
                    if (
                        !isKnownResource(
                            resourceId
                        )
                    ) {
                        errors.push(
                            recipeId +
                            ": 존재하지 않는 자원 참조 " +
                            resourceId
                        );
                    }

                    const amount =
                        Number(
                            resourceMap[
                                resourceId
                            ]
                        );

                    if (
                        !Number.isFinite(
                            amount
                        ) ||
                        amount <= 0
                    ) {
                        errors.push(
                            recipeId +
                            ": " +
                            resourceId +
                            " 수량은 0보다 커야 합니다."
                        );
                    }
                }
            );

        return errors;
    }

    // ========================================================
    // 13. 생산 레시피 검사
    // ========================================================

    function validateRecipe(
        recipe,
        recipeIds
    ) {
        const errors = [];

        if (
            !recipe.id ||
            typeof recipe.id !==
                "string"
        ) {
            errors.push(
                "ID가 없는 생산 레시피가 있습니다."
            );

            return errors;
        }

        if (
            recipeIds.has(
                recipe.id
            )
        ) {
            errors.push(
                "생산 레시피 ID 중복: " +
                recipe.id
            );
        }

        recipeIds.add(
            recipe.id
        );

        if (
            !recipe.name ||
            typeof recipe.name !==
                "string"
        ) {
            errors.push(
                recipe.id +
                ": 이름이 없습니다."
            );
        }

        if (
            !recipe.buildingId ||
            typeof recipe.buildingId !==
                "string"
        ) {
            errors.push(
                recipe.id +
                ": buildingId가 없습니다."
            );
        }

        if (
            !recipe.laborType ||
            typeof recipe.laborType !==
                "string"
        ) {
            errors.push(
                recipe.id +
                ": laborType이 없습니다."
            );
        }

        if (
            !Number.isFinite(
                Number(
                    recipe.laborPerCycle
                )
            ) ||
            Number(
                recipe.laborPerCycle
            ) <= 0
        ) {
            errors.push(
                recipe.id +
                ": laborPerCycle 오류"
            );
        }

        if (
            !Number.isFinite(
                Number(
                    recipe.cycleDays
                )
            ) ||
            Number(
                recipe.cycleDays
            ) <= 0
        ) {
            errors.push(
                recipe.id +
                ": cycleDays 오류"
            );
        }

        if (
            !Number.isFinite(
                Number(
                    recipe.minimumOperatingRate
                )
            ) ||
            Number(
                recipe.minimumOperatingRate
            ) < 0 ||
            Number(
                recipe.minimumOperatingRate
            ) > 1
        ) {
            errors.push(
                recipe.id +
                ": minimumOperatingRate는 0부터 1 사이여야 합니다."
            );
        }

        errors.push.apply(
            errors,
            validateResourceMap(
                recipe.id,
                "inputs",
                recipe.inputs
            )
        );

        errors.push.apply(
            errors,
            validateResourceMap(
                recipe.id,
                "outputs",
                recipe.outputs
            )
        );

        if (
            Object.keys(
                recipe.outputs
            ).length === 0
        ) {
            errors.push(
                recipe.id +
                ": 생산 결과가 없습니다."
            );
        }

        return errors;
    }

    // ========================================================
    // 14. 전체 데이터 검사
    // ========================================================

    function validate() {
        const errors = [];

        const resourceIds =
            new Set();

        const recipeIds =
            new Set();

        resources.forEach(
            function (resource) {
                errors.push.apply(
                    errors,
                    validateResource(
                        resource,
                        resourceIds
                    )
                );
            }
        );

        recipes.forEach(
            function (recipe) {
                errors.push.apply(
                    errors,
                    validateRecipe(
                        recipe,
                        recipeIds
                    )
                );
            }
        );

        return errors;
    }

    // ========================================================
    // 15. 개발용 출력
    // ========================================================

    function debugPrint() {
        console.group(
            "[Ars Bellum] 자원 카탈로그"
        );

        console.table(
            resources.map(
                function (resource) {
                    return {
                        id:
                            resource.id,

                        name:
                            resource.name,

                        category:
                            resource.category,

                        unit:
                            resource.unit,

                        basePrice:
                            resource.basePrice,

                        weight:
                            resource.weight,

                        perishRate:
                            resource.perishRate,

                        essential:
                            resource.essential
                    };
                }
            )
        );

        console.log(
            "자원:",
            resources.length,
            "종"
        );

        console.log(
            "생산 레시피:",
            recipes.length,
            "개"
        );

        console.groupEnd();

        return {
            resourceCount:
                resources.length,

            recipeCount:
                recipes.length,

            errors:
                validate()
        };
    }


    // ========================================================
    // M1 등록 경계
    // 내부 물리 기준 단위: weight=kg, volume=l.
    // ResourceCatalog.unit은 표시 수량 단위이며 물리 단위가 아니다.
    // ========================================================

    const PHYSICAL_UNITS = Object.freeze({
        weight: "kg",
        volume: "l"
    });

    function convertWeightToKg(value, unitId) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) {
            return null;
        }
        const unit = unitId || "kg";
        if (unit === "kg") { return n; }
        if (unit === "g") { return n / 1000; }
        if (unit === "t") { return n * 1000; }
        return null;
    }

    function convertVolumeToL(value, unitId) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) {
            return null;
        }
        const unit = unitId || "l";
        if (unit === "l") { return n; }
        if (unit === "ml") { return n / 1000; }
        if (unit === "m3") { return n * 1000; }
        return null;
    }

    function normalizeRegisteredResource(input) {
        const value = clone(input || {});
        if (value.itemDefinitionId && !value.id) {
            value.id = value.itemDefinitionId;
        }
        const weightUnitId = value.weightUnitId || "kg";
        const volumeUnitId = value.volumeUnitId || "l";
        const weight = convertWeightToKg(value.weight, weightUnitId);
        const volume = convertVolumeToL(
            value.volume === undefined ? value.weight : value.volume,
            volumeUnitId
        );
        if (weight === null || volume === null) {
            return { ok: false, error: "unsupported_physical_unit" };
        }
        value.weight = weight;
        value.volume = volume;
        value.weightUnitId = "kg";
        value.volumeUnitId = "l";
        value.tags = Array.isArray(value.tags) ? Array.from(new Set(value.tags.map(String))) : [];
        value.nutritionValue = finiteNonNegative(value.nutritionValue, 0);
        value.customData = value.customData && typeof value.customData === "object" ? value.customData : {};
        return { ok: true, value: value };
    }

    function registerResourceDefinition(input) {
        const normalized = normalizeRegisteredResource(input);
        if (!normalized.ok) { return normalized; }
        const candidate = normalized.value;
        if (resourcesById[candidate.id] || (definitionRegistry && definitionRegistry.hasDefinition("resource", candidate.id))) {
            return { ok: false, error: "duplicate_resource_id" };
        }
        const errors = validateResource(candidate, new Set(resources.map(function (r) { return r.id; })));
        if (errors.length > 0) { return { ok: false, error: "invalid_resource_definition", errors: errors }; }
        if (definitionRegistry) {
            const registered = definitionRegistry.registerApprovedDefinition("resource", candidate.id, candidate, { sourceType: "trusted_runtime" });
            if (!registered.ok) { return registered; }
        }
        const stored = freezeDeep(clone(candidate));
        resources.push(stored); resourcesById[stored.id] = stored;
        return { ok: true, definition: clone(stored) };
    }

    // ========================================================
    // 16. 외부 공개 API
    // ========================================================

    window.ArsResourceCatalog = {
        version:
            DATA_VERSION,

        categories:
            freezeDeep(
                clone(
                    categories
                )
            ),

        get resources() {
            return getResources();
        },

        get recipes() {
            return getRecipes();
        },

        physicalUnits:
            PHYSICAL_UNITS,

        registerResourceDefinition:
            registerResourceDefinition,

        registerResource:
            registerResourceDefinition,

        getResourceById:
            getResourceById,

        getResources:
            getResources,

        getResourcesByCategory:
            getResourcesByCategory,

        getResourcesByTag:
            getResourcesByTag,

        isKnownResource:
            isKnownResource,

        getRecipeById:
            getRecipeById,

        getRecipes:
            getRecipes,

        getRecipesForBuilding:
            getRecipesForBuilding,

        getRecipesUsing:
            getRecipesUsing,

        getRecipesProducing:
            getRecipesProducing,

        normalizeInventory:
            normalizeInventory,

        calculateCargoWeight:
            calculateCargoWeight,

        calculateBaseValue:
            calculateBaseValue,

        calculateSpoilage:
            calculateSpoilage,

        validate:
            validate,

        debugPrint:
            debugPrint
    };

    // ========================================================
    // 17. 실행 시 자동 검사
    // ========================================================

    const validationErrors =
        validate();

    if (
        validationErrors.length >
        0
    ) {
        console.error(
            "[Ars Bellum] ResourceCatalog 검사 실패:",
            validationErrors
        );
    } else {
        console.log(
            "[Ars Bellum] ResourceCatalog 연결 완료 - 자원 " +
            resources.length +
            "종, 생산 레시피 " +
            recipes.length +
            "개"
        );
    }
})();