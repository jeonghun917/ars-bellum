// Ars Bellum M1 - Character definitions through ArsDefinitionRegistry
(function () {
    "use strict";
    const registry = window.ArsDefinitionRegistry;
    function ensureDomain(id, validator) { if (!registry.hasDomain(id)) { registry.registerDomain(id, { validator: validator }); } }
    ensureDomain("aptitude", function (d) { return Number.isFinite(Number(d.defaultValue == null ? 1 : d.defaultValue)) ? true : ["invalid_default_value"]; });
    ensureDomain("skill", function (d, api) {
        const errors = [];
        if (!d.aptitudeDefinitionId || !api.hasDefinition("aptitude", d.aptitudeDefinitionId)) errors.push("missing_aptitude_reference");
        if (!Number.isFinite(Number(d.defaultLevel == null ? 0 : d.defaultLevel))) errors.push("invalid_default_level");
        if (!Number.isFinite(Number(d.maxLevel == null ? 100 : d.maxLevel))) errors.push("invalid_max_level");
        return errors.length ? errors : true;
    });
    ensureDomain("growth_source", function (d) { return Number.isFinite(Number(d.baseMultiplier == null ? 1 : d.baseMultiplier)) ? true : ["invalid_base_multiplier"]; });
    ensureDomain("derived_rating", function (d, api) {
        const errors = []; if (!d.weights || typeof d.weights !== "object" || Array.isArray(d.weights)) errors.push("invalid_weights");
        Object.keys(d.weights || {}).forEach(function (id) { if (!api.hasDefinition("skill", id)) errors.push("missing_skill_reference:" + id); if (!Number.isFinite(Number(d.weights[id]))) errors.push("invalid_weight:" + id); });
        return errors.length ? errors : true;
    });
    function addDefault(domain, d) { if (!registry.hasDefinition(domain, d.id)) { const r = registry.registerDefaultDefinition(domain, d); if (!r.ok) throw new Error(domain + ":" + d.id + ":" + r.error); } }
    ["combat","mobility","command","administration","social","scholarship"].forEach(function (id) { addDefault("aptitude", { id: id, name: id, defaultValue: 1 }); });
    const skillIds = ["one_handed","two_handed","polearm","bow","crossbow","throwing","riding","athletics","command","tactics","scouting","logistics","stewardship","leadership","charm","diplomacy","trade","intrigue","medicine","engineering","learning"];
    const aptitude = { one_handed:"combat",two_handed:"combat",polearm:"combat",bow:"combat",crossbow:"combat",throwing:"combat",riding:"mobility",athletics:"mobility",command:"command",tactics:"command",scouting:"command",logistics:"administration",stewardship:"administration",leadership:"social",charm:"social",diplomacy:"social",trade:"administration",intrigue:"social",medicine:"scholarship",engineering:"scholarship",learning:"scholarship" };
    skillIds.forEach(function (id) { addDefault("skill", { id: id, name: id, aptitudeDefinitionId: aptitude[id], defaultLevel: 0, maxLevel: 100 }); });
    ["action","role","education","event"].forEach(function (id) { addDefault("growth_source", { id: id, name: id, baseMultiplier: 1 }); });
    [
        { id:"combat_rating",weights:{one_handed:.15,two_handed:.15,polearm:.1,bow:.1,crossbow:.1,throwing:.05,riding:.15,athletics:.2}},
        { id:"command_rating",weights:{command:.35,tactics:.3,scouting:.15,logistics:.2}},
        { id:"administration_rating",weights:{stewardship:.45,trade:.25,logistics:.15,engineering:.15}},
        { id:"social_rating",weights:{leadership:.25,charm:.25,diplomacy:.3,intrigue:.2}},
        { id:"scholarship_rating",weights:{medicine:.3,engineering:.3,learning:.4}}
    ].forEach(function (d) { addDefault("derived_rating", d); });
    function register(domain, d) { const value = JSON.parse(JSON.stringify(d || {})); return registry.registerApprovedDefinition(domain, value.id, value, { sourceType: "trusted_runtime" }); }
    window.ArsCharacterSkills = Object.freeze({
        registerSkillDefinition: function (d) { return register("skill", d); }, registerAptitudeDefinition: function (d) { return register("aptitude", d); }, registerGrowthSourceDefinition: function (d) { return register("growth_source", d); }, registerDerivedRatingDefinition: function (d) { return register("derived_rating", d); },
        hasDefinition: function (kind, id) { return registry.hasDefinition(kind, id); }, getDefinition: function (kind, id) { return registry.getDefinition(kind, id); }, listDefinitions: function (kind) { return registry.listDefinitions(kind); },
        getSkillIds: function () { return registry.listDefinitions("skill").map(function (d) { return d.id; }).sort(); }, getAptitudeIds: function () { return registry.listDefinitions("aptitude").map(function (d) { return d.id; }).sort(); }, getGrowthSourceIds: function () { return registry.listDefinitions("growth_source").map(function (d) { return d.id; }).sort(); }, getDerivedRatingIds: function () { return registry.listDefinitions("derived_rating").map(function (d) { return d.id; }).sort(); }
    });
})();
