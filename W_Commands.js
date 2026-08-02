(function () {
    "use strict";

    const runtime = {
        sequence: 0,
        lastCommand: null,
        history: []
    };

    const HISTORY_LIMIT = 30;
    const listeners = new Set();

    function numberOrNull(value) {
        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : null;
    }

    function getParty(partyValue) {
        return (
            partyValue ||
            window.playerParty ||
            null
        );
    }

    function getMapSize() {
        const data =
            window.ArsWorldMapData;

        const map =
            data && data.map
                ? data.map
                : {};

        return {
            width:
                Number.isFinite(
                    Number(map.width)
                )
                    ? Number(map.width)
                    : 4096,

            height:
                Number.isFinite(
                    Number(map.height)
                )
                    ? Number(map.height)
                    : 4096
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

    function clampWorldPoint(x, y) {
        const worldX =
            numberOrNull(x);

        const worldY =
            numberOrNull(y);

        if (
            worldX === null ||
            worldY === null
        ) {
            return null;
        }

        const size =
            getMapSize();

        return {
            x: clamp(
                worldX,
                0,
                size.width
            ),

            y: clamp(
                worldY,
                0,
                size.height
            )
        };
    }

    function resolveSettlement(value) {
        const data =
            window.ArsWorldMapData;

        if (!value) {
            return null;
        }

        if (
            typeof value ===
            "string"
        ) {
            if (
                data &&
                typeof data
                    .getSettlementById ===
                    "function"
            ) {
                return data
                    .getSettlementById(
                        value
                    );
            }

            return null;
        }

        if (
            typeof value ===
                "object" &&
            value.id
        ) {
            if (
                data &&
                typeof data
                    .getSettlementById ===
                    "function"
            ) {
                return (
                    data.getSettlementById(
                        value.id
                    ) ||
                    value
                );
            }

            return value;
        }

        return null;
    }

    function emit(command) {
        listeners.forEach(
            function (listener) {
                try {
                    listener(command);
                } catch (error) {
                    console.error(
                        "[Ars Bellum] 월드 명령 이벤트 오류:",
                        error
                    );
                }
            }
        );
    }

    function record(
        type,
        payload
    ) {
        runtime.sequence += 1;

        const command = {
            id:
                runtime.sequence,

            type:
                type,

            payload:
                payload || {},

            timestamp:
                Date.now()
        };

        runtime.lastCommand =
            command;

        runtime.history.push(
            command
        );

        if (
            runtime.history.length >
            HISTORY_LIMIT
        ) {
            runtime.history.shift();
        }

        emit(command);

        return command;
    }

    function subscribe(listener) {
        if (
            typeof listener !==
            "function"
        ) {
            return function () {};
        }

        listeners.add(listener);

        return function () {
            listeners.delete(
                listener
            );
        };
    }

    function cancelAutomaticRoute(
        reason
    ) {
        if (
            window
                .ArsWorldRoutePlanner &&
            typeof window
                .ArsWorldRoutePlanner
                .cancelRoute ===
                "function"
        ) {
            window
                .ArsWorldRoutePlanner
                .cancelRoute(
                    reason ||
                        "new_command",
                    false
                );
        }
    }

    function moveToGround(
        worldX,
        worldY,
        partyValue
    ) {
        const party =
            getParty(partyValue);

        const point =
            clampWorldPoint(
                worldX,
                worldY
            );

        if (
            !party ||
            !point
        ) {
            return false;
        }

        cancelAutomaticRoute(
            "manual_ground"
        );

        party.targetX =
            point.x;

        party.targetY =
            point.y;

        party.targetNode =
            null;

        record(
            "MOVE_TO_GROUND",
            {
                x: point.x,
                y: point.y
            }
        );

        return true;
    }

    function moveToSettlement(
        settlementValue,
        partyValue
    ) {
        const party =
            getParty(partyValue);

        const settlement =
            resolveSettlement(
                settlementValue
            );

        if (
            !party ||
            !settlement
        ) {
            return false;
        }

        let routeMode =
            "direct";

        if (
            window
                .ArsWorldRoutePlanner &&
            typeof window
                .ArsWorldRoutePlanner
                .setDestination ===
                "function"
        ) {
            routeMode =
                window
                    .ArsWorldRoutePlanner
                    .setDestination(
                        settlement,
                        party
                    );
        } else {
            cancelAutomaticRoute(
                "settlement_direct"
            );

            party.targetX =
                Number(
                    settlement.x
                );

            party.targetY =
                Number(
                    settlement.y
                );

            party.targetNode =
                settlement;
        }

        record(
            "MOVE_TO_SETTLEMENT",
            {
                settlementId:
                    settlement.id,

                routeMode:
                    routeMode
            }
        );

        return true;
    }

    function stop(partyValue) {
        const party =
            getParty(partyValue);

        if (!party) {
            return false;
        }

        cancelAutomaticRoute(
            "stop_command"
        );

        party.targetX =
            Number(
                party.worldX
            );

        party.targetY =
            Number(
                party.worldY
            );

        party.targetNode =
            null;

        record(
            "STOP",
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
        );

        return true;
    }

    function getState() {
        return {
            sequence:
                runtime.sequence,

            lastCommand:
                runtime.lastCommand,

            history:
                runtime.history.slice()
        };
    }

    window.ArsWorldMapCommands = {
        version: 1,

        moveToGround:
            moveToGround,

        moveToSettlement:
            moveToSettlement,

        stop:
            stop,

        subscribe:
            subscribe,

        getState:
            getState,

        clearHistory:
            function () {
                runtime.history.length =
                    0;

                runtime.lastCommand =
                    null;
            }
    };

    console.log(
        "[Ars Bellum] WorldMapCommandSystem 연결 완료 - 수동 이동 명령이 자동 경로보다 우선"
    );
})();