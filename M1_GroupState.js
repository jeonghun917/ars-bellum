// Ars Bellum M1 - MobileGroup persistent state
(function () {
    "use strict";
    const registry = window.ArsDefinitionRegistry;
    function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
    function validId(v) { return typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(v); }
    function root() { return window.ArsGameState.getState().world.mobileGroups; }
    if (!registry.hasDomain("mobile_group_type")) { registry.registerDomain("mobile_group_type", { validator: function (d) { return Array.isArray(d.capabilityTags || []) ? true : ["invalid_capability_tags"]; } }); }
    if (!registry.hasDomain("command_structure")) { registry.registerDomain("command_structure", { validator: function () { return true; } }); }
    function addDefault(domain, d) { if (!registry.hasDefinition(domain, d.id)) { const r = registry.registerDefaultDefinition(domain, d); if (!r.ok) throw new Error(domain + ":" + d.id + ":" + r.error); } }
    [
        { id: "character_group", capabilityTags: ["named_members", "travel"] },
        { id: "military_party", capabilityTags: ["named_members", "troops", "combat", "travel"] },
        { id: "caravan", capabilityTags: ["cargo", "travel"] },
        { id: "envoy_group", capabilityTags: ["diplomacy", "travel"] },
        { id: "civilian_group", capabilityTags: ["civilian", "travel"] }
    ].forEach(function (d) { addDefault("mobile_group_type", d); });
    addDefault("command_structure", { id: "single_commander" }); addDefault("command_structure", { id: "delegated_command" });
    function registerDefinition(domain, d) { const x = clone(d || {}); return registry.registerApprovedDefinition(domain, x.id, x, { sourceType: "trusted_runtime" }); }
    function ref(v) { return v && validId(v.type) && validId(v.id) ? { type: String(v.type), id: String(v.id) } : null; }
    function memberRefs(values) { return (Array.isArray(values) ? values : []).map(function (m) { return { refTypeId: String(m.refTypeId || ""), refId: String(m.refId || ""), roleId: m.roleId == null ? null : String(m.roleId), quantity: Math.max(0, Number(m.quantity) || 0), customData: m.customData && typeof m.customData === "object" ? clone(m.customData) : {} }; }).filter(function (m) { return validId(m.refTypeId) && validId(m.refId) && m.quantity > 0; }); }
    function createDefault(input) {
        const x = clone(input || {}), pos = x.worldPosition || {}, move = x.movement || {}, transport = x.transport || {};
        return Object.assign({}, x, {
            id: x.id, version: Number.isInteger(x.version) ? x.version : 1, revision: Number.isInteger(x.revision) && x.revision >= 0 ? x.revision : 0,
            name: typeof x.name === "string" ? x.name : "", groupTypeId: x.groupTypeId || x.groupType,
            legalOwnerRef: ref(x.legalOwnerRef || x.legalOwner), employerRef: ref(x.employerRef), commandAuthorityRef: ref(x.commandAuthorityRef), paymasterRef: ref(x.paymasterRef),
            loyaltyAnchorRefs: (Array.isArray(x.loyaltyAnchorRefs) ? x.loyaltyAnchorRefs : []).map(ref).filter(Boolean),
            legalCommanderRef: ref(x.legalCommanderRef || (x.commanderCharacterId ? { type: "character", id: x.commanderCharacterId } : null)), actingCommanderRef: ref(x.actingCommanderRef), commandStructureId: x.commandStructureId || "single_commander",
            memberCharacterIds: Array.from(new Set((Array.isArray(x.memberCharacterIds) ? x.memberCharacterIds : []).filter(validId))), memberRefs: memberRefs(x.memberRefs),
            inventoryId: x.inventoryId == null ? null : String(x.inventoryId), treasuryAccountId: x.treasuryAccountId == null ? null : String(x.treasuryAccountId),
            worldPosition: { x: Number.isFinite(Number(pos.x)) ? Number(pos.x) : Number(x.worldX) || 0, y: Number.isFinite(Number(pos.y)) ? Number(pos.y) : Number(x.worldY) || 0 },
            movement: { targetX: Number.isFinite(Number(move.targetX)) ? Number(move.targetX) : Number(x.targetX) || 0, targetY: Number.isFinite(Number(move.targetY)) ? Number(move.targetY) : Number(x.targetY) || 0, baseSpeed: Math.max(0, Number(move.baseSpeed == null ? x.speed : move.baseSpeed) || 0), currentSpeed: Math.max(0, Number(move.currentSpeed == null ? x.speed : move.currentSpeed) || 0), targetNode: move.targetNode || x.targetNode || null },
            transport: { capacityWeightKg: Math.max(0, Number(transport.capacityWeightKg) || 0), capacityVolumeL: Math.max(0, Number(transport.capacityVolumeL) || 0), assetRefs: memberRefs(transport.assetRefs) },
            cohesion: Number.isFinite(Number(x.cohesion)) ? Number(x.cohesion) : 100, specializedState: x.specializedState && typeof x.specializedState === "object" ? clone(x.specializedState) : {}, customData: x.customData && typeof x.customData === "object" ? clone(x.customData) : {}
        });
    }
    function validate(g, options) {
        const e = [], allowUnknown = options && options.allowUnregisteredDefinitions;
        if (!g || !validId(g.id)) e.push("invalid_group_id"); if (!registry.hasDefinition("mobile_group_type", g && g.groupTypeId) && !allowUnknown) e.push("unregistered_group_type"); if (!registry.hasDefinition("command_structure", g && g.commandStructureId) && !allowUnknown) e.push("unregistered_command_structure"); if (!Number.isInteger(g && g.revision) || g.revision < 0) e.push("invalid_revision");
        if (new Set(g && g.memberCharacterIds || []).size !== (g && g.memberCharacterIds || []).length) e.push("duplicate_character_member");
        [g && g.legalCommanderRef, g && g.actingCommanderRef].filter(Boolean).forEach(function (r) { if (r.type === "character" && g.memberCharacterIds.indexOf(r.id) < 0) e.push("commander_not_member"); });
        return e;
    }
    function create(input) { const next = createDefault(input); if (root()[next.id]) return { ok: false, error: "duplicate_group_id" }; const errors = validate(next); if (errors.length) return { ok: false, error: "invalid_group", errors: errors }; root()[next.id] = next; return { ok: true, group: getSnapshot(next.id) }; }
    function getSnapshot(id) { return root()[id] ? clone(root()[id]) : null; } function list() { return Object.keys(root()).sort().map(getSnapshot); }
    function updateOperational(plan) { const p = plan || {}, current = root()[p.groupId]; if (!current) return { ok: false, error: "missing_group" }; if (p.expectedRevision !== current.revision) return { ok: false, error: "revision_conflict" }; const next = clone(current); if (p.worldPosition) next.worldPosition = Object.assign({}, next.worldPosition, clone(p.worldPosition)); if (p.movement) next.movement = Object.assign({}, next.movement, clone(p.movement)); if (p.cohesion !== undefined) next.cohesion = Number(p.cohesion); next.revision = current.revision + 1; const errors = validate(next); if (errors.length) return { ok: false, error: "invalid_group", errors: errors }; root()[next.id] = next; return { ok: true, group: getSnapshot(next.id) }; }
    function blocked() { return { ok: false, error: "relationship_command_requires_group_system" }; }
    function atomicCommit(id, expectedRevision, nextValue, allowCreate) { const current = root()[id] || null; if (!current && !allowCreate) return { ok: false, error: "missing_group" }; if (current && current.revision !== expectedRevision) return { ok: false, error: "revision_conflict" }; if (!current && expectedRevision !== null) return { ok: false, error: "expected_absence_required" }; const next = createDefault(Object.assign({}, nextValue || {}, { id: id })); next.revision = current ? current.revision + 1 : 0; const errors = validate(next); if (errors.length) return { ok: false, error: "invalid_group", errors: errors }; root()[id] = next; return { ok: true, group: getSnapshot(id) }; }
    function atomicRestore(id, snapshot) { if (snapshot == null) delete root()[id]; else root()[id] = clone(snapshot); return { ok: true }; }
    window.ArsMobileGroupState = Object.freeze({
        createDefault: createDefault, create: create, createGroup: create, getSnapshot: getSnapshot, getGroupSnapshot: getSnapshot, list: list, listGroups: list, validate: validate,
        normalize: function (id) {
            const current = root()[id]; if (!current) { return { ok: false, error: "missing_group" }; }
            const next = createDefault(current), errors = validate(next, { allowUnregisteredDefinitions: true });
            if (errors.length) { return { ok: false, error: "normalization_failed", errors: errors }; }
            const warnings = [];
            if (!registry.hasDefinition("mobile_group_type", next.groupTypeId)) { warnings.push("unregistered_group_type:" + next.groupTypeId); }
            if (!registry.hasDefinition("command_structure", next.commandStructureId)) { warnings.push("unregistered_command_structure:" + next.commandStructureId); }
            root()[id] = next; return { ok: true, group: getSnapshot(id), warnings: warnings };
        },
        updateOperational: updateOperational, setInventory: blocked, setTreasury: blocked, setMembers: blocked, addMember: blocked, removeMember: blocked,
        registerGroupTypeDefinition: function (d) { return registerDefinition("mobile_group_type", d); }, registerCommandStructureDefinition: function (d) { return registerDefinition("command_structure", d); },
        getGroupTypeDefinition: function (id) { return registry.getDefinition("mobile_group_type", id); }, getCommandStructureDefinition: function (id) { return registry.getDefinition("command_structure", id); },
        listGroupTypeDefinitions: function () { return registry.listDefinitions("mobile_group_type"); }, listCommandStructureDefinitions: function () { return registry.listDefinitions("command_structure"); },
        _atomicCommit: atomicCommit, _atomicRestore: atomicRestore
    });
})();
