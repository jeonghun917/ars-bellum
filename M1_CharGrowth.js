// Ars Bellum M1 - Character progression and derived ratings
(function () {
    "use strict";
    function gainExperience(plan){
        const p=plan||{}; const c=window.ArsCharacterState.getSnapshot(p.characterId); if(!c){return {ok:false,error:"missing_character"};}
        const base=Number(p.amount); if(!Number.isFinite(base)||base<=0){return {ok:false,error:"invalid_experience_amount"};}
        const difficulty=Math.max(0,Number(p.difficulty==null?1:p.difficulty));
        if(difficulty<0.1){return {ok:false,error:"insufficient_difficulty"};}
        const key=typeof p.repetitionKey==="string"?p.repetitionKey:null;
        const repeats=key&&c.progression.repetition[key]?Number(c.progression.repetition[key]):0;
        const repeatFactor=1/(1+Math.max(0,repeats)*0.25);
        const successFactor=p.success===false?0.35:1;
        const aptitudeDef=window.ArsCharacterSkills.getDefinition("skill",p.skillDefinitionId);
        const aptitude=aptitudeDef?Number(c.aptitudes[aptitudeDef.aptitudeDefinitionId]||1):1;
        const finalAmount=base*difficulty*repeatFactor*successFactor*Math.max(0.1,aptitude);
        return window.ArsCharacterState.applyCommand({type:"gain_experience",characterId:p.characterId,expectedRevision:p.expectedRevision,skillDefinitionId:p.skillDefinitionId,growthSourceTypeId:p.growthSourceTypeId||"action",amount:finalAmount,day:p.day,sourceRef:p.sourceRef,tags:p.tags,customData:p.customData,repetitionKey:key});
    }
    function bySource(source){return function(plan){return gainExperience(Object.assign({},plan,{growthSourceTypeId:source}));};}
    function getDerivedRatings(characterId,currentDay){
        const c=window.ArsCharacterState.getSnapshot(characterId); if(!c){return null;}
        const mods=window.ArsCharacterStatus?window.ArsCharacterStatus.getModifiers(characterId,currentDay):{combined:1}; const out={};
        window.ArsCharacterSkills.getDerivedRatingIds().forEach(function(id){
            const d=window.ArsCharacterSkills.getDefinition("derived_rating",id); let total=0,weight=0;
            Object.keys(d.weights||{}).forEach(function(skillId){const w=Number(d.weights[skillId])||0; total+=(Number(c.skills[skillId])||0)*w; weight+=w;});
            out[id]=(weight?total/weight:0)*mods.combined;
        });
        return out;
    }
    window.ArsCharacterProgressionSystem=Object.freeze({gainExperience:gainExperience,gainFromAction:bySource("action"),gainFromRole:bySource("role"),gainFromEducation:bySource("education"),gainFromEvent:bySource("event"),getDerivedRatings:getDerivedRatings});
})();
