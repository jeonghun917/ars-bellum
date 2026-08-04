// Ars Bellum M1-7 - NPC activity profiles and deterministic scheduler bookkeeping
(function () {
    "use strict";

    const VERSION = 1;
    const TIERS = Object.freeze(["active_major", "active_named", "inactive_named", "historical"]);
    const TIER_RANK = Object.freeze({ historical: 0, inactive_named: 1, active_named: 2, active_major: 3 });
    const INTERVAL = Object.freeze({ active_major: 1, active_named: 7, inactive_named: 30 });
    let initializationError = null;

    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
    function validId(value) { return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value); }
    function canonical(value) { return window.ArsM1AtomicCoordinator._canonicalStringify(value); }
    function world() { return window.ArsGameState.getState().world; }
    function root() { return world().npcActivityProfiles; }
    function emptyRoot() { return { version: VERSION, revision: 0, records: {} }; }
    function isEmptyObject(value) { return plain(value) && Object.keys(value).length === 0; }
    function fail(error, detail) { return { ok: false, error: error, detail: detail == null ? null : clone(detail) }; }
    function success(value) { return Object.assign({ ok: true }, value || {}); }
    function sortedUnique(values) { return Array.from(new Set((Array.isArray(values) ? values : []).filter(validId))).sort(); }

    function defaultProfile(characterId) {
        return {
            characterId: characterId,
            tier: "active_named",
            importanceScore: 0,
            nextProcessDay: 1,
            lastProcessedDay: 0,
            promotionReasonIds: [],
            stableRoleKeys: [],
            demotionEligibleDay: null,
            pinnedTierFloor: null,
            revision: 0
        };
    }
    function validateProfile(profile, id) {
        if (!plain(profile) || profile.characterId !== id || !window.ArsCharacterState.getSnapshot(id)) { return false; }
        if (TIERS.indexOf(profile.tier) < 0 || !Number.isInteger(profile.importanceScore) || profile.importanceScore < 0 || profile.importanceScore > 1000) { return false; }
        if (!Number.isInteger(profile.nextProcessDay) || profile.nextProcessDay < 0 || !Number.isInteger(profile.lastProcessedDay) || profile.lastProcessedDay < 0) { return false; }
        if (!Array.isArray(profile.promotionReasonIds) || canonical(profile.promotionReasonIds) !== canonical(sortedUnique(profile.promotionReasonIds))) { return false; }
        if (!Array.isArray(profile.stableRoleKeys) || canonical(profile.stableRoleKeys) !== canonical(sortedUnique(profile.stableRoleKeys))) { return false; }
        if (profile.demotionEligibleDay !== null && (!Number.isInteger(profile.demotionEligibleDay) || profile.demotionEligibleDay < 0)) { return false; }
        if (profile.pinnedTierFloor !== null && ["active_major", "active_named", "inactive_named"].indexOf(profile.pinnedTierFloor) < 0) { return false; }
        return Number.isInteger(profile.revision) && profile.revision >= 0;
    }
    function validateRoot(value) {
        if (!plain(value) || value.version !== VERSION || !Number.isInteger(value.revision) || value.revision < 0 || !plain(value.records)) { return false; }
        return Object.keys(value.records).every(function (id) { return validateProfile(value.records[id], id); });
    }
    function ensureRoot() {
        const existing = root();
        if (existing == null || isEmptyObject(existing)) {
            world().npcActivityProfiles = emptyRoot(); initializationError = null; return success({ activityRoot: clone(root()) });
        }
        if (!plain(existing)) { initializationError = "m17_activity_unknown_root"; return fail(initializationError); }
        if (Number.isInteger(existing.version) && existing.version > VERSION) { initializationError = "m17_activity_unsupported_future_version"; return fail(initializationError); }
        if (!validateRoot(existing)) { initializationError = "m17_activity_unknown_root"; return fail(initializationError); }
        initializationError = null; return success({ activityRoot: clone(existing) });
    }
    function ready() { return initializationError ? fail(initializationError) : success(); }
    function getStoredOrDefault(characterId) {
        if (!validId(characterId) || !window.ArsCharacterState.getSnapshot(characterId)) { return null; }
        return clone(root().records[characterId] || defaultProfile(characterId));
    }
    function getProfile(characterId) { return ready().ok ? getStoredOrDefault(characterId) : null; }
    function getSnapshot() { return ready().ok ? clone(root()) : null; }

    function roleReferenceBlocked(characterId) {
        const player = window.ArsPlayerControlState && window.ArsPlayerControlState.getSnapshot();
        if (player && player.currentCharacterId === characterId) { return true; }
        if (window.ArsClanState && window.ArsClanState.listCanonical().some(function (record) { return record.headCharacterId === characterId; })) { return true; }
        if (window.ArsFactionState && window.ArsFactionState.listCanonical().some(function (record) { return record.rulerCharacterId === characterId; })) { return true; }
        if (window.ArsTitleState && window.ArsTitleState.listCanonical().some(function (record) {
            return record.statusId === "active" && record.holderRef && record.holderRef.type === "character" && record.holderRef.id === characterId;
        })) { return true; }
        return false;
    }
    function makeReceipt(plan, beforeRevision, afterRevision, idempotent) {
        const changed = [];
        const created = [];
        const revisions = [];
        Object.keys(plan.beforeSnapshots || {}).sort().forEach(function (id) {
            const before = plan.beforeSnapshots[id] || null;
            const after = plan.plannedSnapshots[id] || null;
            if (canonical(before) !== canonical(after)) {
                if (before) { changed.push(id); } else { created.push(id); }
                revisions.push({ recordId: id, beforeRevision: before ? before.revision : null, afterRevision: after ? after.revision : null });
            }
        });
        return {
            sourceEventId: plan.sourceEventId,
            changedRecordIds: changed,
            createdRecordIds: created,
            rootRevisionBefore: beforeRevision,
            rootRevisionAfter: afterRevision,
            recordRevisions: revisions,
            idempotent: Boolean(idempotent)
        };
    }
    function buildPlan(type, sourceEventId, beforeSnapshots, plannedSnapshots) {
        const current = root();
        const nextRoot = clone(current);
        let changed = false;
        Object.keys(plannedSnapshots).sort().forEach(function (id) {
            const before = beforeSnapshots[id] || null;
            const after = plannedSnapshots[id] || null;
            if (canonical(before) !== canonical(after)) {
                changed = true;
                if (after) { nextRoot.records[id] = clone(after); }
                else { delete nextRoot.records[id]; }
            }
        });
        if (changed) { nextRoot.revision = current.revision + 1; }
        return {
            type: type,
            sourceEventId: sourceEventId,
            rootRevisionBefore: current.revision,
            beforeSnapshots: clone(beforeSnapshots),
            plannedSnapshots: clone(plannedSnapshots),
            plannedRoot: nextRoot,
            idempotent: !changed
        };
    }

    function normalizeTierChange(raw, effectiveDay) {
        const change = clone(raw || {});
        if (!validId(change.characterId) || !window.ArsCharacterState.getSnapshot(change.characterId)) { return fail("m17_activity_missing_character"); }
        if (TIERS.indexOf(change.nextTier) < 0) { return fail("m17_activity_invalid_tier"); }
        if (change.expectedRecordRevision !== null && (!Number.isInteger(change.expectedRecordRevision) || change.expectedRecordRevision < 0)) { return fail("m17_activity_invalid_input"); }
        if ((change.addReasonIds !== undefined && (!Array.isArray(change.addReasonIds) || change.addReasonIds.some(function (id) { return !validId(id); }))) || (change.removeReasonIds !== undefined && (!Array.isArray(change.removeReasonIds) || change.removeReasonIds.some(function (id) { return !validId(id); })))) { return fail("m17_activity_invalid_input"); }
        const add = sortedUnique(change.addReasonIds), remove = sortedUnique(change.removeReasonIds);
        if (add.some(function (id) { return remove.indexOf(id) >= 0; })) { return fail("m17_activity_invalid_input"); }
        if (change.demotionEligibleDay !== null && change.demotionEligibleDay !== undefined && (!Number.isInteger(change.demotionEligibleDay) || change.demotionEligibleDay < 0)) { return fail("m17_activity_invalid_input"); }
        if (change.pinnedTierFloor !== null && change.pinnedTierFloor !== undefined && ["active_major", "active_named", "inactive_named"].indexOf(change.pinnedTierFloor) < 0) { return fail("m17_activity_invalid_input"); }
        if (change.importanceScore !== undefined && (!Number.isInteger(change.importanceScore) || change.importanceScore < 0 || change.importanceScore > 1000)) { return fail("m17_activity_invalid_input"); }
        const before = getStoredOrDefault(change.characterId);
        const stored = root().records[change.characterId] || null;
        const next = clone(before);
        const isDemotion = TIER_RANK[change.nextTier] < TIER_RANK[before.tier];
        if (isDemotion) {
            if (before.demotionEligibleDay === null || effectiveDay < before.demotionEligibleDay) { return fail("m17_activity_demotion_not_eligible"); }
            if (before.stableRoleKeys.length && TIER_RANK[change.nextTier] < TIER_RANK.active_named) { return fail("m17_activity_role_floor_violation"); }
            if (before.pinnedTierFloor && TIER_RANK[change.nextTier] < TIER_RANK[before.pinnedTierFloor]) { return fail("m17_activity_pin_floor_violation"); }
        }
        if (change.nextTier === "historical") {
            if (before.stableRoleKeys.length || before.pinnedTierFloor !== null || roleReferenceBlocked(change.characterId)) { return fail("m17_activity_historical_reference_blocked"); }
        }
        next.tier = change.nextTier;
        next.promotionReasonIds = sortedUnique(next.promotionReasonIds.concat(add).filter(function (id) { return remove.indexOf(id) < 0; }));
        if (change.demotionEligibleDay !== undefined) { next.demotionEligibleDay = change.demotionEligibleDay; }
        if (change.pinnedTierFloor !== undefined) { next.pinnedTierFloor = change.pinnedTierFloor; }
        if (change.importanceScore !== undefined) { next.importanceScore = change.importanceScore; }
        const stateChanged = canonical(before) !== canonical(next);
        if ((stored ? stored.revision : null) !== change.expectedRecordRevision) {
            // Exact canonical replays are successful no-ops even when the caller
            // carries the revision from the original command.
            if (!stateChanged) { return success({ before: stored ? clone(stored) : null, planned: stored ? clone(stored) : null }); }
            return fail("m17_activity_revision_conflict");
        }
        if (!stateChanged) { return success({ before: stored ? clone(stored) : null, planned: stored ? clone(stored) : null }); }
        next.revision = stored ? stored.revision + 1 : 0;
        return success({ before: stored ? clone(stored) : null, planned: next });
    }
    function planTierChanges(raw) {
        const r = ready(); if (!r.ok) { return r; }
        const input = clone(raw || {});
        if (!validId(input.sourceEventId) || !Number.isInteger(input.effectiveDay) || input.effectiveDay < 0 || !Array.isArray(input.changes) || input.changes.length === 0) { return fail("m17_activity_invalid_input"); }
        const sorted = clone(input.changes).sort(function (a, b) { return String(a.characterId).localeCompare(String(b.characterId)); });
        const seen = new Set(), before = {}, planned = {};
        for (const change of sorted) {
            if (seen.has(change.characterId)) { return fail("m17_activity_invalid_input"); }
            seen.add(change.characterId);
            const normalized = normalizeTierChange(change, input.effectiveDay); if (!normalized.ok) { return normalized; }
            before[change.characterId] = normalized.before; planned[change.characterId] = normalized.planned;
        }
        return success({ plan: buildPlan("activity_tier_changes", input.sourceEventId, before, planned) });
    }

    function _planRoleEffects(raw) {
        const r = ready(); if (!r.ok) { return r; }
        const input = clone(raw || {});
        if (!validId(input.sourceEventId) || !Number.isInteger(input.eventDay) || input.eventDay < 0 || !Array.isArray(input.effects) || input.effects.length === 0) { return fail("m17_activity_invalid_input"); }
        const effects = clone(input.effects).sort(function (a, b) { return String(a.characterId).localeCompare(String(b.characterId)); });
        const seen = new Set(), before = {}, planned = {};
        for (const effect of effects) {
            if (!validId(effect.characterId) || seen.has(effect.characterId) || !window.ArsCharacterState.getSnapshot(effect.characterId)) { return fail("m17_activity_missing_character"); }
            seen.add(effect.characterId);
            const stored = root().records[effect.characterId] || null;
            const oldProfile = getStoredOrDefault(effect.characterId);
            const next = clone(oldProfile);
            if ((effect.addRoleKeys !== undefined && (!Array.isArray(effect.addRoleKeys) || effect.addRoleKeys.some(function (id) { return !validId(id); }))) || (effect.removeRoleKeys !== undefined && (!Array.isArray(effect.removeRoleKeys) || effect.removeRoleKeys.some(function (id) { return !validId(id); })))) { return fail("m17_activity_invalid_input"); }
            const add = sortedUnique(effect.addRoleKeys), remove = sortedUnique(effect.removeRoleKeys);
            if (add.some(function (id) { return remove.indexOf(id) >= 0; })) { return fail("m17_activity_invalid_input"); }
            next.stableRoleKeys = sortedUnique(next.stableRoleKeys.concat(add).filter(function (key) { return remove.indexOf(key) < 0; }));
            if (add.length) {
                next.demotionEligibleDay = null;
                if (next.tier !== "historical" && TIER_RANK[next.tier] < TIER_RANK.active_named) { next.tier = "active_named"; }
            }
            if (add.length || remove.length) { next.nextProcessDay = Math.min(next.nextProcessDay, input.eventDay); }
            if (canonical(oldProfile) !== canonical(next)) { next.revision = stored ? stored.revision + 1 : 0; }
            before[effect.characterId] = stored ? clone(stored) : null;
            planned[effect.characterId] = next;
        }
        return success({ plan: buildPlan("activity_role_effects", input.sourceEventId, before, planned) });
    }

    function _planProcessCharacter(raw) {
        const r = ready(); if (!r.ok) { return r; }
        const input = clone(raw || {});
        if (!validId(input.characterId) || !Number.isInteger(input.currentDay) || input.currentDay < 0 || !window.ArsCharacterState.getSnapshot(input.characterId)) { return fail("m17_activity_invalid_input"); }
        const stored = root().records[input.characterId] || null;
        const beforeProfile = getStoredOrDefault(input.characterId);
        if (beforeProfile.tier === "historical") { return fail("m17_activity_invalid_transition"); }
        if (beforeProfile.lastProcessedDay === input.currentDay) { return fail("m17_activity_duplicate_same_day"); }
        if (beforeProfile.nextProcessDay > input.currentDay) { return fail("m17_activity_invalid_transition"); }
        const next = clone(beforeProfile);
        next.lastProcessedDay = input.currentDay;
        next.nextProcessDay = input.currentDay + INTERVAL[next.tier];
        next.revision = stored ? stored.revision + 1 : 0;
        return success({ plan: buildPlan("activity_process_character", "activity-day:" + input.currentDay + ":" + input.characterId, { [input.characterId]: stored ? clone(stored) : null }, { [input.characterId]: next }) });
    }

    function commitPlan(plan, expectedRevision) {
        const r = ready(); if (!r.ok) { return r; }
        if (!plain(plan) || !plain(plan.plannedRoot) || root().revision !== expectedRevision || root().revision !== plan.rootRevisionBefore) { return fail("m17_activity_revision_conflict"); }
        for (const id of Object.keys(plan.beforeSnapshots || {})) {
            if (canonical(root().records[id] || null) !== canonical(plan.beforeSnapshots[id] || null)) { return fail("m17_activity_revision_conflict"); }
        }
        const beforeRoot = clone(root());
        if (!plan.idempotent) { world().npcActivityProfiles = clone(plan.plannedRoot); }
        const verified = _verifyCommitted(plan);
        if (!verified.ok) { world().npcActivityProfiles = beforeRoot; return fail("m17_activity_verify_failed"); }
        return success({ receipt: makeReceipt(plan, beforeRoot.revision, plan.idempotent ? beforeRoot.revision : plan.plannedRoot.revision, plan.idempotent), rollbackToken: { beforeRoot: beforeRoot } });
    }
    function commitTierChanges(plan, expectedRevision) { return commitPlan(plan, expectedRevision); }
    function _commitRoleEffects(plan, expectedRevision) { return commitPlan(plan, expectedRevision); }
    function _commitProcessCharacter(plan, expectedRevision) { return commitPlan(plan, expectedRevision); }
    function _rollbackCommitted(token) {
        if (!plain(token) || !plain(token.beforeRoot)) { return fail("m17_activity_verify_failed"); }
        world().npcActivityProfiles = clone(token.beforeRoot);
        return canonical(root()) === canonical(token.beforeRoot) ? success() : fail("m17_activity_verify_failed");
    }
    function _verifyCommitted(plan) {
        return plain(plan) && plain(plan.plannedRoot) && canonical(root()) === canonical(plan.plannedRoot) && validateRoot(root()) ? success() : fail("m17_activity_verify_failed");
    }

    function allProfilesIncludingDefaults() {
        const byId = {};
        window.ArsCharacterState.list().forEach(function (character) { byId[character.id] = getStoredOrDefault(character.id); });
        return byId;
    }
    function collectDueCharacters(currentDay, budget) {
        if (!ready().ok || !Number.isInteger(currentDay) || currentDay < 0 || !Number.isInteger(budget) || budget < 0) { return []; }
        const profiles = allProfilesIncludingDefaults();
        return Object.keys(profiles).map(function (id) { return profiles[id]; }).filter(function (profile) {
            return profile.tier !== "historical" && profile.nextProcessDay <= currentDay && profile.lastProcessedDay !== currentDay;
        }).sort(function (a, b) {
            return a.importanceScore - b.importanceScore || a.lastProcessedDay - b.lastProcessedDay || a.characterId.localeCompare(b.characterId);
        }).slice(0, budget).map(function (profile) { return clone(profile); });
    }
    function _hasRemainingDue(currentDay) { return collectDueCharacters(currentDay, Number.MAX_SAFE_INTEGER).length > 0; }
    function diagnostics() {
        const issues = [];
        if (initializationError) { issues.push(initializationError); }
        else if (!validateRoot(root())) { issues.push("m17_activity_root_invariant_failed"); }
        const legacyActivityCharacterIds = window.ArsCharacterState.list().filter(function (character) {
            return Object.prototype.hasOwnProperty.call(character, "activity");
        }).map(function (character) { return character.id; }).sort();
        return { ok: issues.length === 0, issues: issues, recordCount: initializationError ? null : Object.keys(root().records).length, legacyActivityCharacterIds: legacyActivityCharacterIds };
    }

    ensureRoot();
    window.ArsNpcActivityState = Object.freeze({ VERSION: VERSION, ensure: ensureRoot, getProfile: getProfile, getSnapshot: getSnapshot });
    window.ArsNpcActivitySystem = Object.freeze({
        planTierChanges: planTierChanges,
        commitTierChanges: commitTierChanges,
        collectDueCharacters: collectDueCharacters,
        _planRoleEffects: _planRoleEffects,
        _commitRoleEffects: _commitRoleEffects,
        _planProcessCharacter: _planProcessCharacter,
        _commitProcessCharacter: _commitProcessCharacter,
        _rollbackCommitted: _rollbackCommitted,
        _verifyCommitted: _verifyCommitted,
        _hasRemainingDue: _hasRemainingDue
    });
    window.ArsNpcActivityDiagnostics = Object.freeze({ run: diagnostics });
})();
