// ============================================================
// Ars Bellum - S_Demography.js
// 출생, 사망, 자연 증감, 이주 압력, 이주 도착·출발 계산 전용.
// 인구 상태 저장은 S_PopState.js만 사용한다.
// 노동 계산과 GameClock 구독은 수행하지 않는다.
// 선행: S_PopState.js
// ============================================================
(function () {
    "use strict";

    const VERSION = 1;
    const DAYS_PER_YEAR = 365;

    const DEFAULT_RATES = Object.freeze({
        annualBirthRate: 0.028,
        annualDeathRate: 0.018,

        childShare: 0.22,
        workingAgeShare: 0.68,
        elderlyShare: 0.10,

        migrationScale: 0.003,
        overcrowdingWeight: 0.45,
        unemploymentWeight: 0.25,
        foodWeight: 0.15,
        healthWeight: 0.10,
        securityWeight: 0.05
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

    function populationState() {
        return (
            window.ArsSettlementPopulationState ||
            null
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

    function listSettlementIds() {
        const stateApi =
            populationState();

        if (
            !stateApi ||
            typeof stateApi.listSettlementIds !==
                "function"
        ) {
            return [];
        }

        return (
            stateApi.listSettlementIds() ||
            []
        );
    }

    function effectiveCondition(
        state,
        key
    ) {
        if (
            state.conditionOverrides &&
            state.conditionOverrides[key] !==
                undefined
        ) {
            return clamp(
                state.conditionOverrides[key],
                0,
                1
            );
        }

        return clamp(
            state.conditions &&
            state.conditions[key],
            0,
            1
        );
    }

    function normalizeDemographicShares(
        options
    ) {
        const source =
            isRecord(options)
                ? options
                : {};

        let childShare =
            nonNegative(
                source.childShare === undefined
                    ? DEFAULT_RATES.childShare
                    : source.childShare
            );

        let workingAgeShare =
            nonNegative(
                source.workingAgeShare === undefined
                    ? DEFAULT_RATES.workingAgeShare
                    : source.workingAgeShare
            );

        let elderlyShare =
            nonNegative(
                source.elderlyShare === undefined
                    ? DEFAULT_RATES.elderlyShare
                    : source.elderlyShare
            );

        const total =
            childShare +
            workingAgeShare +
            elderlyShare;

        if (total <= 0) {
            childShare =
                DEFAULT_RATES.childShare;

            workingAgeShare =
                DEFAULT_RATES.workingAgeShare;

            elderlyShare =
                DEFAULT_RATES.elderlyShare;
        } else {
            childShare /= total;
            workingAgeShare /= total;
            elderlyShare /= total;
        }

        return {
            childShare:
                childShare,

            workingAgeShare:
                workingAgeShare,

            elderlyShare:
                elderlyShare
        };
    }

    function distributePopulation(
        totalValue,
        shares
    ) {
        const total =
            nonNegativeInteger(
                totalValue
            );

        const exact = [
            {
                key: "children",
                value:
                    total *
                    shares.childShare
            },
            {
                key: "workingAge",
                value:
                    total *
                    shares.workingAgeShare
            },
            {
                key: "elderly",
                value:
                    total *
                    shares.elderlyShare
            }
        ];

        const result = {
            children: 0,
            workingAge: 0,
            elderly: 0
        };

        let assigned = 0;

        exact.forEach(function (entry) {
            const whole =
                Math.floor(
                    entry.value
                );

            result[entry.key] =
                whole;

            entry.fraction =
                entry.value -
                whole;

            assigned += whole;
        });

        exact.sort(function (left, right) {
            return (
                right.fraction -
                left.fraction
            );
        });

        let remaining =
            total - assigned;

        let index = 0;

        while (
            remaining > 0 &&
            exact.length > 0
        ) {
            result[
                exact[
                    index %
                    exact.length
                ].key
            ] += 1;

            remaining -= 1;
            index += 1;
        }

        return result;
    }

    function normalizeDemographics(
        state,
        options
    ) {
        const current =
            nonNegativeInteger(
                state.current
            );

        const demographics =
            state.demographics &&
            isRecord(state.demographics)
                ? state.demographics
                : {};

        const recordedTotal =
            nonNegativeInteger(
                demographics.children
            ) +
            nonNegativeInteger(
                demographics.workingAge
            ) +
            nonNegativeInteger(
                demographics.elderly
            );

        if (
            recordedTotal === current
        ) {
            return {
                children:
                    nonNegativeInteger(
                        demographics.children
                    ),

                workingAge:
                    nonNegativeInteger(
                        demographics.workingAge
                    ),

                elderly:
                    nonNegativeInteger(
                        demographics.elderly
                    )
            };
        }

        return distributePopulation(
            current,
            normalizeDemographicShares(
                options
            )
        );
    }

    function calculateBirthRate(
        state,
        options
    ) {
        const source =
            isRecord(options)
                ? options
                : {};

        const baseRate =
            clamp(
                source.annualBirthRate ===
                    undefined
                    ? state
                        .naturalChange
                        .annualBirthRate
                    : source.annualBirthRate,
                0,
                1
            );

        const food =
            effectiveCondition(
                state,
                "foodSatisfaction"
            );

        const health =
            effectiveCondition(
                state,
                "health"
            );

        const security =
            effectiveCondition(
                state,
                "security"
            );

        const capacity =
            Math.max(
                1,
                nonNegativeInteger(
                    state.effectiveCapacity
                )
            );

        const population =
            nonNegativeInteger(
                state.current
            );

        const occupancy =
            population /
            capacity;

        const conditionFactor =
            clamp(
                0.55 +
                food * 0.20 +
                health * 0.15 +
                security * 0.10,
                0.25,
                1.15
            );

        const capacityFactor =
            occupancy <= 1
                ? 1
                : clamp(
                    1 -
                    (occupancy - 1) *
                    0.75,
                    0.20,
                    1
                );

        return clamp(
            baseRate *
            conditionFactor *
            capacityFactor,
            0,
            1
        );
    }

    function calculateDeathRate(
        state,
        options
    ) {
        const source =
            isRecord(options)
                ? options
                : {};

        const baseRate =
            clamp(
                source.annualDeathRate ===
                    undefined
                    ? state
                        .naturalChange
                        .annualDeathRate
                    : source.annualDeathRate,
                0,
                1
            );

        const food =
            effectiveCondition(
                state,
                "foodSatisfaction"
            );

        const health =
            effectiveCondition(
                state,
                "health"
            );

        const security =
            effectiveCondition(
                state,
                "security"
            );

        const capacity =
            Math.max(
                1,
                nonNegativeInteger(
                    state.effectiveCapacity
                )
            );

        const population =
            nonNegativeInteger(
                state.current
            );

        const occupancy =
            population /
            capacity;

        const hardship =
            (1 - food) * 0.45 +
            (1 - health) * 0.40 +
            (1 - security) * 0.15;

        const overcrowding =
            occupancy > 1
                ? Math.min(
                    1,
                    occupancy - 1
                )
                : 0;

        return clamp(
            baseRate *
            (
                0.70 +
                hardship * 1.50 +
                overcrowding * 0.90
            ),
            0,
            1
        );
    }

    function calculateMigrationPressure(
        settlementId,
        options
    ) {
        const state =
            getState(
                settlementId
            );

        if (!state) {
            return null;
        }

        const source =
            isRecord(options)
                ? options
                : {};

        const capacity =
            Math.max(
                1,
                nonNegativeInteger(
                    state.effectiveCapacity
                )
            );

        const population =
            nonNegativeInteger(
                state.current
            );

        const occupancy =
            population /
            capacity;

        const overcrowding =
            clamp(
                occupancy - 1,
                0,
                1
            );

        const availableCapacity =
            clamp(
                1 - occupancy,
                0,
                1
            );

        const unemployment =
            clamp(
                state.labor &&
                state.labor.unemploymentRate,
                0,
                1
            );

        const vacancyRate =
            clamp(
                state.labor &&
                state.labor.vacancyRate,
                0,
                1
            );

        const food =
            effectiveCondition(
                state,
                "foodSatisfaction"
            );

        const health =
            effectiveCondition(
                state,
                "health"
            );

        const security =
            effectiveCondition(
                state,
                "security"
            );

        const prosperity =
            effectiveCondition(
                state,
                "prosperity"
            );

        const outflowPressure =
            clamp(
                overcrowding *
                    finite(
                        source.overcrowdingWeight,
                        DEFAULT_RATES
                            .overcrowdingWeight
                    ) +
                unemployment *
                    finite(
                        source.unemploymentWeight,
                        DEFAULT_RATES
                            .unemploymentWeight
                    ) +
                (1 - food) *
                    finite(
                        source.foodWeight,
                        DEFAULT_RATES.foodWeight
                    ) +
                (1 - health) *
                    finite(
                        source.healthWeight,
                        DEFAULT_RATES.healthWeight
                    ) +
                (1 - security) *
                    finite(
                        source.securityWeight,
                        DEFAULT_RATES.securityWeight
                    ),
                0,
                1
            );

        const inflowAttractiveness =
            clamp(
                availableCapacity * 0.30 +
                vacancyRate * 0.25 +
                food * 0.10 +
                health * 0.10 +
                security * 0.10 +
                prosperity * 0.15,
                0,
                1
            );

        return {
            occupancy:
                round(
                    occupancy,
                    6
                ),

            outflowPressure:
                round(
                    outflowPressure,
                    6
                ),

            inflowAttractiveness:
                round(
                    inflowAttractiveness,
                    6
                )
        };
    }

    function calculateDailyMigration(
        settlementId,
        options
    ) {
        const state =
            getState(
                settlementId
            );

        const pressure =
            calculateMigrationPressure(
                settlementId,
                options
            );

        if (
            !state ||
            !pressure
        ) {
            return null;
        }

        const source =
            isRecord(options)
                ? options
                : {};

        const migrationScale =
            nonNegative(
                source.migrationScale ===
                    undefined
                    ? DEFAULT_RATES.migrationScale
                    : source.migrationScale
            );

        const population =
            nonNegativeInteger(
                state.current
            );

        const capacity =
            Math.max(
                1,
                nonNegativeInteger(
                    state.effectiveCapacity
                )
            );

        const freeCapacity =
            Math.max(
                0,
                capacity -
                population
            );

        const rawDepartures =
            population *
            pressure.outflowPressure *
            migrationScale +
            nonNegative(
                state.migration &&
                state.migration.pendingOutflow
            );

        const rawArrivals =
            Math.min(
                freeCapacity,
                capacity *
                pressure.inflowAttractiveness *
                migrationScale +
                nonNegative(
                    state.migration &&
                    state.migration.pendingInflow
                )
            );

        const departures =
            Math.min(
                population,
                Math.floor(
                    rawDepartures
                )
            );

        const arrivals =
            Math.min(
                freeCapacity,
                Math.floor(
                    rawArrivals
                )
            );

        return {
            outflowPressure:
                pressure.outflowPressure,

            inflowAttractiveness:
                pressure.inflowAttractiveness,

            departures:
                departures,

            arrivals:
                arrivals,

            outflowRemainder:
                round(
                    Math.max(
                        0,
                        rawDepartures -
                        departures
                    ),
                    6
                ),

            inflowRemainder:
                round(
                    Math.max(
                        0,
                        rawArrivals -
                        arrivals
                    ),
                    6
                )
        };
    }

    function calculateNaturalChange(
        settlementId,
        options
    ) {
        const state =
            getState(
                settlementId
            );

        if (!state) {
            return null;
        }

        const population =
            nonNegativeInteger(
                state.current
            );

        const birthRate =
            calculateBirthRate(
                state,
                options
            );

        const deathRate =
            calculateDeathRate(
                state,
                options
            );

        const rawBirths =
            population *
            birthRate /
            DAYS_PER_YEAR +
            nonNegative(
                state
                    .naturalChange
                    .birthAccumulator
            );

        const rawDeaths =
            population *
            deathRate /
            DAYS_PER_YEAR +
            nonNegative(
                state
                    .naturalChange
                    .deathAccumulator
            );

        const births =
            Math.floor(
                rawBirths
            );

        const deaths =
            Math.min(
                population +
                births,
                Math.floor(
                    rawDeaths
                )
            );

        return {
            annualBirthRate:
                birthRate,

            annualDeathRate:
                deathRate,

            births:
                births,

            deaths:
                deaths,

            net:
                births -
                deaths,

            birthAccumulator:
                round(
                    rawBirths -
                    births,
                    8
                ),

            deathAccumulator:
                round(
                    rawDeaths -
                    deaths,
                    8
                )
        };
    }

    function applyPopulationChange(
        demographics,
        births,
        deaths,
        arrivals,
        departures,
        options
    ) {
        const result =
            clone(
                demographics
            );

        result.children +=
            nonNegativeInteger(
                births
            );

        const arrivalShares =
            normalizeDemographicShares(
                options
            );

        const arrivalDistribution =
            distributePopulation(
                arrivals,
                arrivalShares
            );

        result.children +=
            arrivalDistribution.children;

        result.workingAge +=
            arrivalDistribution.workingAge;

        result.elderly +=
            arrivalDistribution.elderly;

        let remainingDeaths =
            nonNegativeInteger(
                deaths
            );

        const elderlyDeaths =
            Math.min(
                result.elderly,
                Math.floor(
                    remainingDeaths *
                    0.55
                )
            );

        result.elderly -=
            elderlyDeaths;

        remainingDeaths -=
            elderlyDeaths;

        const workingDeaths =
            Math.min(
                result.workingAge,
                Math.floor(
                    remainingDeaths *
                    0.75
                )
            );

        result.workingAge -=
            workingDeaths;

        remainingDeaths -=
            workingDeaths;

        const childDeaths =
            Math.min(
                result.children,
                remainingDeaths
            );

        result.children -=
            childDeaths;

        remainingDeaths -=
            childDeaths;

        if (remainingDeaths > 0) {
            const additionalWorking =
                Math.min(
                    result.workingAge,
                    remainingDeaths
                );

            result.workingAge -=
                additionalWorking;

            remainingDeaths -=
                additionalWorking;
        }

        if (remainingDeaths > 0) {
            const additionalElderly =
                Math.min(
                    result.elderly,
                    remainingDeaths
                );

            result.elderly -=
                additionalElderly;
        }

        let remainingDepartures =
            nonNegativeInteger(
                departures
            );

        const workingDepartures =
            Math.min(
                result.workingAge,
                Math.floor(
                    remainingDepartures *
                    0.75
                )
            );

        result.workingAge -=
            workingDepartures;

        remainingDepartures -=
            workingDepartures;

        const childDepartures =
            Math.min(
                result.children,
                Math.floor(
                    remainingDepartures *
                    0.70
                )
            );

        result.children -=
            childDepartures;

        remainingDepartures -=
            childDepartures;

        const elderlyDepartures =
            Math.min(
                result.elderly,
                remainingDepartures
            );

        result.elderly -=
            elderlyDepartures;

        remainingDepartures -=
            elderlyDepartures;

        if (remainingDepartures > 0) {
            const additionalWorking =
                Math.min(
                    result.workingAge,
                    remainingDepartures
                );

            result.workingAge -=
                additionalWorking;

            remainingDepartures -=
                additionalWorking;
        }

        if (remainingDepartures > 0) {
            const additionalChildren =
                Math.min(
                    result.children,
                    remainingDepartures
                );

            result.children -=
                additionalChildren;
        }

        return {
            children:
                nonNegativeInteger(
                    result.children
                ),

            workingAge:
                nonNegativeInteger(
                    result.workingAge
                ),

            elderly:
                nonNegativeInteger(
                    result.elderly
                )
        };
    }

    function setPendingMigration(
        settlementId,
        inflow,
        outflow
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

        state.migration.pendingInflow =
            nonNegative(
                inflow
            );

        state.migration.pendingOutflow =
            nonNegative(
                outflow
            );

        const saved =
            replaceState(
                settlementId,
                state,
                "set_pending_migration"
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

            pendingInflow:
                state
                    .migration
                    .pendingInflow,

            pendingOutflow:
                state
                    .migration
                    .pendingOutflow,

            revision:
                saved.revision
        };
    }

    function processSettlementDay(
        settlementId,
        dayValue,
        options
    ) {
        const id =
            cleanId(
                settlementId
            );

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

        const natural =
            calculateNaturalChange(
                id,
                options
            );

        const migration =
            calculateDailyMigration(
                id,
                options
            );

        if (
            !natural ||
            !migration
        ) {
            return fail(
                "demography_calculation_failed"
            );
        }

        const demographics =
            normalizeDemographics(
                state,
                options
            );

        const updatedDemographics =
            applyPopulationChange(
                demographics,
                natural.births,
                natural.deaths,
                migration.arrivals,
                migration.departures,
                options
            );

        const nextCurrent =
            Math.max(
                0,
                updatedDemographics.children +
                updatedDemographics.workingAge +
                updatedDemographics.elderly
            );

        state.current =
            nextCurrent;

        state.demographics =
            updatedDemographics;

        state.naturalChange.annualBirthRate =
            natural.annualBirthRate;

        state.naturalChange.annualDeathRate =
            natural.annualDeathRate;

        state.naturalChange.birthAccumulator =
            natural.birthAccumulator;

        state.naturalChange.deathAccumulator =
            natural.deathAccumulator;

        state.naturalChange.birthsLastDay =
            natural.births;

        state.naturalChange.deathsLastDay =
            natural.deaths;

        state.naturalChange.netLastDay =
            natural.net;

        state.migration.outflowPressure =
            migration.outflowPressure;

        state.migration.inflowAttractiveness =
            migration.inflowAttractiveness;

        state.migration.pendingOutflow =
            migration.outflowRemainder;

        state.migration.pendingInflow =
            migration.inflowRemainder;

        state.migration.arrivalsLastDay =
            migration.arrivals;

        state.migration.departuresLastDay =
            migration.departures;

        state.lastProcessedDay =
            day;

        const saved =
            replaceState(
                id,
                state,
                "process_demography_day"
            );

        if (
            !saved ||
            !saved.ok
        ) {
            return saved;
        }

        return {
            ok: true,
            processed: true,

            settlementId:
                id,

            day:
                day,

            previousPopulation:
                nonNegativeInteger(
                    nextCurrent -
                    natural.net -
                    migration.arrivals +
                    migration.departures
                ),

            currentPopulation:
                nextCurrent,

            births:
                natural.births,

            deaths:
                natural.deaths,

            naturalChange:
                natural.net,

            arrivals:
                migration.arrivals,

            departures:
                migration.departures,

            migrationChange:
                migration.arrivals -
                migration.departures,

            totalChange:
                natural.net +
                migration.arrivals -
                migration.departures,

            revision:
                saved.revision
        };
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

        const demographicTotal =
            nonNegativeInteger(
                state.demographics.children
            ) +
            nonNegativeInteger(
                state.demographics.workingAge
            ) +
            nonNegativeInteger(
                state.demographics.elderly
            );

        if (
            demographicTotal !==
            state.current
        ) {
            errors.push(
                settlementId +
                ": 인구 총계와 연령 분포 불일치"
            );
        }

        if (
            state.naturalChange.annualBirthRate <
                0 ||
            state.naturalChange.annualBirthRate >
                1
        ) {
            errors.push(
                settlementId +
                ": 출생률 오류"
            );
        }

        if (
            state.naturalChange.annualDeathRate <
                0 ||
            state.naturalChange.annualDeathRate >
                1
        ) {
            errors.push(
                settlementId +
                ": 사망률 오류"
            );
        }

        if (
            state.migration.outflowPressure <
                0 ||
            state.migration.outflowPressure >
                1
        ) {
            errors.push(
                settlementId +
                ": 유출 압력 오류"
            );
        }

        if (
            state.migration.inflowAttractiveness <
                0 ||
            state.migration.inflowAttractiveness >
                1
        ) {
            errors.push(
                settlementId +
                ": 유입 매력도 오류"
            );
        }

        return errors;
    }

    function validateAll() {
        const errors = [];

        if (!populationState()) {
            errors.push(
                "ArsSettlementPopulationState가 없습니다."
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
            cleanId(
                settlementId
            );

        if (id) {
            const state =
                getState(id);

            console.group(
                "[Ars Bellum] 거점 인구 변동: " +
                id
            );

            console.log(
                state
            );

            console.log(
                "이주 압력:",
                calculateMigrationPressure(
                    id
                )
            );

            console.log(
                "검사 오류:",
                validateSettlement(id)
            );

            console.groupEnd();

            return state;
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

                        population:
                            state.current,

                        capacity:
                            state.effectiveCapacity,

                        births:
                            state
                                .naturalChange
                                .birthsLastDay,

                        deaths:
                            state
                                .naturalChange
                                .deathsLastDay,

                        arrivals:
                            state
                                .migration
                                .arrivalsLastDay,

                        departures:
                            state
                                .migration
                                .departuresLastDay,

                        lastProcessedDay:
                            state
                                .lastProcessedDay
                    };
                }
            );

        console.group(
            "[Ars Bellum] 전체 인구 변동"
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

    window.ArsSettlementDemographySystem =
        Object.freeze({
            version:
                VERSION,

            defaultRates:
                DEFAULT_RATES,

            calculateBirthRate:
                calculateBirthRate,

            calculateDeathRate:
                calculateDeathRate,

            calculateNaturalChange:
                calculateNaturalChange,

            calculateMigrationPressure:
                calculateMigrationPressure,

            calculateDailyMigration:
                calculateDailyMigration,

            setPendingMigration:
                setPendingMigration,

            processSettlementDay:
                processSettlementDay,

            processToDay:
                processToDay,

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
            "[Ars Bellum] SettlementDemographySystem 검사 실패:",
            errors
        );
    } else {
        console.log(
            "[Ars Bellum] SettlementDemographySystem 연결 완료"
        );
    }
})();