// ============================================================
// Ars Bellum - S_LaborTypes.js
// 거점 경제 전반에서 사용하는 직업 ID의 유일한 정적 정의 파일.
// 상태 저장, 일일 처리, GameClock 구독, DOM 조작을 수행하지 않는다.
// ============================================================
(function () {
    "use strict";

    const VERSION = 1;

    const IDS = Object.freeze([
        "peasants",
        "laborers",
        "artisans",
        "merchants",
        "administrators",
        "guards",
        "soldiers",
        "clergy",
        "nobles"
    ]);

    const NAMES = Object.freeze({
        peasants: "농민",
        laborers: "노동자",
        artisans: "장인",
        merchants: "상인",
        administrators: "행정관",
        guards: "경비 인력",
        soldiers: "직업 군인",
        clergy: "성직자",
        nobles: "귀족"
    });

    const ID_SET = new Set(IDS);

    function cleanId(value) {
        return typeof value === "string"
            ? value.trim()
            : "";
    }

    function normalizeAmount(value) {
        const amount = Number(value);

        if (!Number.isFinite(amount) || amount <= 0) {
            return 0;
        }

        return amount;
    }

    function isKnown(id) {
        return ID_SET.has(cleanId(id));
    }

    function makeEmptyMap() {
        const result = {};

        IDS.forEach(function (id) {
            result[id] = 0;
        });

        return result;
    }

    function normalizeMap(source) {
        const result = makeEmptyMap();

        if (
            !source ||
            typeof source !== "object" ||
            Array.isArray(source)
        ) {
            return result;
        }

        IDS.forEach(function (id) {
            result[id] = normalizeAmount(source[id]);
        });

        return result;
    }

    window.ArsSettlementLaborTypes = Object.freeze({
        version: VERSION,
        ids: IDS,
        names: NAMES,
        isKnown: isKnown,
        normalizeMap: normalizeMap,
        makeEmptyMap: makeEmptyMap
    });

    console.log(
        "[Ars Bellum] SettlementLaborTypes 연결 완료 - 직업 " +
        IDS.length +
        "종"
    );
})();