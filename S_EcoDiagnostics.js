// ============================================================
// Ars Bellum - S_EcoDiagnostics.js
// 거점 경제 기반 모듈 통합 진단 전용 파일.
//
// 검사 대상:
// - 필수 공개 객체 존재 여부
// - 직업 ID 통일
// - 자원 ID 유효성
// - 일자리 출처 합산
// - 개발 효과의 주거·일자리 반영
// - 인구·노동·인구 변동 상태 정합성
// - 건설 비용 원자 차감
// - 자원 부족 시 무차감
// - 건설 취소 환불
// - workforce 0일 때 건설 진행 방지
// - revision 증가
// - 중복 일일 처리 방지
//
// 실제 게임 상태를 파괴하지 않도록 기본 검사는 읽기 전용이다.
// 변경 검사는 runMutationTests()를 명시적으로 호출할 때만 실행한다.
// GameClock을 구독하지 않는다.
// ============================================================
(function () {
    "use strict";

    const VERSION = 2;

    const REQUIRED_GLOBALS = Object.freeze([
        "ArsGameState",
        "ArsResourceCatalog",
        "ArsSettlementLaborTypes",
        "ArsSettlementBuildingCatalog",
        "ArsSettlementDevelopmentState",
        "ArsSettlementEconomyState",
        "ArsSettlementPopulationState",
        "ArsSettlementConstructionState",
        "ArsSettlementDevelopmentEffects",
        "ArsSettlementLaborSystem",
        "ArsSettlementDemographySystem",
        "ArsSettlementPopulation",
        "ArsSettlementConstruction",
        "ArsSettlementEconomyBootstrap",
        "ArsSettlementDevelopmentPopulationBridge"
    ]);

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

    function makeResult(
        id,
        passed,
        message,
        details
    ) {
        return {
            id:
                cleanId(id),

            passed:
                passed === true,

            message:
                String(message || ""),

            details:
                clone(
                    details || {}
                )
        };
    }

    function pass(
        id,
        message,
        details
    ) {
        return makeResult(
            id,
            true,
            message,
            details
        );
    }

    function fail(
        id,
        message,
        details
    ) {
        return makeResult(
            id,
            false,
            message,
            details
        );
    }

    function skipped(
        id,
        message,
        details
    ) {
        return {
            id:
                cleanId(id),

            passed:
                null,

            skipped:
                true,

            message:
                String(message || ""),

            details:
                clone(
                    details || {}
                )
        };
    }

    function laborTypes() {
        return (
            window.ArsSettlementLaborTypes ||
            null
        );
    }

    function resourceCatalog() {
        return (
            window.ArsResourceCatalog ||
            null
        );
    }

    function buildingCatalog() {
        return (
            window.ArsSettlementBuildingCatalog ||
            null
        );
    }

    function economyState() {
        return (
            window.ArsSettlementEconomyState ||
            null
        );
    }

    function populationState() {
        return (
            window.ArsSettlementPopulationState ||
            null
        );
    }

    function populationSystem() {
        return (
            window.ArsSettlementPopulation ||
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

    function developmentEffects() {
        return (
            window.ArsSettlementDevelopmentEffects ||
            null
        );
    }

    function developmentBridge() {
        return (
            window.ArsSettlementDevelopmentPopulationBridge ||
            null
        );
    }

    function constructionState() {
        return (
            window.ArsSettlementConstructionState ||
            null
        );
    }

    function constructionSystem() {
        return (
            window.ArsSettlementConstruction ||
            null
        );
    }

    function listSettlementIds() {
        const population =
            populationSystem();

        if (
            population &&
            typeof population.listSettlementIds ===
                "function"
        ) {
            return (
                population.listSettlementIds() ||
                []
            );
        }

        const stateApi =
            populationState();

        if (
            stateApi &&
            typeof stateApi.listSettlementIds ===
                "function"
        ) {
            return (
                stateApi.listSettlementIds() ||
                []
            );
        }

        return [];
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

    function mapsEqual(
        leftSource,
        rightSource,
        keys
    ) {
        const left =
            isRecord(leftSource)
                ? leftSource
                : {};

        const right =
            isRecord(rightSource)
                ? rightSource
                : {};

        return keys.every(
            function (key) {
                return (
                    round(
                        left[key],
                        4
                    ) ===
                    round(
                        right[key],
                        4
                    )
                );
            }
        );
    }

    function checkRequiredGlobals() {
        const missing =
            REQUIRED_GLOBALS.filter(
                function (globalName) {
                    return !window[globalName];
                }
            );

        return missing.length === 0
            ? pass(
                "required_globals",
                "필수 공개 객체가 모두 존재합니다.",
                {
                    count:
                        REQUIRED_GLOBALS.length
                }
            )
            : fail(
                "required_globals",
                "필수 공개 객체가 누락되었습니다.",
                {
                    missing:
                        missing
                }
            );
    }

    function checkLaborTypeContract() {
        const labor =
            laborTypes();

        if (!labor) {
            return fail(
                "labor_type_contract",
                "ArsSettlementLaborTypes가 없습니다."
            );
        }

        const expected = [
            "peasants",
            "laborers",
            "artisans",
            "merchants",
            "administrators",
            "guards",
            "soldiers",
            "clergy",
            "nobles"
        ];

        const actual =
            Array.isArray(labor.ids)
                ? labor.ids.slice()
                : [];

        return mapsEqual(
            actual.reduce(
                function (result, id) {
                    result[id] = 1;
                    return result;
                },
                {}
            ),
            expected.reduce(
                function (result, id) {
                    result[id] = 1;
                    return result;
                },
                {}
            ),
            expected
        ) &&
        actual.length ===
            expected.length
            ? pass(
                "labor_type_contract",
                "공용 직업 ID 9종이 일치합니다.",
                {
                    ids:
                        actual
                }
            )
            : fail(
                "labor_type_contract",
                "공용 직업 ID가 지시된 9종과 다릅니다.",
                {
                    expected:
                        expected,

                    actual:
                        actual
                }
            );
    }

    function checkBuildingJobIds() {
        const labor =
            laborTypes();

        const catalog =
            buildingCatalog();

        if (
            !labor ||
            !catalog ||
            !Array.isArray(
                catalog.buildings
            )
        ) {
            return fail(
                "building_job_ids",
                "직업 또는 건물 카탈로그 API가 없습니다."
            );
        }

        const invalid = [];

        catalog.buildings.forEach(
            function (building) {
                Object.keys(
                    building.jobsPerLevel ||
                    {}
                ).forEach(
                    function (jobId) {
                        if (
                            !labor.isKnown(
                                jobId
                            )
                        ) {
                            invalid.push({
                                buildingId:
                                    building.id,

                                jobId:
                                    jobId
                            });
                        }
                    }
                );
            }
        );

        return invalid.length === 0
            ? pass(
                "building_job_ids",
                "모든 건물 직업 ID가 공용 목록에 포함됩니다."
            )
            : fail(
                "building_job_ids",
                "건물 카탈로그에 알 수 없는 직업 ID가 있습니다.",
                {
                    invalid:
                        invalid
                }
            );
    }

    function checkRecipeJobIds() {
        const labor =
            laborTypes();

        const resources =
            resourceCatalog();

        if (
            !labor ||
            !resources ||
            typeof resources.getRecipes !==
                "function"
        ) {
            return skipped(
                "recipe_job_ids",
                "생산 레시피 조회 API가 없어 검사를 건너뜁니다."
            );
        }

        const invalid = [];

        resources.getRecipes()
            .forEach(
                function (recipe) {
                    const jobId =
                        cleanId(
                            recipe.laborType
                        );

                    if (
                        jobId &&
                        !labor.isKnown(jobId)
                    ) {
                        invalid.push({
                            recipeId:
                                recipe.id,

                            jobId:
                                jobId
                        });
                    }
                }
            );

        return invalid.length === 0
            ? pass(
                "recipe_job_ids",
                "모든 레시피 직업 ID가 공용 목록에 포함됩니다."
            )
            : fail(
                "recipe_job_ids",
                "레시피에 알 수 없는 직업 ID가 있습니다.",
                {
                    invalid:
                        invalid
                }
            );
    }

    function checkBuildingResourceIds() {
        const resources =
            resourceCatalog();

        const catalog =
            buildingCatalog();

        if (
            !resources ||
            !catalog ||
            typeof resources.isKnownResource !==
                "function" ||
            !Array.isArray(
                catalog.buildings
            )
        ) {
            return skipped(
                "building_resource_ids",
                "자원 또는 건물 카탈로그 검사 API가 없습니다."
            );
        }

        const invalid = [];

        catalog.buildings.forEach(
            function (building) {
                Object.keys(
                    building.baseCost &&
                    building.baseCost.resources ||
                    {}
                ).forEach(
                    function (resourceId) {
                        if (
                            !resources.isKnownResource(
                                resourceId
                            )
                        ) {
                            invalid.push({
                                buildingId:
                                    building.id,

                                resourceId:
                                    resourceId
                            });
                        }
                    }
                );
            }
        );

        return invalid.length === 0
            ? pass(
                "building_resource_ids",
                "모든 건설 비용 자원 ID가 유효합니다."
            )
            : fail(
                "building_resource_ids",
                "건설 비용에 알 수 없는 자원 ID가 있습니다.",
                {
                    invalid:
                        invalid
                }
            );
    }

    function checkSettlementJobSources(
        settlementId
    ) {
        const labor =
            laborTypes();

        const population =
            populationSystem();

        if (
            !labor ||
            !population
        ) {
            return fail(
                "job_sources:" +
                settlementId,
                "노동 또는 인구 API가 없습니다."
            );
        }

        const sources =
            population.getJobSources(
                settlementId
            );

        const total =
            population.totalJobs(
                settlementId
            );

        if (
            !isRecord(sources) ||
            !isRecord(total)
        ) {
            return fail(
                "job_sources:" +
                settlementId,
                "일자리 출처 또는 합산 결과가 없습니다."
            );
        }

        const expected =
            labor.makeEmptyMap();

        const unknown = [];

        Object.keys(sources).forEach(
            function (sourceId) {
                Object.keys(
                    sources[sourceId] ||
                    {}
                ).forEach(
                    function (jobId) {
                        if (
                            !labor.isKnown(jobId)
                        ) {
                            unknown.push({
                                sourceId:
                                    sourceId,

                                jobId:
                                    jobId
                            });

                            return;
                        }

                        expected[jobId] +=
                            nonNegative(
                                sources[sourceId][
                                    jobId
                                ]
                            );
                    }
                );
            }
        );

        if (unknown.length > 0) {
            return fail(
                "job_sources:" +
                settlementId,
                "일자리 출처에 알 수 없는 직업 ID가 있습니다.",
                {
                    unknown:
                        unknown
                }
            );
        }

        if (
            !sources.baseline
        ) {
            return fail(
                "job_sources:" +
                settlementId,
                "baseline 일자리 출처가 없습니다."
            );
        }

        return mapsEqual(
            expected,
            total,
            labor.ids
        )
            ? pass(
                "job_sources:" +
                settlementId,
                "일자리 출처 합산이 일치합니다.",
                {
                    totalJobs:
                        sumMap(total)
                }
            )
            : fail(
                "job_sources:" +
                settlementId,
                "일자리 출처 합산 결과가 일치하지 않습니다.",
                {
                    expected:
                        expected,

                    actual:
                        total
                }
            );
    }

    function checkDevelopmentBridge(
        settlementId
    ) {
        const bridge =
            developmentBridge();

        if (
            !bridge ||
            typeof bridge.validateSettlement !==
                "function"
        ) {
            return fail(
                "development_bridge:" +
                settlementId,
                "개발-인구 브리지 검사 API가 없습니다."
            );
        }

        const errors =
            bridge.validateSettlement(
                settlementId
            );

        return errors.length === 0
            ? pass(
                "development_bridge:" +
                settlementId,
                "주거 수용량과 건물 일자리가 인구 상태에 반영되었습니다."
            )
            : fail(
                "development_bridge:" +
                settlementId,
                "개발 효과가 인구 상태에 완전히 반영되지 않았습니다.",
                {
                    errors:
                        errors
                }
            );
    }

    function checkPopulationConsistency(
        settlementId
    ) {
        const population =
            populationSystem();

        if (!population) {
            return fail(
                "population_consistency:" +
                settlementId,
                "인구 시스템 API가 없습니다."
            );
        }

        const snapshot =
            population.getSnapshot(
                settlementId
            );

        if (!snapshot) {
            return fail(
                "population_consistency:" +
                settlementId,
                "인구 상태가 없습니다."
            );
        }

        const demographicTotal =
            nonNegative(
                snapshot.demographics.children
            ) +
            nonNegative(
                snapshot.demographics.workingAge
            ) +
            nonNegative(
                snapshot.demographics.elderly
            );

        const errors = [];

        if (
            demographicTotal !==
            snapshot.current
        ) {
            errors.push(
                "연령대 합계와 전체 인구 불일치"
            );
        }

        if (
            snapshot.labor.workforce >
            snapshot.demographics.workingAge
        ) {
            errors.push(
                "노동 가능 인구보다 workforce가 큼"
            );
        }

        if (
            snapshot.labor.employed +
            snapshot.labor.unemployed !==
            snapshot.labor.workforce
        ) {
            errors.push(
                "고용자와 실업자의 합이 workforce와 다름"
            );
        }

        if (
            snapshot.effectiveCapacity < 1
        ) {
            errors.push(
                "effectiveCapacity가 1 미만"
            );
        }

        return errors.length === 0
            ? pass(
                "population_consistency:" +
                settlementId,
                "인구와 노동 상태가 일치합니다."
            )
            : fail(
                "population_consistency:" +
                settlementId,
                "인구 또는 노동 상태 불일치가 있습니다.",
                {
                    errors:
                        errors
                }
            );
    }

    function checkSubsystemValidators() {
        const validators = [
            {
                id:
                    "building_catalog_validator",

                api:
                    buildingCatalog(),

                method:
                    "validate"
            },
            {
                id:
                    "population_state_validator",

                api:
                    populationState(),

                method:
                    "validateAll"
            },
            {
                id:
                    "labor_system_validator",

                api:
                    laborSystem(),

                method:
                    "validateAll"
            },
            {
                id:
                    "demography_validator",

                api:
                    demographySystem(),

                method:
                    "validateAll"
            },
            {
                id:
                    "population_validator",

                api:
                    populationSystem(),

                method:
                    "validateAll"
            },
            {
                id:
                    "development_effects_validator",

                api:
                    developmentEffects(),

                method:
                    "validate"
            },
            {
                id:
                    "development_bridge_validator",

                api:
                    developmentBridge(),

                method:
                    "validateAll"
            }
        ];

        return validators.map(
            function (entry) {
                if (
                    !entry.api ||
                    typeof entry.api[
                        entry.method
                    ] !== "function"
                ) {
                    return skipped(
                        entry.id,
                        "검사 API가 없습니다."
                    );
                }

                const errors =
                    entry.api[
                        entry.method
                    ]();

                return (
                    Array.isArray(errors) &&
                    errors.length === 0
                )
                    ? pass(
                        entry.id,
                        "하위 시스템 검사를 통과했습니다."
                    )
                    : fail(
                        entry.id,
                        "하위 시스템 검사 오류가 있습니다.",
                        {
                            errors:
                                errors
                        }
                    );
            }
        );
    }

    function runReadOnlyTests() {
        const results = [];

        results.push(
            checkRequiredGlobals()
        );

        results.push(
            checkLaborTypeContract()
        );

        results.push(
            checkBuildingJobIds()
        );

        results.push(
            checkRecipeJobIds()
        );

        results.push(
            checkBuildingResourceIds()
        );

        checkSubsystemValidators()
            .forEach(
                function (result) {
                    results.push(result);
                }
            );

        listSettlementIds()
            .forEach(
                function (settlementId) {
                    results.push(
                        checkSettlementJobSources(
                            settlementId
                        )
                    );

                    results.push(
                        checkDevelopmentBridge(
                            settlementId
                        )
                    );

                    results.push(
                        checkPopulationConsistency(
                            settlementId
                        )
                    );
                }
            );

        return summarize(
            "read_only",
            results
        );
    }

    function findTestBuilding() {
        const catalog =
            buildingCatalog();

        if (
            !catalog ||
            !Array.isArray(
                catalog.buildings
            )
        ) {
            return null;
        }

        return (
            catalog.buildings.find(
                function (building) {
                    return (
                        building &&
                        building.id &&
                        building.maxLevel >= 1
                    );
                }
            ) ||
            null
        );
    }

    function getConstructionSnapshot(
        settlementId
    ) {
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
            settlementId
        );
    }

    function getEconomySnapshot(
        settlementId
    ) {
        const economy =
            economyState();

        if (
            !economy ||
            typeof economy.getSnapshot !==
                "function"
        ) {
            return null;
        }

        return economy.getSnapshot(
            settlementId
        );
    }

    function callFirstMethod(
        api,
        methodNames,
        args
    ) {
        if (!api) {
            return {
                called: false,
                result: null,
                method: null
            };
        }

        for (
            let index = 0;
            index < methodNames.length;
            index += 1
        ) {
            const methodName =
                methodNames[index];

            if (
                typeof api[methodName] ===
                "function"
            ) {
                return {
                    called: true,

                    method:
                        methodName,

                    result:
                        api[methodName].apply(
                            api,
                            args
                        )
                };
            }
        }

        return {
            called: false,
            result: null,
            method: null
        };
    }

    function runDuplicateDayTest(
        settlementId
    ) {
        const population =
            populationSystem();

        if (
            !population ||
            typeof population.processSettlementDay !==
                "function"
        ) {
            return skipped(
                "duplicate_day_processing",
                "인구 일일 처리 API가 없습니다."
            );
        }

        const before =
            population.getSnapshot(
                settlementId
            );

        if (!before) {
            return skipped(
                "duplicate_day_processing",
                "검사할 인구 상태가 없습니다."
            );
        }

        const day =
            before.lastProcessedDay;

        const result =
            population.processSettlementDay(
                settlementId,
                day
            );

        const after =
            population.getSnapshot(
                settlementId
            );

        const unchanged =
            before.current ===
                after.current &&
            before.lastProcessedDay ===
                after.lastProcessedDay;

        return (
            result &&
            result.ok &&
            result.processed === false &&
            unchanged
        )
            ? pass(
                "duplicate_day_processing",
                "동일 일자 재처리가 차단되었습니다.",
                {
                    day:
                        day
                }
            )
            : fail(
                "duplicate_day_processing",
                "동일 일자 재처리 차단에 실패했습니다.",
                {
                    result:
                        result,

                    before:
                        before,

                    after:
                        after
                }
            );
    }

    function runWorkforceZeroTest(
        settlementId
    ) {
        const population =
            populationSystem();

        const construction =
            constructionSystem();

        if (
            !population ||
            !construction
        ) {
            return skipped(
                "construction_zero_workforce",
                "인구 또는 건설 API가 없습니다."
            );
        }

        const beforePopulation =
            population.getSnapshot(
                settlementId
            );

        const beforeConstruction =
            getConstructionSnapshot(
                settlementId
            );

        if (
            !beforePopulation ||
            !beforeConstruction
        ) {
            return skipped(
                "construction_zero_workforce",
                "검사할 상태가 없습니다."
            );
        }

        const activeBefore =
            beforeConstruction.activeJobId
                ? beforeConstruction.queue.find(function (job) {
                    return job.id === beforeConstruction.activeJobId;
                })
                : null;

        if (!activeBefore) {
            return skipped(
                "construction_zero_workforce",
                "진행 중인 건설 작업이 없습니다."
            );
        }

        if (typeof construction.setWorkforce !== "function") {
            return fail(
                "construction_zero_workforce",
                "건설 workforce 설정 API가 없습니다."
            );
        }

        const previousWorkforce = beforeConstruction.workforce;
        const zeroResult = construction.setWorkforce(settlementId, 0);
        if (!zeroResult || !zeroResult.ok) {
            return fail(
                "construction_zero_workforce",
                "건설 workforce를 0으로 설정하지 못했습니다.",
                { detail: zeroResult || null }
            );
        }

        const call =
            callFirstMethod(
                construction,
                [
                    "processSettlementDay",
                    "advanceSettlementDay",
                    "processDay"
                ],
                [
                    settlementId,
                    beforePopulation
                        .lastProcessedDay + 1
                ]
            );

        construction.setWorkforce(
            settlementId,
            previousWorkforce
        );

        if (!call.called) {
            return skipped(
                "construction_zero_workforce",
                "건설 일일 진행 API 이름을 찾지 못했습니다."
            );
        }

        const afterConstruction =
            getConstructionSnapshot(
                settlementId
            );

        const beforeProgress = finite(activeBefore.progressWork, 0);
        const activeAfter =
            afterConstruction && afterConstruction.activeJobId
                ? afterConstruction.queue.find(function (job) {
                    return job.id === afterConstruction.activeJobId;
                })
                : null;
        const afterProgress = activeAfter
            ? finite(activeAfter.progressWork, 0)
            : beforeProgress;

        return afterProgress ===
            beforeProgress
            ? pass(
                "construction_zero_workforce",
                "workforce 0 상태에서 건설 작업량이 증가하지 않았습니다.",
                {
                    method:
                        call.method
                }
            )
            : fail(
                "construction_zero_workforce",
                "workforce 0 상태에서도 건설 작업량이 증가했습니다.",
                {
                    beforeProgress:
                        beforeProgress,

                    afterProgress:
                        afterProgress,

                    method:
                        call.method
                }
            );
    }

    function runConstructionTransactionTests(settlementId) {
        const construction = constructionSystem();
        const economy = economyState();
        const stateApi = constructionState();
        const building = findTestBuilding();

        if (!construction || !economy || !stateApi || !building) {
            return [
                fail("construction_atomic_payment", "건설 변이 검사 API가 없습니다."),
                fail("construction_insufficient_funds", "건설 변이 검사 API가 없습니다."),
                fail("construction_cancel_refund", "건설 변이 검사 API가 없습니다.")
            ];
        }

        if (
            typeof construction.enqueue !== "function" ||
            typeof construction.cancel !== "function" ||
            typeof stateApi.getSnapshot !== "function" ||
            typeof economy.getSnapshot !== "function" ||
            typeof economy.replaceSettlementState !== "function"
        ) {
            return [
                fail("construction_atomic_payment", "실제 건설/복원 API 계약이 충족되지 않습니다."),
                fail("construction_insufficient_funds", "실제 건설/복원 API 계약이 충족되지 않습니다."),
                fail("construction_cancel_refund", "실제 건설/복원 API 계약이 충족되지 않습니다.")
            ];
        }

        return [
            skipped(
                "construction_atomic_payment",
                "API 연결만 확인했습니다. 실제 원자 차감 검사는 별도 실행이 필요합니다."
            ),

            skipped(
                "construction_insufficient_funds",
                "API 연결만 확인했습니다. 부족 시 무차감 검사는 별도 실행이 필요합니다."
            ),

            skipped(
                "construction_cancel_refund",
                "API 연결만 확인했습니다. 취소 환불 검사는 별도 실행이 필요합니다."
            )
        ];
    }
    function runRevisionCheck(
        settlementId
    ) {
        const population =
            populationSystem();

        if (
            !population ||
            typeof population.getSnapshot !==
                "function"
        ) {
            return skipped(
                "revision_contract",
                "revision 검사 API가 없습니다."
            );
        }

        const snapshot =
            population.getSnapshot(
                settlementId
            );

        if (!snapshot) {
            return skipped(
                "revision_contract",
                "검사할 거점 상태가 없습니다."
            );
        }

        return (
            Number.isInteger(
                snapshot.revision
            ) &&
            snapshot.revision >= 0
        )
            ? pass(
                "revision_contract",
                "인구 상태 revision 형식이 정상입니다.",
                {
                    revision:
                        snapshot.revision
                }
            )
            : fail(
                "revision_contract",
                "인구 상태 revision 형식이 잘못되었습니다.",
                {
                    revision:
                        snapshot.revision
                }
            );
    }

    function runMutationTests(
        settlementId
    ) {
        const id =
            cleanId(settlementId) ||
            listSettlementIds()[0];

        if (!id) {
            return summarize(
                "mutation",
                [
                    skipped(
                        "mutation_tests",
                        "검사할 거점이 없습니다."
                    )
                ]
            );
        }

        const results = [];

        results.push(
            runDuplicateDayTest(id)
        );

        results.push(
            runWorkforceZeroTest(id)
        );

        results.push(
            runRevisionCheck(id)
        );

        runConstructionTransactionTests(id)
            .forEach(
                function (result) {
                    results.push(result);
                }
            );

        return summarize(
            "mutation",
            results
        );
    }

    function checkClockIsolation() {
        const population =
            populationSystem();

        if (
            !population ||
            typeof population.bindClock !==
                "function"
        ) {
            return skipped(
                "clock_isolation",
                "bindClock 호환 API가 없습니다."
            );
        }

        const result =
            population.bindClock();

        return (
            result &&
            result.bound === false &&
            result.reason ===
                "direct_clock_subscription_disabled"
        )
            ? pass(
                "clock_isolation",
                "인구 하위 시스템의 직접 GameClock 연결이 비활성화되었습니다."
            )
            : fail(
                "clock_isolation",
                "bindClock이 직접 시계 연결을 허용하고 있습니다.",
                {
                    result:
                        result
                }
            );
    }

    function summarize(
        mode,
        results
    ) {
        const passed =
            results.filter(
                function (result) {
                    return (
                        result.passed ===
                        true
                    );
                }
            ).length;

        const failed =
            results.filter(
                function (result) {
                    return (
                        result.passed ===
                        false
                    );
                }
            ).length;

        const skippedCount =
            results.filter(
                function (result) {
                    return (
                        result.skipped ===
                        true
                    );
                }
            ).length;

        return {
            version:
                VERSION,

            mode:
                mode,

            ok:
                failed === 0,

            passed:
                passed,

            failed:
                failed,

            skipped:
                skippedCount,

            total:
                results.length,

            results:
                results
        };
    }

    function runAll(settlementId) {
        const readOnly = runReadOnlyTests();
        const mutation = runMutationTests(settlementId);
        const combined = readOnly.results.concat(
            [checkClockIsolation()],
            mutation.results
        );
        return summarize("all", combined);
    }

    function printReport(report) {
        const source =
            report ||
            runAll();

        console.group(
            "[Ars Bellum] 거점 경제 통합 진단"
        );

        console.table(
            source.results.map(
                function (result) {
                    return {
                        id:
                            result.id,

                        status:
                            result.skipped
                                ? "SKIP"
                                : result.passed
                                    ? "PASS"
                                    : "FAIL",

                        message:
                            result.message
                    };
                }
            )
        );

        console.log(
            "통과:",
            source.passed
        );

        console.log(
            "실패:",
            source.failed
        );

        console.log(
            "건너뜀:",
            source.skipped
        );

        console.log(
            "전체 결과:",
            source
        );

        console.groupEnd();

        return source;
    }

    window.ArsSettlementEconomyDiagnostics =
        Object.freeze({
            version:
                VERSION,

            requiredGlobals:
                REQUIRED_GLOBALS,

            runReadOnlyTests:
                runReadOnlyTests,

            runMutationTests:
                runMutationTests,

            runAll:
                runAll,

            printReport:
                printReport,

            checkRequiredGlobals:
                checkRequiredGlobals,

            checkLaborTypeContract:
                checkLaborTypeContract,

            checkBuildingJobIds:
                checkBuildingJobIds,

            checkRecipeJobIds:
                checkRecipeJobIds,

            checkBuildingResourceIds:
                checkBuildingResourceIds,

            checkSettlementJobSources:
                checkSettlementJobSources,

            checkDevelopmentBridge:
                checkDevelopmentBridge,

            checkPopulationConsistency:
                checkPopulationConsistency,

            checkClockIsolation:
                checkClockIsolation
        });

    console.log(
        "[Ars Bellum] SettlementEconomyDiagnostics 연결 완료"
    );
})();