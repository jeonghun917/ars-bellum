// ============================================================
// Ars Bellum - S_Build.js
// 건설 명령, 비용 처리, 일일 진행, 완공 처리 파사드.
// 건설 상태는 S_BuildState.js가 소유한다.
// 재고·화폐는 S_EcoState.js API로만 변경한다.
// 건물 레벨은 S_DevState.js API로만 변경한다.
// GameClock을 직접 구독하지 않는다.
// ============================================================
(function () {
    "use strict";

    const VERSION = 3;
    const LISTENERS = new Set();

    const CONSTRUCTION_JOB_SOURCE_ID = "construction";
    const CONSTRUCTION_LABOR_TYPE_ID = "laborers";

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

    function positiveInteger(value, fallback) {
        return Math.max(
            1,
            Math.floor(
                finite(value, fallback)
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

    function constructionState() {
        return (
            window.ArsSettlementConstructionState ||
            null
        );
    }

    function economyState() {
        return (
            window.ArsSettlementEconomyState ||
            null
        );
    }

    function developmentState() {
        return (
            window.ArsSettlementDevelopmentState ||
            null
        );
    }

    function buildingCatalog() {
        return (
            window.ArsSettlementBuildingCatalog ||
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

    function worldMapData() {
        return (
            window.ArsWorldMapData ||
            null
        );
    }

    function emit(action, settlementId, payload) {
        const event = {
            type: "settlement_construction",
            action: cleanId(action) || "updated",
            settlementId: cleanId(settlementId),
            payload: clone(payload || {})
        };

        LISTENERS.forEach(function (listener) {
            try {
                listener(
                    clone(event)
                );
            } catch (error) {
                console.error(
                    "[Ars Bellum] 건설 시스템 구독자 오류:",
                    error
                );
            }
        });
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

    function strictNonNegativeInteger(value) {
        const number = Number(value);

        if (
            !Number.isFinite(number) ||
            number < 0
        ) {
            return null;
        }

        return Math.floor(number);
    }

    function makeEmptyLaborMap() {
        const labor =
            laborTypes();

        if (
            labor &&
            typeof labor.makeEmptyMap ===
                "function"
        ) {
            return labor.makeEmptyMap();
        }

        return {
            peasants: 0,
            laborers: 0,
            artisans: 0,
            merchants: 0,
            administrators: 0,
            guards: 0,
            soldiers: 0,
            clergy: 0,
            nobles: 0
        };
    }

    function makeConstructionJobMap(amount) {
        const map =
            makeEmptyLaborMap();

        map[CONSTRUCTION_LABOR_TYPE_ID] =
            Math.max(
                0,
                Math.floor(
                    finite(amount, 0)
                )
            );

        return map;
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

    function getPopulationJobSources(
        settlementId
    ) {
        const population =
            populationSystem();

        if (
            !population ||
            typeof population.getJobSources !==
                "function"
        ) {
            return null;
        }

        return population.getJobSources(
            cleanId(settlementId)
        );
    }

    function sumNonConstructionLaborerJobs(
        sources
    ) {
        if (!isRecord(sources)) {
            return 0;
        }

        return Object.keys(sources)
            .filter(function (sourceId) {
                return (
                    sourceId !==
                    CONSTRUCTION_JOB_SOURCE_ID
                );
            })
            .reduce(function (total, sourceId) {
                const source =
                    isRecord(sources[sourceId])
                        ? sources[sourceId]
                        : {};

                return (
                    total +
                    Math.max(
                        0,
                        Math.floor(
                            finite(
                                source[
                                    CONSTRUCTION_LABOR_TYPE_ID
                                ],
                                0
                            )
                        )
                    )
                );
            }, 0);
    }

    function calculateAvailableConstructionWorkforce(
        settlementId,
        options
    ) {
        const id =
            cleanId(settlementId);

        const population =
            populationSystem();

        if (
            !population ||
            typeof population.getSnapshot !==
                "function" ||
            typeof population.getJobSources !==
                "function" ||
            typeof population.recalculateLabor !==
                "function"
        ) {
            return fail(
                "population_system_api_missing",
                {
                    available: 0
                }
            );
        }

        if (
            !options ||
            options.recalculate !== false
        ) {
            const recalculated =
                population.recalculateLabor(id);

            if (
                !recalculated ||
                !recalculated.ok
            ) {
                return fail(
                    "labor_recalculation_failed",
                    {
                        available: 0,
                        detail:
                            recalculated || null
                    }
                );
            }
        }

        const snapshot =
            population.getSnapshot(id);

        const sources =
            population.getJobSources(id);

        if (
            !snapshot ||
            !isRecord(snapshot.labor) ||
            !isRecord(
                snapshot.labor.supplyByType
            ) ||
            !isRecord(sources)
        ) {
            return fail(
                "population_labor_state_missing",
                {
                    available: 0
                }
            );
        }

        const laborerSupply =
            Math.max(
                0,
                Math.floor(
                    finite(
                        snapshot.labor
                            .supplyByType[
                            CONSTRUCTION_LABOR_TYPE_ID
                        ],
                        0
                    )
                )
            );

        const nonConstructionJobs =
            sumNonConstructionLaborerJobs(
                sources
            );

        const available =
            Math.max(
                0,
                laborerSupply -
                nonConstructionJobs
            );

        return {
            ok: true,
            settlementId: id,
            laborType:
                CONSTRUCTION_LABOR_TYPE_ID,
            laborerSupply:
                laborerSupply,
            nonConstructionJobs:
                nonConstructionJobs,
            available:
                available
        };
    }

    function restoreConstructionJobSource(
        settlementId,
        previousJobs
    ) {
        const population =
            populationSystem();

        if (
            !population ||
            typeof population.setJobSource !==
                "function"
        ) {
            return false;
        }

        population.setJobSource(
            cleanId(settlementId),
            CONSTRUCTION_JOB_SOURCE_ID,
            previousJobs ||
                makeConstructionJobMap(0)
        );

        if (
            typeof population.recalculateLabor ===
                "function"
        ) {
            population.recalculateLabor(
                cleanId(settlementId)
            );
        }

        return true;
    }

    function applyConstructionJobSource(
        settlementId,
        amount
    ) {
        const id =
            cleanId(settlementId);

        const population =
            populationSystem();

        if (
            !population ||
            typeof population.getJobSources !==
                "function" ||
            typeof population.setJobSource !==
                "function" ||
            typeof population.recalculateLabor !==
                "function"
        ) {
            return fail(
                "population_system_api_missing"
            );
        }

        const sources =
            population.getJobSources(id) ||
            {};

        const previousJobs =
            clone(
                sources[
                    CONSTRUCTION_JOB_SOURCE_ID
                ] ||
                makeConstructionJobMap(0)
            );

        const jobs =
            makeConstructionJobMap(amount);

        const sourceResult =
            population.setJobSource(
                id,
                CONSTRUCTION_JOB_SOURCE_ID,
                jobs
            );

        if (
            !sourceResult ||
            !sourceResult.ok
        ) {
            return fail(
                "construction_job_source_update_failed",
                {
                    detail:
                        sourceResult || null
                }
            );
        }

        const laborResult =
            population.recalculateLabor(id);

        if (
            !laborResult ||
            !laborResult.ok
        ) {
            restoreConstructionJobSource(
                id,
                previousJobs
            );

            return fail(
                "labor_recalculation_failed",
                {
                    detail:
                        laborResult || null
                }
            );
        }

        return {
            ok: true,
            settlementId: id,
            sourceId:
                CONSTRUCTION_JOB_SOURCE_ID,
            previousJobs:
                previousJobs,
            jobs:
                clone(jobs),
            labor:
                clone(laborResult.labor),
            revision:
                laborResult.revision
        };
    }

    function syncConstructionWorkforce(
        settlementId,
        requestedAmount,
        options
    ) {
        const id =
            cleanId(settlementId);

        const requested =
            strictNonNegativeInteger(
                requestedAmount
            );

        if (requested === null) {
            return fail(
                "invalid_workforce",
                {
                    requested:
                        requestedAmount
                }
            );
        }

        const stateApi =
            constructionState();

        if (
            !stateApi ||
            typeof stateApi.getSnapshot !==
                "function" ||
            typeof stateApi.setWorkforce !==
                "function"
        ) {
            return fail(
                "construction_state_api_missing"
            );
        }

        const state =
            stateApi.getSnapshot(id);

        if (!state) {
            return fail(
                "invalid_settlement"
            );
        }

        const availability =
            calculateAvailableConstructionWorkforce(
                id,
                options
            );

        if (
            !availability ||
            !availability.ok
        ) {
            return availability;
        }

        const hasPendingWork =
            Array.isArray(state.queue) &&
            state.queue.length > 0;

        const assigned =
            hasPendingWork
                ? Math.min(
                    requested,
                    availability.available
                )
                : 0;

        const previousWorkforce =
            strictNonNegativeInteger(
                state.workforce
            ) || 0;

        const sourceResult =
            applyConstructionJobSource(
                id,
                assigned
            );

        if (
            !sourceResult ||
            !sourceResult.ok
        ) {
            return sourceResult;
        }

        let stateResult = {
            ok: true,
            settlementId: id,
            previous:
                previousWorkforce,
            current:
                previousWorkforce,
            revision:
                state.revision
        };

        if (
            previousWorkforce !==
            assigned
        ) {
            stateResult =
                stateApi.setWorkforce(
                    id,
                    assigned
                );

            if (
                !stateResult ||
                !stateResult.ok
            ) {
                restoreConstructionJobSource(
                    id,
                    sourceResult.previousJobs
                );

                return fail(
                    "construction_workforce_update_failed",
                    {
                        detail:
                            stateResult || null
                    }
                );
            }
        }

        const result = {
            ok: true,
            settlementId: id,
            requested:
                requested,
            available:
                availability.available,
            assigned:
                assigned,
            capped:
                assigned < requested,
            hasPendingWork:
                hasPendingWork,
            previous:
                previousWorkforce,
            current:
                assigned,
            workforceRevision:
                stateResult.revision,
            populationRevision:
                sourceResult.revision,
            jobs:
                sourceResult.jobs
        };

        if (
            !options ||
            options.emit !== false
        ) {
            emit(
                "workforce_changed",
                id,
                result
            );
        }

        return result;
    }

    function refreshConstructionWorkforce(
        settlementId,
        options
    ) {
        const state =
            getSnapshot(
                settlementId
            );

        if (!state) {
            return fail(
                "invalid_settlement"
            );
        }

        return syncConstructionWorkforce(
            settlementId,
            state.workforce,
            options
        );
    }

    function getStaticSettlement(
        settlementId
    ) {
        const data = worldMapData();

        if (
            !data ||
            !data.settlements
        ) {
            return null;
        }

        const list =
            Array.isArray(
                data.settlements
            )
                ? data.settlements
                : isRecord(
                    data.settlements
                )
                    ? Object.values(
                        data.settlements
                    )
                    : [];

        const id = cleanId(
            settlementId
        );

        return (
            list.find(function (entry) {
                return (
                    entry &&
                    cleanId(entry.id) === id
                );
            }) ||
            null
        );
    }

    function initializeFromWorldData() {
        const stateApi =
            constructionState();

        if (
            !stateApi ||
            typeof stateApi
                .initializeFromWorldData !==
                "function"
        ) {
            return [];
        }

        return (
            stateApi
                .initializeFromWorldData() ||
            []
        );
    }

    function ensureSettlementState(
        settlementId
    ) {
        const stateApi =
            constructionState();

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
            constructionState();

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
            constructionState();

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
        const stateApi =
            constructionState();

        if (
            !stateApi ||
            typeof stateApi.getSnapshot !==
                "function"
        ) {
            return null;
        }

        return stateApi.getSnapshot(
            cleanId(settlementId)
        );
    }

    function getBuilding(
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

    function getCurrentLevel(
        settlementId,
        buildingId
    ) {
        const stateApi =
            developmentState();

        if (
            !stateApi ||
            typeof stateApi
                .getBuildingLevel !==
                "function"
        ) {
            return 0;
        }

        return Math.max(
            0,
            Math.floor(
                finite(
                    stateApi.getBuildingLevel(
                        cleanId(
                            settlementId
                        ),
                        cleanId(
                            buildingId
                        )
                    ),
                    0
                )
            )
        );
    }

    function getProjectedLevel(
        settlementId,
        buildingId
    ) {
        const id =
            cleanId(buildingId);

        const snapshot =
            getSnapshot(settlementId);

        let level =
            getCurrentLevel(
                settlementId,
                id
            );

        if (
            !snapshot ||
            !Array.isArray(snapshot.queue)
        ) {
            return level;
        }

        snapshot.queue
            .filter(function (job) {
                return (
                    job.buildingId === id &&
                    (
                        job.status === "queued" ||
                        job.status === "active"
                    )
                );
            })
            .some(function (job) {
                if (
                    job.fromLevel !== level ||
                    job.targetLevel !==
                        level + 1
                ) {
                    return true;
                }

                level =
                    job.targetLevel;

                return false;
            });

        return level;
    }

    function checkPlacement(
        settlementId,
        buildingId
    ) {
        const catalog =
            buildingCatalog();

        if (
            !catalog ||
            typeof catalog
                .checkPlacement !==
                "function"
        ) {
            return {
                allowed: true,
                reasons: [],
                warnings: []
            };
        }

        const settlement =
            getStaticSettlement(
                settlementId
            );

        if (!settlement) {
            return {
                allowed: true,
                reasons: [],
                warnings: [
                    "정적 거점 정보가 없어 배치 검사를 생략했습니다."
                ]
            };
        }

        return (
            catalog.checkPlacement(
                cleanId(buildingId),
                settlement
            ) || {
                allowed: true,
                reasons: [],
                warnings: []
            }
        );
    }

    function preview(
        settlementId,
        buildingId
    ) {
        const settlementIdValue =
            cleanId(settlementId);

        const buildingIdValue =
            cleanId(buildingId);

        if (
            !settlementIdValue ||
            !ensureSettlementState(
                settlementIdValue
            )
        ) {
            return fail(
                "invalid_settlement",
                {
                    settlementId:
                        settlementIdValue
                }
            );
        }

        const building =
            getBuilding(
                buildingIdValue
            );

        if (!building) {
            return fail(
                "unknown_building",
                {
                    buildingId:
                        buildingIdValue
                }
            );
        }

        const catalog =
            buildingCatalog();

        if (
            !catalog ||
            typeof catalog
                .getConstructionCost !==
                "function" ||
            typeof catalog
                .getConstructionDays !==
                "function" ||
            typeof catalog
                .getWorkRequired !==
                "function"
        ) {
            return fail(
                "building_catalog_api_missing"
            );
        }

        const fromLevel =
            getProjectedLevel(
                settlementIdValue,
                buildingIdValue
            );

        const targetLevel =
            fromLevel + 1;

        if (
            targetLevel >
            building.maxLevel
        ) {
            return fail(
                "max_level",
                {
                    buildingId:
                        buildingIdValue,
                    currentLevel:
                        fromLevel,
                    maximum:
                        building.maxLevel
                }
            );
        }

        const placement =
            checkPlacement(
                settlementIdValue,
                buildingIdValue
            );

        if (
            placement &&
            placement.allowed === false
        ) {
            return fail(
                "placement_blocked",
                {
                    buildingId:
                        buildingIdValue,
                    placement:
                        clone(placement)
                }
            );
        }

        const cost =
            catalog.getConstructionCost(
                buildingIdValue,
                targetLevel
            );

        const minimumDays =
            catalog.getConstructionDays(
                buildingIdValue,
                targetLevel
            );

        const requiredWork =
            catalog.getWorkRequired(
                buildingIdValue,
                targetLevel
            );

        if (
            !cost ||
            !Number.isFinite(
                minimumDays
            ) ||
            !Number.isFinite(
                requiredWork
            )
        ) {
            return fail(
                "construction_definition_invalid",
                {
                    buildingId:
                        buildingIdValue,
                    targetLevel:
                        targetLevel
                }
            );
        }

        return {
            ok: true,

            settlementId:
                settlementIdValue,

            buildingId:
                buildingIdValue,

            buildingName:
                building.name,

            fromLevel:
                fromLevel,

            targetLevel:
                targetLevel,

            cost:
                clone(cost),

            requiredWork:
                Math.max(
                    1,
                    round(
                        requiredWork,
                        4
                    )
                ),

            minimumDays:
                positiveInteger(
                    minimumDays,
                    1
                ),

            placement:
                clone(placement)
        };
    }

    function canAfford(
        settlementId,
        cost
    ) {
        const economy =
            economyState();

        if (
            !economy ||
            typeof economy
                .canAffordCost !==
                "function"
        ) {
            return fail(
                "economy_state_api_missing",
                {
                    affordable: false
                }
            );
        }

        return economy.canAffordCost(
            cleanId(settlementId),
            cost
        );
    }

    function enqueue(
        settlementId,
        buildingId
    ) {
        const settlementIdValue =
            cleanId(settlementId);

        const plan =
            preview(
                settlementIdValue,
                buildingId
            );

        if (!plan.ok) {
            return plan;
        }

        const economy =
            economyState();

        const stateApi =
            constructionState();

        if (
            !economy ||
            typeof economy.payCost !==
                "function"
        ) {
            return fail(
                "economy_state_api_missing"
            );
        }

        if (
            !stateApi ||
            typeof stateApi
                .reserveJobId !==
                "function" ||
            typeof stateApi
                .enqueueJob !==
                "function"
        ) {
            return fail(
                "construction_state_api_missing"
            );
        }

        const affordability =
            canAfford(
                settlementIdValue,
                plan.cost
            );

        if (
            !affordability ||
            !affordability.ok
        ) {
            return Object.assign(
                {},
                affordability || {},
                {
                    ok: false,
                    affordable: false,
                    reason:
                        affordability &&
                        affordability.reason
                            ? affordability.reason
                            : "affordability_check_failed"
                }
            );
        }

        if (!affordability.affordable) {
            return Object.assign(
                {},
                affordability,
                {
                    ok: false,
                    reason:
                        "insufficient_cost",
                    affordable: false
                }
            );
        }

        const payment =
            economy.payCost(
                settlementIdValue,
                plan.cost,
                {
                    source:
                        "SettlementConstructionSystem",
                    action:
                        "enqueue_construction",
                    buildingId:
                        plan.buildingId,
                    targetLevel:
                        plan.targetLevel
                }
            );

        if (
            !payment ||
            !payment.ok
        ) {
            return Object.assign(
                {
                    ok: false,
                    reason:
                        "payment_failed"
                },
                payment || {}
            );
        }

        const reservation =
            stateApi.reserveJobId(
                settlementIdValue
            );

        if (
            !reservation ||
            !reservation.ok
        ) {
            economy.refundCost(
                settlementIdValue,
                plan.cost,
                1,
                {
                    source:
                        "SettlementConstructionSystem",
                    action:
                        "enqueue_rollback"
                }
            );

            return fail(
                "job_id_reservation_failed"
            );
        }

        const job = {
            id:
                reservation.jobId,

            buildingId:
                plan.buildingId,

            fromLevel:
                plan.fromLevel,

            targetLevel:
                plan.targetLevel,

            status:
                "queued",

            cost:
                clone(plan.cost),

            requiredWork:
                plan.requiredWork,

            progressWork:
                0,

            minimumDays:
                plan.minimumDays,

            elapsedDays:
                0,

            queuedDay:
                Math.max(
                    1,
                    Math.floor(
                        finite(
                            getState(
                                settlementIdValue
                            )
                                .lastProcessedDay,
                            1
                        )
                    )
                ),

            startedDay:
                null,

            finishedDay:
                null
        };

        const queued =
            stateApi.enqueueJob(
                settlementIdValue,
                job
            );

        if (
            !queued ||
            !queued.ok
        ) {
            economy.refundCost(
                settlementIdValue,
                plan.cost,
                1,
                {
                    source:
                        "SettlementConstructionSystem",
                    action:
                        "enqueue_rollback",
                    jobId:
                        reservation.jobId
                }
            );

            return fail(
                "enqueue_state_failed",
                {
                    detail:
                        queued || null
                }
            );
        }

        const workforceSync =
            refreshConstructionWorkforce(
                settlementIdValue,
                {
                    emit: false
                }
            );

        if (
            !workforceSync ||
            !workforceSync.ok
        ) {
            console.error(
                "[Ars Bellum] 건설 일자리 동기화 실패:",
                workforceSync
            );
        }

        emit(
            "construction_enqueued",
            settlementIdValue,
            {
                job:
                    queued.job,
                workforce:
                    workforceSync || null
            }
        );

        return {
            ok: true,
            settlementId:
                settlementIdValue,
            job:
                clone(queued.job),
            workforce:
                clone(
                    workforceSync || null
                )
        };
    }

    function cancelSingleJob(
        settlementId,
        job,
        options
    ) {
        const id =
            cleanId(settlementId);

        const stateApi =
            constructionState();

        const economy =
            economyState();

        if (
            !stateApi ||
            typeof stateApi.archiveJob !==
                "function"
        ) {
            return fail(
                "construction_state_api_missing"
            );
        }

        if (
            !economy ||
            typeof economy.refundCost !==
                "function" ||
            typeof economy.payCost !==
                "function"
        ) {
            return fail(
                "economy_state_api_missing"
            );
        }

        if (
            !job ||
            (
                job.status !== "queued" &&
                job.status !== "active"
            )
        ) {
            return fail(
                "job_not_cancellable",
                {
                    jobId:
                        job && job.id
                            ? job.id
                            : ""
                }
            );
        }

        const settings =
            isRecord(options)
                ? options
                : {};

        const refundRate =
            job.status === "queued"
                ? 1
                : 0.5;

        const refund =
            economy.refundCost(
                id,
                job.cost,
                refundRate,
                {
                    source:
                        "SettlementConstructionSystem",
                    action:
                        settings.action ||
                        "cancel_construction",
                    reason:
                        settings.reason ||
                        "manual_cancel",
                    jobId:
                        job.id,
                    buildingId:
                        job.buildingId,
                    cascaded:
                        settings.cascaded === true
                }
            );

        if (
            !refund ||
            !refund.ok
        ) {
            return fail(
                "refund_failed",
                {
                    jobId:
                        job.id,
                    detail:
                        refund || null
                }
            );
        }

        const state =
            getState(id);

        const archived =
            stateApi.archiveJob(
                id,
                job.id,
                "cancelled",
                state
                    ? state.lastProcessedDay
                    : 1
            );

        if (
            !archived ||
            !archived.ok
        ) {
            const rollback =
                economy.payCost(
                    id,
                    refund.refunded,
                    {
                        source:
                            "SettlementConstructionSystem",
                        action:
                            "cancel_rollback",
                        jobId:
                            job.id
                    }
                );

            return fail(
                "cancel_state_failed",
                {
                    jobId:
                        job.id,
                    detail:
                        archived || null,
                    rollback:
                        rollback || null
                }
            );
        }

        const result = {
            ok: true,
            settlementId: id,
            job:
                clone(archived.job),
            refundRate:
                refundRate,
            refunded:
                clone(refund.refunded),
            reason:
                settings.reason ||
                "manual_cancel",
            cascaded:
                settings.cascaded === true
        };

        emit(
            "construction_cancelled",
            id,
            result
        );

        return result;
    }

    function cancelDependentJobs(
        settlementId,
        buildingId,
        minimumFromLevel,
        options
    ) {
        const id =
            cleanId(settlementId);

        const buildingIdValue =
            cleanId(buildingId);

        const threshold =
            Math.max(
                0,
                Math.floor(
                    finite(
                        minimumFromLevel,
                        0
                    )
                )
            );

        const settings =
            isRecord(options)
                ? options
                : {};

        const excluded =
            new Set(
                Array.isArray(settings.excludeJobIds)
                    ? settings.excludeJobIds.map(cleanId)
                    : []
            );

        const snapshot =
            getSnapshot(id);

        if (
            !snapshot ||
            !Array.isArray(snapshot.queue)
        ) {
            return fail(
                "invalid_settlement"
            );
        }

        const dependentJobs =
            snapshot.queue
                .filter(function (job) {
                    return (
                        job.buildingId ===
                            buildingIdValue &&
                        job.fromLevel >=
                            threshold &&
                        !excluded.has(job.id) &&
                        (
                            job.status === "queued" ||
                            job.status === "active"
                        )
                    );
                })
                .sort(function (left, right) {
                    return (
                        right.fromLevel -
                        left.fromLevel
                    );
                });

        const results = [];

        dependentJobs.forEach(
            function (job) {
                results.push(
                    cancelSingleJob(
                        id,
                        job,
                        {
                            action:
                                "cancel_dependent_construction",
                            reason:
                                settings.reason ||
                                "predecessor_cancelled",
                            cascaded: true
                        }
                    )
                );
            }
        );

        return {
            ok:
                results.every(
                    function (result) {
                        return (
                            result &&
                            result.ok
                        );
                    }
                ),
            settlementId: id,
            buildingId:
                buildingIdValue,
            minimumFromLevel:
                threshold,
            cancelled:
                results.filter(
                    function (result) {
                        return (
                            result &&
                            result.ok
                        );
                    }
                ).length,
            results:
                results
        };
    }

    function cancelInvalidJobChain(
        settlementId,
        job,
        reason
    ) {
        if (!job) {
            return fail(
                "job_not_found"
            );
        }

        const primary =
            cancelSingleJob(
                settlementId,
                job,
                {
                    action:
                        "cancel_invalid_construction",
                    reason:
                        reason ||
                        "building_level_mismatch",
                    cascaded: false
                }
            );

        if (
            !primary ||
            !primary.ok
        ) {
            return primary;
        }

        const dependents =
            cancelDependentJobs(
                settlementId,
                job.buildingId,
                job.targetLevel,
                {
                    reason:
                        reason ||
                        "building_level_mismatch",
                    excludeJobIds: [
                        job.id
                    ]
                }
            );

        const workforce =
            refreshConstructionWorkforce(
                settlementId,
                {
                    emit: false
                }
            );

        return {
            ok:
                primary.ok &&
                dependents.ok &&
                workforce.ok,
            settlementId:
                cleanId(settlementId),
            primary:
                primary,
            dependents:
                dependents,
            workforce:
                workforce
        };
    }

    function cancel(
        settlementId,
        jobId
    ) {
        const settlementIdValue =
            cleanId(settlementId);

        const jobIdValue =
            cleanId(jobId);

        const stateApi =
            constructionState();

        if (
            !stateApi ||
            typeof stateApi.getJob !==
                "function"
        ) {
            return fail(
                "construction_state_api_missing"
            );
        }

        const job =
            stateApi.getJob(
                settlementIdValue,
                jobIdValue
            );

        if (
            !job ||
            (
                job.status !== "queued" &&
                job.status !== "active"
            )
        ) {
            return fail(
                "job_not_found",
                {
                    jobId:
                        jobIdValue
                }
            );
        }

        const primary =
            cancelSingleJob(
                settlementIdValue,
                job,
                {
                    action:
                        "cancel_construction",
                    reason:
                        "manual_cancel",
                    cascaded: false
                }
            );

        if (
            !primary ||
            !primary.ok
        ) {
            return primary;
        }

        const dependents =
            cancelDependentJobs(
                settlementIdValue,
                job.buildingId,
                job.targetLevel,
                {
                    reason:
                        "predecessor_cancelled",
                    excludeJobIds: [
                        job.id
                    ]
                }
            );

        const workforce =
            refreshConstructionWorkforce(
                settlementIdValue,
                {
                    emit: false
                }
            );

        if (
            !dependents.ok ||
            !workforce.ok
        ) {
            return fail(
                "dependent_cancel_or_workforce_sync_failed",
                {
                    settlementId:
                        settlementIdValue,
                    job:
                        primary.job,
                    dependents:
                        dependents,
                    workforce:
                        workforce
                }
            );
        }

        return {
            ok: true,
            settlementId:
                settlementIdValue,
            job:
                clone(primary.job),
            refundRate:
                primary.refundRate,
            refunded:
                clone(primary.refunded),
            dependentCancellations:
                clone(dependents.results),
            workforce:
                clone(workforce)
        };
    }

    function setWorkforce(
        settlementId,
        amount
    ) {
        return syncConstructionWorkforce(
            cleanId(settlementId),
            amount,
            {
                emit: true
            }
        );
    }

    function activateNextValidJob(
        settlementId,
        day
    ) {
        const id =
            cleanId(settlementId);

        const stateApi =
            constructionState();

        if (
            !stateApi ||
            typeof stateApi.activateNextJob !==
                "function"
        ) {
            return fail(
                "construction_state_api_missing"
            );
        }

        let snapshot =
            getSnapshot(id);

        if (!snapshot) {
            return fail(
                "invalid_settlement"
            );
        }

        const maximumAttempts =
            Math.max(
                1,
                snapshot.queue.length + 1
            );

        for (
            let attempt = 0;
            attempt < maximumAttempts;
            attempt += 1
        ) {
            snapshot =
                getSnapshot(id);

            if (!snapshot) {
                return fail(
                    "invalid_settlement"
                );
            }

            let candidate = null;

            if (snapshot.activeJobId) {
                candidate =
                    snapshot.queue.find(
                        function (job) {
                            return (
                                job.id ===
                                snapshot.activeJobId
                            );
                        }
                    ) || null;
            }

            if (!candidate) {
                candidate =
                    snapshot.queue.find(
                        function (job) {
                            return (
                                job.status ===
                                "queued"
                            );
                        }
                    ) || null;
            }

            if (!candidate) {
                return {
                    ok: true,
                    activated: false,
                    job: null,
                    revision:
                        snapshot.revision
                };
            }

            const currentLevel =
                getCurrentLevel(
                    id,
                    candidate.buildingId
                );

            if (
                currentLevel !==
                candidate.fromLevel
            ) {
                const cancelled =
                    cancelInvalidJobChain(
                        id,
                        candidate,
                        "start_level_mismatch"
                    );

                if (
                    !cancelled ||
                    !cancelled.ok
                ) {
                    return fail(
                        "invalid_job_chain_cancel_failed",
                        {
                            job:
                                clone(candidate),
                            currentLevel:
                                currentLevel,
                            detail:
                                cancelled || null
                        }
                    );
                }

                continue;
            }

            const activation =
                stateApi.activateNextJob(
                    id,
                    day
                );

            if (
                !activation ||
                !activation.ok
            ) {
                return fail(
                    "job_activation_failed",
                    {
                        detail:
                            activation || null
                    }
                );
            }

            if (activation.job) {
                const verifiedLevel =
                    getCurrentLevel(
                        id,
                        activation.job
                            .buildingId
                    );

                if (
                    verifiedLevel !==
                    activation.job.fromLevel
                ) {
                    const cancelled =
                        cancelInvalidJobChain(
                            id,
                            activation.job,
                            "activation_level_mismatch"
                        );

                    if (
                        !cancelled ||
                        !cancelled.ok
                    ) {
                        return fail(
                            "activated_job_level_mismatch",
                            {
                                job:
                                    clone(
                                        activation.job
                                    ),
                                currentLevel:
                                    verifiedLevel,
                                detail:
                                    cancelled || null
                            }
                        );
                    }

                    continue;
                }
            }

            return activation;
        }

        return fail(
            "no_valid_construction_job"
        );
    }

    function completeJob(
        settlementId,
        job,
        day
    ) {
        const id =
            cleanId(settlementId);

        const development =
            developmentState();

        const stateApi =
            constructionState();

        if (
            !development ||
            typeof development.getBuildingLevel !==
                "function" ||
            typeof development.adjustBuildingLevel !==
                "function"
        ) {
            return fail(
                "development_state_api_missing"
            );
        }

        if (
            !stateApi ||
            typeof stateApi.archiveJob !==
                "function"
        ) {
            return fail(
                "construction_state_api_missing"
            );
        }

        const currentLevel =
            getCurrentLevel(
                id,
                job.buildingId
            );

        if (
            currentLevel !==
            job.fromLevel
        ) {
            const cancellation =
                cancelInvalidJobChain(
                    id,
                    job,
                    "completion_level_mismatch"
                );

            if (
                !cancellation ||
                !cancellation.ok
            ) {
                return fail(
                    "completion_level_mismatch",
                    {
                        job:
                            clone(job),
                        currentLevel:
                            currentLevel,
                        expectedLevel:
                            job.fromLevel,
                        cancellation:
                            cancellation || null
                    }
                );
            }

            return {
                ok: true,
                completed: false,
                cancelled: true,
                reason:
                    "completion_level_mismatch",
                settlementId: id,
                currentLevel:
                    currentLevel,
                expectedLevel:
                    job.fromLevel,
                cancellation:
                    cancellation
            };
        }

        if (
            job.targetLevel !==
            job.fromLevel + 1
        ) {
            const cancellation =
                cancelInvalidJobChain(
                    id,
                    job,
                    "invalid_level_step"
                );

            if (
                !cancellation ||
                !cancellation.ok
            ) {
                return fail(
                    "invalid_level_step",
                    {
                        job:
                            clone(job),
                        cancellation:
                            cancellation || null
                    }
                );
            }

            return {
                ok: true,
                completed: false,
                cancelled: true,
                reason:
                    "invalid_level_step",
                settlementId: id,
                cancellation:
                    cancellation
            };
        }

        const levelResult =
            development.adjustBuildingLevel(
                id,
                job.buildingId,
                1
            );

        if (
            !levelResult ||
            !levelResult.ok ||
            levelResult.previousLevel !==
                job.fromLevel ||
            levelResult.currentLevel !==
                job.targetLevel
        ) {
            if (
                levelResult &&
                levelResult.ok &&
                levelResult.currentLevel ===
                    job.targetLevel
            ) {
                development.adjustBuildingLevel(
                    id,
                    job.buildingId,
                    -1
                );
            }

            return fail(
                "building_level_update_failed",
                {
                    detail:
                        levelResult || null,
                    job:
                        clone(job)
                }
            );
        }

        const archived =
            stateApi.archiveJob(
                id,
                job.id,
                "completed",
                day
            );

        if (
            !archived ||
            !archived.ok
        ) {
            const rollback =
                development.adjustBuildingLevel(
                    id,
                    job.buildingId,
                    -1
                );

            return fail(
                "completion_archive_failed",
                {
                    detail:
                        archived || null,
                    rollback:
                        rollback || null
                }
            );
        }

        const workforce =
            refreshConstructionWorkforce(
                id,
                {
                    emit: false
                }
            );

        if (
            !workforce ||
            !workforce.ok
        ) {
            console.error(
                "[Ars Bellum] 건설 완공 후 노동 동기화 실패:",
                workforce
            );
        }

        emit(
            "construction_completed",
            id,
            {
                job:
                    archived.job,
                workforce:
                    workforce || null
            }
        );

        return {
            ok: true,
            completed: true,
            job:
                clone(archived.job),
            workforce:
                clone(workforce || null)
        };
    }

    function processSettlementDay(
        settlementId,
        dayValue
    ) {
        const settlementIdValue =
            cleanId(settlementId);

        const day =
            positiveInteger(
                dayValue,
                1
            );

        const stateApi =
            constructionState();

        if (
            !stateApi ||
            typeof stateApi
                .activateNextJob !==
                "function" ||
            typeof stateApi
                .addActiveProgress !==
                "function" ||
            typeof stateApi
                .setLastProcessedDay !==
                "function"
        ) {
            return fail(
                "construction_state_api_missing"
            );
        }

        const before =
            getState(
                settlementIdValue
            );

        if (!before) {
            return fail(
                "invalid_settlement"
            );
        }

        if (
            day <=
            before.lastProcessedDay
        ) {
            return {
                ok: true,
                processed: false,
                reason:
                    "already_processed",
                settlementId:
                    settlementIdValue,
                day:
                    day
            };
        }

        const activation =
            activateNextValidJob(
                settlementIdValue,
                day
            );

        if (
            !activation ||
            !activation.ok
        ) {
            return fail(
                "job_activation_failed",
                {
                    detail:
                        activation || null
                }
            );
        }

        const activeJob =
            activation.job;

        if (!activeJob) {
            const workforceSync =
                syncConstructionWorkforce(
                    settlementIdValue,
                    0,
                    {
                        emit: false
                    }
                );

            if (
                !workforceSync ||
                !workforceSync.ok
            ) {
                return fail(
                    "construction_workforce_sync_failed",
                    {
                        detail:
                            workforceSync || null
                    }
                );
            }

            stateApi.setLastProcessedDay(
                settlementIdValue,
                day
            );

            return {
                ok: true,
                processed: true,
                worked: false,
                completed: false,
                reason:
                    "empty_queue",
                settlementId:
                    settlementIdValue,
                day:
                    day,
                workforce: 0,
                addedWork: 0
            };
        }

        const currentState =
            getState(
                settlementIdValue
            );

        const workforceSync =
            syncConstructionWorkforce(
                settlementIdValue,
                currentState
                    ? currentState.workforce
                    : 0,
                {
                    emit: false
                }
            );

        if (
            !workforceSync ||
            !workforceSync.ok
        ) {
            return fail(
                "construction_workforce_sync_failed",
                {
                    detail:
                        workforceSync || null
                }
            );
        }

        const workforce =
            workforceSync.assigned;

        const progressResult =
            stateApi.addActiveProgress(
                settlementIdValue,
                workforce,
                1
            );

        if (
            !progressResult ||
            !progressResult.ok
        ) {
            return fail(
                "progress_update_failed",
                {
                    detail:
                        progressResult || null
                }
            );
        }

        const progressedJob =
            progressResult.job;

        let completion = null;

        if (
            progressedJob.progressWork >=
                progressedJob.requiredWork &&
            progressedJob.elapsedDays >=
                progressedJob.minimumDays
        ) {
            completion =
                completeJob(
                    settlementIdValue,
                    progressedJob,
                    day
                );

            if (
                !completion ||
                !completion.ok
            ) {
                return completion;
            }
        }

        const dayResult =
            stateApi.setLastProcessedDay(
                settlementIdValue,
                day
            );

        if (
            !dayResult ||
            !dayResult.ok
        ) {
            return fail(
                "last_processed_day_update_failed",
                {
                    detail:
                        dayResult || null
                }
            );
        }

        const result = {
            ok: true,
            processed: true,
            worked:
                workforce > 0,
            completed:
                !!(
                    completion &&
                    completion.completed
                ),
            settlementId:
                settlementIdValue,
            day:
                day,
            workforce:
                workforce,
            requestedWorkforce:
                workforceSync.requested,
            availableWorkforce:
                workforceSync.available,
            addedWork:
                workforce,
            job:
                completion &&
                completion.job
                    ? clone(
                        completion.job
                    )
                    : clone(
                        progressedJob
                    )
        };

        emit(
            "construction_day_processed",
            settlementIdValue,
            result
        );

        return result;
    }

    function processToDay(dayValue) {
        const targetDay =
            positiveInteger(
                dayValue,
                1
            );

        const results = [];

        listSettlementIds().forEach(
            function (settlementId) {
                const state =
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
                    results.push({
                        settlementId:
                            settlementId,
                        day:
                            day,
                        result:
                            processSettlementDay(
                                settlementId,
                                day
                            )
                    });
                }
            }
        );

        return {
            ok: results.every(
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

    function validateAll() {
        const errors = [];

        const stateApi =
            constructionState();

        const economy =
            economyState();

        const development =
            developmentState();

        const catalog =
            buildingCatalog();

        if (!stateApi) {
            errors.push(
                "ArsSettlementConstructionState가 없습니다."
            );
        }

        if (!economy) {
            errors.push(
                "ArsSettlementEconomyState가 없습니다."
            );
        }

        if (!development) {
            errors.push(
                "ArsSettlementDevelopmentState가 없습니다."
            );
        }

        if (!catalog) {
            errors.push(
                "ArsSettlementBuildingCatalog가 없습니다."
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

        listSettlementIds().forEach(
            function (settlementId) {
                const snapshot =
                    getSnapshot(
                        settlementId
                    );

                if (!snapshot) {
                    errors.push(
                        settlementId +
                        ": 건설 상태가 없습니다."
                    );

                    return;
                }

                snapshot.queue.forEach(
                    function (job) {
                        if (
                            !getBuilding(
                                job.buildingId
                            )
                        ) {
                            errors.push(
                                settlementId +
                                ": 알 수 없는 건물 " +
                                job.buildingId
                            );
                        }

                        const check =
                            canAfford(
                                settlementId,
                                {
                                    gold: 0,
                                    resources:
                                        job.cost.resources
                                }
                            );

                        if (
                            check &&
                            check.reason ===
                                "unknown_resource"
                        ) {
                            errors.push(
                                settlementId +
                                ": 건설 작업의 알 수 없는 자원"
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
        const id = cleanId(
            settlementId
        );

        if (id) {
            const snapshot =
                getSnapshot(id);

            console.group(
                "[Ars Bellum] 건설 시스템: " +
                id
            );

            console.table(
                snapshot
                    ? snapshot.queue
                    : []
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

                        workforce:
                            snapshot
                                ? snapshot.workforce
                                : 0,

                        activeJobId:
                            snapshot
                                ? snapshot.activeJobId
                                : null,

                        queuedJobs:
                            snapshot
                                ? snapshot.queue.length
                                : 0,

                        completedOrCancelled:
                            snapshot
                                ? snapshot.history.length
                                : 0,

                        lastProcessedDay:
                            snapshot
                                ? snapshot.lastProcessedDay
                                : 0
                    };
                }
            );

        console.group(
            "[Ars Bellum] 전체 건설 시스템"
        );

        console.table(summary);

        console.log(
            "검사 오류:",
            validateAll()
        );

        console.groupEnd();

        return summary;
    }

    window.ArsSettlementConstruction =
        Object.freeze({
            version: VERSION,

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

            preview:
                preview,

            canAfford:
                canAfford,

            enqueue:
                enqueue,

            cancel:
                cancel,

            setWorkforce:
                setWorkforce,

            processSettlementDay:
                processSettlementDay,

            processToDay:
                processToDay,

            subscribe:
                subscribe,

            validateAll:
                validateAll,

            debugPrint:
                debugPrint
        });

    const initialized =
        initializeFromWorldData();

    const workforceSyncErrors = [];

    initialized.forEach(
        function (settlementId) {
            const result =
                refreshConstructionWorkforce(
                    settlementId,
                    {
                        emit: false
                    }
                );

            if (
                !result ||
                !result.ok
            ) {
                workforceSyncErrors.push(
                    settlementId +
                    ": 건설 노동 동기화 실패"
                );
            }
        }
    );

    const errors =
        validateAll().concat(
            workforceSyncErrors
        );

    if (errors.length) {
        console.error(
            "[Ars Bellum] SettlementConstructionSystem 검사 실패:",
            errors
        );
    } else {
        console.log(
            "[Ars Bellum] SettlementConstructionSystem 연결 완료 - 거점 " +
            initialized.length +
            "곳"
        );
    }
})();