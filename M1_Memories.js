// Ars Bellum M1-7 - Character memory state and transactions
(function () {
    "use strict";

    const VERSION = 1;
    const KNOWLEDGE = Object.freeze(["private", "known_to_targets", "clan_known", "faction_known", "public"]);
    const STATUS = Object.freeze(["unresolved", "resolved", "forgiven", "expired"]);
    const TERMINAL = Object.freeze(["resolved", "forgiven", "expired"]);
    const DEFAULT_TYPES = Object.freeze([
        "life_saved", "kin_killed", "major_betrayal", "marriage_promise", "alliance_promise",
        "title_granted", "title_revoked", "land_confiscated", "public_humiliation",
        "decisive_war_support", "succession_dispute", "debt_forgiven", "debt_defaulted"
    ]);
    let initializationError = null;

    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
    function validId(value) { return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value); }
    function canonical(value) { return window.ArsM1AtomicCoordinator._canonicalStringify(value); }
    function hash(value) { return window.ArsM1AtomicCoordinator._sha256(canonical(value)); }
    function world() { return window.ArsGameState.getState().world; }
    function root() { return world().memories; }
    function emptyRoot() { return { version: VERSION, revision: 0, records: {}, ownerIndex: {} }; }
    function isEmptyObject(value) { return plain(value) && Object.keys(value).length === 0; }
    function fail(error, detail) { return { ok: false, error: error, detail: detail == null ? null : clone(detail) }; }
    function success(value) { return Object.assign({ ok: true }, value || {}); }
    function uniqueSorted(values) { return Array.from(new Set((Array.isArray(values) ? values : []).filter(validId))).sort(); }
    function memoryId(ownerCharacterId, memoryTypeId, sourceEventId) { return "memory:" + hash([ownerCharacterId, memoryTypeId, sourceEventId]); }
    function rebuildOwnerIndex(records) {
        const index = {};
        Object.keys(records || {}).sort().forEach(function (id) {
            const record = records[id];
            if (!index[record.ownerCharacterId]) { index[record.ownerCharacterId] = []; }
            index[record.ownerCharacterId].push(id);
        });
        Object.keys(index).forEach(function (id) { index[id].sort(); });
        return index;
    }
    function registerDefinitions() {
        const registry = window.ArsDefinitionRegistry;
        if (!registry.hasDomain("memory_type")) {
            const result = registry.registerDomain("memory_type", { validator: function (definition) { return validId(definition.id) ? true : ["invalid_memory_type"]; } });
            if (!result.ok) { throw new Error(result.error); }
        }
        if (!registry.hasDomain("memory_decay_policy")) {
            const result = registry.registerDomain("memory_decay_policy", { validator: function (definition) { return validId(definition.id) ? true : ["invalid_memory_decay_policy"]; } });
            if (!result.ok) { throw new Error(result.error); }
        }
        DEFAULT_TYPES.forEach(function (id) {
            if (!registry.hasDefinition("memory_type", id)) {
                const result = registry.registerDefaultDefinition("memory_type", { id: id, definitionVersion: 1 });
                if (!result.ok) { throw new Error(result.error); }
            }
        });
        if (!registry.hasDefinition("memory_decay_policy", "permanent")) {
            const result = registry.registerDefaultDefinition("memory_decay_policy", { id: "permanent", definitionVersion: 1, automaticExpiry: false });
            if (!result.ok) { throw new Error(result.error); }
        }
    }
    function validateRecord(record, id, skipRefs) {
        if (!plain(record) || record.id !== id || record.id !== memoryId(record.ownerCharacterId, record.memoryTypeId, record.sourceEventId)) { return false; }
        if (!validId(record.ownerCharacterId) || !validId(record.memoryTypeId) || !validId(record.sourceEventId) || !validId(record.decayPolicyId)) { return false; }
        if (!Array.isArray(record.targetCharacterIds) || canonical(record.targetCharacterIds) !== canonical(uniqueSorted(record.targetCharacterIds))) { return false; }
        if (!Number.isInteger(record.eventDay) || record.eventDay < 0 || !Number.isInteger(record.importance) || record.importance < 0 || record.importance > 1000) { return false; }
        if (KNOWLEDGE.indexOf(record.knowledge) < 0 || STATUS.indexOf(record.status) < 0 || !plain(record.payload) || !Number.isInteger(record.revision) || record.revision < 0) { return false; }
        if (record.status === "unresolved") {
            if (record.resolution !== null) { return false; }
        } else {
            if (!plain(record.resolution) || record.resolution.status !== record.status || !Number.isInteger(record.resolution.decisionDay) || record.resolution.decisionDay < 0 || !validId(record.resolution.reasonId) || !validId(record.resolution.sourceEventId)) { return false; }
            if (record.status === "expired" && record.decayPolicyId === "permanent") { return false; }
        }
        if (!window.ArsDefinitionRegistry.hasDefinition("memory_type", record.memoryTypeId) || !window.ArsDefinitionRegistry.hasDefinition("memory_decay_policy", record.decayPolicyId)) { return false; }
        if (!skipRefs) {
            if (!window.ArsCharacterState.getSnapshot(record.ownerCharacterId)) { return false; }
            for (const targetId of record.targetCharacterIds) { if (!window.ArsCharacterState.getSnapshot(targetId)) { return false; } }
        }
        return true;
    }
    function validateRoot(value) {
        if (!plain(value) || value.version !== VERSION || !Number.isInteger(value.revision) || value.revision < 0 || !plain(value.records) || !plain(value.ownerIndex)) { return false; }
        for (const id of Object.keys(value.records)) { if (!validateRecord(value.records[id], id, false)) { return false; } }
        return canonical(value.ownerIndex) === canonical(rebuildOwnerIndex(value.records));
    }
    function ensureRoot() {
        const existing = root();
        if (existing == null || isEmptyObject(existing)) {
            world().memories = emptyRoot(); initializationError = null; return success({ memoryRoot: clone(root()) });
        }
        if (!plain(existing)) { initializationError = "m17_memory_unknown_root"; return fail(initializationError); }
        if (Number.isInteger(existing.version) && existing.version > VERSION) { initializationError = "m17_memory_unsupported_future_version"; return fail(initializationError); }
        if (!validateRoot(existing)) { initializationError = "m17_memory_unknown_root"; return fail(initializationError); }
        initializationError = null; return success({ memoryRoot: clone(existing) });
    }
    function ready() { return initializationError ? fail(initializationError) : success(); }
    function get(memoryIdValue) { return ready().ok && root().records[memoryIdValue] ? clone(root().records[memoryIdValue]) : null; }
    function listForOwner(characterId, filter) {
        if (!ready().ok || !validId(characterId)) { return []; }
        const f = plain(filter) ? filter : {};
        return (root().ownerIndex[characterId] || []).map(function (id) { return clone(root().records[id]); }).filter(function (record) {
            if (f.status && record.status !== f.status) { return false; }
            if (f.memoryTypeId && record.memoryTypeId !== f.memoryTypeId) { return false; }
            if (f.targetCharacterId && record.targetCharacterIds.indexOf(f.targetCharacterId) < 0) { return false; }
            return true;
        });
    }
    function normalizeCreateInput(raw) {
        const input = clone(raw || {});
        if (!validId(input.ownerCharacterId) || !validId(input.memoryTypeId) || !validId(input.sourceEventId) || !Number.isInteger(input.eventDay) || input.eventDay < 0 || !Number.isInteger(input.importance) || input.importance < 0 || input.importance > 1000 || KNOWLEDGE.indexOf(input.knowledge) < 0 || !validId(input.decayPolicyId || "permanent") || !plain(input.payload || {})) {
            return fail("m17_memory_invalid_input");
        }
        if (!window.ArsCharacterState.getSnapshot(input.ownerCharacterId)) { return fail("m17_memory_missing_owner"); }
        const targets = uniqueSorted(input.targetCharacterIds);
        for (const targetId of targets) { if (!window.ArsCharacterState.getSnapshot(targetId)) { return fail("m17_memory_missing_target", targetId); } }
        if (!window.ArsDefinitionRegistry.hasDefinition("memory_type", input.memoryTypeId)) { return fail("m17_memory_unregistered_type"); }
        const decayPolicyId = input.decayPolicyId || "permanent";
        if (!window.ArsDefinitionRegistry.hasDefinition("memory_decay_policy", decayPolicyId)) { return fail("m17_memory_unregistered_decay_policy"); }
        return success({ input: {
            ownerCharacterId: input.ownerCharacterId,
            targetCharacterIds: targets,
            memoryTypeId: input.memoryTypeId,
            eventDay: input.eventDay,
            importance: input.importance,
            knowledge: input.knowledge,
            status: "unresolved",
            decayPolicyId: decayPolicyId,
            sourceEventId: input.sourceEventId,
            payload: clone(input.payload || {})
        } });
    }
    function makeReceipt(plan, beforeRootRevision, afterRootRevision, idempotent) {
        const before = plan.beforeSnapshot, after = plan.plannedSnapshot;
        return {
            sourceEventId: plan.sourceEventId,
            changedRecordIds: before && after && canonical(before) !== canonical(after) ? [plan.recordId] : [],
            createdRecordIds: !before && after ? [plan.recordId] : [],
            rootRevisionBefore: beforeRootRevision,
            rootRevisionAfter: afterRootRevision,
            recordRevisions: after ? [{ recordId: plan.recordId, beforeRevision: before ? before.revision : null, afterRevision: after.revision }] : [],
            idempotent: Boolean(idempotent)
        };
    }
    function buildPlan(type, sourceEventId, recordIdValue, before, planned, idempotent) {
        const current = root(), nextRoot = clone(current);
        if (!idempotent) {
            nextRoot.records[recordIdValue] = clone(planned);
            nextRoot.ownerIndex = rebuildOwnerIndex(nextRoot.records);
            nextRoot.revision = current.revision + 1;
        }
        return {
            type: type, sourceEventId: sourceEventId, recordId: recordIdValue,
            rootRevisionBefore: current.revision, expectedRecordRevision: before ? before.revision : null,
            beforeSnapshot: clone(before), plannedSnapshot: clone(planned), idempotent: Boolean(idempotent), plannedRoot: nextRoot
        };
    }
    function planCreate(raw) {
        const r = ready(); if (!r.ok) { return r; }
        const normalized = normalizeCreateInput(raw); if (!normalized.ok) { return normalized; }
        const input = normalized.input, id = memoryId(input.ownerCharacterId, input.memoryTypeId, input.sourceEventId);
        const planned = {
            id: id, ownerCharacterId: input.ownerCharacterId, targetCharacterIds: clone(input.targetCharacterIds), memoryTypeId: input.memoryTypeId,
            eventDay: input.eventDay, importance: input.importance, knowledge: input.knowledge, status: "unresolved",
            decayPolicyId: input.decayPolicyId, sourceEventId: input.sourceEventId, payload: clone(input.payload), resolution: null, revision: 0
        };
        const before = root().records[id] || null;
        if (before) {
            const comparable = clone(before); comparable.revision = 0;
            if (canonical(comparable) !== canonical(planned)) { return fail("m17_memory_duplicate_conflict"); }
            return success({ plan: buildPlan("memory_create", input.sourceEventId, id, before, before, true) });
        }
        return success({ plan: buildPlan("memory_create", input.sourceEventId, id, null, planned, false) });
    }
    function planResolve(raw) {
        const r = ready(); if (!r.ok) { return r; }
        const input = clone(raw || {});
        if (!validId(input.memoryId) || TERMINAL.indexOf(input.nextStatus) < 0 || !Number.isInteger(input.decisionDay) || input.decisionDay < 0 || !validId(input.reasonId) || !validId(input.sourceEventId)) { return fail("m17_memory_invalid_input"); }
        const before = root().records[input.memoryId]; if (!before) { return fail("m17_memory_missing_record"); }
        if (input.nextStatus === "expired" && before.decayPolicyId === "permanent") { return fail("m17_memory_permanent_expiry_forbidden"); }
        const resolution = { status: input.nextStatus, decisionDay: input.decisionDay, reasonId: input.reasonId, sourceEventId: input.sourceEventId };
        if (TERMINAL.indexOf(before.status) >= 0) {
            if (before.status === input.nextStatus && canonical(before.resolution) === canonical(resolution)) {
                return success({ plan: buildPlan("memory_resolve", input.sourceEventId, input.memoryId, before, before, true) });
            }
            return fail("m17_memory_invalid_transition");
        }
        if (before.status !== "unresolved") { return fail("m17_memory_invalid_transition"); }
        const planned = clone(before); planned.status = input.nextStatus; planned.resolution = resolution; planned.revision = before.revision + 1;
        return success({ plan: buildPlan("memory_resolve", input.sourceEventId, input.memoryId, before, planned, false) });
    }
    function commit(plan, expectedRevision) {
        const r = ready(); if (!r.ok) { return r; }
        if (!plain(plan) || ["memory_create", "memory_resolve"].indexOf(plan.type) < 0) { return fail("m17_memory_invalid_input"); }
        const current = root();
        if (current.revision !== expectedRevision || current.revision !== plan.rootRevisionBefore) { return fail("m17_memory_revision_conflict"); }
        if (canonical(current.records[plan.recordId] || null) !== canonical(plan.beforeSnapshot || null)) { return fail("m17_memory_revision_conflict"); }
        if (plan.idempotent) { return success({ receipt: makeReceipt(plan, current.revision, current.revision, true), rollbackToken: { beforeRoot: clone(current) } }); }
        const beforeRoot = clone(current); world().memories = clone(plan.plannedRoot);
        const verified = _verifyCommitted(plan);
        if (!verified.ok) { world().memories = beforeRoot; return fail("m17_memory_verify_failed"); }
        return success({ receipt: makeReceipt(plan, beforeRoot.revision, plan.plannedRoot.revision, false), rollbackToken: { beforeRoot: beforeRoot } });
    }
    function _rollbackCommitted(token) {
        if (!plain(token) || !plain(token.beforeRoot)) { return fail("m17_memory_verify_failed"); }
        world().memories = clone(token.beforeRoot);
        return canonical(root()) === canonical(token.beforeRoot) ? success() : fail("m17_memory_verify_failed");
    }
    function _verifyCommitted(plan) {
        return plain(plan) && plain(plan.plannedRoot) && canonical(root()) === canonical(plan.plannedRoot) && validateRoot(root()) ? success() : fail("m17_memory_verify_failed");
    }
    function diagnostics() {
        const issues = [];
        if (initializationError) { issues.push(initializationError); }
        else if (!validateRoot(root())) { issues.push("m17_memory_root_invariant_failed"); }
        return { ok: issues.length === 0, issues: issues, recordCount: initializationError ? null : Object.keys(root().records).length };
    }

    registerDefinitions();
    ensureRoot();
    window.ArsMemoryState = Object.freeze({ VERSION: VERSION, ensure: ensureRoot, get: get, listForOwner: listForOwner, getSnapshot: function () { return initializationError ? null : clone(root()); } });
    window.ArsMemorySystem = Object.freeze({ planCreate: planCreate, planResolve: planResolve, commit: commit, _rollbackCommitted: _rollbackCommitted, _verifyCommitted: _verifyCommitted });
    window.ArsMemoryDiagnostics = Object.freeze({ run: diagnostics });
})();
