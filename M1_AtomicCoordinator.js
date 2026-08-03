// Ars Bellum M1-5/6 - Synchronous multi-domain atomic coordinator
(function () {
    "use strict";

    const DOMAIN_ORDER = [
        "character", "clan", "faction", "title", "land_right",
        "account", "inventory", "transfer", "player_control"
    ];
    const participants = Object.create(null);
    const validators = Object.create(null);
    const listeners = Object.create(null);
    const successReceipts = Object.create(null);
    let executing = false;

    function validId(value) {
        return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value);
    }

    function plain(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) { return false; }
        const proto = Object.getPrototypeOf(value);
        return proto === Object.prototype || proto === null;
    }

    function isThenable(value) {
        return Boolean(value) && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
    }

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function deepFreeze(value) {
        if (!value || typeof value !== "object" || Object.isFrozen(value)) { return value; }
        Object.freeze(value);
        Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
        return value;
    }

    function normalizeJson(value, path, stack) {
        const where = path || "$";
        if (value === null || typeof value === "string" || typeof value === "boolean") { return value; }
        if (typeof value === "number") {
            if (!Number.isFinite(value)) { throw new Error("non_finite_number:" + where); }
            return Object.is(value, -0) ? 0 : value;
        }
        if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
            throw new Error("unsupported_json_value:" + where);
        }
        if (typeof value !== "object") { throw new Error("unsupported_json_value:" + where); }
        if (stack.indexOf(value) >= 0) { throw new Error("cyclic_json_value:" + where); }
        stack.push(value);
        let output;
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i += 1) {
                if (!Object.prototype.hasOwnProperty.call(value, i)) { throw new Error("sparse_array:" + where); }
            }
            output = value.map(function (item, index) { return normalizeJson(item, where + "[" + index + "]", stack); });
        } else {
            if (!plain(value)) { throw new Error("non_plain_object:" + where); }
            output = {};
            Object.keys(value).sort().forEach(function (key) {
                output[key] = normalizeJson(value[key], where + "." + key, stack);
            });
        }
        stack.pop();
        return output;
    }

    function canonicalStringify(value) {
        return JSON.stringify(normalizeJson(value, "$", []));
    }

    // Compact synchronous SHA-256 over UTF-8 bytes.
    function sha256(text) {
        const bytes = [];
        const encoded = unescape(encodeURIComponent(text));
        for (let i = 0; i < encoded.length; i += 1) { bytes.push(encoded.charCodeAt(i)); }
        const bitLength = bytes.length * 8;
        bytes.push(0x80);
        while ((bytes.length % 64) !== 56) { bytes.push(0); }
        const high = Math.floor(bitLength / 0x100000000);
        const low = bitLength >>> 0;
        for (let shift = 24; shift >= 0; shift -= 8) { bytes.push((high >>> shift) & 0xff); }
        for (let shift = 24; shift >= 0; shift -= 8) { bytes.push((low >>> shift) & 0xff); }

        const K = [
            0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
            0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
            0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
            0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
            0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
            0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
            0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
            0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
        ];
        let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
        function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
        for (let offset = 0; offset < bytes.length; offset += 64) {
            const w = new Array(64);
            for (let i = 0; i < 16; i += 1) {
                const j = offset + i * 4;
                w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
            }
            for (let i = 16; i < 64; i += 1) {
                const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
            }
            let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
            for (let i = 0; i < 64; i += 1) {
                const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                const ch = (e & f) ^ ((~e) & g);
                const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
                const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
                const maj = (a & b) ^ (a & c) ^ (b & c);
                const t2 = (S0 + maj) >>> 0;
                h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
            }
            H = [
                (H[0]+a)>>>0,(H[1]+b)>>>0,(H[2]+c)>>>0,(H[3]+d)>>>0,
                (H[4]+e)>>>0,(H[5]+f)>>>0,(H[6]+g)>>>0,(H[7]+h)>>>0
            ];
        }
        return H.map(function (x) { return ("00000000" + x.toString(16)).slice(-8); }).join("");
    }

    function result(ok, error, details, transactionId, digest, value, warnings) {
        return {
            ok: ok,
            error: ok ? null : error,
            details: details == null ? null : details,
            transactionId: transactionId || null,
            digest: digest || null,
            value: ok ? (value == null ? null : value) : null,
            warnings: Array.isArray(warnings) ? warnings.slice() : []
        };
    }

    function registerParticipant(domainId, adapter) {
        if (DOMAIN_ORDER.indexOf(domainId) < 0) { return { ok: false, error: "m156_invalid_participant_domain" }; }
        if (participants[domainId]) { return { ok: false, error: "m156_duplicate_participant:" + domainId }; }
        const required = ["prepare", "commitPrepared", "rollbackCommitted", "verifyCommitted"];
        if (!adapter || required.some(function (name) { return typeof adapter[name] !== "function"; })) {
            return { ok: false, error: "m156_invalid_participant_adapter" };
        }
        participants[domainId] = adapter;
        return { ok: true, domainId: domainId };
    }

    function registerGlobalValidator(validatorId, validator) {
        if (!validId(validatorId) || typeof validator !== "function") { return { ok: false, error: "m156_invalid_global_validator" }; }
        if (validators[validatorId]) { return { ok: false, error: "m156_duplicate_global_validator:" + validatorId }; }
        validators[validatorId] = validator;
        return { ok: true, validatorId: validatorId };
    }

    function subscribe(eventType, listenerId, listener) {
        if (!validId(eventType) || !validId(listenerId) || typeof listener !== "function") { return { ok: false, error: "m156_invalid_listener" }; }
        if (!listeners[eventType]) { listeners[eventType] = Object.create(null); }
        if (listeners[eventType][listenerId]) { return { ok: false, error: "m156_duplicate_listener:" + listenerId }; }
        listeners[eventType][listenerId] = listener;
        return { ok: true };
    }

    function unsubscribe(eventType, listenerId) {
        if (!listeners[eventType] || !listeners[eventType][listenerId]) { return { ok: false, error: "m156_missing_listener" }; }
        delete listeners[eventType][listenerId];
        return { ok: true };
    }

    function operationSort(a, b) {
        const fieldsA = [a.targetRef.type, a.targetRef.id, a.command, a.operationId];
        const fieldsB = [b.targetRef.type, b.targetRef.id, b.command, b.operationId];
        for (let i = 0; i < fieldsA.length; i += 1) {
            if (fieldsA[i] < fieldsB[i]) { return -1; }
            if (fieldsA[i] > fieldsB[i]) { return 1; }
        }
        return 0;
    }

    function validateAndSortPlan(plan) {
        if (!plain(plan) || !validId(plan.transactionId) || !Array.isArray(plan.operations)) {
            return { ok: false, error: "m156_invalid_transaction_plan" };
        }
        const ids = Object.create(null);
        const targets = Object.create(null);
        const sorted = [];
        for (const raw of plan.operations) {
            if (!plain(raw) || !validId(raw.operationId) || DOMAIN_ORDER.indexOf(raw.domainId) < 0 || !validId(raw.command) || !plain(raw.targetRef) || !validId(raw.targetRef.type) || !validId(raw.targetRef.id)) {
                return { ok: false, error: "m156_invalid_operation_envelope" };
            }
            if (ids[raw.operationId]) { return { ok: false, error: "m156_duplicate_operation_id" }; }
            ids[raw.operationId] = true;
            if (raw.expectedRevision !== null && (!Number.isInteger(raw.expectedRevision) || raw.expectedRevision < 0)) {
                return { ok: false, error: "m156_invalid_expected_revision" };
            }
            const targetKey = raw.domainId + ":" + raw.targetRef.type + ":" + raw.targetRef.id;
            if (targets[targetKey]) {
                return { ok: false, error: raw.domainId === "title" ? "m156_title_transition_required" : "m156_duplicate_target_operation" };
            }
            targets[targetKey] = true;
            sorted.push(normalizeJson({
                operationId: raw.operationId,
                domainId: raw.domainId,
                command: raw.command,
                targetRef: raw.targetRef,
                expectedRevision: raw.expectedRevision,
                payload: raw.payload == null ? {} : raw.payload,
                metadata: raw.metadata == null ? {} : raw.metadata
            }, "$.operation", []));
        }
        sorted.sort(function (a, b) {
            const da = DOMAIN_ORDER.indexOf(a.domainId), db = DOMAIN_ORDER.indexOf(b.domainId);
            return da === db ? operationSort(a, b) : da - db;
        });
        return { ok: true, plan: { transactionId: plan.transactionId, context: normalizeJson(plan.context == null ? {} : plan.context, "$.context", []), operations: sorted } };
    }

    function rollback(committed, context) {
        const failures = [];
        for (let i = committed.length - 1; i >= 0; i -= 1) {
            const item = committed[i];
            try {
                const r = participants[item.domainId].rollbackCommitted(item.rollbackToken, context);
                if (isThenable(r) || !r || r.ok !== true) { failures.push(item.domainId); }
            } catch (error) { failures.push(item.domainId); }
        }
        return failures;
    }

    function execute(rawPlan) {
        if (executing) { return result(false, "reentrant_transaction_forbidden", null, rawPlan && rawPlan.transactionId, null, null, []); }
        let checked;
        try { checked = validateAndSortPlan(rawPlan); }
        catch (error) { return result(false, "m156_nonserializable_plan", String(error && error.message || error), rawPlan && rawPlan.transactionId, null, null, []); }
        if (!checked.ok) { return result(false, checked.error, null, rawPlan && rawPlan.transactionId, null, null, []); }
        const plan = checked.plan;
        let digest;
        try { digest = "sha256:" + sha256(canonicalStringify(plan)); }
        catch (error) { return result(false, "m156_nonserializable_plan", String(error && error.message || error), plan.transactionId, null, null, []); }
        const prior = successReceipts[plan.transactionId];
        if (prior) {
            if (prior.digest !== digest) { return result(false, "m156_idempotency_conflict", null, plan.transactionId, digest, null, []); }
            return clone(prior);
        }
        const batches = Object.create(null);
        plan.operations.forEach(function (op) {
            if (!batches[op.domainId]) { batches[op.domainId] = []; }
            batches[op.domainId].push(op);
        });
        for (const domainId of Object.keys(batches)) {
            if (!participants[domainId]) { return result(false, "m156_missing_participant", domainId, plan.transactionId, digest, null, []); }
        }

        executing = true;
        const context = deepFreeze(clone({ transactionId: plan.transactionId, digest: digest, context: plan.context }));
        const preparedByDomain = Object.create(null);
        const projection = { transactionId: plan.transactionId, digest: digest, domains: {} };
        const eventDescriptors = [];
        try {
            for (const domainId of DOMAIN_ORDER) {
                if (!batches[domainId]) { continue; }
                let prepared;
                try { prepared = participants[domainId].prepare(deepFreeze(clone(batches[domainId])), context); }
                catch (error) { return result(false, "m156_prepare_failed", domainId + ":" + String(error && error.message || error), plan.transactionId, digest, null, []); }
                if (isThenable(prepared)) { return result(false, "m156_unsupported_async_participant", domainId, plan.transactionId, digest, null, []); }
                if (!prepared || prepared.ok === false) { return result(false, prepared && prepared.error || "m156_prepare_failed", domainId + ":" + String(prepared && prepared.details || ""), plan.transactionId, digest, null, []); }
                const serial = normalizeJson(prepared, "$.prepared." + domainId, []);
                preparedByDomain[domainId] = deepFreeze(clone(serial));
                projection.domains[domainId] = { before: clone(serial.beforeSnapshots || {}), after: clone(serial.plannedSnapshots || {}) };
                (serial.eventDescriptors || []).forEach(function (descriptor) { eventDescriptors.push(clone(descriptor)); });
            }
            const frozenProjection = deepFreeze(clone(normalizeJson(projection, "$.projection", [])));
            for (const validatorId of Object.keys(validators).sort()) {
                let verdict;
                try { verdict = validators[validatorId](frozenProjection, context); }
                catch (error) { return result(false, "m156_global_invariant_failed", validatorId + ":" + String(error && error.message || error), plan.transactionId, digest, null, []); }
                if (isThenable(verdict)) { return result(false, "m156_unsupported_async_validator", validatorId, plan.transactionId, digest, null, []); }
                if (verdict !== true && (!verdict || verdict.ok !== true)) {
                    return result(false, "m156_global_invariant_failed", validatorId + ":" + String(verdict && (verdict.error || verdict.details) || verdict), plan.transactionId, digest, null, []);
                }
            }
            normalizeJson(eventDescriptors, "$.events", []);

            const committed = [];
            for (const domainId of DOMAIN_ORDER) {
                if (!preparedByDomain[domainId]) { continue; }
                let commit;
                try { commit = participants[domainId].commitPrepared(preparedByDomain[domainId], context); }
                catch (error) {
                    const rollbackFailures = rollback(committed, context);
                    return result(false, rollbackFailures.length ? "m156_rollback_failed" : "m156_commit_failed", { domainId: domainId, cause: String(error && error.message || error), rollbackFailures: rollbackFailures }, plan.transactionId, digest, null, []);
                }
                if (isThenable(commit)) {
                    const rollbackFailures = rollback(committed, context);
                    return result(false, rollbackFailures.length ? "m156_rollback_failed" : "m156_unsupported_async_participant", { domainId: domainId, rollbackFailures: rollbackFailures }, plan.transactionId, digest, null, []);
                }
                if (!commit || commit.ok !== true) {
                    const rollbackFailures = rollback(committed, context);
                    return result(false, rollbackFailures.length ? "m156_rollback_failed" : (commit && commit.error || "m156_commit_failed"), { domainId: domainId, rollbackFailures: rollbackFailures }, plan.transactionId, digest, null, []);
                }
                committed.push({ domainId: domainId, rollbackToken: commit.rollbackToken });
            }
            for (const item of committed) {
                let verify;
                try { verify = participants[item.domainId].verifyCommitted(preparedByDomain[item.domainId], context); }
                catch (error) { verify = { ok: false, error: String(error && error.message || error) }; }
                if (isThenable(verify) || !verify || verify.ok !== true) {
                    const rollbackFailures = rollback(committed, context);
                    return result(false, rollbackFailures.length ? "m156_rollback_failed" : "m156_verify_failed", { domainId: item.domainId, cause: verify && verify.error, rollbackFailures: rollbackFailures }, plan.transactionId, digest, null, []);
                }
            }

            if (plan.context && plan.context.successionResolution === true) {
                eventDescriptors.push({
                    eventType: "succession_resolved",
                    targetId: String(plan.context.decedentCharacterId || "resolution"),
                    payload: {
                        cause: plan.context.cause,
                        currentDay: plan.context.currentDay,
                        decedentCharacterId: plan.context.decedentCharacterId,
                        resultTagIds: clone(plan.context.resultTagIds || []),
                        resolution: clone(plan.context.resolution || {})
                    }
                });
            }
            eventDescriptors.sort(function (a, b) {
                const aa = [String(a.eventType || ""), String(a.targetId || ""), String(a.eventId || "")];
                const bb = [String(b.eventType || ""), String(b.targetId || ""), String(b.eventId || "")];
                return aa.join("\0") < bb.join("\0") ? -1 : aa.join("\0") > bb.join("\0") ? 1 : 0;
            });
            const events = eventDescriptors.map(function (descriptor, sequence) {
                return deepFreeze(clone({
                    eventId: plan.transactionId + ":" + sequence,
                    eventType: descriptor.eventType,
                    transactionId: plan.transactionId,
                    planDigest: digest,
                    sequence: sequence,
                    payload: descriptor.payload == null ? {} : descriptor.payload
                }));
            });
            const receipt = result(true, null, null, plan.transactionId, digest, {
                domains: Object.keys(preparedByDomain).sort(),
                eventIds: events.map(function (event) { return event.eventId; })
            }, []);
            successReceipts[plan.transactionId] = deepFreeze(clone(receipt));

            const warnings = [];
            for (const event of events) {
                const byId = listeners[event.eventType] || {};
                for (const listenerId of Object.keys(byId).sort()) {
                    try { byId[listenerId](deepFreeze(clone(event))); }
                    catch (error) { warnings.push("event_listener_failed:" + event.eventType + ":" + listenerId); }
                }
            }
            receipt.warnings = warnings;
            successReceipts[plan.transactionId] = deepFreeze(clone(receipt));
            return clone(receipt);
        } catch (error) {
            return result(false, "m156_coordinator_failure", String(error && error.message || error), plan.transactionId, digest, null, []);
        } finally {
            executing = false;
        }
    }

    window.ArsM1AtomicCoordinator = Object.freeze({
        registerParticipant: registerParticipant,
        registerGlobalValidator: registerGlobalValidator,
        hasParticipant: function (domainId) { return Boolean(participants[domainId]); },
        getParticipantSnapshot: function () { return DOMAIN_ORDER.filter(function (id) { return Boolean(participants[id]); }); },
        execute: execute,
        subscribe: subscribe,
        unsubscribe: unsubscribe,
        _canonicalStringify: canonicalStringify,
        _sha256: sha256
    });
})();
