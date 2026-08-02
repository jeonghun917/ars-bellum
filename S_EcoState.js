// ============================================================
// Ars Bellum - S_EcoState.js
// 거점 재고·화폐·경제 지수의 유일한 상태 저장소.
// 생산·소비·시장 계산과 GameClock 구독은 수행하지 않는다.
// 선행: GameState.js, ResourceCatalog.js
// ============================================================
(function () {
    "use strict";
    const VERSION = 2;
    const HISTORY_LIMIT = 60;
    const LISTENERS = new Set();
    const MONEY_ACCOUNTS = Object.freeze(["treasury", "privateWealth", "merchantCapital"]);
    const INDEX_LIMITS = Object.freeze({
        prosperity: [0, 200], productivity: [0, 3], demandIndex: [0, 3],
        wageIndex: [0, 3], costOfLiving: [0, 3], foodSecurity: [0, 1],
        marketConfidence: [0, 1], tradeActivity: [0, 3], taxRate: [0, 0.75]
    });
    const LEDGER_FIELDS = Object.freeze([
        "productionValue", "consumptionValue", "importsValue", "exportsValue",
        "wagesPaid", "taxesCollected", "maintenancePaid", "spoilageValue",
        "shortageValue", "surplusValue"
    ]);
    function isRecord(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
    function cleanId(value) { return typeof value === "string" ? value.trim() : ""; }
    function finite(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    function strictNumber(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    function nonNegative(value) { return Math.max(0, finite(value, 0)); }
    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, finite(value, minimum)));
    }
    function round(value, digits) {
        const scale = Math.pow(10, Math.max(0, Number(digits) || 0));
        return Math.round(finite(value, 0) * scale) / scale;
    }
    function fail(reason, extra) { return Object.assign({ ok: false, reason: reason }, extra || {}); }
    function deepFreeze(value) {
        if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
        Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
        return Object.freeze(value);
    }
    function currentDay() {
        const clock = window.ArsGameClock;
        if (!clock || typeof clock.getState !== "function") return 1;
        const state = clock.getState();
        return Math.max(1, Math.floor(finite(state && state.day, 1)));
    }
    function gameStateRoot() {
        const api = window.ArsGameState;
        if (!api || typeof api.getState !== "function") return null;
        const state = api.getState();
        return isRecord(state) ? state : null;
    }
    function resourceCatalog() { return window.ArsResourceCatalog || null; }
    function isKnownResource(resourceId) {
        const api = resourceCatalog();
        return !!api && typeof api.isKnownResource === "function" && api.isKnownResource(cleanId(resourceId));
    }
    function makeLedger() {
        const result = {};
        LEDGER_FIELDS.forEach(function (field) { result[field] = 0; });
        return result;
    }
    function normalizeLedger(source) {
        const result = makeLedger();
        if (!isRecord(source)) return result;
        LEDGER_FIELDS.forEach(function (field) { result[field] = round(nonNegative(source[field]), 2); });
        return result;
    }
    function normalizeInventory(source) {
        const result = {};
        if (!isRecord(source)) return result;
        Object.keys(source).forEach(function (resourceId) {
            const id = cleanId(resourceId);
            const amount = round(nonNegative(source[resourceId]), 4);
            if (id && isKnownResource(id) && amount > 0) result[id] = amount;
        });
        return result;
    }
    function normalizeMoney(source) {
        const input = isRecord(source) ? source : {};
        const result = { treasury: 0, privateWealth: 0, merchantCapital: 0 };
        MONEY_ACCOUNTS.forEach(function (account) { result[account] = round(nonNegative(input[account]), 2); });
        return result;
    }
    function makeEconomy() {
        return {
            version: VERSION, revision: 0, lastAction: "initialized",
            prosperity: 50, productivity: 1, demandIndex: 1, wageIndex: 1,
            costOfLiving: 1, foodSecurity: 1, marketConfidence: 0.5,
            tradeActivity: 1, taxRate: 0.1, daily: makeLedger(), totals: makeLedger(),
            produced: {}, consumed: {}, spoiled: {}, imported: {}, exported: {},
            shortages: {}, surpluses: {}, history: [], lastProcessedDay: currentDay()
        };
    }
    function normalizeEconomy(source) {
        const defaults = makeEconomy();
        const input = isRecord(source) ? source : {};
        const result = {
            version: VERSION,
            revision: Math.max(0, Math.floor(finite(input.revision, 0))),
            lastAction: cleanId(input.lastAction) || "normalized",
            daily: normalizeLedger(input.daily), totals: normalizeLedger(input.totals),
            produced: normalizeInventory(input.produced), consumed: normalizeInventory(input.consumed),
            spoiled: normalizeInventory(input.spoiled), imported: normalizeInventory(input.imported),
            exported: normalizeInventory(input.exported),
            shortages: normalizeInventory(input.shortages), surpluses: normalizeInventory(input.surpluses),
            history: Array.isArray(input.history) ? clone(input.history.slice(-HISTORY_LIMIT)) : [],
            lastProcessedDay: Math.max(1, Math.floor(finite(input.lastProcessedDay, defaults.lastProcessedDay)))
        };
        Object.keys(INDEX_LIMITS).forEach(function (key) {
            const limits = INDEX_LIMITS[key];
            result[key] = clamp(input[key] === undefined ? defaults[key] : input[key], limits[0], limits[1]);
        });
        return result;
    }
    function installOwnedProperty(settlement, key, value) {
        Object.defineProperty(settlement, key, {
            configurable: true, enumerable: true, writable: false, value: deepFreeze(value)
        });
    }
    function ensureWorldRecord() {
        const root = gameStateRoot();
        if (!root) return null;
        if (!isRecord(root.world)) root.world = {};
        if (!isRecord(root.world.settlements)) root.world.settlements = {};
        return root.world;
    }
    function ensureSettlementRecord(settlementId) {
        const id = cleanId(settlementId);
        const world = ensureWorldRecord();
        if (!id || !world) return null;
        if (!isRecord(world.settlements[id])) world.settlements[id] = { id: id };
        const settlement = world.settlements[id];
        settlement.id = cleanId(settlement.id) || id;
        installOwnedProperty(settlement, "inventory", normalizeInventory(settlement.inventory));
        installOwnedProperty(settlement, "money", normalizeMoney(settlement.money));
        installOwnedProperty(settlement, "economy", normalizeEconomy(settlement.economy));
        return settlement;
    }
    function sanitizeMetadata(metadata) {
        if (!isRecord(metadata)) return {};
        try {
            const safe = clone(metadata);
            return isRecord(safe) ? safe : {};
        } catch (error) { return {}; }
    }
    function emit(settlement, action, metadata, payload) {
        const safeMetadata = sanitizeMetadata(metadata);
        const event = {
            type: "economy_state_changed", settlementId: settlement.id,
            revision: settlement.economy.revision, action: action,
            source: cleanId(safeMetadata.source) || "SettlementEconomyState",
            metadata: safeMetadata, payload: clone(payload || {})
        };
        LISTENERS.forEach(function (listener) {
            try { listener(clone(event)); }
            catch (error) { console.error("[Ars Bellum] 거점 경제 구독자 오류:", error); }
        });
    }
    function commit(settlement, inventory, money, economy, action, metadata, payload) {
        const nextEconomy = normalizeEconomy(economy || settlement.economy);
        nextEconomy.revision = settlement.economy.revision + 1;
        nextEconomy.lastAction = cleanId(action) || "updated";
        installOwnedProperty(settlement, "inventory", normalizeInventory(inventory || settlement.inventory));
        installOwnedProperty(settlement, "money", normalizeMoney(money || settlement.money));
        installOwnedProperty(settlement, "economy", nextEconomy);
        emit(settlement, nextEconomy.lastAction, metadata, payload);
        return settlement.economy.revision;
    }
    function makeSnapshot(settlement) {
        const api = resourceCatalog();
        const inventory = clone(settlement.inventory);
        const value = api && typeof api.calculateBaseValue === "function" ? api.calculateBaseValue(inventory) : 0;
        return { settlementId: settlement.id, inventory: inventory,
            inventoryBaseValue: round(value, 2), money: clone(settlement.money), economy: clone(settlement.economy) };
    }
    function normalizeCost(cost) {
        if (!isRecord(cost)) return fail("invalid_cost");
        const rawGold = cost.gold === undefined ? 0 : strictNumber(cost.gold);
        if (rawGold === null || rawGold < 0) return fail("invalid_gold_cost");
        if (cost.resources !== undefined && !isRecord(cost.resources)) return fail("invalid_resource_cost");
        const resources = {};
        const source = isRecord(cost.resources) ? cost.resources : {};
        for (const resourceId of Object.keys(source)) {
            const id = cleanId(resourceId);
            const amount = strictNumber(source[resourceId]);
            if (!id || !isKnownResource(id)) return fail("unknown_resource", { resourceId: id || resourceId });
            if (amount === null || amount < 0) return fail("invalid_resource_cost", { resourceId: id });
            if (amount > 0) resources[id] = round(amount, 4);
        }
        return { ok: true, cost: { gold: round(rawGold, 2), resources: resources } };
    }
    function ensureWorldState() {
        const world = ensureWorldRecord();
        return world ? clone(world) : null;
    }
    function ensureSettlementState(settlementId) {
        const settlement = ensureSettlementRecord(settlementId);
        return settlement ? makeSnapshot(settlement) : null;
    }
    function initializeFromWorldData() {
        const data = window.ArsWorldMapData;
        const source = data && data.settlements;
        const list = Array.isArray(source) ? source : isRecord(source) ? Object.values(source) : [];
        const initialized = [];
        list.forEach(function (entry) {
            const id = cleanId(entry && entry.id);
            if (id && ensureSettlementRecord(id)) initialized.push(id);
        });
        return initialized;
    }
    function listSettlementIds() {
        const world = ensureWorldRecord();
        return world ? Object.keys(world.settlements).sort() : [];
    }
    function getEconomyState(settlementId) {
        const settlement = ensureSettlementRecord(settlementId);
        return settlement ? clone(settlement.economy) : null;
    }
    function getSnapshot(settlementId) {
        const settlement = ensureSettlementRecord(settlementId);
        return settlement ? makeSnapshot(settlement) : null;
    }
    function getIndex(settlementId, key) {
        const economy = getEconomyState(settlementId);
        const id = cleanId(key);
        return economy && INDEX_LIMITS[id] ? economy[id] : null;
    }
    function setIndex(settlementId, key, value, metadata) {
        const settlement = ensureSettlementRecord(settlementId);
        const id = cleanId(key);
        if (!settlement || !INDEX_LIMITS[id]) return fail("unknown_index", { key: id });
        const limits = INDEX_LIMITS[id];
        const economy = clone(settlement.economy);
        const previous = economy[id];
        economy[id] = clamp(value, limits[0], limits[1]);
        commit(settlement, null, null, economy, "set_" + id, metadata, {
            key: id, previous: previous, current: economy[id]
        });
        return {
            ok: true, settlementId: settlement.id, key: id, previous: previous,
            current: economy[id], revision: settlement.economy.revision
        };
    }
    function adjustIndex(settlementId, key, amount, metadata) {
        const current = getIndex(settlementId, key);
        return current === null ? fail("unknown_index", { key: cleanId(key) })
            : setIndex(settlementId, key, current + finite(amount, 0), metadata);
    }
    function getResourceAmount(settlementId, resourceId) {
        const settlement = ensureSettlementRecord(settlementId);
        const id = cleanId(resourceId);
        return settlement && id ? nonNegative(settlement.inventory[id]) : 0;
    }
    function changeResource(settlementId, resourceId, amount, remove, metadata) {
        const settlement = ensureSettlementRecord(settlementId);
        const id = cleanId(resourceId);
        const quantity = strictNumber(amount);
        if (!settlement || !id || !isKnownResource(id)) return fail("unknown_resource", { resourceId: id });
        if (quantity === null || quantity <= 0) return fail("invalid_resource_amount");
        const available = nonNegative(settlement.inventory[id]);
        if (remove && available < quantity) {
            return fail("insufficient_resource", {
                resourceId: id, requested: quantity, available: available
            });
        }
        const inventory = clone(settlement.inventory);
        const current = round(remove ? available - quantity : available + quantity, 4);
        if (current > 0) inventory[id] = current;
        else delete inventory[id];
        const action = remove ? "remove_resource" : "add_resource";
        commit(settlement, inventory, null, null, action, metadata, {
            resourceId: id, amount: quantity, current: current
        });
        return { ok: true, settlementId: settlement.id, resourceId: id,
            amount: quantity, current: current, revision: settlement.economy.revision };
    }
    function addResource(settlementId, resourceId, amount, metadata) {
        return changeResource(settlementId, resourceId, amount, false, metadata);
    }
    function removeResource(settlementId, resourceId, amount, metadata) {
        return changeResource(settlementId, resourceId, amount, true, metadata);
    }
    function canAffordCost(settlementId, cost) {
        const settlement = ensureSettlementRecord(settlementId);
        const normalized = normalizeCost(cost);
        if (!settlement) return Object.assign({ affordable: false }, fail("invalid_settlement"));
        if (!normalized.ok) return Object.assign({ affordable: false }, normalized);
        const missingResources = {};
        Object.keys(normalized.cost.resources).forEach(function (resourceId) {
            const missing = round(
                normalized.cost.resources[resourceId] - nonNegative(settlement.inventory[resourceId]), 4
            );
            if (missing > 0) missingResources[resourceId] = missing;
        });
        const missingGold = round(Math.max(0, normalized.cost.gold - settlement.money.treasury), 2);
        return {
            ok: true,
            affordable: missingGold === 0 && Object.keys(missingResources).length === 0,
            cost: clone(normalized.cost), missingGold: missingGold,
            missingResources: missingResources
        };
    }
    function payCost(settlementId, cost, metadata) {
        const settlement = ensureSettlementRecord(settlementId);
        const check = canAffordCost(settlementId, cost);
        if (!settlement || !check.ok || !check.affordable) return Object.assign({}, check, { ok: false });
        const inventory = clone(settlement.inventory);
        const money = clone(settlement.money);
        money.treasury = round(money.treasury - check.cost.gold, 2);
        Object.keys(check.cost.resources).forEach(function (resourceId) {
            const remaining = round(inventory[resourceId] - check.cost.resources[resourceId], 4);
            if (remaining > 0) inventory[resourceId] = remaining;
            else delete inventory[resourceId];
        });
        commit(settlement, inventory, money, null, "pay_cost", metadata, { cost: check.cost });
        return { ok: true, settlementId: settlement.id, paid: clone(check.cost),
            revision: settlement.economy.revision };
    }
    function refundCost(settlementId, cost, rate, metadata) {
        const settlement = ensureSettlementRecord(settlementId);
        const normalized = normalizeCost(cost);
        const refundRate = strictNumber(rate);
        if (!settlement) return fail("invalid_settlement");
        if (!normalized.ok) return normalized;
        if (refundRate === null || refundRate < 0 || refundRate > 1) return fail("invalid_refund_rate");
        const refunded = { gold: round(normalized.cost.gold * refundRate, 2), resources: {} };
        const inventory = clone(settlement.inventory);
        const money = clone(settlement.money);
        money.treasury = round(money.treasury + refunded.gold, 2);
        Object.keys(normalized.cost.resources).forEach(function (resourceId) {
            const amount = round(normalized.cost.resources[resourceId] * refundRate, 4);
            if (amount <= 0) return;
            refunded.resources[resourceId] = amount;
            inventory[resourceId] = round(nonNegative(inventory[resourceId]) + amount, 4);
        });
        commit(settlement, inventory, money, null, "refund_cost", metadata, {
            rate: refundRate, refunded: refunded
        });
        return { ok: true, settlementId: settlement.id, rate: refundRate,
            refunded: clone(refunded), revision: settlement.economy.revision };
    }
    function transferBetweenAccounts(settlementId, fromAccount, toAccount, amount, metadata) {
        const settlement = ensureSettlementRecord(settlementId);
        const from = cleanId(fromAccount);
        const to = cleanId(toAccount);
        const quantity = strictNumber(amount);
        if (!settlement) return fail("invalid_settlement");
        if (MONEY_ACCOUNTS.indexOf(from) === -1 || MONEY_ACCOUNTS.indexOf(to) === -1) {
            return fail("unknown_money_account");
        }
        if (from === to) return fail("same_money_account");
        if (quantity === null || quantity <= 0) return fail("invalid_money_amount");
        if (settlement.money[from] < quantity) {
            return fail("insufficient_money", {
                account: from, requested: quantity, available: settlement.money[from]
            });
        }
        const money = clone(settlement.money);
        money[from] = round(money[from] - quantity, 2);
        money[to] = round(money[to] + quantity, 2);
        commit(settlement, null, money, null, "transfer_between_accounts", metadata, {
            fromAccount: from, toAccount: to, amount: quantity
        });
        return {
            ok: true, settlementId: settlement.id, fromAccount: from, toAccount: to,
            amount: quantity, balances: clone(settlement.money),
            revision: settlement.economy.revision
        };
    }
    function transferMoney(settlementId, account, amount, metadata) {
        const settlement = ensureSettlementRecord(settlementId);
        const accountId = cleanId(account);
        const delta = strictNumber(amount);
        if (!settlement || MONEY_ACCOUNTS.indexOf(accountId) === -1) {
            return fail("unknown_money_account", { account: accountId });
        }
        if (delta === null || delta === 0) return fail("invalid_money_amount");
        if (settlement.money[accountId] + delta < 0) {
            return fail("insufficient_money", {
                account: accountId, requested: Math.abs(delta),
                available: settlement.money[accountId]
            });
        }
        const money = clone(settlement.money);
        const previous = money[accountId];
        money[accountId] = round(previous + delta, 2);
        commit(settlement, null, money, null, "transfer_money", metadata, {
            account: accountId, delta: delta, previous: previous, current: money[accountId]
        });
        return {
            ok: true, settlementId: settlement.id, account: accountId,
            previous: previous, current: money[accountId],
            revision: settlement.economy.revision
        };
    }
    function recordDailyReport(settlementId, report, dayValue, metadata) {
        const settlement = ensureSettlementRecord(settlementId);
        if (!settlement || !isRecord(report)) return fail("invalid_report");
        const economy = clone(settlement.economy);
        const day = Math.max(1, Math.floor(finite(dayValue, currentDay())));
        economy.daily = normalizeLedger(report);
        economy.produced = normalizeInventory(report.produced);
        economy.consumed = normalizeInventory(report.consumed);
        economy.spoiled = normalizeInventory(report.spoiled);
        economy.imported = normalizeInventory(report.imported);
        economy.exported = normalizeInventory(report.exported);
        economy.shortages = normalizeInventory(report.shortages);
        economy.surpluses = normalizeInventory(report.surpluses);
        economy.lastProcessedDay = day;
        LEDGER_FIELDS.forEach(function (field) {
            economy.totals[field] = round(nonNegative(economy.totals[field]) + economy.daily[field], 2);
        });
        const entry = Object.assign(
            { day: day },
            clone(economy.daily),
            {
                produced: clone(economy.produced),
                consumed: clone(economy.consumed),
                spoiled: clone(economy.spoiled),
                imported: clone(economy.imported),
                exported: clone(economy.exported),
                shortages: clone(economy.shortages),
                surpluses: clone(economy.surpluses)
            }
        );
        economy.history.push(entry);
        economy.history = economy.history.slice(-HISTORY_LIMIT);
        commit(settlement, null, null, economy, "record_daily_report", metadata, { day: day });
        return {
            ok: true, settlementId: settlement.id, report: clone(entry),
            revision: settlement.economy.revision
        };
    }


    function replaceSettlementState(settlementId, snapshot, metadata) {
        const settlement = ensureSettlementRecord(settlementId);
        if (!settlement || !isRecord(snapshot)) return fail("invalid_settlement_snapshot");

        commit(
            settlement,
            normalizeInventory(snapshot.inventory),
            normalizeMoney(snapshot.money),
            normalizeEconomy(snapshot.economy),
            "replace_settlement_state",
            metadata,
            { restored: true }
        );

        return {
            ok: true,
            settlementId: settlement.id,
            snapshot: makeSnapshot(settlement),
            revision: settlement.economy.revision
        };
    }

    function subscribe(listener) {
        if (typeof listener !== "function") return function () {};
        LISTENERS.add(listener);
        return function unsubscribe() { LISTENERS.delete(listener); };
    }
    function validateAll() {
        const errors = [];
        if (!gameStateRoot()) errors.push("ArsGameState가 없습니다.");
        if (!resourceCatalog()) errors.push("ArsResourceCatalog가 없습니다.");
        listSettlementIds().forEach(function (settlementId) {
            const settlement = ensureSettlementRecord(settlementId);
            Object.keys(settlement.inventory).forEach(function (resourceId) {
                if (!isKnownResource(resourceId)) errors.push(settlementId + ": 알 수 없는 자원 " + resourceId);
            });
            MONEY_ACCOUNTS.forEach(function (account) {
                const value = settlement.money[account];
                if (!Number.isFinite(value) || value < 0) errors.push(settlementId + ": 화폐 계정 오류 " + account);
            });
            Object.keys(INDEX_LIMITS).forEach(function (key) {
                const value = settlement.economy[key];
                const limits = INDEX_LIMITS[key];
                if (!Number.isFinite(value) || value < limits[0] || value > limits[1]) {
                    errors.push(settlementId + ": 경제 지수 오류 " + key);
                }
            });
            try {
                const restored = JSON.parse(JSON.stringify(makeSnapshot(settlement)));
                if (restored.settlementId !== settlement.id ||
                    restored.economy.version !== VERSION ||
                    restored.economy.revision !== settlement.economy.revision) {
                    errors.push(settlementId + ": JSON 왕복 검사 실패");
                }
            } catch (error) { errors.push(settlementId + ": JSON 직렬화 실패"); }
        });
        return errors;
    }
    function debugPrint(settlementId) {
        const id = cleanId(settlementId);
        if (id) {
            const snapshot = getSnapshot(id);
            console.group("[Ars Bellum] 거점 경제 상태: " + id);
            console.log(snapshot);
            console.groupEnd();
            return snapshot;
        }
        const summary = listSettlementIds().map(function (currentId) {
            const snapshot = getSnapshot(currentId);
            return {
                settlementId: currentId, treasury: snapshot.money.treasury,
                privateWealth: snapshot.money.privateWealth,
                merchantCapital: snapshot.money.merchantCapital,
                inventoryValue: snapshot.inventoryBaseValue,
                prosperity: snapshot.economy.prosperity,
                revision: snapshot.economy.revision
            };
        });
        console.table(summary);
        console.log("검사 오류:", validateAll());
        return summary;
    }
    window.ArsSettlementEconomyState = Object.freeze({
        version: VERSION, indexLimits: deepFreeze(clone(INDEX_LIMITS)),
        ledgerFields: Object.freeze(LEDGER_FIELDS.slice()), moneyAccounts: Object.freeze(MONEY_ACCOUNTS.slice()),
        ensureWorldState: ensureWorldState, ensureSettlementState: ensureSettlementState,
        initializeFromWorldData: initializeFromWorldData, listSettlementIds: listSettlementIds,
        getEconomyState: getEconomyState, getSnapshot: getSnapshot,
        getIndex: getIndex, setIndex: setIndex, adjustIndex: adjustIndex,
        getResourceAmount: getResourceAmount, addResource: addResource, removeResource: removeResource,
        canAffordCost: canAffordCost, payCost: payCost, refundCost: refundCost,
        transferBetweenAccounts: transferBetweenAccounts, transferMoney: transferMoney,
        recordDailyReport: recordDailyReport, replaceSettlementState: replaceSettlementState, subscribe: subscribe,
        validateAll: validateAll, debugPrint: debugPrint
    });
    const initialized = initializeFromWorldData(), errors = validateAll();
    if (errors.length) console.error("[Ars Bellum] SettlementEconomyState 검사 실패:", errors);
    else console.log("[Ars Bellum] SettlementEconomyState 연결 완료 - 거점 " + initialized.length + "곳");
})();