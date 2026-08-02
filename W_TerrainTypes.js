// ============================================================
// Ars Bellum - W_TerrainTypes.js
// 월드맵 전용 지형 규격
// 기존 TerrainTypes.js(전술 전투용)는 수정하지 않는다.
// ============================================================

(function () {
    "use strict";

    const baseTypes = {
        plain: {
            id: "plain",
            name: "평원",
            passable: true,
            speedMult: 1.00,
            foodMult: 1.00,
            visibilityMult: 1.00,
            ambushRisk: 0.05,
            canCamp: true,
            battleTags: ["plain"]
        },

        forest: {
            id: "forest",
            name: "숲",
            passable: true,
            speedMult: 0.65,
            foodMult: 1.15,
            visibilityMult: 0.60,
            ambushRisk: 0.35,
            canCamp: true,
            battleTags: ["forest", "dense_cover"]
        },

        hill: {
            id: "hill",
            name: "구릉",
            passable: true,
            speedMult: 0.80,
            foodMult: 1.10,
            visibilityMult: 1.20,
            ambushRisk: 0.15,
            canCamp: true,
            battleTags: ["hill", "elevation"]
        },

        highland: {
            id: "highland",
            name: "고원",
            passable: true,
            speedMult: 0.70,
            foodMult: 1.20,
            visibilityMult: 1.30,
            ambushRisk: 0.12,
            canCamp: true,
            battleTags: ["highland", "rocky", "elevation"]
        },

        mountain: {
            id: "mountain",
            name: "산맥",
            passable: false,
            speedMult: 0.00,
            foodMult: 1.70,
            visibilityMult: 1.40,
            ambushRisk: 0.20,
            canCamp: false,
            battleTags: ["mountain", "cliff", "rocky"]
        },

        snow: {
            id: "snow",
            name: "설원",
            passable: true,
            speedMult: 0.60,
            foodMult: 1.45,
            visibilityMult: 1.10,
            ambushRisk: 0.10,
            canCamp: true,
            battleTags: ["snow", "cold"]
        },

        desert: {
            id: "desert",
            name: "사막",
            passable: true,
            speedMult: 0.72,
            foodMult: 1.65,
            visibilityMult: 1.35,
            ambushRisk: 0.08,
            canCamp: true,
            battleTags: ["desert", "open_ground", "heat"]
        },

        marsh: {
            id: "marsh",
            name: "습지",
            passable: true,
            speedMult: 0.45,
            foodMult: 1.30,
            visibilityMult: 0.70,
            ambushRisk: 0.30,
            canCamp: false,
            battleTags: ["marsh", "mud", "shallow_water"]
        },

        river: {
            id: "river",
            name: "강",
            passable: false,
            speedMult: 0.00,
            foodMult: 1.20,
            visibilityMult: 1.00,
            ambushRisk: 0.12,
            canCamp: false,
            battleTags: ["river", "water_crossing"]
        },

        sea: {
            id: "sea",
            name: "바다",
            passable: false,
            speedMult: 0.00,
            foodMult: 1.00,
            visibilityMult: 1.50,
            ambushRisk: 0.00,
            canCamp: false,
            battleTags: ["sea"]
        }
    };

    // 길은 기본 지형을 지우지 않고 그 위에 추가된다.
    const routeTypes = {
        road: {
            id: "road",
            name: "도로",

            allowedBaseIds: [
                "plain",
                "forest",
                "hill",
                "highland",
                "snow",
                "desert",
                "marsh"
            ],

            passableOverride: null,

            speedMult: 1.28,
            foodMult: 0.88,
            visibilityMult: 1.10,
            ambushRiskAdd: -0.05,

            battleTags: ["road"]
        },

        mountain_pass: {
            id: "mountain_pass",
            name: "산길",

            allowedBaseIds: [
                "hill",
                "highland",
                "mountain",
                "snow"
            ],

            passableOverride: true,

            speedMult: 0.72,
            foodMult: 1.20,
            visibilityMult: 0.90,
            ambushRiskAdd: 0.12,

            battleTags: [
                "mountain_pass",
                "narrow_route"
            ]
        },

        bridge: {
            id: "bridge",
            name: "다리",

            allowedBaseIds: [
                "river",
                "marsh"
            ],

            passableOverride: true,

            speedMult: 0.95,
            foodMult: 1.00,
            visibilityMult: 1.00,
            ambushRiskAdd: 0.08,

            battleTags: [
                "bridge",
                "chokepoint"
            ]
        }
    };

    const featureTypes = {
        oasis: {
            id: "oasis",
            name: "오아시스",

            allowedBaseIds: [
                "desert"
            ],

            speedMult: 1.00,
            foodMult: 0.65,
            visibilityMult: 1.00,
            ambushRiskAdd: -0.03,

            canCampOverride: true,
            restBonus: 1.50,

            battleTags: [
                "oasis",
                "water_source",
                "vegetation"
            ]
        }
    };

    function getBaseType(id) {
        return baseTypes[id] || null;
    }

    function getRouteType(id) {
        return id
            ? routeTypes[id] || null
            : null;
    }

    function getFeatureType(id) {
        return featureTypes[id] || null;
    }

    function isAllowed(definition, baseId) {
        return Boolean(
            definition &&
            Array.isArray(definition.allowedBaseIds) &&
            definition.allowedBaseIds.includes(baseId)
        );
    }

    function createCell(baseId, routeId, featureIds) {
        return {
            baseId: getBaseType(baseId)
                ? baseId
                : "plain",

            routeId: getRouteType(routeId)
                ? routeId
                : null,

            featureIds: Array.isArray(featureIds)
                ? featureIds.filter(function (id) {
                    return Boolean(getFeatureType(id));
                })
                : []
        };
    }

    function getTravelProfile(
        cellOrBaseId,
        routeId,
        featureIds
    ) {
        const cell =
            typeof cellOrBaseId === "string"
                ? createCell(
                    cellOrBaseId,
                    routeId,
                    featureIds
                )
                : createCell(
                    cellOrBaseId &&
                    cellOrBaseId.baseId,

                    cellOrBaseId &&
                    cellOrBaseId.routeId,

                    cellOrBaseId &&
                    cellOrBaseId.featureIds
                );

        const base =
            getBaseType(cell.baseId) ||
            baseTypes.plain;

        const route =
            getRouteType(cell.routeId);

        const result = {
            baseId: base.id,
            baseName: base.name,

            routeId: null,
            routeName: null,

            featureIds: [],
            featureNames: [],

            passable: base.passable,
            speedMult: base.speedMult,
            foodMult: base.foodMult,
            visibilityMult: base.visibilityMult,
            ambushRisk: base.ambushRisk,

            canCamp: base.canCamp,
            restBonus: 1.00,

            battleTags:
                base.battleTags.slice(),

            warnings: []
        };

        if (route) {
            if (isAllowed(route, base.id)) {
                result.routeId =
                    route.id;

                result.routeName =
                    route.name;

                const wasPassable =
                    result.passable;

                if (
                    route.passableOverride !==
                    null
                ) {
                    result.passable =
                        route.passableOverride;
                }

                /*
                 * 산맥과 강은 기본 speedMult가 0이다.
                 *
                 * 산길이나 다리로 통행 가능 상태가 됐을 때는
                 * 속도 계산 기준을 1로 복구한 뒤
                 * 산길·다리 배율을 적용해야 한다.
                 */
                if (
                    wasPassable === false &&
                    result.passable === true &&
                    result.speedMult <= 0
                ) {
                    result.speedMult = 1;
                }

                result.speedMult *=
                    route.speedMult;

                result.foodMult *=
                    route.foodMult;

                result.visibilityMult *=
                    route.visibilityMult;

                result.ambushRisk +=
                    route.ambushRiskAdd;

                result.battleTags.push.apply(
                    result.battleTags,
                    route.battleTags
                );
            } else {
                result.warnings.push(
                    route.name +
                    "은(는) " +
                    base.name +
                    "에 놓을 수 없습니다."
                );
            }
        }

        cell.featureIds.forEach(
            function (featureId) {
                const feature =
                    getFeatureType(featureId);

                if (
                    !feature ||
                    !isAllowed(feature, base.id)
                ) {
                    if (feature) {
                        result.warnings.push(
                            feature.name +
                            "은(는) " +
                            base.name +
                            "에 놓을 수 없습니다."
                        );
                    }

                    return;
                }

                result.featureIds.push(
                    feature.id
                );

                result.featureNames.push(
                    feature.name
                );

                result.speedMult *=
                    feature.speedMult;

                result.foodMult *=
                    feature.foodMult;

                result.visibilityMult *=
                    feature.visibilityMult;

                result.ambushRisk +=
                    feature.ambushRiskAdd;

                if (
                    typeof feature.canCampOverride ===
                    "boolean"
                ) {
                    result.canCamp =
                        feature.canCampOverride;
                }

                result.restBonus *=
                    feature.restBonus;

                result.battleTags.push.apply(
                    result.battleTags,
                    feature.battleTags
                );
            }
        );

        result.ambushRisk = Math.max(
            0,
            Math.min(
                1,
                result.ambushRisk
            )
        );

        result.battleTags =
            Array.from(
                new Set(
                    result.battleTags
                )
            );

        if (!result.passable) {
            result.speedMult = 0;
        }

        return result;
    }

    function getPartySpeed(
        baseSpeed,
        cellOrBaseId,
        routeId,
        featureIds
    ) {
        const speed =
            Number(baseSpeed);

        if (
            !Number.isFinite(speed) ||
            speed < 0
        ) {
            return 0;
        }

        const profile =
            getTravelProfile(
                cellOrBaseId,
                routeId,
                featureIds
            );

        return profile.passable
            ? speed * profile.speedMult
            : 0;
    }

    function getFoodCost(
        baseCost,
        cellOrBaseId,
        routeId,
        featureIds
    ) {
        const cost =
            Number(baseCost);

        if (
            !Number.isFinite(cost) ||
            cost < 0
        ) {
            return 0;
        }

        return (
            cost *
            getTravelProfile(
                cellOrBaseId,
                routeId,
                featureIds
            ).foodMult
        );
    }

    function validate() {
        const errors = [];

        Object.keys(baseTypes).forEach(
            function (key) {
                const item =
                    baseTypes[key];

                if (item.id !== key) {
                    errors.push(
                        "기본 지형 키와 id 불일치: " +
                        key
                    );
                }
            }
        );

        [
            routeTypes,
            featureTypes
        ].forEach(function (group) {
            Object.keys(group).forEach(
                function (key) {
                    const item =
                        group[key];

                    if (item.id !== key) {
                        errors.push(
                            "키와 id 불일치: " +
                            key
                        );
                    }

                    item.allowedBaseIds.forEach(
                        function (baseId) {
                            if (
                                !getBaseType(baseId)
                            ) {
                                errors.push(
                                    item.name +
                                    "이(가) 없는 지형을 참조함: " +
                                    baseId
                                );
                            }
                        }
                    );
                }
            );
        });

        return errors;
    }

    window.ArsWorldTerrainTypes = {
        version: 2,

        baseTypes: baseTypes,
        routeTypes: routeTypes,
        featureTypes: featureTypes,

        getBaseType: getBaseType,
        getRouteType: getRouteType,
        getFeatureType: getFeatureType,

        createCell: createCell,
        getTravelProfile:
            getTravelProfile,

        getPartySpeed:
            getPartySpeed,

        getFoodCost:
            getFoodCost,

        validate: validate
    };

    const errors =
        validate();

    if (errors.length > 0) {
        console.error(
            "[Ars Bellum] WorldTerrainTypes 검사 실패:",
            errors
        );
    } else {
        console.log(
            "[Ars Bellum] WorldTerrainTypes 연결 완료 - " +
            "기본 지형 10개, 길 3개, 특징 1개"
        );
    }
})();