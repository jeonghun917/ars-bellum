// ============================================================
// Ars Bellum - S_EcoInit.js
// WorldMapData의 정적 초기값을 GameState 동적 상태로 최초 1회 이관한다.
//
// 이관 대상:
// - population.current
// - population.capacity -> baseCapacity
// - economy.prosperity
// - economy.foodStock -> inventory.grain
// - 거점 종류별 초기 화폐 시드
//
// WorldMapData는 읽기만 하며 수정하지 않는다.
// GameClock을 직접 구독하지 않는다.
//
// 선행:
// - W_Data.js
// - S_Pop.js
// - S_EcoState.js
// ============================================================
(function () {
    "use strict";

    const VERSION = 2;

    const BOOTSTRAP_KEY = "bootstrap";

    const FOOD_RESOURCE_ID = "grain";

    const MONEY_SEEDS = Object.freeze({
        village: Object.freeze({
            treasury: 200,
            privateWealth: 900,
            merchantCapital: 120
        }),

        town: Object.freeze({
            treasury: 650,
            privateWealth: 2800,
            merchantCapital: 750
        }),

        city: Object.freeze({
            treasury: 1800,
            privateWealth: 8500,
            merchantCapital: 3000
        }),

        castle: Object.freeze({
            treasury: 1200,
            privateWealth: 3200,
            merchantCapital: 350
        }),

        fort: Object.freeze({
            treasury: 850,
            privateWealth: 1800,
            merchantCapital: 180
        }),

        port: Object.freeze({
            treasury: 1300,
            privateWealth: 5200,
            merchantCapital: 2600
        }),

        default: Object.freeze({
            treasury: 400,
            privateWealth: 1500,
            merchantCapital: 300
        })
    });

    const LISTENERS = new Set();

    function isRecord(value) {
        return (
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)
        );
    }

    function clone(value) {
        return value === undefined
            ? undefined
            : JSON.parse(
                JSON.stringify(value)
            );
    }

    function cleanId(value) {
        return typeof value === "string"
            ? value.trim()
            : "";
    }

    function finite(value, fallback) {
        const number =
            Number(value);

        return Number.isFinite(number)
            ? number
            : fallback;
    }

    function nonNegative(value) {
        return Math.max(
            0,
            finite(value, 0)
        );
    }

    function nonNegativeInteger(value) {
        return Math.max(
            0,
            Math.floor(
                finite(value, 0)
            )
        );
    }

    function positiveInteger(value, fallback) {
        return Math.max(
            1,
            Math.floor(
                finite(value, fallback)
            )
        );
    }

    function clamp(value, minimum, maximum) {
        return Math.max(
            minimum,
            Math.min(
                maximum,
                finite(value, minimum)
            )
        );
    }

    function round(value, digits) {
        const scale =
            Math.pow(
                10,
                Math.max(
                    0,
                    Number(digits) || 0
                )
            );

        return Math.round(
            finite(value, 0) *
            scale
        ) / scale;
    }

    function fail(reason, details) {
        return Object.assign(
            {
                ok: false,
                reason: reason
            },
            details || {}
        );
    }

    function gameStateRoot() {
        const api =
            window.ArsGameState;

        if (
            !api ||
            typeof api.getState !==
                "function"
        ) {
            return null;
        }

        const state =
            api.getState();

        return isRecord(state)
            ? state
            : null;
    }

    function worldMapData() {
        return (
            window.ArsWorldMapData ||
            null
        );
    }

    function populationSystem() {
        return (
            window.ArsSettlementPopulation ||
            null
        );
    }

    function economyState() {
        return (
            window.ArsSettlementEconomyState ||
            null
        );
    }

    function resourceCatalog() {
        return (
            window.ArsResourceCatalog ||
            null
        );
    }

    function emit(action, settlementId, payload) {
        const event = {
            type:
                "settlement_economy_bootstrap",

            action:
                cleanId(action) ||
                "updated",

            settlementId:
                cleanId(settlementId),

            payload:
                clone(
                    payload || {}
                )
        };

        LISTENERS.forEach(
            function (listener) {
                try {
                    listener(
                        clone(event)
                    );
                } catch (error) {
                    console.error(
                        "[Ars Bellum] 경제 부트스트랩 구독자 오류:",
                        error
                    );
                }
            }
        );
    }

    function subscribe(listener) {
        if (
            typeof listener !==
            "function"
        ) {
            return function () {};
        }

        LISTENERS.add(listener);

        return function unsubscribe() {
            LISTENERS.delete(listener);
        };
    }

    function ensureWorldState() {
        const root =
            gameStateRoot();

        if (!root) {
            return null;
        }

        if (!isRecord(root.world)) {
            root.world = {};
        }

        if (
            !isRecord(
                root.world.settlements
            )
        ) {
            root.world.settlements = {};
        }

        return root.world;
    }

    function ensureSettlementRecord(
        settlementId
    ) {
        const id =
            cleanId(settlementId);

        const world =
            ensureWorldState();

        if (
            !id ||
            !world
        ) {
            return null;
        }

        if (
            !isRecord(
                world.settlements[id]
            )
        ) {
            world.settlements[id] = {
                id: id
            };
        }

        const settlement =
            world.settlements[id];

        settlement.id =
            cleanId(
                settlement.id
            ) || id;

        if (
            !isRecord(
                settlement[BOOTSTRAP_KEY]
            )
        ) {
            settlement[BOOTSTRAP_KEY] = {
                version:
                    VERSION,

                initialized:
                    false
            };
        }

        return settlement;
    }

    function getStaticSettlements() {
        const data =
            worldMapData();

        if (
            !data ||
            !data.settlements
        ) {
            return [];
        }

        if (
            Array.isArray(
                data.settlements
            )
        ) {
            return data.settlements
                .filter(isRecord);
        }

        if (
            isRecord(
                data.settlements
            )
        ) {
            return Object.values(
                data.settlements
            ).filter(isRecord);
        }

        return [];
    }

    function getStaticSettlement(
        settlementId
    ) {
        const id =
            cleanId(settlementId);

        return (
            getStaticSettlements()
                .find(
                    function (settlement) {
                        return (
                            cleanId(
                                settlement.id
                            ) === id
                        );
                    }
                ) ||
            null
        );
    }

    function isKnownResource(
        resourceId
    ) {
        const catalog =
            resourceCatalog();

        return (
            !!catalog &&
            typeof catalog.isKnownResource ===
                "function" &&
            catalog.isKnownResource(
                cleanId(resourceId)
            )
        );
    }

    function getPopulationSeed(
        staticSettlement
    ) {
        const population =
            isRecord(
                staticSettlement &&
                staticSettlement.population
            )
                ? staticSettlement.population
                : {};

        return {
            current:
                nonNegativeInteger(
                    population.current
                ),

            baseCapacity:
                positiveInteger(
                    population.capacity,
                    1
                )
        };
    }

    function getEconomySeed(
        staticSettlement
    ) {
        const economy =
            isRecord(
                staticSettlement &&
                staticSettlement.economy
            )
                ? staticSettlement.economy
                : {};

        return {
            prosperity:
                clamp(
                    economy.prosperity ===
                        undefined
                        ? 50
                        : economy.prosperity,
                    0,
                    200
                ),

            foodStock:
                nonNegative(
                    economy.foodStock
                )
        };
    }

    function getMoneySeed(
        staticSettlement
    ) {
        const type =
            cleanId(
                staticSettlement &&
                staticSettlement.type
            );

        const selected =
            MONEY_SEEDS[type] ||
            MONEY_SEEDS.default;

        return {
            treasury:
                round(
                    nonNegative(
                        selected.treasury
                    ),
                    2
                ),

            privateWealth:
                round(
                    nonNegative(
                        selected.privateWealth
                    ),
                    2
                ),

            merchantCapital:
                round(
                    nonNegative(
                        selected.merchantCapital
                    ),
                    2
                )
        };
    }

    function getBootstrapState(
        settlementId
    ) {
        const settlement =
            ensureSettlementRecord(
                settlementId
            );

        return settlement
            ? clone(
                settlement[
                    BOOTSTRAP_KEY
                ]
            )
            : null;
    }

    function isInitialized(
        settlementId
    ) {
        const bootstrap =
            getBootstrapState(
                settlementId
            );

        return !!(
            bootstrap &&
            bootstrap.initialized === true
        );
    }

    function markInitialized(
        settlementId
    ) {
        const settlement =
            ensureSettlementRecord(
                settlementId
            );

        if (!settlement) {
            return fail(
                "invalid_settlement"
            );
        }

        settlement[
            BOOTSTRAP_KEY
        ] = {
            version:
                VERSION,

            initialized:
                true
        };

        emit(
            "bootstrap_marked",
            settlementId,
            {
                bootstrap:
                    clone(
                        settlement[
                            BOOTSTRAP_KEY
                        ]
                    )
            }
        );

        return {
            ok: true,

            settlementId:
                cleanId(settlementId),

            bootstrap:
                clone(
                    settlement[
                        BOOTSTRAP_KEY
                    ]
                )
        };
    }

    function seedPopulation(
        settlementId,
        staticSettlement
    ) {
        const population =
            populationSystem();

        if (
            !population ||
            typeof population.setPopulation !==
                "function" ||
            typeof population.setBaseCapacity !==
                "function" ||
            typeof population.setCapacity !==
                "function"
        ) {
            return fail(
                "population_system_api_missing"
            );
        }

        const seed =
            getPopulationSeed(
                staticSettlement
            );

        const capacityResult =
            population
                .setBaseCapacity(
                    settlementId,
                    seed.baseCapacity
                );

        if (
            !capacityResult ||
            !capacityResult.ok
        ) {
            return fail(
                "base_capacity_seed_failed",
                {
                    detail:
                        capacityResult ||
                        null
                }
            );
        }

        const effectiveResult =
            population.setCapacity(
                settlementId,
                seed.baseCapacity
            );

        if (
            !effectiveResult ||
            !effectiveResult.ok
        ) {
            return fail(
                "effective_capacity_seed_failed",
                {
                    detail:
                        effectiveResult ||
                        null
                }
            );
        }

        const populationResult =
            population.setPopulation(
                settlementId,
                seed.current
            );

        if (
            !populationResult ||
            !populationResult.ok
        ) {
            return fail(
                "population_seed_failed",
                {
                    detail:
                        populationResult ||
                        null
                }
            );
        }

        if (typeof population.setDemographics !== "function" || typeof population.recalculateLabor !== "function") {
            return fail("population_initialization_api_missing");
        }

        const children = Math.floor(seed.current * 0.22);
        const elderly = Math.floor(seed.current * 0.10);
        const workingAge = Math.max(0, seed.current - children - elderly);
        const demographicsResult = population.setDemographics(
            settlementId,
            { children: children, workingAge: workingAge, elderly: elderly }
        );
        if (!demographicsResult || !demographicsResult.ok) {
            return fail("demographics_seed_failed", { detail: demographicsResult || null });
        }
        const laborResult = population.recalculateLabor(settlementId);
        if (!laborResult || !laborResult.ok) {
            return fail("initial_labor_calculation_failed", { detail: laborResult || null });
        }

        return {
            ok: true,
            seed:
                seed
        };
    }

    function seedProsperity(
        settlementId,
        staticSettlement
    ) {
        const economy =
            economyState();

        if (
            !economy ||
            typeof economy.setIndex !==
                "function"
        ) {
            return fail(
                "economy_state_api_missing"
            );
        }

        const seed =
            getEconomySeed(
                staticSettlement
            );

        const result =
            economy.setIndex(
                settlementId,
                "prosperity",
                seed.prosperity,
                {
                    source:
                        "SettlementEconomyBootstrap",

                    action:
                        "seed_prosperity"
                }
            );

        if (
            !result ||
            !result.ok
        ) {
            return fail(
                "prosperity_seed_failed",
                {
                    detail:
                        result || null
                }
            );
        }

        return {
            ok: true,
            prosperity:
                seed.prosperity
        };
    }

    function seedFood(
        settlementId,
        staticSettlement
    ) {
        const economy =
            economyState();

        if (
            !economy ||
            typeof economy.addResource !==
                "function"
        ) {
            return fail(
                "economy_state_api_missing"
            );
        }

        const seed =
            getEconomySeed(
                staticSettlement
            );

        if (
            seed.foodStock <= 0
        ) {
            return {
                ok: true,
                skipped: true,
                amount: 0
            };
        }

        if (
            !isKnownResource(
                FOOD_RESOURCE_ID
            )
        ) {
            return fail(
                "food_resource_unknown",
                {
                    resourceId:
                        FOOD_RESOURCE_ID
                }
            );
        }

        const result =
            economy.addResource(
                settlementId,
                FOOD_RESOURCE_ID,
                seed.foodStock,
                {
                    source:
                        "SettlementEconomyBootstrap",

                    action:
                        "seed_food_stock"
                }
            );

        if (
            !result ||
            !result.ok
        ) {
            return fail(
                "food_seed_failed",
                {
                    detail:
                        result || null
                }
            );
        }

        return {
            ok: true,

            resourceId:
                FOOD_RESOURCE_ID,

            amount:
                seed.foodStock
        };
    }

    function seedMoney(
        settlementId,
        staticSettlement
    ) {
        const economy =
            economyState();

        if (
            !economy ||
            typeof economy.transferMoney !==
                "function"
        ) {
            return fail(
                "economy_state_api_missing"
            );
        }

        const seed =
            getMoneySeed(
                staticSettlement
            );

        const results = {};

        const accounts = [
            "treasury",
            "privateWealth",
            "merchantCapital"
        ];

        for (
            let index = 0;
            index < accounts.length;
            index += 1
        ) {
            const account =
                accounts[index];

            const amount =
                seed[account];

            if (amount <= 0) {
                results[account] = {
                    ok: true,
                    skipped: true,
                    amount: 0
                };

                continue;
            }

            const result =
                economy.transferMoney(
                    settlementId,
                    account,
                    amount,
                    {
                        source:
                            "SettlementEconomyBootstrap",

                        action:
                            "seed_money",

                        account:
                            account
                    }
                );

            if (
                !result ||
                !result.ok
            ) {
                return fail(
                    "money_seed_failed",
                    {
                        account:
                            account,

                        detail:
                            result ||
                            null
                    }
                );
            }

            results[account] =
                result;
        }

        return {
            ok: true,
            seed:
                seed,
            results:
                results
        };
    }

    function getPreBootstrapSnapshot(
        settlementId
    ) {
        const population =
            populationSystem();

        const economy =
            economyState();

        return {
            population:
                population &&
                typeof population.getSnapshot ===
                    "function"
                    ? population.getSnapshot(
                        settlementId
                    )
                    : null,

            economy:
                economy &&
                typeof economy.getSnapshot ===
                    "function"
                    ? economy.getSnapshot(
                        settlementId
                    )
                    : null
        };
    }

    function rollbackPopulation(
        settlementId,
        snapshot
    ) {
        const stateApi =
            window.ArsSettlementPopulationState;

        if (
            !snapshot ||
            !snapshot.population ||
            !stateApi ||
            typeof stateApi.replaceState !==
                "function"
        ) {
            return false;
        }

        const storedPopulation =
            snapshot.population.population ||
            snapshot.population;

        const result =
            stateApi.replaceState(
                settlementId,
                storedPopulation,
                "bootstrap_rollback"
            );

        return !!(
            result &&
            result.ok
        );
    }

    function rollbackEconomy(settlementId, before) {
        const economy = economyState();
        if (!economy || typeof economy.replaceSettlementState !== "function" || !before || !before.economy) return false;
        const result = economy.replaceSettlementState(
            cleanId(settlementId),
            before.economy,
            { source: "SettlementEconomyBootstrap", action: "bootstrap_rollback" }
        );
        return !!(result && result.ok);
    }

    function initializeSettlement(
        settlementId
    ) {
        const id =
            cleanId(settlementId);

        if (!id) {
            return fail(
                "invalid_settlement"
            );
        }

        const settlement =
            ensureSettlementRecord(id);

        const staticSettlement =
            getStaticSettlement(id);

        if (!settlement) {
            return fail(
                "game_state_settlement_missing"
            );
        }

        if (!staticSettlement) {
            return fail(
                "world_data_settlement_missing"
            );
        }

        if (
            settlement[
                BOOTSTRAP_KEY
            ].initialized === true
        ) {
            return {
                ok: true,
                initialized: false,
                skipped: true,
                reason:
                    "already_initialized",
                settlementId:
                    id,
                bootstrap:
                    clone(
                        settlement[
                            BOOTSTRAP_KEY
                        ]
                    )
            };
        }

        const before =
            getPreBootstrapSnapshot(id);

        const populationResult =
            seedPopulation(
                id,
                staticSettlement
            );

        if (
            !populationResult ||
            !populationResult.ok
        ) {
            return populationResult;
        }

        const prosperityResult =
            seedProsperity(
                id,
                staticSettlement
            );

        if (
            !prosperityResult ||
            !prosperityResult.ok
        ) {
            rollbackPopulation(
                id,
                before
            );

            return prosperityResult;
        }

        const foodResult =
            seedFood(
                id,
                staticSettlement
            );

        if (
            !foodResult ||
            !foodResult.ok
        ) {
            rollbackPopulation(
                id,
                before
            );

            rollbackEconomy(
                id,
                before
            );

            return foodResult;
        }

        const moneyResult =
            seedMoney(
                id,
                staticSettlement
            );

        if (
            !moneyResult ||
            !moneyResult.ok
        ) {
            rollbackPopulation(
                id,
                before
            );

            rollbackEconomy(
                id,
                before
            );

            return moneyResult;
        }

        const markResult =
            markInitialized(id);

        if (
            !markResult ||
            !markResult.ok
        ) {
            rollbackPopulation(
                id,
                before
            );

            rollbackEconomy(
                id,
                before
            );

            return markResult;
        }

        const bridge = window.ArsSettlementDevelopmentPopulationBridge;
        if (bridge && typeof bridge.syncSettlement === "function") {
            const bridgeResult = bridge.syncSettlement(id, { force: true, recalculateLabor: true });
            if (!bridgeResult || !bridgeResult.ok) {
                rollbackPopulation(id, before);
                rollbackEconomy(id, before);
                return fail("development_population_sync_failed", { detail: bridgeResult || null });
            }
        }
        if (populationSystem() && typeof populationSystem().recalculateLabor === "function") {
            populationSystem().recalculateLabor(id);
        }

        const result = {
            ok: true,
            initialized: true,
            skipped: false,

            settlementId:
                id,

            population:
                populationResult.seed,

            prosperity:
                prosperityResult.prosperity,

            food:
                {
                    resourceId:
                        foodResult.resourceId ||
                        FOOD_RESOURCE_ID,

                    amount:
                        foodResult.amount || 0
                },

            money:
                moneyResult.seed,

            bootstrap:
                markResult.bootstrap
        };

        emit(
            "settlement_initialized",
            id,
            result
        );

        return result;
    }

    function initializeAll() {
        const results = [];

        getStaticSettlements()
            .forEach(
                function (staticSettlement) {
                    const settlementId =
                        cleanId(
                            staticSettlement.id
                        );

                    if (!settlementId) {
                        return;
                    }

                    results.push({
                        settlementId:
                            settlementId,

                        result:
                            initializeSettlement(
                                settlementId
                            )
                    });
                }
            );

        return {
            ok:
                results.every(
                    function (entry) {
                        return (
                            entry.result &&
                            entry.result.ok
                        );
                    }
                ),

            initialized:
                results.filter(
                    function (entry) {
                        return (
                            entry.result &&
                            entry.result
                                .initialized ===
                                true
                        );
                    }
                ).length,

            skipped:
                results.filter(
                    function (entry) {
                        return (
                            entry.result &&
                            entry.result.skipped ===
                                true
                        );
                    }
                ).length,

            results:
                results
        };
    }

    function resetBootstrapFlag(
        settlementId
    ) {
        const settlement =
            ensureSettlementRecord(
                settlementId
            );

        if (!settlement) {
            return fail(
                "invalid_settlement"
            );
        }

        settlement[
            BOOTSTRAP_KEY
        ] = {
            version:
                VERSION,

            initialized:
                false
        };

        emit(
            "bootstrap_flag_reset",
            settlementId,
            {
                bootstrap:
                    clone(
                        settlement[
                            BOOTSTRAP_KEY
                        ]
                    )
            }
        );

        return {
            ok: true,

            settlementId:
                cleanId(settlementId),

            bootstrap:
                clone(
                    settlement[
                        BOOTSTRAP_KEY
                    ]
                )
        };
    }

    function validateSettlement(
        settlementId
    ) {
        const id =
            cleanId(settlementId);

        const errors = [];

        const settlement =
            ensureSettlementRecord(id);

        const staticSettlement =
            getStaticSettlement(id);

        if (!settlement) {
            errors.push(
                id +
                ": GameState 거점 없음"
            );

            return errors;
        }

        if (!staticSettlement) {
            errors.push(
                id +
                ": WorldMapData 거점 없음"
            );
        }

        if (
            !isRecord(
                settlement[
                    BOOTSTRAP_KEY
                ]
            )
        ) {
            errors.push(
                id +
                ": bootstrap 상태 없음"
            );
        } else {
            if (
                settlement[
                    BOOTSTRAP_KEY
                ].version !== VERSION
            ) {
                errors.push(
                    id +
                    ": bootstrap 버전 오류"
                );
            }

            if (
                typeof settlement[
                    BOOTSTRAP_KEY
                ].initialized !==
                "boolean"
            ) {
                errors.push(
                    id +
                    ": bootstrap initialized 오류"
                );
            }
        }

        if (
            !isKnownResource(
                FOOD_RESOURCE_ID
            )
        ) {
            errors.push(
                "초기 식량 자원 ID가 ResourceCatalog에 없습니다: " +
                FOOD_RESOURCE_ID
            );
        }

        return errors;
    }

    function validateAll() {
        const errors = [];

        if (!gameStateRoot()) {
            errors.push(
                "ArsGameState가 없습니다."
            );
        }

        if (!worldMapData()) {
            errors.push(
                "ArsWorldMapData가 없습니다."
            );
        }

        if (!populationSystem()) {
            errors.push(
                "ArsSettlementPopulation이 없습니다."
            );
        }

        if (!economyState()) {
            errors.push(
                "ArsSettlementEconomyState가 없습니다."
            );
        }

        if (!resourceCatalog()) {
            errors.push(
                "ArsResourceCatalog가 없습니다."
            );
        }

        getStaticSettlements()
            .forEach(
                function (settlement) {
                    validateSettlement(
                        settlement.id
                    ).forEach(
                        function (error) {
                            errors.push(
                                error
                            );
                        }
                    );
                }
            );

        return errors;
    }

    function debugPrint(
        settlementId
    ) {
        const id =
            cleanId(settlementId);

        if (id) {
            const result = {
                settlementId:
                    id,

                staticSettlement:
                    clone(
                        getStaticSettlement(
                            id
                        )
                    ),

                bootstrap:
                    getBootstrapState(
                        id
                    ),

                population:
                    populationSystem() &&
                    typeof populationSystem()
                        .getSnapshot ===
                        "function"
                        ? populationSystem()
                            .getSnapshot(id)
                        : null,

                economy:
                    economyState() &&
                    typeof economyState()
                        .getSnapshot ===
                        "function"
                        ? economyState()
                            .getSnapshot(id)
                        : null
            };

            console.group(
                "[Ars Bellum] 경제 초기화 상태: " +
                id
            );

            console.log(
                result
            );

            console.log(
                "검사 오류:",
                validateSettlement(id)
            );

            console.groupEnd();

            return result;
        }

        const summary =
            getStaticSettlements()
                .map(
                    function (settlement) {
                        const currentId =
                            cleanId(
                                settlement.id
                            );

                        const bootstrap =
                            getBootstrapState(
                                currentId
                            );

                        return {
                            settlementId:
                                currentId,

                            type:
                                cleanId(
                                    settlement.type
                                ),

                            initialized:
                                !!(
                                    bootstrap &&
                                    bootstrap
                                        .initialized
                                ),

                            version:
                                bootstrap
                                    ? bootstrap
                                        .version
                                    : 0
                        };
                    }
                );

        console.group(
            "[Ars Bellum] 전체 경제 초기화 상태"
        );

        console.table(
            summary
        );

        console.log(
            "검사 오류:",
            validateAll()
        );

        console.groupEnd();

        return summary;
    }

    window.ArsSettlementEconomyBootstrap =
        Object.freeze({
            version:
                VERSION,

            foodResourceId:
                FOOD_RESOURCE_ID,

            moneySeeds:
                MONEY_SEEDS,

            getBootstrapState:
                getBootstrapState,

            isInitialized:
                isInitialized,

            initializeSettlement:
                initializeSettlement,

            initializeAll:
                initializeAll,

            subscribe:
                subscribe,

            validateSettlement:
                validateSettlement,

            validateAll:
                validateAll,

            debugPrint:
                debugPrint
        });

    const errors =
        validateAll();

    if (errors.length) {
        console.error(
            "[Ars Bellum] SettlementEconomyBootstrap 검사 실패:",
            errors
        );
    } else {
        console.log(
            "[Ars Bellum] SettlementEconomyBootstrap 연결 완료"
        );
    }
})();