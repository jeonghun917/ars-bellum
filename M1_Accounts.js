// Ars Bellum M1 - Finance account state using Definition Registry
(function () {
    "use strict";
    const registry = window.ArsDefinitionRegistry;
    const policyValidators = Object.create(null);

    function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
    function sameCanonical(a,b){const x=clone(a),y=clone(b);if(x&&y){y.revision=x.revision;}return window.ArsM1AtomicCoordinator._canonicalStringify(x)===window.ArsM1AtomicCoordinator._canonicalStringify(y);}
    function root() { return window.ArsGameState.getState().world.finance.accounts; }
    function validId(v) { return typeof v === "string" && /^[a-z][a-z0-9_.:-]*$/.test(v); }
    function ensureDomain(id, validator) { if (!registry.hasDomain(id)) { registry.registerDomain(id, { validator: validator }); } }

    ensureDomain("owner_ref_type", function (d) { return Array.isArray(d.capabilityTags || []) ? true : ["invalid_capability_tags"]; });
    ensureDomain("legal_regime", function () { return true; });
    ensureDomain("account_type", function (d, api) {
        const errors = [];
        if (d.allowedOwnerTypeIds !== null && d.allowedOwnerTypeIds !== undefined && !Array.isArray(d.allowedOwnerTypeIds)) { errors.push("invalid_allowed_owner_types"); }
        (d.allowedOwnerTypeIds || []).forEach(function (id) { if (!api.hasDefinition("owner_ref_type", id)) { errors.push("missing_owner_type_reference:" + id); } });
        return errors.length ? errors : true;
    });

    function addDefault(domain, definition) {
        if (!registry.hasDefinition(domain, definition.id)) {
            const result = registry.registerDefaultDefinition(domain, definition);
            if (!result.ok) { throw new Error(domain + ":" + definition.id + ":" + result.error); }
        }
    }

    addDefault("owner_ref_type", { id: "character", capabilityTags: ["can_own_account", "can_hold_title", "can_hold_land_right", "can_be_inheritance_beneficiary"] });
    addDefault("owner_ref_type", { id: "mobile_group", capabilityTags: ["can_own_account"] });
    addDefault("owner_ref_type", { id: "clan", capabilityTags: ["can_own_account", "can_hold_title", "can_hold_land_right", "can_be_inheritance_beneficiary"] });
    addDefault("owner_ref_type", { id: "settlement", capabilityTags: ["can_own_account", "can_be_right_subject"] });
    addDefault("owner_ref_type", { id: "faction", capabilityTags: ["can_own_account", "can_hold_title", "can_hold_land_right", "can_be_inheritance_beneficiary"] });
    addDefault("owner_ref_type", { id: "title", capabilityTags: ["can_be_right_basis"] });
    addDefault("owner_ref_type", { id: "land_right", capabilityTags: ["can_be_right_basis"] });

    ["patrimonial", "customary_feudal", "separated_finance", "bureaucratic_state"].forEach(function (id) { addDefault("legal_regime", { id: id }); });
    addDefault("account_type", { id: "personal", allowedOwnerTypeIds: ["character"], capabilityTags: ["personal_wealth"] });
    addDefault("account_type", { id: "party", allowedOwnerTypeIds: ["mobile_group"], capabilityTags: ["operational_funds"] });
    addDefault("account_type", { id: "clan", allowedOwnerTypeIds: ["clan"], capabilityTags: ["organization_treasury"] });
    addDefault("account_type", { id: "settlement", allowedOwnerTypeIds: ["settlement"], capabilityTags: ["public_budget"] });
    addDefault("account_type", { id: "state", allowedOwnerTypeIds: ["faction"], capabilityTags: ["sovereign_budget"] });

    function createDefault(input) {
        const x = clone(input || {});
        const owner = x.ownerRef || ((x.ownerType || x.ownerId) ? { type: x.ownerType, id: x.ownerId } : null);
        const result = Object.assign({}, x, {
            id: x.id,
            version: Number.isInteger(x.version) ? x.version : 1,
            revision: Number.isInteger(x.revision) && x.revision >= 0 ? x.revision : 0,
            accountTypeId: x.accountTypeId || x.accountType,
            ownerRef: owner ? { type: owner.type, id: owner.id } : null,
            currencyId: x.currencyId || "gold",
            balance: Number(x.balance) || 0,
            legalRegimeId: x.legalRegimeId == null ? null : String(x.legalRegimeId),
            reserveTarget: Math.max(0, Number(x.reserveTarget) || 0),
            budgetPolicyId: x.budgetPolicyId == null ? null : String(x.budgetPolicyId),
            authorizedSpenders: Array.from(new Set((Array.isArray(x.authorizedSpenders) ? x.authorizedSpenders : []).filter(validId))),
            frozen: Boolean(x.frozen),
            lastTransactionId: x.lastTransactionId == null ? null : String(x.lastTransactionId),
            customData: x.customData && typeof x.customData === "object" ? clone(x.customData) : {}
        });
        delete result.accountType; delete result.ownerType; delete result.ownerId;
        return result;
    }

    function validate(account) {
        const errors = [];
        if (!account || !validId(account.id)) { errors.push("invalid_account_id"); }
        if (account && account.version > 1) { errors.push("unsupported_future_version"); }
        const definition = registry.getDefinition("account_type", account && account.accountTypeId);
        if (!definition) { errors.push("unregistered_account_type"); }
        const ownerDefinition = account && account.ownerRef ? registry.getDefinition("owner_ref_type", account.ownerRef.type) : null;
        if (!account || !account.ownerRef || !ownerDefinition || !validId(account.ownerRef.id)) { errors.push("invalid_owner_ref"); }
        if (ownerDefinition && (ownerDefinition.capabilityTags || []).indexOf("can_own_account") < 0) { errors.push("owner_lacks_account_capability"); }
        if (definition && definition.allowedOwnerTypeIds != null && definition.allowedOwnerTypeIds.indexOf(account.ownerRef.type) < 0) { errors.push("owner_type_not_allowed"); }
        if (account && account.legalRegimeId && !registry.hasDefinition("legal_regime", account.legalRegimeId)) { errors.push("unregistered_legal_regime"); }
        if (!account || !validId(account.currencyId)) { errors.push("invalid_currency_id"); }
        if (!account || !Number.isFinite(account.balance) || account.balance < 0) { errors.push("invalid_balance"); }
        if (!account || !Number.isInteger(account.revision) || account.revision < 0) { errors.push("invalid_revision"); }
        return errors;
    }

    function createAccount(input) {
        const next = createDefault(input);
        if (root()[next.id]) { return { ok: false, error: "duplicate_account_id" }; }
        const errors = validate(next);
        if (errors.length) { return { ok: false, error: "invalid_account", errors: errors }; }
        root()[next.id] = next;
        return { ok: true, account: getAccountSnapshot(next.id) };
    }

    function getAccountSnapshot(id) {
        const account = root()[id];
        if (!account) { return null; }
        const snapshot = clone(account);
        snapshot.accountType = snapshot.accountTypeId;
        snapshot.ownerType = snapshot.ownerRef.type;
        snapshot.ownerId = snapshot.ownerRef.id;
        return snapshot;
    }
    function canonicalSnapshot(id) { return root()[id] ? clone(root()[id]) : null; }
    function listAccounts() { return Object.keys(root()).sort().map(getAccountSnapshot); }
    function findByOwner(ref) { return listAccounts().filter(function (a) { return a.ownerRef.type === ref.type && a.ownerRef.id === ref.id; }); }

    function applyPrepared(id, expectedRevision, nextValue) {
        const current = root()[id];
        if (!current) { return { ok: false, error: "missing_account" }; }
        if (current.revision !== expectedRevision) { return { ok: false, error: "revision_conflict" }; }
        const next = createDefault(Object.assign({}, nextValue, { id: id, revision: current.revision + 1 }));
        const errors = validate(next);
        if (errors.length) { return { ok: false, error: "invalid_account", errors: errors }; }
        root()[id] = next;
        return { ok: true, account: getAccountSnapshot(id) };
    }

    function registerPolicyValidator(id, fn) {
        if (!validId(id) || typeof fn !== "function") { return { ok: false, error: "invalid_policy_validator" }; }
        if (policyValidators[id]) { return { ok: false, error: "duplicate_policy_validator" }; }
        policyValidators[id] = fn;
        return { ok: true };
    }
    function validatePolicy(account, context) {
        const definition = registry.getDefinition("account_type", account.accountTypeId) || {};
        const ids = [account.budgetPolicyId, definition.authorizationPolicyId, definition.budgetPolicyId].filter(Boolean);
        for (const id of ids) {
            if (policyValidators[id]) {
                const verdict = policyValidators[id](clone(account), clone(context || {}));
                if (verdict !== true) { return { ok: false, error: "policy_rejected", policyId: id, detail: verdict }; }
            }
        }
        return { ok: true };
    }

    function atomicCommit(id, expectedRevision, nextValue, allowCreate) {
        const current = root()[id] || null;
        if (!current && !allowCreate) { return { ok: false, error: "missing_account" }; }
        if (current && current.revision !== expectedRevision) { return { ok: false, error: "revision_conflict" }; }
        if (!current && expectedRevision !== null) { return { ok: false, error: "expected_absence_required" }; }
        const next = createDefault(Object.assign({}, nextValue || {}, { id: id }));
        next.revision = current ? current.revision + 1 : 0;
        const errors = validate(next);
        if (errors.length) { return { ok: false, error: "invalid_account", errors: errors }; }
        root()[id] = next;
        return { ok: true, account: getAccountSnapshot(id) };
    }
    function atomicRestore(id, snapshot) {
        if (snapshot == null) { delete root()[id]; }
        else {
            const restored = clone(snapshot);
            delete restored.accountType; delete restored.ownerType; delete restored.ownerId;
            root()[id] = restored;
        }
        return { ok: true };
    }
    function registerDefinition(domain, definition) {
        const value = clone(definition || {});
        return registry.registerApprovedDefinition(domain, value.id, value, { sourceType: "trusted_runtime" });
    }

    window.ArsFinanceState = Object.freeze({
        createDefault: createDefault, create: createAccount, createAccount: createAccount,
        getSnapshot: getAccountSnapshot, getAccountSnapshot: getAccountSnapshot,
        list: listAccounts, listAccounts: listAccounts, findByOwner: findByOwner, validate: validate,
        normalize: function (id) {
            const account = root()[id]; if (!account) { return { ok: false, error: "missing_account" }; }
            const next = createDefault(account), errors = validate(next);
            if (errors.length) { return { ok: false, error: "normalization_failed", errors: errors }; }
            root()[id] = next; return { ok: true, account: getAccountSnapshot(id) };
        },
        registerOwnerType: function (d) { return registerDefinition("owner_ref_type", d); },
        registerAccountType: function (d) { return registerDefinition("account_type", d); },
        registerLegalRegime: function (d) { return registerDefinition("legal_regime", d); },
        getOwnerTypeDefinition: function (id) { return registry.getDefinition("owner_ref_type", id); },
        getAccountTypeDefinition: function (id) { return registry.getDefinition("account_type", id); },
        listOwnerTypeDefinitions: function () { return registry.listDefinitions("owner_ref_type"); },
        listAccountTypeDefinitions: function () { return registry.listDefinitions("account_type"); },
        registerPolicyValidator: registerPolicyValidator, validatePolicy: validatePolicy,
        _getCanonicalSnapshot: canonicalSnapshot, _applyPrepared: applyPrepared,
        _atomicCommit: atomicCommit, _atomicRestore: atomicRestore
    });

    if (window.ArsM1AtomicCoordinator) {
        const registration = window.ArsM1AtomicCoordinator.registerParticipant("account", {
            prepare: function (operations) {
                const before = {}, after = {}, normalized = [];
                for (const operation of operations) {
                    if (operation.targetRef.type !== "account") { return { ok: false, error: "m156_invalid_account_target" }; }
                    const id = operation.targetRef.id, current = canonicalSnapshot(id);
                    if (!current) { return { ok: false, error: "m156_missing_asset", details: "account:" + id }; }
                    if (operation.expectedRevision !== current.revision) { return { ok: false, error: "m156_revision_conflict" }; }
                    const next = clone(current), payload = operation.payload || {};
                    if (operation.command === "account.transfer_owner") {
                        if (!payload.nextOwnerRef) { return { ok: false, error: "m156_invalid_owner_ref" }; }
                        const refResult = window.ArsRefRegistry.validateRef(payload.nextOwnerRef, "can_own_account");
                        if (!refResult.ok) { return refResult; }
                        next.ownerRef = clone(payload.nextOwnerRef);
                    } else if (operation.command === "account.adjust_balance") {
                        if (!Number.isSafeInteger(payload.delta)) { return { ok: false, error: "m156_asset_minimum_unit_violation" }; }
                        next.balance += payload.delta;
                        if (next.balance < 0) { return { ok: false, error: "insufficient_balance" }; }
                        if (payload.lastTransactionId != null) { next.lastTransactionId = String(payload.lastTransactionId); }
                    } else if (operation.command === "account.replace") {
                        Object.assign(next, clone(payload.nextValue || {})); next.id = id;
                    } else { return { ok: false, error: "m156_unsupported_account_command" }; }
                    const canonicalNext = createDefault(next);
                    if (sameCanonical(current, canonicalNext)) { return { ok: false, error: "no_change" }; }
                    canonicalNext.revision = current.revision + 1;
                    const errors = validate(canonicalNext);
                    if (errors.length) { return { ok: false, error: "invalid_account", details: errors }; }
                    before[id] = current; after[id] = canonicalNext; normalized.push(clone(operation));
                }
                return { ok: true, domainId: "account", normalizedOperations: normalized, beforeSnapshots: before, plannedSnapshots: after, rollbackData: before, eventDescriptors: [] };
            },
            commitPrepared: function (prepared) {
                const committed = [];
                for (const id of Object.keys(prepared.plannedSnapshots).sort()) {
                    const result = atomicCommit(id, prepared.beforeSnapshots[id].revision, prepared.plannedSnapshots[id], false);
                    if (!result.ok) {
                        for (let i = committed.length - 1; i >= 0; i -= 1) { atomicRestore(committed[i], prepared.beforeSnapshots[committed[i]]); }
                        return { ok: false, error: "account:" + result.error };
                    }
                    committed.push(id);
                }
                return { ok: true, rollbackToken: { beforeSnapshots: clone(prepared.beforeSnapshots) } };
            },
            rollbackCommitted: function (token) {
                for (const id of Object.keys(token.beforeSnapshots || {}).sort().reverse()) { atomicRestore(id, token.beforeSnapshots[id]); }
                return { ok: true };
            },
            verifyCommitted: function (prepared) {
                for (const id of Object.keys(prepared.plannedSnapshots)) {
                    const actual = canonicalSnapshot(id), expected = prepared.plannedSnapshots[id];
                    if (window.ArsM1AtomicCoordinator._canonicalStringify(actual) !== window.ArsM1AtomicCoordinator._canonicalStringify(expected)) { return { ok: false, error: "account_verify_mismatch:" + id }; }
                }
                return { ok: true };
            }
        });
        if (!registration.ok) { throw new Error(registration.error); }
    }
})();
