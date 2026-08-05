// ============================================================
// Ars Bellum - SimTime.js
//
// 월드맵, 전투, 지원군, 세계 시계를
// 하나의 시뮬레이션 배속으로 통합한다.
//
// GameClock.js는 날짜와 시각을 기록한다.
// 이 파일은 실제 배속과 정지 상태를 관리한다.
// ============================================================

(function () {
    "use strict";

    const MODE_SCALES = {
        menu: [
            0
        ],

        world: [
            0,
            1,
            2,
            4,
            8
        ],

        battle: [
            0,
            0.25,
            0.5,
            1,
            2
        ]
    };

    const state = {
        mode: "menu",
        scale: 0,

        worldScale: 1,
        battleScale: 1,

        previousNonZeroScale: {
            world: 1,
            battle: 1
        },

        clockAccumulator: 0,
        lastFrameTime: 0
    };

    const listeners =
        new Set();

    let manager = null;

    let originalManagerInit = null;
    let originalClockPause = null;

    // ========================================================
    // 기본 보조 함수
    // ========================================================

    function finiteNumber(
        value,
        fallback
    ) {
        const number =
            Number(value);

        return Number.isFinite(number)
            ? number
            : fallback;
    }

    function getAllowedScales(mode) {
        const key =
            MODE_SCALES[mode]
                ? mode
                : state.mode;

        return MODE_SCALES[key].slice();
    }

    function isAllowedScale(
        mode,
        scale
    ) {
        const allowed =
            MODE_SCALES[mode];

        return Boolean(
            allowed &&
            allowed.includes(scale)
        );
    }

    function normalizeMode(mode) {
        return MODE_SCALES[mode]
            ? mode
            : "menu";
    }

    function normalizeScale(
        mode,
        scale,
        fallback
    ) {
        const number =
            finiteNumber(
                scale,
                fallback
            );

        if (
            isAllowedScale(
                mode,
                number
            )
        ) {
            return number;
        }

        return fallback;
    }

    // ========================================================
    // 저장 및 불러오기
    // ========================================================

    function capturePreferences() {
        return { version: 1, worldScale: state.worldScale, battleScale: state.battleScale };
    }

    function validatePreferences(snapshot) {
        const value = snapshot || {};
        const errors = [];
        const allowedKeys = ["version", "worldScale", "battleScale"];
        if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push("not_plain_object"); }
        else {
            Object.keys(value).sort().forEach(function (key) {
                if (allowedKeys.indexOf(key) < 0) { errors.push("unexpected_persistent_field:" + key); }
            });
        }
        if (value.version !== 1) { errors.push(value.version > 1 ? "future_version" : "invalid_version"); }
        if ([1, 2, 4, 8].indexOf(value.worldScale) < 0) { errors.push("invalid_world_scale"); }
        if ([0.25, 0.5, 1, 2].indexOf(value.battleScale) < 0) { errors.push("invalid_battle_scale"); }
        const uniqueErrors = Array.from(new Set(errors)).sort();
        return uniqueErrors.length ? { ok: false, error: "m18_save_invalid_preferences", errors: uniqueErrors } : { ok: true, snapshot: { version: 1, worldScale: value.worldScale, battleScale: value.battleScale } };
    }

    function applyPreferences(snapshot) {
        const validation = validatePreferences(snapshot);
        if (!validation.ok) { return validation; }
        const preferences = validation.snapshot;
        state.worldScale = preferences.worldScale;
        state.battleScale = preferences.battleScale;
        state.previousNonZeroScale.world = preferences.worldScale;
        state.previousNonZeroScale.battle = preferences.battleScale;
        state.mode = "menu";
        state.scale = 0;
        state.clockAccumulator = 0;
        state.lastFrameTime = 0;
        syncGameState();
        syncGameManager();
        return { ok: true, preferences: capturePreferences() };
    }

    function savePreferences() { return { ok: true, persisted: false }; }

    function loadPreferences() {
        const bootstrap = window.ArsSaveService && typeof window.ArsSaveService.getBootstrapResult === "function" ? window.ArsSaveService.getBootstrapResult() : null;
        const preferences = bootstrap && bootstrap.simulationPreferences ? bootstrap.simulationPreferences : { version: 1, worldScale: 1, battleScale: 1 };
        return applyPreferences(preferences);
    }

    // ========================================================
    // 현재 상태
    // ========================================================

    function getState() {
        return {
            mode:
                state.mode,

            scale:
                state.scale,

            paused:
                state.scale === 0,

            worldScale:
                state.worldScale,

            battleScale:
                state.battleScale,

            allowedScales:
                getAllowedScales(
                    state.mode
                ),

            clockLabel:
                (
                    window.ArsGameClock &&
                    typeof window
                        .ArsGameClock
                        .getLabel ===
                        "function"
                )
                    ? window
                        .ArsGameClock
                        .getLabel()
                    : null
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
                    simulation:
                        getState()
                },
                extra || {}
            );

        listeners.forEach(
            function (listener) {
                try {
                    listener(event);
                } catch (error) {
                    console.error(
                        "[Ars Bellum] 시뮬레이션 시간 이벤트 오류:",
                        error
                    );
                }
            }
        );
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

    // ========================================================
    // GameState 연동
    // ========================================================

    function syncGameState() {
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
            !root.runtime ||
            typeof root.runtime !==
                "object"
        ) {
            root.runtime = {};
        }

        root.runtime.mode =
            state.mode;

        root.runtime.timeScale =
            state.scale;

        root.runtime.paused =
            state.scale === 0;
    }

    // ========================================================
    // 기존 GameManager 연동
    // ========================================================

    function findGameManager() {
        try {
            if (
                typeof gameManager !==
                "undefined"
            ) {
                return gameManager;
            }
        } catch (error) {
            // 전역 변수가 아직 없는 경우
        }

        if (
            window.gameManager &&
            typeof window.gameManager ===
                "object"
        ) {
            return window.gameManager;
        }

        return null;
    }

    function syncGameManager() {
        if (!manager) {
            manager =
                findGameManager();
        }

        if (!manager) {
            return;
        }

        manager.timeScale =
            state.scale;

        manager.state =
            state.scale === 0
                ? "PAUSED"
                : "PLAYING";

        /*
         * 기존 index.html에는
         * window.gameManager를 확인하는 코드도 있으므로
         * 같은 객체를 window에도 연결한다.
         */
        window.gameManager =
            manager;
    }

    function installGameManagerBridge() {
        manager =
            findGameManager();

        if (!manager) {
            console.warn(
                "[Ars Bellum] GameManager를 찾지 못했습니다."
            );

            return;
        }

        if (
            manager
                .__arsSimulationConnected
        ) {
            syncGameManager();
            return;
        }

        manager
            .__arsSimulationConnected =
            true;

        if (
            typeof manager.init ===
            "function"
        ) {
            originalManagerInit =
                manager.init.bind(
                    manager
                );

            manager.init =
            function () {
                const result =
                    originalManagerInit();

                syncGameManager();

                return result;
            };
        }

        /*
         * 기존 전투 UI 버튼:
         *
         * gameManager.setTimeScale(0)
         * gameManager.setTimeScale(1)
         * gameManager.setTimeScale(2)
         *
         * 위 호출을 모두 통합 시간 관리자로 보낸다.
         */
        manager.setTimeScale =
        function (scale) {
            return setScale(
                scale
            );
        };

        syncGameManager();
    }

    // ========================================================
    // GameClock 연동
    // ========================================================

    function getClockMinutesPerRealSecond() {
        if (
            !window.ArsGameClock ||
            typeof window
                .ArsGameClock
                .getState !==
                "function"
        ) {
            return 1;
        }

        const clockState =
            window
                .ArsGameClock
                .getState();

        const realMsPerGameMinute =
            finiteNumber(
                clockState
                    .realMsPerGameMinute,
                1000
            );

        if (
            realMsPerGameMinute <= 0
        ) {
            return 1;
        }

        /*
         * 현재 GameClock 기본값:
         *
         * 현실 1000ms = 게임 1분
         * 즉 현실 1초 = 게임 1분
         */
        return (
            1000 /
            realMsPerGameMinute
        );
    }

    function installGameClockBridge() {
        const clock =
            window.ArsGameClock;

        if (!clock) {
            console.warn(
                "[Ars Bellum] GameClock을 찾지 못했습니다."
            );

            return;
        }

        if (
            clock
                .__arsSimulationConnected
        ) {
            return;
        }

        clock
            .__arsSimulationConnected =
            true;

        /*
         * GameClock의 자체 자동 진행을 정지시킨다.
         * 이후 날짜 진행은 이 파일 하나가 담당한다.
         */
        if (
            typeof clock.pause ===
            "function"
        ) {
            originalClockPause =
                clock.pause.bind(
                    clock
                );

            originalClockPause();
        }

        /*
         * 다른 코드가 ArsGameClock.start()를 호출해도
         * 별도의 시계가 중복 실행되지 않게 한다.
         */
        clock.start =
        function () {
            return resume();
        };

        clock.pause =
        function () {
            return pause();
        };

        clock.toggle =
        function () {
            return togglePause();
        };
    }

    function advanceGameClock(
        realDeltaSeconds
    ) {
        if (
            state.scale <= 0 ||
            !window.ArsGameClock ||
            typeof window
                .ArsGameClock
                .advanceMinutes !==
                "function"
        ) {
            return;
        }

        const gameMinutesPerRealSecond =
            getClockMinutesPerRealSecond();

        state.clockAccumulator +=
            realDeltaSeconds *
            state.scale *
            gameMinutesPerRealSecond;

        const wholeMinutes =
            Math.floor(
                state.clockAccumulator
            );

        if (
            wholeMinutes <= 0
        ) {
            return;
        }

        state.clockAccumulator -=
            wholeMinutes;

        window
            .ArsGameClock
            .advanceMinutes(
                wholeMinutes
            );
    }

    // ========================================================
    // 배속 및 모드 변경
    // ========================================================

    function applyScale(
        scale,
        options
    ) {
        const settings =
            options || {};

        const fallback =
            state.scale;

        const nextScale =
            normalizeScale(
                state.mode,
                scale,
                fallback
            );

        if (
            nextScale === fallback &&
            Number(scale) !== fallback
        ) {
            console.warn(
                "[Ars Bellum] 현재 모드에서 사용할 수 없는 배속:",
                scale,
                "허용:",
                getAllowedScales(
                    state.mode
                )
            );

            return getState();
        }

        state.scale =
            nextScale;

        if (
            nextScale > 0
        ) {
            if (
                state.mode ===
                "world"
            ) {
                state.worldScale =
                    nextScale;

                state
                    .previousNonZeroScale
                    .world =
                    nextScale;
            }

            if (
                state.mode ===
                "battle"
            ) {
                state.battleScale =
                    nextScale;

                state
                    .previousNonZeroScale
                    .battle =
                    nextScale;
            }
        }

        syncGameManager();
        syncGameState();

        if (
            settings.save !== false
        ) {
            savePreferences();
        }

        if (
            settings.emit !== false
        ) {
            emit(
                "scaleChanged",
                {
                    scale:
                        state.scale
                }
            );
        }

        return getState();
    }

    function setScale(scale) {
        return applyScale(
            scale
        );
    }

    function setMode(
        mode,
        options
    ) {
        const settings =
            options || {};

        const nextMode =
            normalizeMode(
                mode
            );

        const previousMode =
            state.mode;

        if (
            state.scale > 0 &&
            (
                previousMode === "world" ||
                previousMode === "battle"
            )
        ) {
            state
                .previousNonZeroScale[
                    previousMode
                ] =
                state.scale;
        }

        state.mode =
            nextMode;

        let nextScale = 0;

        if (
            nextMode ===
            "world"
        ) {
            nextScale =
                settings.paused
                    ? 0
                    : normalizeScale(
                        "world",
                        settings.scale,
                        state
                            .previousNonZeroScale
                            .world
                    );
        }

        if (
            nextMode ===
            "battle"
        ) {
            nextScale =
                settings.paused
                    ? 0
                    : normalizeScale(
                        "battle",
                        settings.scale,
                        state
                            .previousNonZeroScale
                            .battle
                    );
        }

        if (
            nextMode ===
            "menu"
        ) {
            nextScale = 0;
        }

        applyScale(
            nextScale,
            {
                emit: false
            }
        );

        emit(
            "modeChanged",
            {
                previousMode:
                    previousMode,

                mode:
                    state.mode,

                scale:
                    state.scale
            }
        );

        return getState();
    }

    function enterWorld(scale) {
        return setMode(
            "world",
            {
                scale:
                    scale
            }
        );
    }

    function enterBattle(scale) {
        return setMode(
            "battle",
            {
                scale:
                    scale
            }
        );
    }

    function enterBattlePreparation() {
        return setMode(
            "battle",
            {
                paused: true
            }
        );
    }

    function enterMenu() {
        return setMode(
            "menu"
        );
    }

    function pause() {
        return applyScale(
            0
        );
    }

    function resume() {
        if (
            state.mode ===
            "menu"
        ) {
            return getState();
        }

        const resumeScale =
            state
                .previousNonZeroScale[
                    state.mode
                ] ||
            1;

        return applyScale(
            resumeScale
        );
    }

    function togglePause() {
        return state.scale === 0
            ? resume()
            : pause();
    }

    // ========================================================
    // 다른 시스템에서 사용하는 델타타임
    // ========================================================

    function getDeltaSeconds(
        realDeltaSeconds
    ) {
        const realDelta =
            Math.max(
                0,
                finiteNumber(
                    realDeltaSeconds,
                    0
                )
            );

        return (
            realDelta *
            state.scale
        );
    }

    function getDeltaMilliseconds(
        realDeltaMilliseconds
    ) {
        const realDelta =
            Math.max(
                0,
                finiteNumber(
                    realDeltaMilliseconds,
                    0
                )
            );

        return (
            realDelta *
            state.scale
        );
    }

    // ========================================================
    // 기존 화면 전환 함수 자동 연결
    // ========================================================

    function wrapWindowFunction(
        functionName,
        before,
        after
    ) {
        const original =
            window[functionName];

        if (
            typeof original !==
            "function"
        ) {
            return false;
        }

        if (
            original
                .__arsSimulationWrapped
        ) {
            return true;
        }

        const wrapped =
        function () {
            const args =
                Array.from(
                    arguments
                );

            if (
                typeof before ===
                "function"
            ) {
                before.apply(
                    this,
                    args
                );
            }

            const result =
                original.apply(
                    this,
                    args
                );

            if (
                typeof after ===
                "function"
            ) {
                after.apply(
                    this,
                    args
                );
            }

            return result;
        };

        wrapped
            .__arsSimulationWrapped =
            true;

        wrapped
            .__arsSimulationOriginal =
            original;

        window[functionName] =
            wrapped;

        return true;
    }

    function installScreenHooks() {
        /*
         * 월드맵 진입:
         * 마지막으로 사용한 월드 배속 복원
         */
        wrapWindowFunction(
            "startWorldMapMode",
            function () {
                enterWorld();
            }
        );

        /*
         * 월드맵 종료:
         * 메인 메뉴에서는 시간 정지
         */
        wrapWindowFunction(
            "exitWorldMap",
            null,
            function () {
                enterMenu();
            }
        );

        /*
         * 전투 화면 진입:
         * 배치 단계이므로 일시정지
         */
        wrapWindowFunction(
            "startPracticeMode",
            function () {
                enterBattlePreparation();
            }
        );

        wrapWindowFunction(
            "startMainGameMode",
            function () {
                enterBattlePreparation();
            }
        );

        /*
         * 전투 시작 버튼:
         * 마지막 전투 배속으로 진행
         */
        wrapWindowFunction(
            "startBattle",
            function () {
                enterBattle();
            }
        );

        /*
         * 메인 메뉴 복귀:
         * 전체 시뮬레이션 정지
         */
        wrapWindowFunction(
            "returnToMainMenu",
            null,
            function () {
                enterMenu();
            }
        );
    }

    // ========================================================
    // 시계 프레임
    // ========================================================

    function frame(now) {
        if (
            !state.lastFrameTime
        ) {
            state.lastFrameTime =
                now;
        }

        const realDeltaSeconds =
            Math.min(
                0.5,
                Math.max(
                    0,
                    (
                        now -
                        state.lastFrameTime
                    ) /
                    1000
                )
            );

        state.lastFrameTime =
            now;

        advanceGameClock(
            realDeltaSeconds
        );

        requestAnimationFrame(
            frame
        );
    }

    function resetFrameTimer() {
        state.lastFrameTime =
            performance.now();
    }

    // ========================================================
    // 디버그
    // ========================================================

    function debugPrint() {
        const current =
            getState();

        console.table({
            mode:
                current.mode,

            scale:
                current.scale,

            paused:
                current.paused,

            worldScale:
                current.worldScale,

            battleScale:
                current.battleScale,

            allowedScales:
                current
                    .allowedScales
                    .join(", "),

            clock:
                current.clockLabel
        });

        return current;
    }

    // ========================================================
    // 외부 공개 API
    // ========================================================

    const api = {
        version: 1,

        getState:
            getState,

        getMode:
            function () {
                return state.mode;
            },

        getScale:
            function () {
                return state.scale;
            },

        getAllowedScales:
            getAllowedScales,

        isPaused:
            function () {
                return state.scale === 0;
            },

        setMode:
            setMode,

        setScale:
            setScale,

        enterWorld:
            enterWorld,

        enterBattle:
            enterBattle,

        enterBattlePreparation:
            enterBattlePreparation,

        enterMenu:
            enterMenu,

        pause:
            pause,

        resume:
            resume,

        togglePause:
            togglePause,

        getDeltaSeconds:
            getDeltaSeconds,

        getDeltaMilliseconds:
            getDeltaMilliseconds,

        subscribe:
            subscribe,

        capturePreferences: capturePreferences,
        validatePreferences: validatePreferences,
        applyPreferences: applyPreferences,

        debugPrint:
            debugPrint
    };

    window.ArsSimulationTime =
        api;

    // ========================================================
    // 초기화
    // ========================================================

    loadPreferences();

    installGameClockBridge();
    installGameManagerBridge();

    syncGameState();
    syncGameManager();

    requestAnimationFrame(
        frame
    );

    /*
     * main.js까지 모두 실행된 다음
     * 화면 진입 함수를 자동으로 감싼다.
     */
    window.addEventListener(
        "load",
        function () {
            installScreenHooks();
            resetFrameTimer();
        }
    );

    /*
     * 일부 모바일 미리보기에서는 load 처리 시점이 다를 수 있어
     * 한 번 더 연결을 시도한다.
     */
    setTimeout(
        installScreenHooks,
        0
    );

    document.addEventListener(
        "visibilitychange",
        resetFrameTimer
    );

    console.log(
        "[Ars Bellum] SimulationTimeController 연결 완료 -",
        "현재 모드:",
        state.mode,
        "배속:",
        state.scale
    );
})();