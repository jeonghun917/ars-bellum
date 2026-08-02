// ============================================================
// Ars Bellum - W_Data.js
// 월드맵의 거점, 지역, 도로 데이터를 한곳에서 관리한다.
// Campaign.js는 이 데이터를 읽어서 그리기만 한다.
// ============================================================

(function () {
    "use strict";

    const DATA_VERSION = 1;

    // --------------------------------------------------------
    // 1. 월드맵 전체 규격
    // --------------------------------------------------------

    const map = {
        id: "ars_bellum_world_v1",
        name: "아르스 벨룸 대륙",

        width: 4096,
        height: 4096,

        tileFolder: "map_tiles",
        tileRows: 4,
        tileCols: 4,
        tileSize: 1024
    };

    // --------------------------------------------------------
    // 2. 지역 데이터
    //
    // 현재는 시험 지역 하나만 둔다.
    // 나중에 왕국·문화권·기후권을 이 단위로 나눈다.
    // --------------------------------------------------------

    const regions = [
        {
            id: "central_valley",
            name: "중앙 대하곡",

            settlementIds: [
                "test_castle",
                "test_city",
                "test_village"
            ],

            tags: [
                "river",
                "mountain_valley",
                "fertile"
            ]
        }
    ];

    // --------------------------------------------------------
    // 3. 거점 데이터
    //
    // Campaign.js가 기존에 사용하던 필수 정보:
    // id, name, type, x, y, radius, color
    //
    // 앞으로 경제가 사용할 정보:
    // population, economy, military
    // --------------------------------------------------------

    const settlements = [
        {
            id: "test_city",
            name: "아우구스투스",
            type: "city",

            x: 2000,
            y: 1500,

            radius: 25,
            color: "#e74c3c",
            team: "neutral",

            factionId: null,
            regionId: "central_valley",

            population: {
                current: 8000,
                capacity: 12000
            },

            economy: {
                prosperity: 50,
                foodStock: 500,
                productionIds: []
            },

            military: {
                garrison: 220
            },

            tags: [
                "urban",
                "market",
                "river"
            ]
        },

        {
            id: "test_castle",
            name: "카멜롯 성",
            type: "castle",

            x: 800,
            y: 1200,

            radius: 18,
            color: "#3498db",
            team: "neutral",

            factionId: null,
            regionId: "central_valley",

            population: {
                current: 1800,
                capacity: 3000
            },

            economy: {
                prosperity: 35,
                foodStock: 280,
                productionIds: []
            },

            military: {
                garrison: 160
            },

            tags: [
                "fortified",
                "mountain_pass"
            ]
        },

        {
            id: "test_village",
            name: "초원 마을",
            type: "village",

            x: 3500,
            y: 1800,

            radius: 12,
            color: "#e67e22",
            team: "neutral",

            factionId: null,
            regionId: "central_valley",

            population: {
                current: 900,
                capacity: 1600
            },

            economy: {
                prosperity: 25,
                foodStock: 350,
                productionIds: []
            },

            military: {
                garrison: 35
            },

            tags: [
                "rural",
                "farmland"
            ]
        }
    ];

    // --------------------------------------------------------
    // 4. 도로 데이터
    //
    // 아직 Campaign.js가 도로를 그리거나 이동에 사용하지는 않는다.
    // 이번 단계에서는 도로 관계를 먼저 데이터로 만든다.
    // --------------------------------------------------------

    const roads = [
        {
            id: "road_castle_city",
            name: "서부 성채로",

            fromSettlementId: "test_castle",
            toSettlementId: "test_city",

            type: "main_road",
            enabled: true,

            movementMultiplier: 1.25,
            danger: 10,

            waypoints: []
        },

        {
            id: "road_city_village",
            name: "동부 곡창로",

            fromSettlementId: "test_city",
            toSettlementId: "test_village",

            type: "main_road",
            enabled: true,

            movementMultiplier: 1.25,
            danger: 15,

            waypoints: []
        }
    ];

    // --------------------------------------------------------
    // 5. 거점 찾기
    // --------------------------------------------------------

    function findSettlementById(settlementId) {
        return settlements.find(function (settlement) {
            return settlement.id === settlementId;
        }) || null;
    }

    // --------------------------------------------------------
    // 6. 지역 찾기
    // --------------------------------------------------------

    function findRegionById(regionId) {
        return regions.find(function (region) {
            return region.id === regionId;
        }) || null;
    }

    // --------------------------------------------------------
    // 7. 특정 거점에 연결된 도로 찾기
    // --------------------------------------------------------

    function getRoadsForSettlement(settlementId) {
        return roads.filter(function (road) {
            return (
                road.fromSettlementId === settlementId ||
                road.toSettlementId === settlementId
            );
        });
    }

    // --------------------------------------------------------
    // 8. 특정 거점과 연결된 이웃 거점 찾기
    // --------------------------------------------------------

    function getConnectedSettlementIds(settlementId) {
        return getRoadsForSettlement(settlementId).map(function (road) {
            if (road.fromSettlementId === settlementId) {
                return road.toSettlementId;
            }

            return road.fromSettlementId;
        });
    }

    // --------------------------------------------------------
    // 9. 좌표가 월드맵 내부인지 확인
    // --------------------------------------------------------

    function isInsideMap(x, y) {
        const worldX = Number(x);
        const worldY = Number(y);

        if (
            !Number.isFinite(worldX) ||
            !Number.isFinite(worldY)
        ) {
            return false;
        }

        return (
            worldX >= 0 &&
            worldY >= 0 &&
            worldX <= map.width &&
            worldY <= map.height
        );
    }

    // --------------------------------------------------------
    // 10. 데이터 오류 자동 검사
    //
    // 중복 ID, 맵 밖 좌표, 존재하지 않는 거점으로 연결된
    // 도로 등을 콘솔에서 찾아준다.
    // --------------------------------------------------------

    function validateData() {
        const errors = [];

        const settlementIds = new Set();
        const roadIds = new Set();

        settlements.forEach(function (settlement) {
            if (!settlement.id) {
                errors.push("ID가 없는 거점이 있습니다.");
                return;
            }

            if (settlementIds.has(settlement.id)) {
                errors.push(
                    "거점 ID가 중복되었습니다: " +
                    settlement.id
                );
            }

            settlementIds.add(settlement.id);

            if (!isInsideMap(settlement.x, settlement.y)) {
                errors.push(
                    "맵 밖에 있는 거점입니다: " +
                    settlement.id
                );
            }

            if (!findRegionById(settlement.regionId)) {
                errors.push(
                    "존재하지 않는 지역을 사용하는 거점입니다: " +
                    settlement.id
                );
            }
        });

        roads.forEach(function (road) {
            if (!road.id) {
                errors.push("ID가 없는 도로가 있습니다.");
                return;
            }

            if (roadIds.has(road.id)) {
                errors.push(
                    "도로 ID가 중복되었습니다: " +
                    road.id
                );
            }

            roadIds.add(road.id);

            if (!findSettlementById(road.fromSettlementId)) {
                errors.push(
                    "도로의 출발 거점이 없습니다: " +
                    road.id
                );
            }

            if (!findSettlementById(road.toSettlementId)) {
                errors.push(
                    "도로의 도착 거점이 없습니다: " +
                    road.id
                );
            }

            if (
                road.fromSettlementId ===
                road.toSettlementId
            ) {
                errors.push(
                    "같은 거점을 연결한 도로입니다: " +
                    road.id
                );
            }
        });

        return errors;
    }

    // --------------------------------------------------------
    // 11. 기존 Campaign.js와 연결
    //
    // Campaign.js는 window.worldNodes라는 이름을 사용한다.
    // 그 이름에 새 settlements 데이터를 연결한다.
    // --------------------------------------------------------

    function attachToCampaign() {
        window.worldNodes = settlements;
        window.worldRoads = roads;
    }

    // --------------------------------------------------------
    // 12. 앞으로 새 시스템이 사용할 공식 창구
    // --------------------------------------------------------

    window.ArsWorldMapData = {
        version: DATA_VERSION,

        map: map,
        regions: regions,
        settlements: settlements,
        roads: roads,

        getSettlementById: findSettlementById,
        getRegionById: findRegionById,

        getRoadsForSettlement: getRoadsForSettlement,
        getConnectedSettlementIds: getConnectedSettlementIds,

        isInsideMap: isInsideMap,
        validate: validateData,

        attachToCampaign: attachToCampaign
    };

    // --------------------------------------------------------
    // 13. 실행 시 자동 검사 후 Campaign.js에 연결
    // --------------------------------------------------------

    const validationErrors = validateData();

    if (validationErrors.length > 0) {
        console.error(
            "[Ars Bellum] WorldMapData 검사 실패:",
            validationErrors
        );
    } else {
        attachToCampaign();

        console.log(
            "[Ars Bellum] WorldMapData 연결 완료 - 거점 " +
            settlements.length +
            "개, 도로 " +
            roads.length +
            "개"
        );
    }
})();