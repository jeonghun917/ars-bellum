// ============================================================
// Ars Bellum - S_Pop.js
// 거점 인구 시스템 공개 파사드.
//
// 상태 저장:
//   ArsSettlementPopulationState
//
// 노동 계산:
//   ArsSettlementLaborSystem
//
// 인구 변동:
//   ArsSettlementDemographySystem
//
// WorldMapData의 동적 값을 수정하지 않는다.
// GameClock을 직접 구독하지 않는다.
// 일일 실행은 SettlementEconomySimulation.js가 호출한다.
// ============================================================
(function () {
    "use strict";

    const VERSION = 3;
    const LISTENERS = new Set();

    let stateUnsubscribe = null;

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

    function fail(reason, details) {
        return Object.assign(
            {
                ok: false,
                reason: reason
            },
            details || {}
        );
    }

    function stateSystem() {
        return (
            window.ArsSettlementPopulationState ||
            null
        );
    }

    function laborSystem() {
        return (
            window.ArsSettlementLaborSystem ||
            null
        );
    }

    function demographySystem() {
        return (
            window.ArsSettlementDemographySystem ||
            null
        );
    }

    function laborTypes() {
        return (
            window.ArsSettlementLaborTypes ||
            null
        );
    }

    function worldMapData() {
        return (
            window.ArsWorldMapData ||
            null
        );
    }

    function getWorldSettlementIds() {
        const data =
            worldMapData();

        if (
            !data ||
            !data.settlements
        ) {
            return [];
        }

        const source =
            data.settlements;

        const entries =
            Array.isArray(source)
                ? source
                : isRecord(source)
                    ? Object.values(source)
                    : [];

        return entries
            .map(function (entry) {
                return cleanId(
                    entry &&
                    entry.id
                );
            })
            .filter(Boolean);
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
                        "[Ars Bellum] 인구 파사드 구독자 오류:",
                        error
                    );
                }
            }
        );
    }

    function bindStateEvents() {
        const stateApi =
            stateSystem();

        if (
            stateUnsubscribe ||
            !stateApi ||
            typeof stateApi.subscribe !==
                "function"
        ) {
            return false;
        }

        stateUnsubscribe =
            stateApi.subscribe(
                function (event) {
                    emit({
                        type:
                            "settlement_population",

                        action:
                            event.action,

                        settlementId:
                            event.settlementId,

                        revision:
                            event.revision,

                        payload:
                            clone(
                                event.payload ||
                                {}
                            )
                    });
                }
            );

        return true;
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

    function initializeFromWorldData() {
        const stateApi =
            stateSystem();

        if (
            !stateApi ||
            typeof stateApi
                .ensureSettlementState !==
                "function"
        ) {
            return [];
        }

        const initialized = [];

        getWorldSettlementIds().forEach(
            function (settlementId) {
                const state =
                    stateApi
                        .ensureSettlementState(
                            settlementId
                        );

                if (state) {
                    initialized.push(
                        settlementId
                    );
                }
            }
        );

        bindStateEvents();

        return initialized;
    }

    function ensureSettlementState(
        settlementId
    ) {
        const stateApi =
            stateSystem();

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
            stateSystem();

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

    function getState(settlementId) {
        const stateApi =
            stateSystem();

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

    function getSnapshot(settlementId) {
        const id =
            cleanId(settlementId);

        const state =
            getState(id);

        if (!state) {
            return null;
        }

        const laborApi =
            laborSystem();

        return {
            settlementId:
                id,

            current:
                state.current,

            baseCapacity:
                state.baseCapacity,

            effectiveCapacity:
                state.effectiveCapacity,

            demographics:
                clone(
                    state.demographics
                ),

            labor:
                clone(
                    state.labor
                ),

            conditions:
                clone(
                    state.conditions
                ),

            conditionOverrides:
                clone(
                    state.conditionOverrides
                ),

            migration:
                clone(
                    state.migration
                ),

            naturalChange:
                clone(
                    state.naturalChange
                ),

            jobSources:
                clone(
                    state.jobSources
                ),

            totalJobs:
                laborApi &&
                typeof laborApi.totalJobs ===
                    "function"
                    ? laborApi.totalJobs(id)
                    : null,

            revision:
                state.revision,

            lastProcessedDay:
                state.lastProcessedDay
        };
    }

    function getPopulation(settlementId) {
        const state =
            getState(settlementId);

        return state
            ? state.current
            : 0;
    }

    function setPopulation(
        settlementId,
        amount
    ) {
        const stateApi =
            stateSystem();

        if (
            !stateApi ||
            typeof stateApi.setCurrent !==
                "function"
        ) {
            return fail(
                "population_state_api_missing"
            );
        }

        return stateApi.setCurrent(
            cleanId(settlementId),
            nonNegativeInteger(amount)
        );
    }

    function adjustPopulation(
        settlementId,
        amount
    ) {
        const state =
            getState(settlementId);

        if (!state) {
            return fail(
                "invalid_settlement"
            );
        }

        return setPopulation(
            settlementId,
            state.current +
            finite(amount, 0)
        );
    }

    function getBaseCapacity(settlementId) {
        const state =
            getState(settlementId);

        return state
            ? state.baseCapacity
            : 0;
    }

    function getCapacity(settlementId) {
        const state =
            getState(settlementId);

        return state
            ? state.effectiveCapacity
            : 0;
    }

    function setBaseCapacity(
        settlementId,
        amount
    ) {
        const stateApi =
            stateSystem();

        if (
            !stateApi ||
            typeof stateApi
                .setBaseCapacity !==
                "function"
        ) {
            return fail(
                "population_state_api_missing"
            );
        }

        return stateApi.setBaseCapacity(
            cleanId(settlementId),
            positiveInteger(
                amount,
                1
            )
        );
    }

    function setCapacity(
        settlementId,
        amount
    ) {
        const stateApi =
            stateSystem();

        if (
            !stateApi ||
            typeof stateApi
                .setEffectiveCapacity !==
                "function"
        ) {
            return fail(
                "population_state_api_missing"
            );
        }

        return stateApi
            .setEffectiveCapacity(
                cleanId(settlementId),
                positiveInteger(
                    amount,
                    1
                )
            );
    }

    function setDemographics(
        settlementId,
        demographics
    ) {
        const stateApi =
            stateSystem();

        const state =
            getState(settlementId);

        if (
            !stateApi ||
            typeof stateApi.replaceState !==
                "function" ||
            !state ||
            !isRecord(demographics)
        ) {
            return fail(
                "invalid_demographics"
            );
        }

        const children =
            nonNegativeInteger(
                demographics.children
            );

        const workingAge =
            nonNegativeInteger(
                demographics.workingAge
            );

        const elderly =
            nonNegativeInteger(
                demographics.elderly
            );

        state.demographics = {
            children:
                children,

            workingAge:
                workingAge,

            elderly:
                elderly
        };

        state.current =
            children +
            workingAge +
            elderly;

        return stateApi.replaceState(
            cleanId(settlementId),
            state,
            "set_demographics"
        );
    }

    function setCondition(
        settlementId,
        conditionId,
        value
    ) {
        const stateApi =
            stateSystem();

        const state =
            getState(settlementId);

        const id =
            cleanId(conditionId);

        const knownConditions = [
            "foodSatisfaction",
            "health",
            "security",
            "prosperity"
        ];

        if (
            !stateApi ||
            typeof stateApi.replaceState !==
                "function" ||
            !state
        ) {
            return fail(
                "invalid_settlement"
            );
        }

        if (
            knownConditions.indexOf(id) ===
            -1
        ) {
            return fail(
                "unknown_condition",
                {
                    conditionId:
                        id
                }
            );
        }

        const previous =
            state.conditions[id];

        state.conditions[id] =
            clamp(
                value,
                0,
                1
            );

        const saved =
            stateApi.replaceState(
                cleanId(settlementId),
                state,
                "set_population_condition"
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

            conditionId:
                id,

            previous:
                previous,

            current:
                state.conditions[id],

            revision:
                saved.revision
        };
    }

    function setConditionOverride(
        settlementId,
        conditionId,
        value
    ) {
        const stateApi =
            stateSystem();

        const state =
            getState(settlementId);

        const id =
            cleanId(conditionId);

        const knownConditions = [
            "foodSatisfaction",
            "health",
            "security",
            "prosperity"
        ];

        if (
            !stateApi ||
            typeof stateApi.replaceState !==
                "function" ||
            !state
        ) {
            return fail(
                "invalid_settlement"
            );
        }

        if (
            knownConditions.indexOf(id) ===
            -1
        ) {
            return fail(
                "unknown_condition",
                {
                    conditionId:
                        id
                }
            );
        }

        state.conditionOverrides[id] =
            clamp(
                value,
                0,
                1
            );

        return stateApi.replaceState(
            cleanId(settlementId),
            state,
            "set_condition_override"
        );
    }

    function clearConditionOverride(
        settlementId,
        conditionId
    ) {
        const stateApi =
            stateSystem();

        const state =
            getState(settlementId);

        const id =
            cleanId(conditionId);

        if (
            !stateApi ||
            typeof stateApi.replaceState !==
                "function" ||
            !state
        ) {
            return fail(
                "invalid_settlement"
            );
        }

        if (
            !Object.prototype
                .hasOwnProperty.call(
                    state.conditionOverrides,
                    id
                )
        ) {
            return {
                ok: true,
                removed: false,
                settlementId:
                    cleanId(settlementId),
                conditionId:
                    id,
                revision:
                    state.revision
            };
        }

        delete state.conditionOverrides[id];

        const saved =
            stateApi.replaceState(
                cleanId(settlementId),
                state,
                "clear_condition_override"
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
            conditionId:
                id,
            revision:
                saved.revision
        };
    }

    function getJobSources(settlementId) {
        const laborApi =
            laborSystem();

        if (
            !laborApi ||
            typeof laborApi.getJobSources !==
                "function"
        ) {
            return null;
        }

        return laborApi.getJobSources(
            cleanId(settlementId)
        );
    }

    function setJobSource(
        settlementId,
        sourceId,
        jobs
    ) {
        const laborApi =
            laborSystem();

        if (
            !laborApi ||
            typeof laborApi.setJobSource !==
                "function"
        ) {
            return fail(
                "labor_system_api_missing"
            );
        }

        return laborApi.setJobSource(
            cleanId(settlementId),
            cleanId(sourceId),
            jobs
        );
    }

    function removeJobSource(
        settlementId,
        sourceId
    ) {
        const laborApi =
            laborSystem();

        if (
            !laborApi ||
            typeof laborApi.removeJobSource !==
                "function"
        ) {
            return fail(
                "labor_system_api_missing"
            );
        }

        return laborApi.removeJobSource(
            cleanId(settlementId),
            cleanId(sourceId)
        );
    }

    function totalJobs(settlementId) {
        const laborApi =
            laborSystem();

        if (
            !laborApi ||
            typeof laborApi.totalJobs !==
                "function"
        ) {
            return null;
        }

        return laborApi.totalJobs(
            cleanId(settlementId)
        );
    }

    function recalculateLabor(
        settlementId,
        options
    ) {
        const laborApi =
            laborSystem();

        if (
            !laborApi ||
            typeof laborApi.recalculate !==
                "function"
        ) {
            return fail(
                "labor_system_api_missing"
            );
        }

        return laborApi.recalculate(
            cleanId(settlementId),
            options
        );
    }

    function setParticipationRate(
        settlementId,
        rate
    ) {
        const laborApi =
            laborSystem();

        if (
            !laborApi ||
            typeof laborApi
                .setParticipationRate !==
                "function"
        ) {
            return fail(
                "labor_system_api_missing"
            );
        }

        return laborApi
            .setParticipationRate(
                cleanId(settlementId),
                rate
            );
    }

    function setPendingMigration(
        settlementId,
        inflow,
        outflow
    ) {
        const demography =
            demographySystem();

        if (
            !demography ||
            typeof demography
                .setPendingMigration !==
                "function"
        ) {
            return fail(
                "demography_system_api_missing"
            );
        }

        return demography
            .setPendingMigration(
                cleanId(settlementId),
                inflow,
                outflow
            );
    }



    function processDemographyDay(settlementId, dayValue, options) {
        const demography = demographySystem();
        if (!demography || typeof demography.processSettlementDay !== "function") {
            return fail("demography_system_api_missing");
        }
        return demography.processSettlementDay(
            cleanId(settlementId),
            positiveInteger(dayValue, 1),
            options
        );
    }

    // 호환용 통합 처리. 중앙 Simulation에서는 recalculateLabor()와 processDemographyDay()를 분리 호출한다.
    function processSettlementDay(
        settlementId,
        dayValue,
        options
    ) {
        const id =
            cleanId(settlementId);

        const day =
            positiveInteger(
                dayValue,
                1
            );

        const state =
            getState(id);

        if (!state) {
            return fail(
                "invalid_settlement"
            );
        }

        if (
            day <=
            state.lastProcessedDay
        ) {
            return {
                ok: true,
                processed: false,
                reason:
                    "already_processed",
                settlementId:
                    id,
                day:
                    day
            };
        }

        const demography =
            demographySystem();

        const laborApi =
            laborSystem();

        if (
            !demography ||
            typeof demography
                .processSettlementDay !==
                "function"
        ) {
            return fail(
                "demography_system_api_missing"
            );
        }

        if (
            !laborApi ||
            typeof laborApi.recalculate !==
                "function"
        ) {
            return fail(
                "labor_system_api_missing"
            );
        }

        const demographyResult =
            processDemographyDay(
                id,
                day,
                options && options.demography
            );

        if (
            !demographyResult ||
            !demographyResult.ok
        ) {
            return fail(
                "demography_processing_failed",
                {
                    detail:
                        demographyResult || null
                }
            );
        }

        const laborResult =
            laborApi.recalculate(
                id,
                options &&
                options.labor
            );

        if (
            !laborResult ||
            !laborResult.ok
        ) {
            return fail(
                "labor_recalculation_failed",
                {
                    detail:
                        laborResult || null
                }
            );
        }

        const result = {
            ok: true,
            processed: true,

            settlementId:
                id,

            day:
                day,

            demography:
                clone(
                    demographyResult
                ),

            labor:
                clone(
                    laborResult.labor
                ),

            snapshot:
                getSnapshot(id)
        };

        emit({
            type:
                "settlement_population_day",

            action:
                "day_processed",

            settlementId:
                id,

            day:
                day,

            payload:
                clone(result)
        });

        return result;
    }

    function processToDay(
        dayValue,
        options
    ) {
        const targetDay =
            positiveInteger(
                dayValue,
                1
            );

        const results = [];

        listSettlementIds().forEach(
            function (settlementId) {
                let state =
                    getState(
                        settlementId
                    );

                if (!state) {
                    results.push({
                        settlementId:
                            settlementId,

                        result:
                            fail(
                                "invalid_settlement"
                            )
                    });

                    return;
                }

                for (
                    let day =
                        state.lastProcessedDay +
                        1;
                    day <= targetDay;
                    day += 1
                ) {
                    const result =
                        processSettlementDay(
                            settlementId,
                            day,
                            options
                        );

                    results.push({
                        settlementId:
                            settlementId,

                        day:
                            day,

                        result:
                            result
                    });

                    if (
                        !result ||
                        !result.ok
                    ) {
                        break;
                    }

                    state =
                        getState(
                            settlementId
                        );
                }
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

            targetDay:
                targetDay,

            results:
                results
        };
    }

    function bindClock() {
        return {
            ok: false,
            bound: false,
            reason:
                "direct_clock_subscription_disabled"
        };
    }

    function validateAll() {
        const errors = [];

        const stateApi =
            stateSystem();

        const laborApi =
            laborSystem();

        const demography =
            demographySystem();

        const labor =
            laborTypes();

        if (!stateApi) {
            errors.push(
                "ArsSettlementPopulationState가 없습니다."
            );
        }

        if (!laborApi) {
            errors.push(
                "ArsSettlementLaborSystem이 없습니다."
            );
        }

        if (!demography) {
            errors.push(
                "ArsSettlementDemographySystem이 없습니다."
            );
        }

        if (!labor) {
            errors.push(
                "ArsSettlementLaborTypes가 없습니다."
            );
        }

        if (
            stateApi &&
            typeof stateApi.validateAll ===
                "function"
        ) {
            stateApi.validateAll()
                .forEach(function (error) {
                    errors.push(error);
                });
        }

        if (
            laborApi &&
            typeof laborApi.validateAll ===
                "function"
        ) {
            laborApi.validateAll()
                .forEach(function (error) {
                    errors.push(error);
                });
        }

        if (
            demography &&
            typeof demography.validateAll ===
                "function"
        ) {
            demography.validateAll()
                .forEach(function (error) {
                    errors.push(error);
                });
        }

        listSettlementIds().forEach(
            function (settlementId) {
                const state =
                    getState(
                        settlementId
                    );

                if (!state) {
                    errors.push(
                        settlementId +
                        ": 인구 상태 없음"
                    );

                    return;
                }

                if (
                    state.current !==
                    state.demographics.children +
                    state.demographics.workingAge +
                    state.demographics.elderly
                ) {
                    errors.push(
                        settlementId +
                        ": 인구 총계 불일치"
                    );
                }

                if (
                    !state.jobSources ||
                    !state.jobSources.baseline
                ) {
                    errors.push(
                        settlementId +
                        ": baseline 일자리 없음"
                    );
                }

                Object.keys(
                    state.jobSources || {}
                ).forEach(
                    function (sourceId) {
                        Object.keys(
                            state.jobSources[
                                sourceId
                            ] || {}
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
                "[Ars Bellum] 거점 인구 시스템: " +
                id
            );

            console.log(
                snapshot
            );

            console.log(
                "검사 오류:",
                validateAll()
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

                        population:
                            snapshot
                                ? snapshot.current
                                : 0,

                        capacity:
                            snapshot
                                ? snapshot
                                    .effectiveCapacity
                                : 0,

                        workforce:
                            snapshot
                                ? snapshot
                                    .labor
                                    .workforce
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

                        revision:
                            snapshot
                                ? snapshot.revision
                                : 0,

                        lastProcessedDay:
                            snapshot
                                ? snapshot
                                    .lastProcessedDay
                                : 0
                    };
                }
            );

        console.group(
            "[Ars Bellum] 전체 인구 시스템"
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

    window.ArsSettlementPopulation =
        Object.freeze({
            version:
                VERSION,

            initializeFromWorldData:
                initializeFromWorldData,

            ensureSettlementState:
                ensureSettlementState,

            listSettlementIds:
                listSettlementIds,

            getState:
                getState,

            getSnapshot:
                getSnapshot,

            getPopulation:
                getPopulation,

            setPopulation:
                setPopulation,

            adjustPopulation:
                adjustPopulation,

            getBaseCapacity:
                getBaseCapacity,

            getCapacity:
                getCapacity,

            setBaseCapacity:
                setBaseCapacity,

            setCapacity:
                setCapacity,

            setDemographics:
                setDemographics,

            setCondition:
                setCondition,

            setConditionOverride:
                setConditionOverride,

            clearConditionOverride:
                clearConditionOverride,

            getJobSources:
                getJobSources,

            setJobSource:
                setJobSource,

            removeJobSource:
                removeJobSource,

            totalJobs:
                totalJobs,

            recalculateLabor:
                recalculateLabor,

            setParticipationRate:
                setParticipationRate,

            setPendingMigration:
                setPendingMigration,

            processDemographyDay:
                processDemographyDay,

            processSettlementDay:
                processSettlementDay,

            processToDay:
                processToDay,

            bindClock:
                bindClock,

            subscribe:
                subscribe,

            validateAll:
                validateAll,

            debugPrint:
                debugPrint
        });

    const initialized =
        initializeFromWorldData();

    const errors =
        validateAll();

    if (errors.length) {
        console.error(
            "[Ars Bellum] SettlementPopulationSystem 검사 실패:",
            errors
        );
    } else {
        console.log(
            "[Ars Bellum] SettlementPopulationSystem 연결 완료 - 거점 " +
            initialized.length +
            "곳"
        );
    }
})();