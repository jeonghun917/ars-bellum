// Ars Bellum M1-6 - Trusted synchronous deterministic succession policy registry
(function () {
    "use strict";
    const registry=window.ArsDefinitionRegistry;
    const policies={evaluator:Object.create(null),eligibility:Object.create(null),inheritance:Object.create(null)};
    function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
    function validId(v){return typeof v==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(v);}
    function isThenable(v){return v&&(typeof v==="object"||typeof v==="function")&&typeof v.then==="function";}
    function sameRef(a,b){return a&&b&&a.type===b.type&&a.id===b.id;}
    function refKey(r){return r?r.type+":"+r.id:"";}
    function register(kind,id,descriptor){if(!policies[kind]||!validId(id)||!descriptor||typeof descriptor.execute!=="function")return {ok:false,error:"m156_invalid_policy"};if(policies[kind][id])return {ok:false,error:"m156_duplicate_policy"};policies[kind][id]=Object.freeze({execute:descriptor.execute,validateParams:typeof descriptor.validateParams==="function"?descriptor.validateParams:function(){return true;}});return {ok:true,policyId:id};}
    function hasPolicy(kind,id){return Boolean(policies[kind]&&policies[kind][id]);}
    function validatePolicyParams(kind,id,params){if(!hasPolicy(kind,id))return {ok:false,error:"m156_unsupported_policy"};let r;try{r=policies[kind][id].validateParams(clone(params||{}));}catch(e){return {ok:false,error:"m156_invalid_policy_params",details:String(e&&e.message||e)};}if(isThenable(r))return {ok:false,error:"m156_unsupported_async_participant"};return r===true||r&&r.ok===true?{ok:true}:{ok:false,error:"m156_invalid_policy_params",details:r};}
    function executePolicy(kind,id,input,params){const p=validatePolicyParams(kind,id,params);if(!p.ok)return p;let result;try{result=policies[kind][id].execute(clone(input||{}),clone(params||{}));}catch(e){return {ok:false,error:"m156_invalid_policy_output",details:String(e&&e.message||e)};}if(isThenable(result))return {ok:false,error:"m156_unsupported_async_participant"};try{result=clone(result);}catch(e){return {ok:false,error:"m156_invalid_policy_output"};}return result&&result.ok===true?result:{ok:false,error:result&&result.error||"m156_invalid_policy_output",details:result&&result.details};}
    function getPolicySnapshot(){const out={};Object.keys(policies).sort().forEach(function(kind){out[kind]=Object.keys(policies[kind]).sort();});return out;}

    function sortedUniqueRefs(values){const out=[],seen=new Set();(Array.isArray(values)?values:[]).forEach(function(r){if(r&&validId(r.type)&&validId(r.id)){const k=refKey(r);if(!seen.has(k)){seen.add(k);out.push({type:r.type,id:r.id});}}});return out;}
    function sortedBeneficiaries(entries){return entries.slice().sort(function(a,b){const ap=Number(a.priority)||0,bp=Number(b.priority)||0;if(ap!==bp)return bp-ap;const as=Number(a.shareBps)||0,bs=Number(b.shareBps)||0;if(as!==bs)return bs-as;return refKey(a.beneficiaryRef)<refKey(b.beneficiaryRef)?-1:refKey(a.beneficiaryRef)>refKey(b.beneficiaryRef)?1:0;});}
    function allocateIntegerLot(originalAmount,explicitAllocations,shares,legalHeirRef){
        if(!Number.isSafeInteger(originalAmount)||originalAmount<0)return {ok:false,error:"m156_allocation_numeric_overflow"};
        const explicit=(explicitAllocations||[]).reduce(function(sum,a){const n=Number(a.amount||a.quantity||a.shareUnits||0);return sum+n;},0);
        if(!Number.isSafeInteger(explicit)||explicit<0||explicit>originalAmount)return {ok:false,error:"m156_allocation_conservation_failed"};
        const remaining=originalAmount-explicit,ordered=sortedBeneficiaries(shares||[]),totalBps=ordered.reduce(function(sum,s){return sum+Number(s.shareBps||0);},0);
        if(!Number.isSafeInteger(totalBps)||totalBps<0||totalBps>10000)return {ok:false,error:"m156_invalid_expected_share"};
        const amounts=ordered.map(function(s){const product=remaining*Number(s.shareBps||0);if(!Number.isSafeInteger(product))throw new Error("m156_allocation_numeric_overflow");return {beneficiaryRef:clone(s.beneficiaryRef),amount:Math.floor(product/10000),priority:Number(s.priority)||0,shareBps:Number(s.shareBps)||0};});
        const expectedTarget=Math.floor(remaining*totalBps/10000),primary=amounts.reduce(function(sum,a){return sum+a.amount;},0);let rounding=expectedTarget-primary,index=0;
        while(rounding>0&&amounts.length){amounts[index%amounts.length].amount+=1;rounding-=1;index+=1;}
        const residual=remaining-expectedTarget;if(residual>0&&!legalHeirRef)return {ok:false,error:"m156_no_eligible_legal_heir"};
        const expectedAllocated=amounts.reduce(function(sum,a){return sum+a.amount;},0);if(expectedAllocated+residual!==remaining||explicit+expectedAllocated+residual!==originalAmount)return {ok:false,error:"m156_allocation_conservation_failed"};
        return {ok:true,originalAmount:originalAmount,explicitAllocations:explicit,remainingAmount:remaining,expectedTarget:expectedTarget,allocations:amounts.filter(function(a){return a.amount>0;}),policyResidual:residual,residualBeneficiaryRef:residual>0?clone(legalHeirRef):null};
    }

    register("evaluator","m1.ordered_candidates.v1",{execute:function(input){const candidates=sortedUniqueRefs(input.candidateRefs),legal=sortedUniqueRefs(input.legalHeirRefs);return {ok:true,rankedCandidateRefs:candidates,rankedPactIds:(input.pactSnapshots||[]).slice().sort(function(a,b){const ap=Number(a.priority)||0,bp=Number(b.priority)||0;if(ap!==bp)return bp-ap;return String(a.id).localeCompare(String(b.id));}).map(function(p){return p.id;}),tieBreakTrace:candidates.map(refKey),warnings:candidates.length?[]:legal.length?["designated_candidates_empty"]:[]};}});
    register("eligibility","m1.alive_eligible.v1",{execute:function(input){const r=input.candidateRef||{},released=input.permanentlyReleasedCharacterIds||[],snapshot=input.stateSnapshots&&input.stateSnapshots.character;const reasons=[];if(!snapshot)reasons.push("missing_character");else{if(!snapshot.identity||snapshot.identity.alive!==true)reasons.push("not_alive");if(snapshot.condition&&snapshot.condition.incapacitated)reasons.push("incapacitated");}if(released.indexOf(r.id)>=0)reasons.push("permanently_released");return {ok:true,eligible:reasons.length===0,reasonCodes:reasons};}});
    register("inheritance","m1.pact_then_legal_first.v1",{execute:function(input){
        const assets=Array.isArray(input.assetSnapshots)?input.assetSnapshots.slice():[],pacts=(input.pactSnapshots||[]).filter(function(p){return p.status==="active";}).sort(function(a,b){const ap=Number(a.priority)||0,bp=Number(b.priority)||0;if(ap!==bp)return bp-ap;return String(a.id).localeCompare(String(b.id));});
        const explicitByAsset=Object.create(null),expected=input.expectedShares||[];
        for(const pact of pacts){for(const a of pact.allocations||[]){const k=refKey(a.assetRef);if(explicitByAsset[k])return {ok:false,error:"m156_allocation_conflict"};explicitByAsset[k]=clone(a);}}
        const allocations=[],operations=[],selected=[];
        for(const asset of assets.sort(function(a,b){const ak=String(a.assetClass)+":"+refKey(a.assetRef),bk=String(b.assetClass)+":"+refKey(b.assetRef);return ak<bk?-1:ak>bk?1:0;})){
            const key=refKey(asset.assetRef),explicit=explicitByAsset[key],shares=expected.filter(function(s){return s.assetClass===asset.assetClass&&(!s.scopeRef||sameRef(s.scopeRef,asset.assetRef));});
            if(explicit){allocations.push(clone(explicit));selected.push(clone(explicit.beneficiaryRef));continue;}
            if(asset.divisible===true){const amount=Number(asset.amount!=null?asset.amount:asset.shareUnits);const calc=allocateIntegerLot(amount,[],shares,input.firstLegalHeirRef);if(!calc.ok)return calc;for(const a of calc.allocations){allocations.push({assetRef:clone(asset.assetRef),assetClass:asset.assetClass,beneficiaryRef:a.beneficiaryRef,action:asset.assetClass==="land_right"?"split_share":"transfer_balance",amount:asset.assetClass==="land_right"?undefined:a.amount,shareUnits:asset.assetClass==="land_right"?a.amount:undefined});selected.push(a.beneficiaryRef);}if(calc.policyResidual>0){allocations.push({assetRef:clone(asset.assetRef),assetClass:asset.assetClass,beneficiaryRef:calc.residualBeneficiaryRef,action:asset.assetClass==="land_right"?"split_share":"transfer_balance",amount:asset.assetClass==="land_right"?undefined:calc.policyResidual,shareUnits:asset.assetClass==="land_right"?calc.policyResidual:undefined});selected.push(calc.residualBeneficiaryRef);}}
            else{const ordered=sortedBeneficiaries(shares),beneficiary=ordered.length?ordered[0].beneficiaryRef:input.firstLegalHeirRef;if(!beneficiary)return {ok:false,error:"m156_no_eligible_legal_heir"};allocations.push({assetRef:clone(asset.assetRef),assetClass:asset.assetClass,beneficiaryRef:clone(beneficiary),action:asset.assetClass==="title"?"assign_holder":asset.assetClass==="land_right"?"transfer_whole":asset.assetClass==="inventory"?"transfer_owner":"transfer_owner"});selected.push(clone(beneficiary));}
        }
        return {ok:true,selectedHeirRefs:sortedUniqueRefs(selected),allocations:allocations,operations:operations,fallbackUsed:pacts.length===0,resultTagIds:pacts.length?["pact_applied"]:["legal_fallback"],warnings:[]};
    }});

    function ensureDomain(id,validator){if(!registry.hasDomain(id)){const r=registry.registerDomain(id,{validator:validator});if(!r.ok)throw new Error(r.error);}}
    ensureDomain("succession_law",function(d){const e=[];for(const pair of [["evaluator",d.evaluatorPolicyId],["eligibility",d.eligibilityPolicyId],["inheritance",d.inheritancePolicyId]])if(!hasPolicy(pair[0],pair[1]))e.push("missing_policy:"+pair[1]);if(d.fallbackToFirstLegalHeir!==true)e.push("invalid_fallback");return e.length?e:true;});
    ensureDomain("inheritance_custom",function(d){const e=[];if(typeof d.allowsPacts!=="boolean")e.push("invalid_pact_flag");if(!Array.isArray(d.requiredConsentRoles||[])||!Array.isArray(d.requiredApprovalRoles||[]))e.push("invalid_roles");for(const pair of [["evaluator",d.evaluatorPolicyId],["eligibility",d.eligibilityPolicyId],["inheritance",d.inheritancePolicyId]])if(!hasPolicy(pair[0],pair[1]))e.push("missing_policy:"+pair[1]);return e.length?e:true;});
    ensureDomain("succession_result_tag",function(){return true;});
    function addDefault(domain,d){if(!registry.hasDefinition(domain,d.id)){const r=registry.registerDefaultDefinition(domain,d);if(!r.ok)throw new Error(domain+":"+d.id+":"+r.error);}}
    addDefault("succession_law",{id:"m1.default_succession",version:1,name:"default succession",evaluatorPolicyId:"m1.ordered_candidates.v1",eligibilityPolicyId:"m1.alive_eligible.v1",inheritancePolicyId:"m1.pact_then_legal_first.v1",policyParams:{},legalHeirOrderSource:"caller",fallbackToFirstLegalHeir:true,customData:{}});
    addDefault("inheritance_custom",{id:"m1.default_inheritance",version:1,name:"default inheritance",allowsPacts:true,requiredConsentRoles:[],requiredApprovalRoles:[],expectedShareMode:"bps",evaluatorPolicyId:"m1.ordered_candidates.v1",eligibilityPolicyId:"m1.alive_eligible.v1",inheritancePolicyId:"m1.pact_then_legal_first.v1",policyParams:{},customData:{}});
    ["pact_applied","legal_fallback","clan_head_changed","player_control_changed","title_inherited","rights_transferred"].forEach(function(id){addDefault("succession_result_tag",{id:id,version:1,name:id,customData:{}});});

    window.ArsSuccessionPolicies=Object.freeze({
        registerEvaluatorPolicy:function(id,d){return register("evaluator",id,d);},registerEligibilityPolicy:function(id,d){return register("eligibility",id,d);},registerInheritancePolicy:function(id,d){return register("inheritance",id,d);},
        hasPolicy:hasPolicy,validatePolicyParams:validatePolicyParams,executePolicy:executePolicy,getPolicySnapshot:getPolicySnapshot,_allocateIntegerLot:allocateIntegerLot
    });
})();
