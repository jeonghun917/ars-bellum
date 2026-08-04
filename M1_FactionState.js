// Ars Bellum M1-5 - Faction persistent state and LandRight-derived settlement compatibility view
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
    function root() { return window.ArsGameState.getState().world.factions; }
    if (!registry.hasDomain("faction_type")) { registry.registerDomain("faction_type", { validator: function () { return true; } }); }
    ["realm", "league", "tribe", "city_state"].forEach(function (id) { if (!registry.hasDefinition("faction_type", id)) { const r=registry.registerDefaultDefinition("faction_type", { id:id, version:1, name:id, customData:{} }); if(!r.ok){throw new Error(r.error);} } });

    function metric(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
    function createDefault(input) {
        const x=clone(input||{}), power=x.sovereignPower||{};
        const next=Object.assign({},x,{
            id:x.id, version:Number.isInteger(x.version)?x.version:VERSION, revision:Number.isInteger(x.revision)&&x.revision>=0?x.revision:0,
            factionTypeId:x.factionTypeId||"realm", name:typeof x.name==="string"?x.name:"",
            rulerCharacterId:x.rulerCharacterId==null?null:String(x.rulerCharacterId), rulingClanId:x.rulingClanId==null?null:String(x.rulingClanId),
            treasuryAccountId:x.treasuryAccountId==null?null:String(x.treasuryAccountId), lawIds:uniqueIds(x.lawIds),
            sovereignPower:{legalAuthority:metric(power.legalAuthority),administrativeControl:metric(power.administrativeControl),coercivePower:metric(power.coercivePower),politicalSupport:metric(power.politicalSupport)},
            customData:x.customData&&typeof x.customData==="object"&&!Array.isArray(x.customData)?clone(x.customData):{}
        });
        delete next.memberClanIds; delete next.settlementIds;
        return next;
    }
    function validate(value,options){
        const e=[],x=value||{},allowUnknown=options&&options.allowUnregisteredDefinitions;
        if(!validId(x.id))e.push("invalid_faction_id"); if(x.version>VERSION)e.push("unsupported_future_version"); if(!Number.isInteger(x.revision)||x.revision<0)e.push("invalid_revision");
        if(!registry.hasDefinition("faction_type",x.factionTypeId)&&!allowUnknown)e.push("unregistered_faction_type");
        const p=x.sovereignPower||{}; ["legalAuthority","administrativeControl","coercivePower","politicalSupport"].forEach(function(k){if(!Number.isFinite(p[k])||p[k]<0||p[k]>100)e.push("invalid_faction_power:"+k);});
        return Array.from(new Set(e));
    }
    function blockedInput(x){
        x=x||{}; for(const n of ["memberClanIds","settlementIds"]){if(Object.prototype.hasOwnProperty.call(x,n))return "readonly_derived_field:"+n;}
        for(const n of ["rulerCharacterId","rulingClanId","treasuryAccountId"]){if(Object.prototype.hasOwnProperty.call(x,n)&&x[n]!=null)return "coordinator_required:"+n;}
        return null;
    }
    function create(input){const b=blockedInput(input);if(b)return {ok:false,error:b};const n=createDefault(input);if(root()[n.id])return {ok:false,error:"duplicate_faction_id"};const e=validate(n);if(e.length)return {ok:false,error:"invalid_faction",errors:e};root()[n.id]=n;return {ok:true,faction:getCanonicalSnapshot(n.id)};}
    function getCanonicalSnapshot(id){return root()[id]?clone(root()[id]):null;}
    function listCanonical(){return Object.keys(root()).sort().map(getCanonicalSnapshot);}
    function deriveMemberClans(id){return window.ArsClanState.listCanonical().filter(function(c){return c.factionId===id;}).map(function(c){return c.id;}).sort();}
    function requireCurrentDay(options){if(!options||!Object.prototype.hasOwnProperty.call(options,"currentDay"))return {ok:false,error:"m156_missing_current_day"};if(!Number.isInteger(options.currentDay)||options.currentDay<0)return {ok:false,error:"m156_invalid_current_day"};return {ok:true,currentDay:options.currentDay};}
    function getSnapshot(id,options){const day=requireCurrentDay(options);if(!day.ok)return day;const x=getCanonicalSnapshot(id);if(!x)return null;x.memberClanIds=deriveMemberClans(id);x.settlementIds=window.ArsRightsState?window.ArsRightsState.listSettlementIdsByHolder({type:"faction",id:id},null,day.currentDay):[];return x;}
    function list(options){const day=requireCurrentDay(options);if(!day.ok)return day;return Object.keys(root()).sort().map(function(id){return getSnapshot(id,{currentDay:day.currentDay});});}
    function normalize(id){const c=root()[id];if(!c)return {ok:false,error:"missing_faction"};const n=createDefault(c),e=validate(n,{allowUnregisteredDefinitions:true});if(e.length)return {ok:false,error:"normalization_failed",errors:e};const warnings=[];if(!registry.hasDefinition("faction_type",n.factionTypeId))warnings.push("unregistered_faction_type:"+n.factionTypeId);root()[id]=n;return {ok:true,faction:getCanonicalSnapshot(id),warnings:warnings};}
    function atomicCommit(id,expectedRevision,nextValue,allowCreate){const c=root()[id]||null;if(!c&&!allowCreate)return {ok:false,error:"missing_faction"};if(c&&c.revision!==expectedRevision)return {ok:false,error:"revision_conflict"};if(!c&&expectedRevision!==null)return {ok:false,error:"expected_absence_required"};const n=createDefault(Object.assign({},nextValue||{},{id:id}));n.revision=c?c.revision+1:0;const e=validate(n);if(e.length)return {ok:false,error:"invalid_faction",errors:e};root()[id]=n;return {ok:true,faction:getCanonicalSnapshot(id)};}
    function atomicRestore(id,snapshot){if(snapshot==null)delete root()[id];else root()[id]=clone(snapshot);return {ok:true};}
    function deepFreeze(v){if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.freeze(v);Object.keys(v).forEach(function(k){deepFreeze(v[k]);});}return v;}
    function checkMetricObject(obj,prefix){for(const k of Object.keys(obj||{})){const v=obj[k];if(!Number.isFinite(v)||v<0||v>100)return {ok:false,error:"invalid_obedience_value:"+prefix+"."+k};}return {ok:true};}
    function buildObedienceInput(input){
        const p=input||{}, required=["factionRef","targetRef","sourceRevisions","targetDisposition","targetCapacity","legalContext","localContext","commandContext"];
        for(const key of required){if(p[key]==null)return {ok:false,error:"missing_obedience_input:"+key};}
        const fv=window.ArsRefRegistry.validateRef(p.factionRef,null);if(!fv.ok||p.factionRef.type!=="faction")return fv.ok?{ok:false,error:"invalid_obedience_value:factionRef"}:fv;
        const tv=window.ArsRefRegistry.getRefSnapshot(p.targetRef);if(!tv.ok)return tv;
        const faction=getCanonicalSnapshot(p.factionRef.id);if(!faction)return {ok:false,error:"m156_missing_ref_target"};
        if(!p.sourceRevisions||p.sourceRevisions.faction!==faction.revision||p.sourceRevisions.target!==tv.value.revision)return {ok:false,error:"revision_conflict"};
        for(const pair of [[p.targetDisposition,"targetDisposition"],[p.targetCapacity,"targetCapacity"],[p.localContext,"localContext"],[p.commandContext,"commandContext"]]){const r=checkMetricObject(pair[0],pair[1]);if(!r.ok)return r;}
        const result={version:1,factionRef:clone(p.factionRef),targetRef:clone(p.targetRef),sourceRevisions:clone(p.sourceRevisions),factionPower:clone(faction.sovereignPower),targetDisposition:clone(p.targetDisposition),targetCapacity:clone(p.targetCapacity),legalContext:{contractRefs:clone(p.legalContext.contractRefs||[]),privilegeRefs:clone(p.legalContext.privilegeRefs||[]),immunityRefs:clone(p.legalContext.immunityRefs||[])},localContext:clone(p.localContext),commandContext:clone(p.commandContext)};
        return {ok:true,value:deepFreeze(JSON.parse(window.ArsM1AtomicCoordinator._canonicalStringify(result)))};
    }

    window.ArsFactionState=Object.freeze({VERSION:VERSION,createDefault:createDefault,create:create,getCanonicalSnapshot:getCanonicalSnapshot,listCanonical:listCanonical,getSnapshot:getSnapshot,list:list,validate:validate,normalize:normalize,buildObedienceInput:buildObedienceInput,_atomicCommit:atomicCommit,_atomicRestore:atomicRestore});
    const resolver=window.ArsRefRegistry.registerResolver("faction",{exists:function(id){return Boolean(root()[id]);},getSnapshot:getCanonicalSnapshot});if(!resolver.ok)throw new Error(resolver.error);
    const participant=window.ArsM1AtomicCoordinator.registerParticipant("faction",{
        prepare:function(operations){const before={},after={},normalized=[],events=[];for(const operation of operations){if(operation.targetRef.type!=="faction")return {ok:false,error:"m156_invalid_faction_target"};const id=operation.targetRef.id,c=getCanonicalSnapshot(id);if(!c)return {ok:false,error:"m156_missing_ref_target",details:"faction:"+id};if(operation.expectedRevision!==c.revision)return {ok:false,error:"m156_revision_conflict"};const n=clone(c),p=operation.payload||{};if(operation.command==="faction.change_ruler")n.rulerCharacterId=p.characterId==null?null:String(p.characterId);else if(operation.command==="faction.change_ruling_clan")n.rulingClanId=p.clanId==null?null:String(p.clanId);else if(operation.command==="faction.set_treasury")n.treasuryAccountId=p.accountId==null?null:String(p.accountId);else if(operation.command==="faction.replace"){Object.assign(n,clone(p.nextValue||{}));n.id=id;}else return {ok:false,error:"m156_unsupported_faction_command"};if(sameCanonical(c,n))return {ok:false,error:"no_change"};n.revision=c.revision+1;const e=validate(n);if(e.length)return {ok:false,error:"invalid_faction",details:e};before[id]=c;after[id]=n;normalized.push(clone(operation));events.push({eventType:"faction_state_changed",targetId:id,payload:{factionId:id,command:operation.command,beforeRevision:c.revision,afterRevision:n.revision,semanticDelta:m17SemanticDelta("faction",operation.command,{type:"faction",id:id},[{id:id,before:c,after:n}],["rulerCharacterId","rulingClanId","treasuryAccountId"])}});}return {ok:true,domainId:"faction",normalizedOperations:normalized,beforeSnapshots:before,plannedSnapshots:after,rollbackData:before,eventDescriptors:events};},
        commitPrepared:function(prepared){const committed=[];for(const id of Object.keys(prepared.plannedSnapshots).sort()){const r=atomicCommit(id,prepared.beforeSnapshots[id].revision,prepared.plannedSnapshots[id],false);if(!r.ok){for(let i=committed.length-1;i>=0;i-=1)atomicRestore(committed[i],prepared.beforeSnapshots[committed[i]]);return {ok:false,error:"faction:"+r.error};}committed.push(id);}return {ok:true,rollbackToken:{beforeSnapshots:clone(prepared.beforeSnapshots)}};},
        rollbackCommitted:function(token){Object.keys(token.beforeSnapshots||{}).sort().reverse().forEach(function(id){atomicRestore(id,token.beforeSnapshots[id]);});return {ok:true};},
        verifyCommitted:function(prepared){for(const id of Object.keys(prepared.plannedSnapshots)){if(window.ArsM1AtomicCoordinator._canonicalStringify(getCanonicalSnapshot(id))!==window.ArsM1AtomicCoordinator._canonicalStringify(prepared.plannedSnapshots[id]))return {ok:false,error:"faction_verify_mismatch:"+id};}return {ok:true};}
    });if(!participant.ok)throw new Error(participant.error);
})();
