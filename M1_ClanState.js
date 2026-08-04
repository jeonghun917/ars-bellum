// Ars Bellum M1-5 - Clan persistent state and derived compatibility indexes
(function () {
    "use strict";
    const VERSION = 1;
    const registry = window.ArsDefinitionRegistry;
    function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

    function m17SemanticValue(value){
        if(value===undefined){return null;}
        if(Array.isArray(value)){
            const byCanonical={};
            value.forEach(function(item){const normalized=m17SemanticValue(item),key=window.ArsM1AtomicCoordinator._canonicalStringify(normalized);byCanonical[key]=normalized;});
            return Object.keys(byCanonical).sort().map(function(key){return byCanonical[key];});
        }
        if(value&&typeof value==="object"){
            const out={};Object.keys(value).sort().forEach(function(key){out[key]=m17SemanticValue(value[key]);});return out;
        }
        return value;
    }
    function m17SemanticDelta(domainId,command,targetRef,entities,fields){
        const changes=[];
        (entities||[]).slice().sort(function(a,b){return String(a.id).localeCompare(String(b.id));}).forEach(function(entity){
            const before=entity.before===undefined?null:entity.before,after=entity.after===undefined?null:entity.after,beforeOut={},afterOut={};let changed=false;
            fields.forEach(function(field){
                const b=before===null?null:m17SemanticValue(Object.prototype.hasOwnProperty.call(before,field)?before[field]:null);
                const a=after===null?null:m17SemanticValue(Object.prototype.hasOwnProperty.call(after,field)?after[field]:null);
                if(window.ArsM1AtomicCoordinator._canonicalStringify(b)!==window.ArsM1AtomicCoordinator._canonicalStringify(a)){changed=true;if(before!==null){beforeOut[field]=b;}if(after!==null){afterOut[field]=a;}}
            });
            if(changed){changes.push({entityRef:{type:domainId,id:String(entity.id)},before:before===null?null:beforeOut,after:after===null?null:afterOut});}
        });
        const target=(entities||[]).filter(function(entity){return String(entity.id)===String(targetRef.id);})[0]||{};
        return {schemaVersion:"m17.semantic_delta.v1",domainId:domainId,command:command,targetRef:{type:targetRef.type,id:targetRef.id},beforeRevision:target.before&&Number.isInteger(target.before.revision)?target.before.revision:null,afterRevision:target.after&&Number.isInteger(target.after.revision)?target.after.revision:null,changes:changes};
    }
    function sameCanonical(a,b){const x=clone(a),y=clone(b);if(x&&y){y.revision=x.revision;}return window.ArsM1AtomicCoordinator._canonicalStringify(x)===window.ArsM1AtomicCoordinator._canonicalStringify(y);}
    function validId(v) { return typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(v); }
    function uniqueIds(v) { return Array.from(new Set((Array.isArray(v) ? v : []).filter(validId))).sort(); }
    function root() { return window.ArsGameState.getState().world.clans; }

    function createDefault(input) {
        const x = clone(input || {}), power = x.headPower || {}, standing = x.standing || {};
        const next = Object.assign({}, x, {
            id: x.id,
            version: Number.isInteger(x.version) ? x.version : VERSION,
            revision: Number.isInteger(x.revision) && x.revision >= 0 ? x.revision : 0,
            name: typeof x.name === "string" ? x.name : "",
            cultureId: x.cultureId == null ? null : String(x.cultureId),
            factionId: x.factionId == null ? null : String(x.factionId),
            headCharacterId: x.headCharacterId == null ? null : String(x.headCharacterId),
            branchClanIds: uniqueIds(x.branchClanIds),
            treasuryAccountId: x.treasuryAccountId == null ? null : String(x.treasuryAccountId),
            successionLawId: x.successionLawId == null ? null : String(x.successionLawId),
            inheritanceCustomId: x.inheritanceCustomId == null ? null : String(x.inheritanceCustomId),
            designatedSuccessorIds: uniqueIds(x.designatedSuccessorIds),
            inheritancePacts: Array.isArray(x.inheritancePacts) ? clone(x.inheritancePacts) : [],
            headPower: {
                legalAuthority: Number.isFinite(Number(power.legalAuthority)) ? Number(power.legalAuthority) : 0,
                actualControl: Number.isFinite(Number(power.actualControl)) ? Number(power.actualControl) : 0
            },
            standing: {
                prestige: Number.isFinite(Number(standing.prestige)) ? Number(standing.prestige) : 0,
                legitimacy: Number.isFinite(Number(standing.legitimacy)) ? Number(standing.legitimacy) : 0,
                unity: Number.isFinite(Number(standing.unity)) ? Number(standing.unity) : 0
            },
            customData: x.customData && typeof x.customData === "object" && !Array.isArray(x.customData) ? clone(x.customData) : {}
        });
        delete next.memberCharacterIds; delete next.memberClanIds; delete next.titleIds; delete next.holdingSettlementIds; delete next.claimIds;
        return next;
    }

    function validate(value, options) {
        const errors = [], x = value || {}, allowUnknown = options && options.allowUnregisteredDefinitions;
        if (!validId(x.id)) { errors.push("invalid_clan_id"); }
        if (x.version > VERSION) { errors.push("unsupported_future_version"); }
        if (!Number.isInteger(x.revision) || x.revision < 0) { errors.push("invalid_revision"); }
        if (typeof x.name !== "string") { errors.push("invalid_name"); }
        [x.headPower && x.headPower.legalAuthority, x.headPower && x.headPower.actualControl, x.standing && x.standing.prestige, x.standing && x.standing.legitimacy, x.standing && x.standing.unity].forEach(function (n) { if (!Number.isFinite(n)) { errors.push("invalid_clan_metric"); } });
        if (x.successionLawId && registry.hasDomain("succession_law") && !registry.hasDefinition("succession_law", x.successionLawId) && !allowUnknown) { errors.push("unregistered_succession_law"); }
        if (x.inheritanceCustomId && registry.hasDomain("inheritance_custom") && !registry.hasDefinition("inheritance_custom", x.inheritanceCustomId) && !allowUnknown) { errors.push("unregistered_inheritance_custom"); }
        if (new Set(x.designatedSuccessorIds || []).size !== (x.designatedSuccessorIds || []).length) { errors.push("duplicate_successor_id"); }
        if (!Array.isArray(x.inheritancePacts)) { errors.push("invalid_inheritance_pacts"); }
        return Array.from(new Set(errors));
    }

    function protectedInput(input) {
        const x = input || {};
        const protectedNames = ["memberCharacterIds", "memberClanIds", "titleIds", "holdingSettlementIds", "claimIds"];
        for (const name of protectedNames) { if (Object.prototype.hasOwnProperty.call(x, name)) { return "readonly_derived_field:" + name; } }
        for (const name of ["factionId", "headCharacterId", "treasuryAccountId"]) { if (Object.prototype.hasOwnProperty.call(x, name) && x[name] != null) { return "coordinator_required:" + name; } }
        return null;
    }

    function create(input) {
        const blocked = protectedInput(input); if (blocked) { return { ok: false, error: blocked }; }
        const next = createDefault(input);
        if (!validId(next.id)) { return { ok: false, error: "invalid_clan_id" }; }
        if (root()[next.id]) { return { ok: false, error: "duplicate_clan_id" }; }
        const errors = validate(next); if (errors.length) { return { ok: false, error: "invalid_clan", errors: errors }; }
        root()[next.id] = next; return { ok: true, clan: getSnapshot(next.id) };
    }
    function getCanonicalSnapshot(id) { return root()[id] ? clone(root()[id]) : null; }
    function listCanonical() { return Object.keys(root()).sort().map(getCanonicalSnapshot); }
    function deriveMembers(id) { return window.ArsCharacterState.list().filter(function (c) { return c.affiliations && c.affiliations.clanId === id; }).map(function (c) { return c.id; }).sort(); }
    function deriveTitles(id) { return window.ArsTitleState ? window.ArsTitleState.listCanonical().filter(function (t) { return t.holderRef && t.holderRef.type === "clan" && t.holderRef.id === id; }).map(function (t) { return t.id; }).sort() : []; }
    function deriveRights(id, typeId) { return window.ArsRightsState ? window.ArsRightsState.listCanonical().filter(function (r) { return r.holderRef && r.holderRef.type === "clan" && r.holderRef.id === id && (!typeId || r.rightTypeId === typeId); }).map(function (r) { return r.subjectRef && r.subjectRef.type === "settlement" ? r.subjectRef.id : r.id; }).filter(Boolean).sort() : []; }
    function getSnapshot(id) {
        const value = getCanonicalSnapshot(id); if (!value) { return null; }
        value.memberCharacterIds = deriveMembers(id);
        value.titleIds = deriveTitles(id);
        value.holdingSettlementIds = deriveRights(id, "holding");
        value.claimIds = deriveRights(id, "claim");
        return value;
    }
    function list() { return Object.keys(root()).sort().map(getSnapshot); }
    function normalize(id) {
        const current = root()[id]; if (!current) { return { ok: false, error: "missing_clan" }; }
        const next = createDefault(current), errors = validate(next, { allowUnregisteredDefinitions: true });
        if (errors.length) { return { ok: false, error: "normalization_failed", errors: errors }; }
        const warnings = [];
        if (next.successionLawId && registry.hasDomain("succession_law") && !registry.hasDefinition("succession_law", next.successionLawId)) { warnings.push("unregistered_succession_law:" + next.successionLawId); }
        if (next.inheritanceCustomId && registry.hasDomain("inheritance_custom") && !registry.hasDefinition("inheritance_custom", next.inheritanceCustomId)) { warnings.push("unregistered_inheritance_custom:" + next.inheritanceCustomId); }
        root()[id] = next; return { ok: true, clan: getSnapshot(id), warnings: warnings };
    }
    function atomicCommit(id, expectedRevision, nextValue, allowCreate) {
        const current = root()[id] || null;
        if (!current && !allowCreate) { return { ok: false, error: "missing_clan" }; }
        if (current && current.revision !== expectedRevision) { return { ok: false, error: "revision_conflict" }; }
        if (!current && expectedRevision !== null) { return { ok: false, error: "expected_absence_required" }; }
        const next = createDefault(Object.assign({}, nextValue || {}, { id: id })); next.revision = current ? current.revision + 1 : 0;
        const errors = validate(next); if (errors.length) { return { ok: false, error: "invalid_clan", errors: errors }; }
        root()[id] = next; return { ok: true, clan: getSnapshot(id) };
    }
    function atomicRestore(id, snapshot) { if (snapshot == null) { delete root()[id]; } else { root()[id] = clone(snapshot); } return { ok: true }; }

    window.ArsClanState = Object.freeze({
        VERSION: VERSION, createDefault: createDefault, create: create,
        getCanonicalSnapshot: getCanonicalSnapshot, listCanonical: listCanonical,
        getSnapshot: getSnapshot, list: list, validate: validate, normalize: normalize,
        _atomicCommit: atomicCommit, _atomicRestore: atomicRestore
    });

    const resolver = window.ArsRefRegistry.registerResolver("clan", { exists: function (id) { return Boolean(root()[id]); }, getSnapshot: getCanonicalSnapshot });
    if (!resolver.ok) { throw new Error(resolver.error); }

    const participant = window.ArsM1AtomicCoordinator.registerParticipant("clan", {
        prepare: function (operations) {
            const before = {}, after = {}, normalized = [], events = [];
            for (const operation of operations) {
                if (operation.targetRef.type !== "clan") { return { ok: false, error: "m156_invalid_clan_target" }; }
                const id = operation.targetRef.id, current = getCanonicalSnapshot(id);
                if (!current) { return { ok: false, error: "m156_missing_ref_target", details: "clan:" + id }; }
                if (operation.expectedRevision !== current.revision) { return { ok: false, error: "m156_revision_conflict" }; }
                const next = clone(current), p = operation.payload || {};
                if (operation.command === "clan.set_faction") { next.factionId = p.factionId == null ? null : String(p.factionId); }
                else if (operation.command === "clan.change_head") { next.headCharacterId = p.characterId == null ? null : String(p.characterId); }
                else if (operation.command === "clan.set_treasury") { next.treasuryAccountId = p.accountId == null ? null : String(p.accountId); }
                else if (operation.command === "clan.set_successors") { next.designatedSuccessorIds = uniqueIds(p.designatedSuccessorIds); }
                else if (operation.command === "clan.replace") { Object.assign(next, clone(p.nextValue || {})); next.id = id; }
                else { return { ok: false, error: "m156_unsupported_clan_command" }; }
                if (sameCanonical(current, next)) { return { ok: false, error: "no_change" }; }
                next.revision = current.revision + 1;
                const errors = validate(next); if (errors.length) { return { ok: false, error: "invalid_clan", details: errors }; }
                before[id] = current; after[id] = next; normalized.push(clone(operation));
                events.push({ eventType: "clan_state_changed", targetId: id, payload: { clanId: id, command: operation.command, beforeRevision: current.revision, afterRevision: next.revision, semanticDelta: m17SemanticDelta("clan", operation.command, {type:"clan",id:id}, [{id:id,before:current,after:next}], ["factionId","headCharacterId","treasuryAccountId","designatedSuccessorIds","successionLawId"]) } });
            }
            return { ok: true, domainId: "clan", normalizedOperations: normalized, beforeSnapshots: before, plannedSnapshots: after, rollbackData: before, eventDescriptors: events };
        },
        commitPrepared: function (prepared) {
            const committed = [];
            for (const id of Object.keys(prepared.plannedSnapshots).sort()) {
                const r = atomicCommit(id, prepared.beforeSnapshots[id].revision, prepared.plannedSnapshots[id], false);
                if (!r.ok) { for (let i=committed.length-1;i>=0;i-=1) { atomicRestore(committed[i], prepared.beforeSnapshots[committed[i]]); } return { ok: false, error: "clan:" + r.error }; }
                committed.push(id);
            }
            return { ok: true, rollbackToken: { beforeSnapshots: clone(prepared.beforeSnapshots) } };
        },
        rollbackCommitted: function (token) { Object.keys(token.beforeSnapshots || {}).sort().reverse().forEach(function (id) { atomicRestore(id, token.beforeSnapshots[id]); }); return { ok: true }; },
        verifyCommitted: function (prepared) { for (const id of Object.keys(prepared.plannedSnapshots)) { if (window.ArsM1AtomicCoordinator._canonicalStringify(getCanonicalSnapshot(id)) !== window.ArsM1AtomicCoordinator._canonicalStringify(prepared.plannedSnapshots[id])) { return { ok: false, error: "clan_verify_mismatch:" + id }; } } return { ok: true }; }
    });
    if (!participant.ok) { throw new Error(participant.error); }
})();
