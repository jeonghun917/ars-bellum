// Ars Bellum M1-7 - Directional relationship state and transactions
(function () {
    "use strict";

    const VERSION = 1;
    const VALUE_KEYS = Object.freeze(["affection", "trust", "respect", "fear", "obligation", "rivalry"]);
    let initializationError = null;
    const M17_RELATION_FAILURE_INJECTION = { afterRecordBeforeEffect: false };

    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
    function validId(value) { return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value); }
    function canonical(value) { return window.ArsM1AtomicCoordinator._canonicalStringify(value); }
    function digest(value) { return "sha256:" + window.ArsM1AtomicCoordinator._sha256(canonical(value)); }
    function world() { return window.ArsGameState.getState().world; }
    function currentRoot() { return world().relationships; }
    function emptyRoot() { return { version: VERSION, revision: 0, records: {}, appliedEffects: {}, indexes: { from: {}, to: {} } }; }
    function isEmptyObject(value) { return plain(value) && Object.keys(value).length === 0; }
    function fail(error, detail) { return { ok: false, error: error, detail: detail == null ? null : clone(detail) }; }
    function success(value) { return Object.assign({ ok: true }, value || {}); }
    function clamp(value) { return Math.max(-1000, Math.min(1000, Math.trunc(value))); }
    function uniqueSorted(values) { return Array.from(new Set((Array.isArray(values) ? values : []).filter(validId))).sort(); }

    function relationId(fromCharacterId, toCharacterId) {
        return "relation:" + window.ArsM1AtomicCoordinator._sha256(canonical([fromCharacterId, toCharacterId]));
    }
    function effectKey(input) {
        return "relation_effect:" + window.ArsM1AtomicCoordinator._sha256(canonical([
            input.sourceEventId, input.fromCharacterId, input.toCharacterId, input.reasonId
        ]));
    }
    function rebuildIndexes(records) {
        const indexes = { from: {}, to: {} };
        Object.keys(records || {}).sort().forEach(function (id) {
            const record = records[id];
            if (!record) { return; }
            if (!indexes.from[record.fromCharacterId]) { indexes.from[record.fromCharacterId] = []; }
            if (!indexes.to[record.toCharacterId]) { indexes.to[record.toCharacterId] = []; }
            indexes.from[record.fromCharacterId].push(id);
            indexes.to[record.toCharacterId].push(id);
        });
        Object.keys(indexes.from).forEach(function (id) { indexes.from[id].sort(); });
        Object.keys(indexes.to).forEach(function (id) { indexes.to[id].sort(); });
        return indexes;
    }
    function validateRecord(record, id) {
        if (!plain(record) || record.id !== id || record.id !== relationId(record.fromCharacterId, record.toCharacterId)) { return false; }
        if (!validId(record.fromCharacterId) || !validId(record.toCharacterId) || record.fromCharacterId === record.toCharacterId) { return false; }
        if (!plain(record.values) || !Number.isInteger(record.revision) || record.revision < 0) { return false; }
        for (const key of VALUE_KEYS) {
            if (!Number.isInteger(record.values[key]) || record.values[key] < -1000 || record.values[key] > 1000) { return false; }
        }
        return Array.isArray(record.tags) && canonical(record.tags) === canonical(uniqueSorted(record.tags)) && Number.isInteger(record.lastInteractionDay) && record.lastInteractionDay >= 0 && Number.isInteger(record.lastDecayDay) && record.lastDecayDay >= 0;
    }
    function validateRoot(root) {
        if (!plain(root) || root.version !== VERSION || !Number.isInteger(root.revision) || root.revision < 0 || !plain(root.records) || !plain(root.appliedEffects) || !plain(root.indexes)) { return false; }
        for (const id of Object.keys(root.records)) { if (!validateRecord(root.records[id], id)) { return false; } }
        for (const key of Object.keys(root.appliedEffects)) {
            const effect = root.appliedEffects[key];
            if (!/^relation_effect:[0-9a-f]{64}$/.test(key) || !plain(effect) || !/^sha256:[0-9a-f]{64}$/.test(effect.inputDigest || "") || !validId(effect.sourceEventId) || !Number.isInteger(effect.appliedDay) || effect.appliedDay < 0) { return false; }
            if (effect.relationId !== null && (!validId(effect.relationId) || !root.records[effect.relationId])) { return false; }
        }
        return canonical(root.indexes) === canonical(rebuildIndexes(root.records));
    }
    function ensureRoot() {
        const existing = currentRoot();
        if (existing == null || isEmptyObject(existing)) {
            world().relationships = emptyRoot();
            initializationError = null;
            return success({ relationshipRoot: clone(world().relationships) });
        }
        if (!plain(existing)) { initializationError = "m17_relation_unknown_root"; return fail(initializationError); }
        if (Number.isInteger(existing.version) && existing.version > VERSION) { initializationError = "m17_relation_unsupported_future_version"; return fail(initializationError); }
        if (!validateRoot(existing)) { initializationError = "m17_relation_unknown_root"; return fail(initializationError); }
        initializationError = null;
        return success({ relationshipRoot: clone(existing) });
    }
    function ready() { return initializationError ? fail(initializationError) : success(); }
    function get(fromCharacterId, toCharacterId) {
        if (!ready().ok || !validId(fromCharacterId) || !validId(toCharacterId)) { return null; }
        const record = currentRoot().records[relationId(fromCharacterId, toCharacterId)];
        return record ? clone(record) : null;
    }
    function listFrom(characterId) {
        if (!ready().ok || !validId(characterId)) { return []; }
        return ((currentRoot().indexes.from || {})[characterId] || []).map(function (id) { return clone(currentRoot().records[id]); });
    }
    function defaultValues() { const values = {}; VALUE_KEYS.forEach(function (key) { values[key] = 0; }); return values; }
    function normalizeInput(raw) {
        const input = clone(raw || {});
        if (!validId(input.fromCharacterId) || !validId(input.toCharacterId) || !validId(input.reasonId) || !validId(input.sourceEventId) || !Number.isInteger(input.eventDay) || input.eventDay < 0 || !plain(input.deltas)) {
            return fail("m17_relation_invalid_input");
        }
        if (input.fromCharacterId === input.toCharacterId) { return fail("m17_relation_self_reference"); }
        if (!window.ArsCharacterState.getSnapshot(input.fromCharacterId) || !window.ArsCharacterState.getSnapshot(input.toCharacterId)) { return fail("m17_relation_missing_character"); }
        const keys = Object.keys(input.deltas);
        if (keys.some(function (key) { return VALUE_KEYS.indexOf(key) < 0; })) { return fail("m17_relation_invalid_delta"); }
        const deltas = defaultValues();
        for (const key of keys) {
            if (!Number.isInteger(input.deltas[key])) { return fail("m17_relation_invalid_delta"); }
            deltas[key] = input.deltas[key];
        }
        return success({ input: {
            fromCharacterId: input.fromCharacterId,
            toCharacterId: input.toCharacterId,
            deltas: deltas,
            reasonId: input.reasonId,
            sourceEventId: input.sourceEventId,
            eventDay: input.eventDay
        } });
    }
    function receiptFromPlan(plan, rootBefore, rootAfter, idempotent) {
        const before = plan.beforeSnapshot;
        const after = plan.plannedSnapshot;
        return {
            sourceEventId: plan.input.sourceEventId,
            changedRecordIds: after && before ? [plan.recordId] : [],
            createdRecordIds: after && !before ? [plan.recordId] : [],
            rootRevisionBefore: rootBefore,
            rootRevisionAfter: rootAfter,
            recordRevisions: after ? [{ recordId: plan.recordId, beforeRevision: before ? before.revision : null, afterRevision: after.revision }] : [],
            idempotent: Boolean(idempotent),
            relationId: after ? plan.recordId : null,
            effectKey: plan.effectKey
        };
    }
    function planDelta(raw) {
        const rootReady = ready(); if (!rootReady.ok) { return rootReady; }
        const normalized = normalizeInput(raw); if (!normalized.ok) { return normalized; }
        const input = normalized.input;
        const root = currentRoot();
        const id = relationId(input.fromCharacterId, input.toCharacterId);
        const eKey = effectKey(input);
        const inputDigest = digest(input);
        const priorEffect = root.appliedEffects[eKey] || null;
        if (priorEffect) {
            if (priorEffect.inputDigest !== inputDigest) { return fail("m17_relation_effect_conflict"); }
            const priorRecord = root.records[id] || null;
            return success({ plan: {
                type: "relationship_delta", input: input, inputDigest: inputDigest, effectKey: eKey, recordId: id,
                rootRevisionBefore: root.revision, beforeSnapshot: clone(priorRecord), plannedSnapshot: clone(priorRecord),
                beforeEffect: clone(priorEffect), plannedEffect: clone(priorEffect), idempotent: true,
                plannedRoot: clone(root)
            } });
        }
        const before = root.records[id] ? clone(root.records[id]) : null;
        const values = before ? clone(before.values) : defaultValues();
        VALUE_KEYS.forEach(function (key) { values[key] = clamp(values[key] + input.deltas[key]); });
        const allZero = VALUE_KEYS.every(function (key) { return values[key] === 0; });
        let planned = null;
        if (before || !allZero) {
            planned = {
                id: id,
                fromCharacterId: input.fromCharacterId,
                toCharacterId: input.toCharacterId,
                values: values,
                tags: before ? uniqueSorted(before.tags) : [],
                lastInteractionDay: input.eventDay,
                lastDecayDay: before ? before.lastDecayDay : input.eventDay,
                revision: before ? before.revision + 1 : 0
            };
        }
        const effect = { inputDigest: inputDigest, relationId: planned ? id : null, sourceEventId: input.sourceEventId, appliedDay: input.eventDay };
        const nextRoot = clone(root);
        if (planned) { nextRoot.records[id] = clone(planned); }
        nextRoot.appliedEffects[eKey] = clone(effect);
        nextRoot.indexes = rebuildIndexes(nextRoot.records);
        nextRoot.revision = root.revision + 1;
        return success({ plan: {
            type: "relationship_delta", input: input, inputDigest: inputDigest, effectKey: eKey, recordId: id,
            rootRevisionBefore: root.revision, beforeSnapshot: before, plannedSnapshot: planned,
            beforeEffect: null, plannedEffect: effect, idempotent: false, plannedRoot: nextRoot
        } });
    }
    function commit(plan, expectedRevision) {
        const rootReady = ready(); if (!rootReady.ok) { return rootReady; }
        if (!plain(plan) || plan.type !== "relationship_delta") { return fail("m17_relation_invalid_input"); }
        const root = currentRoot();
        if (expectedRevision !== root.revision || plan.rootRevisionBefore !== root.revision) { return fail("m17_relation_revision_conflict"); }
        if (plan.idempotent) { return success({ receipt: receiptFromPlan(plan, root.revision, root.revision, true), rollbackToken: { beforeRoot: clone(root) } }); }
        if (canonical(root.records[plan.recordId] || null) !== canonical(plan.beforeSnapshot || null) || canonical(root.appliedEffects[plan.effectKey] || null) !== canonical(plan.beforeEffect || null)) { return fail("m17_relation_revision_conflict"); }
        const beforeRoot = clone(root);
        if (M17_RELATION_FAILURE_INJECTION.afterRecordBeforeEffect) {
            const partial = clone(beforeRoot);
            if (plan.plannedSnapshot) { partial.records[plan.recordId] = clone(plan.plannedSnapshot); }
            world().relationships = partial;
            world().relationships = beforeRoot;
            return fail("m17_relation_verify_failed", { failureInjection: "FI-REL-AFTER-RECORD-BEFORE-EFFECT" });
        }
        world().relationships = clone(plan.plannedRoot);
        const verified = _verifyCommitted(plan);
        if (!verified.ok) { world().relationships = beforeRoot; return fail("m17_relation_verify_failed"); }
        return success({ receipt: receiptFromPlan(plan, beforeRoot.revision, plan.plannedRoot.revision, false), rollbackToken: { beforeRoot: beforeRoot } });
    }
    function _rollbackCommitted(token) {
        if (!plain(token) || !plain(token.beforeRoot)) { return fail("m17_relation_verify_failed"); }
        world().relationships = clone(token.beforeRoot);
        return canonical(currentRoot()) === canonical(token.beforeRoot) ? success() : fail("m17_relation_verify_failed");
    }
    function _verifyCommitted(plan) {
        if (!plain(plan) || !plain(plan.plannedRoot)) { return fail("m17_relation_verify_failed"); }
        return canonical(currentRoot()) === canonical(plan.plannedRoot) && validateRoot(currentRoot()) ? success() : fail("m17_relation_verify_failed");
    }
    function diagnostics() {
        const issues = [];
        if (initializationError) { issues.push(initializationError); }
        else if (!validateRoot(currentRoot())) { issues.push("m17_relation_root_invariant_failed"); }
        return { ok: issues.length === 0, issues: issues, recordCount: initializationError ? null : Object.keys(currentRoot().records).length, effectCount: initializationError ? null : Object.keys(currentRoot().appliedEffects).length, activeFailureInjectionCount: M17_RELATION_FAILURE_INJECTION.afterRecordBeforeEffect ? 1 : 0 };
    }

    ensureRoot();
    window.ArsRelationshipState = Object.freeze({ VERSION: VERSION, ensure: ensureRoot, get: get, listFrom: listFrom, getSnapshot: function () { return initializationError ? null : clone(currentRoot()); } });
    window.ArsRelationshipSystem = Object.freeze({ planDelta: planDelta, commit: commit, _rollbackCommitted: _rollbackCommitted, _verifyCommitted: _verifyCommitted });
    window.ArsRelationshipDiagnostics = Object.freeze({ run: diagnostics });
})();
