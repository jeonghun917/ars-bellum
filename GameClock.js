// Ars Bellum - GameClock.js
// Runtime clock. Unified persistence is owned by ArsSaveService.
(function () {
    "use strict";
    const ALLOWED_SPEEDS = [0, 1, 2, 4, 8];
    const clock = { day: 1, hour: 8, minute: 0, speed: 1, running: false, realMsPerGameMinute: 1000 };
    const listeners = new Set();
    let lastRealTime = 0;
    let accumulatedRealMs = 0;

    function integer(value, minimum, maximum, fallback) {
        const number = Math.floor(Number(value));
        return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
    }
    function normalizeSpeed(value) { const speed = Number(value); return ALLOWED_SPEEDS.includes(speed) ? speed : 1; }
    function getLabel() { return clock.day + "일 " + String(clock.hour).padStart(2, "0") + ":" + String(clock.minute).padStart(2, "0"); }
    function getState() {
        return { day: clock.day, hour: clock.hour, minute: clock.minute, speed: clock.speed, running: clock.running, realMsPerGameMinute: clock.realMsPerGameMinute, totalMinutes: (clock.day - 1) * 1440 + clock.hour * 60 + clock.minute, label: getLabel() };
    }
    function capturePersistent() { return { version: 1, day: clock.day, hour: clock.hour, minute: clock.minute, speed: clock.speed, realMsPerGameMinute: clock.realMsPerGameMinute }; }
    function validatePersistent(snapshot) {
        const x = snapshot || {}, errors = [];
        const allowedKeys = ["version", "day", "hour", "minute", "speed", "realMsPerGameMinute"];
        if (!x || typeof x !== "object" || Array.isArray(x)) { errors.push("not_plain_object"); }
        else {
            Object.keys(x).sort().forEach(function (key) {
                if (allowedKeys.indexOf(key) < 0) { errors.push("unexpected_persistent_field:" + key); }
            });
        }
        if (x.version !== 1) { errors.push(x.version > 1 ? "future_version" : "invalid_version"); }
        if (!Number.isInteger(x.day) || x.day < 1 || x.day > 999999) { errors.push("invalid_day"); }
        if (!Number.isInteger(x.hour) || x.hour < 0 || x.hour > 23) { errors.push("invalid_hour"); }
        if (!Number.isInteger(x.minute) || x.minute < 0 || x.minute > 59) { errors.push("invalid_minute"); }
        if (!ALLOWED_SPEEDS.includes(x.speed)) { errors.push("invalid_speed"); }
        if (!Number.isFinite(x.realMsPerGameMinute) || x.realMsPerGameMinute < 50) { errors.push("invalid_real_ms"); }
        const uniqueErrors = Array.from(new Set(errors)).sort();
        return uniqueErrors.length ? { ok: false, error: "m18_save_invalid_game_clock", errors: uniqueErrors } : { ok: true, snapshot: { version: 1, day: x.day, hour: x.hour, minute: x.minute, speed: x.speed, realMsPerGameMinute: x.realMsPerGameMinute } };
    }
    function hydratePersistent(snapshot) {
        const validation = validatePersistent(snapshot); if (!validation.ok) { return validation; }
        const persistent = validation.snapshot;
        clock.day = persistent.day; clock.hour = persistent.hour; clock.minute = persistent.minute; clock.speed = persistent.speed; clock.realMsPerGameMinute = persistent.realMsPerGameMinute;
        clock.running = false; accumulatedRealMs = 0; lastRealTime = performance.now();
        attachToGameState();
        return { ok: true, gameClock: capturePersistent() };
    }
    function emit(type, extra) {
        const event = Object.assign({ type: type, clock: getState() }, extra || {});
        listeners.forEach(function (listener) { try { listener(event); } catch (error) { console.error("[Ars Bellum] GameClock 이벤트 오류:", error); } });
    }
    function save() {
        if (!window.ArsSaveService) { return { ok: false, error: "m18_save_service_unavailable" }; }
        return window.ArsSaveService.save(window.ArsSaveService.getCurrentRevision());
    }
    function load() {
        if (!window.ArsSaveService) { return { ok: false, error: "m18_save_service_unavailable" }; }
        return window.ArsSaveService.load();
    }
    function attachToGameState() {
        if (!window.ArsGameState || typeof window.ArsGameState.getState !== "function") { return; }
        const root = window.ArsGameState.getState();
        if (!root.world || typeof root.world !== "object") { root.world = {}; }
        root.world.clock = clock;
    }
    function advanceMinutes(amount) {
        const minutes = Math.floor(Number(amount));
        if (!Number.isFinite(minutes) || minutes === 0) { return getState(); }
        const previousDay = clock.day, previousHour = clock.hour;
        let totalMinutes = Math.max(0, (clock.day - 1) * 1440 + clock.hour * 60 + clock.minute + minutes);
        clock.day = Math.floor(totalMinutes / 1440) + 1;
        const minuteOfDay = totalMinutes % 1440;
        clock.hour = Math.floor(minuteOfDay / 60); clock.minute = minuteOfDay % 60;
        emit("minute", { amount: minutes });
        if (clock.hour !== previousHour || clock.day !== previousDay) { emit("hour"); }
        if (clock.day !== previousDay) { emit("day", { previousDay: previousDay, currentDay: clock.day }); }
        return getState();
    }
    function setSpeed(value) { clock.speed = normalizeSpeed(value); emit("speed"); return clock.speed; }
    function start() { clock.running = true; lastRealTime = performance.now(); emit("start"); return getState(); }
    function pause() { clock.running = false; accumulatedRealMs = 0; emit("pause"); return getState(); }
    function reset() { clock.day = 1; clock.hour = 8; clock.minute = 0; clock.speed = 1; clock.running = false; accumulatedRealMs = 0; emit("reset"); return getState(); }
    function subscribe(listener) { if (typeof listener !== "function") { return function () {}; } listeners.add(listener); return function () { listeners.delete(listener); }; }
    function configure(options) {
        const settings = options || {}, realMs = Number(settings.realMsPerGameMinute);
        if (Number.isFinite(realMs) && realMs >= 50) { clock.realMsPerGameMinute = realMs; }
        if (settings.speed !== undefined) { setSpeed(settings.speed); }
        return getState();
    }
    function frame(now) {
        if (!lastRealTime) { lastRealTime = now; }
        const delta = Math.min(1000, Math.max(0, now - lastRealTime)); lastRealTime = now;
        if (clock.running && clock.speed > 0) {
            accumulatedRealMs += delta * clock.speed;
            const minuteDuration = Math.max(50, clock.realMsPerGameMinute), elapsedMinutes = Math.floor(accumulatedRealMs / minuteDuration);
            if (elapsedMinutes > 0) { accumulatedRealMs -= elapsedMinutes * minuteDuration; advanceMinutes(elapsedMinutes); }
        }
        requestAnimationFrame(frame);
    }

    window.ArsGameClock = { version: 1, start: start, pause: pause, toggle: function () { return clock.running ? pause() : start(); }, setSpeed: setSpeed, advanceMinutes: advanceMinutes, getState: getState, getLabel: getLabel, subscribe: subscribe, configure: configure, save: save, load: load, reset: reset, capturePersistent: capturePersistent, validatePersistent: validatePersistent, hydratePersistent: hydratePersistent };
    attachToGameState();
    requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", function () { lastRealTime = performance.now(); });
    console.log("[Ars Bellum] GameClock 연결 완료 -", getLabel(), "(초기 정지)");
})();
