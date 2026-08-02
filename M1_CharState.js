// Ars Bellum M1 - Character persistent state
(function () {
    "use strict";
    const VERSION = 1;
    function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
    function root() { return window.ArsGameState.getState().world.characters; }
    function validId(v) { return typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(v); }
    function plain(v) { return v && typeof v === "object" && !Array.isArray(v); }
    function uniqueIds(values) { return Array.from(new Set((Array.isArray(values) ? values : []).filter(validId))); }
    function mapNumbers(value, fallback) {
        const out = {};
        if (plain(value)) { Object.keys(value).forEach(function (key) { const n=Number(value[key]); if (Number.isFinite(n)) { out[key]=n; } }); }
        if (fallback) { Object.keys(fallback).forEach(function (key) { if (!(key in out)) { out[key]=fallback[key]; } }); }
        return out;
    }
    function createDefault(id, input) {
        const src = plain(input) ? clone(input) : {};
        const skillDefaults = {}; const aptitudeDefaults = {}; const growthDefaults = {};
        if (window.ArsCharacterSkills) {
            window.ArsCharacterSkills.getSkillIds().forEach(function (key) { skillDefaults[key]=0; });
            window.ArsCharacterSkills.getAptitudeIds().forEach(function (key) { aptitudeDefaults[key]=1; });
            window.ArsCharacterSkills.getGrowthSourceIds().forEach(function (key) { growthDefaults[key]=0; });
        }
        const identity = plain(src.identity) ? src.identity : {};
        const affiliations = plain(src.affiliations) ? src.affiliations : {};
        const location = plain(src.location) ? src.location : {};
        const condition = plain(src.condition) ? src.condition : {};
        const standing = plain(src.standing) ? src.standing : {};
        const activity = plain(src.activity) ? src.activity : {};
        const progression = plain(src.progression) ? src.progression : {};
        return Object.assign({}, src, {
            id: id,
            version: Number.isInteger(src.version) ? src.version : VERSION,
            revision: Number.isInteger(src.revision) && src.revision >= 0 ? src.revision : 0,
            identity: Object.assign({}, identity, {
                name: typeof identity.name === "string" ? identity.name : "",
                birthDay: Number.isInteger(identity.birthDay) && identity.birthDay >= 0 ? identity.birthDay : 0,
                deathDay: identity.deathDay == null ? null : Number(identity.deathDay),
                alive: identity.alive !== false,
                cultureId: identity.cultureId == null ? null : String(identity.cultureId),
                faithId: identity.faithId == null ? null : String(identity.faithId)
            }),
            affiliations: Object.assign({}, affiliations, {
                clanId: affiliations.clanId == null ? null : String(affiliations.clanId),
                factionId: affiliations.factionId == null ? null : String(affiliations.factionId),
                legalStatusId: affiliations.legalStatusId == null ? null : String(affiliations.legalStatusId)
            }),
            location: Object.assign({}, location, {
                mode: typeof location.mode === "string" ? location.mode : "settlement",
                settlementId: location.settlementId == null ? null : String(location.settlementId),
                mobileGroupId: location.mobileGroupId == null ? null : String(location.mobileGroupId),
                prisonerOfId: location.prisonerOfId == null ? null : String(location.prisonerOfId)
            }),
            offices: uniqueIds(src.offices),
            titleIds: uniqueIds(src.titleIds),
            claimIds: uniqueIds(src.claimIds),
            personalAccountId: src.personalAccountId == null ? null : String(src.personalAccountId),
            personalInventoryId: src.personalInventoryId == null ? null : String(src.personalInventoryId),
            skills: mapNumbers(src.skills, skillDefaults),
            aptitudes: mapNumbers(src.aptitudes, aptitudeDefaults),
            progression: Object.assign({}, progression, {
                skillExperience: mapNumbers(progression.skillExperience, skillDefaults),
                sourceTotals: mapNumbers(progression.sourceTotals, growthDefaults),
                repetition: plain(progression.repetition) ? clone(progression.repetition) : {},
                records: Array.isArray(progression.records) ? clone(progression.records) : []
            }),
            traits: uniqueIds(src.traits),
            condition: Object.assign({}, condition, {
                health: Number.isFinite(Number(condition.health)) ? Number(condition.health) : 100,
                fatigue: Number.isFinite(Number(condition.fatigue)) ? Number(condition.fatigue) : 0,
                wounded: Boolean(condition.wounded),
                injuries: Array.isArray(condition.injuries) ? clone(condition.injuries) : [],
                incapacitated: Boolean(condition.incapacitated)
            }),
            standing: Object.assign({}, standing, {
                reputation: Number(standing.reputation) || 0,
                prestige: Number(standing.prestige) || 0,
                legitimacy: Number(standing.legitimacy) || 0
            }),
            activity: Object.assign({}, activity, {
                tier: typeof activity.tier === "string" ? activity.tier : "active_named",
                lastActiveDay: Number.isInteger(activity.lastActiveDay) ? activity.lastActiveDay : 0,
                importanceScore: Number(activity.importanceScore) || 0
            })
        });
    }
    function validate(character, options) {
        const errors=[]; const c=character || {}; const requireRegistered=!(options && options.allowUnregisteredDefinitions);
        if (!validId(c.id)) { errors.push("invalid_character_id"); }
        if (c.version > VERSION) { errors.push("unsupported_future_version"); }
        if (!Number.isInteger(c.revision) || c.revision < 0) { errors.push("invalid_revision"); }
        if (!plain(c.identity) || !plain(c.affiliations) || !plain(c.location) || !plain(c.condition)) { errors.push("invalid_character_structure"); }
        if (c.condition && (!Number.isFinite(c.condition.health) || c.condition.health < 0 || c.condition.health > 100)) { errors.push("invalid_health"); }
        if (c.condition && (!Number.isFinite(c.condition.fatigue) || c.condition.fatigue < 0 || c.condition.fatigue > 100)) { errors.push("invalid_fatigue"); }
        if (requireRegistered && window.ArsCharacterSkills) {
            Object.keys(c.skills || {}).forEach(function (id) { if (!window.ArsCharacterSkills.hasDefinition("skill", id)) { errors.push("unregistered_skill:"+id); } });
            Object.keys(c.aptitudes || {}).forEach(function (id) { if (!window.ArsCharacterSkills.hasDefinition("aptitude", id)) { errors.push("unregistered_aptitude:"+id); } });
            Object.keys((c.progression && c.progression.sourceTotals) || {}).forEach(function (id) { if (!window.ArsCharacterSkills.hasDefinition("growth_source", id)) { errors.push("unregistered_growth_source:"+id); } });
        }
        return errors;
    }
    function create(input) {
        const id=input && input.id; if (!validId(id)) { return {ok:false,error:"invalid_character_id"}; }
        if (root()[id]) { return {ok:false,error:"duplicate_character_id"}; }
        const next=createDefault(id,input); const errors=validate(next);
        if (errors.length) { return {ok:false,error:"invalid_character",errors:errors}; }
        root()[id]=next; return {ok:true,character:getSnapshot(id)};
    }
    function getSnapshot(id) { return root()[id] ? clone(root()[id]) : null; }
    function list() { return Object.keys(root()).sort().map(getSnapshot); }
    function applyCommand(command) {
        const c=command || {}; const current=root()[c.characterId];
        if (!current) { return {ok:false,error:"missing_character"}; }
        if (!Number.isInteger(c.expectedRevision) || c.expectedRevision!==current.revision) { return {ok:false,error:"revision_conflict"}; }
        const next=clone(current);
        if (c.type==="replace") { Object.assign(next, clone(c.value || {})); next.id=current.id; }
        else if (c.type==="set_condition") { next.condition=Object.assign({},next.condition,clone(c.patch || {})); }
        else if (c.type==="set_personal_account") { next.personalAccountId=c.accountId==null?null:String(c.accountId); }
        else if (c.type==="set_location_group") { next.location.mobileGroupId=c.mobileGroupId==null?null:String(c.mobileGroupId); next.location.mode=c.mobileGroupId==null?"settlement":"mobile_group"; }
        else if (c.type==="gain_experience") {
            const skillId=c.skillDefinitionId; const sourceId=c.growthSourceTypeId; const amount=Number(c.amount);
            if (!window.ArsCharacterSkills.hasDefinition("skill",skillId)) { return {ok:false,error:"unregistered_skill"}; }
            if (!window.ArsCharacterSkills.hasDefinition("growth_source",sourceId)) { return {ok:false,error:"unregistered_growth_source"}; }
            if (!Number.isFinite(amount) || amount<=0) { return {ok:false,error:"invalid_experience_amount"}; }
            next.progression.skillExperience[skillId]=(Number(next.progression.skillExperience[skillId])||0)+amount;
            next.progression.sourceTotals[sourceId]=(Number(next.progression.sourceTotals[sourceId])||0)+amount;
            const currentLevel=Number(next.skills[skillId])||0;
            const levelGain=Math.floor(next.progression.skillExperience[skillId]/100)-Math.floor((next.progression.skillExperience[skillId]-amount)/100);
            next.skills[skillId]=Math.min(100,currentLevel+Math.max(0,levelGain));
            next.progression.records.push({sourceTypeId:sourceId,skillDefinitionId:skillId,amount:amount,day:Number.isInteger(c.day)?c.day:null,sourceRef:clone(c.sourceRef||null),tags:Array.isArray(c.tags)?c.tags.slice():[],customData:clone(c.customData||{})});
            if (typeof c.repetitionKey === "string" && c.repetitionKey) {
                next.progression.repetition[c.repetitionKey]=(Number(next.progression.repetition[c.repetitionKey])||0)+1;
            }
        } else { return {ok:false,error:"unsupported_character_command"}; }
        next.revision=current.revision+1;
        const errors=validate(next); if (errors.length) { return {ok:false,error:"invalid_character",errors:errors}; }
        root()[current.id]=next; return {ok:true,character:getSnapshot(current.id)};
    }
    function normalize(id) {
        const current=root()[id]; if (!current) { return {ok:false,error:"missing_character"}; }
        const next=createDefault(id,current);
        const errors=validate(next,{allowUnregisteredDefinitions:true});
        if (errors.length) { return {ok:false,error:"normalization_failed",errors:errors}; }
        const warnings=[];
        Object.keys(next.skills||{}).forEach(function(definitionId){
            if (!window.ArsCharacterSkills.hasDefinition("skill",definitionId)) { warnings.push("unregistered_skill:"+definitionId); }
        });
        Object.keys(next.progression&&next.progression.skillExperience||{}).forEach(function(definitionId){
            if (!window.ArsCharacterSkills.hasDefinition("skill",definitionId) && warnings.indexOf("unregistered_skill:"+definitionId)<0) { warnings.push("unregistered_skill:"+definitionId); }
        });
        Object.keys(next.aptitudes||{}).forEach(function(definitionId){
            if (!window.ArsCharacterSkills.hasDefinition("aptitude",definitionId)) { warnings.push("unregistered_aptitude:"+definitionId); }
        });
        Object.keys(next.progression&&next.progression.sourceTotals||{}).forEach(function(definitionId){
            if (!window.ArsCharacterSkills.hasDefinition("growth_source",definitionId)) { warnings.push("unregistered_growth_source:"+definitionId); }
        });
        root()[id]=next; return {ok:true,character:getSnapshot(id),warnings:warnings};
    }
    function atomicCommit(id, expectedRevision, nextValue, allowCreate) {
        const current = root()[id] || null;
        if (!current && !allowCreate) { return { ok: false, error: "missing_character" }; }
        if (current && current.revision !== expectedRevision) { return { ok: false, error: "revision_conflict" }; }
        if (!current && expectedRevision !== null) { return { ok: false, error: "expected_absence_required" }; }
        const next = createDefault(id, nextValue || {});
        next.revision = current ? current.revision + 1 : 0;
        const errors = validate(next);
        if (errors.length) { return { ok: false, error: "invalid_character", errors: errors }; }
        root()[id] = next;
        return { ok: true, character: getSnapshot(id) };
    }
    function atomicRestore(id, snapshot) {
        if (snapshot == null) { delete root()[id]; }
        else { root()[id] = clone(snapshot); }
        return { ok: true };
    }
    window.ArsCharacterState=Object.freeze({
        VERSION:VERSION, createDefault:createDefault, create:create, createCharacter:create,
        getSnapshot:getSnapshot, getCharacterSnapshot:getSnapshot, getById:getSnapshot,
        list:list, listCharacters:list, validate:validate, normalize:normalize, applyCommand:applyCommand, _atomicCommit:atomicCommit, _atomicRestore:atomicRestore
    });
})();
