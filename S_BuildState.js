// ============================================================
// Ars Bellum - S_BuildState.js
// 거점별 건설 대기열과 공사 상태의 유일한 저장소.
// 비용 처리, 건설 가능 여부, 공사 완료 처리는 담당하지 않는다.
// 선행: GameState.js, W_Data.js
// ============================================================
(function () {
    "use strict";

    const VERSION = 1;
    const STATE_KEY = "construction";
    const HISTORY_LIMIT = 50;
    const VALID_STATUSES = Object.freeze([
        "queued",
        "active",
        "completed",
        "cancelled"
    ]);

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

    function gameStateRoot() {
        const api = window.ArsGameState;

        if (
            !api ||
            typeof api.getState !== "function"
        ) {
            return null;
        }

        const state = api.getState();

        return isRecord(state)
            ? state
            : null;
    }

    function ensureWorldState() {
        const root = gameStateRoot();

        if (!root) {
            return null;
        }

        if (!isRecord(root.world)) {
            root.world = {};
        }

        if (!isRecord(root.world.settlements)) {
            root.world.settlements = {};
        }

        return root.world;
    }

    function normalizeCost(source) {
        const input = isRecord(source)
            ? source
            : {};

        const resources = {};

        if (isRecord(input.resources)) {
            Object.keys(
                input.resources
            ).forEach(function (resourceId) {
                const id = cleanId(
                    resourceId
                );

                const amount = round(
                    nonNegative(
                        input.resources[
                            resourceId
                        ]
                    ),
                    4
                );

                if (
                    id &&
                    amount > 0
                ) {
                    resources[id] = amount;
                }
            });
        }

        return {
            gold: round(
                nonNegative(
                    input.gold
                ),
                2
            ),

            resources: resources
        };
    }

    function normalizeStatus(value) {
        const status = cleanId(value);

        return VALID_STATUSES.indexOf(
            status
        ) !== -1
            ? status
            : "queued";
    }

    function normalizeJob(source) {
        if (!isRecord(source)) {
            return null;
        }

        const id = cleanId(source.id);
        const buildingId = cleanId(
            source.buildingId
        );

        if (
            !id ||
            !buildingId
        ) {
            return null;
        }

        const requiredWork = Math.max(
            1,
            round(
                nonNegative(
                    source.requiredWork
                ),
                4
            )
        );

        const progressWork = Math.min(
            requiredWork,
            round(
                nonNegative(
                    source.progressWork
                ),
                4
            )
        );

        const status = normalizeStatus(
            source.status
        );

        return {
            id: id,
            buildingId: buildingId,

            fromLevel: nonNegativeInteger(
                source.fromLevel
            ),

            targetLevel: positiveInteger(
                source.targetLevel,
                1
            ),

            status: status,

            cost: normalizeCost(
                source.cost
            ),

            requiredWork: requiredWork,
            progressWork: progressWork,

            minimumDays: positiveInteger(
                source.minimumDays,
                1
            ),

            elapsedDays: nonNegativeInteger(
                source.elapsedDays
            ),

            queuedDay: positiveInteger(
                source.queuedDay,
                1
            ),

            startedDay:
                source.startedDay === null ||
                source.startedDay === undefined
                    ? null
                    : positiveInteger(
                        source.startedDay,
                        1
                    ),

            finishedDay:
                source.finishedDay === null ||
                source.finishedDay === undefined
                    ? null
                    : positiveInteger(
                        source.finishedDay,
                        1
                    )
        };
    }

    function makeState() {
        return {
            version: VERSION,
            revision: 0,

            nextJobNumber: 1,
            workforce: 0,
            activeJobId: null,

            queue: [],
            history: [],

            lastProcessedDay: 1
        };
    }

    function normalizeState(source) {
        const input = isRecord(source)
            ? source
            : {};

        const queue = (
            Array.isArray(input.queue)
                ? input.queue
                : []
        )
            .map(normalizeJob)
            .filter(Boolean)
            .filter(function (job) {
                return (
                    job.status === "queued" ||
                    job.status === "active"
                );
            });

        const history = (
            Array.isArray(input.history)
                ? input.history
                : []
        )
            .map(normalizeJob)
            .filter(Boolean)
            .filter(function (job) {
                return (
                    job.status === "completed" ||
                    job.status === "cancelled"
                );
            })
            .slice(-HISTORY_LIMIT);

        let activeJobId = cleanId(
            input.activeJobId
        );

        let activeFound = false;

        queue.forEach(function (job) {
            if (
                job.status === "active" &&
                !activeFound
            ) {
                activeFound = true;
                activeJobId = job.id;
                return;
            }

            if (job.status === "active") {
                job.status = "queued";
                job.startedDay = null;
            }
        });

        if (
            activeJobId &&
            !queue.some(function (job) {
                return (
                    job.id === activeJobId &&
                    job.status === "active"
                );
            })
        ) {
            activeJobId = null;
        }

        return {
            version: VERSION,

            revision: nonNegativeInteger(
                input.revision
            ),

            nextJobNumber: positiveInteger(
                input.nextJobNumber,
                1
            ),

            workforce: round(
                nonNegative(
                    input.workforce
                ),
                4
            ),

            activeJobId: activeJobId || null,

            queue: queue,
            history: history,

            lastProcessedDay: positiveInteger(
                input.lastProcessedDay,
                1
            )
        };
    }

    function ensureSettlementRecord(
        settlementId
    ) {
        const id = cleanId(
            settlementId
        );

        const world = ensureWorldState();

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

        settlement[STATE_KEY] =
            normalizeState(
                settlement[STATE_KEY]
            );

        return settlement;
    }

    function emit(
        settlement,
        action,
        payload
    ) {
        const event = {
            type: "construction_state_changed",

            settlementId:
                settlement.id,

            revision:
                settlement[
                    STATE_KEY
                ].revision,

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
                        "[Ars Bellum] 건설 상태 구독자 오류:",
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
            settlement[
                STATE_KEY
            ].revision + 1;

        settlement[
            STATE_KEY
        ] = normalized;

        emit(
            settlement,
            action,
            payload
        );

        return normalized.revision;
    }

    function initializeFromWorldData() {
        const data =
            window.ArsWorldMapData;

        const source =
            data &&
            data.settlements;

        const settlements =
            Array.isArray(source)
                ? source
                : isRecord(source)
                    ? Object.values(source)
                    : [];

        const initialized = [];

        settlements.forEach(
            function (entry) {
                const settlementId =
                    cleanId(
                        entry &&
                        entry.id
                    );

                if (
                    settlementId &&
                    ensureSettlementRecord(
                        settlementId
                    )
                ) {
                    initialized.push(
                        settlementId
                    );
                }
            }
        );

        return initialized;
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
                settlement[
                    STATE_KEY
                ]
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

    function getState(
        settlementId
    ) {
        const settlement =
            ensureSettlementRecord(
                settlementId
            );

        return settlement
            ? clone(
                settlement[
                    STATE_KEY
                ]
            )
            : null;
    }

    function getSnapshot(
        settlementId
    ) {
        const settlement =
            ensureSettlementRecord(
                settlementId
            );

        if (!settlement) {
            return null;
        }

        const state =
            settlement[
                STATE_KEY
            ];

        return {
            settlementId:
                settlement.id,

            version:
                state.version,

            revision:
                state.revision,

            nextJobNumber:
                state.nextJobNumber,

            workforce:
                state.workforce,

            activeJobId:
                state.activeJobId,

            queue:
                clone(
                    state.queue
                ),

            history:
                clone(
                    state.history
                ),

            lastProcessedDay:
                state.lastProcessedDay
        };
    }

    function getJob(
        settlementId,
        jobId
    ) {
        const settlement =
            ensureSettlementRecord(
                settlementId
            );

        const id = cleanId(
            jobId
        );

        if (
            !settlement ||
            !id
        ) {
            return null;
        }

        const state =
            settlement[
                STATE_KEY
            ];

        const job =
            state.queue.find(
                function (entry) {
                    return entry.id === id;
                }
            ) ||
            state.history.find(
                function (entry) {
                    return entry.id === id;
                }
            );

        return job
            ? clone(job)
            : null;
    }

    function getActiveJob(
        settlementId
    ) {
        const settlement =
            ensureSettlementRecord(
                settlementId
            );

        if (!settlement) {
            return null;
        }

        const state =
            settlement[
                STATE_KEY
            ];

        if (!state.activeJobId) {
            return null;
        }

        const job =
            state.queue.find(
                function (entry) {
                    return (
                        entry.id ===
                        state.activeJobId
                    );
                }
            );

        return job
            ? clone(job)
            : null;
    }

    function reserveJobId(
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

        const state =
            clone(
                settlement[
                    STATE_KEY
                ]
            );

        const jobNumber =
            state.nextJobNumber;

        const jobId =
            settlement.id +
            "-construction-" +
            jobNumber;

        state.nextJobNumber += 1;

        commit(
            settlement,
            state,
            "reserve_job_id",
            {
                jobId: jobId,
                jobNumber: jobNumber
            }
        );

        return {
            ok: true,
            settlementId:
                settlement.id,
            jobId: jobId,
            jobNumber: jobNumber,
            revision:
                settlement[
                    STATE_KEY
                ].revision
        };
    }

    function enqueueJob(
        settlementId,
        jobData
    ) {
        const settlement =
            ensureSettlementRecord(
                settlementId
            );

        const job =
            normalizeJob(
                jobData
            );

        if (!settlement) {
            return fail(
                "invalid_settlement"
            );
        }

        if (!job) {
            return fail(
                "invalid_job"
            );
        }

        if (
            job.status !== "queued"
        ) {
            return fail(
                "job_must_be_queued"
            );
        }

        const state =
            clone(
                settlement[
                    STATE_KEY
                ]
            );

        const duplicate =
            state.queue.some(
                function (entry) {
                    return (
                        entry.id ===
                        job.id
                    );
                }
            ) ||
            state.history.some(
                function (entry) {
                    return (
                        entry.id ===
                        job.id
                    );
                }
            );

        if (duplicate) {
            return fail(
                "duplicate_job_id",
                {
                    jobId: job.id
                }
            );
        }

        state.queue.push(job);

        commit(
            settlement,
            state,
            "enqueue_job",
            {
                jobId: job.id,
                buildingId:
                    job.buildingId
            }
        );

        return {
            ok: true,
            settlementId:
                settlement.id,
            job: clone(job),
            revision:
                settlement[
                    STATE_KEY
                ].revision
        };
    }

    function activateNextJob(
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

        const state =
            clone(
                settlement[
                    STATE_KEY
                ]
            );

        if (state.activeJobId) {
            const active =
                state.queue.find(
                    function (entry) {
                        return (
                            entry.id ===
                            state.activeJobId
                        );
                    }
                );

            return {
                ok: true,
                activated: false,
                job: active
                    ? clone(active)
                    : null,
                revision:
                    state.revision
            };
        }

        const job =
            state.queue.find(
                function (entry) {
                    return (
                        entry.status ===
                        "queued"
                    );
                }
            );

        if (!job) {
            return {
                ok: true,
                activated: false,
                job: null,
                revision:
                    state.revision
            };
        }

        job.status = "active";
        job.startedDay =
            positiveInteger(
                dayValue,
                1
            );

        state.activeJobId =
            job.id;

        commit(
            settlement,
            state,
            "activate_job",
            {
                jobId: job.id,
                startedDay:
                    job.startedDay
            }
        );

        return {
            ok: true,
            activated: true,
            job: clone(job),
            revision:
                settlement[
                    STATE_KEY
                ].revision
        };
    }

    function addActiveProgress(
        settlementId,
        workAmount,
        elapsedDays
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

        const state =
            clone(
                settlement[
                    STATE_KEY
                ]
            );

        const activeJob =
            state.queue.find(
                function (entry) {
                    return (
                        entry.id ===
                        state.activeJobId
                    );
                }
            );

        if (!activeJob) {
            return fail(
                "active_job_not_found"
            );
        }

        const addedWork =
            round(
                nonNegative(
                    workAmount
                ),
                4
            );

        const addedDays =
            nonNegativeInteger(
                elapsedDays
            );

        activeJob.progressWork =
            Math.min(
                activeJob.requiredWork,
                round(
                    activeJob.progressWork +
                    addedWork,
                    4
                )
            );

        activeJob.elapsedDays +=
            addedDays;

        commit(
            settlement,
            state,
            "add_active_progress",
            {
                jobId:
                    activeJob.id,
                addedWork:
                    addedWork,
                addedDays:
                    addedDays,
                progressWork:
                    activeJob.progressWork,
                elapsedDays:
                    activeJob.elapsedDays
            }
        );

        return {
            ok: true,
            settlementId:
                settlement.id,
            job: clone(
                activeJob
            ),
            revision:
                settlement[
                    STATE_KEY
                ].revision
        };
    }

    function archiveJob(
        settlementId,
        jobId,
        status,
        finishedDay
    ) {
        const settlement =
            ensureSettlementRecord(
                settlementId
            );

        const id = cleanId(
            jobId
        );

        if (!settlement) {
            return fail(
                "invalid_settlement"
            );
        }

        if (
            status !== "completed" &&
            status !== "cancelled"
        ) {
            return fail(
                "invalid_archive_status"
            );
        }

        const state =
            clone(
                settlement[
                    STATE_KEY
                ]
            );

        const index =
            state.queue.findIndex(
                function (entry) {
                    return entry.id === id;
                }
            );

        if (index < 0) {
            return fail(
                "job_not_found",
                {
                    jobId: id
                }
            );
        }

        const job =
            state.queue[index];

        job.status = status;
        job.finishedDay =
            positiveInteger(
                finishedDay,
                1
            );

        if (status === "completed") {
            job.progressWork =
                job.requiredWork;
        }

        state.queue.splice(
            index,
            1
        );

        state.history.push(job);
        state.history =
            state.history.slice(
                -HISTORY_LIMIT
            );

        if (
            state.activeJobId ===
            job.id
        ) {
            state.activeJobId = null;
        }

        commit(
            settlement,
            state,
            status === "completed"
                ? "complete_job"
                : "cancel_job",
            {
                jobId: job.id,
                finishedDay:
                    job.finishedDay
            }
        );

        return {
            ok: true,
            settlementId:
                settlement.id,
            job: clone(job),
            revision:
                settlement[
                    STATE_KEY
                ].revision
        };
    }

    function setWorkforce(
        settlementId,
        amount
    ) {
        const settlement =
            ensureSettlementRecord(
                settlementId
            );

        const workforce =
            round(
                nonNegative(
                    amount
                ),
                4
            );

        if (!settlement) {
            return fail(
                "invalid_settlement"
            );
        }

        const state =
            clone(
                settlement[
                    STATE_KEY
                ]
            );

        const previous =
            state.workforce;

        state.workforce =
            workforce;

        commit(
            settlement,
            state,
            "set_workforce",
            {
                previous:
                    previous,
                current:
                    workforce
            }
        );

        return {
            ok: true,
            settlementId:
                settlement.id,
            previous:
                previous,
            current:
                workforce,
            revision:
                settlement[
                    STATE_KEY
                ].revision
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

        const day =
            positiveInteger(
                dayValue,
                1
            );

        const state =
            clone(
                settlement[
                    STATE_KEY
                ]
            );

        if (
            day <
            state.lastProcessedDay
        ) {
            return fail(
                "day_regression",
                {
                    currentDay:
                        state.lastProcessedDay,
                    requestedDay:
                        day
                }
            );
        }

        if (
            day ===
            state.lastProcessedDay
        ) {
            return {
                ok: true,
                changed: false,
                settlementId:
                    settlement.id,
                lastProcessedDay:
                    state.lastProcessedDay,
                revision:
                    state.revision
            };
        }

        state.lastProcessedDay =
            day;

        commit(
            settlement,
            state,
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
                settlement[
                    STATE_KEY
                ].revision
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
        const settlement =
            ensureSettlementRecord(
                settlementId
            );

        const errors = [];

        if (!settlement) {
            errors.push(
                cleanId(settlementId) +
                ": 건설 상태 없음"
            );

            return errors;
        }

        const state =
            settlement[
                STATE_KEY
            ];

        if (
            !Number.isInteger(
                state.revision
            ) ||
            state.revision < 0
        ) {
            errors.push(
                settlement.id +
                ": revision 오류"
            );
        }

        if (
            !Number.isFinite(
                state.workforce
            ) ||
            state.workforce < 0
        ) {
            errors.push(
                settlement.id +
                ": workforce 오류"
            );
        }

        if (
            !Number.isInteger(
                state.nextJobNumber
            ) ||
            state.nextJobNumber < 1
        ) {
            errors.push(
                settlement.id +
                ": nextJobNumber 오류"
            );
        }

        if (
            !Number.isInteger(
                state.lastProcessedDay
            ) ||
            state.lastProcessedDay < 1
        ) {
            errors.push(
                settlement.id +
                ": lastProcessedDay 오류"
            );
        }

        const ids = new Set();
        let activeCount = 0;

        state.queue
            .concat(state.history)
            .forEach(function (job) {
                if (ids.has(job.id)) {
                    errors.push(
                        settlement.id +
                        ": 건설 작업 ID 중복 " +
                        job.id
                    );
                }

                ids.add(job.id);

                if (
                    VALID_STATUSES.indexOf(
                        job.status
                    ) === -1
                ) {
                    errors.push(
                        settlement.id +
                        ": 작업 상태 오류 " +
                        job.id
                    );
                }

                if (
                    !Number.isFinite(
                        job.progressWork
                    ) ||
                    job.progressWork < 0 ||
                    job.progressWork >
                    job.requiredWork
                ) {
                    errors.push(
                        settlement.id +
                        ": 작업 진행량 오류 " +
                        job.id
                    );
                }

                if (
                    job.status ===
                    "active"
                ) {
                    activeCount += 1;
                }
            });

        if (activeCount > 1) {
            errors.push(
                settlement.id +
                ": 활성 건설 작업이 2개 이상"
            );
        }

        if (
            state.activeJobId &&
            !state.queue.some(
                function (job) {
                    return (
                        job.id ===
                        state.activeJobId &&
                        job.status ===
                        "active"
                    );
                }
            )
        ) {
            errors.push(
                settlement.id +
                ": activeJobId 불일치"
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
        const id = cleanId(
            settlementId
        );

        if (id) {
            const snapshot =
                getSnapshot(id);

            console.group(
                "[Ars Bellum] 건설 상태: " +
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
                            snapshot.workforce,

                        activeJobId:
                            snapshot.activeJobId,

                        queueLength:
                            snapshot.queue.length,

                        historyLength:
                            snapshot.history.length,

                        lastProcessedDay:
                            snapshot.lastProcessedDay,

                        revision:
                            snapshot.revision
                    };
                }
            );

        console.group(
            "[Ars Bellum] 전체 건설 상태"
        );

        console.table(summary);

        console.log(
            "검사 오류:",
            validateAll()
        );

        console.groupEnd();

        return summary;
    }

    window.ArsSettlementConstructionState =
        Object.freeze({
            version: VERSION,

            validStatuses:
                VALID_STATUSES,

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

            getJob:
                getJob,

            getActiveJob:
                getActiveJob,

            reserveJobId:
                reserveJobId,

            enqueueJob:
                enqueueJob,

            activateNextJob:
                activateNextJob,

            addActiveProgress:
                addActiveProgress,

            archiveJob:
                archiveJob,

            setWorkforce:
                setWorkforce,

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

    const initialized =
        initializeFromWorldData();

    const errors =
        validateAll();

    if (errors.length) {
        console.error(
            "[Ars Bellum] SettlementConstructionState 검사 실패:",
            errors
        );
    } else {
        console.log(
            "[Ars Bellum] SettlementConstructionState 연결 완료 - 거점 " +
            initialized.length +
            "곳"
        );
    }
})();