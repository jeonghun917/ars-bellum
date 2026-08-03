// Ars Bellum M1 - Atomic account transfers and M1-5/6 transfer-record participant
(function () {
    "use strict";
    let sequence = 0;
    function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
    function transfers() { return window.ArsGameState.getState().world.finance.transfers; }
    function validId(v) { return typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(v); }

    function findByIdempotencyKey(key) {
        if (!key) { return null; }
        for (const id of Object.keys(transfers())) {
            const record = transfers()[id];
            if (record && record.idempotencyKey === key) { return clone(record); }
        }
        return null;
    }
    function makeId() {
        let id;
        do { sequence += 1; id = "transfer_" + sequence; } while (transfers()[id]);
        return id;
    }
    function validateRecord(record) {
        const errors = [];
        if (!record || !validId(record.id)) { errors.push("invalid_transfer_id"); }
        if (record && record.version > 1) { errors.push("unsupported_future_version"); }
        if (!record || !Number.isInteger(record.revision) || record.revision < 0) { errors.push("invalid_revision"); }
        if (!record || !Number.isFinite(record.amount) || record.amount <= 0) { errors.push("invalid_amount"); }
        if (!record || !validId(record.currencyId)) { errors.push("invalid_currency_id"); }
        return errors;
    }

    function commitTransaction(plan) {
        const p = plan || {};
        const replay = findByIdempotencyKey(p.idempotencyKey);
        if (replay) { return { ok: true, replayed: true, transaction: replay }; }
        const amount = Number(p.amount);
        if (!Number.isFinite(amount) || amount <= 0) { return { ok: false, error: "invalid_amount" }; }
        if (p.fromAccountId && p.toAccountId && p.fromAccountId === p.toAccountId) { return { ok: false, error: "same_account_transfer" }; }
        const from = p.fromAccountId ? window.ArsFinanceState.getAccountSnapshot(p.fromAccountId) : null;
        const to = p.toAccountId ? window.ArsFinanceState.getAccountSnapshot(p.toAccountId) : null;
        if (!from && !to) { return { ok: false, error: "missing_transaction_endpoint" }; }
        if (p.fromAccountId && !from) { return { ok: false, error: "missing_from_account" }; }
        if (p.toAccountId && !to) { return { ok: false, error: "missing_to_account" }; }
        if (from && to && from.currencyId !== to.currencyId) { return { ok: false, error: "currency_mismatch" }; }
        if (from && p.expectedFromRevision !== undefined && p.expectedFromRevision !== from.revision) { return { ok: false, error: "revision_conflict" }; }
        if (to && p.expectedToRevision !== undefined && p.expectedToRevision !== to.revision) { return { ok: false, error: "revision_conflict" }; }
        if ((from && from.frozen) || (to && to.frozen)) { return { ok: false, error: "account_frozen" }; }
        if (from && from.balance - amount < 0) { return { ok: false, error: "insufficient_balance" }; }
        if (from && from.balance - amount < from.reserveTarget && !p.emergency) { return { ok: false, error: "reserve_violation" }; }
        if (from) { const policy = window.ArsFinanceState.validatePolicy(from, p); if (!policy.ok) { return policy; } }
        const transactionId = p.transactionId || makeId();
        if (transfers()[transactionId]) { return { ok: false, error: "duplicate_transaction_id" }; }
        let record;
        try {
            record = clone({
                id: transactionId, version: 1, revision: 0,
                fromAccountId: from ? from.id : null, toAccountId: to ? to.id : null,
                currencyId: (from || to).currencyId, amount: amount,
                reasonTypeId: p.reasonTypeId || "unspecified", sourceRef: p.sourceRef || null,
                customData: p.customData || {}, emergency: Boolean(p.emergency),
                audit: p.emergency ? { required: true, status: "pending" } : null,
                idempotencyKey: p.idempotencyKey || null,
                createdDay: Number.isInteger(p.createdDay) ? p.createdDay : null
            });
        } catch (error) { return { ok: false, error: "transaction_not_serializable" }; }
        const recordErrors = validateRecord(record);
        if (recordErrors.length) { return { ok: false, error: "invalid_transfer_record", errors: recordErrors }; }
        const committed = [];
        function restoreAll() {
            for (let i = committed.length - 1; i >= 0; i -= 1) { window.ArsFinanceState._atomicRestore(committed[i].id, committed[i].snapshot); }
        }
        try {
            if (from) {
                const next = Object.assign({}, from, { balance: from.balance - amount, lastTransactionId: transactionId });
                const result = window.ArsFinanceState._atomicCommit(from.id, from.revision, next, false);
                if (!result.ok) { return result; }
                committed.push({ id: from.id, snapshot: from });
            }
            if (to) {
                const next = Object.assign({}, to, { balance: to.balance + amount, lastTransactionId: transactionId });
                const result = window.ArsFinanceState._atomicCommit(to.id, to.revision, next, false);
                if (!result.ok) { restoreAll(); return { ok: false, error: "atomic_commit_failed", cause: result.error }; }
                committed.push({ id: to.id, snapshot: to });
            }
        } catch (error) {
            restoreAll(); return { ok: false, error: "atomic_commit_failed", detail: String(error && error.message || error) };
        }
        try { transfers()[transactionId] = record; }
        catch (error) { restoreAll(); return { ok: false, error: "transaction_record_commit_failed" }; }
        return { ok: true, transaction: clone(record), fromAccount: from ? window.ArsFinanceState.getAccountSnapshot(from.id) : null, toAccount: to ? window.ArsFinanceState.getAccountSnapshot(to.id) : null };
    }

    function getSnapshot(id) { return transfers()[id] ? clone(transfers()[id]) : null; }
    function atomicCommitRecord(id, expectedRevision, nextValue, allowCreate) {
        const current = transfers()[id] || null;
        if (!current && !allowCreate) { return { ok: false, error: "missing_transfer" }; }
        if (current && current.revision !== expectedRevision) { return { ok: false, error: "revision_conflict" }; }
        if (!current && expectedRevision !== null) { return { ok: false, error: "expected_absence_required" }; }
        const next = clone(Object.assign({}, nextValue || {}, { id: id, version: 1, revision: current ? current.revision + 1 : 0 }));
        const errors = validateRecord(next);
        if (errors.length) { return { ok: false, error: "invalid_transfer_record", errors: errors }; }
        transfers()[id] = next;
        return { ok: true, transaction: getSnapshot(id) };
    }
    function atomicRestoreRecord(id, snapshot) { if (snapshot == null) { delete transfers()[id]; } else { transfers()[id] = clone(snapshot); } return { ok: true }; }

    window.ArsTransferSystem = Object.freeze({
        commitTransaction: commitTransaction, transfer: commitTransaction,
        deposit: function (p) { return commitTransaction(Object.assign({}, p, { fromAccountId: null })); },
        withdraw: function (p) { return commitTransaction(Object.assign({}, p, { toAccountId: null })); },
        getSnapshot: getSnapshot,
        list: function () { return Object.keys(transfers()).sort().map(getSnapshot); },
        _atomicCommit: atomicCommitRecord, _atomicRestore: atomicRestoreRecord
    });

    if (window.ArsM1AtomicCoordinator) {
        const participantResult = window.ArsM1AtomicCoordinator.registerParticipant("transfer", {
            prepare: function (operations) {
                const before = {}, after = {}, normalized = [];
                for (const operation of operations) {
                    if (operation.targetRef.type !== "transfer") { return { ok: false, error: "m156_invalid_transfer_target" }; }
                    if (operation.command !== "transfer.record") { return { ok: false, error: "m156_unsupported_transfer_command" }; }
                    const id = operation.targetRef.id, current = getSnapshot(id);
                    if (current || operation.expectedRevision !== null) { return { ok: false, error: current ? "m156_duplicate_target_operation" : "m156_expected_absence_required" }; }
                    const next = clone(Object.assign({}, operation.payload.record || {}, { id: id, version: 1, revision: 0 }));
                    if (!Number.isSafeInteger(next.amount) || next.amount <= 0) { return { ok: false, error: "m156_asset_minimum_unit_violation" }; }
                    const errors = validateRecord(next);
                    if (errors.length) { return { ok: false, error: "invalid_transfer_record", details: errors }; }
                    before[id] = null; after[id] = next; normalized.push(clone(operation));
                }
                return { ok: true, domainId: "transfer", normalizedOperations: normalized, beforeSnapshots: before, plannedSnapshots: after, rollbackData: before, eventDescriptors: [] };
            },
            commitPrepared: function (prepared) {
                const committed = [];
                for (const id of Object.keys(prepared.plannedSnapshots).sort()) {
                    const result = atomicCommitRecord(id, null, prepared.plannedSnapshots[id], true);
                    if (!result.ok) {
                        for (let i = committed.length - 1; i >= 0; i -= 1) { atomicRestoreRecord(committed[i], null); }
                        return { ok: false, error: "transfer:" + result.error };
                    }
                    committed.push(id);
                }
                return { ok: true, rollbackToken: { beforeSnapshots: clone(prepared.beforeSnapshots) } };
            },
            rollbackCommitted: function (token) { Object.keys(token.beforeSnapshots || {}).sort().reverse().forEach(function (id) { atomicRestoreRecord(id, token.beforeSnapshots[id]); }); return { ok: true }; },
            verifyCommitted: function (prepared) { for (const id of Object.keys(prepared.plannedSnapshots)) { if (window.ArsM1AtomicCoordinator._canonicalStringify(getSnapshot(id)) !== window.ArsM1AtomicCoordinator._canonicalStringify(prepared.plannedSnapshots[id])) { return { ok: false, error: "transfer_verify_mismatch:" + id }; } } return { ok: true }; }
        });
        if (!participantResult.ok) { throw new Error(participantResult.error); }
    }
})();
