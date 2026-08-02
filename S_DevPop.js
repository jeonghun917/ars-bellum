// ============================================================
// Ars Bellum - S_DevPop.js
// 개발 시스템의 계산 결과를 인구 시스템에 전달하는 연결 전용 파일.
//
// 반영 대상:
// - housingCapacity -> effectiveCapacity
// - building jobs -> "buildings" 일자리 출처
//
// 직접 상태를 저장하지 않는다.
// WorldMapData를 수정하지 않는다.
// GameClock을 구독하지 않는다.
//
// 선행:
// - S_DevEffects.js
// - S_Pop.js
// ============================================================
(function () {
    "use strict";

    const VERSION = 2;
    const BUILDING_JOB_SOURCE_ID = "buildings";

    const LISTENERS = new Set();
    const LAST_SYNC = new Map();

    let developmentUnsubscribe = null;

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

    function positiveInteger(value, fallback) {
        return Math.max(
            1,
            Math.floor(
                finite(value, fallback)
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

    function developmentEffects() {
        return (
            window.ArsSettlementDevelopmentEffects ||
            null
        );
    }

    function populationSystem() {
        return (
            window.ArsSettlementPopulation ||
            null
        );
    }

    function laborTypes() {
        return (
            window.ArsSettlementLaborTypes ||
            null
        );
    }

    function emit(action, settlementId, payload) {
        const event = {
            type:
                "development_population_bridge",

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
                        "[Ars Bellum] 개발-인구 브리지 구독자 오류:",
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

    function makeEmptyJobMap() {
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

    function getDevelopmentSnapshot(
        settlementId,
        forceRefresh
    ) {
        const effectsApi =
            developmentEffects();

        if (!effectsApi) {
            return null;
        }

        if (
            forceRefresh === true &&
            typeof effectsApi
                .refreshSettlement ===
                "function"
        ) {
            return effectsApi
                .refreshSettlement(
                    cleanId(settlementId),
                    true
                );
        }

        if (
            typeof effectsApi.getSnapshot ===
                "function"
        ) {
            return effectsApi
                .getSnapshot(
                    cleanId(settlementId)
                );
        }

        return null;
    }

    function getPopulationSnapshot(
        settlementId
    ) {
        const population =
            populationSystem();

        if (
            !population ||
            typeof population.getSnapshot !==
                "function"
        ) {
            return null;
        }

        return population.getSnapshot(
            cleanId(settlementId)
        );
    }

    function listSettlementIds() {
        const population =
            populationSystem();

        if (
            !population ||
            typeof population.listSettlementIds !==
                "function"
        ) {
            return [];
        }

        return (
            population.listSettlementIds() ||
            []
        );
    }

    function calculateCapacity(
        settlementId,
        developmentSnapshot,
        populationSnapshot
    ) {
        const population =
            populationSnapshot ||
            getPopulationSnapshot(
                settlementId
            );

        const development =
            developmentSnapshot ||
            getDevelopmentSnapshot(
                settlementId,
                false
            );

        if (
            !population ||
            !development
        ) {
            return null;
        }

        const baseCapacity =
            positiveInteger(
                population.baseCapacity,
                1
            );

        const housingCapacity =
            nonNegative(
                development.effects &&
                development.effects
                    .housingCapacity
            );

        return {
            baseCapacity:
                baseCapacity,

            housingCapacity:
                round(
                    housingCapacity,
                    4
                ),

            effectiveCapacity:
                positiveInteger(
                    baseCapacity +
                    housingCapacity,
                    baseCapacity
                )
        };
    }

    function calculateBuildingJobs(
        settlementId,
        developmentSnapshot
    ) {
        const development =
            developmentSnapshot ||
            getDevelopmentSnapshot(
                settlementId,
                false
            );

        if (!development) {
            return null;
        }

        return normalizeJobMap(
            development.jobs ||
            makeEmptyJobMap()
        );
    }

    function jobMapsEqual(
        leftSource,
        rightSource
    ) {
        const labor =
            laborTypes();

        if (!labor) {
            return false;
        }

        const left =
            normalizeJobMap(
                leftSource
            );

        const right =
            normalizeJobMap(
                rightSource
            );

        return labor.ids.every(
            function (jobId) {
                return (
                    round(
                        left[jobId],
                        4
                    ) ===
                    round(
                        right[jobId],
                        4
                    )
                );
            }
        );
    }

    function syncCapacity(
        settlementId,
        developmentSnapshot,
        populationSnapshot
    ) {
        const id =
            cleanId(settlementId);

        const population =
            populationSystem();

        if (
            !population ||
            typeof population.setCapacity !==
                "function"
        ) {
            return fail(
                "population_system_api_missing"
            );
        }

        const currentPopulation =
            populationSnapshot ||
            getPopulationSnapshot(id);

        const calculation =
            calculateCapacity(
                id,
                developmentSnapshot,
                currentPopulation
            );

        if (
            !currentPopulation ||
            !calculation
        ) {
            return fail(
                "capacity_calculation_failed"
            );
        }

        if (
            positiveInteger(
                currentPopulation
                    .effectiveCapacity,
                1
            ) ===
            calculation.effectiveCapacity
        ) {
            return {
                ok: true,
                changed: false,

                settlementId:
                    id,

                baseCapacity:
                    calculation.baseCapacity,

                housingCapacity:
                    calculation.housingCapacity,

                effectiveCapacity:
                    calculation.effectiveCapacity
            };
        }

        const result =
            population.setCapacity(
                id,
                calculation
                    .effectiveCapacity
            );

        if (
            !result ||
            !result.ok
        ) {
            return fail(
                "capacity_sync_failed",
                {
                    detail:
                        result || null
                }
            );
        }

        return {
            ok: true,
            changed: true,

            settlementId:
                id,

            baseCapacity:
                calculation.baseCapacity,

            housingCapacity:
                calculation.housingCapacity,

            previousCapacity:
                currentPopulation
                    .effectiveCapacity,

            effectiveCapacity:
                calculation
                    .effectiveCapacity,

            revision:
                result.revision
        };
    }

    function syncBuildingJobs(
        settlementId,
        developmentSnapshot,
        populationSnapshot
    ) {
        const id =
            cleanId(settlementId);

        const population =
            populationSystem();

        if (
            !population ||
            typeof population.setJobSource !==
                "function"
        ) {
            return fail(
                "population_system_api_missing"
            );
        }

        const currentPopulation =
            populationSnapshot ||
            getPopulationSnapshot(id);

        const jobs =
            calculateBuildingJobs(
                id,
                developmentSnapshot
            );

        if (
            !currentPopulation ||
            !jobs
        ) {
            return fail(
                "building_jobs_calculation_failed"
            );
        }

        const currentJobs =
            currentPopulation.jobSources &&
            currentPopulation.jobSources[
                BUILDING_JOB_SOURCE_ID
            ]
                ? currentPopulation.jobSources[
                    BUILDING_JOB_SOURCE_ID
                ]
                : makeEmptyJobMap();

        if (
            jobMapsEqual(
                currentJobs,
                jobs
            )
        ) {
            return {
                ok: true,
                changed: false,

                settlementId:
                    id,

                sourceId:
                    BUILDING_JOB_SOURCE_ID,

                jobs:
                    clone(jobs)
            };
        }

        const result =
            population.setJobSource(
                id,
                BUILDING_JOB_SOURCE_ID,
                jobs
            );

        if (
            !result ||
            !result.ok
        ) {
            return fail(
                "building_jobs_sync_failed",
                {
                    detail:
                        result || null
                }
            );
        }

        return {
            ok: true,
            changed: true,

            settlementId:
                id,

            sourceId:
                BUILDING_JOB_SOURCE_ID,

            previous:
                clone(currentJobs),

            jobs:
                clone(jobs),

            revision:
                result.revision
        };
    }

    function recalculateLabor(
        settlementId
    ) {
        const population =
            populationSystem();

        if (
            !population ||
            typeof population.recalculateLabor !==
                "function"
        ) {
            return fail(
                "population_system_api_missing"
            );
        }

        const result =
            population.recalculateLabor(
                cleanId(settlementId)
            );

        if (
            !result ||
            !result.ok
        ) {
            return fail(
                "labor_recalculation_failed",
                {
                    detail:
                        result || null
                }
            );
        }

        return result;
    }

    function syncSettlement(
        settlementId,
        options
    ) {
        const id =
            cleanId(settlementId);

        if (!id) {
            return fail(
                "invalid_settlement"
            );
        }

        const settings =
            isRecord(options)
                ? options
                : {};

        const developmentSnapshot =
            getDevelopmentSnapshot(
                id,
                settings.forceRefresh === true
            );

        const populationSnapshot =
            getPopulationSnapshot(id);

        if (!developmentSnapshot) {
            return fail(
                "development_snapshot_missing"
            );
        }

        if (!populationSnapshot) {
            return fail(
                "population_snapshot_missing"
            );
        }

        const sourceRevision =
            Math.max(
                0,
                Math.floor(
                    finite(
                        developmentSnapshot
                            .sourceRevision,
                        0
                    )
                )
            );

        const previousSync =
            LAST_SYNC.get(id);

        const currentBaseCapacity = positiveInteger(populationSnapshot.baseCapacity, 1);
        const currentJobs = calculateBuildingJobs(id, developmentSnapshot) || makeEmptyJobMap();
        const currentJobSignature = JSON.stringify(normalizeJobMap(currentJobs));

        if (
            settings.force !== true &&
            previousSync &&
            previousSync.sourceRevision === sourceRevision &&
            previousSync.baseCapacity === currentBaseCapacity &&
            previousSync.jobSignature === currentJobSignature
        ) {
            return {
                ok: true,
                changed: false,
                skipped: true,
                reason: "relevant_inputs_unchanged",
                settlementId: id,
                sourceRevision: sourceRevision,
                baseCapacity: currentBaseCapacity,
                previousSync: clone(previousSync)
            };
        }

        const capacityResult =
            syncCapacity(
                id,
                developmentSnapshot,
                populationSnapshot
            );

        if (
            !capacityResult ||
            !capacityResult.ok
        ) {
            return fail(
                "capacity_sync_failed",
                {
                    detail:
                        capacityResult ||
                        null
                }
            );
        }

        const updatedPopulation =
            getPopulationSnapshot(id);

        const jobsResult =
            syncBuildingJobs(
                id,
                developmentSnapshot,
                updatedPopulation
            );

        if (
            !jobsResult ||
            !jobsResult.ok
        ) {
            return fail(
                "building_jobs_sync_failed",
                {
                    detail:
                        jobsResult ||
                        null
                }
            );
        }

        let laborResult = {
            ok: true,
            skipped: true
        };

        if (
            settings.recalculateLabor !==
            false
        ) {
            laborResult =
                recalculateLabor(id);

            if (
                !laborResult ||
                !laborResult.ok
            ) {
                return fail(
                    "labor_recalculation_failed",
                    {
                        detail:
                            laborResult ||
                            null
                    }
                );
            }
        }

        const changed =
            capacityResult.changed === true ||
            jobsResult.changed === true;

        const syncRecord = {
            sourceRevision:
                sourceRevision,

            baseCapacity:
                currentBaseCapacity,

            jobSignature:
                currentJobSignature,

            populationRevision:
                getPopulationSnapshot(id)
                    ? getPopulationSnapshot(id)
                        .revision
                    : 0,

            housingCapacity:
                capacityResult
                    .housingCapacity,

            effectiveCapacity:
                capacityResult
                    .effectiveCapacity,

            jobs:
                clone(
                    jobsResult.jobs
                )
        };

        LAST_SYNC.set(
            id,
            syncRecord
        );

        const result = {
            ok: true,
            changed:
                changed,
            skipped:
                false,

            settlementId:
                id,

            sourceRevision:
                sourceRevision,

            capacity:
                capacityResult,

            jobs:
                jobsResult,

            labor:
                laborResult,

            snapshot:
                getPopulationSnapshot(id)
        };

        emit(
            "settlement_synchronized",
            id,
            result
        );

        return result;
    }

    function syncAll(options) {
        const results = [];

        listSettlementIds().forEach(
            function (settlementId) {
                results.push({
                    settlementId:
                        settlementId,

                    result:
                        syncSettlement(
                            settlementId,
                            options
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

            changed:
                results.filter(
                    function (entry) {
                        return (
                            entry.result &&
                            entry.result.changed ===
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

    function invalidate(settlementId) {
        const id =
            cleanId(settlementId);

        if (!id) {
            LAST_SYNC.clear();

            return {
                ok: true,
                all: true
            };
        }

        return {
            ok: true,
            all: false,
            settlementId:
                id,
            removed:
                LAST_SYNC.delete(id)
        };
    }

    function getLastSync(
        settlementId
    ) {
        const record =
            LAST_SYNC.get(
                cleanId(settlementId)
            );

        return record
            ? clone(record)
            : null;
    }

    function bindDevelopmentEvents() {
        const effectsApi =
            developmentEffects();

        if (developmentUnsubscribe) {
            return {
                ok: true,
                bound: true,
                alreadyBound: true
            };
        }

        if (
            !effectsApi ||
            typeof effectsApi.subscribe !==
                "function"
        ) {
            return fail(
                "development_effects_api_missing"
            );
        }

        developmentUnsubscribe =
            effectsApi.subscribe(
                function (event) {
                    if (
                        !event ||
                        event.type !==
                            "development_effects_refreshed"
                    ) {
                        return;
                    }

                    const settlementId =
                        cleanId(
                            event.settlementId
                        );

                    if (!settlementId) {
                        return;
                    }

                    syncSettlement(
                        settlementId,
                        {
                            force: true,
                            forceRefresh: false,
                            recalculateLabor: true
                        }
                    );
                }
            );

        return {
            ok: true,
            bound: true,
            alreadyBound: false
        };
    }

    function unbindDevelopmentEvents() {
        if (!developmentUnsubscribe) {
            return {
                ok: true,
                bound: false,
                changed: false
            };
        }

        developmentUnsubscribe();
        developmentUnsubscribe = null;

        return {
            ok: true,
            bound: false,
            changed: true
        };
    }

    function validateSettlement(
        settlementId
    ) {
        const id =
            cleanId(settlementId);

        const errors = [];

        const development =
            getDevelopmentSnapshot(
                id,
                false
            );

        const population =
            getPopulationSnapshot(id);

        if (!development) {
            errors.push(
                id +
                ": 개발 효과 상태 없음"
            );

            return errors;
        }

        if (!population) {
            errors.push(
                id +
                ": 인구 상태 없음"
            );

            return errors;
        }

        const expectedCapacity =
            calculateCapacity(
                id,
                development,
                population
            );

        if (
            expectedCapacity &&
            positiveInteger(
                population
                    .effectiveCapacity,
                1
            ) !==
            expectedCapacity
                .effectiveCapacity
        ) {
            errors.push(
                id +
                ": 주거 수용량 미반영"
            );
        }

        const expectedJobs =
            calculateBuildingJobs(
                id,
                development
            );

        const actualJobs =
            population.jobSources &&
            population.jobSources[
                BUILDING_JOB_SOURCE_ID
            ]
                ? population.jobSources[
                    BUILDING_JOB_SOURCE_ID
                ]
                : makeEmptyJobMap();

        if (
            expectedJobs &&
            !jobMapsEqual(
                expectedJobs,
                actualJobs
            )
        ) {
            errors.push(
                id +
                ": 건물 일자리 미반영"
            );
        }

        return errors;
    }

    function validateAll() {
        const errors = [];

        if (!developmentEffects()) {
            errors.push(
                "ArsSettlementDevelopmentEffects가 없습니다."
            );
        }

        if (!populationSystem()) {
            errors.push(
                "ArsSettlementPopulation이 없습니다."
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
            const result = {
                settlementId:
                    id,

                development:
                    getDevelopmentSnapshot(
                        id,
                        false
                    ),

                population:
                    getPopulationSnapshot(id),

                lastSync:
                    getLastSync(id),

                errors:
                    validateSettlement(id)
            };

            console.group(
                "[Ars Bellum] 개발-인구 브리지: " +
                id
            );

            console.log(result);
            console.groupEnd();

            return result;
        }

        const summary =
            listSettlementIds().map(
                function (currentId) {
                    const development =
                        getDevelopmentSnapshot(
                            currentId,
                            false
                        );

                    const population =
                        getPopulationSnapshot(
                            currentId
                        );

                    const expected =
                        development &&
                        population
                            ? calculateCapacity(
                                currentId,
                                development,
                                population
                            )
                            : null;

                    return {
                        settlementId:
                            currentId,

                        sourceRevision:
                            development
                                ? development
                                    .sourceRevision
                                : 0,

                        housingCapacity:
                            expected
                                ? expected
                                    .housingCapacity
                                : 0,

                        effectiveCapacity:
                            population
                                ? population
                                    .effectiveCapacity
                                : 0,

                        expectedCapacity:
                            expected
                                ? expected
                                    .effectiveCapacity
                                : 0,

                        synchronized:
                            validateSettlement(
                                currentId
                            ).length === 0
                    };
                }
            );

        console.group(
            "[Ars Bellum] 전체 개발-인구 브리지"
        );

        console.table(summary);

        console.log(
            "검사 오류:",
            validateAll()
        );

        console.groupEnd();

        return summary;
    }

    window.ArsSettlementDevelopmentPopulationBridge =
        Object.freeze({
            version:
                VERSION,

            buildingJobSourceId:
                BUILDING_JOB_SOURCE_ID,

            calculateCapacity:
                calculateCapacity,

            calculateBuildingJobs:
                calculateBuildingJobs,

            syncCapacity:
                syncCapacity,

            syncBuildingJobs:
                syncBuildingJobs,

            syncSettlement:
                syncSettlement,

            syncAll:
                syncAll,

            invalidate:
                invalidate,

            getLastSync:
                getLastSync,

            bindDevelopmentEvents:
                bindDevelopmentEvents,

            unbindDevelopmentEvents:
                unbindDevelopmentEvents,

            subscribe:
                subscribe,

            validateSettlement:
                validateSettlement,

            validateAll:
                validateAll,

            debugPrint:
                debugPrint
        });

    const bindResult =
        bindDevelopmentEvents();

    if (
        !bindResult ||
        !bindResult.ok
    ) {
        console.error(
            "[Ars Bellum] SettlementDevelopmentPopulationBridge 이벤트 연결 실패:",
            bindResult
        );
    }

    const syncResult =
        syncAll({
            force: true,
            forceRefresh: false,
            recalculateLabor: true
        });

    if (!syncResult.ok) {
        console.error(
            "[Ars Bellum] SettlementDevelopmentPopulationBridge 초기 동기화 실패:",
            syncResult
        );
    } else {
        console.log(
            "[Ars Bellum] SettlementDevelopmentPopulationBridge 연결 완료"
        );
    }
})();