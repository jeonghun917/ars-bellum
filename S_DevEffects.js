// ============================================================
// Ars Bellum - S_DevEffects.js
// 거점 건물의 효과·일자리·유지비를 합산한다.
// 인구 상태와 경제 상태를 직접 수정하지 않는다.
// 직업 ID는 S_LaborTypes.js만 사용한다.
// 선행: S_LaborTypes.js,
// S_Buildings.js,
// S_DevState.js
// ============================================================
(function () {
    "use strict";

    const VERSION = 2;
    const CACHE = new Map();
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
            : JSON.parse(JSON.stringify(value));
    }

    function cleanId(value) {
        return typeof value === "string"
            ? value.trim()
            : "";
    }

    function finite(value, fallback) {
        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : fallback;
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
        const scale = Math.pow(
            10,
            Math.max(
                0,
                Number(digits) || 0
            )
        );

        return Math.round(
            finite(value, 0) * scale
        ) / scale;
    }

    function laborTypes() {
        return (
            window.ArsSettlementLaborTypes ||
            null
        );
    }

    function buildingCatalog() {
        return (
            window.ArsSettlementBuildingCatalog ||
            null
        );
    }

    function developmentState() {
        return (
            window.ArsSettlementDevelopmentState ||
            null
        );
    }

    function makeEffectMap() {
        const catalog =
            buildingCatalog();

        const result = {};

        if (
            catalog &&
            Array.isArray(
                catalog.effectKeys
            )
        ) {
            catalog.effectKeys.forEach(
                function (effectKey) {
                    result[effectKey] = 0;
                }
            );
        }

        return result;
    }

    function makeJobMap() {
        const labor =
            laborTypes();

        if (
            !labor ||
            typeof labor.makeEmptyMap !==
                "function"
        ) {
            return {};
        }

        return labor.makeEmptyMap();
    }

    function addMap(
        target,
        source,
        multiplier
    ) {
        if (!isRecord(source)) {
            return target;
        }

        const factor =
            finite(multiplier, 1);

        Object.keys(source).forEach(
            function (key) {
                target[key] = round(
                    finite(
                        target[key],
                        0
                    ) +
                    finite(
                        source[key],
                        0
                    ) *
                    factor,
                    4
                );
            }
        );

        return target;
    }

    function normalizeJobMap(source) {
        const labor =
            laborTypes();

        if (
            !labor ||
            typeof labor.normalizeMap !==
                "function"
        ) {
            return {};
        }

        return labor.normalizeMap(
            source
        );
    }

    function getSettlementSnapshot(
        settlementId
    ) {
        const stateApi =
            developmentState();

        if (
            !stateApi ||
            typeof stateApi
                .getSettlementSnapshot !==
                "function"
        ) {
            return null;
        }

        return stateApi
            .getSettlementSnapshot(
                cleanId(settlementId)
            );
    }

    function getRevision(snapshot) {
        if (
            !snapshot ||
            !isRecord(
                snapshot.developmentState
            )
        ) {
            return 0;
        }

        return Math.max(
            0,
            Math.floor(
                finite(
                    snapshot
                        .developmentState
                        .revision,
                    0
                )
            )
        );
    }

    function getBuildingDefinition(
        buildingId
    ) {
        const catalog =
            buildingCatalog();

        if (
            !catalog ||
            typeof catalog
                .getBuildingById !==
                "function"
        ) {
            return null;
        }

        return catalog
            .getBuildingById(
                cleanId(buildingId)
            );
    }

    function getBuildingEffects(
        buildingId,
        level
    ) {
        const catalog =
            buildingCatalog();

        if (
            !catalog ||
            typeof catalog
                .getEffectsAtLevel !==
                "function"
        ) {
            return {};
        }

        return (
            catalog.getEffectsAtLevel(
                cleanId(buildingId),
                level
            ) ||
            {}
        );
    }

    function getBuildingJobs(
        buildingId,
        level
    ) {
        const catalog =
            buildingCatalog();

        if (
            !catalog ||
            typeof catalog
                .getJobsAtLevel !==
                "function"
        ) {
            return makeJobMap();
        }

        return normalizeJobMap(
            catalog.getJobsAtLevel(
                cleanId(buildingId),
                level
            )
        );
    }

    function getBuildingMaintenance(
        buildingId,
        level
    ) {
        const catalog =
            buildingCatalog();

        if (
            !catalog ||
            typeof catalog
                .getMaintenanceAtLevel !==
                "function"
        ) {
            return {
                gold: 0
            };
        }

        return (
            catalog.getMaintenanceAtLevel(
                cleanId(buildingId),
                level
            ) || {
                gold: 0
            }
        );
    }

    function normalizeBuildingState(
        buildingId,
        source
    ) {
        const definition =
            getBuildingDefinition(
                buildingId
            );

        if (!definition) {
            return null;
        }

        const input =
            isRecord(source)
                ? source
                : {};

        const level = Math.max(
            0,
            Math.min(
                definition.maxLevel,
                Math.floor(
                    finite(
                        input.level,
                        0
                    )
                )
            )
        );

        const enabled =
            input.enabled !== false;

        const condition =
            clamp(
                input.condition ===
                    undefined
                    ? 1
                    : input.condition,
                0,
                1
            );

        return {
            buildingId:
                definition.id,

            name:
                definition.name,

            category:
                definition.category,

            kind:
                definition.kind,

            level:
                level,

            enabled:
                enabled,

            condition:
                condition,

            operatingFactor:
                enabled
                    ? condition
                    : 0
        };
    }

    function makeContribution(
        buildingState
    ) {
        const effects = {};
        const jobs =
            makeJobMap();

        const operatingFactor =
            buildingState
                .operatingFactor;

        addMap(
            effects,
            getBuildingEffects(
                buildingState.buildingId,
                buildingState.level
            ),
            operatingFactor
        );

        addMap(
            jobs,
            getBuildingJobs(
                buildingState.buildingId,
                buildingState.level
            ),
            operatingFactor
        );

        const maintenance =
            getBuildingMaintenance(
                buildingState.buildingId,
                buildingState.level
            );

        return {
            buildingId:
                buildingState.buildingId,

            name:
                buildingState.name,

            category:
                buildingState.category,

            kind:
                buildingState.kind,

            level:
                buildingState.level,

            enabled:
                buildingState.enabled,

            condition:
                buildingState.condition,

            operatingFactor:
                operatingFactor,

            effects:
                effects,

            jobs:
                normalizeJobMap(
                    jobs
                ),

            maintenance: {
                gold: round(
                    finite(
                        maintenance.gold,
                        0
                    ),
                    2
                )
            }
        };
    }

    function calculateSettlement(
        settlementId
    ) {
        const id =
            cleanId(settlementId);

        const snapshot =
            getSettlementSnapshot(id);

        if (
            !id ||
            !snapshot
        ) {
            return null;
        }

        const effects =
            makeEffectMap();

        const jobs =
            makeJobMap();

        const contributions = [];

        let maintenanceGold = 0;
        let totalBuildingLevels = 0;
        let activeBuildingTypes = 0;
        let disabledBuildingTypes = 0;
        let damagedBuildingTypes = 0;

        const buildings =
            isRecord(snapshot.buildings)
                ? snapshot.buildings
                : {};

        Object.keys(buildings).forEach(
            function (buildingId) {
                const buildingState =
                    normalizeBuildingState(
                        buildingId,
                        buildings[
                            buildingId
                        ]
                    );

                if (
                    !buildingState ||
                    buildingState.level <= 0
                ) {
                    return;
                }

                const contribution =
                    makeContribution(
                        buildingState
                    );

                contributions.push(
                    contribution
                );

                totalBuildingLevels +=
                    buildingState.level;

                maintenanceGold +=
                    contribution
                        .maintenance
                        .gold;

                if (
                    buildingState
                        .operatingFactor >
                    0
                ) {
                    activeBuildingTypes += 1;
                } else {
                    disabledBuildingTypes += 1;
                }

                if (
                    buildingState.condition <
                    1
                ) {
                    damagedBuildingTypes += 1;
                }

                addMap(
                    effects,
                    contribution.effects,
                    1
                );

                addMap(
                    jobs,
                    contribution.jobs,
                    1
                );
            }
        );

        contributions.sort(
            function (left, right) {
                return left
                    .buildingId
                    .localeCompare(
                        right.buildingId
                    );
            }
        );

        return {
            version:
                VERSION,

            settlementId:
                id,

            sourceRevision:
                getRevision(snapshot),

            totals: {
                buildingTypes:
                    contributions.length,

                totalBuildingLevels:
                    totalBuildingLevels,

                activeBuildingTypes:
                    activeBuildingTypes,

                disabledBuildingTypes:
                    disabledBuildingTypes,

                damagedBuildingTypes:
                    damagedBuildingTypes
            },

            effects:
                effects,

            jobs:
                normalizeJobMap(
                    jobs
                ),

            maintenance: {
                goldPerDay:
                    round(
                        maintenanceGold,
                        2
                    )
            },

            contributions:
                contributions
        };
    }

    function emit(event) {
        LISTENERS.forEach(
            function (listener) {
                try {
                    listener(
                        clone(event)
                    );
                } catch (error) {
                    console.error(
                        "[Ars Bellum] 개발 효과 구독자 오류:",
                        error
                    );
                }
            }
        );
    }

    function snapshotsEqual(left, right) {
        return JSON.stringify(left || null) === JSON.stringify(right || null);
    }

    function refreshSettlement(
        settlementId,
        force
    ) {
        const id =
            cleanId(settlementId);

        const stateSnapshot =
            getSettlementSnapshot(id);

        if (
            !id ||
            !stateSnapshot
        ) {
            return null;
        }

        const revision =
            getRevision(
                stateSnapshot
            );

        const cached =
            CACHE.get(id);

        if (
            force !== true &&
            cached &&
            cached.revision === revision
        ) {
            return clone(
                cached.value
            );
        }

        const calculated =
            calculateSettlement(id);

        if (!calculated) {
            return null;
        }

        const changed = !cached || !snapshotsEqual(cached.value, calculated);

        CACHE.set(
            id,
            {
                revision:
                    revision,

                value:
                    calculated
            }
        );

        if (changed) emit({
            type:
                "development_effects_refreshed",

            settlementId:
                id,

            sourceRevision:
                revision,

            snapshot:
                calculated
        });

        return clone(
            calculated
        );
    }

    function getSnapshot(
        settlementId
    ) {
        return refreshSettlement(
            settlementId,
            false
        );
    }

    function getEffects(
        settlementId
    ) {
        const snapshot =
            getSnapshot(
                settlementId
            );

        return snapshot
            ? clone(
                snapshot.effects
            )
            : null;
    }

    function getEffect(
        settlementId,
        effectKey
    ) {
        const effects =
            getEffects(
                settlementId
            );

        const key =
            cleanId(effectKey);

        return (
            effects &&
            key
        )
            ? finite(
                effects[key],
                0
            )
            : 0;
    }

    function getJobs(
        settlementId
    ) {
        const snapshot =
            getSnapshot(
                settlementId
            );

        return snapshot
            ? normalizeJobMap(
                snapshot.jobs
            )
            : null;
    }

    function getJobCapacity(
        settlementId,
        jobId
    ) {
        const labor =
            laborTypes();

        const id =
            cleanId(jobId);

        if (
            !labor ||
            !labor.isKnown(id)
        ) {
            return 0;
        }

        const jobs =
            getJobs(
                settlementId
            );

        return jobs
            ? finite(
                jobs[id],
                0
            )
            : 0;
    }

    function getMaintenance(
        settlementId
    ) {
        const snapshot =
            getSnapshot(
                settlementId
            );

        return snapshot
            ? clone(
                snapshot.maintenance
            )
            : null;
    }

    function getBuildingContribution(
        settlementId,
        buildingId
    ) {
        const snapshot =
            getSnapshot(
                settlementId
            );

        const id =
            cleanId(buildingId);

        if (
            !snapshot ||
            !id
        ) {
            return null;
        }

        const contribution =
            snapshot
                .contributions
                .find(
                    function (entry) {
                        return (
                            entry.buildingId ===
                            id
                        );
                    }
                );

        return contribution
            ? clone(
                contribution
            )
            : null;
    }

    function getPopulationCapacity(
        settlementId,
        baseCapacity
    ) {
        return Math.max(
            0,
            finite(
                baseCapacity,
                0
            ) +
            getEffect(
                settlementId,
                "housingCapacity"
            )
        );
    }

    function getStorageCapacity(
        settlementId,
        baseCapacity
    ) {
        return Math.max(
            0,
            finite(
                baseCapacity,
                0
            ) +
            getEffect(
                settlementId,
                "storageCapacity"
            )
        );
    }

    function listSettlementIds() {
        const stateApi =
            developmentState();

        if (
            !stateApi ||
            typeof stateApi
                .listSettlementIds !==
                "function"
        ) {
            return [];
        }

        return (
            stateApi
                .listSettlementIds() ||
            []
        );
    }

    function refreshAllSettlements(
        force
    ) {
        const result = {};

        listSettlementIds().forEach(
            function (settlementId) {
                result[settlementId] =
                    refreshSettlement(
                        settlementId,
                        force === true
                    );
            }
        );

        return result;
    }

    function invalidate(
        settlementId
    ) {
        const id =
            cleanId(settlementId);

        if (!id) {
            CACHE.clear();
            return true;
        }

        return CACHE.delete(id);
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

    function validate() {
        const errors = [];

        const labor =
            laborTypes();

        const catalog =
            buildingCatalog();

        const stateApi =
            developmentState();

        if (!labor) {
            errors.push(
                "ArsSettlementLaborTypes가 없습니다."
            );
        }

        if (!catalog) {
            errors.push(
                "ArsSettlementBuildingCatalog가 없습니다."
            );
        }

        if (!stateApi) {
            errors.push(
                "ArsSettlementDevelopmentState가 없습니다."
            );
        }

        listSettlementIds().forEach(
            function (settlementId) {
                const snapshot =
                    calculateSettlement(
                        settlementId
                    );

                if (!snapshot) {
                    errors.push(
                        settlementId +
                        ": 개발 효과 계산 실패"
                    );

                    return;
                }

                Object.keys(
                    snapshot.jobs
                ).forEach(
                    function (jobId) {
                        if (
                            !labor ||
                            !labor.isKnown(
                                jobId
                            )
                        ) {
                            errors.push(
                                settlementId +
                                ": 알 수 없는 직업 ID " +
                                jobId
                            );
                        }
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
            const snapshot =
                getSnapshot(id);

            console.group(
                "[Ars Bellum] 거점 개발 효과: " +
                id
            );

            console.table(
                snapshot
                    ? snapshot.contributions
                    : []
            );

            console.log(
                snapshot
            );

            console.log(
                "검사 오류:",
                validate()
            );

            console.groupEnd();

            return snapshot;
        }

        const summary =
            listSettlementIds().map(
                function (currentId) {
                    const snapshot =
                        getSnapshot(
                            currentId
                        );

                    const totalJobs =
                        snapshot
                            ? Object
                                .values(
                                    snapshot.jobs
                                )
                                .reduce(
                                    function (
                                        sum,
                                        value
                                    ) {
                                        return (
                                            sum +
                                            finite(
                                                value,
                                                0
                                            )
                                        );
                                    },
                                    0
                                )
                            : 0;

                    return {
                        settlementId:
                            currentId,

                        buildingTypes:
                            snapshot
                                ? snapshot
                                    .totals
                                    .buildingTypes
                                : 0,

                        housingCapacity:
                            snapshot
                                ? snapshot
                                    .effects
                                    .housingCapacity
                                : 0,

                        totalJobs:
                            round(
                                totalJobs,
                                2
                            ),

                        maintenanceGold:
                            snapshot
                                ? snapshot
                                    .maintenance
                                    .goldPerDay
                                : 0
                    };
                }
            );

        console.group(
            "[Ars Bellum] 전체 거점 개발 효과"
        );

        console.table(
            summary
        );

        console.log(
            "검사 오류:",
            validate()
        );

        console.groupEnd();

        return summary;
    }



    function bindDevelopmentState() {
        const stateApi = developmentState();
        if (!stateApi || typeof stateApi.subscribe !== "function") return false;
        stateApi.subscribe(function (event) {
            const id = cleanId(event && event.settlementId);
            if (!id) return;
            CACHE.delete(id);
            refreshSettlement(id, true);
        });
        return true;
    }

    window.ArsSettlementDevelopmentEffects =
        Object.freeze({
            version:
                VERSION,

            calculateSettlement:
                calculateSettlement,

            refreshSettlement:
                refreshSettlement,

            refreshAllSettlements:
                refreshAllSettlements,

            invalidate:
                invalidate,

            getSnapshot:
                getSnapshot,

            getEffects:
                getEffects,

            getEffect:
                getEffect,

            getJobs:
                getJobs,

            getJobCapacity:
                getJobCapacity,

            getMaintenance:
                getMaintenance,

            getBuildingContribution:
                getBuildingContribution,

            getPopulationCapacity:
                getPopulationCapacity,

            getStorageCapacity:
                getStorageCapacity,

            subscribe:
                subscribe,

            validate:
                validate,

            debugPrint:
                debugPrint
        });

    bindDevelopmentState();

    const errors =
        validate();

    if (errors.length) {
        console.error(
            "[Ars Bellum] SettlementDevelopmentEffects 검사 실패:",
            errors
        );
    } else {
        refreshAllSettlements(true);

        console.log(
            "[Ars Bellum] SettlementDevelopmentEffects 연결 완료"
        );
    }
})();