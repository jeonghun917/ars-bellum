// Ars Bellum M1-8 - Unified save and M1 global diagnostics.
(function () {
    "use strict";
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function canonical(value) { return window.ArsM1AtomicCoordinator._canonicalStringify(value); }
    function sha(value) { return "sha256:" + window.ArsM1AtomicCoordinator._sha256(value); }
    function unique(values) { return Array.from(new Set(values)).sort(); }

    function runSaveDiagnostics() {
        const issues = [];
        const status = window.ArsSaveService.getRuntimeStatus();
        const finalFingerprint = window.ArsSaveService.getFinalRawFingerprint();
        let stagingPresent = false;
        const legacy = {};
        try {
            stagingPresent = localStorage.getItem(window.ArsSaveService.STAGING_KEY) !== null;
            ["ars_bellum_econ", "ars_bellum_clock_v1", "ars_bellum_simulation_time_v1"].forEach(function (key) {
                const raw = localStorage.getItem(key);
                legacy[key] = { present: raw !== null, fingerprint: raw === null ? null : sha(raw) };
            });
        } catch (error) { issues.push("storage_access_failed"); }
        if (!finalFingerprint.ok) { issues.push(finalFingerprint.error); }
        if (status.cleanupRequired !== stagingPresent) { issues.push("cleanup_status_mismatch"); }
        if (["idle", "booting", "saving", "loading", "migrating", "transaction"].indexOf(status.state) < 0) { issues.push("invalid_runtime_lock_state"); }
        return {
            ok: issues.length === 0,
            issues: unique(issues),
            runtimeStatus: status,
            final: finalFingerprint,
            stagingPresent: stagingPresent,
            stagingAutoPromoted: false,
            legacy: legacy,
            buildMetadata: window.ArsSaveService.getBuildMetadata(),
            bootstrapResult: window.ArsSaveService.getBootstrapResult()
        };
    }

    function appendValidationFailure(issues, result) {
        if (!result) { issues.push("m18_save_invalid_game_state"); return; }
        const detail = result.detail || {};
        if (detail.path) { issues.push(result.error + ":" + detail.path); }
        else { issues.push(result.error); }
        if (Array.isArray(detail.issues)) { detail.issues.forEach(function (issue) { issues.push(String(issue)); }); }
        else if (Array.isArray(result.errors)) { result.errors.forEach(function (issue) { issues.push(String(issue)); }); }
    }

    function runM1Diagnostics() {
        const issues = [];
        const stateCapture = window.ArsGameState.capturePersistent();
        if (!stateCapture || !stateCapture.ok) {
            appendValidationFailure(issues, stateCapture);
            return {
                ok: false,
                issues: unique(issues),
                binding: null,
                followupRuntime: window.ArsM1FollowupSystem.getRuntimeStatus(),
                persistentDigest: null,
                envelopeDigest: null,
                metricOwnerCount: null
            };
        }
        const snapshot = stateCapture.snapshot;
        const world = snapshot.world || {};
        const pc = snapshot.playerControl || {};
        const captured = window.ArsSaveService.capture();
        if (!captured.ok) { appendValidationFailure(issues, captured); }
        else {
            const validation = window.ArsSaveService.validate(captured.snapshot);
            if (!validation.ok) { appendValidationFailure(issues, validation); }
        }
        if (Object.prototype.hasOwnProperty.call(snapshot, "player")) { issues.push("persistent_player_mirror"); }
        if (Object.prototype.hasOwnProperty.call(snapshot, "runtime")) { issues.push("persistent_runtime"); }
        if (Object.prototype.hasOwnProperty.call(world, "clock")) { issues.push("persistent_world_clock"); }
        const character = pc.currentCharacterId && world.characters && world.characters[pc.currentCharacterId];
        let group = null, account = null, inventory = null;
        if (!character) { issues.push("missing_player_character"); }
        else {
            account = world.finance && world.finance.accounts && world.finance.accounts[character.personalAccountId];
            if (!account) { issues.push("missing_personal_account"); }
            const groupId = character.location && character.location.mobileGroupId;
            group = world.mobileGroups && world.mobileGroups[groupId];
            if (!group) { issues.push("missing_player_group"); }
        }
        if (group) {
            inventory = world.inventories && world.inventories[group.inventoryId];
            if (!inventory) { issues.push("missing_group_inventory"); }
        }
        let metricOwnerCount = 0;
        Object.keys(world.finance && world.finance.accounts || {}).forEach(function (id) {
            const value = world.finance.accounts[id];
            if (value.customData && Object.prototype.hasOwnProperty.call(value.customData, "m18CampaignMetrics")) {
                metricOwnerCount += 1;
                const metrics = value.customData.m18CampaignMetrics;
                if (!metrics || metrics.version !== 1 || !Number.isSafeInteger(metrics.manpower) || metrics.manpower < 0 || !Number.isSafeInteger(metrics.territory) || metrics.territory < 0 || Object.keys(metrics).sort().join(",") !== "manpower,territory,version") { issues.push("invalid_campaign_metrics"); }
                if (!account || id !== account.id) { issues.push("duplicate_campaign_metric_owner"); }
            }
        });
        if (metricOwnerCount !== 1) { issues.push("campaign_metric_owner_count"); }
        if (account && (!character || account.ownerRef.type !== "character" || account.ownerRef.id !== character.id)) { issues.push("invalid_account_owner"); }
        if (inventory && group && (inventory.ownerRef.type !== "mobile_group" || inventory.ownerRef.id !== group.id)) { issues.push("invalid_inventory_owner"); }
        const followRuntime = window.ArsM1FollowupSystem.getRuntimeStatus();
        if (followRuntime.initialized && (followRuntime.coordinatorListenerCount !== 6 || followRuntime.clockListenerCount !== 1)) { issues.push("followup_listener_count"); }
        if (captured.ok) {
            const topMigration = captured.snapshot.migration || {};
            if (Object.keys(topMigration).sort().join(",") !== "lastMigrationId,sourceFingerprints") { issues.push("top_migration_responsibility"); }
            const worldMigration = captured.snapshot.gameState.world.migration || {};
            if (!Array.isArray(worldMigration.completedSteps) || !worldMigration.quarantinedLegacyValues || !Array.isArray(worldMigration.warnings) || !Array.isArray(worldMigration.report)) { issues.push("world_migration_responsibility"); }
        }
        return {
            ok: issues.length === 0,
            issues: unique(issues),
            binding: character && group ? { characterId: character.id, groupId: group.id } : null,
            followupRuntime: followRuntime,
            persistentDigest: sha(canonical(snapshot)),
            envelopeDigest: captured.ok ? captured.payloadDigest : null,
            metricOwnerCount: metricOwnerCount
        };
    }

    window.ArsSaveDiagnostics = Object.freeze({ run: runSaveDiagnostics });
    window.ArsM1Diagnostics = Object.freeze({ run: runM1Diagnostics });
})();
