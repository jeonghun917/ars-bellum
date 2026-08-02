// Ars Bellum M1 - Debt operations linked to committed transfers
(function(){
 "use strict";
 function recordCommittedPayment(plan){const p=plan||{},d=window.ArsDebtState.getSnapshot(p.debtId);if(!d)return {ok:false,error:"missing_debt"};const tx=window.ArsTransferSystem.getSnapshot(p.transactionId);if(!tx)return {ok:false,error:"missing_transaction"};if(tx.currencyId!==d.currencyId)return {ok:false,error:"currency_mismatch"};return window.ArsDebtState.applyCommand({type:"record_payment",debtId:p.debtId,expectedRevision:p.expectedRevision,transactionId:tx.id,amount:p.amount==null?tx.amount:p.amount});}
 function markOverdue(plan){const p=plan||{},d=window.ArsDebtState.getSnapshot(p.debtId);if(!d)return {ok:false,error:"missing_debt"};if(d.dueDay==null||!Number.isInteger(p.currentDay)||p.currentDay<=d.dueDay)return {ok:false,error:"not_overdue"};return window.ArsDebtState.applyCommand({type:"set_status",debtId:p.debtId,expectedRevision:p.expectedRevision,status:"overdue"});}
 function renegotiate(plan){return window.ArsDebtState.applyCommand({type:"renegotiate",debtId:plan.debtId,expectedRevision:plan.expectedRevision,patch:plan.patch});}
 window.ArsDebtSystem=Object.freeze({recordCommittedPayment:recordCommittedPayment,markOverdue:markOverdue,renegotiate:renegotiate});
})();
