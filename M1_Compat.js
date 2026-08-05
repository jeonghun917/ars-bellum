// Ars Bellum M1 - Canonical legacy compatibility facade.
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
    let installed = false, binding = null, partyView = null, economyView = null;
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function sameBinding(a, b) { return Boolean(a && b) && a.groupId === b.groupId && (a.characterId || null) === (b.characterId || null); }
    function groupFor(groupId) { return window.ArsMobileGroupState.getSnapshot(groupId); }
    function characterFor(characterId) { return characterId ? window.ArsCharacterState.getSnapshot(characterId) : null; }
    function accountIdFor(characterId, groupId) {
        const character = characterFor(characterId);
        if (character && character.personalAccountId) { return character.personalAccountId; }
        const group = groupFor(groupId);
        return group ? group.treasuryAccountId : null;
    }
    function createPartyView(groupId) {
        const view = {};
        function read() { return groupFor(groupId); }
        function setMovement(patch) { const current=read(); if (current) { window.ArsMobileGroupState.updateOperational({ groupId: groupId, expectedRevision: current.revision, movement: patch }); } }
        function setPosition(patch) { const current=read(); if (current) { window.ArsMobileGroupState.updateOperational({ groupId: groupId, expectedRevision: current.revision, worldPosition: patch }); } }
        Object.defineProperties(view, {
            name: { enumerable: true, get: function () { const current=read(); return current ? current.name : ""; } },
            worldX: { enumerable: true, get: function () { const current=read(); return current ? current.worldPosition.x : 0; }, set: function (value) { if (Number.isFinite(Number(value))) { setPosition({ x: Number(value) }); } } },
            worldY: { enumerable: true, get: function () { const current=read(); return current ? current.worldPosition.y : 0; }, set: function (value) { if (Number.isFinite(Number(value))) { setPosition({ y: Number(value) }); } } },
            targetX: { enumerable: true, get: function () { const current=read(); return current ? current.movement.targetX : 0; }, set: function (value) { if (Number.isFinite(Number(value))) { setMovement({ targetX: Number(value) }); } } },
            targetY: { enumerable: true, get: function () { const current=read(); return current ? current.movement.targetY : 0; }, set: function (value) { if (Number.isFinite(Number(value))) { setMovement({ targetY: Number(value) }); } } },
            speed: { enumerable: true, get: function () { const current=read(); return current ? current.movement.currentSpeed : 0; }, set: function (value) { if (Number.isFinite(Number(value)) && Number(value) >= 0) { setMovement({ currentSpeed: Number(value) }); } } },
            targetNode: { enumerable: true, get: function () { const current=read(); return current ? current.movement.targetNode : null; }, set: function (value) { setMovement({ targetNode: value || null }); } }
        });
        view.toJSON = function () { const current=read(); return current ? { name: current.name, worldX: current.worldPosition.x, worldY: current.worldPosition.y, targetX: current.movement.targetX, targetY: current.movement.targetY, speed: current.movement.currentSpeed, targetNode: current.movement.targetNode } : {}; };
        return view;
    }
    function createEconomyView(characterId, groupId) {
        const view = {};
        function account() { const id=accountIdFor(characterId, groupId); return id ? window.ArsFinanceState.getAccountSnapshot(id) : null; }
        function inventory() { const group=groupFor(groupId); return group && group.inventoryId ? window.ArsInventoryState.getSnapshot(group.inventoryId) : null; }
        function metrics() { const current=account(); return current && current.customData && current.customData.m18CampaignMetrics || { manpower: 0, territory: 0 }; }
        Object.defineProperties(view, {
            gold: { enumerable: true, get: function () { const current=account(); return current ? current.balance : 0; }, set: function () { console.warn("[Ars Bellum] M1-8 canonical gold setter ignored; use ArsSaveService transaction."); } },
            food: { enumerable: true, get: function () { const current=inventory(); return current ? Number(current.bulkItems && current.bulkItems.travel_rations) || 0 : 0; }, set: function () {} },
            manpower: { enumerable: true, get: function () { return Number(metrics().manpower) || 0; }, set: function () {} },
            territory: { enumerable: true, get: function () { return Number(metrics().territory) || 0; }, set: function () {} }
        });
        view.toJSON = function () { return { gold: view.gold, food: view.food, manpower: view.manpower, territory: view.territory }; };
        return view;
    }
    function validateBinding(nextBinding) {
        const b = nextBinding || {}, group=groupFor(b.groupId);
        if (!group) { return { ok: false, error: "missing_group" }; }
        if (b.characterId && !characterFor(b.characterId)) { return { ok: false, error: "missing_character" }; }
        if (!group.inventoryId || !window.ArsInventoryState.getSnapshot(group.inventoryId)) { return { ok: false, error: "missing_group_inventory" }; }
        if (!accountIdFor(b.characterId, b.groupId)) { return { ok: false, error: "missing_compat_account" }; }
        return { ok: true, binding: { groupId: b.groupId, characterId: b.characterId || null } };
    }
    function installPlayerCompatibility(nextBinding) {
        const validation=validateBinding(nextBinding); if (!validation.ok) { return validation; }
        if (installed) {
            if (sameBinding(binding, validation.binding)) { return { ok: true, idempotent: true, binding: clone(binding) }; }
            return { ok: false, error: "m18_save_compat_binding_conflict" };
        }
        binding=validation.binding; partyView=createPartyView(binding.groupId); economyView=createEconomyView(binding.characterId, binding.groupId);
        Object.defineProperty(window, "playerParty", { configurable: true, enumerable: true, get: function () { return partyView; }, set: function () {} });
        Object.defineProperty(window, "playerEconomy", { configurable: true, enumerable: true, get: function () { return economyView; }, set: function () {} });
        window.ArsGameState.getParty=function () { return partyView; };
        window.ArsGameState.getEconomy=function () { return economyView; };
        window.ArsGameState.addGold=function () { return economyView.gold; };
        window.ArsGameState.addFood=function () { return economyView.food; };
        installed=true;
        window.ArsGameState.refreshDerivedPlayerMirror(binding);
        return { ok: true, idempotent: false, binding: clone(binding) };
    }
    function restoreLegacyCompatibility() {
        if (!installed) { return { ok: true, restored: false }; }
        if (legacy.playerPartyDescriptor) { Object.defineProperty(window, "playerParty", legacy.playerPartyDescriptor); } else { delete window.playerParty; }
        if (legacy.playerEconomyDescriptor) { Object.defineProperty(window, "playerEconomy", legacy.playerEconomyDescriptor); } else { delete window.playerEconomy; }
        window.ArsGameState.getParty=legacy.getParty; window.ArsGameState.getEconomy=legacy.getEconomy; window.ArsGameState.addGold=legacy.addGold; window.ArsGameState.addFood=legacy.addFood;
        installed=false; binding=null; partyView=null; economyView=null;
        return { ok: true, restored: true };
    }
    window.ArsM1Compat=Object.freeze({ createPartyView:createPartyView, createEconomyView:createEconomyView, installPlayerCompatibility:installPlayerCompatibility, restoreLegacyCompatibility:restoreLegacyCompatibility, isInstalled:function () { return installed; }, getBindingSnapshot:function () { return clone(binding); } });
    const bootstrap=window.ArsSaveService && window.ArsSaveService.getBootstrapResult ? window.ArsSaveService.getBootstrapResult() : null;
    if (bootstrap && bootstrap.ok && bootstrap.binding) {
        const installedResult=installPlayerCompatibility(bootstrap.binding);
        if (!installedResult.ok && window.ArsSaveService._recordCompatFailure) { window.ArsSaveService._recordCompatFailure(installedResult); }
    }
})();
