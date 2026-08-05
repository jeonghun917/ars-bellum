// Ars Bellum M1-8 - Unified save, deterministic bootstrap, migration, and economy transaction boundary.
(function () {
    "use strict";

    const FINAL_KEY = "ars_bellum_save_v1";
    const STAGING_KEY = "ars_bellum_save_v1_staging";
    const LEGACY_KEYS = Object.freeze(["ars_bellum_econ", "ars_bellum_clock_v1", "ars_bellum_simulation_time_v1"]);
    const SAVE_ID = "campaign_default";
    const SCHEMA_VERSION = 1;
    const DEFAULT_PREFERENCES = Object.freeze({ version: 1, worldScale: 1, battleScale: 1 });
    const runtime = {
        state: "idle",
        fatalStorageLock: false,
        transactionFatalLock: false,
        currentRevision: null,
        cleanupRequired: false,
        bootstrapResult: null,
        bootstrapPreferences: { version: 1, worldScale: 1, battleScale: 1 },
        buildMetadata: { packageVersion: null, sourceTreeSha256: null },
        buildMetadataSet: false,
        transactionSequence: 0,
        transactionPending: false,
        compatFailure: null,
        lockTransitions: []
    };
    let topMigration = { lastMigrationId: null, sourceFingerprints: {} };

    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
    function jsonSafe(value, seen) {
        if (value === null || typeof value === "string" || typeof value === "boolean") { return true; }
        if (typeof value === "number") { return Number.isFinite(value); }
        if (typeof value !== "object") { return false; }
        if (seen.indexOf(value) >= 0) { return false; }
        seen.push(value);
        const result = Array.isArray(value)
            ? value.every(function (item) { return jsonSafe(item, seen); })
            : Object.prototype.toString.call(value) === "[object Object]" && Object.keys(value).every(function (key) { return jsonSafe(value[key], seen); });
        seen.pop();
        return result;
    }
    function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
    function strictPlain(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) { return false; }
        const proto = Object.getPrototypeOf(value);
        return proto === Object.prototype || proto === null;
    }
    function parseCanonicalError(error) {
        const message = String(error && error.message || error || "unsupported_json_value");
        const separator = message.indexOf(":");
        return { cause: separator >= 0 ? message.slice(0, separator) : message, path: separator >= 0 ? message.slice(separator + 1) : null };
    }
    function strictDetach(value) {
        try {
            const text = window.ArsM1AtomicCoordinator._canonicalStringify(value);
            return ok({ canonical: text, snapshot: JSON.parse(text) });
        } catch (error) {
            return { ok: false, error: "m18_save_non_json_value", detail: parseCanonicalError(error) };
        }
    }
    function canonical(value) { return window.ArsM1AtomicCoordinator._canonicalStringify(value); }
    function sha(value) { return window.ArsM1AtomicCoordinator._sha256(value); }
    function digest(value) { return "sha256:" + sha(canonical(value)); }
    function rawFingerprint(value) { return value == null ? null : "sha256:" + sha(String(value)); }
    function nowIso() { return new Date().toISOString(); }
    function byteSize(value) {
        const text=String(value);
        if (typeof TextEncoder !== "undefined") { return new TextEncoder().encode(text).length; }
        return unescape(encodeURIComponent(text)).length;
    }
    function ok(value) { return Object.assign({ ok: true }, value || {}); }
    function fail(error, detail) { return { ok: false, error: error, detail: detail == null ? null : clone(detail) }; }
    function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) { return value; } Object.keys(value).forEach(function (key) { deepFreeze(value[key]); }); return Object.freeze(value); }
    function same(a,b) { return canonical(a) === canonical(b); }
    function isSafeNonNegative(value) { return Number.isSafeInteger(value) && value >= 0; }
    function setLock(next) { runtime.lockTransitions.push({ from: runtime.state, to: next, at: nowIso() }); runtime.state = next; }
    function withLock(next, fn) {
        if (runtime.state !== "idle") { return fail("m18_save_runtime_busy", { state: runtime.state }); }
        setLock(next);
        try { return fn(); } finally { setLock("idle"); }
    }
    function storageGet(key) { return window.localStorage.getItem(key); }
    function storageSet(key, value) { window.localStorage.setItem(key, value); }
    function storageRemove(key) { window.localStorage.removeItem(key); }
    function storageAvailable() {
        try { storageGet(FINAL_KEY); return true; } catch (error) { return false; }
    }
    function cleanupStaging() {
        try {
            if (storageGet(STAGING_KEY) !== null) { storageRemove(STAGING_KEY); }
            runtime.cleanupRequired = storageGet(STAGING_KEY) !== null;
            return !runtime.cleanupRequired;
        } catch (error) { runtime.cleanupRequired = true; return false; }
    }

    function payloadForDigest(envelope) {
        return { gameState: envelope.gameState, gameClock: envelope.gameClock, simulationPreferences: envelope.simulationPreferences, migration: envelope.migration };
    }
    function computePayloadDigest(envelope) { return digest(payloadForDigest(envelope)); }
    function validTimestamp(value) { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
    function unexpectedFields(value, allowed, prefix) {
        if (!plain(value)) { return []; }
        return Object.keys(value).filter(function (key) { return allowed.indexOf(key) < 0; }).sort().map(function (key) { return prefix + ":unexpected_persistent_field:" + key; });
    }
    function validateBuildMetadata(value) {
        const issues = [];
        if (!plain(value)) { issues.push("sourceBuild:invalid_build_metadata"); }
        else {
            unexpectedFields(value, ["packageVersion", "sourceTreeSha256"], "sourceBuild").forEach(function (issue) { issues.push(issue); });
            if (!own(value, "packageVersion")) { issues.push("sourceBuild:missing_package_version"); }
            if (!own(value, "sourceTreeSha256")) { issues.push("sourceBuild:missing_source_tree_sha256"); }
            if (value.packageVersion !== null && (typeof value.packageVersion !== "string" || value.packageVersion.length === 0)) { issues.push("sourceBuild:invalid_package_version"); }
            if (value.sourceTreeSha256 !== null && (typeof value.sourceTreeSha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sourceTreeSha256))) { issues.push("sourceBuild:invalid_source_tree_sha256"); }
        }
        const uniqueIssues = Array.from(new Set(issues)).sort();
        return uniqueIssues.length ? fail("m18_save_invalid_build_metadata", { issues: uniqueIssues }) : ok({ metadata: { packageVersion: value.packageVersion, sourceTreeSha256: value.sourceTreeSha256 } });
    }
    function validatePreferences(value) {
        if (window.ArsSimulationTime && typeof window.ArsSimulationTime.validatePreferences === "function") { return window.ArsSimulationTime.validatePreferences(value); }
        const x=value || {}, errors=[];
        if (!plain(x)) { errors.push("not_plain_object"); }
        else { unexpectedFields(x, ["version", "worldScale", "battleScale"], "simulationPreferences").forEach(function (issue) { errors.push(issue); }); }
        if (x.version !== 1) { errors.push(x.version > 1 ? "future_version" : "invalid_version"); }
        if ([1,2,4,8].indexOf(x.worldScale) < 0) { errors.push("invalid_world_scale"); }
        if ([0.25,0.5,1,2].indexOf(x.battleScale) < 0) { errors.push("invalid_battle_scale"); }
        const uniqueErrors=Array.from(new Set(errors)).sort();
        return uniqueErrors.length ? fail("m18_save_invalid_preferences", uniqueErrors) : ok({ snapshot: {version:1,worldScale:x.worldScale,battleScale:x.battleScale} });
    }
    function validateTopMigration(value, allowOptionalDefaults) {
        const issues=[];
        if (!strictPlain(value)) { return fail("m18_save_invalid_envelope", {issues:["migration:invalid_top_migration"]}); }
        unexpectedFields(value, ["lastMigrationId", "sourceFingerprints"], "migration").forEach(function (issue) { issues.push(issue); });
        const normalized={
            lastMigrationId: own(value,"lastMigrationId") ? value.lastMigrationId : null,
            sourceFingerprints: own(value,"sourceFingerprints") ? value.sourceFingerprints : {}
        };
        let needsResave=false;
        if (!own(value,"lastMigrationId") || !own(value,"sourceFingerprints")) {
            if (!allowOptionalDefaults) { issues.push("migration:missing_required_field"); } else { needsResave=true; }
        }
        if (normalized.lastMigrationId !== null && (typeof normalized.lastMigrationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(normalized.lastMigrationId))) { issues.push("migration:invalid_last_migration_id"); }
        if (!strictPlain(normalized.sourceFingerprints)) { issues.push("migration:invalid_source_fingerprints"); }
        else {
            Object.keys(normalized.sourceFingerprints).sort().forEach(function (key) {
                if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(key)) { issues.push("migration.sourceFingerprints:invalid_source_id:"+key); }
                if (typeof normalized.sourceFingerprints[key] !== "string" || !/^sha256:[0-9a-f]{64}$/.test(normalized.sourceFingerprints[key])) { issues.push("migration.sourceFingerprints:invalid_fingerprint:"+key); }
            });
        }
        const uniqueIssues=Array.from(new Set(issues)).sort();
        return uniqueIssues.length ? fail("m18_save_invalid_envelope", {issues:uniqueIssues}) : ok({normalizedMigration:{lastMigrationId:normalized.lastMigrationId,sourceFingerprints:clone(normalized.sourceFingerprints)},needsResave:needsResave});
    }
    function validateMetrics(value) {
        if (!plain(value) || value.version !== 1 || !isSafeNonNegative(value.manpower) || !isSafeNonNegative(value.territory)) { return false; }
        return Object.keys(value).sort().join(",") === "manpower,territory,version";
    }
    function resolveBinding(gameState) {
        let gs = gameState;
        if (!gs) {
            const captured = window.ArsGameState.capturePersistent();
            if (!captured || !captured.ok) { return captured || fail("m18_save_invalid_game_state"); }
            gs = captured.snapshot;
        }
        const world=gs.world || {}, pc=gs.playerControl || {};
        const characterId=pc.currentCharacterId;
        const character=characterId && world.characters && world.characters[characterId];
        if (!character) { return fail("m18_save_global_invariant_failed", "missing_selected_character"); }
        let groupId=character.location && character.location.mobileGroupId;
        if (!groupId || !world.mobileGroups[groupId]) {
            groupId=Object.keys(world.mobileGroups || {}).sort().find(function (id) { return (world.mobileGroups[id].memberCharacterIds || []).indexOf(characterId) >= 0; }) || null;
        }
        if (!groupId || !world.mobileGroups[groupId]) { return fail("m18_save_global_invariant_failed", "missing_selected_group"); }
        const group=world.mobileGroups[groupId], accountId=character.personalAccountId, inventoryId=group.inventoryId;
        const account=world.finance && world.finance.accounts && world.finance.accounts[accountId], inventory=world.inventories && world.inventories[inventoryId];
        if (!account || !inventory) { return fail("m18_save_global_invariant_failed", "missing_selected_assets"); }
        if (!validateMetrics(account.customData && account.customData.m18CampaignMetrics)) { return fail("m18_save_global_invariant_failed", "invalid_campaign_metrics"); }
        return ok({ binding: { characterId: characterId, groupId: groupId }, accountId: accountId, inventoryId: inventoryId });
    }
    function globalInvariant(envelope) {
        const binding=resolveBinding(envelope.gameState); if (!binding.ok) { return binding; }
        const world=envelope.gameState.world, character=world.characters[binding.binding.characterId], group=world.mobileGroups[binding.binding.groupId];
        const account=world.finance.accounts[binding.accountId], inventory=world.inventories[binding.inventoryId];
        function collection(type) {
            if(type==="character")return world.characters;
            if(type==="mobile_group")return world.mobileGroups;
            if(type==="clan")return world.clans;
            if(type==="faction")return world.factions;
            if(type==="title")return world.titles;
            if(type==="settlement")return world.settlements;
            if(type==="land_right")return world.landRights;
            if(type==="account")return world.finance&&world.finance.accounts;
            if(type==="inventory")return world.inventories;
            return null;
        }
        function refExists(ref) { const values=ref&&collection(ref.type); return Boolean(values&&values[ref.id]); }
        if (account.ownerRef.type !== "character" || account.ownerRef.id !== character.id) { return fail("m18_save_global_invariant_failed", "account_owner"); }
        if (inventory.ownerRef.type !== "mobile_group" || inventory.ownerRef.id !== group.id) { return fail("m18_save_global_invariant_failed", "inventory_owner"); }
        if ((group.memberCharacterIds || []).indexOf(character.id) < 0) { return fail("m18_save_global_invariant_failed", "group_membership"); }
        if (group.inventoryId !== inventory.id || character.personalAccountId !== account.id) { return fail("m18_save_global_invariant_failed", "asset_reference"); }
        const pc=envelope.gameState.playerControl||{};
        if(pc.currentCharacterId&&!world.characters[pc.currentCharacterId])return fail("m18_save_global_invariant_failed","player_control_character");
        for(const id of (pc.designatedSuccessorIds||[]).concat(pc.permanentlyReleasedCharacterIds||[])){if(!world.characters[id])return fail("m18_save_global_invariant_failed","player_control_reference:"+id);}
        for(const id of Object.keys(world.characters||{})){
            const value=world.characters[id];
            if(value.personalAccountId&&!(world.finance&&world.finance.accounts&&world.finance.accounts[value.personalAccountId]))return fail("m18_save_global_invariant_failed","character_account:"+id);
            if(value.location&&value.location.mode==="mobile_group"&&value.location.mobileGroupId&&!world.mobileGroups[value.location.mobileGroupId])return fail("m18_save_global_invariant_failed","character_group:"+id);
        }
        for(const id of Object.keys(world.mobileGroups||{})){
            const value=world.mobileGroups[id];
            if(value.inventoryId&&!world.inventories[value.inventoryId])return fail("m18_save_global_invariant_failed","group_inventory:"+id);
            if(value.treasuryAccountId&&!(world.finance&&world.finance.accounts&&world.finance.accounts[value.treasuryAccountId]))return fail("m18_save_global_invariant_failed","group_treasury:"+id);
            for(const ref of [value.legalOwnerRef,value.legalCommanderRef,value.actingCommanderRef]){if(ref&&!refExists(ref))return fail("m18_save_global_invariant_failed","group_ref:"+id);}
            for(const memberId of value.memberCharacterIds||[]){if(!world.characters[memberId])return fail("m18_save_global_invariant_failed","group_member:"+id+":"+memberId);}
        }
        let metricOwners=0;
        for(const id of Object.keys(world.finance&&world.finance.accounts||{})){
            const value=world.finance.accounts[id];
            if(value.ownerRef&&!refExists(value.ownerRef))return fail("m18_save_global_invariant_failed","account_owner_ref:"+id);
            if(value.customData&&own(value.customData,"m18CampaignMetrics")){metricOwners+=1;if(id!==binding.accountId||!validateMetrics(value.customData.m18CampaignMetrics))return fail("m18_save_global_invariant_failed","duplicate_campaign_metric_owner");}
        }
        if(metricOwners!==1)return fail("m18_save_global_invariant_failed","campaign_metric_owner_count");
        for(const id of Object.keys(world.inventories||{})){const value=world.inventories[id];if(value.ownerRef&&!refExists(value.ownerRef))return fail("m18_save_global_invariant_failed","inventory_owner_ref:"+id);}
        const relationships=world.relationships||{}, expectedRelIndex={from:{},to:{}};
        for(const id of Object.keys(relationships.records||{}).sort()){
            const value=relationships.records[id];if(value.id!==id||!world.characters[value.fromCharacterId]||!world.characters[value.toCharacterId]||value.fromCharacterId===value.toCharacterId)return fail("m18_save_global_invariant_failed","relationship_record:"+id);
            if(!expectedRelIndex.from[value.fromCharacterId])expectedRelIndex.from[value.fromCharacterId]=[];expectedRelIndex.from[value.fromCharacterId].push(id);
            if(!expectedRelIndex.to[value.toCharacterId])expectedRelIndex.to[value.toCharacterId]=[];expectedRelIndex.to[value.toCharacterId].push(id);
        }
        Object.keys(expectedRelIndex.from).forEach(function(id){expectedRelIndex.from[id].sort();});Object.keys(expectedRelIndex.to).forEach(function(id){expectedRelIndex.to[id].sort();});
        if(!same(relationships.indexes||{},expectedRelIndex))return fail("m18_save_global_invariant_failed","relationship_index");
        const memories=world.memories||{}, expectedOwnerIndex={};
        for(const id of Object.keys(memories.records||{}).sort()){
            const value=memories.records[id];if(value.id!==id||!world.characters[value.ownerCharacterId])return fail("m18_save_global_invariant_failed","memory_owner:"+id);
            for(const targetId of value.targetCharacterIds||[]){if(!world.characters[targetId])return fail("m18_save_global_invariant_failed","memory_target:"+id+":"+targetId);}
            if(!expectedOwnerIndex[value.ownerCharacterId])expectedOwnerIndex[value.ownerCharacterId]=[];expectedOwnerIndex[value.ownerCharacterId].push(id);
        }
        Object.keys(expectedOwnerIndex).forEach(function(id){expectedOwnerIndex[id].sort();});if(!same(memories.ownerIndex||{},expectedOwnerIndex))return fail("m18_save_global_invariant_failed","memory_owner_index");
        for(const id of Object.keys(world.npcActivityProfiles&&world.npcActivityProfiles.records||{})){const value=world.npcActivityProfiles.records[id];if(value.characterId!==id||!world.characters[id])return fail("m18_save_global_invariant_failed","activity_character:"+id);}
        for(const id of Object.keys(world.landRights||{})){const value=world.landRights[id];for(const ref of [value.subjectRef,value.holderRef,value.basisRef]){if(ref&&!refExists(ref))return fail("m18_save_global_invariant_failed","land_right_ref:"+id);}}
        return ok({ binding: binding.binding });
    }

    const PERSISTENT_VALIDATOR_ID = "m18.canonical_persistent_records.v1";
    const VALID_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/;
    const RELATION_VALUE_KEYS = Object.freeze(["affection", "fear", "obligation", "respect", "rivalry", "trust"]);
    const MEMORY_KNOWLEDGE = Object.freeze(["private", "known_to_targets", "clan_known", "faction_known", "public"]);
    const MEMORY_STATUS = Object.freeze(["unresolved", "resolved", "forgiven", "expired"]);
    const ACTIVITY_TIERS = Object.freeze(["active_major", "active_named", "inactive_named", "historical"]);
    const ACTIVITY_FLOORS = Object.freeze(["active_major", "active_named", "inactive_named"]);

    function validPersistentId(value) { return typeof value === "string" && VALID_ID.test(value); }
    function sortedUniqueValid(values) { return Array.from(new Set(values)).sort().every(validPersistentId); }
    function addIssue(issues, path, code) { issues.push(String(path) + ":" + String(code)); }
    function callValidatorFunction(issues, path, validator, record, options) {
        if (typeof validator !== "function") { addIssue(issues, path, "validator_unavailable"); return; }
        try {
            const errors = validator(record, options);
            if (!Array.isArray(errors)) { addIssue(issues, path, "validator_invalid_result"); return; }
            errors.forEach(function (error) { addIssue(issues, path, error); });
        } catch (error) {
            addIssue(issues, path, "validator_exception:" + String(error && error.message || error));
        }
    }
    function callPublicValidator(issues, path, api, record, options) {
        callValidatorFunction(issues, path, api && api.validate, record, options);
    }
    function validateRecordMap(issues, map, path, api, idField) {
        if (!strictPlain(map)) { addIssue(issues, path, "invalid_record_map"); return; }
        Object.keys(map).sort().forEach(function (id) {
            const record = map[id], recordPath = path + "." + id;
            if (!validPersistentId(id)) { addIssue(issues, recordPath, "invalid_map_key"); }
            if (!strictPlain(record)) { addIssue(issues, recordPath, "record_not_plain"); return; }
            const identityField = idField || "id";
            if (record[identityField] !== id) { addIssue(issues, recordPath, "record_id_mismatch"); }
            if (!Number.isInteger(record.version) || record.version < 1 || record.version > 1) { addIssue(issues, recordPath, "unsupported_future_version"); }
            if (!Number.isInteger(record.revision) || record.revision < 0) { addIssue(issues, recordPath, "invalid_revision"); }
            callPublicValidator(issues, recordPath, api, record);
        });
    }
    function detachedOrStaticRefExists(world, ref) {
        if (!strictPlain(ref) || !validPersistentId(ref.type) || !validPersistentId(ref.id)) { return false; }
        const collection = collectionFor(world, ref.type);
        if (collection) { return own(collection, ref.id); }
        const registry = window.ArsRefRegistry;
        if (!registry || typeof registry.hasResolver !== "function" || typeof registry.validateRef !== "function" || !registry.hasResolver(ref.type)) { return false; }
        try { const result = registry.validateRef(ref); return Boolean(result && result.ok); }
        catch (error) { return false; }
    }
    function validateDebtMap(issues, world) {
        const path = "world.finance.debts";
        const map = world.finance && world.finance.debts;
        if (!strictPlain(map)) { addIssue(issues, path, "invalid_debt_root"); return; }
        Object.keys(map).sort().forEach(function (id) {
            const record = map[id], recordPath = path + "." + id;
            if (!validPersistentId(id)) { addIssue(issues, recordPath, "invalid_map_key"); }
            if (!strictPlain(record)) { addIssue(issues, recordPath, "invalid_debt_record"); return; }
            if (record.id !== id) { addIssue(issues, recordPath, "record_id_mismatch"); }
            if (record.version !== 1) { addIssue(issues, recordPath, "unsupported_future_version"); }
            if (!Number.isInteger(record.revision) || record.revision < 0) { addIssue(issues, recordPath, "invalid_revision"); }
            callValidatorFunction(issues, recordPath, window.ArsDebtState && window.ArsDebtState.validate, record);
            if (record.creditorRef && !detachedOrStaticRefExists(world, record.creditorRef)) { addIssue(issues, recordPath + ".creditorRef", "missing_reference"); }
            if (record.debtorRef && !detachedOrStaticRefExists(world, record.debtorRef)) { addIssue(issues, recordPath + ".debtorRef", "missing_reference"); }
        });
    }
    function validateDetachedTransferRecord(issues, record, id, accounts) {
        const path = "world.finance.transfers." + id;
        if (!validPersistentId(id)) { addIssue(issues, path, "invalid_transfer_id"); }
        if (!strictPlain(record)) { addIssue(issues, path, "invalid_transfer_record"); return; }
        if (record.id !== id) { addIssue(issues, path, "record_id_mismatch"); }
        if (record.version !== 1) { addIssue(issues, path, "unsupported_future_version"); }
        if (!Number.isInteger(record.revision) || record.revision < 0) { addIssue(issues, path, "invalid_revision"); }
        if (!Number.isFinite(record.amount) || record.amount <= 0) { addIssue(issues, path, "invalid_amount"); }
        if (!validPersistentId(record.currencyId)) { addIssue(issues, path, "invalid_currency_id"); }
        const fromId = record.fromAccountId;
        const toId = record.toAccountId;
        const fromValid = fromId === null || validPersistentId(fromId);
        const toValid = toId === null || validPersistentId(toId);
        if (!fromValid) { addIssue(issues, path, "missing_from_account"); }
        if (!toValid) { addIssue(issues, path, "missing_to_account"); }
        if (fromId === null && toId === null) { addIssue(issues, path, "missing_transaction_endpoint"); }
        if (fromId !== null && toId !== null && fromId === toId) { addIssue(issues, path, "same_account_transfer"); }
        const from = fromValid && fromId !== null ? accounts[fromId] : null;
        const to = toValid && toId !== null ? accounts[toId] : null;
        if (fromId !== null && !from) { addIssue(issues, path, "missing_from_account"); }
        if (toId !== null && !to) { addIssue(issues, path, "missing_to_account"); }
        if ((from && from.currencyId !== record.currencyId) || (to && to.currencyId !== record.currencyId) || (from && to && from.currencyId !== to.currencyId)) { addIssue(issues, path, "transfer_currency_mismatch"); }
    }
    function validateTransferMap(issues, world) {
        const path = "world.finance.transfers";
        const map = world.finance && world.finance.transfers;
        if (!strictPlain(map)) { addIssue(issues, path, "invalid_transfer_root"); return; }
        const accounts = strictPlain(world.finance && world.finance.accounts) ? world.finance.accounts : {};
        Object.keys(map).sort().forEach(function (id) { validateDetachedTransferRecord(issues, map[id], id, accounts); });
    }
    function validateCustomDefinitions(issues, world) {
        const path = "world.customDefinitions", root = world.customDefinitions;
        if (!strictPlain(root)) { addIssue(issues, path, "invalid_definition_root"); return; }
        const api = window.ArsDefinitionState;
        const version = api && Number.isInteger(api.VERSION) ? api.VERSION : 1;
        if (root.version !== version) { addIssue(issues, path, "unsupported_future_version"); }
        if (!Number.isInteger(root.revision) || root.revision < 0) { addIssue(issues, path, "invalid_revision"); }
        if (!strictPlain(root.records)) { addIssue(issues, path, "invalid_records"); return; }
        Object.keys(root.records).sort().forEach(function (key) {
            const record = root.records[key], recordPath = path + ".records." + key;
            if (!strictPlain(record)) { addIssue(issues, recordPath, "invalid_definition_record"); return; }
            if (key !== String(record.domainId) + ":" + String(record.definitionId)) { addIssue(issues, recordPath, "record_key_mismatch"); }
            if (record.schemaVersion !== version) { addIssue(issues, recordPath, record.schemaVersion > version ? "unsupported_future_schema_version" : "invalid_schema_version"); }
            callValidatorFunction(issues, recordPath, window.ArsDefinitionState && window.ArsDefinitionState.validate, record);
        });
    }
    function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
    function nonNegativeInteger(value) { return Number.isInteger(value) && value >= 0; }
    function positiveInteger(value) { return Number.isInteger(value) && value > 0; }
    function finiteNonNegative(value) { return Number.isFinite(value) && value >= 0; }
    function validateSettlementJob(issues, path, job) {
        if (!strictPlain(job)) { addIssue(issues, path, "invalid_construction_job"); return; }
        if (!nonEmptyString(job.id)) { addIssue(issues, path, "invalid_job_id"); }
        if (!nonEmptyString(job.buildingId)) { addIssue(issues, path, "invalid_building_id"); }
        if (["queued", "active", "completed", "cancelled"].indexOf(job.status) < 0) { addIssue(issues, path, "invalid_job_status"); }
    }
    function validateSettlementRecord(issues, id, record) {
        const path = "world.settlements." + id;
        if (!nonEmptyString(id)) { addIssue(issues, path, "invalid_settlement_id"); }
        if (!strictPlain(record)) { addIssue(issues, path, "invalid_settlement_record"); return; }
        if (typeof record.id !== "string") { addIssue(issues, path, "invalid_settlement_id"); }
        else if (record.id !== id) { addIssue(issues, path, "settlement_id_mismatch"); }
        ["developmentState", "buildings", "inventory", "money", "economy", "population", "construction"].forEach(function (key) { if (!own(record, key)) { addIssue(issues, path, "missing_settlement_subroot:" + key); } });
        const development = record.developmentState;
        if (!strictPlain(development)) { addIssue(issues, path + ".developmentState", "invalid_development_state"); }
        else {
            if (development.version !== 1) { addIssue(issues, path + ".developmentState", "unsupported_future_version"); }
            if (!nonNegativeInteger(development.revision)) { addIssue(issues, path + ".developmentState", "invalid_revision"); }
            if (typeof development.lastAction !== "string") { addIssue(issues, path + ".developmentState", "invalid_last_action"); }
        }
        if (!strictPlain(record.buildings)) { addIssue(issues, path + ".buildings", "invalid_buildings"); }
        else { Object.keys(record.buildings).sort().forEach(function (buildingId) {
            const building = record.buildings[buildingId], buildingPath = path + ".buildings." + buildingId;
            if (!strictPlain(building)) { addIssue(issues, buildingPath, "invalid_building_record"); return; }
            if (!nonNegativeInteger(building.level)) { addIssue(issues, buildingPath, "invalid_level"); }
            if (typeof building.enabled !== "boolean") { addIssue(issues, buildingPath, "invalid_enabled"); }
            if (!Number.isFinite(building.condition) || building.condition < 0 || building.condition > 1) { addIssue(issues, buildingPath, "invalid_condition"); }
        }); }
        if (!strictPlain(record.inventory)) { addIssue(issues, path + ".inventory", "invalid_inventory"); }
        else { Object.keys(record.inventory).sort().forEach(function (resourceId) { if (!finiteNonNegative(record.inventory[resourceId])) { addIssue(issues, path + ".inventory." + resourceId, "invalid_quantity"); } }); }
        if (!strictPlain(record.money)) { addIssue(issues, path + ".money", "invalid_money"); }
        else { ["treasury", "privateWealth", "merchantCapital"].forEach(function (key) { if (!finiteNonNegative(record.money[key])) { addIssue(issues, path + ".money." + key, "invalid_amount"); } }); }
        const economy = record.economy;
        if (!strictPlain(economy)) { addIssue(issues, path + ".economy", "invalid_economy"); }
        else {
            if (economy.version !== 2) { addIssue(issues, path + ".economy", "unsupported_future_version"); }
            if (!nonNegativeInteger(economy.revision)) { addIssue(issues, path + ".economy", "invalid_revision"); }
            if (typeof economy.lastAction !== "string") { addIssue(issues, path + ".economy", "invalid_last_action"); }
            ["daily", "totals", "produced", "consumed", "spoiled", "imported", "exported", "shortages", "surpluses"].forEach(function (key) { if (!strictPlain(economy[key])) { addIssue(issues, path + ".economy." + key, "invalid_subroot"); } });
            if (!Array.isArray(economy.history)) { addIssue(issues, path + ".economy.history", "invalid_history"); }
            if (!positiveInteger(economy.lastProcessedDay)) { addIssue(issues, path + ".economy.lastProcessedDay", "invalid_day"); }
        }
        const population = record.population;
        if (!strictPlain(population)) { addIssue(issues, path + ".population", "invalid_population"); }
        else {
            if (population.version !== 1) { addIssue(issues, path + ".population", "unsupported_future_version"); }
            if (!nonNegativeInteger(population.revision)) { addIssue(issues, path + ".population", "invalid_revision"); }
            if (!nonNegativeInteger(population.current)) { addIssue(issues, path + ".population.current", "invalid_population_count"); }
            if (!positiveInteger(population.baseCapacity)) { addIssue(issues, path + ".population.baseCapacity", "invalid_capacity"); }
            if (!positiveInteger(population.effectiveCapacity)) { addIssue(issues, path + ".population.effectiveCapacity", "invalid_capacity"); }
            ["demographics", "labor", "conditions", "conditionOverrides", "migration", "naturalChange", "jobSources"].forEach(function (key) { if (!strictPlain(population[key])) { addIssue(issues, path + ".population." + key, "invalid_subroot"); } });
            if (!positiveInteger(population.lastProcessedDay)) { addIssue(issues, path + ".population.lastProcessedDay", "invalid_day"); }
        }
        const construction = record.construction;
        if (!strictPlain(construction)) { addIssue(issues, path + ".construction", "invalid_construction"); }
        else {
            if (construction.version !== 1) { addIssue(issues, path + ".construction", "unsupported_future_version"); }
            if (!nonNegativeInteger(construction.revision)) { addIssue(issues, path + ".construction", "invalid_revision"); }
            if (!positiveInteger(construction.nextJobNumber)) { addIssue(issues, path + ".construction.nextJobNumber", "invalid_job_number"); }
            if (!finiteNonNegative(construction.workforce)) { addIssue(issues, path + ".construction.workforce", "invalid_workforce"); }
            if (construction.activeJobId !== null && !nonEmptyString(construction.activeJobId)) { addIssue(issues, path + ".construction.activeJobId", "invalid_active_job_id"); }
            if (!Array.isArray(construction.queue)) { addIssue(issues, path + ".construction.queue", "invalid_queue"); }
            else { construction.queue.forEach(function (job, index) { validateSettlementJob(issues, path + ".construction.queue." + index, job); }); }
            if (!Array.isArray(construction.history)) { addIssue(issues, path + ".construction.history", "invalid_history"); }
            else { construction.history.forEach(function (job, index) { validateSettlementJob(issues, path + ".construction.history." + index, job); }); }
            if (!positiveInteger(construction.lastProcessedDay)) { addIssue(issues, path + ".construction.lastProcessedDay", "invalid_day"); }
        }
    }
    function validateSettlementMap(issues, world) {
        const path = "world.settlements", map = world.settlements;
        if (!strictPlain(map)) { addIssue(issues, path, "invalid_settlement_root"); return; }
        Object.keys(map).sort().forEach(function (id) { validateSettlementRecord(issues, id, map[id]); });
    }

    function collectionFor(world, type) {
        if (type === "character") { return world.characters; }
        if (type === "mobile_group") { return world.mobileGroups; }
        if (type === "clan") { return world.clans; }
        if (type === "faction") { return world.factions; }
        if (type === "title") { return world.titles; }
        if (type === "settlement") { return world.settlements; }
        if (type === "land_right") { return world.landRights; }
        if (type === "account") { return world.finance && world.finance.accounts; }
        if (type === "inventory") { return world.inventories; }
        return null;
    }
    function detachedRefExists(world, ref) {
        if (!strictPlain(ref) || !validPersistentId(ref.type) || !validPersistentId(ref.id)) { return false; }
        const collection = collectionFor(world, ref.type);
        return Boolean(collection && own(collection, ref.id));
    }
    function validateDetachedReferences(issues, snapshot) {
        const world = snapshot.world;
        Object.keys(world.characters || {}).sort().forEach(function (id) {
            const value = world.characters[id], path = "world.characters." + id;
            if (value.personalAccountId && !(world.finance && world.finance.accounts && world.finance.accounts[value.personalAccountId])) { addIssue(issues, path + ".personalAccountId", "missing_reference"); }
            if (value.location && value.location.mobileGroupId && !world.mobileGroups[value.location.mobileGroupId]) { addIssue(issues, path + ".location.mobileGroupId", "missing_reference"); }
            if (value.affiliations && value.affiliations.clanId && !world.clans[value.affiliations.clanId]) { addIssue(issues, path + ".affiliations.clanId", "missing_reference"); }
            if (value.affiliations && value.affiliations.factionId && !world.factions[value.affiliations.factionId]) { addIssue(issues, path + ".affiliations.factionId", "missing_reference"); }
        });
        Object.keys(world.mobileGroups || {}).sort().forEach(function (id) {
            const value = world.mobileGroups[id], path = "world.mobileGroups." + id;
            (value.memberCharacterIds || []).forEach(function (memberId) { if (!world.characters[memberId]) { addIssue(issues, path + ".memberCharacterIds", "missing_reference:" + memberId); } });
            ["legalOwnerRef", "legalCommanderRef", "actingCommanderRef", "employerRef", "commandAuthorityRef", "paymasterRef"].forEach(function (field) { if (value[field] && !detachedRefExists(world, value[field])) { addIssue(issues, path + "." + field, "missing_reference"); } });
            if (value.inventoryId && !world.inventories[value.inventoryId]) { addIssue(issues, path + ".inventoryId", "missing_reference"); }
            if (value.treasuryAccountId && !(world.finance && world.finance.accounts && world.finance.accounts[value.treasuryAccountId])) { addIssue(issues, path + ".treasuryAccountId", "missing_reference"); }
        });
        Object.keys(world.finance && world.finance.accounts || {}).sort().forEach(function (id) {
            const value = world.finance.accounts[id];
            if (value.ownerRef && !detachedRefExists(world, value.ownerRef)) { addIssue(issues, "world.finance.accounts." + id + ".ownerRef", "missing_reference"); }
        });
        Object.keys(world.inventories || {}).sort().forEach(function (id) {
            const value = world.inventories[id];
            if (value.ownerRef && !detachedRefExists(world, value.ownerRef)) { addIssue(issues, "world.inventories." + id + ".ownerRef", "missing_reference"); }
        });
        Object.keys(world.clans || {}).sort().forEach(function (id) {
            const value = world.clans[id], path = "world.clans." + id;
            if (value.factionId && !world.factions[value.factionId]) { addIssue(issues, path + ".factionId", "missing_reference"); }
            if (value.headCharacterId && !world.characters[value.headCharacterId]) { addIssue(issues, path + ".headCharacterId", "missing_reference"); }
            if (value.treasuryAccountId && !(world.finance && world.finance.accounts && world.finance.accounts[value.treasuryAccountId])) { addIssue(issues, path + ".treasuryAccountId", "missing_reference"); }
        });
        Object.keys(world.factions || {}).sort().forEach(function (id) {
            const value = world.factions[id], path = "world.factions." + id;
            if (value.rulerCharacterId && !world.characters[value.rulerCharacterId]) { addIssue(issues, path + ".rulerCharacterId", "missing_reference"); }
            if (value.rulingClanId && !world.clans[value.rulingClanId]) { addIssue(issues, path + ".rulingClanId", "missing_reference"); }
            if (value.treasuryAccountId && !(world.finance && world.finance.accounts && world.finance.accounts[value.treasuryAccountId])) { addIssue(issues, path + ".treasuryAccountId", "missing_reference"); }
        });
        Object.keys(world.titles || {}).sort().forEach(function (id) {
            const value = world.titles[id], path = "world.titles." + id;
            if (value.holderRef && !detachedRefExists(world, value.holderRef)) { addIssue(issues, path + ".holderRef", "missing_reference"); }
            if (value.parentTitleId && !world.titles[value.parentTitleId]) { addIssue(issues, path + ".parentTitleId", "missing_reference"); }
        });
        Object.keys(world.landRights || {}).sort().forEach(function (id) {
            const value = world.landRights[id], path = "world.landRights." + id;
            ["subjectRef", "holderRef", "basisRef"].forEach(function (field) { if (value[field] && !detachedRefExists(world, value[field])) { addIssue(issues, path + "." + field, "missing_reference"); } });
            (value.recognizedByFactionIds || []).forEach(function (factionId) { if (!world.factions[factionId]) { addIssue(issues, path + ".recognizedByFactionIds", "missing_reference:" + factionId); } });
        });
        const pc = snapshot.playerControl || {};
        if (pc.currentCharacterId && !world.characters[pc.currentCharacterId]) { addIssue(issues, "playerControl.currentCharacterId", "missing_reference"); }
        if (pc.campaignClanId && !world.clans[pc.campaignClanId]) { addIssue(issues, "playerControl.campaignClanId", "missing_reference"); }
        (pc.designatedSuccessorIds || []).forEach(function (id) { if (!world.characters[id]) { addIssue(issues, "playerControl.designatedSuccessorIds", "missing_reference:" + id); } });
        (pc.permanentlyReleasedCharacterIds || []).forEach(function (id) { if (!world.characters[id]) { addIssue(issues, "playerControl.permanentlyReleasedCharacterIds", "missing_reference:" + id); } });
    }
    function validateRelationshipRoot(issues, world) {
        const root = world.relationships, path = "world.relationships";
        if (!strictPlain(root) || root.version !== 1 || !Number.isInteger(root.revision) || root.revision < 0 || !strictPlain(root.records) || !strictPlain(root.appliedEffects) || !strictPlain(root.indexes) || !strictPlain(root.indexes.from) || !strictPlain(root.indexes.to)) { addIssue(issues, path, "invalid_root"); return; }
        const expected = { from: {}, to: {} };
        Object.keys(root.records).sort().forEach(function (id) {
            const record = root.records[id], recordPath = path + ".records." + id;
            if (!strictPlain(record) || record.id !== id || id !== "relation:" + sha(canonical([record.fromCharacterId, record.toCharacterId]))) { addIssue(issues, recordPath, "invalid_relation_id"); return; }
            if (!validPersistentId(record.fromCharacterId) || !validPersistentId(record.toCharacterId) || record.fromCharacterId === record.toCharacterId || !world.characters[record.fromCharacterId] || !world.characters[record.toCharacterId]) { addIssue(issues, recordPath, "invalid_character_reference"); }
            if (!strictPlain(record.values) || Object.keys(record.values).sort().join(",") !== RELATION_VALUE_KEYS.join(",") || RELATION_VALUE_KEYS.some(function (key) { return !Number.isInteger(record.values[key]) || record.values[key] < -1000 || record.values[key] > 1000; })) { addIssue(issues, recordPath + ".values", "invalid_values"); }
            if (!Array.isArray(record.tags) || canonical(record.tags) !== canonical(Array.from(new Set(record.tags)).sort()) || !record.tags.every(validPersistentId)) { addIssue(issues, recordPath + ".tags", "invalid_tags"); }
            if (!Number.isInteger(record.lastInteractionDay) || record.lastInteractionDay < 0 || !Number.isInteger(record.lastDecayDay) || record.lastDecayDay < 0 || !Number.isInteger(record.revision) || record.revision < 0) { addIssue(issues, recordPath, "invalid_revision_or_day"); }
            if (!expected.from[record.fromCharacterId]) { expected.from[record.fromCharacterId] = []; } expected.from[record.fromCharacterId].push(id);
            if (!expected.to[record.toCharacterId]) { expected.to[record.toCharacterId] = []; } expected.to[record.toCharacterId].push(id);
        });
        Object.keys(expected.from).forEach(function (id) { expected.from[id].sort(); }); Object.keys(expected.to).forEach(function (id) { expected.to[id].sort(); });
        if (!same(root.indexes, expected)) { addIssue(issues, path + ".indexes", "index_mismatch"); }
        Object.keys(root.appliedEffects).sort().forEach(function (key) {
            const value = root.appliedEffects[key], effectPath = path + ".appliedEffects." + key;
            if (!/^relation_effect:[0-9a-f]{64}$/.test(key) || !strictPlain(value) || !/^sha256:[0-9a-f]{64}$/.test(value.inputDigest) || !validPersistentId(value.sourceEventId) || !Number.isInteger(value.appliedDay) || value.appliedDay < 0 || (value.relationId !== null && !root.records[value.relationId])) { addIssue(issues, effectPath, "invalid_effect"); }
        });
    }
    function validateMemoryRoot(issues, world) {
        const root = world.memories, path = "world.memories";
        if (!strictPlain(root) || root.version !== 1 || !Number.isInteger(root.revision) || root.revision < 0 || !strictPlain(root.records) || !strictPlain(root.ownerIndex)) { addIssue(issues, path, "invalid_root"); return; }
        const expected = {};
        Object.keys(root.records).sort().forEach(function (id) {
            const record = root.records[id], recordPath = path + ".records." + id;
            const expectedId = strictPlain(record) ? "memory:" + sha(canonical([record.ownerCharacterId, record.memoryTypeId, record.sourceEventId])) : null;
            if (!strictPlain(record) || record.id !== id || id !== expectedId) { addIssue(issues, recordPath, "invalid_memory_id"); return; }
            if (!world.characters[record.ownerCharacterId]) { addIssue(issues, recordPath + ".ownerCharacterId", "missing_reference"); }
            if (!Array.isArray(record.targetCharacterIds) || canonical(record.targetCharacterIds) !== canonical(Array.from(new Set(record.targetCharacterIds)).sort())) { addIssue(issues, recordPath + ".targetCharacterIds", "invalid_targets"); }
            else { record.targetCharacterIds.forEach(function (targetId) { if (!world.characters[targetId]) { addIssue(issues, recordPath + ".targetCharacterIds", "missing_reference:" + targetId); } }); }
            if (!window.ArsDefinitionRegistry.hasDefinition("memory_type", record.memoryTypeId)) { addIssue(issues, recordPath + ".memoryTypeId", "unregistered_memory_type"); }
            if (!window.ArsDefinitionRegistry.hasDefinition("memory_decay_policy", record.decayPolicyId)) { addIssue(issues, recordPath + ".decayPolicyId", "unregistered_decay_policy"); }
            if (!validPersistentId(record.sourceEventId) || !Number.isInteger(record.eventDay) || record.eventDay < 0 || !Number.isInteger(record.importance) || record.importance < 0 || record.importance > 1000 || MEMORY_KNOWLEDGE.indexOf(record.knowledge) < 0 || MEMORY_STATUS.indexOf(record.status) < 0 || !strictPlain(record.payload) || !Number.isInteger(record.revision) || record.revision < 0) { addIssue(issues, recordPath, "invalid_memory_record"); }
            if (record.status === "unresolved") { if (record.resolution !== null) { addIssue(issues, recordPath + ".resolution", "invalid_resolution"); } }
            else if (!strictPlain(record.resolution) || record.resolution.status !== record.status || !Number.isInteger(record.resolution.decisionDay) || record.resolution.decisionDay < 0 || !validPersistentId(record.resolution.reasonId) || !validPersistentId(record.resolution.sourceEventId) || (record.status === "expired" && record.decayPolicyId === "permanent")) { addIssue(issues, recordPath + ".resolution", "invalid_resolution"); }
            if (!expected[record.ownerCharacterId]) { expected[record.ownerCharacterId] = []; } expected[record.ownerCharacterId].push(id);
        });
        Object.keys(expected).forEach(function (id) { expected[id].sort(); });
        if (!same(root.ownerIndex, expected)) { addIssue(issues, path + ".ownerIndex", "index_mismatch"); }
    }
    function validateActivityRoot(issues, world) {
        const root = world.npcActivityProfiles, path = "world.npcActivityProfiles";
        if (!strictPlain(root) || root.version !== 1 || !Number.isInteger(root.revision) || root.revision < 0 || !strictPlain(root.records)) { addIssue(issues, path, "invalid_root"); return; }
        Object.keys(root.records).sort().forEach(function (id) {
            const profile = root.records[id], recordPath = path + ".records." + id;
            if (!strictPlain(profile) || profile.characterId !== id || !world.characters[id]) { addIssue(issues, recordPath, "invalid_character_reference"); return; }
            if (ACTIVITY_TIERS.indexOf(profile.tier) < 0 || !Number.isInteger(profile.importanceScore) || profile.importanceScore < 0 || profile.importanceScore > 1000 || !Number.isInteger(profile.nextProcessDay) || profile.nextProcessDay < 0 || !Number.isInteger(profile.lastProcessedDay) || profile.lastProcessedDay < 0 || !Number.isInteger(profile.revision) || profile.revision < 0) { addIssue(issues, recordPath, "invalid_profile"); }
            if (!Array.isArray(profile.promotionReasonIds) || canonical(profile.promotionReasonIds) !== canonical(Array.from(new Set(profile.promotionReasonIds)).sort()) || !profile.promotionReasonIds.every(validPersistentId)) { addIssue(issues, recordPath + ".promotionReasonIds", "invalid_ids"); }
            if (!Array.isArray(profile.stableRoleKeys) || canonical(profile.stableRoleKeys) !== canonical(Array.from(new Set(profile.stableRoleKeys)).sort()) || !profile.stableRoleKeys.every(validPersistentId)) { addIssue(issues, recordPath + ".stableRoleKeys", "invalid_ids"); }
            if (profile.demotionEligibleDay !== null && (!Number.isInteger(profile.demotionEligibleDay) || profile.demotionEligibleDay < 0)) { addIssue(issues, recordPath + ".demotionEligibleDay", "invalid_day"); }
            if (profile.pinnedTierFloor !== null && ACTIVITY_FLOORS.indexOf(profile.pinnedTierFloor) < 0) { addIssue(issues, recordPath + ".pinnedTierFloor", "invalid_tier"); }
        });
    }
    const MIGRATION_STEP_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
    const MIGRATION_FINGERPRINT = /^sha256:[0-9a-f]{64}$/;
    const MIGRATION_REPORT_ID = /^m18-report:[0-9a-f]{64}$/;
    const MIGRATION_QUARANTINE_ID = /^m18-quarantine:[0-9a-f]{64}$/;
    const MIGRATION_RESULTS = Object.freeze(["MIGRATED", "DEFAULTED", "QUARANTINED", "IGNORED_ALREADY_MIGRATED", "FAILED"]);
    const MIGRATION_RAW_TYPES = Object.freeze(["null", "boolean", "number", "string", "array", "object"]);

    function validMigrationStepId(value) { return typeof value === "string" && MIGRATION_STEP_ID.test(value); }
    function validMigrationFingerprint(value) { return typeof value === "string" && MIGRATION_FINGERPRINT.test(value); }
    function validMigrationTimestamp(value) {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) { return false; }
        const parsed = Date.parse(value);
        if (!Number.isFinite(parsed)) { return false; }
        const expected = value.indexOf(".") >= 0 ? value : value.slice(0, -1) + ".000Z";
        return new Date(parsed).toISOString() === expected;
    }
    function migrationRawType(value) {
        if (value === null) { return "null"; }
        if (Array.isArray(value)) { return "array"; }
        return typeof value;
    }
    function validateWorldMigrationRoot(issues, migration) {
        const path = "world.migration";
        if (!strictPlain(migration)) { addIssue(issues, path, "invalid_migration_root"); return; }

        if (!Array.isArray(migration.completedSteps)) { addIssue(issues, path + ".completedSteps", "invalid_completed_steps"); }
        else {
            const seenSteps = Object.create(null);
            migration.completedSteps.forEach(function (stepId, index) {
                if (!validMigrationStepId(stepId)) { addIssue(issues, path + ".completedSteps[" + index + "]", "invalid_step_id"); return; }
                if (seenSteps[stepId]) { addIssue(issues, path + ".completedSteps", "duplicate_step_id:" + stepId); }
                seenSteps[stepId] = true;
            });
            const sortedSteps = migration.completedSteps.slice().sort();
            if (canonical(migration.completedSteps) !== canonical(sortedSteps)) { addIssue(issues, path + ".completedSteps", "noncanonical_order"); }
        }

        if (!strictPlain(migration.quarantinedLegacyValues)) { addIssue(issues, path + ".quarantinedLegacyValues", "invalid_quarantine_root"); }
        else {
            Object.keys(migration.quarantinedLegacyValues).sort().forEach(function (key) {
                const item = migration.quarantinedLegacyValues[key];
                const itemPath = path + ".quarantinedLegacyValues." + key;
                if (!MIGRATION_QUARANTINE_ID.test(key)) { addIssue(issues, itemPath, "invalid_quarantine_key"); }
                if (!strictPlain(item)) { addIssue(issues, itemPath, "invalid_quarantine_item"); return; }
                if (!validMigrationStepId(item.migrationId)) { addIssue(issues, itemPath, "invalid_migration_id"); }
                if (!nonEmptyString(item.sourceKey)) { addIssue(issues, itemPath, "invalid_source_key"); }
                if (!validMigrationFingerprint(item.sourceFingerprint)) { addIssue(issues, itemPath, "invalid_source_fingerprint"); }
                if (!nonEmptyString(item.sourcePath)) { addIssue(issues, itemPath, "invalid_source_path"); }
                if (!own(item, "rawValue")) { addIssue(issues, itemPath, "missing_raw_value"); }
                if (MIGRATION_RAW_TYPES.indexOf(item.rawType) < 0) { addIssue(issues, itemPath, "invalid_raw_type"); }
                else if (own(item, "rawValue") && migrationRawType(item.rawValue) !== item.rawType) { addIssue(issues, itemPath, "raw_type_mismatch"); }
                if (!validMigrationStepId(item.reasonCode)) { addIssue(issues, itemPath, "invalid_reason_code"); }
                if (!nonEmptyString(item.suggestedTargetPath)) { addIssue(issues, itemPath, "invalid_suggested_target_path"); }
                if (!validMigrationTimestamp(item.createdAt)) { addIssue(issues, itemPath, "invalid_created_at"); }
            });
        }

        if (!Array.isArray(migration.warnings)) { addIssue(issues, path + ".warnings", "invalid_warnings"); }

        if (!Array.isArray(migration.report)) { addIssue(issues, path + ".report", "invalid_report_root"); }
        else {
            const seenReportIds = Object.create(null);
            migration.report.forEach(function (item, index) {
                const itemPath = path + ".report[" + index + "]";
                if (!strictPlain(item)) { addIssue(issues, itemPath, "invalid_report_item"); return; }
                if (!MIGRATION_REPORT_ID.test(item.itemId)) { addIssue(issues, itemPath, "invalid_item_id"); }
                else {
                    if (seenReportIds[item.itemId]) { addIssue(issues, path + ".report", "duplicate_item_id:" + item.itemId); }
                    seenReportIds[item.itemId] = true;
                }
                if (!validMigrationStepId(item.migrationId)) { addIssue(issues, itemPath, "invalid_migration_id"); }
                if (!nonEmptyString(item.sourceKey)) { addIssue(issues, itemPath, "invalid_source_key"); }
                if (!validMigrationFingerprint(item.sourceFingerprint)) { addIssue(issues, itemPath, "invalid_source_fingerprint"); }
                if (!nonEmptyString(item.sourcePath)) { addIssue(issues, itemPath, "invalid_source_path"); }
                if (!nonEmptyString(item.targetPath)) { addIssue(issues, itemPath, "invalid_target_path"); }
                if (item.sourceValueSummary !== null && (!strictPlain(item.sourceValueSummary) || !nonEmptyString(item.sourceValueSummary.type))) { addIssue(issues, itemPath, "invalid_source_value_summary"); }
                if (MIGRATION_RESULTS.indexOf(item.result) < 0) { addIssue(issues, itemPath, "invalid_result"); }
                if (!validMigrationStepId(item.reasonCode)) { addIssue(issues, itemPath, "invalid_reason_code"); }
                if (!validMigrationTimestamp(item.createdAt)) { addIssue(issues, itemPath, "invalid_created_at"); }
            });
        }
    }
    function validateCanonicalPersistentRecords(gameStateSnapshot, options) {
        const issues = [];
        if (!strictPlain(gameStateSnapshot) || !strictPlain(gameStateSnapshot.world)) { return { ok: false, issues: ["gameState:invalid_root"] }; }
        const world = gameStateSnapshot.world;
        validateRecordMap(issues, world.characters, "world.characters", window.ArsCharacterState, "id");
        validateRecordMap(issues, world.mobileGroups, "world.mobileGroups", window.ArsMobileGroupState, "id");
        if (!strictPlain(world.finance)) { addIssue(issues, "world.finance", "invalid_root"); }
        else {
            validateRecordMap(issues, world.finance.accounts, "world.finance.accounts", window.ArsFinanceState, "id");
            validateDebtMap(issues, world);
            validateTransferMap(issues, world);
        }
        validateRecordMap(issues, world.inventories, "world.inventories", window.ArsInventoryState, "id");
        validateCustomDefinitions(issues, world);
        validateSettlementMap(issues, world);
        validateWorldMigrationRoot(issues, world.migration);
        validateRecordMap(issues, world.clans, "world.clans", window.ArsClanState, "id");
        validateRecordMap(issues, world.factions, "world.factions", window.ArsFactionState, "id");
        validateRecordMap(issues, world.titles, "world.titles", window.ArsTitleState, "id");
        validateRecordMap(issues, world.landRights, "world.landRights", window.ArsRightsState, "id");
        if (!strictPlain(gameStateSnapshot.playerControl)) { addIssue(issues, "playerControl", "invalid_record"); }
        else {
            if (!Number.isInteger(gameStateSnapshot.playerControl.version) || gameStateSnapshot.playerControl.version < 1 || gameStateSnapshot.playerControl.version > 1) { addIssue(issues, "playerControl", "unsupported_future_version"); }
            if (!Number.isInteger(gameStateSnapshot.playerControl.revision) || gameStateSnapshot.playerControl.revision < 0) { addIssue(issues, "playerControl", "invalid_revision"); }
            callPublicValidator(issues, "playerControl", window.ArsPlayerControlState, gameStateSnapshot.playerControl, { skipRefs: true });
        }
        validateDetachedReferences(issues, gameStateSnapshot);
        validateRelationshipRoot(issues, world);
        validateMemoryRoot(issues, world);
        validateActivityRoot(issues, world);
        if (!world.m1Followups && options && options.allowMissingFollowup === true) { /* bootstrap detached candidate adds the root later */ }
        else if (!world.m1Followups || !window.ArsM1FollowupState || typeof window.ArsM1FollowupState.validateDetached !== "function") { addIssue(issues, "world.m1Followups", "m18_save_invalid_followup_ledger"); }
        else {
            try { const result = window.ArsM1FollowupState.validateDetached(world.m1Followups, { verifyDigests: true }); if (!result || !result.ok) { addIssue(issues, "world.m1Followups", "m18_save_invalid_followup_ledger"); } }
            catch (error) { addIssue(issues, "world.m1Followups", "validator_exception:" + String(error && error.message || error)); }
        }
        const sorted = Array.from(new Set(issues)).sort();
        return { ok: sorted.length === 0, issues: sorted };
    }
    const persistentValidatorInstallResult = window.ArsGameState && typeof window.ArsGameState._installPersistentRecordValidator === "function"
        ? window.ArsGameState._installPersistentRecordValidator(PERSISTENT_VALIDATOR_ID, validateCanonicalPersistentRecords)
        : fail("m18_save_invalid_game_state", { issues: ["persistent_validator_install_api_unavailable"] });

    function normalizeEnvelope(snapshot, allowOptionalDefaults) {
        const detached = strictDetach(snapshot);
        if (!detached.ok) { return detached; }
        const x=detached.snapshot;
        if (!strictPlain(x)) { return fail("m18_save_invalid_envelope"); }
        const envelopeIssues=unexpectedFields(x,["schemaVersion","revision","saveId","createdAt","updatedAt","sourceBuild","payloadDigest","gameState","gameClock","simulationPreferences","migration"],"envelope");
        if (envelopeIssues.length) { return fail("m18_save_invalid_envelope",{issues:envelopeIssues}); }
        let needsResave=false;
        if (x.schemaVersion !== SCHEMA_VERSION) { return fail(x.schemaVersion > SCHEMA_VERSION ? "m18_save_future_schema" : "m18_save_invalid_envelope"); }
        if (!Number.isInteger(x.revision) || x.revision < 0) { return fail("m18_save_invalid_revision"); }
        if (x.saveId !== SAVE_ID) { return fail("m18_save_invalid_envelope"); }
        if (!validTimestamp(x.createdAt) || !validTimestamp(x.updatedAt)) { return fail("m18_save_invalid_timestamp"); }
        if (!own(x,"sourceBuild")) {
            if (!allowOptionalDefaults) { return fail("m18_save_invalid_envelope",{issues:["sourceBuild:missing"]}); }
            x.sourceBuild={packageVersion:null,sourceTreeSha256:null}; needsResave=true;
        }
        const build=validateBuildMetadata(x.sourceBuild);
        if (!build.ok) { return fail("m18_save_invalid_envelope", build.detail || {cause:build.error}); }
        x.sourceBuild=build.metadata;
        if (!own(x,"simulationPreferences")) {
            if (!allowOptionalDefaults) { return fail("m18_save_invalid_preferences",["missing_preferences"]); }
            x.simulationPreferences=clone(DEFAULT_PREFERENCES); needsResave=true;
        }
        const prefs=validatePreferences(x.simulationPreferences); if (!prefs.ok) { return prefs; }
        x.simulationPreferences=prefs.snapshot;
        if (!own(x,"migration")) {
            if (!allowOptionalDefaults) { return fail("m18_save_invalid_envelope",{issues:["migration:missing"]}); }
            x.migration={lastMigrationId:null,sourceFingerprints:{}}; needsResave=true;
        }
        const topMigrationCheck=validateTopMigration(x.migration,allowOptionalDefaults); if(!topMigrationCheck.ok){return topMigrationCheck;}
        x.migration=topMigrationCheck.normalizedMigration; needsResave=needsResave||topMigrationCheck.needsResave;
        if (strictPlain(x.gameState) && strictPlain(x.gameState.world) && strictPlain(x.gameState.world.migration)) {
            if (!own(x.gameState.world.migration,"warnings")) {
                if (!allowOptionalDefaults) { return fail("m18_save_invalid_game_state",{issues:["world.migration.warnings:missing"]}); }
                x.gameState.world.migration.warnings=[]; needsResave=true;
            }
            if (!own(x.gameState.world.migration,"report")) {
                if (!allowOptionalDefaults) { return fail("m18_save_invalid_game_state",{issues:["world.migration.report:missing"]}); }
                x.gameState.world.migration.report=[]; needsResave=true;
            }
        }
        const gs=window.ArsGameState.validatePersistent(x.gameState);
        if (!gs.ok) {
            if (gs.error === "m18_save_non_json_value") { return gs; }
            const issues=gs.detail&&Array.isArray(gs.detail.issues)?gs.detail.issues:[];
            if (issues.some(function(issue){return String(issue).indexOf("m18_save_invalid_followup_ledger")>=0;})) { return fail("m18_save_invalid_followup_ledger", { issues: issues }); }
            return fail("m18_save_invalid_game_state", { issues: issues });
        }
        x.gameState=gs.normalizedSnapshot;
        const gc=window.ArsGameClock.validatePersistent(x.gameClock); if (!gc.ok) { return fail("m18_save_invalid_game_clock", gc.errors); }
        x.gameClock=gc.snapshot;
        const expected=computePayloadDigest(x); if (x.payloadDigest !== expected) { return fail("m18_save_digest_mismatch", { expected:expected, actual:x.payloadDigest }); }
        const invariant=globalInvariant(x); if (!invariant.ok) { return invariant; }
        if (needsResave) { Object.defineProperty(x,"needsResave",{value:true,enumerable:false,configurable:false,writable:false}); }
        return ok({ normalizedSnapshot:x, payloadDigest:expected, binding:invariant.binding, needsResave:needsResave });
    }
    function validate(snapshot) { return normalizeEnvelope(snapshot, true); }

    function captureGameStateForBootstrap() {
        if (window.ArsGameState && typeof window.ArsGameState._capturePersistentForBootstrap === "function") { return window.ArsGameState._capturePersistentForBootstrap(); }
        return window.ArsGameState.capturePersistent();
    }

    function capturePreferences() {
        if (window.ArsSimulationTime && typeof window.ArsSimulationTime.capturePreferences === "function") { return window.ArsSimulationTime.capturePreferences(); }
        return clone(runtime.bootstrapPreferences);
    }
    function capture() {
        const gameStateResult=window.ArsGameState.capturePersistent();
        if (!gameStateResult || !gameStateResult.ok) { return gameStateResult || fail("m18_save_invalid_game_state"); }
        const envelope={
            schemaVersion:SCHEMA_VERSION,
            revision:runtime.currentRevision == null ? 0 : runtime.currentRevision,
            saveId:SAVE_ID,
            createdAt:runtime.bootstrapResult && runtime.bootstrapResult.createdAt || nowIso(),
            updatedAt:nowIso(),
            sourceBuild:clone(runtime.buildMetadata),
            payloadDigest:null,
            gameState:gameStateResult.snapshot,
            gameClock:window.ArsGameClock.capturePersistent(),
            simulationPreferences:capturePreferences(),
            migration:clone(topMigration)
        };
        envelope.payloadDigest=computePayloadDigest(envelope);
        const checked=validate(envelope); if (!checked.ok) { return checked; }
        return ok({ snapshot:checked.normalizedSnapshot,payloadDigest:checked.payloadDigest,currentRevision:runtime.currentRevision });
    }

    function verifyRaw(raw) {
        if (typeof raw !== "string") { return fail("m18_save_final_validation_failed"); }
        let parsed; try { parsed=JSON.parse(raw); } catch (error) { return fail("m18_save_final_validation_failed", "invalid_json"); }
        const checked=validate(parsed);
        if (!checked.ok) {
            const detail=checked.detail;
            const issues=Array.isArray(detail)?detail:(detail&&Array.isArray(detail.issues)?detail.issues:[]);
            return fail("m18_save_final_validation_failed", { cause: checked.error, issues: clone(issues) });
        }
        return ok({ raw:raw, snapshot:checked.normalizedSnapshot, revision:checked.normalizedSnapshot.revision, fingerprint:rawFingerprint(raw), binding:checked.binding });
    }
    function getFinalRawFingerprint() {
        let raw; try { raw=storageGet(FINAL_KEY); } catch (error) { return fail("m18_save_final_validation_failed", String(error)); }
        if (raw === null) { return ok({present:false,fingerprint:null,revision:null}); }
        const verified=verifyRaw(raw); if (!verified.ok) { return verified; }
        return ok({present:true,fingerprint:verified.fingerprint,revision:verified.revision});
    }

    function writeCandidate(candidate, previousRaw) {
        const raw=JSON.stringify(candidate), size=byteSize(raw);
        try {
            storageSet(STAGING_KEY,raw);
            const staging=storageGet(STAGING_KEY);
            if (staging !== raw) { throw new Error("staging_raw_mismatch"); }
            const stagingVerified=verifyRaw(staging); if (!stagingVerified.ok) { throw new Error(stagingVerified.error); }
            storageSet(FINAL_KEY,raw);
            const finalReadback=storageGet(FINAL_KEY);
            if (finalReadback !== raw) { throw new Error("final_raw_mismatch"); }
            const finalVerified=verifyRaw(finalReadback); if (!finalVerified.ok) { throw new Error(finalVerified.error); }
            runtime.currentRevision=finalVerified.revision;
            let warning=[];
            if (!cleanupStaging()) { warning=["m18_save_staging_cleanup_failed"]; }
            return ok({ raw:raw, serializedByteSize:size, revision:finalVerified.revision, payloadDigest:finalVerified.snapshot.payloadDigest, warnings:warning, cleanupRequired:runtime.cleanupRequired, binding:finalVerified.binding });
        } catch (error) {
            try {
                if (previousRaw === null) { storageRemove(FINAL_KEY); if (storageGet(FINAL_KEY)!==null) { throw new Error("remove_failed"); } }
                else { storageSet(FINAL_KEY,previousRaw); if (storageGet(FINAL_KEY)!==previousRaw || !verifyRaw(previousRaw).ok) { throw new Error("restore_mismatch"); } }
            } catch (restoreError) {
                runtime.fatalStorageLock=true;
                return fail("m18_save_final_restore_failed", { cause:String(error), restore:String(restoreError) });
            }
            cleanupStaging();
            return fail("m18_save_commit_failed", String(error && error.message || error));
        }
    }

    function saveInternal(expectedRevision) {
        if (runtime.fatalStorageLock) { return fail("m18_save_fatal_storage_lock"); }
        if (!storageAvailable()) { return fail("m18_save_storage_unavailable"); }
        cleanupStaging();
        const previousRaw=storageGet(FINAL_KEY);
        let previous=null;
        if (previousRaw !== null) { previous=verifyRaw(previousRaw); if (!previous.ok) { return previous; } }
        const verifiedRevision=previous ? previous.revision : null;
        if (expectedRevision !== verifiedRevision) { return fail("m18_save_revision_conflict", { expected:expectedRevision, actual:verifiedRevision }); }
        const captured=capture(); if (!captured.ok) { return captured; }
        const candidate=captured.snapshot;
        if (previous && previous.snapshot.payloadDigest===candidate.payloadDigest && same(previous.snapshot.sourceBuild,candidate.sourceBuild) && previous.snapshot.saveId===candidate.saveId && previous.snapshot.schemaVersion===candidate.schemaVersion) {
            runtime.currentRevision=previous.revision;
            return ok({ saveId:SAVE_ID,schemaVersion:SCHEMA_VERSION,previousRevision:previous.revision,revision:previous.revision,serializedByteSize:byteSize(previousRaw),migrationId:previous.snapshot.migration.lastMigrationId,payloadDigest:previous.snapshot.payloadDigest,idempotent:true,warnings:[],cleanupRequired:runtime.cleanupRequired });
        }
        const timestamp=nowIso();
        candidate.revision=previous ? previous.revision+1 : 0;
        candidate.createdAt=previous ? previous.snapshot.createdAt : timestamp;
        candidate.updatedAt=timestamp;
        candidate.payloadDigest=computePayloadDigest(candidate);
        const checked=validate(candidate); if (!checked.ok) { return checked; }
        const written=writeCandidate(checked.normalizedSnapshot,previousRaw); if (!written.ok) { return written; }
        return ok({ saveId:SAVE_ID,schemaVersion:SCHEMA_VERSION,previousRevision:verifiedRevision,revision:written.revision,serializedByteSize:written.serializedByteSize,migrationId:candidate.migration.lastMigrationId,payloadDigest:written.payloadDigest,idempotent:false,warnings:written.warnings,cleanupRequired:written.cleanupRequired });
    }
    function save(expectedRevision) { return withLock("saving",function () { return saveInternal(expectedRevision); }); }

    function captureRuntime() {
        const captured=window.ArsGameState && typeof window.ArsGameState._capturePersistentRawStrict === "function" ? window.ArsGameState._capturePersistentRawStrict() : captureGameStateForBootstrap();
        if (!captured || !captured.ok) { return captured || fail("m18_save_invalid_game_state"); }
        return ok({ snapshot:{ gameState:captured.snapshot,gameClock:window.ArsGameClock.capturePersistent(),simulationPreferences:capturePreferences(),player:clone(window.ArsGameState.getState().player),binding:window.ArsM1Compat&&window.ArsM1Compat.getBindingSnapshot?window.ArsM1Compat.getBindingSnapshot():null,currentRevision:runtime.currentRevision,bootstrapResult:clone(runtime.bootstrapResult),topMigration:clone(topMigration),clockRunning:window.ArsGameClock.getState().running } });
    }
    function restoreRuntime(before) {
        const hydrateGameState = !before.gameState.world.m1Followups && typeof window.ArsGameState._hydratePersistentForBootstrap === "function" ? window.ArsGameState._hydratePersistentForBootstrap : window.ArsGameState.hydratePersistent;
        const gs=hydrateGameState(before.gameState); if (!gs.ok) { return gs; }
        const gc=window.ArsGameClock.hydratePersistent(before.gameClock); if (!gc.ok) { return gc; }
        runtime.bootstrapPreferences=clone(before.simulationPreferences);
        if (window.ArsSimulationTime) { const pref=window.ArsSimulationTime.applyPreferences(before.simulationPreferences); if (!pref.ok) { return pref; } }
        topMigration=clone(before.topMigration); runtime.currentRevision=before.currentRevision; runtime.bootstrapResult=clone(before.bootstrapResult);
        if (before.binding) { window.ArsGameState.refreshDerivedPlayerMirror(before.binding); }
        if (before.clockRunning) { window.ArsGameClock.start(); }
        return ok();
    }
    function hydrateEnvelope(envelope, binding) {
        const gs=window.ArsGameState.hydratePersistent(envelope.gameState); if (!gs.ok) { return gs; }
        const gc=window.ArsGameClock.hydratePersistent(envelope.gameClock); if (!gc.ok) { return gc; }
        runtime.bootstrapPreferences=clone(envelope.simulationPreferences);
        if (window.ArsSimulationTime) { const pref=window.ArsSimulationTime.applyPreferences(envelope.simulationPreferences); if (!pref.ok) { return pref; } }
        topMigration=clone(envelope.migration);
        const mirror=window.ArsGameState.refreshDerivedPlayerMirror(binding); if (!mirror.ok) { return mirror; }
        if (window.ArsM1Compat) { const compat=window.ArsM1Compat.installPlayerCompatibility(binding); if (!compat.ok) { return compat; } }
        if (window.ArsM1Diagnostics) { const diag=window.ArsM1Diagnostics.run(); if (!diag.ok) { return fail("m18_save_global_invariant_failed",diag.issues); } }
        return ok();
    }

    function loadFinalRaw(raw, mode) {
        const verified=verifyRaw(raw); if (!verified.ok) { return verified; }
        const beforeResult=captureRuntime(); if(!beforeResult.ok){return beforeResult;} const before=beforeResult.snapshot;
        const hydrated=hydrateEnvelope(verified.snapshot,verified.binding);
        if (!hydrated.ok) { restoreRuntime(before); return hydrated; }
        if (before.clockRunning) { window.ArsGameClock.start(); }
        runtime.currentRevision=verified.revision;
        runtime.bootstrapResult=ok({mode:mode||"final",revision:verified.revision,payloadDigest:verified.snapshot.payloadDigest,binding:verified.binding,simulationPreferences:clone(verified.snapshot.simulationPreferences),createdAt:verified.snapshot.createdAt,needsResave:Boolean(verified.snapshot.needsResave)});
        return ok({revision:verified.revision,payloadDigest:verified.snapshot.payloadDigest,binding:verified.binding,needsResave:Boolean(verified.snapshot.needsResave)});
    }

    function captureLegacyRaw() {
        const entries=LEGACY_KEYS.map(function (key) {
            const raw=storageGet(key), present=raw!==null;
            return { key:key,raw:raw,present:present,byteSize:present?byteSize(raw):0,fingerprint:present?rawFingerprint(raw):digest([key,null]) };
        });
        const sourceFingerprints={}; entries.forEach(function (entry) { sourceFingerprints[entry.key]=entry.fingerprint; });
        return { capturedAt:nowIso(),entries:entries,sourceFingerprints:sourceFingerprints,aggregateFingerprint:digest(entries.map(function (entry) { return [entry.key,entry.fingerprint]; })) };
    }
    function normalizeRawInputs(rawInputs) {
        if (rawInputs && Array.isArray(rawInputs.entries)) { return clone(rawInputs); }
        const source=rawInputs||{}, entries=LEGACY_KEYS.map(function (key) { const raw=own(source,key)?source[key]:null; return {key:key,raw:raw,present:raw!==null,byteSize:raw===null?0:byteSize(raw),fingerprint:raw===null?digest([key,null]):rawFingerprint(raw)}; });
        const sourceFingerprints={}; entries.forEach(function (entry) { sourceFingerprints[entry.key]=entry.fingerprint; });
        return {capturedAt:nowIso(),entries:entries,sourceFingerprints:sourceFingerprints,aggregateFingerprint:digest(entries.map(function(entry){return[entry.key,entry.fingerprint];}))};
    }
    function rawByKey(capture,key) { const entry=capture.entries.find(function (item) { return item.key===key; }); return entry&&entry.raw; }
    function parseLegacy(capture) {
        const result={values:{},clock:{version:1,day:1,hour:8,minute:0,speed:1,realMsPerGameMinute:1000},preferences:clone(DEFAULT_PREFERENCES),quarantine:[],report:[]};
        const econRaw=rawByKey(capture,"ars_bellum_econ");
        if (econRaw!==null) {
            try { result.values=JSON.parse(econRaw); if (!plain(result.values)) { throw new Error("not_object"); } }
            catch (error) { result.values={}; result.quarantine.push({sourceKey:"ars_bellum_econ",sourcePath:"$",rawValue:econRaw,rawType:"string",reasonCode:"m18_migration_malformed_json"}); }
        }
        const clockRaw=rawByKey(capture,"ars_bellum_clock_v1");
        if (clockRaw!==null) {
            try {
                const x=JSON.parse(clockRaw); if (!plain(x)) { throw new Error("not_object"); }
                const fields={day:function(v){return Number.isInteger(v)&&v>=1;},hour:function(v){return Number.isInteger(v)&&v>=0&&v<=23;},minute:function(v){return Number.isInteger(v)&&v>=0&&v<=59;},speed:function(v){return [0,1,2,4,8].indexOf(v)>=0;},realMsPerGameMinute:function(v){return Number.isFinite(v)&&v>=50;}};
                Object.keys(fields).forEach(function (key) { if (fields[key](x[key])) { result.clock[key]=x[key]; } else { result.report.push({sourceKey:"ars_bellum_clock_v1",sourcePath:key,result:"DEFAULTED",reasonCode:"m18_migration_invalid_clock_field"}); } });
            } catch(error) { result.quarantine.push({sourceKey:"ars_bellum_clock_v1",sourcePath:"$",rawValue:clockRaw,rawType:"string",reasonCode:"m18_migration_malformed_json"}); }
        }
        const prefRaw=rawByKey(capture,"ars_bellum_simulation_time_v1");
        if (prefRaw!==null) {
            try {
                const x=JSON.parse(prefRaw); if (!plain(x)) { throw new Error("not_object"); }
                result.preferences.worldScale=[1,2,4,8].indexOf(x.worldScale)>=0?x.worldScale:1;
                result.preferences.battleScale=[0.25,0.5,1,2].indexOf(x.battleScale)>=0?x.battleScale:1;
                if (result.preferences.worldScale!==x.worldScale) { result.report.push({sourceKey:"ars_bellum_simulation_time_v1",sourcePath:"worldScale",result:"DEFAULTED",reasonCode:"m18_migration_invalid_preference"}); }
                if (result.preferences.battleScale!==x.battleScale) { result.report.push({sourceKey:"ars_bellum_simulation_time_v1",sourcePath:"battleScale",result:"DEFAULTED",reasonCode:"m18_migration_invalid_preference"}); }
            } catch(error) { result.quarantine.push({sourceKey:"ars_bellum_simulation_time_v1",sourcePath:"$",rawValue:prefRaw,rawType:"string",reasonCode:"m18_migration_malformed_json"}); }
        }
        return result;
    }

    function ensureMigrationRoot(world) {
        if (!plain(world.migration)) { world.migration={}; }
        if (!Array.isArray(world.migration.completedSteps)) { world.migration.completedSteps=[]; }
        if (!plain(world.migration.quarantinedLegacyValues)) { world.migration.quarantinedLegacyValues={}; }
        if (!Array.isArray(world.migration.warnings)) { world.migration.warnings=[]; }
        if (!Array.isArray(world.migration.report)) { world.migration.report=[]; }
        return world.migration;
    }
    function migrationTargetPath(sourceKey, sourcePath) {
        if (sourceKey === "ars_bellum_clock_v1") { return "gameClock." + (sourcePath || "$"); }
        if (sourceKey === "ars_bellum_simulation_time_v1") { return "simulationPreferences." + (sourcePath || "$"); }
        if (sourceKey === "ars_bellum_econ") { return "world.finance"; }
        if (sourceKey === "runtime_default") { return "world.mobileGroups"; }
        return "world.migration";
    }
    function reportItem(migrationId,capture,item,index) {
        const sourceFingerprint=capture.sourceFingerprints[item.sourceKey]||digest([item.sourceKey,null]);
        const base={migrationId:migrationId,sourceKey:item.sourceKey,sourceFingerprint:sourceFingerprint,sourcePath:item.sourcePath||"$",targetPath:item.targetPath||migrationTargetPath(item.sourceKey,item.sourcePath),sourceValueSummary:own(item,"sourceValueSummary")?item.sourceValueSummary:null,result:item.result,reasonCode:item.reasonCode,createdAt:capture.capturedAt};
        base.itemId="m18-report:"+sha(canonical([migrationId,index,base])); return base;
    }
    function quarantineItem(migrationId,capture,item,index) {
        const sourceFingerprint=capture.sourceFingerprints[item.sourceKey]||digest([item.sourceKey,null]);
        const base={migrationId:migrationId,sourceKey:item.sourceKey,sourceFingerprint:sourceFingerprint,sourcePath:item.sourcePath||"$",rawValue:clone(item.rawValue),rawType:item.rawType||migrationRawType(item.rawValue),reasonCode:item.reasonCode,suggestedTargetPath:item.suggestedTargetPath||migrationTargetPath(item.sourceKey,item.sourcePath),createdAt:capture.capturedAt};
        return {key:"m18-quarantine:"+sha(canonical([migrationId,index,base])),value:base};
    }
    function makeCanonicalGameState(values,migrationId,capture,parsed,newGame) {
        const currentResult=captureGameStateForBootstrap(); if(!currentResult.ok)return currentResult;
        const gameState=clone(currentResult.snapshot), world=gameState.world;
        ["characters","mobileGroups","inventories","finance"].forEach(function(key){if(!plain(world[key]))world[key]={};});
        if (!plain(world.finance.accounts)) { world.finance.accounts={}; }
        function empty(value) { return plain(value) && Object.keys(value).length === 0; }
        function ensureVersionOneRoot(key, fallback, requiredKeys) {
            const value=world[key];
            if (value == null || empty(value)) { world[key]=clone(fallback); return ok(); }
            if (!plain(value) || value.version !== 1 || requiredKeys.some(function (name) { return !own(value,name); })) { return fail("m18_save_invalid_game_state", "invalid_"+key+"_root"); }
            return ok();
        }
        let rootCheck=ensureVersionOneRoot("relationships",{version:1,revision:0,records:{},appliedEffects:{},indexes:{from:{},to:{}}},["revision","records","appliedEffects","indexes"]); if(!rootCheck.ok)return rootCheck;
        rootCheck=ensureVersionOneRoot("memories",{version:1,revision:0,records:{},ownerIndex:{}},["revision","records","ownerIndex"]); if(!rootCheck.ok)return rootCheck;
        rootCheck=ensureVersionOneRoot("npcActivityProfiles",{version:1,revision:0,records:{}},["revision","records"]); if(!rootCheck.ok)return rootCheck;
        if (world.m1Followups == null || empty(world.m1Followups)) { world.m1Followups=window.ArsM1FollowupState.createDefaultRoot(); }
        else { const followCheck=window.ArsM1FollowupState.validateDetached(world.m1Followups,{verifyDigests:true}); if(!followCheck.ok)return fail("m18_save_invalid_followup_ledger"); }

        const mirror=window.ArsGameState.getState().player;
        function validMetric(name,fallback,targetPath) {
            if (!own(values,name)) { return fallback; }
            if (isSafeNonNegative(values[name])) { parsed.report.push({sourceKey:"ars_bellum_econ",sourcePath:name,targetPath:targetPath,sourceValueSummary:{type:"number",value:values[name]},result:"MIGRATED",reasonCode:"m18_migration_"+name}); return values[name]; }
            parsed.quarantine.push({sourceKey:"ars_bellum_econ",sourcePath:name,rawValue:values[name],rawType:typeof values[name],reasonCode:"m18_migration_invalid_campaign_metric",suggestedTargetPath:targetPath}); return fallback;
        }
        const pc=plain(gameState.playerControl)?gameState.playerControl:{};
        let characterId=pc.currentCharacterId && world.characters[pc.currentCharacterId] ? pc.currentCharacterId : null;
        if(!characterId){characterId=Object.keys(world.characters).sort().find(function(id){return world.characters[id]&&world.characters[id].customData&&world.characters[id].customData.migrationIdentity==="legacy_player";})||null;}
        if(!characterId){characterId="legacy_player_character";if(world.characters[characterId])return fail("m18_save_global_invariant_failed","legacy_character_id_collision");}
        const existingCharacter=world.characters[characterId]||null;

        const groupIds=Object.keys(world.mobileGroups||{}).sort();
        let groupId=groupIds.sort(function(a,b){
            function score(id){const g=world.mobileGroups[id]||{};return [g.groupTypeId==="character_group"?1:0,g.legalCommanderRef&&g.legalCommanderRef.type==="character"&&g.legalCommanderRef.id===characterId?1:0,g.actingCommanderRef&&g.actingCommanderRef.type==="character"&&g.actingCommanderRef.id===characterId?1:0,Array.isArray(g.memberCharacterIds)&&g.memberCharacterIds.indexOf(characterId)>=0?1:0];}
            const sa=score(a),sb=score(b);for(let i=0;i<sa.length;i+=1){if(sa[i]!==sb[i])return sb[i]-sa[i];}return a<b?-1:a>b?1:0;
        })[0]||null;
        if(!groupId){groupId="legacy_player_group";if(world.mobileGroups[groupId])return fail("m18_save_global_invariant_failed","legacy_group_id_collision");}
        const existingGroup=world.mobileGroups[groupId]||null;

        let accountId=existingCharacter&&existingCharacter.personalAccountId&&world.finance.accounts[existingCharacter.personalAccountId]?existingCharacter.personalAccountId:null;
        if(!accountId){accountId=Object.keys(world.finance.accounts).sort().find(function(id){const a=world.finance.accounts[id];return a&&a.accountTypeId==="personal"&&a.ownerRef&&a.ownerRef.type==="character"&&a.ownerRef.id===characterId;})||null;}
        if(!accountId){accountId="legacy_player_personal_account";if(world.finance.accounts[accountId])return fail("m18_save_global_invariant_failed","legacy_account_id_collision");}
        const existingAccount=world.finance.accounts[accountId]||null;

        let inventoryId=existingGroup&&existingGroup.inventoryId&&world.inventories[existingGroup.inventoryId]?existingGroup.inventoryId:null;
        if(!inventoryId){inventoryId=Object.keys(world.inventories).sort().find(function(id){const inv=world.inventories[id];return inv&&inv.ownerRef&&inv.ownerRef.type==="mobile_group"&&inv.ownerRef.id===groupId;})||null;}
        if(!inventoryId){inventoryId="legacy_player_group_inventory";if(world.inventories[inventoryId])return fail("m18_save_global_invariant_failed","legacy_inventory_id_collision");}
        const existingInventory=world.inventories[inventoryId]||null;

        const gold=validMetric("gold",existingAccount?existingAccount.balance:Math.max(0,Math.floor(Number(mirror.economy.gold)||0)),"world.finance.accounts."+accountId+".balance");
        const food=validMetric("food",existingInventory?Number(existingInventory.bulkItems&&existingInventory.bulkItems.travel_rations)||0:Math.max(0,Math.floor(Number(mirror.economy.food)||0)),"world.inventories."+inventoryId+".bulkItems.travel_rations");
        const existingMetrics=existingAccount&&existingAccount.customData&&existingAccount.customData.m18CampaignMetrics;
        const manpower=validMetric("manpower",validateMetrics(existingMetrics)?existingMetrics.manpower:Math.max(0,Math.floor(Number(mirror.economy.manpower)||0)),"world.finance.accounts."+accountId+".customData.m18CampaignMetrics.manpower");
        const territory=validMetric("territory",validateMetrics(existingMetrics)?existingMetrics.territory:Math.max(0,Math.floor(Number(mirror.economy.territory)||0)),"world.finance.accounts."+accountId+".customData.m18CampaignMetrics.territory");

        const characterInput=Object.assign({},clone(existingCharacter||{}),{identity:Object.assign({name:mirror.name,birthDay:0,deathDay:null,alive:true},clone(existingCharacter&&existingCharacter.identity||{})),personalAccountId:accountId,location:Object.assign({},clone(existingCharacter&&existingCharacter.location||{}),{mode:"mobile_group",mobileGroupId:groupId})});
        if(!existingCharacter){characterInput.customData=Object.assign({},characterInput.customData||{},{migrationIdentity:"legacy_player"});}
        const character=window.ArsCharacterState.createDefault(characterId,characterInput);
        const accountCustom=Object.assign({},clone(existingAccount&&existingAccount.customData||{}),{m18CampaignMetrics:{version:1,manpower:manpower,territory:territory}});
        const account=window.ArsFinanceState.createDefault(Object.assign({},clone(existingAccount||{}),{id:accountId,accountTypeId:"personal",ownerRef:{type:"character",id:characterId},currencyId:"gold",balance:gold,customData:accountCustom}));
        const inventoryBulk=Object.assign({},clone(existingInventory&&existingInventory.bulkItems||{}),{travel_rations:food});
        const inventory=window.ArsInventoryState.createDefault(Object.assign({},clone(existingInventory||{}),{id:inventoryId,ownerRef:{type:"mobile_group",id:groupId},bulkItems:inventoryBulk}));
        const memberIds=Array.from(new Set((existingGroup&&existingGroup.memberCharacterIds||[]).concat([characterId]))).sort();
        const groupDefaults={id:groupId,name:mirror.name,groupTypeId:"character_group",legalOwnerRef:{type:"character",id:characterId},legalCommanderRef:{type:"character",id:characterId},actingCommanderRef:{type:"character",id:characterId},memberCharacterIds:memberIds,inventoryId:inventoryId,treasuryAccountId:null,worldPosition:{x:mirror.party.worldX,y:mirror.party.worldY},movement:{targetX:mirror.party.targetX,targetY:mirror.party.targetY,baseSpeed:mirror.party.speed,currentSpeed:mirror.party.speed,targetNode:mirror.party.targetNode}};
        const group=window.ArsMobileGroupState.createDefault(Object.assign({},groupDefaults,clone(existingGroup||{}),{id:groupId,memberCharacterIds:memberIds,inventoryId:inventoryId}));
        const playerControl=window.ArsPlayerControlState.createDefault(Object.assign({},clone(pc),{version:1,currentCharacterId:characterId,controlStatus:"active"}));
        if (window.ArsCharacterState.validate(character).length || window.ArsFinanceState.validate(account).length || window.ArsInventoryState.validate(inventory).length || window.ArsMobileGroupState.validate(group).length || window.ArsPlayerControlState.validate(playerControl,{skipRefs:true}).length) { return fail("m18_save_global_invariant_failed","bootstrap_entity_validation"); }
        world.characters[characterId]=character; world.finance.accounts[accountId]=account; world.inventories[inventoryId]=inventory; world.mobileGroups[groupId]=group; gameState.playerControl=playerControl;
        const migration=ensureMigrationRoot(world);
        if (migration.completedSteps.indexOf(migrationId)<0) { migration.completedSteps.push(migrationId); migration.completedSteps.sort(); }
        parsed.quarantine.forEach(function(item,index){const q=quarantineItem(migrationId,capture,item,index); if(!migration.quarantinedLegacyValues[q.key])migration.quarantinedLegacyValues[q.key]=q.value;});
        parsed.report.forEach(function(item,index){const r=reportItem(migrationId,capture,item,index); if(!migration.report.some(function(existing){return existing.itemId===r.itemId;}))migration.report.push(r);});
        if (!newGame && parsed.report.every(function(item){return item.sourcePath!=="position";})) { migration.report.push(reportItem(migrationId,capture,{sourceKey:"runtime_default",sourcePath:"position",targetPath:"world.mobileGroups."+groupId+".worldPosition",sourceValueSummary:null,result:"DEFAULTED",reasonCode:"m18_migration_position_defaulted"},parsed.report.length)); }
        return ok({gameState:gameState,binding:{characterId:characterId,groupId:groupId}});
    }
    function makeEnvelope(gameState,gameClock,preferences,migration,revision,createdAt,updatedAt) {
        const envelope={schemaVersion:1,revision:revision,saveId:SAVE_ID,createdAt:createdAt,updatedAt:updatedAt,sourceBuild:clone(runtime.buildMetadata),payloadDigest:null,gameState:gameState,gameClock:gameClock,simulationPreferences:preferences,migration:migration};
        envelope.payloadDigest=computePayloadDigest(envelope); return envelope;
    }
    function makePlan(capture, newGame) {
        const parsed=parseLegacy(capture), migrationId=newGame?"new_game_bootstrap_v1":"m18_legacy_import_v1:"+capture.aggregateFingerprint.slice(7);
        const canonicalState=makeCanonicalGameState(parsed.values,migrationId,capture,parsed,newGame); if(!canonicalState.ok)return canonicalState;
        const provenance={lastMigrationId:migrationId,sourceFingerprints:clone(capture.sourceFingerprints)};
        const createdAt=capture.capturedAt;
        const candidate=makeEnvelope(canonicalState.gameState,parsed.clock,parsed.preferences,provenance,0,createdAt,createdAt);
        const checked=validate(candidate); if(!checked.ok)return checked;
        const finalRaw=storageGet(FINAL_KEY), finalVerified=finalRaw===null?null:verifyRaw(finalRaw);
        const plan={schemaVersion:"m18.migration_plan.v1",migrationId:migrationId,createdAt:createdAt,sourceFingerprints:clone(capture.sourceFingerprints),aggregateFingerprint:capture.aggregateFingerprint,baseFinalRevision:finalVerified&&finalVerified.ok?finalVerified.revision:null,baseFinalRawFingerprint:finalRaw===null?null:rawFingerprint(finalRaw),baseRuntimeDigest:(function(){const c=captureGameStateForBootstrap();if(!c.ok){throw new Error(c.error);}return digest({gameState:c.snapshot,gameClock:window.ArsGameClock.capturePersistent(),simulationPreferences:capturePreferences()});})(),operations:[{type:newGame?"new_game_bootstrap":"legacy_import",binding:canonicalState.binding}],worldMigrationChanges:clone(canonicalState.gameState.world.migration),candidateEnvelope:checked.normalizedSnapshot,candidateDigest:digest(checked.normalizedSnapshot),rawCapture:clone(capture),binding:canonicalState.binding};
        return ok({plan:deepFreeze(clone(plan))});
    }
    function planLegacyMigration(rawInputs) { try { return makePlan(normalizeRawInputs(rawInputs),false); } catch(error){return fail("m18_migration_plan_failed",String(error));} }
    function validateRawCapture(value) {
        if (!plain(value) || !validTimestamp(value.capturedAt) || !Array.isArray(value.entries) || value.entries.length !== LEGACY_KEYS.length || !plain(value.sourceFingerprints)) { return false; }
        const computed={};
        for (let index=0; index<LEGACY_KEYS.length; index+=1) {
            const key=LEGACY_KEYS[index], entry=value.entries[index];
            if (!plain(entry) || entry.key!==key || entry.present!==(entry.raw!==null) || (entry.raw!==null&&typeof entry.raw!=="string")) { return false; }
            const expectedFingerprint=entry.raw===null?digest([key,null]):rawFingerprint(entry.raw);
            if (entry.byteSize!==(entry.raw===null?0:byteSize(entry.raw)) || entry.fingerprint!==expectedFingerprint) { return false; }
            computed[key]=expectedFingerprint;
        }
        return same(computed,value.sourceFingerprints) && value.aggregateFingerprint===digest(value.entries.map(function(entry){return[entry.key,entry.fingerprint];}));
    }
    function validateMigrationPlan(plan) {
        if (!plain(plan) || plan.schemaVersion!=="m18.migration_plan.v1" || !validTimestamp(plan.createdAt) || !validateRawCapture(plan.rawCapture)) { return fail("m18_migration_invalid_plan"); }
        if (!same(plan.sourceFingerprints,plan.rawCapture.sourceFingerprints) || plan.aggregateFingerprint!==plan.rawCapture.aggregateFingerprint) { return fail("m18_migration_invalid_plan"); }
        const expectedMigrationId=plan.operations&&plan.operations[0]&&plan.operations[0].type==="new_game_bootstrap"?"new_game_bootstrap_v1":"m18_legacy_import_v1:"+plan.aggregateFingerprint.slice(7);
        if (plan.migrationId!==expectedMigrationId || plan.candidateDigest!==digest(plan.candidateEnvelope)) { return fail("m18_migration_invalid_plan"); }
        const checked=validate(plan.candidateEnvelope); if(!checked.ok)return fail("m18_migration_invalid_plan",checked.error);
        const binding=resolveBinding(checked.normalizedSnapshot.gameState); if(!binding.ok)return fail("m18_migration_invalid_plan",binding.error);
        const expectedOperations=[{type:expectedMigrationId==="new_game_bootstrap_v1"?"new_game_bootstrap":"legacy_import",binding:binding.binding}];
        if (!same(plan.operations,expectedOperations) || !same(plan.binding,binding.binding) || !same(plan.worldMigrationChanges,checked.normalizedSnapshot.gameState.world.migration)) { return fail("m18_migration_invalid_plan"); }
        if (checked.normalizedSnapshot.migration.lastMigrationId!==plan.migrationId || !same(checked.normalizedSnapshot.migration.sourceFingerprints,plan.sourceFingerprints)) { return fail("m18_migration_invalid_plan"); }
        if (plan.baseFinalRevision!==null&&(!Number.isInteger(plan.baseFinalRevision)||plan.baseFinalRevision<0)) { return fail("m18_migration_invalid_plan"); }
        if (plan.baseFinalRawFingerprint!==null&&!/^sha256:[0-9a-f]{64}$/.test(plan.baseFinalRawFingerprint)) { return fail("m18_migration_invalid_plan"); }
        if (typeof plan.baseRuntimeDigest!=="string"||!/^sha256:[0-9a-f]{64}$/.test(plan.baseRuntimeDigest)) { return fail("m18_migration_invalid_plan"); }
        return ok({checked:checked,binding:binding.binding});
    }

    function commitMigrationInternal(plan, alreadyLocked) {
        if (runtime.fatalStorageLock) { return fail("m18_save_fatal_storage_lock"); }
        let planCheck; try { planCheck=validateMigrationPlan(plan); } catch(error) { return fail("m18_migration_invalid_plan",String(error&&error.message||error)); }
        if(!planCheck.ok)return planCheck;
        const currentCapture=captureLegacyRaw();
        const finalRaw=storageGet(FINAL_KEY);
        if (finalRaw !== null) {
            const existing = verifyRaw(finalRaw);
            if (existing.ok && existing.snapshot.migration.lastMigrationId === plan.migrationId && same(existing.snapshot.migration.sourceFingerprints, plan.sourceFingerprints)) {
                runtime.currentRevision = existing.revision;
                return ok({ idempotent: true, revision: existing.revision, migrationId: plan.migrationId, payloadDigest: existing.snapshot.payloadDigest });
            }
        }
        const currentGameState=captureGameStateForBootstrap(); if(!currentGameState.ok)return currentGameState;
        const runtimeDigest=digest({gameState:currentGameState.snapshot,gameClock:window.ArsGameClock.capturePersistent(),simulationPreferences:capturePreferences()});
        const exactLegacyRaw=currentCapture.entries.every(function(entry,index){return entry.key===plan.rawCapture.entries[index].key&&entry.raw===plan.rawCapture.entries[index].raw;});
        const currentFinalVerified=finalRaw===null?null:verifyRaw(finalRaw);
        const currentFinalRevision=currentFinalVerified&&currentFinalVerified.ok?currentFinalVerified.revision:null;
        if (!exactLegacyRaw || !same(currentCapture.sourceFingerprints,plan.sourceFingerprints) || currentCapture.aggregateFingerprint!==plan.aggregateFingerprint || (finalRaw===null?null:rawFingerprint(finalRaw))!==plan.baseFinalRawFingerprint || currentFinalRevision!==plan.baseFinalRevision || runtimeDigest!==plan.baseRuntimeDigest || plan.baseFinalRawFingerprint!==null) { return fail("m18_migration_source_changed"); }
        const checked=planCheck.checked;
        const beforeRuntimeResult=captureRuntime(); if(!beforeRuntimeResult.ok)return beforeRuntimeResult; const beforeRuntime=beforeRuntimeResult.snapshot;
        const written=writeCandidate(checked.normalizedSnapshot,finalRaw); if(!written.ok)return written;
        const hydrated=hydrateEnvelope(checked.normalizedSnapshot,plan.binding);
        if(!hydrated.ok){
            const restored=restoreRuntime(beforeRuntime);
            try{if(finalRaw===null)storageRemove(FINAL_KEY);else storageSet(FINAL_KEY,finalRaw);}catch(error){runtime.fatalStorageLock=true;return fail("m18_migration_restore_failed",String(error));}
            return restored.ok?hydrated:fail("m18_migration_restore_failed",restored.error);
        }
        runtime.currentRevision=checked.normalizedSnapshot.revision; topMigration=clone(checked.normalizedSnapshot.migration);
        return ok({migrationId:plan.migrationId,revision:runtime.currentRevision,payloadDigest:checked.normalizedSnapshot.payloadDigest,idempotent:false,warnings:written.warnings,cleanupRequired:written.cleanupRequired,binding:plan.binding});
    }
    function commitMigration(plan) { return withLock("migrating",function(){return commitMigrationInternal(plan,false);}); }

    function loadInternal() {
        const follow=window.ArsM1FollowupSystem.getRuntimeStatus(); if(follow.drainActive)return fail("m18_save_followup_busy");
        if(runtime.transactionPending)return fail("m18_save_transaction_busy");
        cleanupStaging();
        const raw=storageGet(FINAL_KEY);
        if(raw!==null)return loadFinalRaw(raw,"final");
        const legacy=captureLegacyRaw(), any=legacy.entries.some(function(entry){return entry.present;});
        const planned=makePlan(legacy,!any); if(!planned.ok)return planned;
        return commitMigrationInternal(planned.plan,true);
    }
    function load() { return withLock("loading",loadInternal); }

    function bootstrap() {
        if(runtime.state!=="idle")return fail("m18_save_runtime_busy");
        const beforeResult=captureRuntime();
        if(!beforeResult.ok){runtime.bootstrapResult=fail("m18_save_bootstrap_failed",beforeResult.error);return clone(runtime.bootstrapResult);}
        const before=beforeResult.snapshot, beforeFinal=storageGet(FINAL_KEY), beforeStaging=storageGet(STAGING_KEY);
        setLock("booting");
        try {
            cleanupStaging();
            let result;
            const finalRaw=storageGet(FINAL_KEY);
            if(finalRaw!==null){result=loadFinalRaw(finalRaw,"final");}
            else{
                const legacy=captureLegacyRaw(), any=legacy.entries.some(function(entry){return entry.present;});
                const plan=makePlan(legacy,!any); if(!plan.ok)return plan;
                setLock(any?"migrating":"booting"); result=commitMigrationInternal(plan.plan,true); setLock("booting");
                if(result.ok){runtime.bootstrapResult=ok({mode:any?"legacy_migration":"new_game",revision:result.revision,payloadDigest:result.payloadDigest,binding:result.binding,simulationPreferences:clone(plan.plan.candidateEnvelope.simulationPreferences),createdAt:plan.plan.candidateEnvelope.createdAt});}
            }
            if(!result.ok)throw new Error(result.error+":"+String(result.detail||""));
            const initialized=window.ArsM1FollowupSystem.initialize(); if(!initialized.ok)throw new Error(initialized.error);
            if(!runtime.bootstrapResult){const verified=verifyRaw(storageGet(FINAL_KEY));runtime.bootstrapResult=ok({mode:"final",revision:verified.revision,payloadDigest:verified.snapshot.payloadDigest,binding:verified.binding,simulationPreferences:clone(verified.snapshot.simulationPreferences),createdAt:verified.snapshot.createdAt,needsResave:Boolean(verified.snapshot.needsResave)});}
            runtime.currentRevision=runtime.bootstrapResult.revision;
            return clone(runtime.bootstrapResult);
        } catch(error){
            restoreRuntime(before);
            try{if(beforeFinal===null)storageRemove(FINAL_KEY);else storageSet(FINAL_KEY,beforeFinal);if(beforeStaging===null)storageRemove(STAGING_KEY);else storageSet(STAGING_KEY,beforeStaging);}catch(restoreError){runtime.fatalStorageLock=true;}
            runtime.bootstrapResult=fail("m18_save_bootstrap_failed",String(error&&error.message||error));
            return clone(runtime.bootstrapResult);
        } finally { setLock("idle"); }
    }

    function setBuildMetadata(metadata) {
        const checked=validateBuildMetadata(metadata); if(!checked.ok)return checked;
        if(runtime.buildMetadataSet&&!same(runtime.buildMetadata,checked.metadata))return fail("m18_save_build_metadata_conflict");
        const idempotent=runtime.buildMetadataSet; runtime.buildMetadata=checked.metadata; runtime.buildMetadataSet=true; return ok({metadata:clone(runtime.buildMetadata),idempotent:idempotent});
    }
    function getBuildMetadata(){return clone(runtime.buildMetadata);}
    function getRuntimeStatus(){return clone({state:runtime.state,fatalStorageLock:runtime.fatalStorageLock,transactionFatalLock:runtime.transactionFatalLock,currentRevision:runtime.currentRevision,cleanupRequired:runtime.cleanupRequired,transactionPending:runtime.transactionPending});}
    function getBootstrapResult(){return clone(runtime.bootstrapResult);}
    function getCurrentRevision(){return runtime.currentRevision;}
    function recordCompatFailure(value){runtime.compatFailure=clone(value);}

    function privateSaveSameOwner(expectedRevision) { return saveInternal(expectedRevision); }
    function runEconomyTransaction(input) {
        if(runtime.state!=="idle")return fail("m18_save_runtime_busy");
        if(runtime.transactionFatalLock)return fail("m18_save_transaction_fatal_lock");
        const p=input||{}; if(p.expectedSaveRevision!==runtime.currentRevision)return fail("m18_save_revision_conflict");
        if(p.sessionRollback!==undefined&&!plain(p.sessionRollback))return fail("m18_save_invalid_transaction");
        const binding=runtime.bootstrapResult&&runtime.bootstrapResult.binding; if(!binding)return fail("m18_save_compat_binding_missing");
        const character=window.ArsCharacterState.getSnapshot(binding.characterId),group=window.ArsMobileGroupState.getSnapshot(binding.groupId);
        const account=character&&window.ArsFinanceState._getCanonicalSnapshot(character.personalAccountId),inventory=group&&window.ArsInventoryState.getSnapshot(group.inventoryId);
        if(!account||!inventory)return fail("m18_save_global_invariant_failed","missing_transaction_assets");
        runtime.transactionPending=true; setLock("transaction");
        const beforeAccount=clone(account),beforeInventory=clone(inventory),beforeRaw=storageGet(FINAL_KEY),beforeFingerprint=beforeRaw===null?null:rawFingerprint(beforeRaw);
        let changedAccount=false,changedInventory=false,transactionId=null;
        function rollbackChanged() {
            const failures=[];
            if(changedInventory){const r=window.ArsInventoryState._atomicRestore(inventory.id,beforeInventory);if(!r||!r.ok)failures.push("inventory_restore");}
            if(changedAccount){const r=window.ArsFinanceState._atomicRestore(account.id,beforeAccount);if(!r||!r.ok)failures.push("account_restore");}
            try{
                if(changedAccount&&canonical(window.ArsFinanceState._getCanonicalSnapshot(account.id))!==canonical(beforeAccount))failures.push("account_verify");
                if(changedInventory&&canonical(window.ArsInventoryState.getSnapshot(inventory.id))!==canonical(beforeInventory))failures.push("inventory_verify");
                const raw=storageGet(FINAL_KEY),fingerprint=raw===null?null:rawFingerprint(raw);if(fingerprint!==beforeFingerprint)failures.push("final_fingerprint");
            }catch(error){failures.push("rollback_verify_exception");}
            if(failures.length){runtime.transactionFatalLock=true;return fail("m18_save_transaction_rollback_failed",{transactionId:transactionId,failures:failures});}
            return ok({rolledBack:true,transactionId:transactionId});
        }
        try{
            runtime.transactionSequence+=1;
            transactionId="m18-economy:"+String(p.kind||"unknown")+":"+runtime.transactionSequence+":"+sha(canonical([p.kind,runtime.transactionSequence,account.id,inventory.id,nowIso()])).slice(0,12);
            const operations=[];
            if(p.kind==="diplomacy"){
                if(!Number.isSafeInteger(p.goldDelta)||p.goldDelta>0||!Number.isSafeInteger(p.foodDelta)||p.foodDelta>0)return fail("m18_save_invalid_transaction");
                if(p.goldDelta!==0)operations.push({operationId:"m18-diplomacy-account",domainId:"account",command:"account.adjust_balance",targetRef:{type:"account",id:account.id},expectedRevision:account.revision,payload:{delta:p.goldDelta,lastTransactionId:transactionId},metadata:{}});
                if(p.foodDelta!==0)operations.push({operationId:"m18-diplomacy-food",domainId:"inventory",command:"inventory.transfer_items",targetRef:{type:"inventory",id:inventory.id},expectedRevision:inventory.revision,payload:{remove:{bulkItems:{travel_rations:Math.abs(p.foodDelta)}},add:{}},metadata:{}});
            }else if(p.kind==="battle_victory"){
                if(!isSafeNonNegative(p.goldDelta)||!isSafeNonNegative(p.manpowerDelta)||!isSafeNonNegative(p.territoryDelta))return fail("m18_save_invalid_transaction");
                if(p.goldDelta===0&&p.manpowerDelta===0&&p.territoryDelta===0)return fail("m18_save_no_change");
                const next=clone(account),metrics=clone(account.customData&&account.customData.m18CampaignMetrics||{version:1,manpower:0,territory:0});
                next.balance+=p.goldDelta; next.lastTransactionId=transactionId; next.customData=clone(next.customData||{}); next.customData.m18CampaignMetrics={version:1,manpower:metrics.manpower+p.manpowerDelta,territory:metrics.territory+p.territoryDelta};
                operations.push({operationId:"m18-battle-account",domainId:"account",command:"account.replace",targetRef:{type:"account",id:account.id},expectedRevision:account.revision,payload:{nextValue:next},metadata:{}});
            }else return fail("m18_save_invalid_transaction");
            if(!operations.length)return fail("m18_save_no_change");
            const plan={transactionId:transactionId,context:{source:p.kind==="diplomacy"?"m18.diplomacy":"m18.battle_victory"},operations:operations};
            const receipt=window.ArsM1AtomicCoordinator.execute(plan); if(!receipt.ok)return receipt;
            changedAccount=operations.some(function(operation){return operation.domainId==="account";});changedInventory=operations.some(function(operation){return operation.domainId==="inventory";});
            const expectedDomains=Array.from(new Set(operations.map(function(operation){return operation.domainId;}))).sort();
            if(receipt.transactionId!==transactionId||typeof receipt.digest!=="string"||!receipt.value||canonical(receipt.value.domains)!==canonical(expectedDomains)){
                const rolled=rollbackChanged();return rolled.ok?fail("m18_save_transaction_verification_failed",{transactionId:transactionId}):rolled;
            }
            const afterAccount=window.ArsFinanceState._getCanonicalSnapshot(account.id),afterInventory=window.ArsInventoryState.getSnapshot(inventory.id);
            let stateValid=true;
            if(p.kind==="diplomacy"){
                if(p.goldDelta!==0)stateValid=stateValid&&afterAccount.balance===beforeAccount.balance+p.goldDelta&&afterAccount.lastTransactionId===transactionId;
                if(p.foodDelta!==0)stateValid=stateValid&&Number(afterInventory.bulkItems&&afterInventory.bulkItems.travel_rations||0)===Number(beforeInventory.bulkItems&&beforeInventory.bulkItems.travel_rations||0)-Math.abs(p.foodDelta);
            }else{
                const beforeMetrics=beforeAccount.customData.m18CampaignMetrics,afterMetrics=afterAccount.customData&&afterAccount.customData.m18CampaignMetrics;
                stateValid=afterAccount.balance===beforeAccount.balance+p.goldDelta&&afterAccount.lastTransactionId===transactionId&&afterMetrics&&afterMetrics.manpower===beforeMetrics.manpower+p.manpowerDelta&&afterMetrics.territory===beforeMetrics.territory+p.territoryDelta;
            }
            if(!stateValid){const rolled=rollbackChanged();return rolled.ok?fail("m18_save_transaction_verification_failed",{transactionId:transactionId}):rolled;}
            const saved=privateSaveSameOwner(p.expectedSaveRevision);
            if(!saved.ok){const rolled=rollbackChanged();return rolled.ok?fail(saved.error,{rolledBack:true,transactionId:transactionId}):rolled;}
            window.ArsGameState.refreshDerivedPlayerMirror(binding);
            return ok({transactionId:transactionId,coordinatorReceipt:receipt,saveReceipt:saved,plan:clone(plan),sessionRollback:clone(p.sessionRollback||{})});
        }catch(error){
            const rolled=(changedAccount||changedInventory)?rollbackChanged():ok({rolledBack:false});
            if(!rolled.ok)return rolled;
            return fail("m18_save_transaction_failed",String(error&&error.message||error));
        }finally{runtime.transactionPending=false;setLock("idle");}
    }

    window.ArsSaveService=Object.freeze({
        FINAL_KEY:FINAL_KEY,STAGING_KEY:STAGING_KEY,
        setBuildMetadata:setBuildMetadata,getBuildMetadata:getBuildMetadata,capture:capture,validate:validate,save:save,load:load,
        planLegacyMigration:planLegacyMigration,commitMigration:commitMigration,getCurrentRevision:getCurrentRevision,getFinalRawFingerprint:getFinalRawFingerprint,getBootstrapResult:getBootstrapResult,getRuntimeStatus:getRuntimeStatus,runEconomyTransaction:runEconomyTransaction,
        _recordCompatFailure:recordCompatFailure,_captureLegacyRaw:captureLegacyRaw,_getLockTransitions:function(){return clone(runtime.lockTransitions);}
    });

    const bootstrapResult=persistentValidatorInstallResult && persistentValidatorInstallResult.ok ? bootstrap() : fail("m18_save_bootstrap_failed", persistentValidatorInstallResult && persistentValidatorInstallResult.error || "m18_save_invalid_game_state");
    if(!bootstrapResult.ok){console.error("[Ars Bellum] M1-8 bootstrap failed:",bootstrapResult.error,bootstrapResult.detail||"");}
})();
