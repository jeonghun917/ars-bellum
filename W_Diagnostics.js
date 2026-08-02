(function () {
    "use strict";

    const TEST_ZONE_ID =
        "__diagnostic_forest_zone__";

    function result(
        name,
        passed,
        detail
    ) {
        return {
            name: name,
            passed: Boolean(passed),
            detail: detail || ""
        };
    }

    function closeEnough(
        a,
        b
    ) {
        return (
            Math.abs(
                Number(a) -
                Number(b)
            ) <= 0.001
        );
    }

    function dependencyTests() {
        return [
            result(
                "GameState 연결",
                Boolean(
                    window.ArsGameState
                ),
                window.ArsGameState
                    ? "정상"
                    : "없음"
            ),

            result(
                "WorldMapData 연결",
                Boolean(
                    window
                        .ArsWorldMapData
                ),
                window
                    .ArsWorldMapData
                    ? "정상"
                    : "없음"
            ),

            result(
                "WorldTerrainTypes 연결",
                Boolean(
                    window
                        .ArsWorldTerrainTypes
                ),
                window
                    .ArsWorldTerrainTypes
                    ? "정상"
                    : "없음"
            ),

            result(
                "WorldTerrainMap 연결",
                Boolean(
                    window
                        .ArsWorldTerrainMap
                ),
                window
                    .ArsWorldTerrainMap
                    ? "정상"
                    : "없음"
            ),

            result(
                "WorldMapSystem 연결",
                Boolean(
                    window
                        .ArsWorldMapSystem
                ),
                window
                    .ArsWorldMapSystem
                    ? "정상"
                    : "없음"
            ),

            result(
                "WorldRoutePlanner 연결",
                Boolean(
                    window
                        .ArsWorldRoutePlanner
                ),
                window
                    .ArsWorldRoutePlanner
                    ? "정상"
                    : "없음"
            )
        ];
    }

    function gameStateTests() {
        if (
            !window.ArsGameState ||
            !window.playerEconomy ||
            !window.playerParty
        ) {
            return [
                result(
                    "플레이어 중앙 장부",
                    false,
                    "필요 객체 없음"
                )
            ];
        }

        const results = [];

        const originalGold =
            Number(
                window
                    .playerEconomy
                    .gold
            );

        const originalFood =
            Number(
                window
                    .playerEconomy
                    .food
            );

        try {
            window
                .playerEconomy
                .gold =
                originalGold + 17;

            results.push(
                result(
                    "금화 별명 동기화",

                    Number(
                        window
                            .playerParty
                            .gold
                    ) ===
                        originalGold +
                            17,

                    "경제와 월드 부대 비교"
                )
            );

            window
                .playerParty
                .food =
                originalFood + 3;

            results.push(
                result(
                    "식량 별명 동기화",

                    Number(
                        window
                            .playerEconomy
                            .food
                    ) ===
                        originalFood +
                            3,

                    "월드 부대와 경제 비교"
                )
            );
        } finally {
            window
                .playerEconomy
                .gold =
                originalGold;

            window
                .playerEconomy
                .food =
                originalFood;
        }

        return results;
    }

    function mapDataTests() {
        const data =
            window
                .ArsWorldMapData;

        if (!data) {
            return [
                result(
                    "월드 데이터 검사",
                    false,
                    "데이터 없음"
                )
            ];
        }

        const validationErrors =
            typeof data.validate ===
            "function"
                ? data.validate()
                : [
                    "validate 함수 없음"
                ];

        const ids =
            Array.isArray(
                data.settlements
            )
                ? data.settlements
                    .map(
                        function (
                            settlement
                        ) {
                            return settlement.id;
                        }
                    )
                : [];

        const uniqueIds =
            new Set(ids);

        const roadEndsExist =
            Array.isArray(
                data.roads
            ) &&
            data.roads.every(
                function (road) {
                    return (
                        Boolean(
                            data
                                .getSettlementById(
                                    road
                                        .fromSettlementId
                                )
                        ) &&
                        Boolean(
                            data
                                .getSettlementById(
                                    road
                                        .toSettlementId
                                )
                        )
                    );
                }
            );

        return [
            result(
                "월드 데이터 자체 검사",

                Array.isArray(
                    validationErrors
                ) &&
                    validationErrors
                        .length === 0,

                validationErrors
                    .length === 0
                    ? "오류 없음"
                    : validationErrors
                        .join(" | ")
            ),

            result(
                "거점 ID 중복 없음",

                ids.length ===
                    uniqueIds.size,

                ids.length +
                    "개 검사"
            ),

            result(
                "도로 양끝 거점 존재",

                roadEndsExist,

                Array.isArray(
                    data.roads
                )
                    ? data.roads
                        .length +
                        "개 검사"
                    : "도로 없음"
            )
        ];
    }

    function terrainTypeTests() {
        const types =
            window
                .ArsWorldTerrainTypes;

        if (
            !types ||
            typeof types
                .getTravelProfile !==
                "function"
        ) {
            return [
                result(
                    "지형 규칙 검사",
                    false,
                    "규칙표 없음"
                )
            ];
        }

        const plain =
            types
                .getTravelProfile(
                    "plain"
                );

        const road =
            types
                .getTravelProfile(
                    "plain",
                    "road"
                );

        const mountain =
            types
                .getTravelProfile(
                    "mountain"
                );

        const pass =
            types
                .getTravelProfile(
                    "mountain",
                    "mountain_pass"
                );

        const river =
            types
                .getTravelProfile(
                    "river"
                );

        const bridge =
            types
                .getTravelProfile(
                    "river",
                    "bridge"
                );

        const desert =
            types
                .getTravelProfile(
                    "desert"
                );

        const oasis =
            types
                .getTravelProfile(
                    "desert",
                    null,
                    ["oasis"]
                );

        return [
            result(
                "평원 기본 속도",

                plain.passable &&
                closeEnough(
                    plain.speedMult,
                    1
                ),

                "배율 " +
                    plain.speedMult
            ),

            result(
                "도로가 평원보다 빠름",

                road.passable &&
                road.speedMult >
                    plain.speedMult,

                plain.speedMult +
                    " → " +
                    road.speedMult
            ),

            result(
                "산맥 단독 통행 불가",

                mountain.passable ===
                    false &&
                mountain.speedMult ===
                    0,

                "통행 " +
                    mountain.passable
            ),

            result(
                "산맥+산길 통행 가능",

                pass.passable ===
                    true &&
                pass.speedMult > 0,

                "배율 " +
                    pass.speedMult
            ),

            result(
                "강 단독 통행 불가",

                river.passable ===
                    false,

                "통행 " +
                    river.passable
            ),

            result(
                "강+다리 통행 가능",

                bridge.passable ===
                    true &&
                bridge.speedMult > 0,

                "배율 " +
                    bridge.speedMult
            ),

            result(
                "오아시스 보급 부담 완화",

                oasis.foodMult <
                    desert.foodMult,

                desert.foodMult +
                    " → " +
                    oasis.foodMult
            )
        ];
    }

    function terrainMapTests() {
        const terrainMap =
            window
                .ArsWorldTerrainMap;

        if (!terrainMap) {
            return [
                result(
                    "지형 지도 검사",
                    false,
                    "지도 없음"
                )
            ];
        }

        const results = [];

        const plainCell =
            terrainMap.getCellAt(
                100,
                100
            );

        const outsideCell =
            terrainMap.getCellAt(
                -10,
                -10
            );

        results.push(
            result(
                "미등록 지역은 평원",

                plainCell.baseId ===
                    "plain",

                plainCell.baseId
            )
        );

        results.push(
            result(
                "맵 밖은 바다",

                outsideCell.baseId ===
                    "sea" &&
                outsideCell
                    .outsideMap ===
                    true,

                outsideCell.baseId
            )
        );

        if (
            terrainMap
                .getZoneById(
                    TEST_ZONE_ID
                )
        ) {
            terrainMap
                .removeZone(
                    TEST_ZONE_ID
                );
        }

        const added =
            terrainMap.addZone({
                id:
                    TEST_ZONE_ID,

                name:
                    "진단용 숲",

                priority:
                    999,

                baseId:
                    "forest",

                shape: {
                    type:
                        "circle",

                    x:
                        120,

                    y:
                        120,

                    radius:
                        25
                },

                source:
                    "diagnostic"
            });

        const forestCell =
            terrainMap.getCellAt(
                120,
                120
            );

        results.push(
            result(
                "지형 구역 추가·판정",

                Boolean(added) &&
                forestCell.baseId ===
                    "forest",

                forestCell.baseId
            )
        );

        terrainMap.removeZone(
            TEST_ZONE_ID
        );

        results.push(
            result(
                "진단 구역 제거",

                !terrainMap
                    .getZoneById(
                        TEST_ZONE_ID
                    ),

                "영구 변경 없음"
            )
        );

        return results;
    }

    function mapSystemTests() {
        const system =
            window
                .ArsWorldMapSystem;

        const data =
            window
                .ArsWorldMapData;

        if (
            !system ||
            !data ||
            !Array.isArray(
                data.roads
            ) ||
            data.roads.length === 0
        ) {
            return [
                result(
                    "이동 시스템 검사",
                    false,
                    "시스템 또는 도로 없음"
                )
            ];
        }

        const road =
            data.roads[0];

        const from =
            data.getSettlementById(
                road.fromSettlementId
            );

        const to =
            data.getSettlementById(
                road.toSettlementId
            );

        if (
            !from ||
            !to
        ) {
            return [
                result(
                    "이동 시스템 검사",
                    false,
                    "도로 거점 없음"
                )
            ];
        }

        const middleX =
            (
                Number(from.x) +
                Number(to.x)
            ) / 2;

        const middleY =
            (
                Number(from.y) +
                Number(to.y)
            ) / 2;

        const roadAt =
            system.getRoadAt(
                middleX,
                middleY
            );

        const profile =
            system
                .getTravelProfileAt(
                    middleX,
                    middleY
                );

        return [
            result(
                "도로 중간점 판정",

                roadAt &&
                roadAt.id ===
                    road.id,

                roadAt
                    ? roadAt.id
                    : "도로 없음"
            ),

            result(
                "도로 이동속도 보너스",

                profile &&
                profile.profile &&
                profile.profile
                    .speedMult > 1,

                profile &&
                profile.profile
                    ? profile.profile
                        .speedMult
                    : "프로필 없음"
            )
        ];
    }

    function routePlannerTests() {
        const planner =
            window
                .ArsWorldRoutePlanner;

        const data =
            window
                .ArsWorldMapData;

        if (
            !planner ||
            !data ||
            !Array.isArray(
                data.roads
            ) ||
            data.roads.length === 0
        ) {
            return [
                result(
                    "경로 계획 검사",
                    false,
                    "플래너 또는 도로 없음"
                )
            ];
        }

        const road =
            data.roads[0];

        const from =
            data.getSettlementById(
                road.fromSettlementId
            );

        const to =
            data.getSettlementById(
                road.toSettlementId
            );

        const plan =
            planner.previewRoute(
                Number(from.x),
                Number(from.y),
                to.id
            );

        return [
            result(
                "거점 간 도로 경로 생성",

                Boolean(plan),

                plan
                    ? plan.roadIds
                        .join(" → ")
                    : "경로 없음"
            ),

            result(
                "최종 경유점 목적 거점",

                Boolean(
                    plan &&
                    plan.waypoints
                        .length > 0 &&
                    plan.waypoints[
                        plan.waypoints
                            .length - 1
                    ].final &&
                    plan.waypoints[
                        plan.waypoints
                            .length - 1
                    ].settlementId ===
                        to.id
                ),

                plan
                    ? plan.waypoints
                        .length +
                        "개"
                    : "계획 없음"
            )
        ];
    }

    function livePlayerTests() {
        const party =
            window.playerParty;

        if (!party) {
            return [
                result(
                    "현재 플레이어 검사",
                    false,
                    "playerParty 없음"
                )
            ];
        }

        const values = [
            party.worldX,
            party.worldY,
            party.targetX,
            party.targetY,
            party.speed
        ];

        const finite =
            values.every(
                function (value) {
                    return Number
                        .isFinite(
                            Number(value)
                        );
                }
            );

        return [
            result(
                "플레이어 월드 좌표 정상",

                finite,

                "(" +
                    party.worldX +
                    ", " +
                    party.worldY +
                    ")"
            ),

            result(
                "플레이어 자원 음수 아님",

                Number(
                    party.gold
                ) >= 0 &&
                Number(
                    party.food
                ) >= 0,

                "금화 " +
                    party.gold +
                    ", 식량 " +
                    party.food
            )
        ];
    }

    function collectAll() {
        return []
            .concat(
                dependencyTests()
            )
            .concat(
                gameStateTests()
            )
            .concat(
                mapDataTests()
            )
            .concat(
                terrainTypeTests()
            )
            .concat(
                terrainMapTests()
            )
            .concat(
                mapSystemTests()
            )
            .concat(
                routePlannerTests()
            )
            .concat(
                livePlayerTests()
            );
    }

    function printResults(results) {
        const passed =
            results.filter(
                function (item) {
                    return item.passed;
                }
            ).length;

        const failed =
            results.length -
            passed;

        console.group(
            "[Ars Bellum] 월드 시스템 자동 검사 - " +
            passed +
            "/" +
            results.length +
            " 통과"
        );

        results.forEach(
            function (item) {
                const prefix =
                    item.passed
                        ? "✅"
                        : "❌";

                const method =
                    item.passed
                        ? "log"
                        : "error";

                console[method](
                    prefix +
                    " " +
                    item.name +
                    (
                        item.detail
                            ? " — " +
                              item.detail
                            : ""
                    )
                );
            }
        );

        console.groupEnd();

        if (failed === 0) {
            console.log(
                "[Ars Bellum] 월드 시스템 핵심 검사 전부 통과"
            );
        } else {
            console.error(
                "[Ars Bellum] 월드 시스템 검사 실패 " +
                failed +
                "개"
            );
        }

        return {
            passed:
                passed,

            failed:
                failed,

            total:
                results.length,

            results:
                results
        };
    }

    window.ArsWorldDiagnostics = {
        version: 1,

        runAll:
            function () {
                return printResults(
                    collectAll()
                );
            },

        quickCheck:
            function () {
                return printResults(
                    dependencyTests()
                        .concat(
                            livePlayerTests()
                        )
                );
            },

        collectAllTests:
            collectAll
    };

    console.log(
        "[Ars Bellum] WorldSystemDiagnostics 연결 완료 - 콘솔에서 ArsWorldDiagnostics.runAll() 실행"
    );
})();