// Ars Bellum - W_Routes.js
(function () {
    "use strict";

    const CFG = {
        enabled: true,
        startSearchDistance: 420,
        reachDistance: 8,
        maxDetourRatio: 2.25
    };

    const route = {
        active: false,
        destination: null,
        waypoints: [],
        index: 0,
        expectedX: null,
        expectedY: null,
        arrivalArmed: false,
        roadIds: [],
        settlementIds: [],
        lastReason: ""
    };

    function data() {
        return window.ArsWorldMapData || null;
    }

    function settlements() {
        const d = data();

        return d && Array.isArray(d.settlements)
            ? d.settlements
            : [];
    }

    function roads() {
        const d = data();

        return d && Array.isArray(d.roads)
            ? d.roads.filter(function (road) {
                return road && road.enabled !== false;
            })
            : [];
    }

    function settlementById(id) {
        const d = data();

        if (!d || !id) {
            return null;
        }

        if (typeof d.getSettlementById === "function") {
            return d.getSettlementById(id);
        }

        return settlements().find(function (item) {
            return item.id === id;
        }) || null;
    }

    function resolveSettlement(value) {
        if (typeof value === "string") {
            return settlementById(value);
        }

        if (value && value.id) {
            return settlementById(value.id) || value;
        }

        return null;
    }

    function dist(a, b) {
        return Math.hypot(
            Number(b.x) - Number(a.x),
            Number(b.y) - Number(a.y)
        );
    }

    function roadPoints(road, fromId, toId) {
        const from = settlementById(fromId);
        const to = settlementById(toId);

        if (!from || !to) {
            return [];
        }

        let mids = Array.isArray(road.waypoints)
            ? road.waypoints
                .map(function (point) {
                    return {
                        x: Number(point.x),
                        y: Number(point.y)
                    };
                })
                .filter(function (point) {
                    return (
                        Number.isFinite(point.x) &&
                        Number.isFinite(point.y)
                    );
                })
            : [];

        if (
            road.fromSettlementId === toId &&
            road.toSettlementId === fromId
        ) {
            mids.reverse();
        }

        return [
            {
                x: Number(from.x),
                y: Number(from.y)
            }
        ]
            .concat(mids)
            .concat([
                {
                    x: Number(to.x),
                    y: Number(to.y)
                }
            ]);
    }

    function roadLength(road) {
        const points = roadPoints(
            road,
            road.fromSettlementId,
            road.toSettlementId
        );

        let total = 0;

        for (
            let index = 0;
            index < points.length - 1;
            index += 1
        ) {
            total += dist(
                points[index],
                points[index + 1]
            );
        }

        return total;
    }

    function graph() {
        const result = new Map();

        settlements().forEach(function (settlement) {
            result.set(settlement.id, []);
        });

        roads().forEach(function (road) {
            if (
                !result.has(road.fromSettlementId) ||
                !result.has(road.toSettlementId)
            ) {
                return;
            }

            const multiplier = Math.max(
                0.1,
                Number(road.movementMultiplier) || 1
            );

            const cost =
                roadLength(road) /
                multiplier;

            result
                .get(road.fromSettlementId)
                .push({
                    to: road.toSettlementId,
                    road: road,
                    cost: cost
                });

            result
                .get(road.toSettlementId)
                .push({
                    to: road.fromSettlementId,
                    road: road,
                    cost: cost
                });
        });

        return result;
    }

    function nearestRoadSettlement(x, y) {
        const g = graph();

        let best = null;
        let bestDistance = Infinity;

        settlements().forEach(function (settlement) {
            if (
                !g.get(settlement.id) ||
                g.get(settlement.id).length === 0
            ) {
                return;
            }

            const currentDistance = Math.hypot(
                Number(settlement.x) - x,
                Number(settlement.y) - y
            );

            if (currentDistance < bestDistance) {
                best = settlement;
                bestDistance = currentDistance;
            }
        });

        return (
            best &&
            bestDistance <= CFG.startSearchDistance
        )
            ? best
            : null;
    }

    function shortestPath(startId, endId) {
        if (startId === endId) {
            return {
                settlementIds: [startId],
                roads: []
            };
        }

        const g = graph();

        if (
            !g.has(startId) ||
            !g.has(endId)
        ) {
            return null;
        }

        const open = new Set(g.keys());
        const cost = new Map();
        const previous = new Map();

        g.forEach(function (_, id) {
            cost.set(id, Infinity);
        });

        cost.set(startId, 0);

        while (open.size > 0) {
            let current = null;
            let currentCost = Infinity;

            open.forEach(function (id) {
                if (cost.get(id) < currentCost) {
                    current = id;
                    currentCost = cost.get(id);
                }
            });

            if (
                current === null ||
                currentCost === Infinity
            ) {
                break;
            }

            open.delete(current);

            if (current === endId) {
                break;
            }

            (g.get(current) || [])
                .forEach(function (edge) {
                    if (!open.has(edge.to)) {
                        return;
                    }

                    const nextCost =
                        currentCost +
                        edge.cost;

                    if (nextCost < cost.get(edge.to)) {
                        cost.set(
                            edge.to,
                            nextCost
                        );

                        previous.set(
                            edge.to,
                            {
                                from: current,
                                road: edge.road
                            }
                        );
                    }
                });
        }

        if (!previous.has(endId)) {
            return null;
        }

        const ids = [endId];
        const pathRoads = [];

        let cursor = endId;

        while (cursor !== startId) {
            const step = previous.get(cursor);

            if (!step) {
                return null;
            }

            ids.unshift(step.from);
            pathRoads.unshift(step.road);
            cursor = step.from;
        }

        return {
            settlementIds: ids,
            roads: pathRoads
        };
    }

    function pushWaypoint(list, point, metadata) {
        const item = Object.assign(
            {
                x: Number(point.x),
                y: Number(point.y),
                roadId: null,
                settlementId: null,
                final: false
            },
            metadata || {}
        );

        if (
            !Number.isFinite(item.x) ||
            !Number.isFinite(item.y)
        ) {
            return;
        }

        const last =
            list[list.length - 1];

        if (
            last &&
            Math.hypot(
                last.x - item.x,
                last.y - item.y
            ) < 0.5
        ) {
            Object.assign(last, item);
        } else {
            list.push(item);
        }
    }

    function buildPlan(
        x,
        y,
        destinationValue
    ) {
        const destination =
            resolveSettlement(
                destinationValue
            );

        if (
            !CFG.enabled ||
            !destination
        ) {
            return null;
        }

        const start =
            nearestRoadSettlement(
                x,
                y
            );

        if (!start) {
            return null;
        }

        const path =
            shortestPath(
                start.id,
                destination.id
            );

        if (!path) {
            return null;
        }

        const points = [];

        if (
            Math.hypot(
                Number(start.x) - x,
                Number(start.y) - y
            ) > CFG.reachDistance
        ) {
            pushWaypoint(
                points,
                start,
                {
                    settlementId:
                        start.id
                }
            );
        }

        path.roads.forEach(
            function (road, index) {
                const fromId =
                    path.settlementIds[index];

                const toId =
                    path.settlementIds[
                        index + 1
                    ];

                const pointsOnRoad =
                    roadPoints(
                        road,
                        fromId,
                        toId
                    );

                pointsOnRoad.forEach(
                    function (
                        point,
                        pointIndex
                    ) {
                        pushWaypoint(
                            points,
                            point,
                            {
                                roadId:
                                    road.id,

                                settlementId:
                                    pointIndex ===
                                    pointsOnRoad.length - 1
                                        ? toId
                                        : null
                            }
                        );
                    }
                );
            }
        );

        if (points.length === 0) {
            pushWaypoint(
                points,
                destination
            );
        }

        const finalPoint =
            points[
                points.length - 1
            ];

        finalPoint.x =
            Number(destination.x);

        finalPoint.y =
            Number(destination.y);

        finalPoint.settlementId =
            destination.id;

        finalPoint.final = true;

        let routeLength = 0;

        let previousPoint = {
            x: x,
            y: y
        };

        points.forEach(function (point) {
            routeLength += dist(
                previousPoint,
                point
            );

            previousPoint = point;
        });

        const directLength =
            Math.hypot(
                Number(destination.x) - x,
                Number(destination.y) - y
            );

        const ratio =
            directLength > 0
                ? routeLength /
                  directLength
                : 1;

        if (
            ratio >
            CFG.maxDetourRatio
        ) {
            return null;
        }

        return {
            destination: destination,

            waypoints: points,

            roadIds:
                path.roads.map(
                    function (road) {
                        return road.id;
                    }
                ),

            settlementIds:
                path.settlementIds.slice(),

            routeLength:
                routeLength,

            directLength:
                directLength,

            detourRatio:
                ratio
        };
    }

    function applyWaypoint(party) {
        const point =
            route.waypoints[
                route.index
            ];

        if (!point) {
            return false;
        }

        party.targetX = point.x;
        party.targetY = point.y;

        party.targetNode =
            point.final
                ? route.destination
                : null;

        route.expectedX =
            point.x;

        route.expectedY =
            point.y;

        return true;
    }

    function cancel(
        reason,
        clearNode
    ) {
        route.active = false;
        route.destination = null;
        route.waypoints = [];
        route.index = 0;
        route.expectedX = null;
        route.expectedY = null;
        route.arrivalArmed = false;
        route.roadIds = [];
        route.settlementIds = [];

        route.lastReason =
            reason ||
            "cancelled";

        if (
            clearNode !== false &&
            window.playerParty
        ) {
            window.playerParty
                .targetNode = null;
        }
    }

    function setDestination(
        destinationValue,
        partyValue
    ) {
        const party =
            partyValue ||
            window.playerParty;

        const destination =
            resolveSettlement(
                destinationValue
            );

        if (
            !party ||
            !destination
        ) {
            return "invalid";
        }

        cancel(
            "new_destination",
            false
        );

        const plan =
            buildPlan(
                Number(party.worldX),
                Number(party.worldY),
                destination
            );

        if (!plan) {
            party.targetX =
                Number(destination.x);

            party.targetY =
                Number(destination.y);

            party.targetNode =
                destination;

            route.lastReason =
                "direct_fallback";

            return "direct";
        }

        route.active = true;

        route.destination =
            plan.destination;

        route.waypoints =
            plan.waypoints;

        route.roadIds =
            plan.roadIds;

        route.settlementIds =
            plan.settlementIds;

        route.index = 0;
        route.lastReason = "";

        applyWaypoint(party);

        return "road";
    }

    function update(partyValue) {
        const party =
            partyValue ||
            window.playerParty;

        if (
            !route.active ||
            !party
        ) {
            return false;
        }

        if (
            Math.abs(
                Number(party.targetX) -
                route.expectedX
            ) > 0.5 ||
            Math.abs(
                Number(party.targetY) -
                route.expectedY
            ) > 0.5
        ) {
            cancel(
                "manual_override",
                false
            );

            return false;
        }

        const point =
            route.waypoints[
                route.index
            ];

        if (!point) {
            cancel(
                "empty_route",
                false
            );

            return false;
        }

        const remaining =
            Math.hypot(
                Number(party.worldX) -
                    point.x,

                Number(party.worldY) -
                    point.y
            );

        if (
            remaining >
            CFG.reachDistance
        ) {
            return true;
        }

        if (point.final) {
            if (!route.arrivalArmed) {
                route.arrivalArmed = true;

                party.targetNode =
                    route.destination;

                return true;
            }

            if (
                party.targetNode === null
            ) {
                cancel(
                    "arrived",
                    false
                );
            }

            return true;
        }

        route.index += 1;

        if (!applyWaypoint(party)) {
            cancel(
                "finished",
                false
            );

            return false;
        }

        return true;
    }

    function state() {
        return {
            enabled:
                CFG.enabled,

            active:
                route.active,

            destinationId:
                route.destination
                    ? route.destination.id
                    : null,

            currentIndex:
                route.index,

            roadIds:
                route.roadIds.slice(),

            settlementIds:
                route.settlementIds.slice(),

            remainingWaypoints:
                route.active
                    ? route.waypoints
                        .slice(route.index)
                        .map(function (point) {
                            return Object.assign(
                                {},
                                point
                            );
                        })
                    : [],

            lastReason:
                route.lastReason
        };
    }

    window.ArsWorldRoutePlanner = {
        version: 1,

        setDestination:
            setDestination,

        previewRoute:
            buildPlan,

        update:
            update,

        cancelRoute:
            cancel,

        getState:
            state,

        getRemainingWaypoints:
            function () {
                return state()
                    .remainingWaypoints;
            },

        setEnabled:
            function (enabled) {
                CFG.enabled =
                    Boolean(enabled);

                if (!CFG.enabled) {
                    cancel(
                        "disabled",
                        false
                    );
                }

                return CFG.enabled;
            },

        configure:
            function (options) {
                options =
                    options || {};

                if (
                    Number.isFinite(
                        Number(
                            options
                                .startSearchDistance
                        )
                    )
                ) {
                    CFG.startSearchDistance =
                        Math.max(
                            0,
                            Number(
                                options
                                    .startSearchDistance
                            )
                        );
                }

                if (
                    Number.isFinite(
                        Number(
                            options
                                .reachDistance
                        )
                    )
                ) {
                    CFG.reachDistance =
                        Math.max(
                            2,
                            Number(
                                options
                                    .reachDistance
                            )
                        );
                }

                if (
                    Number.isFinite(
                        Number(
                            options
                                .maxDetourRatio
                        )
                    )
                ) {
                    CFG.maxDetourRatio =
                        Math.max(
                            1,
                            Number(
                                options
                                    .maxDetourRatio
                            )
                        );
                }

                return Object.assign(
                    {},
                    CFG
                );
            },

        debugPrint:
            function () {
                console.log(
                    "[Ars Bellum] 현재 월드 경로:",
                    state()
                );
            }
    };

    console.log(
        "[Ars Bellum] WorldRoutePlanner 연결 완료 - 수동 클릭 우선"
    );
})();