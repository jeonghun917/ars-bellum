// ============================================================
// Ars Bellum - S_Buildings.js
// 건물 정적 정의, 건설 비용·기간·작업량 계산 전용 파일.
// 직업 ID는 S_LaborTypes.js만 사용한다.
// 거점 상태, 건설 상태, 인구 상태는 저장하지 않는다.
// 선행: ResourceCatalog.js, S_LaborTypes.js
// ============================================================
(function () {
    "use strict";

    const VERSION = 3;

    const DEFAULT_SETTLEMENT_TYPES = Object.freeze([
        "village",
        "town",
        "city",
        "castle",
        "fort",
        "port"
    ]);

    const BUILDING_KINDS = Object.freeze({
        production: "production",
        development: "development"
    });

    const CATEGORIES = Object.freeze({
        residential: {
            id: "residential",
            name: "주거"
        },
        agriculture: {
            id: "agriculture",
            name: "농업·목축"
        },
        extraction: {
            id: "extraction",
            name: "채취"
        },
        processing: {
            id: "processing",
            name: "가공"
        },
        commerce: {
            id: "commerce",
            name: "상업"
        },
        military: {
            id: "military",
            name: "군사"
        },
        infrastructure: {
            id: "infrastructure",
            name: "기반시설"
        },
        storage: {
            id: "storage",
            name: "저장"
        },
        administration: {
            id: "administration",
            name: "행정"
        }
    });

    const EFFECT_KEYS = Object.freeze([
        "housingCapacity",
        "farmland",
        "workshopCapacity",
        "marketCapacity",
        "defense",
        "roadQuality",
        "sanitation",
        "storageCapacity",
        "administration",
        "productionCapacity",
        "garrisonCapacity",
        "spoilageReduction"
    ]);

    const RAW_BUILDINGS = [
        {"i":"housing_district","n":"주거 지구","c":"residential","k":"development","d":"민가와 공동 주거지를 확장해 인구 수용량을 늘린다.","l":10,"days":20,"tm":1.22,"work":240,"wm":1.25,"gold":180,"res":{"timber":24,"planks":12,"clay":10},"cm":1.28,"maint":2,"effects":{"housingCapacity":1200},"jobs":{"laborers":2},"tags":["housing","population"]},
        {"i":"farmland_expansion","n":"농경지 개간","c":"agriculture","k":"development","d":"경작 가능한 토지를 늘려 농업 시설의 기반을 확장한다.","l":10,"days":16,"tm":1.18,"work":210,"wm":1.22,"gold":120,"res":{"timber":16},"cm":1.24,"maint":1,"effects":{"farmland":30},"pref":["rural","farmland","plain","river"],"tags":["farmland","agriculture"]},
        {"i":"workshop_district","n":"작업장 지구","c":"infrastructure","k":"development","d":"가공업 건물이 사용할 작업 공간과 공용 설비를 확충한다.","l":10,"days":24,"tm":1.24,"work":300,"wm":1.27,"gold":240,"res":{"timber":18,"planks":20,"clay":12},"cm":1.3,"maint":4,"effects":{"workshopCapacity":30},"jobs":{"artisans":3,"laborers":2},"tags":["workshop","industry"]},
        {"i":"market_square","n":"시장 광장","c":"commerce","k":"development","d":"상설 거래 공간을 마련해 거래량과 상인 수용 능력을 높인다.","l":10,"days":22,"tm":1.23,"work":270,"wm":1.25,"gold":260,"res":{"timber":14,"planks":18,"pottery":4},"cm":1.31,"maint":5,"effects":{"marketCapacity":25},"jobs":{"merchants":12,"laborers":4},"tags":["market","trade"]},
        {"i":"fortifications","n":"방어 시설","c":"military","k":"development","d":"목책·성벽·망루를 단계적으로 확장해 거점 방어력을 높인다.","l":10,"days":36,"tm":1.28,"work":460,"wm":1.3,"gold":420,"res":{"timber":32,"planks":24,"clay":24,"iron_ingot":3},"cm":1.35,"maint":10,"effects":{"defense":100,"garrisonCapacity":80},"jobs":{"soldiers":12,"laborers":3},"tags":["walls","defense","garrison"]},
        {"i":"road_network","n":"거점 도로망","c":"infrastructure","k":"development","d":"거점 내부 도로와 진입로를 정비해 운송과 시장 접근성을 높인다.","l":10,"days":18,"tm":1.2,"work":250,"wm":1.23,"gold":170,"res":{"timber":12,"planks":8,"clay":18},"cm":1.27,"maint":4,"effects":{"roadQuality":12},"jobs":{"laborers":6},"tags":["roads","transport"]},
        {"i":"sanitation_works","n":"위생 시설","c":"infrastructure","k":"development","d":"우물·배수로·폐기물 처리 시설을 정비해 질병 위험을 낮춘다.","l":10,"days":21,"tm":1.22,"work":270,"wm":1.24,"gold":210,"res":{"timber":10,"planks":8,"clay":22,"pottery":5},"cm":1.29,"maint":5,"effects":{"sanitation":12},"jobs":{"laborers":5},"tags":["sanitation","health"]},
        {"i":"warehouse","n":"공공 창고","c":"storage","k":"development","d":"보관 공간을 늘리고 비·해충·도난으로 인한 재고 손실을 줄인다.","l":10,"days":20,"tm":1.22,"work":260,"wm":1.24,"gold":200,"res":{"timber":20,"planks":18,"clay":8},"cm":1.28,"maint":4,"effects":{"storageCapacity":1000,"spoilageReduction":0.015},"jobs":{"laborers":10,"merchants":2},"tags":["storage","inventory"]},
        {"i":"administrative_office","n":"행정 관청","c":"administration","k":"development","d":"장부·세금·허가 업무를 담당해 거점 행정 능력을 높인다.","l":10,"days":28,"tm":1.25,"work":340,"wm":1.27,"gold":340,"res":{"timber":14,"planks":24,"pottery":6},"cm":1.33,"maint":8,"effects":{"administration":15},"jobs":{"administrators":8,"nobles":1},"tags":["administration","tax"]},
        {"i":"farm","n":"곡물 농장","c":"agriculture","k":"production","d":"곡물을 생산하는 기본 농업 시설.","l":5,"days":12,"tm":1.24,"work":150,"wm":1.25,"gold":60,"res":{"timber":12},"cm":1.3,"maint":1,"effects":{"farmland":10,"productionCapacity":1},"pref":["rural","farmland","plain","river"],"tags":["food","grain","farm"]},
        {"i":"vegetable_farm","n":"채소 농장","c":"agriculture","k":"production","d":"채소를 생산하는 집약 농업 시설.","l":5,"days":11,"tm":1.24,"work":140,"wm":1.25,"gold":55,"res":{"timber":10},"cm":1.3,"maint":1,"effects":{"farmland":8,"productionCapacity":1},"pref":["rural","farmland","river"],"tags":["food","vegetables","farm"]},
        {"i":"vineyard","n":"포도원","c":"agriculture","k":"production","d":"포도를 재배해 양조업의 원료를 공급한다.","l":5,"days":18,"tm":1.25,"work":210,"wm":1.26,"gold":80,"res":{"timber":14},"cm":1.31,"maint":2,"effects":{"farmland":8,"productionCapacity":1},"pref":["rural","farmland","hill"],"tags":["grapes","wine","farm"]},
        {"i":"fishery","n":"어장","c":"agriculture","k":"production","d":"강이나 해안에서 생선을 생산한다.","l":5,"days":14,"tm":1.24,"work":170,"wm":1.25,"gold":70,"res":{"timber":18,"planks":4},"cm":1.3,"maint":2,"effects":{"productionCapacity":1},"need":["river","coast","lake","port"],"tags":["food","fish","water"]},
        {"i":"saltworks","n":"염전","c":"extraction","k":"production","d":"해안이나 염지에서 소금을 생산한다.","l":5,"days":20,"tm":1.25,"work":230,"wm":1.26,"gold":100,"res":{"timber":16,"planks":6},"cm":1.31,"maint":2,"effects":{"productionCapacity":1},"need":["coast","salt","salt_flat","port"],"tags":["salt","extraction"]},
        {"i":"lumber_camp","n":"벌목장","c":"extraction","k":"production","d":"숲에서 목재를 생산한다.","l":5,"days":13,"tm":1.24,"work":160,"wm":1.25,"gold":75,"res":{"timber":8},"cm":1.3,"maint":2,"effects":{"productionCapacity":1},"pref":["forest","woodland","rural"],"tags":["timber","forest","extraction"]},
        {"i":"iron_mine","n":"철광산","c":"extraction","k":"production","d":"철광석을 채굴한다.","l":5,"days":30,"tm":1.28,"work":390,"wm":1.3,"gold":180,"res":{"timber":30,"planks":12},"cm":1.34,"maint":5,"effects":{"productionCapacity":1},"need":["iron","ore","mountain","mountain_pass","hill"],"tags":["iron_ore","mine","extraction"]},
        {"i":"silver_mine","n":"은광산","c":"extraction","k":"production","d":"희귀한 은광석을 채굴한다.","l":5,"days":40,"tm":1.3,"work":520,"wm":1.32,"gold":260,"res":{"timber":35,"planks":16,"iron_ingot":2},"cm":1.36,"maint":8,"effects":{"productionCapacity":1},"need":["silver","ore","mountain","mountain_pass","hill"],"tags":["silver_ore","mine","luxury"]},
        {"i":"clay_pit","n":"점토 채취장","c":"extraction","k":"production","d":"도기와 건설에 쓰이는 점토를 채취한다.","l":5,"days":10,"tm":1.23,"work":120,"wm":1.24,"gold":65,"res":{"timber":8},"cm":1.29,"maint":1,"effects":{"productionCapacity":1},"pref":["river","plain","clay"],"tags":["clay","extraction"]},
        {"i":"sheep_ranch","n":"양 목장","c":"agriculture","k":"production","d":"양을 길러 양모·고기·가죽 원료를 생산한다.","l":5,"days":18,"tm":1.25,"work":220,"wm":1.26,"gold":100,"res":{"timber":16},"cm":1.31,"maint":3,"effects":{"farmland":10,"productionCapacity":1},"pref":["rural","farmland","plain","hill"],"tags":["wool","meat","hides","ranch"]},
        {"i":"bakery","n":"제빵소","c":"processing","k":"production","d":"곡물과 소금으로 빵을 생산한다.","l":5,"days":18,"tm":1.25,"work":220,"wm":1.26,"gold":120,"res":{"timber":10,"planks":8,"clay":4},"cm":1.31,"maint":3,"effects":{"workshopCapacity":5,"productionCapacity":1},"tags":["bread","food","workshop"]},
        {"i":"winery","n":"양조장","c":"processing","k":"production","d":"포도를 가공해 포도주를 생산한다.","l":5,"days":24,"tm":1.26,"work":280,"wm":1.27,"gold":150,"res":{"timber":12,"planks":12,"clay":6},"cm":1.32,"maint":4,"effects":{"workshopCapacity":6,"productionCapacity":1},"tags":["wine","luxury","workshop"]},
        {"i":"sawmill","n":"제재소","c":"processing","k":"production","d":"목재를 판재로 가공한다.","l":5,"days":20,"tm":1.25,"work":250,"wm":1.26,"gold":130,"res":{"timber":18,"planks":4},"cm":1.31,"maint":4,"effects":{"workshopCapacity":6,"productionCapacity":1},"tags":["planks","timber","workshop"]},
        {"i":"charcoal_kiln","n":"목탄 가마","c":"processing","k":"production","d":"목재를 제련용 목탄으로 가공한다.","l":5,"days":16,"tm":1.24,"work":190,"wm":1.25,"gold":95,"res":{"timber":14,"clay":8},"cm":1.3,"maint":3,"effects":{"workshopCapacity":4,"productionCapacity":1},"tags":["charcoal","fuel","workshop"]},
        {"i":"smelter","n":"제련소","c":"processing","k":"production","d":"철광석과 목탄으로 철괴를 생산한다.","l":5,"days":32,"tm":1.28,"work":410,"wm":1.3,"gold":220,"res":{"timber":14,"planks":10,"clay":18,"iron_ingot":1},"cm":1.34,"maint":7,"effects":{"workshopCapacity":10,"productionCapacity":1},"tags":["iron_ingot","smelting","workshop"]},
        {"i":"weaver","n":"직조 공방","c":"processing","k":"production","d":"양모를 직물로 가공한다.","l":5,"days":22,"tm":1.26,"work":270,"wm":1.27,"gold":140,"res":{"timber":12,"planks":14},"cm":1.32,"maint":4,"effects":{"workshopCapacity":7,"productionCapacity":1},"tags":["cloth","wool","workshop"]},
        {"i":"tannery","n":"무두질 공방","c":"processing","k":"production","d":"생가죽과 소금으로 가죽을 생산한다.","l":5,"days":22,"tm":1.26,"work":270,"wm":1.27,"gold":140,"res":{"timber":12,"planks":8,"clay":8},"cm":1.32,"maint":4,"effects":{"workshopCapacity":7,"productionCapacity":1},"tags":["leather","hides","workshop"]},
        {"i":"pottery_kiln","n":"도기 가마","c":"processing","k":"production","d":"점토와 목탄으로 도기를 생산한다.","l":5,"days":20,"tm":1.25,"work":250,"wm":1.26,"gold":125,"res":{"timber":8,"clay":16},"cm":1.31,"maint":4,"effects":{"workshopCapacity":6,"productionCapacity":1},"tags":["pottery","clay","workshop"]},
        {"i":"weaponsmith","n":"무기 대장간","c":"processing","k":"production","d":"철괴와 목재로 무기를 생산한다.","l":5,"days":34,"tm":1.28,"work":430,"wm":1.3,"gold":260,"res":{"timber":10,"planks":12,"clay":10,"iron_ingot":3},"cm":1.35,"maint":8,"effects":{"workshopCapacity":10,"productionCapacity":1},"tags":["weapons","military","workshop"]},
        {"i":"armorsmith","n":"갑옷 대장간","c":"processing","k":"production","d":"철괴와 가죽으로 갑옷을 생산한다.","l":5,"days":38,"tm":1.29,"work":480,"wm":1.31,"gold":300,"res":{"timber":10,"planks":12,"clay":12,"iron_ingot":4},"cm":1.36,"maint":9,"effects":{"workshopCapacity":12,"productionCapacity":1},"tags":["armor","military","workshop"]},
        {"i":"fletcher","n":"화살 제작소","c":"processing","k":"production","d":"목재와 철괴로 화살을 생산한다.","l":5,"days":18,"tm":1.25,"work":220,"wm":1.26,"gold":130,"res":{"timber":18,"planks":6,"iron_ingot":1},"cm":1.31,"maint":4,"effects":{"workshopCapacity":6,"productionCapacity":1},"tags":["arrows","military","workshop"]},
        {"i":"horse_ranch","n":"군마 목장","c":"agriculture","k":"production","d":"곡물을 소비해 군마를 사육한다.","l":5,"days":36,"tm":1.28,"work":450,"wm":1.3,"gold":260,"res":{"timber":28,"planks":10},"cm":1.35,"maint":8,"effects":{"farmland":12,"productionCapacity":1},"pref":["rural","farmland","plain"],"tags":["horses","military","ranch"]},
        {"i":"jeweler","n":"보석 세공소","c":"processing","k":"production","d":"은광석으로 장신구를 생산한다.","l":5,"days":40,"tm":1.3,"work":500,"wm":1.32,"gold":360,"res":{"timber":8,"planks":18,"pottery":4,"iron_ingot":2},"cm":1.37,"maint":12,"effects":{"workshopCapacity":10,"productionCapacity":1},"tags":["jewelry","luxury","workshop"]}
    ];

    function clone(value) {
        return value === undefined
            ? undefined
            : JSON.parse(JSON.stringify(value));
    }

    function deepFreeze(value) {
        if (
            !value ||
            typeof value !== "object" ||
            Object.isFrozen(value)
        ) {
            return value;
        }

        Object.keys(value).forEach(function (key) {
            deepFreeze(value[key]);
        });

        return Object.freeze(value);
    }

    function round(value, digits) {
        const scale = Math.pow(
            10,
            Math.max(0, Number(digits) || 0)
        );

        return Math.round(
            (Number(value) || 0) * scale
        ) / scale;
    }

    function uniqueStrings(source) {
        const result = [];
        const seen = new Set();

        (Array.isArray(source) ? source : []).forEach(
            function (value) {
                const text =
                    typeof value === "string"
                        ? value.trim()
                        : "";

                if (
                    text &&
                    !seen.has(text)
                ) {
                    seen.add(text);
                    result.push(text);
                }
            }
        );

        return result;
    }

    function numberMap(source) {
        const result = {};

        if (
            !source ||
            typeof source !== "object" ||
            Array.isArray(source)
        ) {
            return result;
        }

        Object.keys(source).forEach(function (key) {
            const amount = Number(source[key]);

            if (
                Number.isFinite(amount) &&
                amount !== 0
            ) {
                result[key] = amount;
            }
        });

        return result;
    }

    function laborTypes() {
        return window.ArsSettlementLaborTypes || null;
    }

    function resourceCatalog() {
        return window.ArsResourceCatalog || null;
    }

    function normalizeJobs(source) {
        const labor = laborTypes();

        if (
            !labor ||
            typeof labor.normalizeMap !== "function"
        ) {
            return {};
        }

        const normalized = labor.normalizeMap(source);
        const result = {};

        labor.ids.forEach(function (id) {
            if (normalized[id] > 0) {
                result[id] = normalized[id];
            }
        });

        return result;
    }

    function normalizeBuilding(raw) {
        return deepFreeze({
            id: String(raw.i || ""),
            name: String(raw.n || ""),
            category: String(raw.c || ""),
            kind: String(
                raw.k ||
                BUILDING_KINDS.development
            ),
            description: String(raw.d || ""),

            maxLevel: Math.max(
                1,
                Math.floor(Number(raw.l) || 1)
            ),

            baseConstructionDays: Math.max(
                1,
                Math.floor(Number(raw.days) || 1)
            ),

            constructionTimeMultiplier: Math.max(
                1,
                Number(raw.tm) || 1
            ),

            baseWorkRequired: Math.max(
                1,
                Number(raw.work) || 1
            ),

            workMultiplier: Math.max(
                1,
                Number(raw.wm) || 1
            ),

            baseCost: {
                gold: Math.max(
                    0,
                    Number(raw.gold) || 0
                ),
                resources: numberMap(raw.res)
            },

            costMultiplier: Math.max(
                1,
                Number(raw.cm) || 1
            ),

            maintenancePerLevel: {
                gold: Math.max(
                    0,
                    Number(raw.maint) || 0
                )
            },

            effectsPerLevel:
                numberMap(raw.effects),

            jobsPerLevel:
                normalizeJobs(raw.jobs),

            placement: {
                allowedSettlementTypes:
                    uniqueStrings(
                        raw.types ||
                        DEFAULT_SETTLEMENT_TYPES
                    ),

                requiredAnyTags:
                    uniqueStrings(raw.need),

                preferredTags:
                    uniqueStrings(raw.pref)
            },

            tags:
                uniqueStrings(raw.tags)
        });
    }

    const BUILDINGS = Object.freeze(
        RAW_BUILDINGS.map(normalizeBuilding)
    );

    const BUILDING_BY_ID = new Map();

    BUILDINGS.forEach(function (building) {
        BUILDING_BY_ID.set(
            building.id,
            building
        );
    });

    function getBuildingById(buildingId) {
        return (
            BUILDING_BY_ID.get(
                String(buildingId || "")
            ) ||
            null
        );
    }

    function getBuildings() {
        return BUILDINGS.slice();
    }

    function getBuildingsByCategory(categoryId) {
        const id = String(categoryId || "");

        return BUILDINGS.filter(function (building) {
            return building.category === id;
        });
    }

    function getBuildingsByKind(kind) {
        const id = String(kind || "");

        return BUILDINGS.filter(function (building) {
            return building.kind === id;
        });
    }

    function getBuildingsByTag(tag) {
        const id = String(tag || "");

        return BUILDINGS.filter(function (building) {
            return building.tags.indexOf(id) !== -1;
        });
    }

    function getRecipesForBuilding(buildingId) {
        const catalog = resourceCatalog();

        if (
            !catalog ||
            typeof catalog.getRecipesForBuilding !==
                "function"
        ) {
            return [];
        }

        return (
            catalog.getRecipesForBuilding(
                String(buildingId || "")
            ) ||
            []
        );
    }

    function normalizeLevel(
        building,
        levelValue,
        allowZero
    ) {
        const level = Math.floor(
            Number(levelValue) || 0
        );

        if (allowZero) {
            return Math.max(
                0,
                Math.min(
                    building.maxLevel,
                    level
                )
            );
        }

        return (
            level >= 1 &&
            level <= building.maxLevel
        )
            ? level
            : null;
    }

    function getConstructionCost(
        buildingId,
        targetLevelValue
    ) {
        const building =
            getBuildingById(buildingId);

        if (!building) {
            return null;
        }

        const level = normalizeLevel(
            building,
            targetLevelValue,
            false
        );

        if (level === null) {
            return null;
        }

        const multiplier = Math.pow(
            building.costMultiplier,
            level - 1
        );

        const resources = {};

        Object.keys(
            building.baseCost.resources
        ).forEach(function (resourceId) {
            resources[resourceId] = round(
                building.baseCost.resources[
                    resourceId
                ] * multiplier,
                4
            );
        });

        return {
            gold: Math.ceil(
                building.baseCost.gold *
                multiplier
            ),
            resources: resources
        };
    }

    function getConstructionDays(
        buildingId,
        targetLevelValue
    ) {
        const building =
            getBuildingById(buildingId);

        if (!building) {
            return null;
        }

        const level = normalizeLevel(
            building,
            targetLevelValue,
            false
        );

        if (level === null) {
            return null;
        }

        return Math.max(
            1,
            Math.ceil(
                building.baseConstructionDays *
                Math.pow(
                    building
                        .constructionTimeMultiplier,
                    level - 1
                )
            )
        );
    }

    function getWorkRequired(
        buildingId,
        targetLevelValue
    ) {
        const building =
            getBuildingById(buildingId);

        if (!building) {
            return null;
        }

        const level = normalizeLevel(
            building,
            targetLevelValue,
            false
        );

        if (level === null) {
            return null;
        }

        return Math.max(
            1,
            Math.ceil(
                building.baseWorkRequired *
                Math.pow(
                    building.workMultiplier,
                    level - 1
                )
            )
        );
    }

    function scaleMap(
        buildingId,
        levelValue,
        field
    ) {
        const building =
            getBuildingById(buildingId);

        if (!building) {
            return null;
        }

        const level = normalizeLevel(
            building,
            levelValue,
            true
        );

        const result = {};

        Object.keys(
            building[field]
        ).forEach(function (key) {
            result[key] = round(
                building[field][key] *
                level,
                4
            );
        });

        return result;
    }

    function getEffectsAtLevel(
        buildingId,
        levelValue
    ) {
        return scaleMap(
            buildingId,
            levelValue,
            "effectsPerLevel"
        );
    }

    function getJobsAtLevel(
        buildingId,
        levelValue
    ) {
        const building =
            getBuildingById(buildingId);

        const labor = laborTypes();

        if (
            !building ||
            !labor
        ) {
            return null;
        }

        const level = normalizeLevel(
            building,
            levelValue,
            true
        );

        const jobs = labor.makeEmptyMap();

        Object.keys(
            building.jobsPerLevel
        ).forEach(function (jobId) {
            jobs[jobId] = round(
                building.jobsPerLevel[jobId] *
                level,
                4
            );
        });

        getRecipesForBuilding(
            building.id
        ).forEach(function (recipe) {
            const jobId =
                String(
                    recipe.laborType || ""
                );

            const laborAmount = Math.max(
                0,
                Number(
                    recipe.laborPerCycle
                ) || 0
            );

            if (
                labor.isKnown(jobId) &&
                laborAmount > 0
            ) {
                jobs[jobId] = round(
                    jobs[jobId] +
                    laborAmount * level,
                    4
                );
            }
        });

        return jobs;
    }

    function getMaintenanceAtLevel(
        buildingId,
        levelValue
    ) {
        const building =
            getBuildingById(buildingId);

        if (!building) {
            return null;
        }

        const level = normalizeLevel(
            building,
            levelValue,
            true
        );

        return {
            gold: round(
                building
                    .maintenancePerLevel
                    .gold * level,
                2
            )
        };
    }

    function checkPlacement(
        buildingId,
        settlement
    ) {
        const building =
            getBuildingById(buildingId);

        if (!building) {
            return {
                allowed: false,
                reasons: [
                    "존재하지 않는 건물 ID입니다."
                ],
                warnings: []
            };
        }

        if (
            !settlement ||
            typeof settlement !== "object"
        ) {
            return {
                allowed: false,
                reasons: [
                    "거점 데이터가 없습니다."
                ],
                warnings: []
            };
        }

        const type =
            String(settlement.type || "");

        const tags =
            uniqueStrings(settlement.tags);

        const reasons = [];
        const warnings = [];

        if (
            building
                .placement
                .allowedSettlementTypes
                .length > 0 &&
            building
                .placement
                .allowedSettlementTypes
                .indexOf(type) === -1
        ) {
            reasons.push(
                "거점 종류 " +
                type +
                "에서는 건설할 수 없습니다."
            );
        }

        if (
            building
                .placement
                .requiredAnyTags
                .length > 0 &&
            !building
                .placement
                .requiredAnyTags
                .some(function (tag) {
                    return tags.indexOf(tag) !== -1;
                })
        ) {
            reasons.push(
                "필수 지형 태그 중 하나가 필요합니다: " +
                building
                    .placement
                    .requiredAnyTags
                    .join(", ")
            );
        }

        if (
            building
                .placement
                .preferredTags
                .length > 0 &&
            !building
                .placement
                .preferredTags
                .some(function (tag) {
                    return tags.indexOf(tag) !== -1;
                })
        ) {
            warnings.push(
                "권장 지형 태그가 없습니다: " +
                building
                    .placement
                    .preferredTags
                    .join(", ")
            );
        }

        return {
            allowed:
                reasons.length === 0,
            reasons: reasons,
            warnings: warnings
        };
    }

    function getBuildingSummary(
        buildingId,
        levelValue
    ) {
        const building =
            getBuildingById(buildingId);

        if (!building) {
            return null;
        }

        const level = normalizeLevel(
            building,
            levelValue,
            true
        );

        return {
            buildingId:
                building.id,

            name:
                building.name,

            level:
                level,

            maxLevel:
                building.maxLevel,

            effects:
                getEffectsAtLevel(
                    building.id,
                    level
                ),

            jobs:
                getJobsAtLevel(
                    building.id,
                    level
                ),

            maintenance:
                getMaintenanceAtLevel(
                    building.id,
                    level
                ),

            recipes:
                getRecipesForBuilding(
                    building.id
                )
        };
    }

    function validate() {
        const errors = [];
        const ids = new Set();

        const resources =
            resourceCatalog();

        const labor =
            laborTypes();

        if (!resources) {
            errors.push(
                "ArsResourceCatalog가 없습니다."
            );
        }

        if (!labor) {
            errors.push(
                "ArsSettlementLaborTypes가 없습니다."
            );
        }

        BUILDINGS.forEach(function (building) {
            if (!building.id) {
                errors.push(
                    "ID가 없는 건물이 있습니다."
                );
            }

            if (ids.has(building.id)) {
                errors.push(
                    "건물 ID 중복: " +
                    building.id
                );
            }

            ids.add(building.id);

            if (!CATEGORIES[building.category]) {
                errors.push(
                    building.id +
                    ": 존재하지 않는 건물 분류 " +
                    building.category
                );
            }

            if (!BUILDING_KINDS[building.kind]) {
                errors.push(
                    building.id +
                    ": 존재하지 않는 건물 종류 " +
                    building.kind
                );
            }

            Object.keys(
                building.effectsPerLevel
            ).forEach(function (effectKey) {
                if (
                    EFFECT_KEYS.indexOf(
                        effectKey
                    ) === -1
                ) {
                    errors.push(
                        building.id +
                        ": 등록되지 않은 효과 키 " +
                        effectKey
                    );
                }
            });

            Object.keys(
                building.jobsPerLevel
            ).forEach(function (jobId) {
                if (
                    !labor ||
                    !labor.isKnown(jobId)
                ) {
                    errors.push(
                        building.id +
                        ": 등록되지 않은 직업 ID " +
                        jobId
                    );
                }
            });

            Object.keys(
                building.baseCost.resources
            ).forEach(function (resourceId) {
                if (
                    resources &&
                    typeof resources.isKnownResource ===
                        "function" &&
                    !resources.isKnownResource(
                        resourceId
                    )
                ) {
                    errors.push(
                        building.id +
                        ": 등록되지 않은 건설 자원 " +
                        resourceId
                    );
                }
            });

            if (
                building.kind ===
                    BUILDING_KINDS.production &&
                getRecipesForBuilding(
                    building.id
                ).length === 0
            ) {
                errors.push(
                    building.id +
                    ": 생산 레시피가 없습니다."
                );
            }
        });

        if (
            resources &&
            typeof resources.getRecipes ===
                "function"
        ) {
            resources.getRecipes().forEach(
                function (recipe) {
                    if (
                        !ids.has(
                            recipe.buildingId
                        )
                    ) {
                        errors.push(
                            "미등록 생산 건물: " +
                            recipe.id +
                            " -> " +
                            recipe.buildingId
                        );
                    }

                    if (
                        recipe.laborType &&
                        (
                            !labor ||
                            !labor.isKnown(
                                recipe.laborType
                            )
                        )
                    ) {
                        errors.push(
                            recipe.id +
                            ": 등록되지 않은 직업 ID " +
                            recipe.laborType
                        );
                    }
                }
            );
        }

        return errors;
    }

    function debugPrint() {
        const errors = validate();

        console.group(
            "[Ars Bellum] 거점 건물 카탈로그"
        );

        console.table(
            BUILDINGS.map(function (building) {
                return {
                    id: building.id,
                    name: building.name,
                    category: building.category,
                    kind: building.kind,
                    maxLevel: building.maxLevel,
                    recipes:
                        getRecipesForBuilding(
                            building.id
                        ).length
                };
            })
        );

        console.log(
            "건물:",
            BUILDINGS.length,
            "종"
        );

        if (errors.length) {
            console.error(
                "검사 오류:",
                errors
            );
        } else {
            console.log(
                "검사 결과: 정상"
            );
        }

        console.groupEnd();

        return {
            buildingCount:
                BUILDINGS.length,
            errors: errors
        };
    }

    window.ArsSettlementBuildingCatalog =
        Object.freeze({
            version: VERSION,

            categories:
                deepFreeze(
                    clone(CATEGORIES)
                ),

            buildingKinds:
                deepFreeze(
                    clone(BUILDING_KINDS)
                ),

            populationJobGroups:
                laborTypes()
                    ? laborTypes().ids
                    : Object.freeze([]),

            effectKeys:
                EFFECT_KEYS,

            buildings:
                BUILDINGS,

            getBuildingById:
                getBuildingById,

            getBuildings:
                getBuildings,

            getBuildingsByCategory:
                getBuildingsByCategory,

            getBuildingsByKind:
                getBuildingsByKind,

            getBuildingsByTag:
                getBuildingsByTag,

            getRecipesForBuilding:
                getRecipesForBuilding,

            getConstructionCost:
                getConstructionCost,

            getConstructionDays:
                getConstructionDays,

            getWorkRequired:
                getWorkRequired,

            getEffectsAtLevel:
                getEffectsAtLevel,

            getJobsAtLevel:
                getJobsAtLevel,

            getMaintenanceAtLevel:
                getMaintenanceAtLevel,

            checkPlacement:
                checkPlacement,

            getBuildingSummary:
                getBuildingSummary,

            validate:
                validate,

            debugPrint:
                debugPrint
        });

    const errors = validate();

    if (errors.length) {
        console.error(
            "[Ars Bellum] SettlementBuildingCatalog 검사 실패:",
            errors
        );
    } else {
        console.log(
            "[Ars Bellum] SettlementBuildingCatalog 연결 완료 - 건물 " +
            BUILDINGS.length +
            "종"
        );
    }
})();