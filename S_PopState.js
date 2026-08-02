// ============================================================
// Ars Bellum - S_PopState.js
// 거점 동적 인구 상태의 유일한 저장소.
// 저장 위치:
// ArsGameState.getState().world.settlements[id].population
//
// WorldMapData는 읽거나 수정하지 않는다.
// 노동 계산, 출생·사망·이주 계산, GameClock 구독은 수행하지 않는다.
// 선행: GameState.js, S_LaborTypes.js
// ============================================================
(function () {
    "use strict";

    const VERSION = 1;
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

    function makeLaborMap() {
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

    function normalizeLaborMap(source) {
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

    function makeDemographics() {
        return {
            children: 0,
            workingAge: 0,
            elderly: 0
        };
    }

    function normalizeDemographics(source) {
        const input =
            isRecord(source)
                ? source
                : {};

        return {
            children:
                nonNegativeInteger(
                    input.children
                ),

            workingAge:
                nonNegativeInteger(
                    input.workingAge
                ),

            elderly:
                nonNegativeInteger(
                    input.elderly
                )
        };
    }

    function makeLaborState() {
        return {
            participationRate: 0.78,

            workforce: 0,

            supplyByType:
                makeLaborMap(),

            jobsByType:
                makeLaborMap(),

            employedByType:
                makeLaborMap(),

            unemployedByType:
                makeLaborMap(),

            vacanciesByType:
                makeLaborMap(),

            employed: 0,
            unemployed: 0,
            unemploymentRate: 0,

            vacancies: 0,
            vacancyRate: 0
        };
    }

    function normalizeLaborState(source) {
        const input =
            isRecord(source)
                ? source
                : {};

        return {
            participationRate:
                clamp(
                    input.participationRate ===
                        undefined
                        ? 0.78
                        : input.participationRate,
                    0,
                    1
                ),

            workforce:
                nonNegativeInteger(
                    input.workforce
                ),

            supplyByType:
                normalizeLaborMap(
                    input.supplyByType
                ),

            jobsByType:
                normalizeLaborMap(
                    input.jobsByType
                ),

            employedByType:
                normalizeLaborMap(
                    input.employedByType
                ),

            unemployedByType:
                normalizeLaborMap(
                    input.unemployedByType
                ),

            vacanciesByType:
                normalizeLaborMap(
                    input.vacanciesByType
                ),

            employed:
                nonNegativeInteger(
                    input.employed
                ),

            unemployed:
                nonNegativeInteger(
                    input.unemployed
                ),

            unemploymentRate:
                clamp(
                    input.unemploymentRate,
                    0,
                    1
                ),

            vacancies:
                nonNegativeInteger(
                    input.vacancies
                ),

            vacancyRate:
                clamp(
                    input.vacancyRate,
                    0,
                    1
                )
        };
    }

    function makeConditions() {
        return {
            foodSatisfaction: 1,
            health: 0.75,
            security: 0.5,
            prosperity: 0.5
        };
    }

    function normalizeConditions(source) {
        const input =
            isRecord(source)
                ? source
                : {};

        const defaults =
            makeConditions();

        return {
            foodSatisfaction:
                clamp(
                    input.foodSatisfaction ===
                        undefined
                        ? defaults.foodSatisfaction
                        : input.foodSatisfaction,
                    0,
                    1
                ),

            health:
                clamp(
                    input.health === undefined
                        ? defaults.health
                        : input.health,
                    0,
                    1
                ),

            security:
                clamp(
                    input.security === undefined
                        ? defaults.security
                        : input.security,
                    0,
                    1
                ),

            prosperity:
                clamp(
                    input.prosperity === undefined
                        ? defaults.prosperity
                        : input.prosperity,
                    0,
                    1
                )
        };
    }

    function normalizeConditionOverrides(source) {
        const input =
            isRecord(source)
                ? source
                : {};

        const result = {};

        Object.keys(
            makeConditions()
        ).forEach(function (key) {
            if (
                input[key] !== undefined &&
                input[key] !== null
            ) {
                result[key] =
                    clamp(
                        input[key],
                        0,
                        1
                    );
            }
        });

        return result;
    }

    function makeMigration() {
        return {
            outflowPressure: 0,
            inflowAttractiveness: 0,

            pendingOutflow: 0,
            pendingInflow: 0,

            arrivalsLastDay: 0,
            departuresLastDay: 0
        };
    }

    function normalizeMigration(source) {
        const input =
            isRecord(source)
                ? source
                : {};

        return {
            outflowPressure:
                clamp(
                    input.outflowPressure,
                    0,
                    1
                ),

            inflowAttractiveness:
                clamp(
                    input.inflowAttractiveness,
                    0,
                    1
                ),

            pendingOutflow:
                nonNegative(
                    input.pendingOutflow
                ),

            pendingInflow:
                nonNegative(
                    input.pendingInflow
                ),

            arrivalsLastDay:
                nonNegativeInteger(
                    input.arrivalsLastDay
                ),

            departuresLastDay:
                nonNegativeInteger(
                    input.departuresLastDay
                )
        };
    }

    function makeNaturalChange() {
        return {
            annualBirthRate: 0.028,
            annualDeathRate: 0.018,

            birthAccumulator: 0,
            deathAccumulator: 0,

            birthsLastDay: 0,
            deathsLastDay: 0,
            netLastDay: 0
        };
    }

    function normalizeNaturalChange(source) {
        const input =
            isRecord(source)
                ? source
                : {};

        return {
            annualBirthRate:
                clamp(
                    input.annualBirthRate ===
                        undefined
                        ? 0.028
                        : input.annualBirthRate,
                    0,
                    1
                ),

            annualDeathRate:
                clamp(
                    input.annualDeathRate ===
                        undefined
                        ? 0.018
                        : input.annualDeathRate,
                    0,
                    1
                ),

            birthAccumulator:
                nonNegative(
                    input.birthAccumulator
                ),

            deathAccumulator:
                nonNegative(
                    input.deathAccumulator
                ),

            birthsLastDay:
                nonNegativeInteger(
                    input.birthsLastDay
                ),

            deathsLastDay:
                nonNegativeInteger(
                    input.deathsLastDay
                ),

            netLastDay:
                Math.floor(
                    finite(
                        input.netLastDay,
                        0
                    )
                )
        };
    }

    function normalizeJobSources(source) {
        const input =
            isRecord(source)
                ? source
                : {};

        const result = {};

        Object.keys(input).forEach(
            function (sourceId) {
                const id =
                    cleanId(sourceId);

                if (!id) {
                    return;
                }

                result[id] =
                    normalizeLaborMap(
                        input[sourceId]
                    );
            }
        );

        if (!result.baseline) {
            result.baseline =
                makeLaborMap();
        }

        return result;
    }

    function makeState() {
        return {
            version: VERSION,

            current: 0,

            baseCapacity: 1,
            effectiveCapacity: 1,

            demographics:
                makeDemographics(),

            labor:
                makeLaborState(),

            conditions:
                makeConditions(),

            conditionOverrides: {},

            migration:
                makeMigration(),

            naturalChange:
                makeNaturalChange(),

            jobSources: {
                baseline:
                    makeLaborMap()
            },

            revision: 0,
            lastProcessedDay: 1
        };
    }

    function normalizeState(source) {
        const input =
            isRecord(source)
                ? source
                : {};

        const baseCapacity =
            positiveInteger(
                input.baseCapacity,
                1
            );

        const effectiveCapacity =
            positiveInteger(
                input.effectiveCapacity,
                baseCapacity
            );

        return {
            version: VERSION,

            current:
                nonNegativeInteger(
                    input.current
                ),

            baseCapacity:
                baseCapacity,

            effectiveCapacity:
                effectiveCapacity,

            demographics:
                normalizeDemographics(
                    input.demographics
                ),

            labor:
                normalizeLaborState(
                    input.labor
                ),

            conditions:
                normalizeConditions(
                    input.conditions
                ),

            conditionOverrides:
                normalizeConditionOverrides(
                    input.conditionOverrides
                ),

            migration:
                normalizeMigration(
                    input.migration
                ),

            naturalChange:
                normalizeNaturalChange(
                    input.naturalChange
                ),

            jobSources:
                normalizeJobSources(
                    input.jobSources
                ),

            revision:
                nonNegativeInteger(
                    input.revision
                ),

            lastProcessedDay:
                positiveInteger(
                    input.lastProcessedDay,
                    1
                )
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

        settlement.population =
            normalizeState(
                settlement.population
            );

        return settlement;
    }

    function emit(
        settlement,
        action,
        payload
    ) {
        const event = {
            type:
                "population_state_changed",

            settlementId:
                settlement.id,

            revision:
                settlement
                    .population
                    .revision,

            action:
                cleanId(action) ||
                "updated",

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
                        "[Ars Bellum] 인구 상태 구독자 오류:",
                        error
                    );
                }
            }
        );
    }

    function commit(
        settlement,
        nextState,
        action,
        payload
    ) {
        const normalized =
            normalizeState(
                nextState
            );

        normalized.revision =
            settlement
                .population
                .revision + 1;

        settlement.population =
            normalized;

        emit(
            settlement,
            action,
            payload
        );

        return normalized.revision;
    }

    function ensureSettlementState(
        settlementId
    ) {
        const settlement =
            ensureSettlementRecord(
                settlementId
            );

        return settlement
            ? clone(
                settlement.population
            )
            : null;
    }

    function listSettlementIds() {
        const world =
            ensureWorldState();

        return world
            ? Object.keys(
                world.settlements
            ).sort()
            : [];
    }

    function getState(settlementId) {
        return ensureSettlementState(
            settlementId
        );
    }

    function getSnapshot(settlementId) {
        const settlement =
            ensureSettlementRecord(
                settlementId
            );

        if (!settlement) {
            return null;
        }

        return {
            settlementId:
                settlement.id,

            population:
                clone(
                    settlement.population
                )
        };
    }

    function replaceState(
        settlementId,
        nextState,
        action
    ) {
        const settlement =
            ensureSettlementRecord(
                settlementId
            );

        if (
            !settlement ||
            !isRecord(nextState)
        ) {
            return fail(
                "invalid_population_state"
            );
        }

        const revision =
            commit(
                settlement,
                nextState,
                action ||
                    "replace_population_state"
            );

        return {
            ok: true,
            settlementId:
                settlement.id,
            revision:
                revision,
            state:
                clone(
                    settlement.population
                )
        };
    }

    function patchState(
        settlementId,
        patch,
        action
    ) {
        const settlement =
            ensureSettlementRecord(
                settlementId
            );

        if (
            !settlement ||
            !isRecord(patch)
        ) {
            return fail(
                "invalid_population_patch"
            );
        }

        const next =
            Object.assign(
                {},
                clone(
                    settlement.population
                ),
                clone(patch)
            );

        return replaceState(
            settlementId,
            next,
            action ||
                "patch_population_state"
        );
    }

    function setCurrent(
        settlementId,
        amount
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

        const next =
            clone(
                settlement.population
            );

        const previous =
            next.current;

        next.current =
            nonNegativeInteger(
                amount
            );

        const revision =
            commit(
                settlement,
                next,
                "set_current_population",
                {
                    previous:
                        previous,
                    current:
                        next.current
                }
            );

        return {
            ok: true,
            settlementId:
                settlement.id,
            previous:
                previous,
            current:
                next.current,
            revision:
                revision
        };
    }

    function setBaseCapacity(
        settlementId,
        amount
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

        const next =
            clone(
                settlement.population
            );

        const previous =
            next.baseCapacity;

        next.baseCapacity =
            positiveInteger(
                amount,
                1
            );

        if (
            next.effectiveCapacity <
            next.baseCapacity
        ) {
            next.effectiveCapacity =
                next.baseCapacity;
        }

        const revision =
            commit(
                settlement,
                next,
                "set_base_capacity",
                {
                    previous:
                        previous,
                    current:
                        next.baseCapacity
                }
            );

        return {
            ok: true,
            settlementId:
                settlement.id,
            previous:
                previous,
            current:
                next.baseCapacity,
            revision:
                revision
        };
    }

    function setEffectiveCapacity(
        settlementId,
        amount
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

        const next =
            clone(
                settlement.population
            );

        const previous =
            next.effectiveCapacity;

        next.effectiveCapacity =
            positiveInteger(
                amount,
                next.baseCapacity
            );

        const revision =
            commit(
                settlement,
                next,
                "set_effective_capacity",
                {
                    previous:
                        previous,
                    current:
                        next.effectiveCapacity
                }
            );

        return {
            ok: true,
            settlementId:
                settlement.id,
            previous:
                previous,
            current:
                next.effectiveCapacity,
            revision:
                revision
        };
    }

    function setLastProcessedDay(
        settlementId,
        dayValue
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

        const next =
            clone(
                settlement.population
            );

        const day =
            positiveInteger(
                dayValue,
                1
            );

        if (
            day <
            next.lastProcessedDay
        ) {
            return fail(
                "day_regression",
                {
                    currentDay:
                        next.lastProcessedDay,
                    requestedDay:
                        day
                }
            );
        }

        if (
            day ===
            next.lastProcessedDay
        ) {
            return {
                ok: true,
                changed: false,
                settlementId:
                    settlement.id,
                lastProcessedDay:
                    day,
                revision:
                    next.revision
            };
        }

        next.lastProcessedDay =
            day;

        const revision =
            commit(
                settlement,
                next,
                "set_last_processed_day",
                {
                    day: day
                }
            );

        return {
            ok: true,
            changed: true,
            settlementId:
                settlement.id,
            lastProcessedDay:
                day,
            revision:
                revision
        };
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

    function validateSettlement(
        settlementId
    ) {
        const state =
            getState(
                settlementId
            );

        const errors = [];

        if (!state) {
            errors.push(
                cleanId(settlementId) +
                ": 인구 상태 없음"
            );

            return errors;
        }

        if (
            state.current < 0 ||
            !Number.isInteger(
                state.current
            )
        ) {
            errors.push(
                settlementId +
                ": current 오류"
            );
        }

        if (
            state.baseCapacity < 1 ||
            !Number.isInteger(
                state.baseCapacity
            )
        ) {
            errors.push(
                settlementId +
                ": baseCapacity 오류"
            );
        }

        if (
            state.effectiveCapacity < 1 ||
            !Number.isInteger(
                state.effectiveCapacity
            )
        ) {
            errors.push(
                settlementId +
                ": effectiveCapacity 오류"
            );
        }

        const labor =
            laborTypes();

        Object.keys(
            state.jobSources
        ).forEach(function (sourceId) {
            Object.keys(
                state.jobSources[
                    sourceId
                ]
            ).forEach(function (jobId) {
                if (
                    !labor ||
                    !labor.isKnown(jobId)
                ) {
                    errors.push(
                        settlementId +
                        ": 알 수 없는 직업 ID " +
                        jobId
                    );
                }
            });
        });

        if (
            !state.jobSources.baseline
        ) {
            errors.push(
                settlementId +
                ": baseline 일자리 없음"
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

    function debugPrint(settlementId) {
        const id =
            cleanId(settlementId);

        if (id) {
            const snapshot =
                getSnapshot(id);

            console.group(
                "[Ars Bellum] 인구 상태: " +
                id
            );

            console.log(
                snapshot
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
                    const state =
                        getState(
                            currentId
                        );

                    return {
                        settlementId:
                            currentId,

                        current:
                            state.current,

                        baseCapacity:
                            state.baseCapacity,

                        effectiveCapacity:
                            state.effectiveCapacity,

                        employed:
                            state.labor.employed,

                        unemployed:
                            state.labor.unemployed,

                        revision:
                            state.revision,

                        lastProcessedDay:
                            state.lastProcessedDay
                    };
                }
            );

        console.group(
            "[Ars Bellum] 전체 인구 상태"
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

    window.ArsSettlementPopulationState =
        Object.freeze({
            version:
                VERSION,

            ensureWorldState:
                ensureWorldState,

            ensureSettlementState:
                ensureSettlementState,

            listSettlementIds:
                listSettlementIds,

            getState:
                getState,

            getSnapshot:
                getSnapshot,

            replaceState:
                replaceState,

            patchState:
                patchState,

            setCurrent:
                setCurrent,

            setBaseCapacity:
                setBaseCapacity,

            setEffectiveCapacity:
                setEffectiveCapacity,

            setLastProcessedDay:
                setLastProcessedDay,

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
            "[Ars Bellum] SettlementPopulationState 검사 실패:",
            errors
        );
    } else {
        console.log(
            "[Ars Bellum] SettlementPopulationState 연결 완료"
        );
    }
})();