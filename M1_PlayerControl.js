// Ars Bellum M1 - minimal PlayerControl state (no succession execution)
(function () {
    "use strict";
    function clone(v){return JSON.parse(JSON.stringify(v));}
    function state(){return window.ArsGameState.getState().playerControl;}
    function ensure(){window.ArsGameState.ensureM1Root(); const s=state(); if(!Number.isInteger(s.version)){s.version=1;} if(!Number.isInteger(s.revision)){s.revision=0;} if(!Array.isArray(s.designatedSuccessorIds)){s.designatedSuccessorIds=[];} if(typeof s.controlStatus!=="string"){s.controlStatus="unbound";} return getSnapshot();}
    function getSnapshot(){return clone(state());}
    function validate(v){const e=[]; if(!v||typeof v!=="object"){return ["invalid_player_control"];} if(v.version>1)e.push("unsupported_future_version"); if(!Number.isInteger(v.revision)||v.revision<0)e.push("invalid_revision"); if(!Array.isArray(v.designatedSuccessorIds))e.push("invalid_successor_ids"); return e;}
    function update(plan){const p=plan||{},s=state(); if(p.expectedRevision!==s.revision){return {ok:false,error:"revision_conflict"};} const next=Object.assign({},clone(s),clone(p.patch||{})); next.designatedSuccessorIds=Array.from(new Set((next.designatedSuccessorIds||[]).filter(function(x){return typeof x==="string"&&x;}))); next.revision=s.revision+1; const errors=validate(next); if(errors.length){return {ok:false,error:"invalid_player_control",errors:errors};} window.ArsGameState.getState().playerControl=next; return {ok:true,playerControl:getSnapshot()};}
    function normalize(){const old=clone(state()); const next=Object.assign({version:1,revision:0,currentCharacterId:null,campaignClanId:null,designatedSuccessorIds:[],controlStatus:"unbound"},old); const errors=validate(next); if(errors.length){return {ok:false,error:"normalization_failed",errors:errors};} window.ArsGameState.getState().playerControl=next; return {ok:true,playerControl:getSnapshot()};}
    ensure();
    window.ArsPlayerControlState=Object.freeze({ensure:ensure,createDefault:ensure,getSnapshot:getSnapshot,validate:validate,normalize:normalize,update:update});
})();
