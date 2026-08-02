// Ars Bellum M1 - Runtime Definition Registry
// ArsGameState를 직접 읽거나 수정하지 않는다.
(function () {
    "use strict";
    const domains = Object.create(null);
    function clone(value) {
        if (value === undefined) { return undefined; }
        return JSON.parse(JSON.stringify(value));
    }
    function validId(value) { return typeof value === "string" && /^[a-z][a-z0-9_.:-]*$/.test(value); }
    function isThenable(value) { return value && (typeof value === "object" || typeof value === "function") && typeof value.then === "function"; }
    function registerDomain(domainId, descriptor) {
        if (!validId(domainId)) { return { ok: false, error: "invalid_domain_id" }; }
        if (domains[domainId]) { return { ok: false, error: "duplicate_domain_id" }; }
        const d = descriptor || {};
        if (d.validator !== undefined && typeof d.validator !== "function") { return { ok: false, error: "invalid_domain_validator" }; }
        domains[domainId] = { id: domainId, validator: d.validator || null, metadata: clone(d.metadata || {}), definitions: Object.create(null) };
        return { ok: true, domainId: domainId };
    }
    function registerDomainValidator(domainId, validator) {
        const domain = domains[domainId]; if (!domain) { return { ok: false, error: "unregistered_domain" }; }
        if (typeof validator !== "function") { return { ok: false, error: "invalid_domain_validator" }; }
        if (domain.validator) { return { ok: false, error: "duplicate_domain_validator" }; }
        domain.validator = validator; return { ok: true };
    }
    function hasDomain(domainId) { return Boolean(domains[domainId]); }
    function hasDefinition(domainId, definitionId) { return Boolean(domains[domainId] && domains[domainId].definitions[definitionId]); }
    function getDefinition(domainId, definitionId) {
        const record = domains[domainId] && domains[domainId].definitions[definitionId];
        return record ? clone(record.definitionData) : null;
    }
    function getDefinitionRecord(domainId, definitionId) {
        const record = domains[domainId] && domains[domainId].definitions[definitionId]; return record ? clone(record) : null;
    }
    function listDefinitions(domainId) {
        if (!domains[domainId]) { return []; }
        return Object.keys(domains[domainId].definitions).sort().map(function (id) { return clone(domains[domainId].definitions[id].definitionData); });
    }
    function validateDefinition(domainId, definitionId, definitionData) {
        const domain = domains[domainId];
        if (!domain) { return { ok: false, error: "unregistered_domain" }; }
        if (!validId(definitionId)) { return { ok: false, error: "invalid_definition_id" }; }
        let data;
        try { data = clone(Object.assign({}, definitionData || {}, { id: definitionId })); }
        catch (e) { return { ok: false, error: "definition_not_serializable" }; }
        if (domain.validator) {
            let output;
            try {
                output = domain.validator(data, Object.freeze({ hasDefinition: hasDefinition, getDefinition: getDefinition, listDefinitions: listDefinitions }));
            } catch (e) { return { ok: false, error: "definition_validator_exception", detail: String(e && e.message || e) }; }
            if (isThenable(output)) { return { ok: false, error: "unsupported_async_validator" }; }
            if (output !== true && !(output && output.ok === true)) {
                return { ok: false, error: "invalid_definition", errors: Array.isArray(output) ? clone(output) : clone(output && output.errors || [String(output || "validator_rejected")]) };
            }
        }
        const refs = Array.isArray(data.referenceDefinitions) ? data.referenceDefinitions : [];
        for (const ref of refs) {
            if (!ref || !validId(ref.domainId) || !validId(ref.definitionId) || !hasDefinition(ref.domainId, ref.definitionId)) {
                return { ok: false, error: "missing_reference_definition", reference: clone(ref) };
            }
        }
        return { ok: true, definitionData: data };
    }
    function registerDefinition(domainId, definitionId, definitionData, options) {
        const domain = domains[domainId]; if (!domain) { return { ok: false, error: "unregistered_domain" }; }
        if (hasDefinition(domainId, definitionId)) { return { ok: false, error: "duplicate_definition_id" }; }
        const validation = validateDefinition(domainId, definitionId, definitionData); if (!validation.ok) { return validation; }
        const opts = options || {};
        const record = {
            domainId: domainId,
            definitionId: definitionId,
            definitionVersion: Number.isInteger(opts.definitionVersion) ? opts.definitionVersion : 1,
            sourceType: opts.sourceType || "trusted_runtime",
            sourceRef: clone(opts.sourceRef || null),
            approvalStatus: opts.approvalStatus || "approved",
            definitionData: validation.definitionData
        };
        if (record.approvalStatus !== "approved") { return { ok: false, error: "definition_not_approved" }; }
        domain.definitions[definitionId] = Object.freeze(record);
        return { ok: true, definition: clone(record.definitionData), record: clone(record) };
    }
    function registerDefaultDefinition(domainId, definition) {
        const d = clone(definition || {}); return registerDefinition(domainId, d.id, d, { sourceType: "default_catalog", approvalStatus: "approved", definitionVersion: d.definitionVersion });
    }
    function registerApprovedDefinition(domainId, definitionId, definitionData, metadata) {
        const m = metadata || {}; return registerDefinition(domainId, definitionId, definitionData, { sourceType: m.sourceType || "approved_custom", sourceRef: m.sourceRef || null, approvalStatus: "approved", definitionVersion: m.definitionVersion });
    }
    function getSnapshot() {
        const output = { schemaVersion: 1, domains: {} };
        Object.keys(domains).sort().forEach(function (domainId) {
            output.domains[domainId] = { metadata: clone(domains[domainId].metadata), definitions: {} };
            Object.keys(domains[domainId].definitions).sort().forEach(function (definitionId) { output.domains[domainId].definitions[definitionId] = clone(domains[domainId].definitions[definitionId]); });
        });
        return output;
    }
    window.ArsDefinitionRegistry = Object.freeze({
        registerDomain: registerDomain, registerDomainValidator: registerDomainValidator, hasDomain: hasDomain,
        validateDefinition: validateDefinition, registerDefinition: registerDefinition, registerDefaultDefinition: registerDefaultDefinition, registerApprovedDefinition: registerApprovedDefinition,
        hasDefinition: hasDefinition, getDefinition: getDefinition, getDefinitionRecord: getDefinitionRecord, listDefinitions: listDefinitions, getSnapshot: getSnapshot
    });
})();
