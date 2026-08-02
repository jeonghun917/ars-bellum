// Ars Bellum M1 - Persistent proposed custom definitions
(function () {
    "use strict";
    const VERSION = 1;
    function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
    function validId(v) { return typeof v === "string" && /^[a-z][a-z0-9_.:-]*$/.test(v); }
    function plain(v) { return v && typeof v === "object" && !Array.isArray(v); }
    function root() { return window.ArsGameState.getState().world.customDefinitions; }
    function key(domainId, definitionId) { return domainId + ":" + definitionId; }
    function ensure() {
        const world = window.ArsGameState.getState().world, current = world.customDefinitions;
        if (!plain(current)) {
            world.customDefinitions = { version: VERSION, revision: 0, records: {} };
            return { ok: true, customDefinitions: getSnapshot() };
        }
        if (Number.isInteger(current.version) && current.version > VERSION) { return { ok: false, error: "unsupported_future_version" }; }
        const next = Object.assign({}, clone(current), {
            version: Number.isInteger(current.version) ? current.version : VERSION,
            revision: Number.isInteger(current.revision) && current.revision >= 0 ? current.revision : 0,
            records: plain(current.records) ? clone(current.records) : {}
        });
        world.customDefinitions = next;
        return { ok: true, customDefinitions: getSnapshot() };
    }
    function getSnapshot() { return clone(root()); }
    function getRecord(domainId, definitionId) { const record = root().records[key(domainId, definitionId)]; return record ? clone(record) : null; }
    function list(domainId) { return Object.keys(root().records).sort().map(function (k) { return clone(root().records[k]); }).filter(function (record) { return !domainId || record.domainId === domainId; }); }
    function validateRecord(record) {
        const errors = [];
        if (!plain(record) || !validId(record.domainId) || !validId(record.definitionId)) { errors.push("invalid_definition_identity"); }
        if (!window.ArsDefinitionRegistry.hasDomain(record && record.domainId)) { errors.push("unregistered_domain"); }
        if (!Number.isInteger(record && record.schemaVersion) || record.schemaVersion < 1) { errors.push("invalid_schema_version"); }
        if (!Number.isInteger(record && record.definitionVersion) || record.definitionVersion < 1) { errors.push("invalid_definition_version"); }
        if (typeof (record && record.sourceType) !== "string" || !record.sourceType) { errors.push("invalid_source_type"); }
        if (!["pending", "approved", "rejected"].includes(record && record.approvalStatus)) { errors.push("invalid_approval_status"); }
        if (!plain(record && record.definitionData)) { errors.push("invalid_definition_data"); }
        if (!Number.isInteger(record && record.revision) || record.revision < 0) { errors.push("invalid_revision"); }
        try { JSON.stringify(record); } catch (e) { errors.push("record_not_serializable"); }
        return errors;
    }
    function propose(input) {
        const plan = input || {};
        if (!window.ArsDefinitionRegistry.hasDomain(plan.domainId)) { return { ok: false, error: "unregistered_domain" }; }
        if (!validId(plan.definitionId)) { return { ok: false, error: "invalid_definition_id" }; }
        if (window.ArsDefinitionRegistry.hasDefinition(plan.domainId, plan.definitionId)) { return { ok: false, error: "duplicate_definition_id" }; }
        const recordKey = key(plan.domainId, plan.definitionId);
        if (root().records[recordKey]) { return { ok: false, error: "duplicate_definition_proposal" }; }
        const validation = window.ArsDefinitionRegistry.validateDefinition(plan.domainId, plan.definitionId, plan.definitionData);
        if (!validation.ok) { return validation; }
        let record;
        try {
            record = {
                domainId: plan.domainId, definitionId: plan.definitionId,
                schemaVersion: VERSION, definitionVersion: Number.isInteger(plan.definitionVersion) && plan.definitionVersion > 0 ? plan.definitionVersion : 1,
                sourceType: plan.sourceType || "player", sourceRef: clone(plan.sourceRef || null),
                approvalStatus: "pending", approvedByRef: null,
                definitionData: validation.definitionData, revision: 0
            };
        } catch (e) { return { ok: false, error: "proposal_not_serializable" }; }
        const errors = validateRecord(record); if (errors.length) { return { ok: false, error: "invalid_definition_proposal", errors: errors }; }
        root().records[recordKey] = record; root().revision += 1;
        return { ok: true, record: getRecord(plan.domainId, plan.definitionId) };
    }
    function decide(plan, status) {
        const p = plan || {}, recordKey = key(p.domainId, p.definitionId), current = root().records[recordKey];
        if (!current) { return { ok: false, error: "missing_definition_proposal" }; }
        if (p.expectedRevision !== current.revision) { return { ok: false, error: "revision_conflict" }; }
        if (current.approvalStatus !== "pending") { return { ok: false, error: "proposal_already_decided" }; }
        const next = clone(current); next.approvalStatus = status; next.approvedByRef = status === "approved" ? clone(p.approvedByRef || null) : null; next.revision += 1;
        const errors = validateRecord(next); if (errors.length) { return { ok: false, error: "invalid_definition_decision", errors: errors }; }
        root().records[recordKey] = next; root().revision += 1;
        return { ok: true, record: getRecord(p.domainId, p.definitionId) };
    }
    function registerApproved(plan) {
        const p = plan || {}, current = root().records[key(p.domainId, p.definitionId)];
        if (!current) { return { ok: false, error: "missing_definition_proposal" }; }
        if (current.approvalStatus !== "approved") { return { ok: false, error: "definition_not_approved" }; }
        const result = window.ArsDefinitionRegistry.registerApprovedDefinition(current.domainId, current.definitionId, current.definitionData, { sourceType: current.sourceType, sourceRef: current.sourceRef, definitionVersion: current.definitionVersion });
        if (!result.ok) { return result; }
        return { ok: true, definition: result.definition, record: getRecord(current.domainId, current.definitionId) };
    }
    function normalize() {
        const current = getSnapshot();
        if (Number.isInteger(current.version) && current.version > VERSION) { return { ok: false, error: "unsupported_future_version" }; }
        const next = Object.assign({}, current, { version: VERSION, revision: Number.isInteger(current.revision) && current.revision >= 0 ? current.revision : 0, records: {} });
        const warnings = [];
        Object.keys(current.records || {}).forEach(function (recordKey) {
            const record = clone(current.records[recordKey]), errors = validateRecord(record);
            if (errors.length) { warnings.push({ key: recordKey, errors: errors }); }
            next.records[recordKey] = record;
        });
        window.ArsGameState.getState().world.customDefinitions = next;
        return { ok: true, customDefinitions: getSnapshot(), warnings: warnings };
    }
    const ensured = ensure();
    if (!ensured.ok) { throw new Error(ensured.error); }
    window.ArsDefinitionState = Object.freeze({
        VERSION: VERSION, ensure: ensure, createDefault: ensure,
        getSnapshot: getSnapshot, getRecord: getRecord, list: list,
        validate: validateRecord, normalize: normalize,
        propose: propose,
        approve: function (plan) { return decide(plan, "approved"); },
        reject: function (plan) { return decide(plan, "rejected"); },
        registerApprovedDefinition: registerApproved
    });
})();
