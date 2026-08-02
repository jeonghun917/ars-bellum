(function () {
    "use strict";

    const PREFIX =
        "__movement_test__";

    const runtime = {
        active: false,
        originX: 0,
        originY: 0,
        zoneIds: [],
        points: {}
    };

    function getTerrainMap() {
        return (
            window
                .ArsWorldTerrainMap ||
            null
        );
    }

    function getMapSize() {
        const terrainMap =
            getTerrainMap();

        if (
            terrainMap &&
            typeof terrainMap
                .getMapSize ===
                "function"
        ) {
            return terrainMap
                .getMapSize();
        }

        return {
            width: 4096,
            height: 4096
        };
    }

    function clamp(
        value,
        minimum,
        maximum
    ) {
        return Math.max(
            minimum,
            Math.min(
                maximum,
                value
            )
        );
    }

    function remove() {
        const terrainMap =
            getTerrainMap();

        if (
            terrainMap &&
            typeof terrainMap
                .removeZone ===
                "function"
        ) {
            runtime.zoneIds
                .forEach(
                    function (
                        zoneId
                    ) {
                        terrainMap
                            .removeZone(
                                zoneId
                            );
                    }
                );
        }

        runtime.active =
            false;

        runtime.zoneIds =
            [];

        runtime.points =
            {};

        console.log(
            "[Ars Bellum] 월드 이동 시험장 제거 완료"
        );
    }

    function addZone(
        definition
    ) {
        const terrainMap =
            getTerrainMap();

        if (
            !terrainMap ||
            typeof terrainMap
                .addZone !==
                "function"
        ) {
            return null;
        }

        const zone =
            terrainMap.addZone(
                definition
            );

        if (zone) {
            runtime.zoneIds.push(
                zone.id
            );
        }

        return zone;
    }

    function chooseOrigin(
        worldX,
        worldY
    ) {
        const size =
            getMapSize();

        const margin =
            260;

        const courseWidth =
            1100;

        const courseHeight =
            800;

        const originX =
            clamp(
                Number(worldX),
                margin,
                size.width -
                    margin
            );

        const originY =
            clamp(
                Number(worldY),
                margin,
                size.height -
                    margin
            );

        const directionX =
            originX +
            courseWidth <=
            size.width -
            margin
                ? 1
                : -1;

        const directionY =
            originY +
            courseHeight <=
            size.height -
            margin
                ? 1
                : -1;

        return {
            x: originX,
            y: originY,
            directionX:
                directionX,
            directionY:
                directionY
        };
    }

    function spawnAt(
        worldX,
        worldY
    ) {
        const terrainMap =
            getTerrainMap();

        if (!terrainMap) {
            console.error(
                "[Ars Bellum] WorldTerrainMap이 없어 시험장을 만들 수 없습니다."
            );

            return false;
        }

        remove();

        const origin =
            chooseOrigin(
                worldX,
                worldY
            );

        const dx =
            origin.directionX;

        const dy =
            origin.directionY;

        runtime.originX =
            origin.x;

        runtime.originY =
            origin.y;

        const forestX =
            origin.x +
            dx * 250;

        const forestY =
            origin.y;

        const mountainX =
            origin.x +
            dx * 500;

        const mountainY =
            origin.y;

        const riverX =
            origin.x +
            dx * 750;

        const riverY =
            origin.y;

        const desertX =
            origin.x +
            dx * 250;

        const desertY =
            origin.y +
            dy * 360;

        addZone({
            id:
                PREFIX +
                "forest",

            name:
                "시험 숲 (속도 감소)",

            priority:
                100,

            baseId:
                "forest",

            shape: {
                type:
                    "circle",

                x:
                    forestX,

                y:
                    forestY,

                radius:
                    120
            },

            source:
                "movement_test"
        });

        addZone({
            id:
                PREFIX +
                "mountain",

            name:
                "시험 산맥 (통행 불가)",

            priority:
                100,

            baseId:
                "mountain",

            shape: {
                type:
                    "rect",

                x:
                    Math.min(
                        mountainX -
                            dx * 45,

                        mountainX +
                            dx * 45
                    ),

                y:
                    mountainY -
                    180,

                width:
                    90,

                height:
                    360
            },

            source:
                "movement_test"
        });

        addZone({
            id:
                PREFIX +
                "mountain_pass",

            name:
                "시험 산길 (통행 가능)",

            priority:
                200,

            routeId:
                "mountain_pass",

            shape: {
                type:
                    "rect",

                x:
                    Math.min(
                        mountainX -
                            dx * 60,

                        mountainX +
                            dx * 60
                    ),

                y:
                    mountainY -
                    35,

                width:
                    120,

                height:
                    70
            },

            source:
                "movement_test"
        });

        addZone({
            id:
                PREFIX +
                "river",

            name:
                "시험 강 (통행 불가)",

            priority:
                100,

            baseId:
                "river",

            shape: {
                type:
                    "rect",

                x:
                    Math.min(
                        riverX -
                            dx * 45,

                        riverX +
                            dx * 45
                    ),

                y:
                    riverY -
                    180,

                width:
                    90,

                height:
                    360
            },

            source:
                "movement_test"
        });

        addZone({
            id:
                PREFIX +
                "bridge",

            name:
                "시험 다리 (통행 가능)",

            priority:
                200,

            routeId:
                "bridge",

            shape: {
                type:
                    "rect",

                x:
                    Math.min(
                        riverX -
                            dx * 60,

                        riverX +
                            dx * 60
                    ),

                y:
                    riverY -
                    35,

                width:
                    120,

                height:
                    70
            },

            source:
                "movement_test"
        });

        addZone({
            id:
                PREFIX +
                "desert",

            name:
                "시험 사막 (보급 부담)",

            priority:
                100,

            baseId:
                "desert",

            shape: {
                type:
                    "circle",

                x:
                    desertX,

                y:
                    desertY,

                radius:
                    140
            },

            source:
                "movement_test"
        });

        addZone({
            id:
                PREFIX +
                "oasis",

            name:
                "시험 오아시스",

            priority:
                200,

            featureIds: [
                "oasis"
            ],

            shape: {
                type:
                    "circle",

                x:
                    desertX,

                y:
                    desertY,

                radius:
                    45
            },

            source:
                "movement_test"
        });

        runtime.points = {
            origin: {
                x: origin.x,
                y: origin.y
            },

            forest: {
                x: forestX,
                y: forestY
            },

            mountainBlocked: {
                x: mountainX,
                y:
                    mountainY -
                    110
            },

            mountainPass: {
                x: mountainX,
                y: mountainY
            },

            riverBlocked: {
                x: riverX,
                y:
                    riverY -
                    110
            },

            bridge: {
                x: riverX,
                y: riverY
            },

            desert: {
                x:
                    desertX +
                    90,

                y:
                    desertY
            },

            oasis: {
                x: desertX,
                y: desertY
            }
        };

        runtime.active =
            true;

        if (
            window
                .ArsWorldMapDebugOverlay &&
            typeof window
                .ArsWorldMapDebugOverlay
                .setEnabled ===
                "function"
        ) {
            window
                .ArsWorldMapDebugOverlay
                .setEnabled(true);
        }

        console.log(
            "[Ars Bellum] 월드 이동 시험장 생성 완료:",
            getState()
        );

        printInstructions();

        return true;
    }

    function spawnAtPlayer() {
        const party =
            window.playerParty;

        if (!party) {
            console.error(
                "[Ars Bellum] playerParty가 없어 시험장을 만들 수 없습니다."
            );

            return false;
        }

        return spawnAt(
            Number(
                party.worldX
            ),

            Number(
                party.worldY
            )
        );
    }

    function movePlayerToPoint(
        pointName
    ) {
        const point =
            runtime.points[
                pointName
            ];

        if (
            !runtime.active ||
            !point
        ) {
            console.error(
                "[Ars Bellum] 존재하지 않는 시험 지점:",
                pointName
            );

            return false;
        }

        if (
            window
                .ArsWorldMapCommands &&
            typeof window
                .ArsWorldMapCommands
                .moveToGround ===
                "function"
        ) {
            return window
                .ArsWorldMapCommands
                .moveToGround(
                    point.x,
                    point.y,
                    window.playerParty
                );
        }

        if (
            !window.playerParty
        ) {
            return false;
        }

        window.playerParty
            .targetX =
            point.x;

        window.playerParty
            .targetY =
            point.y;

        window.playerParty
            .targetNode =
            null;

        return true;
    }

    function inspectPoint(
        pointName
    ) {
        const point =
            runtime.points[
                pointName
            ];

        if (
            !point ||
            !window
                .ArsWorldTerrainMap
        ) {
            return null;
        }

        return window
            .ArsWorldTerrainMap
            .debugAt(
                point.x,
                point.y
            );
    }

    function printInstructions() {
        console.group(
            "[Ars Bellum] 이동 시험장 사용법"
        );

        console.log(
            "숲 이동:",
            "ArsWorldMovementTest.moveTo('forest')"
        );

        console.log(
            "막힌 산맥:",
            "ArsWorldMovementTest.moveTo('mountainBlocked')"
        );

        console.log(
            "산길 통과:",
            "ArsWorldMovementTest.moveTo('mountainPass')"
        );

        console.log(
            "막힌 강:",
            "ArsWorldMovementTest.moveTo('riverBlocked')"
        );

        console.log(
            "다리 통과:",
            "ArsWorldMovementTest.moveTo('bridge')"
        );

        console.log(
            "사막 정보:",
            "ArsWorldMovementTest.inspect('desert')"
        );

        console.log(
            "오아시스 정보:",
            "ArsWorldMovementTest.inspect('oasis')"
        );

        console.log(
            "시험장 제거:",
            "ArsWorldMovementTest.remove()"
        );

        console.groupEnd();
    }

    function getState() {
        return {
            active:
                runtime.active,

            originX:
                runtime.originX,

            originY:
                runtime.originY,

            zoneIds:
                runtime.zoneIds.slice(),

            points:
                JSON.parse(
                    JSON.stringify(
                        runtime.points
                    )
                )
        };
    }

    window.ArsWorldMovementTest = {
        version: 1,

        spawnAt:
            spawnAt,

        spawnAtPlayer:
            spawnAtPlayer,

        moveTo:
            movePlayerToPoint,

        inspect:
            inspectPoint,

        printInstructions:
            printInstructions,

        remove:
            remove,

        getState:
            getState
    };

    console.log(
        "[Ars Bellum] WorldMovementTestCourse 연결 완료 - 콘솔에서 ArsWorldMovementTest.spawnAtPlayer() 실행"
    );
})();