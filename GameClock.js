// ============================================================
// Ars Bellum - GameClock.js
// 월드 시간의 단일 기준. 초기 상태는 정지다.
// ============================================================

(function () {
    "use strict";

    const STORAGE_KEY = "ars_bellum_clock_v1";
    const ALLOWED_SPEEDS = [0, 1, 2, 4, 8];

    const clock = {
        day: 1,
        hour: 8,
        minute: 0,

        speed: 1,
        running: false,

        // 1배속 기준:
        // 현실 1초가 게임 1분이다.
        realMsPerGameMinute: 1000
    };

    const listeners = new Set();

    let lastRealTime = 0;
    let accumulatedRealMs = 0;

    function integer(
        value,
        minimum,
        maximum,
        fallback
    ) {
        const number =
            Math.floor(
                Number(value)
            );

        if (!Number.isFinite(number)) {
            return fallback;
        }

        return Math.max(
            minimum,
            Math.min(
                maximum,
                number
            )
        );
    }

    function normalizeSpeed(value) {
        const speed =
            Number(value);

        return ALLOWED_SPEEDS.includes(speed)
            ? speed
            : 1;
    }

    function getLabel() {
        const hour =
            String(clock.hour)
                .padStart(2, "0");

        const minute =
            String(clock.minute)
                .padStart(2, "0");

        return (
            clock.day +
            "일 " +
            hour +
            ":" +
            minute
        );
    }

    function getState() {
        return {
            day: clock.day,
            hour: clock.hour,
            minute: clock.minute,

            speed: clock.speed,
            running: clock.running,

            realMsPerGameMinute:
                clock.realMsPerGameMinute,

            totalMinutes:
                (clock.day - 1) * 1440 +
                clock.hour * 60 +
                clock.minute,

            label: getLabel()
        };
    }

    function emit(
        type,
        extra
    ) {
        const event =
            Object.assign(
                {
                    type: type,
                    clock: getState()
                },
                extra || {}
            );

        listeners.forEach(
            function (listener) {
                try {
                    listener(event);
                } catch (error) {
                    console.error(
                        "[Ars Bellum] GameClock 이벤트 오류:",
                        error
                    );
                }
            }
        );
    }

    function save() {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                day: clock.day,
                hour: clock.hour,
                minute: clock.minute,

                speed: clock.speed,

                realMsPerGameMinute:
                    clock.realMsPerGameMinute
            })
        );
    }

    function load() {
        const raw =
            localStorage.getItem(
                STORAGE_KEY
            );

        if (!raw) {
            return false;
        }

        try {
            const saved =
                JSON.parse(raw);

            clock.day =
                integer(
                    saved.day,
                    1,
                    999999,
                    1
                );

            clock.hour =
                integer(
                    saved.hour,
                    0,
                    23,
                    8
                );

            clock.minute =
                integer(
                    saved.minute,
                    0,
                    59,
                    0
                );

            clock.speed =
                normalizeSpeed(
                    saved.speed
                );

            const realMs =
                Number(
                    saved.realMsPerGameMinute
                );

            if (
                Number.isFinite(realMs) &&
                realMs >= 50
            ) {
                clock.realMsPerGameMinute =
                    realMs;
            }

            return true;
        } catch (error) {
            console.warn(
                "[Ars Bellum] GameClock 저장 데이터 무시:",
                error
            );

            return false;
        }
    }

    function attachToGameState() {
        if (
            !window.ArsGameState ||
            typeof window
                .ArsGameState
                .getState !==
                "function"
        ) {
            return;
        }

        const root =
            window
                .ArsGameState
                .getState();

        if (
            !root ||
            typeof root !==
                "object"
        ) {
            return;
        }

        if (
            !root.world ||
            typeof root.world !==
                "object"
        ) {
            root.world = {};
        }

        /*
         * GameState 내부에서도
         * 동일한 시계 객체를 보게 한다.
         */
        root.world.clock =
            clock;
    }

    function advanceMinutes(amount) {
        const minutes =
            Math.floor(
                Number(amount)
            );

        if (
            !Number.isFinite(minutes) ||
            minutes === 0
        ) {
            return getState();
        }

        const previousDay =
            clock.day;

        const previousHour =
            clock.hour;

        let totalMinutes =
            (clock.day - 1) * 1440 +
            clock.hour * 60 +
            clock.minute +
            minutes;

        totalMinutes =
            Math.max(
                0,
                totalMinutes
            );

        clock.day =
            Math.floor(
                totalMinutes / 1440
            ) + 1;

        const minuteOfDay =
            totalMinutes % 1440;

        clock.hour =
            Math.floor(
                minuteOfDay / 60
            );

        clock.minute =
            minuteOfDay % 60;

        emit(
            "minute",
            {
                amount: minutes
            }
        );

        if (
            clock.hour !== previousHour ||
            clock.day !== previousDay
        ) {
            emit("hour");
        }

        if (
            clock.day !== previousDay
        ) {
            emit(
                "day",
                {
                    previousDay:
                        previousDay,

                    currentDay:
                        clock.day
                }
            );
        }

        if (
            clock.minute % 10 === 0
        ) {
            save();
        }

        return getState();
    }

    function setSpeed(value) {
        clock.speed =
            normalizeSpeed(value);

        emit("speed");

        return clock.speed;
    }

    function start() {
        clock.running = true;

        lastRealTime =
            performance.now();

        emit("start");

        return getState();
    }

    function pause() {
        clock.running = false;

        accumulatedRealMs = 0;

        save();
        emit("pause");

        return getState();
    }

    function reset() {
        clock.day = 1;
        clock.hour = 8;
        clock.minute = 0;

        clock.speed = 1;
        clock.running = false;

        accumulatedRealMs = 0;

        save();
        emit("reset");

        return getState();
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

    function configure(options) {
        const settings =
            options || {};

        const realMs =
            Number(
                settings
                    .realMsPerGameMinute
            );

        if (
            Number.isFinite(realMs) &&
            realMs >= 50
        ) {
            clock.realMsPerGameMinute =
                realMs;
        }

        if (
            settings.speed !==
            undefined
        ) {
            setSpeed(
                settings.speed
            );
        }

        save();

        return getState();
    }

    function frame(now) {
        if (!lastRealTime) {
            lastRealTime =
                now;
        }

        const delta =
            Math.min(
                1000,
                Math.max(
                    0,
                    now -
                    lastRealTime
                )
            );

        lastRealTime =
            now;

        if (
            clock.running &&
            clock.speed > 0
        ) {
            accumulatedRealMs +=
                delta *
                clock.speed;

            const minuteDuration =
                Math.max(
                    50,
                    clock
                        .realMsPerGameMinute
                );

            const elapsedMinutes =
                Math.floor(
                    accumulatedRealMs /
                    minuteDuration
                );

            if (
                elapsedMinutes > 0
            ) {
                accumulatedRealMs -=
                    elapsedMinutes *
                    minuteDuration;

                advanceMinutes(
                    elapsedMinutes
                );
            }
        }

        requestAnimationFrame(
            frame
        );
    }

    window.ArsGameClock = {
        version: 1,

        start: start,
        pause: pause,

        toggle: function () {
            return clock.running
                ? pause()
                : start();
        },

        setSpeed:
            setSpeed,

        advanceMinutes:
            advanceMinutes,

        getState:
            getState,

        getLabel:
            getLabel,

        subscribe:
            subscribe,

        configure:
            configure,

        save:
            save,

        load:
            load,

        reset:
            reset
    };

    load();
    attachToGameState();

    requestAnimationFrame(
        frame
    );

    window.addEventListener(
        "beforeunload",
        save
    );

    /*
     * 앱을 내렸다가 다시 열었을 때
     * 꺼져 있던 시간만큼 갑자기 시간이 흐르지 않게 한다.
     */
    document.addEventListener(
        "visibilitychange",
        function () {
            lastRealTime =
                performance.now();
        }
    );

    console.log(
        "[Ars Bellum] GameClock 연결 완료 -",
        getLabel(),
        "(초기 정지)"
    );
})();