// ============================================================
// Ars Bellum - GameState.js
// 0.14 compatibility mirror plus M1 canonical persistent roots.
// ============================================================
(function () {
    "use strict";

    const previousEconomy = window.playerEconomy || { gold: 500, food: 10, manpower: 0, territory: 0 };
    const state = {
        player: {
            name: "이름 없는 방랑자",
            economy: {
                gold: Number(previousEconomy.gold) || 0,
                food: Number(previousEconomy.food) || 0,
                manpower: Number(previousEconomy.manpower) || 0,
                territory: Number(previousEconomy.territory) || 0
            },
            party: { worldX: 1000, worldY: 1000, targetX: 1000, targetY: 1000, speed: 180, targetNode: null }
        }
    };

    function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
    function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function ensureObject(parent, key) { if (!plain(parent[key])) { parent[key] = {}; } return parent[key]; }
    function ensureArray(parent, key) { if (!Array.isArray(parent[key])) { parent[key] = []; } return parent[key]; }
    function canonicalFallbackEqual(a, b) {
        try { return JSON.stringify(a) === JSON.stringify(b); } catch (ignored) { return false; }
    }
    function inPlace(target, source, recursiveKeys) {
        if (!plain(target) || !plain(source)) { throw new Error("m18_save_invalid_game_state"); }
        const recurse = Array.isArray(recursiveKeys) ? recursiveKeys : [];
        Object.keys(target).forEach(function (key) {
            if (!own(source, key)) {
                const descriptor = Object.getOwnPropertyDescriptor(target, key);
                if (descriptor && descriptor.configurable === false) { throw new Error("m18_save_readonly_root:" + key); }
                delete target[key];
            }
        });
        Object.keys(source).forEach(function (key) {
            const next = source[key];
            const descriptor = Object.getOwnPropertyDescriptor(target, key);
            const canReplace = !Object.isFrozen(target) && (!descriptor || descriptor.writable !== false || typeof descriptor.set === "function");
            if (recurse.indexOf(key) >= 0 && plain(next) && plain(target[key]) && !Object.isFrozen(target[key]) && !Object.isSealed(target[key])) {
                inPlace(target[key], next, null);
            } else if (canReplace) {
                target[key] = clone(next);
            } else if (canonicalFallbackEqual(target[key], next)) {
                return;
            } else {
                throw new Error("m18_save_readonly_root:" + key);
            }
        });
        return target;
    }
    let persistentRecordValidatorId = null;
    let persistentRecordValidator = null;

    function parseCanonicalError(error) {
        const message = String(error && error.message || error || "unsupported_json_value");
        const separator = message.indexOf(":");
        return {
            cause: separator >= 0 ? message.slice(0, separator) : message,
            path: separator >= 0 ? message.slice(separator + 1) : null
        };
    }
    function strictDetach(value) {
        const coordinator = window.ArsM1AtomicCoordinator;
        if (!coordinator || typeof coordinator._canonicalStringify !== "function") {
            return { ok: false, error: "m18_save_invalid_game_state", detail: { issues: ["canonical_helper_unavailable"] } };
        }
        try {
            const canonical = coordinator._canonicalStringify(value);
            return { ok: true, canonical: canonical, snapshot: JSON.parse(canonical) };
        } catch (error) {
            return { ok: false, error: "m18_save_non_json_value", detail: parseCanonicalError(error) };
        }
    }
    function livePersistentProjection() {
        if (!plain(state) || !plain(state.world)) {
            return { ok: false, error: "m18_save_invalid_game_state", detail: { issues: ["invalid_live_root"] } };
        }
        const projectedWorld = {};
        Object.keys(state.world).forEach(function (key) {
            if (key !== "clock") { projectedWorld[key] = state.world[key]; }
        });
        return {
            ok: true,
            projection: {
                version: state.version,
                schemaVersion: state.schemaVersion,
                playerControl: state.playerControl,
                world: projectedWorld
            }
        };
    }
    function installPersistentRecordValidator(validatorId, validator) {
        if (typeof validatorId !== "string" || !validatorId) { return { ok: false, error: "m18_save_invalid_persistent_validator" }; }
        if (typeof validator !== "function") { return { ok: false, error: "m18_save_invalid_persistent_validator" }; }
        if (persistentRecordValidator === null) {
            persistentRecordValidatorId = validatorId;
            persistentRecordValidator = validator;
            return { ok: true, idempotent: false };
        }
        if (persistentRecordValidatorId === validatorId && persistentRecordValidator === validator) { return { ok: true, idempotent: true }; }
        return { ok: false, error: "m18_save_persistent_validator_conflict" };
    }

    function ensureM1Root() {
        if (!Number.isInteger(state.version) || state.version < 2) { state.version = 2; }
        if (!Number.isInteger(state.schemaVersion) || state.schemaVersion < 2) { state.schemaVersion = 2; }
        const playerControl = ensureObject(state, "playerControl");
        if (!own(playerControl, "version")) { playerControl.version = 1; }
        if (!own(playerControl, "revision")) { playerControl.revision = 0; }
        if (!own(playerControl, "currentCharacterId")) { playerControl.currentCharacterId = null; }
        if (!own(playerControl, "campaignClanId")) { playerControl.campaignClanId = null; }
        ensureArray(playerControl, "designatedSuccessorIds");
        ensureArray(playerControl, "permanentlyReleasedCharacterIds");
        if (!own(playerControl, "controlStatus")) { playerControl.controlStatus = "unbound"; }

        const world = ensureObject(state, "world");
        ["characters", "mobileGroups", "clans", "factions", "titles", "settlements", "relationships", "memories", "inventories", "customDefinitions"].forEach(function (key) { ensureObject(world, key); });
        const finance = ensureObject(world, "finance");
        ["accounts", "debts", "transfers"].forEach(function (key) { ensureObject(finance, key); });
        const migration = ensureObject(world, "migration");
        ensureArray(migration, "completedSteps");
        ensureObject(migration, "quarantinedLegacyValues");
        ensureArray(migration, "warnings");
        ensureArray(migration, "report");
        ensureObject(world, "clock");
        ensureObject(state, "runtime");
        return state;
    }
    ensureM1Root();

    function capturePersistentRawStrict() {
        const projected = livePersistentProjection();
        if (!projected.ok) { return projected; }
        const detached = strictDetach(projected.projection);
        if (!detached.ok) { return detached; }
        return { ok: true, snapshot: detached.snapshot };
    }

    function capturePersistentWithOptions(options) {
        if (typeof persistentRecordValidator !== "function") {
            return { ok: false, error: "m18_save_invalid_game_state", detail: { issues: ["persistent_record_validator_unavailable"] } };
        }
        const projected = livePersistentProjection();
        if (!projected.ok) { return projected; }
        const detached = strictDetach(projected.projection);
        if (!detached.ok) { return detached; }
        const validation = validatePersistentInternal(detached.snapshot, options || null);
        if (!validation.ok) { return validation; }
        return { ok: true, snapshot: validation.normalizedSnapshot };
    }
    function capturePersistent() { return capturePersistentWithOptions(null); }
    function capturePersistentForBootstrap() { return capturePersistentWithOptions({ allowMissingFollowup: true }); }

    function validatePersistentInternal(snapshot, options) {
        if (typeof persistentRecordValidator !== "function") {
            return { ok: false, error: "m18_save_invalid_game_state", detail: { issues: ["persistent_record_validator_unavailable"] } };
        }
        const detached = strictDetach(snapshot);
        if (!detached.ok) { return detached; }
        const normalized = detached.snapshot;
        const issues = [];
        if (!plain(normalized)) { issues.push("not_plain_object"); }
        if (plain(normalized)) {
            const allowedTopLevelKeys = ["version", "schemaVersion", "playerControl", "world"];
            Object.keys(normalized).sort().forEach(function (key) {
                if (allowedTopLevelKeys.indexOf(key) < 0) { issues.push("gameState:unexpected_persistent_field:" + key); }
            });
            if (normalized.version !== 2 || normalized.schemaVersion !== 2) {
                issues.push(normalized.schemaVersion > 2 ? "m18_save_future_game_state_schema" : "invalid_schema");
            }
            if (own(normalized, "player")) { issues.push("duplicate_player_owner"); }
            if (own(normalized, "runtime")) { issues.push("runtime_persistent"); }
            if (!plain(normalized.playerControl) || !plain(normalized.world)) { issues.push("missing_root"); }
            if (normalized.world && own(normalized.world, "clock")) { issues.push("clock_persistent_in_game_state"); }
            if (plain(normalized.world)) {
                ["characters", "mobileGroups", "clans", "factions", "titles", "settlements", "inventories", "customDefinitions", "finance", "migration"].forEach(function (key) {
                    if (!plain(normalized.world[key])) { issues.push("missing_world_root:" + key); }
                });
                const migration = normalized.world.migration;
                if (plain(migration) && (!Array.isArray(migration.completedSteps) || !plain(migration.quarantinedLegacyValues) || !Array.isArray(migration.warnings) || !Array.isArray(migration.report))) { issues.push("invalid_world_migration"); }
            }
        }
        if (!issues.length) {
            try {
                const recordValidation = persistentRecordValidator(normalized, options || null);
                if (!recordValidation || recordValidation.ok !== true) {
                    (recordValidation && Array.isArray(recordValidation.issues) ? recordValidation.issues : ["persistent_record_validation_failed"]).forEach(function (issue) { issues.push(String(issue)); });
                }
            } catch (error) {
                issues.push("persistent_record_validator_exception:" + String(error && error.message || error));
            }
        }
        const sortedIssues = Array.from(new Set(issues)).sort();
        if (sortedIssues.length) {
            return { ok: false, error: "m18_save_invalid_game_state", detail: { issues: sortedIssues } };
        }
        return { ok: true, normalizedSnapshot: normalized };
    }
    function validatePersistent(snapshot) { return validatePersistentInternal(snapshot, null); }

    function hydratePersistentInternal(snapshot, options) {
        const validation = validatePersistentInternal(snapshot, options || null);
        if (!validation.ok) { return validation; }
        // Rollback capture must preserve JSON-safe but schema-invalid live state so a valid final save can repair it.
        const beforeResult = capturePersistentRawStrict();
        if (!beforeResult.ok) { return beforeResult; }
        const before = beforeResult.snapshot;
        const incoming = validation.normalizedSnapshot;
        try {
            state.version = incoming.version;
            state.schemaVersion = incoming.schemaVersion;
            inPlace(state.playerControl, incoming.playerControl);
            const incomingWorld = incoming.world;
            Object.keys(state.world).forEach(function (key) {
                if (key !== "clock" && !own(incomingWorld, key)) { delete state.world[key]; }
            });
            Object.keys(incomingWorld).forEach(function (key) {
                if (plain(incomingWorld[key]) && plain(state.world[key])) { inPlace(state.world[key], incomingWorld[key], key === "finance" ? ["accounts", "debts", "transfers"] : null); }
                else { state.world[key] = clone(incomingWorld[key]); }
            });
            const after = options && options.allowMissingFollowup ? capturePersistentForBootstrap() : capturePersistent();
            if (!after.ok) { throw new Error(after.error); }
            return { ok: true, gameState: after.snapshot };
        } catch (error) {
            state.version = before.version;
            state.schemaVersion = before.schemaVersion;
            inPlace(state.playerControl, before.playerControl);
            Object.keys(state.world).forEach(function (key) { if (key !== "clock" && !own(before.world, key)) { delete state.world[key]; } });
            Object.keys(before.world).forEach(function (key) {
                if (plain(before.world[key]) && plain(state.world[key])) { inPlace(state.world[key], before.world[key], key === "finance" ? ["accounts", "debts", "transfers"] : null); }
                else { state.world[key] = clone(before.world[key]); }
            });
            return { ok: false, error: "m18_save_invalid_game_state", detail: String(error && error.message || error) };
        }
    }

    function hydratePersistent(snapshot) { return hydratePersistentInternal(snapshot, null); }
    function hydratePersistentForBootstrap(snapshot) { return hydratePersistentInternal(snapshot, { allowMissingFollowup: true }); }

    function refreshDerivedPlayerMirror(binding) {
        const b = binding || {};
        const character = b.characterId && window.ArsCharacterState ? window.ArsCharacterState.getSnapshot(b.characterId) : null;
        const group = b.groupId && window.ArsMobileGroupState ? window.ArsMobileGroupState.getSnapshot(b.groupId) : null;
        const account = character && character.personalAccountId && window.ArsFinanceState ? window.ArsFinanceState.getAccountSnapshot(character.personalAccountId) : null;
        const inventory = group && group.inventoryId && window.ArsInventoryState ? window.ArsInventoryState.getSnapshot(group.inventoryId) : null;
        const metrics = account && account.customData && account.customData.m18CampaignMetrics || { manpower: 0, territory: 0 };
        if (character && character.identity) { state.player.name = character.identity.name; }
        if (account) { state.player.economy.gold = account.balance; }
        if (inventory) { state.player.economy.food = Number(inventory.bulkItems && inventory.bulkItems.travel_rations) || 0; }
        state.player.economy.manpower = Number(metrics.manpower) || 0;
        state.player.economy.territory = Number(metrics.territory) || 0;
        if (group) {
            state.player.party.worldX = group.worldPosition.x;
            state.player.party.worldY = group.worldPosition.y;
            state.player.party.targetX = group.movement.targetX;
            state.player.party.targetY = group.movement.targetY;
            state.player.party.speed = group.movement.currentSpeed;
            state.player.party.targetNode = group.movement.targetNode;
        }
        return { ok: true, player: clone(state.player) };
    }

    function safeNumber(value, oldValue) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, number) : oldValue; }
    const economyView = {};
    ["gold", "food", "manpower", "territory"].forEach(function (key) {
        Object.defineProperty(economyView, key, { enumerable: true, get: function () { return state.player.economy[key]; }, set: function (value) { state.player.economy[key] = safeNumber(value, state.player.economy[key]); } });
    });
    economyView.toJSON = function () { return clone(state.player.economy); };
    const partyView = {};
    const partyFields = { worldX: "worldX", worldY: "worldY", targetX: "targetX", targetY: "targetY", speed: "speed", targetNode: "targetNode" };
    Object.defineProperty(partyView, "name", { enumerable: true, get: function () { return state.player.name; }, set: function (value) { if (typeof value === "string" && value.trim()) { state.player.name = value; } } });
    Object.defineProperty(partyView, "gold", { enumerable: true, get: function () { return economyView.gold; }, set: function (v) { economyView.gold = v; } });
    Object.defineProperty(partyView, "food", { enumerable: true, get: function () { return economyView.food; }, set: function (v) { economyView.food = v; } });
    Object.keys(partyFields).forEach(function (key) {
        Object.defineProperty(partyView, key, { enumerable: true, get: function () { return state.player.party[partyFields[key]]; }, set: function (value) { if (key === "targetNode") { state.player.party.targetNode = value || null; } else { const n=Number(value); if (Number.isFinite(n) && (key !== "speed" || n >= 0)) { state.player.party[partyFields[key]] = n; } } } });
    });
    function copyEconomyData(value) { if (plain(value)) { ["gold", "food", "manpower", "territory"].forEach(function (key) { if (value[key] !== undefined) { economyView[key] = value[key]; } }); } }
    function copyPartyData(value) { if (plain(value)) { ["name", "gold", "food", "worldX", "worldY", "targetX", "targetY", "speed", "targetNode"].forEach(function (key) { if (value[key] !== undefined) { partyView[key] = value[key]; } }); } }
    Object.defineProperty(window, "playerEconomy", { configurable: true, enumerable: true, get: function () { return economyView; }, set: copyEconomyData });
    Object.defineProperty(window, "playerParty", { configurable: true, enumerable: true, get: function () { return partyView; }, set: copyPartyData });

    window.ArsGameState = {
        getState: function () { return state; },
        ensureM1Root: ensureM1Root,
        capturePersistent: capturePersistent,
        validatePersistent: validatePersistent,
        hydratePersistent: hydratePersistent,
        refreshDerivedPlayerMirror: refreshDerivedPlayerMirror,
        _installPersistentRecordValidator: installPersistentRecordValidator,
        _capturePersistentForBootstrap: capturePersistentForBootstrap,
        _capturePersistentRawStrict: capturePersistentRawStrict,
        _hydratePersistentForBootstrap: hydratePersistentForBootstrap,
        getEconomy: function () { return state.player.economy; },
        getParty: function () { return state.player.party; },
        addGold: function (amount) { economyView.gold += Number(amount || 0); return economyView.gold; },
        addFood: function (amount) { economyView.food += Number(amount || 0); return economyView.food; }
    };
    copyEconomyData(previousEconomy);
    console.log("[Ars Bellum] GameState 연결 완료");
})();
