// ============================================================
// Ars Bellum - S_Labor.js
// 노동 공급, 일자리 합산, 고용, 실업, 빈 일자리 계산 전용.
// 인구 상태 저장은 S_PopState.js만 사용한다.
// GameClock 구독과 인구 증감 계산은 수행하지 않는다.
// 선행: S_LaborTypes.js, S_PopState.js
// ============================================================
(function () {
    "use strict";

    const VERSION = 2;

    const BASELINE_JOB_CONFIG = Object.freeze({
        populationDivisor: 4,
        minimumJobs: 4,
        typeMultipliers: Object.freeze({
            village: 0.72,
            town: 0.82,
            city: 0.92,
            capital: 1.0,
            fortress: 0.62,
            port: 0.9,
            default: 0.78
        }),
        shares: Object.freeze({
            peasants: 0.45,
            laborers: 0.24,
            artisans: 0.08,
            merchants: 0.08,
            administrators: 0.05,
            guards: 0.04,
            soldiers: 0.02,
            clergy: 0.02,
            nobles: 0.02
        })
    });

    const RESERVED_SOURCE_IDS = Object.freeze([
        "baseline",
        "buildings",
        "production",
        "construction",
        "market",
        "security",
        "military"
    ]);

    const DEFAULT_SUPPLY_WEIGHTS = Object.freeze({
        peasants: 0.34,
        laborers: 0.24,
        artisans: 0.12,
        merchants: 0.07,
        administrators: 0.05,
        guards: 0.05,
        soldiers: 0.06,
        clergy: 0.03,
        nobles: 0.04
    });

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

    function fail(reason, details) {
        return Object.assign(
            {
                ok: false,
                reason: reason
            },
            details || {}
        );
    }

    function laborTypes() {
        return (
            window.ArsSettlementLaborTypes ||
            null
        );
    }

    function populationState() {
        return (
            window.ArsSettlementPopulationState ||
            null
        );
    }

    function makeEmptyMap() {
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

    function normalizeMap(source) {
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

    function sumMap(source) {
        if (!isRecord(source)) {
            return 0;
        }

        return Object.keys(source)
            .reduce(
                function (total, key) {
                    return (
                        total +
                        nonNegative(
                            source[key]
                        )
                    );
                },
                0
            );
    }

    function addMap(target, source) {
        const labor =
            laborTypes();

        if (!labor) {
            return target;
        }

        const normalized =
            normalizeMap(source);

        labor.ids.forEach(
            function (jobId) {
                target[jobId] =
                    round(
                        nonNegative(
                            target[jobId]
                        ) +
                        nonNegative(
                            normalized[jobId]
                        ),
                        4
                    );
            }
        );

        return target;
    }

    function isKnownSourceId(sourceId) {
        const id =
            cleanId(sourceId);

        return (
            RESERVED_SOURCE_IDS
                .indexOf(id) !== -1 ||
            id.indexOf("event:") === 0 &&
            id.length > 6
        );
    }

    function getState(settlementId) {
        const stateApi =
            populationState();

        if (
            !stateApi ||
            typeof stateApi.getState !==
                "function"
        ) {
            return null;
        }

        return stateApi.getState(
            cleanId(settlementId)
        );
    }

    function replaceState(
        settlementId,
        state,
        action
    ) {
        const stateApi =
            populationState();

        if (
            !stateApi ||
            typeof stateApi.replaceState !==
                "function"
        ) {
            return fail(
                "population_state_api_missing"
            );
        }

        return stateApi.replaceState(
            cleanId(settlementId),
            state,
            action
        );
    }

    function ensureSettlement(
        settlementId
    ) {
        const stateApi =
            populationState();

        if (
            !stateApi ||
            typeof stateApi
                .ensureSettlementState !==
                "function"
        ) {
            return null;
        }

        return stateApi
            .ensureSettlementState(
                cleanId(settlementId)
            );
    }

    function listSettlementIds() {
        const stateApi =
            populationState();

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

    function normalizeSourceCollection(
        source
    ) {
        const input =
            isRecord(source)
                ? source
                : {};

        const result = {};

        Object.keys(input).forEach(
            function (sourceId) {
                const id =
                    cleanId(sourceId);

                if (
                    !id ||
                    !isKnownSourceId(id)
                ) {
                    return;
                }

                result[id] =
                    normalizeMap(
                        input[sourceId]
                    );
            }
        );

        if (!result.baseline) {
            result.baseline =
                makeEmptyMap();
        }

        return result;
    }

    function getJobSources(
        settlementId
    ) {
        const state =
            getState(
                settlementId
            );

        if (!state) {
            return null;
        }

        return normalizeSourceCollection(
            state.jobSources
        );
    }

    function setJobSource(
        settlementId,
        sourceId,
        jobs
    ) {
        const id =
            cleanId(sourceId);

        if (!isKnownSourceId(id)) {
            return fail(
                "unknown_job_source",
                {
                    sourceId: id
                }
            );
        }

        const state =
            getState(
                settlementId
            );

        if (!state) {
            return fail(
                "invalid_settlement"
            );
        }

        state.jobSources =
            normalizeSourceCollection(
                state.jobSources
            );

        const previous =
            clone(
                state.jobSources[id] ||
                makeEmptyMap()
            );

        state.jobSources[id] =
            normalizeMap(jobs);

        const saved =
            replaceState(
                settlementId,
                state,
                "set_job_source"
            );

        if (
            !saved ||
            !saved.ok
        ) {
            return saved;
        }

        return {
            ok: true,

            settlementId:
                cleanId(settlementId),

            sourceId:
                id,

            previous:
                previous,

            current:
                clone(
                    state.jobSources[id]
                ),

            revision:
                saved.revision
        };
    }

    function removeJobSource(
        settlementId,
        sourceId
    ) {
        const id =
            cleanId(sourceId);

        if (id === "baseline") {
            return fail(
                "baseline_removal_forbidden"
            );
        }

        if (!isKnownSourceId(id)) {
            return fail(
                "unknown_job_source",
                {
                    sourceId: id
                }
            );
        }

        const state =
            getState(
                settlementId
            );

        if (!state) {
            return fail(
                "invalid_settlement"
            );
        }

        state.jobSources =
            normalizeSourceCollection(
                state.jobSources
            );

        if (!state.jobSources[id]) {
            return {
                ok: true,
                removed: false,
                settlementId:
                    cleanId(settlementId),
                sourceId:
                    id,
                revision:
                    state.revision
            };
        }

        const previous =
            clone(
                state.jobSources[id]
            );

        delete state.jobSources[id];

        const saved =
            replaceState(
                settlementId,
                state,
                "remove_job_source"
            );

        if (
            !saved ||
            !saved.ok
        ) {
            return saved;
        }

        return {
            ok: true,
            removed: true,

            settlementId:
                cleanId(settlementId),

            sourceId:
                id,

            previous:
                previous,

            revision:
                saved.revision
        };
    }

    function totalJobs(
        settlementId
    ) {
        const sources =
            getJobSources(
                settlementId
            );

        if (!sources) {
            return null;
        }

        const total =
            makeEmptyMap();

        Object.keys(sources).forEach(
            function (sourceId) {
                addMap(
                    total,
                    sources[sourceId]
                );
            }
        );

        return normalizeMap(total);
    }

    function distributeIntegerTotal(
        totalValue,
        weights
    ) {
        const labor =
            laborTypes();

        const total =
            nonNegativeInteger(
                totalValue
            );

        const result =
            makeEmptyMap();

        if (
            !labor ||
            total <= 0
        ) {
            return result;
        }

        const fractions = [];
        let assigned = 0;

        labor.ids.forEach(
            function (jobId) {
                const exact =
                    total *
                    nonNegative(
                        weights[jobId]
                    );

                const whole =
                    Math.floor(exact);

                result[jobId] =
                    whole;

                assigned += whole;

                fractions.push({
                    jobId:
                        jobId,

                    fraction:
                        exact - whole
                });
            }
        );

        fractions.sort(
            function (left, right) {
                if (
                    right.fraction !==
                    left.fraction
                ) {
                    return (
                        right.fraction -
                        left.fraction
                    );
                }

                return labor.ids.indexOf(
                    left.jobId
                ) -
                labor.ids.indexOf(
                    right.jobId
                );
            }
        );

        let remaining =
            total - assigned;

        let index = 0;

        while (
            remaining > 0 &&
            fractions.length > 0
        ) {
            const target =
                fractions[
                    index %
                    fractions.length
                ];

            result[target.jobId] += 1;

            remaining -= 1;
            index += 1;
        }

        return result;
    }

    function normalizeWeights(source) {
        const labor =
            laborTypes();

        const input =
            isRecord(source)
                ? source
                : DEFAULT_SUPPLY_WEIGHTS;

        const result = {};
        let total = 0;

        if (!labor) {
            return result;
        }

        labor.ids.forEach(
            function (jobId) {
                result[jobId] =
                    nonNegative(
                        input[jobId]
                    );

                total +=
                    result[jobId];
            }
        );

        if (total <= 0) {
            labor.ids.forEach(
                function (jobId) {
                    result[jobId] =
                        nonNegative(
                            DEFAULT_SUPPLY_WEIGHTS[
                                jobId
                            ]
                        );
                }
            );

            total =
                sumMap(result);
        }

        labor.ids.forEach(
            function (jobId) {
                result[jobId] =
                    result[jobId] /
                    total;
            }
        );

        return result;
    }

    function calculateLaborSupply(
        settlementId,
        weights
    ) {
        const state =
            getState(
                settlementId
            );

        if (!state) {
            return null;
        }

        const workingAge =
            nonNegativeInteger(
                state.demographics &&
                state.demographics
                    .workingAge
            );

        const participationRate =
            clamp(
                state.labor &&
                state.labor
                    .participationRate,
                0,
                1
            );

        const workforce =
            Math.min(
                workingAge,
                Math.floor(
                    workingAge *
                    participationRate
                )
            );

        return {
            workforce:
                workforce,

            supplyByType:
                distributeIntegerTotal(
                    workforce,
                    normalizeWeights(
                        weights
                    )
                )
        };
    }



    function getSettlementType(settlementId) {
        const data = window.ArsWorldMapData;
        const source = data && data.settlements;
        const list = Array.isArray(source)
            ? source
            : isRecord(source)
                ? Object.values(source)
                : [];
        const id = cleanId(settlementId);
        const settlement = list.find(function (entry) {
            return entry && cleanId(entry.id) === id;
        });
        return cleanId(settlement && settlement.type) || "default";
    }

    function calculateBaselineJobs(settlementId) {
        const state = getState(settlementId);
        const result = makeEmptyMap();

        if (!state || nonNegativeInteger(state.current) === 0) {
            return result;
        }

        const population = nonNegativeInteger(state.current);
        const type = getSettlementType(settlementId);
        const multiplier = BASELINE_JOB_CONFIG.typeMultipliers[type] === undefined
            ? BASELINE_JOB_CONFIG.typeMultipliers.default
            : BASELINE_JOB_CONFIG.typeMultipliers[type];
        const total = Math.max(
            BASELINE_JOB_CONFIG.minimumJobs,
            Math.floor(population / BASELINE_JOB_CONFIG.populationDivisor * multiplier)
        );
        let assigned = 0;
        const ids = laborTypes().ids;

        ids.forEach(function (jobId, index) {
            if (index === ids.length - 1) {
                result[jobId] = Math.max(0, total - assigned);
                return;
            }
            const amount = Math.floor(total * nonNegative(BASELINE_JOB_CONFIG.shares[jobId]));
            result[jobId] = amount;
            assigned += amount;
        });

        return normalizeMap(result);
    }

    function calculateEmployment(
        settlementId,
        options
    ) {
        const state =
            getState(
                settlementId
            );

        const labor =
            laborTypes();

        if (
            !state ||
            !labor
        ) {
            return null;
        }

        const supply =
            calculateLaborSupply(
                settlementId,
                options &&
                options.supplyWeights
            );

        const jobs =
            totalJobs(
                settlementId
            );

        if (
            !supply ||
            !jobs
        ) {
            return null;
        }

        const employedByType =
            makeEmptyMap();

        const unemployedByType =
            makeEmptyMap();

        const vacanciesByType =
            makeEmptyMap();

        labor.ids.forEach(
            function (jobId) {
                const availableWorkers =
                    nonNegativeInteger(
                        supply
                            .supplyByType[
                            jobId
                        ]
                    );

                const availableJobs =
                    nonNegativeInteger(
                        jobs[jobId]
                    );

                const employed =
                    Math.min(
                        availableWorkers,
                        availableJobs
                    );

                employedByType[jobId] =
                    employed;

                unemployedByType[jobId] =
                    availableWorkers -
                    employed;

                vacanciesByType[jobId] =
                    availableJobs -
                    employed;
            }
        );

        const employed =
            nonNegativeInteger(
                sumMap(
                    employedByType
                )
            );

        const unemployed =
            nonNegativeInteger(
                sumMap(
                    unemployedByType
                )
            );

        const vacancies =
            nonNegativeInteger(
                sumMap(
                    vacanciesByType
                )
            );

        const workforce =
            supply.workforce;

        const totalJobCount =
            nonNegativeInteger(
                sumMap(jobs)
            );

        return {
            workforce:
                workforce,

            supplyByType:
                supply.supplyByType,

            jobsByType:
                jobs,

            employedByType:
                employedByType,

            unemployedByType:
                unemployedByType,

            vacanciesByType:
                vacanciesByType,

            employed:
                employed,

            unemployed:
                unemployed,

            unemploymentRate:
                workforce > 0
                    ? round(
                        unemployed /
                        workforce,
                        6
                    )
                    : 0,

            vacancies:
                vacancies,

            vacancyRate:
                totalJobCount > 0
                    ? round(
                        vacancies /
                        totalJobCount,
                        6
                    )
                    : 0
        };
    }

    function recalculate(
        settlementId,
        options
    ) {
        const id =
            cleanId(settlementId);

        let state =
            getState(id);

        if (!state) {
            return fail(
                "invalid_settlement"
            );
        }

        const baselineResult = setJobSource(
            id,
            "baseline",
            calculateBaselineJobs(id)
        );

        if (!baselineResult || !baselineResult.ok) {
            return fail(
                "baseline_job_update_failed",
                {
                    detail:
                        baselineResult || null
                }
            );
        }

        state =
            getState(id);

        if (!state) {
            return fail(
                "population_state_refresh_failed"
            );
        }

        const calculation =
            calculateEmployment(
                id,
                options
            );

        if (!calculation) {
            return fail(
                "labor_calculation_failed"
            );
        }

        state.labor = Object.assign(
            {},
            state.labor,
            calculation
        );

        const saved =
            replaceState(
                id,
                state,
                "recalculate_labor"
            );

        if (
            !saved ||
            !saved.ok
        ) {
            return saved;
        }

        return {
            ok: true,
            settlementId:
                id,

            labor:
                clone(
                    state.labor
                ),

            revision:
                saved.revision
        };
    }

    function recalculateAll(
        options
    ) {
        const results = {};

        listSettlementIds().forEach(
            function (settlementId) {
                results[settlementId] =
                    recalculate(
                        settlementId,
                        options
                    );
            }
        );

        return results;
    }

    function setParticipationRate(
        settlementId,
        rate
    ) {
        const state =
            getState(
                settlementId
            );

        if (!state) {
            return fail(
                "invalid_settlement"
            );
        }

        const previous =
            state
                .labor
                .participationRate;

        state
            .labor
            .participationRate =
                clamp(
                    rate,
                    0,
                    1
                );

        const saved =
            replaceState(
                settlementId,
                state,
                "set_labor_participation_rate"
            );

        if (
            !saved ||
            !saved.ok
        ) {
            return saved;
        }

        return {
            ok: true,

            settlementId:
                cleanId(settlementId),

            previous:
                previous,

            current:
                state
                    .labor
                    .participationRate,

            revision:
                saved.revision
        };
    }

    function getSnapshot(
        settlementId
    ) {
        const state =
            getState(
                settlementId
            );

        if (!state) {
            return null;
        }

        return {
            settlementId:
                cleanId(settlementId),

            labor:
                clone(
                    state.labor
                ),

            jobSources:
                clone(
                    normalizeSourceCollection(
                        state.jobSources
                    )
                ),

            totalJobs:
                totalJobs(
                    settlementId
                )
        };
    }

    function validateSettlement(
        settlementId
    ) {
        const state =
            getState(
                settlementId
            );

        const labor =
            laborTypes();

        const errors = [];

        if (!state) {
            errors.push(
                cleanId(settlementId) +
                ": 인구 상태 없음"
            );

            return errors;
        }

        if (!labor) {
            errors.push(
                "ArsSettlementLaborTypes가 없습니다."
            );

            return errors;
        }

        const sources =
            normalizeSourceCollection(
                state.jobSources
            );

        if (!sources.baseline) {
            errors.push(
                settlementId +
                ": baseline 일자리 없음"
            );
        }

        Object.keys(sources).forEach(
            function (sourceId) {
                if (
                    !isKnownSourceId(
                        sourceId
                    )
                ) {
                    errors.push(
                        settlementId +
                        ": 알 수 없는 일자리 출처 " +
                        sourceId
                    );
                }

                Object.keys(
                    sources[sourceId]
                ).forEach(
                    function (jobId) {
                        if (
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

        const summed =
            totalJobs(
                settlementId
            );

        const expected =
            makeEmptyMap();

        Object.keys(sources).forEach(
            function (sourceId) {
                addMap(
                    expected,
                    sources[sourceId]
                );
            }
        );

        labor.ids.forEach(
            function (jobId) {
                if (
                    round(
                        summed[jobId],
                        4
                    ) !==
                    round(
                        expected[jobId],
                        4
                    )
                ) {
                    errors.push(
                        settlementId +
                        ": 일자리 합산 오류 " +
                        jobId
                    );
                }
            }
        );

        return errors;
    }

    function validateAll() {
        const errors = [];

        if (!populationState()) {
            errors.push(
                "ArsSettlementPopulationState가 없습니다."
            );
        }

        if (!laborTypes()) {
            errors.push(
                "ArsSettlementLaborTypes가 없습니다."
            );
        }

        listSettlementIds().forEach(
            function (settlementId) {
                validateSettlement(
                    settlementId
                ).forEach(
                    function (error) {
                        errors.push(error);
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
                "[Ars Bellum] 거점 노동 상태: " +
                id
            );

            console.log(
                snapshot
            );

            console.table(
                snapshot
                    ? snapshot.totalJobs
                    : {}
            );

            console.log(
                "검사 오류:",
                validateSettlement(id)
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

                    return {
                        settlementId:
                            currentId,

                        workforce:
                            snapshot
                                ? snapshot
                                    .labor
                                    .workforce
                                : 0,

                        jobs:
                            snapshot
                                ? sumMap(
                                    snapshot.totalJobs
                                )
                                : 0,

                        employed:
                            snapshot
                                ? snapshot
                                    .labor
                                    .employed
                                : 0,

                        unemployed:
                            snapshot
                                ? snapshot
                                    .labor
                                    .unemployed
                                : 0,

                        vacancies:
                            snapshot
                                ? snapshot
                                    .labor
                                    .vacancies
                                : 0
                    };
                }
            );

        console.group(
            "[Ars Bellum] 전체 노동 상태"
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

    window.ArsSettlementLaborSystem =
        Object.freeze({
            version:
                VERSION,

            reservedSourceIds:
                RESERVED_SOURCE_IDS,

            baselineJobConfig:
                BASELINE_JOB_CONFIG,

            calculateBaselineJobs:
                calculateBaselineJobs,

            ensureSettlement:
                ensureSettlement,

            listSettlementIds:
                listSettlementIds,

            getJobSources:
                getJobSources,

            setJobSource:
                setJobSource,

            removeJobSource:
                removeJobSource,

            totalJobs:
                totalJobs,

            calculateLaborSupply:
                calculateLaborSupply,

            calculateEmployment:
                calculateEmployment,

            recalculate:
                recalculate,

            recalculateAll:
                recalculateAll,

            setParticipationRate:
                setParticipationRate,

            getSnapshot:
                getSnapshot,

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
            "[Ars Bellum] SettlementLaborSystem 검사 실패:",
            errors
        );
    } else {
        console.log(
            "[Ars Bellum] SettlementLaborSystem 연결 완료"
        );
    }
})();