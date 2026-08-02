// Ars Bellum M1 - Atomic account transfers
(function () {
    "use strict";
    let sequence = 0;
    function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
    function transfers() { return window.ArsGameState.getState().world.finance.transfers; }
    function findByIdempotencyKey(key) {
        if (!key) { return null; }
        const ids = Object.keys(transfers());
        for (let i = 0; i < ids.length; i += 1) {
            const record = transfers()[ids[i]];
            if (record && record.idempotencyKey === key) { return clone(record); }
        }
        return null;
    }
    function makeId() {
        let id;
        do { sequence += 1; id = "transfer_" + sequence; } while (transfers()[id]);
        return id;
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
        } catch (e) { return { ok: false, error: "transaction_not_serializable" }; }
        const committed = [];
        function restoreAll() {
            for (let i = committed.length - 1; i >= 0; i -= 1) {
                window.ArsFinanceState._atomicRestore(committed[i].id, committed[i].snapshot);
            }
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
        } catch (e) {
            restoreAll();
            return { ok: false, error: "atomic_commit_failed", detail: String(e && e.message || e) };
        }
        try { transfers()[transactionId] = record; }
        catch (e) { restoreAll(); return { ok: false, error: "transaction_record_commit_failed" }; }
        return {
            ok: true, transaction: clone(record),
            fromAccount: from ? window.ArsFinanceState.getAccountSnapshot(from.id) : null,
            toAccount: to ? window.ArsFinanceState.getAccountSnapshot(to.id) : null
        };
    }
    function getSnapshot(id) { return transfers()[id] ? clone(transfers()[id]) : null; }
    window.ArsTransferSystem = Object.freeze({
        commitTransaction: commitTransaction, transfer: commitTransaction,
        deposit: function (p) { return commitTransaction(Object.assign({}, p, { fromAccountId: null })); },
        withdraw: function (p) { return commitTransaction(Object.assign({}, p, { toAccountId: null })); },
        getSnapshot: getSnapshot,
        list: function () { return Object.keys(transfers()).sort().map(getSnapshot); }
    });
})();
