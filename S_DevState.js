// ============================================================
// Ars Bellum - S_DevState.js
// 거점별 건물 레벨·가동 여부·내구 상태 저장 전용 파일.
// 건설 비용, 공사 진행, 효과 합산은 다른 파일이 담당한다.
// 선행 파일: GameState.js, S_Buildings.js
// ============================================================
(function () {
    "use strict";

    const LISTENERS = new Set();
    const DATA_VERSION = 1;
    const META_KEY = "developmentState";
    const BUILDINGS_KEY = "buildings";

    function isRecord(value) {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }

    function clone(value) {
        return value === undefined
            ? undefined
            : JSON.parse(JSON.stringify(value));
    }

    function normalizeId(value) {
        return typeof value === "string" ? value.trim() : "";
    }

    function clamp(value, minimum, maximum) {
        const number = Number(value);

        if (!Number.isFinite(number)) {
            return minimum;
        }

        return Math.max(
            minimum,
            Math.min(maximum, number)
        );
    }

    function clampInteger(value, minimum, maximum) {
        return Math.floor(
            clamp(value, minimum, maximum)
        );
    }

    function getCatalog() {
        return window.ArsSettlementBuildingCatalog || null;
    }

    function getGameStateRoot() {
        if (
            !window.ArsGameState ||
            typeof window.ArsGameState.getState !== "function"
        ) {
            return null;
        }

        const state = window.ArsGameState.getState();

        return isRecord(state) ? state : null;
    }

    function getBuildingDefinition(buildingId) {
        const catalog = getCatalog();
        const id = normalizeId(buildingId);

        if (
            !catalog ||
            typeof catalog.getBuildingById !== "function" ||
            !id
        ) {
            return null;
        }

        return catalog.getBuildingById(id);
    }

    function ensureWorldState() {
        const state = getGameStateRoot();

        if (!state) {
            return null;
        }

        if (!isRecord(state.world)) {
            state.world = {};
        }

        if (!isRecord(state.world.settlements)) {
            state.world.settlements = {};
        }

        return state.world;
    }

    function makeDevelopmentMeta() {
        return {
            version: DATA_VERSION,
            revision: 0,
            lastAction: "initialized"
        };
    }

    function normalizeDevelopmentMeta(value) {
        const meta = isRecord(value)
            ? value
            : makeDevelopmentMeta();

        meta.version = DATA_VERSION;
        meta.revision = Math.max(
            0,
            Math.floor(Number(meta.revision) || 0)
        );

        meta.lastAction =
            typeof meta.lastAction === "string"
                ? meta.lastAction
                : "normalized";

        return meta;
    }

    function normalizeBuildingRecord(buildingId, value) {
        const definition = getBuildingDefinition(buildingId);

        if (!definition) {
            return null;
        }

        const source = isRecord(value)
            ? value
            : {
                level: value
            };

        return {
            level: clampInteger(
                source.level,
                0,
                definition.maxLevel
            ),

            enabled: source.enabled !== false,

            condition: clamp(
                source.condition === undefined
                    ? 1
                    : source.condition,
                0,
                1
            )
        };
    }

    function normalizeSettlementBuildings(settlement) {
        if (!isRecord(settlement)) {
            return;
        }

        if (!isRecord(settlement[BUILDINGS_KEY])) {
            settlement[BUILDINGS_KEY] = {};
        }

        Object.keys(
            settlement[BUILDINGS_KEY]
        ).forEach(function (buildingId) {
            const normalized = normalizeBuildingRecord(
                buildingId,
                settlement[BUILDINGS_KEY][buildingId]
            );

            if (!normalized) {
                return;
            }

            if (normalized.level <= 0) {
                delete settlement[BUILDINGS_KEY][buildingId];
                return;
            }

            settlement[BUILDINGS_KEY][buildingId] = normalized;
        });
    }

    function ensureSettlementState(settlementId) {
        const id = normalizeId(settlementId);
        const world = ensureWorldState();

        if (!id || !world) {
            return null;
        }

        if (!isRecord(world.settlements[id])) {
            world.settlements[id] = {};
        }

        const settlement = world.settlements[id];

        if (!settlement.id) {
            settlement.id = id;
        }

        if (!isRecord(settlement[BUILDINGS_KEY])) {
            settlement[BUILDINGS_KEY] = {};
        }

        settlement[META_KEY] = normalizeDevelopmentMeta(
            settlement[META_KEY]
        );

        normalizeSettlementBuildings(settlement);

        return settlement;
    }

    function touch(settlement, action) {
        if (!isRecord(settlement)) {
            return;
        }

        settlement[META_KEY] = normalizeDevelopmentMeta(
            settlement[META_KEY]
        );

        settlement[META_KEY].revision += 1;

        settlement[META_KEY].lastAction =
            normalizeId(action) || "updated";
    }

    function getSettlementState(settlementId) {
        return ensureSettlementState(settlementId);
    }

    function getSettlementSnapshot(settlementId) {
        const id = normalizeId(settlementId);
        const settlement = ensureSettlementState(id);

        if (!settlement) {
            return null;
        }

        return {
            settlementId: id,

            developmentState: clone(
                settlement[META_KEY]
            ),

            buildings: clone(
                settlement[BUILDINGS_KEY]
            )
        };
    }

    function getBuildingState(settlementId, buildingId) {
        const id = normalizeId(buildingId);
        const settlement = ensureSettlementState(settlementId);
        const definition = getBuildingDefinition(id);

        if (!settlement || !definition) {
            return null;
        }

        const record = settlement[BUILDINGS_KEY][id];

        if (!record) {
            return {
                buildingId: id,
                level: 0,
                enabled: true,
                condition: 1
            };
        }

        return Object.assign(
            {
                buildingId: id
            },
            clone(record)
        );
    }

    function getBuildingLevel(settlementId, buildingId) {
        const record = getBuildingState(
            settlementId,
            buildingId
        );

        return record ? record.level : 0;
    }



    function emitChange(action, settlementId, payload) {
        const event = {
            type: "development_state_changed",
            settlementId: normalizeId(settlementId),
            day: null,
            revision: payload && payload.revision !== undefined ? payload.revision : null,
            source: "SettlementDevelopmentState",
            payload: clone(payload || {})
        };
        event.payload.action = action;
        LISTENERS.forEach(function (listener) {
            try { listener(clone(event)); }
            catch (error) { console.error("[Ars Bellum] 개발 상태 구독자 오류:", error); }
        });
    }

    function subscribe(listener) {
        if (typeof listener !== "function") return function () {};
        LISTENERS.add(listener);
        return function unsubscribe() { LISTENERS.delete(listener); };
    }

    function setBuildingLevel(
        settlementId,
        buildingId,
        levelValue
    ) {
        const settlementIdValue = normalizeId(settlementId);
        const buildingIdValue = normalizeId(buildingId);

        const definition = getBuildingDefinition(
            buildingIdValue
        );

        const settlement = ensureSettlementState(
            settlementIdValue
        );

        if (!definition) {
            return {
                ok: false,
                reason: "unknown_building",
                buildingId: buildingIdValue
            };
        }

        if (!settlement) {
            return {
                ok: false,
                reason: "invalid_settlement",
                settlementId: settlementIdValue
            };
        }

        const targetLevel = Number(levelValue);

        if (
            !Number.isInteger(targetLevel) ||
            targetLevel < 0 ||
            targetLevel > definition.maxLevel
        ) {
            return {
                ok: false,
                reason: "invalid_level",
                minimum: 0,
                maximum: definition.maxLevel
            };
        }

        const previousLevel = getBuildingLevel(
            settlementIdValue,
            buildingIdValue
        );

        if (targetLevel === 0) {
            delete settlement[BUILDINGS_KEY][buildingIdValue];
        } else {
            const current =
                settlement[BUILDINGS_KEY][buildingIdValue] || {
                    enabled: true,
                    condition: 1
                };

            settlement[BUILDINGS_KEY][buildingIdValue] = {
                level: targetLevel,

                enabled:
                    current.enabled !== false,

                condition: clamp(
                    current.condition === undefined
                        ? 1
                        : current.condition,
                    0,
                    1
                )
            };
        }

        touch(
            settlement,
            "set_building_level"
        );

        emitChange(
            "set_building_level",
            settlementIdValue,
            {
                buildingId: buildingIdValue,
                previousLevel: previousLevel,
                currentLevel: targetLevel,
                revision: settlement[META_KEY].revision
            }
        );

        return {
            ok: true,
            settlementId: settlementIdValue,
            buildingId: buildingIdValue,
            previousLevel: previousLevel,
            currentLevel: targetLevel,

            state: getBuildingState(
                settlementIdValue,
                buildingIdValue
            )
        };
    }

    function adjustBuildingLevel(
        settlementId,
        buildingId,
        amount
    ) {
        const definition = getBuildingDefinition(buildingId);

        if (!definition) {
            return {
                ok: false,
                reason: "unknown_building",
                buildingId: normalizeId(buildingId)
            };
        }

        const currentLevel = getBuildingLevel(
            settlementId,
            buildingId
        );

        const delta = Math.trunc(
            Number(amount) || 0
        );

        const targetLevel = clampInteger(
            currentLevel + delta,
            0,
            definition.maxLevel
        );

        return setBuildingLevel(
            settlementId,
            buildingId,
            targetLevel
        );
    }

    function setBuildingEnabled(
        settlementId,
        buildingId,
        enabled
    ) {
        const id = normalizeId(buildingId);

        const settlement = ensureSettlementState(
            settlementId
        );

        const current = getBuildingState(
            settlementId,
            id
        );

        if (
            !settlement ||
            !current ||
            current.level <= 0
        ) {
            return {
                ok: false,
                reason: "building_not_owned",
                buildingId: id
            };
        }

        settlement[BUILDINGS_KEY][id].enabled =
            enabled !== false;

        touch(
            settlement,
            "set_building_enabled"
        );

        return {
            ok: true,
            settlementId: normalizeId(settlementId),
            buildingId: id,

            state: getBuildingState(
                settlementId,
                id
            )
        };
    }

    function setBuildingCondition(
        settlementId,
        buildingId,
        conditionValue
    ) {
        const id = normalizeId(buildingId);

        const settlement = ensureSettlementState(
            settlementId
        );

        const current = getBuildingState(
            settlementId,
            id
        );

        if (
            !settlement ||
            !current ||
            current.level <= 0
        ) {
            return {
                ok: false,
                reason: "building_not_owned",
                buildingId: id
            };
        }

        settlement[BUILDINGS_KEY][id].condition =
            clamp(
                conditionValue,
                0,
                1
            );

        touch(
            settlement,
            "set_building_condition"
        );

        return {
            ok: true,
            settlementId: normalizeId(settlementId),
            buildingId: id,

            state: getBuildingState(
                settlementId,
                id
            )
        };
    }

    function getOwnedBuildings(settlementId) {
        const settlement = ensureSettlementState(
            settlementId
        );

        if (!settlement) {
            return [];
        }

        return Object.keys(
            settlement[BUILDINGS_KEY]
        )
            .map(function (buildingId) {
                const definition =
                    getBuildingDefinition(buildingId);

                const record =
                    settlement[BUILDINGS_KEY][buildingId];

                return {
                    buildingId: buildingId,

                    name: definition
                        ? definition.name
                        : buildingId,

                    level: record.level,
                    enabled: record.enabled,
                    condition: record.condition
                };
            })
            .sort(function (a, b) {
                return a.buildingId.localeCompare(
                    b.buildingId
                );
            });
    }

    function setInitialBuildingLevels(
        settlementId,
        levels,
        clearExisting
    ) {
        const settlement = ensureSettlementState(
            settlementId
        );

        if (!settlement || !isRecord(levels)) {
            return {
                ok: false,
                reason: "invalid_input"
            };
        }

        if (clearExisting === true) {
            settlement[BUILDINGS_KEY] = {};
        }

        const results = Object.keys(levels).map(
            function (buildingId) {
                return setBuildingLevel(
                    settlementId,
                    buildingId,
                    levels[buildingId]
                );
            }
        );

        return {
            ok: results.every(function (result) {
                return result.ok;
            }),

            settlementId: normalizeId(settlementId),
            results: results,

            snapshot: getSettlementSnapshot(
                settlementId
            )
        };
    }

    function resetSettlement(settlementId) {
        const settlement = ensureSettlementState(
            settlementId
        );

        if (!settlement) {
            return false;
        }

        settlement[BUILDINGS_KEY] = {};

        touch(
            settlement,
            "reset_settlement_development"
        );

        return true;
    }

    function initializeFromWorldData(
        initialLevelsBySettlement
    ) {
        const data = window.ArsWorldMapData;

        const settlements =
            data && Array.isArray(data.settlements)
                ? data.settlements
                : [];

        const initialized = [];

        settlements.forEach(
            function (staticSettlement) {
                const settlementId = normalizeId(
                    staticSettlement &&
                    staticSettlement.id
                );

                if (!settlementId) {
                    return;
                }

                ensureSettlementState(settlementId);
                initialized.push(settlementId);

                if (
                    isRecord(initialLevelsBySettlement) &&
                    isRecord(
                        initialLevelsBySettlement[
                            settlementId
                        ]
                    )
                ) {
                    setInitialBuildingLevels(
                        settlementId,
                        initialLevelsBySettlement[
                            settlementId
                        ],
                        false
                    );
                }
            }
        );

        return initialized;
    }

    function listSettlementIds() {
        const world = ensureWorldState();

        return world
            ? Object.keys(world.settlements).sort()
            : [];
    }

    function validateSettlement(settlementId) {
        const id = normalizeId(settlementId);

        const settlement = ensureSettlementState(
            id
        );

        const errors = [];

        if (!id) {
            errors.push(
                "거점 ID가 비어 있습니다."
            );

            return errors;
        }

        if (!settlement) {
            errors.push(
                id +
                ": 거점 상태를 만들 수 없습니다."
            );

            return errors;
        }

        Object.keys(
            settlement[BUILDINGS_KEY]
        ).forEach(function (buildingId) {
            const definition =
                getBuildingDefinition(buildingId);

            const record =
                settlement[BUILDINGS_KEY][buildingId];

            if (!definition) {
                errors.push(
                    id +
                    ": 알 수 없는 건물 ID " +
                    buildingId
                );

                return;
            }

            if (
                !Number.isInteger(record.level) ||
                record.level < 1 ||
                record.level > definition.maxLevel
            ) {
                errors.push(
                    id +
                    ": " +
                    buildingId +
                    " 레벨 오류"
                );
            }

            if (
                typeof record.enabled !== "boolean"
            ) {
                errors.push(
                    id +
                    ": " +
                    buildingId +
                    " enabled 오류"
                );
            }

            if (
                !Number.isFinite(record.condition) ||
                record.condition < 0 ||
                record.condition > 1
            ) {
                errors.push(
                    id +
                    ": " +
                    buildingId +
                    " condition 오류"
                );
            }
        });

        return errors;
    }

    function validateAll() {
        const errors = [];

        if (!getGameStateRoot()) {
            errors.push(
                "ArsGameState가 없습니다."
            );
        }

        if (!getCatalog()) {
            errors.push(
                "ArsSettlementBuildingCatalog가 없습니다."
            );
        }

        listSettlementIds().forEach(
            function (settlementId) {
                validateSettlement(
                    settlementId
                ).forEach(function (error) {
                    errors.push(error);
                });
            }
        );

        return errors;
    }

    function debugPrint(settlementId) {
        const id = normalizeId(settlementId);

        if (id) {
            const snapshot =
                getSettlementSnapshot(id);

            console.group(
                "[Ars Bellum] 거점 개발 상태: " +
                id
            );

            console.table(
                getOwnedBuildings(id)
            );

            console.log(snapshot);
            console.groupEnd();

            return snapshot;
        }

        const summary = listSettlementIds().map(
            function (currentId) {
                const settlement =
                    ensureSettlementState(currentId);

                const owned =
                    getOwnedBuildings(currentId);

                return {
                    settlementId: currentId,
                    buildingTypes: owned.length,

                    totalLevels: owned.reduce(
                        function (sum, building) {
                            return sum + building.level;
                        },
                        0
                    ),

                    revision:
                        settlement[META_KEY].revision
                };
            }
        );

        console.group(
            "[Ars Bellum] 전체 거점 개발 상태"
        );

        console.table(summary);

        console.log(
            "검사 오류:",
            validateAll()
        );

        console.groupEnd();

        return summary;
    }

    window.ArsSettlementDevelopmentState = {
        version: DATA_VERSION,

        ensureWorldState:
            ensureWorldState,

        ensureSettlementState:
            ensureSettlementState,

        initializeFromWorldData:
            initializeFromWorldData,

        getSettlementState:
            getSettlementState,

        getSettlementSnapshot:
            getSettlementSnapshot,

        getBuildingState:
            getBuildingState,

        getBuildingLevel:
            getBuildingLevel,

        getOwnedBuildings:
            getOwnedBuildings,

        listSettlementIds:
            listSettlementIds,

        setBuildingLevel:
            setBuildingLevel,

        adjustBuildingLevel:
            adjustBuildingLevel,

        setBuildingEnabled:
            setBuildingEnabled,

        setBuildingCondition:
            setBuildingCondition,

        setInitialBuildingLevels:
            setInitialBuildingLevels,

        resetSettlement:
            resetSettlement,

        validateSettlement:
            validateSettlement,

        validateAll:
            validateAll,

        debugPrint:
            debugPrint,

        subscribe:
            subscribe
    };

    const initializedSettlements =
        initializeFromWorldData();

    const errors = validateAll();

    if (errors.length) {
        console.error(
            "[Ars Bellum] " +
            "SettlementDevelopmentState 검사 실패:",
            errors
        );
    } else {
        console.log(
            "[Ars Bellum] " +
            "SettlementDevelopmentState 연결 완료 - 거점 " +
            initializedSettlements.length +
            "곳"
        );
    }
})();