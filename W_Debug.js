(function () {
    "use strict";

    const state = {
        enabled: false,
        showRoads: true,
        showTerrainZones: true,
        showRoute: true,
        showNodeIds: false,
        showRoadWidth: true,
        opacity: 0.85
    };

    function getData() {
        return (
            window.ArsWorldMapData ||
            null
        );
    }

    function getSettlementById(
        settlementId
    ) {
        const data =
            getData();

        if (
            !data ||
            !settlementId
        ) {
            return null;
        }

        if (
            typeof data
                .getSettlementById ===
                "function"
        ) {
            return data
                .getSettlementById(
                    settlementId
                );
        }

        if (
            !Array.isArray(
                data.settlements
            )
        ) {
            return null;
        }

        return (
            data.settlements.find(
                function (
                    settlement
                ) {
                    return (
                        settlement.id ===
                        settlementId
                    );
                }
            ) ||
            null
        );
    }

    function buildRoadPoints(
        road
    ) {
        const from =
            getSettlementById(
                road
                    .fromSettlementId
            );

        const to =
            getSettlementById(
                road
                    .toSettlementId
            );

        if (
            !from ||
            !to
        ) {
            return [];
        }

        const points = [
            {
                x: Number(from.x),
                y: Number(from.y)
            }
        ];

        if (
            Array.isArray(
                road.waypoints
            )
        ) {
            road.waypoints.forEach(
                function (point) {
                    if (
                        point &&
                        Number.isFinite(
                            Number(
                                point.x
                            )
                        ) &&
                        Number.isFinite(
                            Number(
                                point.y
                            )
                        )
                    ) {
                        points.push({
                            x:
                                Number(
                                    point.x
                                ),

                            y:
                                Number(
                                    point.y
                                )
                        });
                    }
                }
            );
        }

        points.push({
            x: Number(to.x),
            y: Number(to.y)
        });

        return points;
    }

    function strokePolyline(
        context,
        points
    ) {
        if (
            !Array.isArray(points) ||
            points.length < 2
        ) {
            return;
        }

        context.beginPath();

        context.moveTo(
            points[0].x,
            points[0].y
        );

        for (
            let index = 1;
            index < points.length;
            index += 1
        ) {
            context.lineTo(
                points[index].x,
                points[index].y
            );
        }

        context.stroke();
    }

    function drawRoads(context) {
        const data =
            getData();

        if (
            !data ||
            !Array.isArray(
                data.roads
            )
        ) {
            return;
        }

        const roadWidth =
            window.ArsWorldMapSystem &&
            typeof window
                .ArsWorldMapSystem
                .getCurrentTravelInfo ===
                "function"
                ? window
                    .ArsWorldMapSystem
                    .getCurrentTravelInfo()
                    .roadHalfWidth
                : 34;

        data.roads.forEach(
            function (road) {
                if (
                    !road ||
                    road.enabled ===
                        false
                ) {
                    return;
                }

                const points =
                    buildRoadPoints(
                        road
                    );

                if (
                    points.length < 2
                ) {
                    return;
                }

                if (
                    state.showRoadWidth
                ) {
                    context.save();

                    context.strokeStyle =
                        "rgba(241, 196, 15, 0.16)";

                    context.lineWidth =
                        Math.max(
                            2,
                            roadWidth * 2
                        );

                    context.lineCap =
                        "round";

                    context.lineJoin =
                        "round";

                    strokePolyline(
                        context,
                        points
                    );

                    context.restore();
                }

                context.save();

                context.strokeStyle =
                    "rgba(241, 196, 15, 0.95)";

                context.lineWidth =
                    4;

                context.lineCap =
                    "round";

                context.lineJoin =
                    "round";

                context.setLineDash(
                    [14, 8]
                );

                strokePolyline(
                    context,
                    points
                );

                context.setLineDash(
                    []
                );

                context.restore();

                const middle =
                    points[
                        Math.floor(
                            points.length /
                                2
                        )
                    ];

                context.save();

                context.font =
                    "bold 12px sans-serif";

                context.textAlign =
                    "center";

                context.fillStyle =
                    "rgba(0, 0, 0, 0.75)";

                context.fillRect(
                    middle.x - 52,
                    middle.y - 25,
                    104,
                    20
                );

                context.fillStyle =
                    "#f1c40f";

                context.fillText(
                    road.name ||
                        road.id,
                    middle.x,
                    middle.y - 10
                );

                context.restore();
            }
        );
    }

    function terrainColor(
        baseId
    ) {
        const colors = {
            plain:
                "rgba(236, 240, 241, 0.20)",

            forest:
                "rgba(39, 174, 96, 0.28)",

            hill:
                "rgba(160, 120, 70, 0.28)",

            highland:
                "rgba(127, 140, 141, 0.30)",

            mountain:
                "rgba(52, 73, 94, 0.42)",

            snow:
                "rgba(236, 240, 241, 0.38)",

            desert:
                "rgba(243, 156, 18, 0.32)",

            marsh:
                "rgba(22, 160, 133, 0.34)",

            river:
                "rgba(52, 152, 219, 0.40)",

            sea:
                "rgba(41, 128, 185, 0.45)"
        };

        return (
            colors[baseId] ||
            "rgba(155, 89, 182, 0.30)"
        );
    }

    function drawZoneShape(
        context,
        zone
    ) {
        const shape =
            zone.shape;

        if (!shape) {
            return;
        }

        context.beginPath();

        if (
            shape.type ===
            "rect"
        ) {
            context.rect(
                shape.x,
                shape.y,
                shape.width,
                shape.height
            );
        } else if (
            shape.type ===
            "circle"
        ) {
            context.arc(
                shape.x,
                shape.y,
                shape.radius,
                0,
                Math.PI * 2
            );
        } else {
            return;
        }

        context.fill();
        context.stroke();
    }

    function zoneLabelPosition(
        zone
    ) {
        const shape =
            zone.shape;

        if (
            shape.type ===
            "rect"
        ) {
            return {
                x:
                    shape.x +
                    shape.width / 2,

                y:
                    shape.y +
                    shape.height / 2
            };
        }

        return {
            x: shape.x,
            y: shape.y
        };
    }

    function drawTerrainZones(
        context
    ) {
        const terrainMap =
            window
                .ArsWorldTerrainMap;

        if (
            !terrainMap ||
            typeof terrainMap
                .getZones !==
                "function"
        ) {
            return;
        }

        terrainMap
            .getZones()
            .forEach(
                function (zone) {
                    if (
                        !zone ||
                        zone.enabled ===
                            false
                    ) {
                        return;
                    }

                    context.save();

                    context.fillStyle =
                        terrainColor(
                            zone.baseId
                        );

                    context.strokeStyle =
                        "rgba(255, 255, 255, 0.75)";

                    context.lineWidth =
                        3;

                    context.setLineDash(
                        [10, 7]
                    );

                    drawZoneShape(
                        context,
                        zone
                    );

                    context.setLineDash(
                        []
                    );

                    const label =
                        zoneLabelPosition(
                            zone
                        );

                    context.font =
                        "bold 13px sans-serif";

                    context.textAlign =
                        "center";

                    context.fillStyle =
                        "rgba(0, 0, 0, 0.75)";

                    context.fillRect(
                        label.x - 65,
                        label.y - 12,
                        130,
                        24
                    );

                    context.fillStyle =
                        "#ffffff";

                    context.fillText(
                        zone.name ||
                            zone.id,
                        label.x,
                        label.y + 5
                    );

                    context.restore();
                }
            );
    }

    function drawActiveRoute(
        context,
        party
    ) {
        const planner =
            window
                .ArsWorldRoutePlanner;

        if (
            !planner ||
            typeof planner
                .getRemainingWaypoints !==
                "function"
        ) {
            return;
        }

        const waypoints =
            planner
                .getRemainingWaypoints();

        if (
            !party ||
            waypoints.length === 0
        ) {
            return;
        }

        const points = [
            {
                x:
                    Number(
                        party.worldX
                    ),

                y:
                    Number(
                        party.worldY
                    )
            }
        ].concat(waypoints);

        context.save();

        context.strokeStyle =
            "rgba(46, 204, 113, 0.95)";

        context.lineWidth =
            6;

        context.lineCap =
            "round";

        context.lineJoin =
            "round";

        strokePolyline(
            context,
            points
        );

        waypoints.forEach(
            function (
                waypoint,
                index
            ) {
                context.beginPath();

                context.arc(
                    waypoint.x,
                    waypoint.y,
                    waypoint.final
                        ? 9
                        : 6,
                    0,
                    Math.PI * 2
                );

                context.fillStyle =
                    waypoint.final
                        ? "#e74c3c"
                        : "#2ecc71";

                context.fill();

                context.strokeStyle =
                    "#ffffff";

                context.lineWidth =
                    2;

                context.stroke();

                context.font =
                    "bold 11px sans-serif";

                context.textAlign =
                    "center";

                context.fillStyle =
                    "#ffffff";

                context.fillText(
                    String(
                        index + 1
                    ),
                    waypoint.x,
                    waypoint.y - 12
                );
            }
        );

        context.restore();
    }

    function draw(
        context,
        party
    ) {
        if (
            !state.enabled ||
            !context
        ) {
            return;
        }

        context.save();

        context.globalAlpha =
            Math.max(
                0.1,
                Math.min(
                    1,
                    state.opacity
                )
            );

        if (
            state
                .showTerrainZones
        ) {
            drawTerrainZones(
                context
            );
        }

        if (state.showRoads) {
            drawRoads(context);
        }

        if (state.showRoute) {
            drawActiveRoute(
                context,
                party ||
                    window.playerParty
            );
        }

        context.restore();
    }

    function toggle() {
        state.enabled =
            !state.enabled;

        console.log(
            "[Ars Bellum] 월드 디버그 표시:",
            state.enabled
                ? "켜짐"
                : "꺼짐"
        );

        return state.enabled;
    }

    window.ArsWorldMapDebugOverlay = {
        version: 1,

        draw:
            draw,

        toggle:
            toggle,

        setEnabled:
            function (enabled) {
                state.enabled =
                    Boolean(enabled);

                return state.enabled;
            },

        configure:
            function (options) {
                if (
                    !options ||
                    typeof options !==
                        "object"
                ) {
                    return Object.assign(
                        {},
                        state
                    );
                }

                Object.keys(state)
                    .forEach(
                        function (key) {
                            if (
                                options[key] !==
                                undefined
                            ) {
                                state[key] =
                                    key ===
                                    "opacity"
                                        ? Math.max(
                                            0.1,
                                            Math.min(
                                                1,
                                                Number(
                                                    options[
                                                        key
                                                    ]
                                                ) ||
                                                    0.85
                                            )
                                        )
                                        : Boolean(
                                            options[
                                                key
                                            ]
                                        );
                            }
                        }
                    );

                return Object.assign(
                    {},
                    state
                );
            },

        getState:
            function () {
                return Object.assign(
                    {},
                    state
                );
            }
    };

    console.log(
        "[Ars Bellum] WorldMapDebugOverlay 연결 완료 - 기본 꺼짐"
    );
})();