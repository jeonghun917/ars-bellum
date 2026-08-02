// ============================================================
// Ars Bellum - GameState.js
// 0.14 호환 상태와 M1 루트 컨테이너의 단일 원본.
// ============================================================
(function () {
    "use strict";

    const previousEconomy = window.playerEconomy || {
        gold: 500,
        food: 10,
        manpower: 0,
        territory: 0
    };

    const state = {
        player: {
            name: "이름 없는 방랑자",
            economy: {
                gold: Number(previousEconomy.gold) || 0,
                food: Number(previousEconomy.food) || 0,
                manpower: Number(previousEconomy.manpower) || 0,
                territory: Number(previousEconomy.territory) || 0
            },
            party: {
                worldX: 1000,
                worldY: 1000,
                targetX: 1000,
                targetY: 1000,
                speed: 180,
                targetNode: null
            }
        }
    };

    function isObject(value) {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }

    function ensureObject(parent, key) {
        if (!isObject(parent[key])) {
            parent[key] = {};
        }
        return parent[key];
    }

    function ensureArray(parent, key) {
        if (!Array.isArray(parent[key])) {
            parent[key] = [];
        }
        return parent[key];
    }

    function ensureM1Root() {
        if (!Number.isInteger(state.version) || state.version < 2) {
            state.version = 2;
        }
        if (!Number.isInteger(state.schemaVersion) || state.schemaVersion < 2) {
            state.schemaVersion = 2;
        }

        const playerControl = ensureObject(state, "playerControl");
        if (!Object.prototype.hasOwnProperty.call(playerControl, "version")) {
            playerControl.version = 1;
        }
        if (!Object.prototype.hasOwnProperty.call(playerControl, "revision")) {
            playerControl.revision = 0;
        }
        if (!Object.prototype.hasOwnProperty.call(playerControl, "currentCharacterId")) {
            playerControl.currentCharacterId = null;
        }
        if (!Object.prototype.hasOwnProperty.call(playerControl, "campaignClanId")) {
            playerControl.campaignClanId = null;
        }
        ensureArray(playerControl, "designatedSuccessorIds");
        if (!Object.prototype.hasOwnProperty.call(playerControl, "controlStatus")) {
            playerControl.controlStatus = "unbound";
        }

        const world = ensureObject(state, "world");
        ensureObject(world, "characters");
        ensureObject(world, "mobileGroups");
        ensureObject(world, "clans");
        ensureObject(world, "factions");
        ensureObject(world, "titles");
        ensureObject(world, "settlements");
        ensureObject(world, "relationships");
        ensureObject(world, "memories");
        ensureObject(world, "inventories");
        ensureObject(world, "customDefinitions");

        const finance = ensureObject(world, "finance");
        ensureObject(finance, "accounts");
        ensureObject(finance, "debts");
        ensureObject(finance, "transfers");

        const migration = ensureObject(world, "migration");
        ensureArray(migration, "completedSteps");
        ensureObject(migration, "quarantinedLegacyValues");

        ensureObject(world, "clock");
        ensureObject(state, "runtime");
        return state;
    }

    ensureM1Root();

    function makeSafeNumber(value, oldValue) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return oldValue;
        }
        return Math.max(0, number);
    }

    const economyView = {};
    Object.defineProperties(economyView, {
        gold: {
            enumerable: true,
            get: function () { return state.player.economy.gold; },
            set: function (value) { state.player.economy.gold = makeSafeNumber(value, state.player.economy.gold); }
        },
        food: {
            enumerable: true,
            get: function () { return state.player.economy.food; },
            set: function (value) { state.player.economy.food = makeSafeNumber(value, state.player.economy.food); }
        },
        manpower: {
            enumerable: true,
            get: function () { return state.player.economy.manpower; },
            set: function (value) { state.player.economy.manpower = makeSafeNumber(value, state.player.economy.manpower); }
        },
        territory: {
            enumerable: true,
            get: function () { return state.player.economy.territory; },
            set: function (value) { state.player.economy.territory = makeSafeNumber(value, state.player.economy.territory); }
        }
    });
    economyView.toJSON = function () {
        return {
            gold: state.player.economy.gold,
            food: state.player.economy.food,
            manpower: state.player.economy.manpower,
            territory: state.player.economy.territory
        };
    };

    const partyView = {};
    Object.defineProperties(partyView, {
        name: {
            enumerable: true,
            get: function () { return state.player.name; },
            set: function (value) { if (typeof value === "string" && value.trim()) { state.player.name = value; } }
        },
        gold: {
            enumerable: true,
            get: function () { return state.player.economy.gold; },
            set: function (value) { economyView.gold = value; }
        },
        food: {
            enumerable: true,
            get: function () { return state.player.economy.food; },
            set: function (value) { economyView.food = value; }
        },
        worldX: {
            enumerable: true,
            get: function () { return state.player.party.worldX; },
            set: function (value) { const number = Number(value); if (Number.isFinite(number)) { state.player.party.worldX = number; } }
        },
        worldY: {
            enumerable: true,
            get: function () { return state.player.party.worldY; },
            set: function (value) { const number = Number(value); if (Number.isFinite(number)) { state.player.party.worldY = number; } }
        },
        targetX: {
            enumerable: true,
            get: function () { return state.player.party.targetX; },
            set: function (value) { const number = Number(value); if (Number.isFinite(number)) { state.player.party.targetX = number; } }
        },
        targetY: {
            enumerable: true,
            get: function () { return state.player.party.targetY; },
            set: function (value) { const number = Number(value); if (Number.isFinite(number)) { state.player.party.targetY = number; } }
        },
        speed: {
            enumerable: true,
            get: function () { return state.player.party.speed; },
            set: function (value) { const number = Number(value); if (Number.isFinite(number) && number >= 0) { state.player.party.speed = number; } }
        },
        targetNode: {
            enumerable: true,
            get: function () { return state.player.party.targetNode; },
            set: function (value) { state.player.party.targetNode = value || null; }
        }
    });

    function copyEconomyData(value) {
        if (!isObject(value)) { return; }
        ["gold", "food", "manpower", "territory"].forEach(function (key) {
            if (value[key] !== undefined) { economyView[key] = value[key]; }
        });
    }

    function copyPartyData(value) {
        if (!isObject(value)) { return; }
        ["name", "gold", "food", "worldX", "worldY", "targetX", "targetY", "speed", "targetNode"].forEach(function (key) {
            if (value[key] !== undefined) { partyView[key] = value[key]; }
        });
    }

    Object.defineProperty(window, "playerEconomy", {
        configurable: true,
        enumerable: true,
        get: function () { return economyView; },
        set: copyEconomyData
    });

    Object.defineProperty(window, "playerParty", {
        configurable: true,
        enumerable: true,
        get: function () { return partyView; },
        set: copyPartyData
    });

    window.ArsGameState = {
        getState: function () { return state; },
        ensureM1Root: ensureM1Root,
        getEconomy: function () { return state.player.economy; },
        getParty: function () { return state.player.party; },
        addGold: function (amount) {
            economyView.gold = economyView.gold + Number(amount || 0);
            return economyView.gold;
        },
        addFood: function (amount) {
            economyView.food = economyView.food + Number(amount || 0);
            return economyView.food;
        }
    };

    copyEconomyData(previousEconomy);
    console.log("[Ars Bellum] GameState 연결 완료");
})();
