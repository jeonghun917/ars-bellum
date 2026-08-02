// ============================================================
// Ars Bellum - W_Map.js
// 월드맵 이동 규칙을 Campaign.js와 지형 데이터 사이에서 연결한다.
// ============================================================

(function () {
    "use strict";

    const DEFAULT_MAP_WIDTH = 4096;
    const DEFAULT_MAP_HEIGHT = 4096;
    const DEFAULT_BASE_SPEED = 180;
    const DEFAULT_ROAD_HALF_WIDTH = 34;

    const runtime = {
        baseSpeed: DEFAULT_BASE_SPEED,
        roadHalfWidth: DEFAULT_ROAD_HALF_WIDTH,

        blocked: false,
        blockedReason: "",

        currentRoadId: null,

        currentCell: {
            baseId: "plain",
            routeId: null,
            featureIds: []
        },

        currentProfile: null
    };

    // --------------------------------------------------------
    // 숫자가 정상인지 확인
    // --------------------------------------------------------

    function toFiniteNumber(value, fallback) {
        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : fallback;
    }

    // --------------------------------------------------------
    // 숫자를 최소값과 최대값 사이에 가둔다.
    // --------------------------------------------------------

    function clamp(value, minimum, maximum) {
        return Math.max(
            minimum,
            Math.min(maximum, value)
        );
    }

    // --------------------------------------------------------
    // WorldMapData 가져오기
    // --------------------------------------------------------

    function getMapData() {
        return window.ArsWorldMapData || null;
    }

    // --------------------------------------------------------
    // WorldTerrainTypes 가져오기
    // --------------------------------------------------------

    function getTerrainTypes() {
        return window.ArsWorldTerrainTypes || null;
    }

    // --------------------------------------------------------
    // 월드맵 크기 가져오기
    // --------------------------------------------------------

    function getMapSize() {
        const data = getMapData();

        const map =
            data && data.map
                ? data.map
                : null;

        return {
            width: toFiniteNumber(
                map && map.width,
                DEFAULT_MAP_WIDTH
            ),

            height: toFiniteNumber(
                map && map.height,
                DEFAULT_MAP_HEIGHT
            )
        };
    }

    // --------------------------------------------------------
    // ID로 거점 찾기
    // --------------------------------------------------------

    function getSettlementById(settlementId) {
        const data = getMapData();

        if (!data || !settlementId) {
            return null;
        }

        if (
            typeof data.getSettlementById ===
            "function"
        ) {
            return data.getSettlementById(
                settlementId
            );
        }

        if (!Array.isArray(data.settlements)) {
            return null;
        }

        return (
            data.settlements.find(
                function (settlement) {
                    return (
                        settlement.id ===
                        settlementId
                    );
                }
            ) || null
        );
    }

    // --------------------------------------------------------
    // 한 점과 선 사이의 거리 계산
    //
    // 플레이어가 도로 근처에 있는지 확인할 때 사용한다.
    // --------------------------------------------------------

    function distanceToSegment(
        pointX,
        pointY,
        startX,
        startY,
        endX,
        endY
    ) {
        const segmentX = endX - startX;
        const segmentY = endY - startY;

        const pointVectorX = pointX - startX;
        const pointVectorY = pointY - startY;

        const lengthSquared =
            segmentX * segmentX +
            segmentY * segmentY;

        if (lengthSquared === 0) {
            return Math.hypot(
                pointX - startX,
                pointY - startY
            );
        }

        const projection = clamp(
            (
                pointVectorX * segmentX +
                pointVectorY * segmentY
            ) / lengthSquared,
            0,
            1
        );

        const closestX =
            startX +
            segmentX * projection;

        const closestY =
            startY +
            segmentY * projection;

        return Math.hypot(
            pointX - closestX,
            pointY - closestY
        );
    }

    // --------------------------------------------------------
    // 도로의 모든 좌표를 배열로 만든다.
    //
    // 출발 거점
    // → 중간 경유점
    // → 도착 거점
    // --------------------------------------------------------

    function buildRoadPoints(road) {
        const fromSettlement =
            getSettlementById(
                road.fromSettlementId
            );

        const toSettlement =
            getSettlementById(
                road.toSettlementId
            );

        if (!fromSettlement || !toSettlement) {
            return [];
        }

        const points = [
            {
                x: fromSettlement.x,
                y: fromSettlement.y
            }
        ];

        if (Array.isArray(road.waypoints)) {
            road.waypoints.forEach(
                function (waypoint) {
                    if (
                        waypoint &&
                        Number.isFinite(
                            Number(waypoint.x)
                        ) &&
                        Number.isFinite(
                            Number(waypoint.y)
                        )
                    ) {
                        points.push({
                            x: Number(waypoint.x),
                            y: Number(waypoint.y)
                        });
                    }
                }
            );
        }

        points.push({
            x: toSettlement.x,
            y: toSettlement.y
        });

        return points;
    }

    // --------------------------------------------------------
    // WorldMapData의 도로 종류를
    // WorldTerrainTypes의 길 종류로 변환
    // --------------------------------------------------------

    function normalizeRoadRouteId(roadType) {
        if (roadType === "mountain_pass") {
            return "mountain_pass";
        }

        if (roadType === "bridge") {
            return "bridge";
        }

        return "road";
    }

    // --------------------------------------------------------
    // 현재 좌표 근처에 있는 도로 찾기
    // --------------------------------------------------------

    function getRoadAt(worldX, worldY) {
        const data = getMapData();

        if (
            !data ||
            !Array.isArray(data.roads)
        ) {
            return null;
        }

        let nearestRoad = null;
        let nearestDistance = Infinity;

        data.roads.forEach(function (road) {
            if (
                !road ||
                road.enabled === false
            ) {
                return;
            }

            const points =
                buildRoadPoints(road);

            if (points.length < 2) {
                return;
            }

            for (
                let index = 0;
                index < points.length - 1;
                index += 1
            ) {
                const start = points[index];
                const end = points[index + 1];

                const distance =
                    distanceToSegment(
                        worldX,
                        worldY,
                        start.x,
                        start.y,
                        end.x,
                        end.y
                    );

                if (
                    distance <=
                        runtime.roadHalfWidth &&
                    distance < nearestDistance
                ) {
                    nearestDistance = distance;
                    nearestRoad = road;
                }
            }
        });

        return nearestRoad;
    }

    // --------------------------------------------------------
    // 실제 지형 지도에서 현재 칸 가져오기
    //
    // W_Terrain.js는 다음 단계에서 추가한다.
    // 아직 없으면 평원으로 처리한다.
    // --------------------------------------------------------

    function getTerrainMapCell(
        worldX,
        worldY
    ) {
        const terrainMap =
            window.ArsWorldTerrainMap;

        if (
            terrainMap &&
            typeof terrainMap.getCellAt ===
                "function"
        ) {
            const cell =
                terrainMap.getCellAt(
                    worldX,
                    worldY
                );

            if (
                cell &&
                typeof cell === "object"
            ) {
                return {
                    baseId:
                        cell.baseId ||
                        "plain",

                    routeId:
                        cell.routeId ||
                        null,

                    featureIds:
                        Array.isArray(
                            cell.featureIds
                        )
                            ? cell.featureIds.slice()
                            : []
                };
            }
        }

        return {
            baseId: "plain",
            routeId: null,
            featureIds: []
        };
    }

    // --------------------------------------------------------
    // 현재 좌표의 최종 지형 정보 만들기
    //
    // 기본 지형 위에 도로 정보를 추가한다.
    // --------------------------------------------------------

    function getCellAt(worldX, worldY) {
        const cell =
            getTerrainMapCell(
                worldX,
                worldY
            );

        const road =
            getRoadAt(worldX, worldY);

        if (!cell.routeId && road) {
            cell.routeId =
                normalizeRoadRouteId(
                    road.type
                );
        }

        return {
            baseId: cell.baseId,
            routeId: cell.routeId,
            featureIds: cell.featureIds,

            roadId: road
                ? road.id
                : null
        };
    }

    // --------------------------------------------------------
    // WorldTerrainTypes가 연결되지 않았을 때 사용하는
    // 안전용 기본 평원 규칙
    // --------------------------------------------------------

    function makeFallbackProfile(cell) {
        return {
            baseId:
                cell.baseId || "plain",

            baseName: "평원",

            routeId:
                cell.routeId || null,

            routeName:
                cell.routeId
                    ? "도로"
                    : null,

            featureIds:
                cell.featureIds || [],

            featureNames: [],

            passable: true,

            speedMult:
                cell.routeId
                    ? 1.28
                    : 1,

            foodMult:
                cell.routeId
                    ? 0.88
                    : 1,

            visibilityMult: 1,
            ambushRisk: 0.05,

            canCamp: true,
            restBonus: 1,

            battleTags:
                cell.routeId
                    ? ["plain", "road"]
                    : ["plain"],

            warnings: []
        };
    }

    // --------------------------------------------------------
    // 현재 좌표의 이동 규칙 계산
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

        const terrainTypes =
            getTerrainTypes();

        let profile;

        if (
            terrainTypes &&
            typeof terrainTypes.getTravelProfile ===
                "function"
        ) {
            profile =
                terrainTypes.getTravelProfile(
                    cell
                );
        } else {
            profile =
                makeFallbackProfile(
                    cell
                );
        }

        return {
            cell: cell,
            profile: profile
        };
    }

    // --------------------------------------------------------
    // 플레이어 부대 기본속도 변경
    //
    // 기본값은 Campaign.js와 같은 180
    // --------------------------------------------------------

    function setBaseSpeed(speed) {
        const number = Number(speed);

        if (
            !Number.isFinite(number) ||
            number < 0
        ) {
            return runtime.baseSpeed;
        }

        runtime.baseSpeed = number;

        return runtime.baseSpeed;
    }

    // --------------------------------------------------------
    // 도로 판정 폭 변경
    //
    // 기본값은 도로 중심에서 좌우 34픽셀
    // --------------------------------------------------------

    function setRoadHalfWidth(width) {
        const number = Number(width);

        if (
            !Number.isFinite(number) ||
            number < 1
        ) {
            return runtime.roadHalfWidth;
        }

        runtime.roadHalfWidth = number;

        return runtime.roadHalfWidth;
    }

    // --------------------------------------------------------
    // 현재 위치의 지형 상태 기록
    // --------------------------------------------------------

    function updateRuntimePosition(
        worldX,
        worldY
    ) {
        const travel =
            getTravelProfileAt(
                worldX,
                worldY
            );

        runtime.currentCell =
            travel.cell;

        runtime.currentProfile =
            travel.profile;

        runtime.currentRoadId =
            travel.cell.roadId;

        window.currentWorldTerrain = {
            x: worldX,
            y: worldY,

            cell: travel.cell,
            profile: travel.profile,

            blocked: runtime.blocked,

            blockedReason:
                runtime.blockedReason
        };

        return travel;
    }

    // --------------------------------------------------------
    // Campaign.js가 매 프레임 호출하는 핵심 함수
    //
    // 실제 좌표 이동은 기존 Campaign.js가 담당한다.
    // 이 함수는 이동 직전에 속도와 통행 가능 여부를 계산한다.
    // --------------------------------------------------------

    function prepareMovement(
        party,
        deltaTime
    ) {
        if (
            !party ||
            typeof party !== "object"
        ) {
            return null;
        }

        const dt =
            toFiniteNumber(
                deltaTime,
                1 / 60
            );

        const mapSize =
            getMapSize();

        // 현재 좌표를 맵 안으로 제한
        party.worldX = clamp(
            toFiniteNumber(
                party.worldX,
                0
            ),
            0,
            mapSize.width
        );

        party.worldY = clamp(
            toFiniteNumber(
                party.worldY,
                0
            ),
            0,
            mapSize.height
        );

        // 목적지도 맵 안으로 제한
        party.targetX = clamp(
            toFiniteNumber(
                party.targetX,
                party.worldX
            ),
            0,
            mapSize.width
        );

        party.targetY = clamp(
            toFiniteNumber(
                party.targetY,
                party.worldY
            ),
            0,
            mapSize.height
        );

        const dx =
            party.targetX -
            party.worldX;

        const dy =
            party.targetY -
            party.worldY;

        const distance =
            Math.hypot(dx, dy);

        runtime.blocked = false;
        runtime.blockedReason = "";

        const currentTravel =
            updateRuntimePosition(
                party.worldX,
                party.worldY
            );

        // 목적지에 이미 도착했다면 기본속도로 복원
        if (distance <= 2) {
            party.speed =
                runtime.baseSpeed;

            return currentTravel.profile;
        }

        const directionX =
            dx / distance;

        const directionY =
            dy / distance;

        const currentSpeed =
            Math.max(
                0,

                runtime.baseSpeed *
                    currentTravel.profile
                        .speedMult
            );

        // 다음 프레임에 이동할 위치를 미리 검사
        const probeDistance =
            Math.max(
                2,
                currentSpeed * dt
            );

        const probeX =
            clamp(
                party.worldX +
                    directionX *
                        probeDistance,

                0,
                mapSize.width
            );

        const probeY =
            clamp(
                party.worldY +
                    directionY *
                        probeDistance,

                0,
                mapSize.height
            );

        const nextTravel =
            getTravelProfileAt(
                probeX,
                probeY
            );

        // 산맥·강·바다 등 통행 불가능 지형
        if (!nextTravel.profile.passable) {
            party.speed = 0;

            runtime.blocked = true;

            runtime.blockedReason =
                nextTravel.profile.baseName +
                " 지형은 현재 경로로 통과할 수 없습니다.";

            window.currentWorldTerrain.blocked =
                true;

            window.currentWorldTerrain.blockedReason =
                runtime.blockedReason;

            return nextTravel.profile;
        }

        // 지형에 따라 실제 이동속도 계산
        party.speed =
            Math.max(
                0,

                runtime.baseSpeed *
                    nextTravel.profile
                        .speedMult
            );

        return nextTravel.profile;
    }

    // --------------------------------------------------------
    // 다른 시스템에서 현재 이동 정보 읽기
    // --------------------------------------------------------

    function getCurrentTravelInfo() {
        return {
            baseSpeed:
                runtime.baseSpeed,

            effectiveSpeed:
                window.playerParty &&
                Number.isFinite(
                    Number(
                        window.playerParty
                            .speed
                    )
                )
                    ? Number(
                        window.playerParty
                            .speed
                    )
                    : 0,

            roadHalfWidth:
                runtime.roadHalfWidth,

            blocked:
                runtime.blocked,

            blockedReason:
                runtime.blockedReason,

            currentRoadId:
                runtime.currentRoadId,

            currentCell:
                runtime.currentCell,

            currentProfile:
                runtime.currentProfile
        };
    }

    // --------------------------------------------------------
    // 콘솔 확인용
    // --------------------------------------------------------

    function debugPrint() {
        console.log(
            "[Ars Bellum] 현재 월드 이동 정보:",
            getCurrentTravelInfo()
        );
    }

    // --------------------------------------------------------
    // 공식 공개 창구
    // --------------------------------------------------------

    window.ArsWorldMapSystem = {
        version: 1,

        prepareMovement:
            prepareMovement,

        getCellAt:
            getCellAt,

        getTravelProfileAt:
            getTravelProfileAt,

        getRoadAt:
            getRoadAt,

        getCurrentTravelInfo:
            getCurrentTravelInfo,

        setBaseSpeed:
            setBaseSpeed,

        setRoadHalfWidth:
            setRoadHalfWidth,

        debugPrint:
            debugPrint
    };

    // Campaign.js의 기존 속도를 기본속도로 등록
    if (
        window.playerParty &&
        Number.isFinite(
            Number(
                window.playerParty.speed
            )
        )
    ) {
        setBaseSpeed(
            Number(
                window.playerParty.speed
            )
        );
    }

    console.log(
        "[Ars Bellum] WorldMapSystem 연결 완료 - " +
        "기본 속도 " +
        runtime.baseSpeed
    );
})();