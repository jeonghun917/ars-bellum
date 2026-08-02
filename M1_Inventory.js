// Ars Bellum M1 - Inventory persistent state
(function () {
    "use strict";
    const registry = window.ArsDefinitionRegistry;
    function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
    function validId(v) { return typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(v); }
    function root() { return window.ArsGameState.getState().world.inventories; }
    if (!registry.hasDomain("equipment_slot")) {
        registry.registerDomain("equipment_slot", { validator: function (d) {
            const errors = [];
            if (!Array.isArray(d.compatibleTags || [])) { errors.push("invalid_compatible_tags"); }
            if (!Number.isFinite(Number(d.capacity == null ? 1 : d.capacity)) || Number(d.capacity == null ? 1 : d.capacity) < 0) { errors.push("invalid_capacity"); }
            return errors.length ? errors : true;
        } });
    }
    if (!registry.hasDomain("cargo_purpose")) { registry.registerDomain("cargo_purpose", { validator: function () { return true; } }); }
    function addDefault(domain, d) { if (!registry.hasDefinition(domain, d.id)) { const r = registry.registerDefaultDefinition(domain, d); if (!r.ok) { throw new Error(domain + ":" + d.id + ":" + r.error); } } }
    [
        { id: "main_hand", compatibleTags: ["weapon"], capacity: 1 },
        { id: "off_hand", compatibleTags: ["weapon", "shield"], capacity: 1 },
        { id: "body", compatibleTags: ["armor"], capacity: 1 },
        { id: "mount", compatibleTags: ["mount"], capacity: 1 }
    ].forEach(function (d) { addDefault("equipment_slot", d); });
    ["supply", "contract", "mission", "personal_assignment"].forEach(function (id) { addDefault("cargo_purpose", { id: id }); });
    function registerDefinition(domain, d) { const value = clone(d || {}); return registry.registerApprovedDefinition(domain, value.id, value, { sourceType: "trusted_runtime" }); }

    function uniqueItems(list, idField) {
        const out = [], seen = new Set();
        (Array.isArray(list) ? list : []).forEach(function (item) {
            if (!item || !validId(item[idField]) || seen.has(item[idField])) { return; }
            seen.add(item[idField]); out.push(clone(item));
        });
        return out;
    }
    function normalizeBulk(value) {
        const out = {};
        if (value && typeof value === "object" && !Array.isArray(value)) {
            Object.keys(value).forEach(function (id) { const n = Number(value[id]); if (Number.isFinite(n) && n >= 0) { out[id] = n; } });
        }
        return out;
    }
    function createDefault(input) {
        const x = clone(input || {});
        const capacity = x.capacity && typeof x.capacity === "object" ? x.capacity : {};
        return Object.assign({}, x, {
            id: x.id,
            version: Number.isInteger(x.version) ? x.version : 1,
            revision: Number.isInteger(x.revision) && x.revision >= 0 ? x.revision : 0,
            ownerRef: x.ownerRef ? { type: String(x.ownerRef.type), id: String(x.ownerRef.id) } : null,
            capacity: {
                weightKg: Number.isFinite(Number(capacity.weightKg)) ? Math.max(0, Number(capacity.weightKg)) : 0,
                volumeL: Number.isFinite(Number(capacity.volumeL)) ? Math.max(0, Number(capacity.volumeL)) : 0
            },
            bulkItems: normalizeBulk(x.bulkItems),
            equipmentItems: uniqueItems(x.equipmentItems, "instanceId").map(function (item) {
                return Object.assign({}, item, {
                    itemDefinitionId: String(item.itemDefinitionId || item.itemTypeId || ""),
                    slotDefinitionId: item.slotDefinitionId == null ? (item.equippedSlotId == null ? null : String(item.equippedSlotId)) : String(item.slotDefinitionId),
                    ownershipRef: item.ownershipRef ? clone(item.ownershipRef) : null,
                    assignmentRef: item.assignmentRef ? clone(item.assignmentRef) : null,
                    weightKg: Math.max(0, Number(item.weightKg == null ? item.weight : item.weightKg) || 0),
                    volumeL: Math.max(0, Number(item.volumeL == null ? item.volume : item.volumeL) || 0),
                    tags: Array.isArray(item.tags) ? Array.from(new Set(item.tags.map(String))) : [],
                    customData: item.customData && typeof item.customData === "object" ? clone(item.customData) : {}
                });
            }),
            assignedCargo: uniqueItems(x.assignedCargo, "cargoId").map(function (cargo) {
                return Object.assign({}, cargo, {
                    itemDefinitionId: String(cargo.itemDefinitionId || cargo.resourceId || ""),
                    cargoPurposeId: String(cargo.cargoPurposeId || "supply"),
                    quantity: Math.max(0, Number(cargo.quantity) || 0),
                    ownershipRef: cargo.ownershipRef ? clone(cargo.ownershipRef) : null,
                    assignmentRef: cargo.assignmentRef ? clone(cargo.assignmentRef) : null,
                    weightKg: Math.max(0, Number(cargo.weightKg) || 0),
                    volumeL: Math.max(0, Number(cargo.volumeL) || 0),
                    customData: cargo.customData && typeof cargo.customData === "object" ? clone(cargo.customData) : {}
                });
            }),
            customData: x.customData && typeof x.customData === "object" ? clone(x.customData) : {}
        });
    }
    function validateOwner(ref) {
        if (!ref || !validId(ref.type) || !validId(ref.id)) { return false; }
        return !window.ArsFinanceState || Boolean(window.ArsFinanceState.getOwnerTypeDefinition(ref.type));
    }
    function validate(inv, options) {
        const errors = [], allowUnknown = options && options.allowUnregisteredDefinitions;
        if (!inv || !validId(inv.id)) { errors.push("invalid_inventory_id"); }
        if (!validateOwner(inv && inv.ownerRef)) { errors.push("invalid_owner_ref"); }
        if (!Number.isInteger(inv && inv.revision) || inv.revision < 0) { errors.push("invalid_revision"); }
        Object.keys((inv && inv.bulkItems) || {}).forEach(function (id) {
            if (!window.ArsResourceCatalog.getResourceById(id) && !allowUnknown) { errors.push("unregistered_resource:" + id); }
        });
        (inv && inv.equipmentItems || []).forEach(function (item) {
            if (!validId(item.itemDefinitionId)) { errors.push("invalid_equipment_definition"); }
            if (item.slotDefinitionId && !registry.hasDefinition("equipment_slot", item.slotDefinitionId) && !allowUnknown) { errors.push("unregistered_equipment_slot:" + item.slotDefinitionId); }
        });
        (inv && inv.assignedCargo || []).forEach(function (cargo) {
            if (!validId(cargo.itemDefinitionId)) { errors.push("invalid_cargo_item_definition"); }
            if (!registry.hasDefinition("cargo_purpose", cargo.cargoPurposeId) && !allowUnknown) { errors.push("unregistered_cargo_purpose:" + cargo.cargoPurposeId); }
        });
        return errors;
    }
    function create(input) {
        const next = createDefault(input);
        if (root()[next.id]) { return { ok: false, error: "duplicate_inventory_id" }; }
        const errors = validate(next); if (errors.length) { return { ok: false, error: "invalid_inventory", errors: errors }; }
        root()[next.id] = next; return { ok: true, inventory: getSnapshot(next.id) };
    }
    function getSnapshot(id) { return root()[id] ? clone(root()[id]) : null; }
    function list() { return Object.keys(root()).sort().map(getSnapshot); }
    function resourceMetrics(id, quantity) {
        const d = window.ArsResourceCatalog.getResourceById(id); if (!d) { return { weightKg: 0, volumeL: 0, nutrition: 0, food: false }; }
        const q = Number(quantity) || 0;
        const tags = Array.isArray(d.tags) ? d.tags : [];
        return { weightKg: q * (Number(d.weight) || 0), volumeL: q * (Number(d.volume == null ? d.weight : d.volume) || 0), nutrition: q * (Number(d.nutritionValue) || 0), food: d.category === "food" || tags.indexOf("food") >= 0 || tags.some(function (tag) { return /_food$/.test(tag); }) };
    }
    function calculateLoad(idOrInventory) {
        const inv = typeof idOrInventory === "string" ? getSnapshot(idOrInventory) : clone(idOrInventory);
        if (!inv) { return null; }
        let weightKg = 0, volumeL = 0;
        Object.keys(inv.bulkItems).forEach(function (id) { const m = resourceMetrics(id, inv.bulkItems[id]); weightKg += m.weightKg; volumeL += m.volumeL; });
        inv.equipmentItems.forEach(function (item) { weightKg += item.weightKg; volumeL += item.volumeL; });
        inv.assignedCargo.forEach(function (cargo) {
            const m = resourceMetrics(cargo.itemDefinitionId, cargo.quantity);
            weightKg += cargo.weightKg || m.weightKg; volumeL += cargo.volumeL || m.volumeL;
        });
        return { weightKg: weightKg, volumeL: volumeL, weightLimitKg: inv.capacity.weightKg, volumeLimitL: inv.capacity.volumeL, overweight: inv.capacity.weightKg > 0 && weightKg > inv.capacity.weightKg, overvolume: inv.capacity.volumeL > 0 && volumeL > inv.capacity.volumeL };
    }
    function getFoodSummary(id, dailyNeed) {
        const inv = getSnapshot(id); if (!inv) { return null; }
        let nutrition = 0;
        Object.keys(inv.bulkItems).forEach(function (resourceId) { const m = resourceMetrics(resourceId, inv.bulkItems[resourceId]); if (m.food) { nutrition += m.nutrition; } });
        const need = Math.max(0, Number(dailyNeed) || 0);
        return { nutrition: nutrition, dailyNeed: need, supplyDays: need > 0 ? nutrition / need : null };
    }
    function applyCommand(plan) {
        const p = plan || {}, current = root()[p.inventoryId]; if (!current) { return { ok: false, error: "missing_inventory" }; }
        if (p.expectedRevision !== current.revision) { return { ok: false, error: "revision_conflict" }; }
        const next = clone(current);
        if (p.type === "adjust_bulk") {
            if (!window.ArsResourceCatalog.getResourceById(p.itemDefinitionId)) { return { ok: false, error: "unregistered_resource" }; }
            const q = Number(p.quantityDelta); if (!Number.isFinite(q)) { return { ok: false, error: "invalid_quantity" }; }
            const value = (Number(next.bulkItems[p.itemDefinitionId]) || 0) + q; if (value < 0) { return { ok: false, error: "insufficient_quantity" }; }
            next.bulkItems[p.itemDefinitionId] = value;
        } else if (p.type === "add_equipment") {
            const item = createDefault({ id: "temp", ownerRef: current.ownerRef, equipmentItems: [p.item] }).equipmentItems[0];
            if (!item || next.equipmentItems.some(function (x) { return x.instanceId === item.instanceId; })) { return { ok: false, error: "duplicate_equipment" }; }
            if (item.slotDefinitionId && !registry.hasDefinition("equipment_slot", item.slotDefinitionId)) { return { ok: false, error: "unregistered_equipment_slot" }; }
            next.equipmentItems.push(item);
        } else if (p.type === "add_cargo") {
            const cargo = createDefault({ id: "temp", ownerRef: current.ownerRef, assignedCargo: [p.cargo] }).assignedCargo[0];
            if (!cargo || next.assignedCargo.some(function (x) { return x.cargoId === cargo.cargoId; })) { return { ok: false, error: "duplicate_cargo" }; }
            if (!registry.hasDefinition("cargo_purpose", cargo.cargoPurposeId)) { return { ok: false, error: "unregistered_cargo_purpose" }; }
            next.assignedCargo.push(cargo);
        } else if (p.type === "apply_loss") {
            const cargoLosses = p.cargoLosses || {};
            next.assignedCargo.forEach(function (cargo) { if (cargoLosses[cargo.cargoId]) { cargo.quantity = Math.max(0, cargo.quantity - Math.max(0, Number(cargoLosses[cargo.cargoId]) || 0)); } });
            const bulkLosses = p.bulkLosses || {};
            for (const resourceId of Object.keys(bulkLosses)) { const q = Math.max(0, Number(bulkLosses[resourceId]) || 0); if (q > (next.bulkItems[resourceId] || 0)) { return { ok: false, error: "loss_exceeds_quantity" }; } next.bulkItems[resourceId] -= q; }
        } else { return { ok: false, error: "unsupported_inventory_command" }; }
        next.revision = current.revision + 1; const errors = validate(next); if (errors.length) { return { ok: false, error: "invalid_inventory", errors: errors }; }
        root()[next.id] = next; return { ok: true, inventory: getSnapshot(next.id) };
    }
    function atomicCommit(id, expectedRevision, nextValue, allowCreate) {
        const current = root()[id] || null;
        if (!current && !allowCreate) { return { ok: false, error: "missing_inventory" }; }
        if (current && current.revision !== expectedRevision) { return { ok: false, error: "revision_conflict" }; }
        if (!current && expectedRevision !== null) { return { ok: false, error: "expected_absence_required" }; }
        const next = createDefault(Object.assign({}, nextValue || {}, { id: id })); next.revision = current ? current.revision + 1 : 0;
        const errors = validate(next); if (errors.length) { return { ok: false, error: "invalid_inventory", errors: errors }; }
        root()[id] = next; return { ok: true, inventory: getSnapshot(id) };
    }
    function atomicRestore(id, snapshot) { if (snapshot == null) { delete root()[id]; } else { root()[id] = clone(snapshot); } return { ok: true }; }
    window.ArsInventoryState = Object.freeze({
        createDefault: createDefault, create: create, createInventory: create, getSnapshot: getSnapshot, getInventorySnapshot: getSnapshot, list: list, listInventories: list, validate: validate,
        normalize: function (id) {
            const current = root()[id]; if (!current) { return { ok: false, error: "missing_inventory" }; }
            const next = createDefault(current), errors = validate(next, { allowUnregisteredDefinitions: true });
            if (errors.length) { return { ok: false, error: "normalization_failed", errors: errors }; }
            const warnings = [];
            Object.keys(next.bulkItems || {}).forEach(function (definitionId) { if (!window.ArsResourceCatalog.getResourceById(definitionId)) { warnings.push("unregistered_resource:" + definitionId); } });
            next.equipmentItems.forEach(function (item) { if (item.slotDefinitionId && !registry.hasDefinition("equipment_slot", item.slotDefinitionId)) { warnings.push("unregistered_equipment_slot:" + item.slotDefinitionId); } });
            next.assignedCargo.forEach(function (cargo) { if (!registry.hasDefinition("cargo_purpose", cargo.cargoPurposeId)) { warnings.push("unregistered_cargo_purpose:" + cargo.cargoPurposeId); } });
            root()[id] = next; return { ok: true, inventory: getSnapshot(id), warnings: Array.from(new Set(warnings)) };
        },
        applyCommand: applyCommand, calculateLoad: calculateLoad, getFoodSummary: getFoodSummary,
        registerEquipmentSlotDefinition: function (d) { return registerDefinition("equipment_slot", d); }, registerCargoPurposeDefinition: function (d) { return registerDefinition("cargo_purpose", d); },
        getEquipmentSlotDefinition: function (id) { return registry.getDefinition("equipment_slot", id); }, getCargoPurposeDefinition: function (id) { return registry.getDefinition("cargo_purpose", id); },
        listEquipmentSlotDefinitions: function () { return registry.listDefinitions("equipment_slot"); }, listCargoPurposeDefinitions: function () { return registry.listDefinitions("cargo_purpose"); },
        _atomicCommit: atomicCommit, _atomicRestore: atomicRestore
    });
})();
