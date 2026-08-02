// Ars Bellum M1 - Character health, fatigue, injury and age
(function () {
    "use strict";
    function clamp(v,min,max){return Math.max(min,Math.min(max,Number(v)));}
    function getAge(character,currentDay){
        if(!character||!character.identity){return null;}
        const end=character.identity.deathDay==null?Number(currentDay):Number(character.identity.deathDay);
        if(!Number.isFinite(end)){return null;}
        return Math.max(0,(end-Number(character.identity.birthDay||0))/365);
    }
    function updateCondition(plan){
        const p=plan||{}; const c=window.ArsCharacterState.getSnapshot(p.characterId);
        if(!c){return {ok:false,error:"missing_character"};}
        const patch=Object.assign({},p.patch||{});
        if(patch.health!==undefined){patch.health=clamp(patch.health,0,100);}
        if(patch.fatigue!==undefined){patch.fatigue=clamp(patch.fatigue,0,100);}
        if(patch.injuries!==undefined&&!Array.isArray(patch.injuries)){return {ok:false,error:"invalid_injuries"};}
        const merged=Object.assign({},c.condition,patch);
        merged.wounded=Boolean(merged.wounded||merged.injuries.length>0);
        merged.incapacitated=Boolean(merged.incapacitated||merged.health<=0||merged.fatigue>=100);
        return window.ArsCharacterState.applyCommand({type:"set_condition",characterId:p.characterId,expectedRevision:p.expectedRevision,patch:merged});
    }
    function getModifiers(characterId,currentDay){
        const c=window.ArsCharacterState.getSnapshot(characterId); if(!c){return null;}
        const age=getAge(c,currentDay); const injuryPenalty=Math.min(0.75,(c.condition.injuries||[]).reduce(function(sum,i){return sum+Math.max(0,Number(i.severity)||0);},0)/400);
        const healthFactor=clamp(c.condition.health/100,0,1); const fatigueFactor=clamp(1-c.condition.fatigue/150,0.25,1);
        const ageFactor=age!=null&&age>60?Math.max(0.5,1-(age-60)*0.01):1;
        return {healthFactor:healthFactor,fatigueFactor:fatigueFactor,injuryFactor:1-injuryPenalty,ageFactor:ageFactor,combined:healthFactor*fatigueFactor*(1-injuryPenalty)*ageFactor};
    }
    window.ArsCharacterStatus=Object.freeze({getAge:getAge,updateCondition:updateCondition,getModifiers:getModifiers});
})();
