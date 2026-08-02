// ============================================================
// Ars Bellum - W_Terrain.js
// 월드 좌표가 평원, 숲, 산맥, 강 중 어디인지 판정한다.
// 기본 상태에서는 전체 맵을 평원으로 처리한다.
// ============================================================

(function () {
    "use strict";

    const zones = [];

    const TEST_IDS = [
        "test_forest",
        "test_mountain",
        "test_river",
        "test_bridge"
    ];

    let testMode = false;

    // --------------------------------------------------------
    // 안전한 숫자 변환
    // --------------------------------------------------------

    function numberOr(value, fallback) {
        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : fallback;
    }

    // --------------------------------------------------------
    // 월드맵 크기 가져오기
    // --------------------------------------------------------

    function getMapSize() {
        const data = window.ArsWorldMapData;

        const map =
            data && data.map
                ? data.map
                : {};

        return {
            width: numberOr(
                map.width,
                4096
            ),

            height: numberOr(
                map.height,
                4096
            )
        };
    }

    // --------------------------------------------------------
    // 월드 지형 규칙표 가져오기
    // --------------------------------------------------------

    function getTerrainTypes() {
        return window.ArsWorldTerrainTypes || null;
    }

    function isKnownBase(baseId) {
        const types = getTerrainTypes();

        return Boolean(
            types &&
            typeof types.getBaseType === "function" &&
            types.getBaseType(baseId)
        );
    }

    function isKnownRoute(routeId) {
        if (!routeId) {
            return true;
        }

        const types = getTerrainTypes();

        return Boolean(
            types &&
            typeof types.getRouteType === "function" &&
            types.getRouteType(routeId)
        );
    }

    function isKnownFeature(featureId) {
        const types = getTerrainTypes();

        return Boolean(
            types &&
            typeof types.getFeatureType === "function" &&
            types.getFeatureType(featureId)
        );
    }

    // --------------------------------------------------------
    // 지형 구역 모양 검사
    //
    // rect:
    // 사각형 구역
    //
    // circle:
    // 원형 구역
    // --------------------------------------------------------

    function normalizeShape(shape) {
        if (!shape || typeof shape !== "object") {
            return null;
        }

        if (shape.type === "rect") {
            const x = Number(shape.x);
            const y = Number(shape.y);
            const width = Number(shape.width);
            const height = Number(shape.height);

            if (
                !Number.isFinite(x) ||
                !Number.isFinite(y) ||
                !Number.isFinite(width) ||
                !Number.isFinite(height) ||
                width <= 0 ||
                height <= 0
            ) {
                return null;
            }

            return {
                type: "rect",
                x: x,
                y: y,
                width: width,
                height: height
            };
        }

        if (shape.type === "circle") {
            const x = Number(shape.x);
            const y = Number(shape.y);
            const radius = Number(shape.radius);

            if (
                !Number.isFinite(x) ||
                !Number.isFinite(y) ||
                !Number.isFinite(radius) ||
                radius <= 0
            ) {
                return null;
            }

            return {
                type: "circle",
                x: x,
                y: y,
                radius: radius
            };
        }

        return null;
    }

    // --------------------------------------------------------
    // 지형 구역 데이터 정리
    // --------------------------------------------------------

    function normalizeZone(source) {
        if (
            !source ||
            typeof source !== "object"
        ) {
            return null;
        }

        if (
            typeof source.id !== "string" ||
            source.id.trim() === ""
        ) {
            return null;
        }

        const shape =
            normalizeShape(source.shape);

        if (!shape) {
            return null;
        }

        const baseId =
            source.baseId || null;

        const routeId =
            source.routeId || null;

        if (
            baseId &&
            !isKnownBase(baseId)
        ) {
            return null;
        }

        if (!isKnownRoute(routeId)) {
            return null;
        }

        const featureIds =
            Array.isArray(source.featureIds)
                ? source.featureIds.filter(
                    isKnownFeature
                )
                : [];

        if (
            !baseId &&
            !routeId &&
            featureIds.length === 0
        ) {
            return null;
        }

        return {
            id: source.id,

            name:
                source.name ||
                source.id,

            enabled:
                source.enabled !== false,

            priority:
                numberOr(
                    source.priority,
                    0
                ),

            baseId: baseId,
            routeId: routeId,
            featureIds: featureIds,

            shape: shape,

            source:
                source.source ||
                "manual"
        };
    }

    // --------------------------------------------------------
    // 좌표가 구역 안에 있는지 판정
    // --------------------------------------------------------

    function contains(zone, x, y) {
        const shape = zone.shape;

        if (shape.type === "rect") {
            return (
                x >= shape.x &&
                y >= shape.y &&
                x <= shape.x + shape.width &&
                y <= shape.y + shape.height
            );
        }

        const dx = x - shape.x;
        const dy = y - shape.y;

        return (
            dx * dx + dy * dy <=
            shape.radius * shape.radius
        );
    }

    // --------------------------------------------------------
    // ID로 지형 구역 찾기
    // --------------------------------------------------------

    function getZoneById(zoneId) {
        return (
            zones.find(function (zone) {
                return zone.id === zoneId;
            }) || null
        );
    }

    // --------------------------------------------------------
    // 지형 구역 추가
    // --------------------------------------------------------

    function addZone(source) {
        const zone =
            normalizeZone(source);

        if (!zone) {
            console.error(
                "[Ars Bellum] 잘못된 지형 구역입니다.",
                source
            );

            return null;
        }

        if (getZoneById(zone.id)) {
            console.error(
                "[Ars Bellum] 지형 구역 ID 중복: " +
                zone.id
            );

            return null;
        }

        zones.push(zone);

        return zone;
    }

    // --------------------------------------------------------
    // 지형 구역 삭제
    // --------------------------------------------------------

    function removeZone(zoneId) {
        const index =
            zones.findIndex(
                function (zone) {
                    return (
                        zone.id ===
                        zoneId
                    );
                }
            );

        if (index < 0) {
            return false;
        }

        zones.splice(index, 1);

        return true;
    }

    // --------------------------------------------------------
    // 지형 구역 켜기 또는 끄기
    // --------------------------------------------------------

    function setZoneEnabled(
        zoneId,
        enabled
    ) {
        const zone =
            getZoneById(zoneId);

        if (!zone) {
            return false;
        }

        zone.enabled =
            Boolean(enabled);

        return true;
    }

    // --------------------------------------------------------
    // 해당 좌표와 겹치는 모든 구역 찾기
    //
    // priority가 높은 구역이 나중에 적용된다.
    // --------------------------------------------------------

    function getMatchingZones(
        worldX,
        worldY
    ) {
        const x = Number(worldX);
        const y = Number(worldY);

        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y)
        ) {
            return [];
        }

        return zones
            .filter(function (zone) {
                return (
                    zone.enabled &&
                    contains(zone, x, y)
                );
            })
            .sort(function (a, b) {
                return (
                    a.priority -
                    b.priority
                );
            });
    }

    // --------------------------------------------------------
    // 좌표의 최종 지형 칸 만들기
    //
    // 아무 구역도 없으면 평원이다.
    // --------------------------------------------------------

    function getCellAt(
        worldX,
        worldY
    ) {
        const x = Number(worldX);
        const y = Number(worldY);

        const size =
            getMapSize();

        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            x < 0 ||
            y < 0 ||
            x > size.width ||
            y > size.height
        ) {
            return {
                baseId: "sea",
                routeId: null,
                featureIds: [],
                zoneIds: [],
                outsideMap: true
            };
        }

        let baseId = "plain";
        let routeId = null;

        const featureIds = [];
        const zoneIds = [];

        const matchingZones =
            getMatchingZones(x, y);

        matchingZones.forEach(
            function (zone) {
                zoneIds.push(zone.id);

                if (zone.baseId) {
                    baseId =
                        zone.baseId;
                }

                if (zone.routeId) {
                    routeId =
                        zone.routeId;
                }

                zone.featureIds.forEach(
                    function (featureId) {
                        if (
                            featureIds.indexOf(
                                featureId
                            ) < 0
                        ) {
                            featureIds.push(
                                featureId
                            );
                        }
                    }
                );
            }
        );

        return {
            baseId: baseId,
            routeId: routeId,
            featureIds: featureIds,
            zoneIds: zoneIds,
            outsideMap: false
        };
    }

    // --------------------------------------------------------
    // 좌표의 실제 이동 규칙 계산
    // --------------------------------------------------------

    function getTravelProfileAt(
        worldX,
        worldY
    ) {
        const cell =
            getCellAt(
                worldX,
                worldY
            );

        const types =
            getTerrainTypes();

        if (
            types &&
            typeof types.getTravelProfile ===
            "function"
        ) {
            return types.getTravelProfile(
                cell
            );
        }

        return null;
    }

    // --------------------------------------------------------
    // 시험 구역 삭제
    // --------------------------------------------------------

    function clearTestZones() {
        TEST_IDS.forEach(
            function (zoneId) {
                removeZone(zoneId);
            }
        );
    }

    // --------------------------------------------------------
    // 시험 지형 켜기
    //
    // 실제 플레이 지역과 멀리 떨어진 남쪽에 생성된다.
    // --------------------------------------------------------

    function enableTestMode() {
        clearTestZones();

        addZone({
            id: "test_forest",
            name: "시험용 숲",

            priority: 10,
            baseId: "forest",

            shape: {
                type: "circle",
                x: 3000,
                y: 3300,
                radius: 260
            },

            source: "test"
        });

        addZone({
            id: "test_mountain",
            name: "시험용 산맥",

            priority: 10,
            baseId: "mountain",

            shape: {
                type: "rect",
                x: 3400,
                y: 2950,
                width: 360,
                height: 620
            },

            source: "test"
        });

        addZone({
            id: "test_river",
            name: "시험용 강",

            priority: 20,
            baseId: "river",

            shape: {
                type: "rect",
                x: 2450,
                y: 3600,
                width: 760,
                height: 80
            },

            source: "test"
        });

        addZone({
            id: "test_bridge",
            name: "시험용 다리",

            priority: 30,
            routeId: "bridge",

            shape: {
                type: "rect",
                x: 2810,
                y: 3570,
                width: 100,
                height: 140
            },

            source: "test"
        });

        testMode = true;

        console.log(
            "[Ars Bellum] 월드 지형 시험 구역 활성화"
        );
    }

    // --------------------------------------------------------
    // 시험 지형 끄기
    // --------------------------------------------------------

    function disableTestMode() {
        clearTestZones();

        testMode = false;

        console.log(
            "[Ars Bellum] 월드 지형 시험 구역 비활성화"
        );
    }

    // --------------------------------------------------------
    // 특정 좌표 검사
    // --------------------------------------------------------

    function debugAt(
        worldX,
        worldY
    ) {
        const result = {
            x: worldX,
            y: worldY,

            cell:
                getCellAt(
                    worldX,
                    worldY
                ),

            profile:
                getTravelProfileAt(
                    worldX,
                    worldY
                )
        };

        console.log(
            "[Ars Bellum] 월드 지형 검사:",
            result
        );

        return result;
    }

    // --------------------------------------------------------
    // 현재 플레이어 위치 검사
    // --------------------------------------------------------

    function debugPlayer() {
        const party =
            window.playerParty;

        if (!party) {
            console.warn(
                "[Ars Bellum] playerParty가 없습니다."
            );

            return null;
        }

        return debugAt(
            party.worldX,
            party.worldY
        );
    }

    // --------------------------------------------------------
    // 공식 공개 창구
    // --------------------------------------------------------

    window.ArsWorldTerrainMap = {
        version: 1,

        getMapSize:
            getMapSize,

        getCellAt:
            getCellAt,

        getTravelProfileAt:
            getTravelProfileAt,

        getMatchingZones:
            getMatchingZones,

        getZoneById:
            getZoneById,

        getZones: function () {
            return zones.slice();
        },

        addZone:
            addZone,

        removeZone:
            removeZone,

        setZoneEnabled:
            setZoneEnabled,

        enableTestMode:
            enableTestMode,

        disableTestMode:
            disableTestMode,

        isTestMode: function () {
            return testMode;
        },

        debugAt:
            debugAt,

        debugPlayer:
            debugPlayer
    };

    console.log(
        "[Ars Bellum] WorldTerrainMap 연결 완료 - " +
        "기본 지형 전체 평원"
    );
})();