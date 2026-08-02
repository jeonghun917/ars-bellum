// Ars Bellum M1 - Explicit legacy compatibility adapter. Never auto-installs.
(function () {
    "use strict";
    const legacy = {
        playerPartyDescriptor: Object.getOwnPropertyDescriptor(window, "playerParty"),
        playerEconomyDescriptor: Object.getOwnPropertyDescriptor(window, "playerEconomy"),
        getParty: window.ArsGameState.getParty,
        getEconomy: window.ArsGameState.getEconomy,
        addGold: window.ArsGameState.addGold,
        addFood: window.ArsGameState.addFood
    };
    let installed = false, binding = null;
    function group() { return binding ? window.ArsMobileGroupState.getSnapshot(binding.groupId) : null; }
    function character() { return binding && binding.characterId ? window.ArsCharacterState.getSnapshot(binding.characterId) : null; }
    function createPartyView(groupId) {
        const view = {};
        function read() { return window.ArsMobileGroupState.getSnapshot(groupId); }
        function setMovement(patch) { const g = read(); if (!g) return; window.ArsMobileGroupState.updateOperational({ groupId: groupId, expectedRevision: g.revision, movement: patch }); }
        function setPosition(patch) { const g = read(); if (!g) return; window.ArsMobileGroupState.updateOperational({ groupId: groupId, expectedRevision: g.revision, worldPosition: patch }); }
        Object.defineProperties(view, {
            name: { enumerable: true, get: function () { const g = read(); return g ? g.name : ""; } },
            worldX: { enumerable: true, get: function () { const g = read(); return g ? g.worldPosition.x : 0; }, set: function (v) { if (Number.isFinite(Number(v))) setPosition({ x: Number(v) }); } },
            worldY: { enumerable: true, get: function () { const g = read(); return g ? g.worldPosition.y : 0; }, set: function (v) { if (Number.isFinite(Number(v))) setPosition({ y: Number(v) }); } },
            targetX: { enumerable: true, get: function () { const g = read(); return g ? g.movement.targetX : 0; }, set: function (v) { if (Number.isFinite(Number(v))) setMovement({ targetX: Number(v) }); } },
            targetY: { enumerable: true, get: function () { const g = read(); return g ? g.movement.targetY : 0; }, set: function (v) { if (Number.isFinite(Number(v))) setMovement({ targetY: Number(v) }); } },
            speed: { enumerable: true, get: function () { const g = read(); return g ? g.movement.currentSpeed : 0; }, set: function (v) { if (Number.isFinite(Number(v)) && Number(v) >= 0) setMovement({ currentSpeed: Number(v) }); } },
            targetNode: { enumerable: true, get: function () { const g = read(); return g ? g.movement.targetNode : null; }, set: function (v) { setMovement({ targetNode: v || null }); } }
        });
        return view;
    }
    function accountIdFor(characterId, groupId) { const c = characterId ? window.ArsCharacterState.getSnapshot(characterId) : null; if (c && c.personalAccountId) return c.personalAccountId; const g = window.ArsMobileGroupState.getSnapshot(groupId); return g ? g.treasuryAccountId : null; }
    function createEconomyView(characterId, groupId) {
        const view = {};
        function account() { const id = accountIdFor(characterId, groupId); return id ? window.ArsFinanceState.getAccountSnapshot(id) : null; }
        function inventory() { const g = window.ArsMobileGroupState.getSnapshot(groupId); return g && g.inventoryId ? window.ArsInventoryState.getSnapshot(g.inventoryId) : null; }
        Object.defineProperties(view, {
            gold: { enumerable: true, get: function () { const a = account(); return a ? a.balance : 0; }, set: function (v) { const a = account(), n = Number(v); if (!a || !Number.isFinite(n) || n < 0) return; window.ArsTransferSystem.commitTransaction({ fromAccountId: n < a.balance ? a.id : null, toAccountId: n > a.balance ? a.id : null, expectedFromRevision: n < a.balance ? a.revision : undefined, expectedToRevision: n > a.balance ? a.revision : undefined, amount: Math.abs(n - a.balance), reasonTypeId: "legacy_compat_adjustment" }); } },
            food: { enumerable: true, get: function () { const i = inventory(); if (!i) return 0; return Object.keys(i.bulkItems).reduce(function (sum, id) { const d = window.ArsResourceCatalog.getResourceById(id); const tags = d && d.tags || []; return sum + ((d && (d.category === "food" || tags.indexOf("food") >= 0 || tags.some(function (t) { return /_food$/.test(t); }))) ? i.bulkItems[id] : 0); }, 0); }, set: function () {} },
            manpower: { enumerable: true, get: function () { return 0; }, set: function () {} },
            territory: { enumerable: true, get: function () { return 0; }, set: function () {} }
        });
        return view;
    }
    function installPlayerCompatibility(nextBinding) {
        if (installed) return { ok: false, error: "compatibility_already_installed" };
        const b = nextBinding || {}, g = window.ArsMobileGroupState.getSnapshot(b.groupId); if (!g) return { ok: false, error: "missing_group" };
        if (b.characterId && !window.ArsCharacterState.getSnapshot(b.characterId)) return { ok: false, error: "missing_character" };
        if (!g.inventoryId || !window.ArsInventoryState.getSnapshot(g.inventoryId)) return { ok: false, error: "missing_group_inventory" };
        if (!accountIdFor(b.characterId, b.groupId)) return { ok: false, error: "missing_compat_account" };
        binding = { groupId: b.groupId, characterId: b.characterId || null };
        const partyView = createPartyView(binding.groupId), economyView = createEconomyView(binding.characterId, binding.groupId);
        Object.defineProperty(window, "playerParty", { configurable: true, enumerable: true, get: function () { return partyView; }, set: function () {} });
        Object.defineProperty(window, "playerEconomy", { configurable: true, enumerable: true, get: function () { return economyView; }, set: function () {} });
        window.ArsGameState.getParty = function () { return partyView; }; window.ArsGameState.getEconomy = function () { return economyView; };
        window.ArsGameState.addGold = function (amount) { economyView.gold = economyView.gold + Number(amount || 0); return economyView.gold; };
        window.ArsGameState.addFood = function () { return economyView.food; };
        installed = true; return { ok: true, binding: clone(binding) };
    }
    function restoreLegacyCompatibility() {
        if (!installed) return { ok: true, restored: false };
        if (legacy.playerPartyDescriptor) Object.defineProperty(window, "playerParty", legacy.playerPartyDescriptor); else delete window.playerParty;
        if (legacy.playerEconomyDescriptor) Object.defineProperty(window, "playerEconomy", legacy.playerEconomyDescriptor); else delete window.playerEconomy;
        window.ArsGameState.getParty = legacy.getParty; window.ArsGameState.getEconomy = legacy.getEconomy; window.ArsGameState.addGold = legacy.addGold; window.ArsGameState.addFood = legacy.addFood;
        installed = false; binding = null; return { ok: true, restored: true };
    }
    function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
    window.ArsM1Compat = Object.freeze({ createPartyView: createPartyView, createEconomyView: createEconomyView, installPlayerCompatibility: installPlayerCompatibility, restoreLegacyCompatibility: restoreLegacyCompatibility, isInstalled: function () { return installed; }, getBindingSnapshot: function () { return clone(binding); } });
})();
