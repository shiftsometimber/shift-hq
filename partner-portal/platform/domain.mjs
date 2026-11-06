export const API_VERSION='sst-rx-v1';
export const SERVICES=Object.freeze({weight_management:{label:'Weight management',requiresPrescription:true},hormonal_health:{label:'Hormonal health',requiresPrescription:true},sexual_health:{label:'Sexual health',requiresPrescription:true},hair_loss:{label:'Hair loss',requiresPrescription:true},diagnostics:{label:'Bloods & diagnostics',requiresPrescription:false},sleep:{label:'Sleep',requiresPrescription:false},devices:{label:'Devices & consumables',requiresPrescription:false},non_prescription:{label:'Non-prescription products',requiresPrescription:false}});
export const COMMERCIAL_MODELS=['shift_collects','pharmacy_collects_commission','separate_clinical_pharmacy','complete_service','non_prescription'];
export const COST_KEYS=['acquisitionPence','deliveryPence','prescribingPence','technologyPence','processingPence','consumablesPence','otherCostPence'];
export const EXPENSE_KINDS=['acquisition_cost','delivery_cost','prescribing_cost','technology_cost','processing_cost','consumables_cost','other_cost'];
export const fail=(status,code)=>{throw Object.assign(Error(code),{status,code})};
export async function readObject(request,max=20000){
 if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))fail(415,'json_required');
 if(Number(request.headers.get('Content-Length')||0)>max)fail(413,'request_too_large');
 const reader=request.body?.getReader();if(!reader)fail(400,'invalid_json');const chunks=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();fail(413,'request_too_large')}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 try{const b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!b||Array.isArray(b)||typeof b!=='object')throw Error();return b}catch{fail(400,'invalid_json')}
}
export function text(v,max=200){if(typeof v!=='string'||!v.trim()||v!==v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))fail(422,'invalid_reference');return v;}
export function pence(v){if(!Number.isSafeInteger(v)||v<0||v>100000000)fail(422,'invalid_money');return v;}
export function serviceKey(v){if(!Object.hasOwn(SERVICES,v))fail(422,'unknown_service');return v;}
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('')}
export function economicsTerms(input){
 if(!COMMERCIAL_MODELS.includes(input.model))fail(422,'commercial_model_required');
 const out={model:input.model,currency:'GBP',orderKind:input.orderKind==='repeat'?'repeat':'first',supplierId:text(input.supplierId),sellingPence:pence(input.sellingPence),outputTaxPence:pence(input.outputTaxPence),taxTreatment:text(input.taxTreatment),costs:{},partnerSettlementPence:input.partnerSettlementPence==null?null:pence(input.partnerSettlementPence),commissionPence:input.commissionPence==null?null:pence(input.commissionPence),clinicalRevenuePence:input.clinicalRevenuePence==null?null:pence(input.clinicalRevenuePence),approvalReference:text(input.approvalReference),costSourceReference:text(input.costSourceReference)};
 for(const key of COST_KEYS)out.costs[key]=input.costs?.[key]==null?null:pence(input.costs[key]);
 if(out.outputTaxPence>out.sellingPence)fail(422,'tax_exceeds_sale');
 return out;
}
export function reconcileEconomics(terms,entries=[]){
 const sum=kind=>entries.filter(e=>e.kind===kind).reduce((a,e)=>a+e.amount_pence,0),unknown=COST_KEYS.filter(k=>terms.costs[k]==null);
 const additionalSale=sum('order_price_increase'),grossSale=terms.sellingPence+additionalSale,refund=sum('refund')-sum('refund_reversal'),adjustment=sum('adjustment_credit'),netSale=grossSale-terms.outputTaxPence-refund-adjustment;
 const revenue=terms.model==='pharmacy_collects_commission'?terms.commissionPence:terms.model==='separate_clinical_pharmacy'?terms.clinicalRevenuePence:netSale;
 const cost=unknown.length?null:COST_KEYS.reduce((a,k)=>a+terms.costs[k],0);
 const contribution=revenue==null||cost==null?null:revenue-cost;
 const paid=sum('member_payment'),settled=sum('partner_settlement');
 const missingActualCosts=EXPENSE_KINDS.filter(kind=>!entries.some(e=>e.kind===kind)),actualCost=missingActualCosts.length?null:EXPENSE_KINDS.reduce((a,k)=>a+sum(k),0);
 const ownCollection=['shift_collects','complete_service','non_prescription'].includes(terms.model),actualRevenue=ownCollection&&paid===grossSale?paid-refund-adjustment-terms.outputTaxPence:terms.model==='pharmacy_collects_commission'&&entries.some(e=>e.kind==='commission_received')?sum('commission_received'):null;
 return {currency:'GBP',orderKind:terms.orderKind,model:terms.model,originalSalePence:terms.sellingPence,approvedAdditionalSalePence:additionalSale,netSalePence:netSale,revenuePence:revenue,knownCostsPence:COST_KEYS.reduce((a,k)=>a+(terms.costs[k]||0),0),missingCosts:unknown,totalCostPence:cost,contributionPence:contribution,marginBps:revenue>0&&contribution!=null?Math.round(contribution/revenue*10000):null,memberPaidPence:paid,refundPence:refund,partnerSettledPence:settled,memberBalancePence:ownCollection?grossSale-paid:null,recordedEntries:entries.length,missingActualCosts,actualCostPence:actualCost,actualContributionPence:actualCost!==null&&actualRevenue!==null?actualRevenue-actualCost:null,actualCostVariancePence:actualCost!==null&&cost!==null?actualCost-cost:null,settlementBalancePence:terms.partnerSettlementPence===null?null:terms.partnerSettlementPence-settled,recordedAmountsReconciled:actualCost!==null&&actualRevenue!==null&&terms.partnerSettlementPence!==null&&settled===terms.partnerSettlementPence,providerConnectionsVerified:false,moneyMoved:false};
}
export function declineRefund(totalPence,assessmentFeeBps){pence(totalPence);if(!Number.isInteger(assessmentFeeBps)||assessmentFeeBps<0||assessmentFeeBps>10000)fail(422,'assessment_fee_terms_required');const fee=Math.round(totalPence*assessmentFeeBps/10000);return {assessmentFeePence:fee,refundPence:totalPence-fee,execution:'awaiting_finance_review'};}
export function commissioning(config){
 const required=['clinicalProviderReference','assessmentProtocolReference','evidencePolicyReference','supplierContractReference','operationsApprovalReference'];
 const missing=required.filter(k=>!config?.[k]);
 return {enabled:config?.enabled===true&&!missing.length,missing,protocolVersion:config?.assessmentProtocolReference||null};
}
export function nextAction({clinicalStatus,pharmacyStatus,syncPending,assigned,reviewDueAt},now=Date.now()){
 if(syncPending)return {kind:'reconciliation',label:'Reconcile shared status',priority:'urgent'};
 if(['query','rejected','delivery_exception','returned'].includes(pharmacyStatus))return {kind:'exception',label:'Resolve pharmacy exception',priority:'urgent'};
 if(reviewDueAt&&Date.parse(reviewDueAt)<now)return {kind:'overdue',label:'Clinical follow-up overdue',priority:'urgent'};
 if(!assigned&&!['declined','prescription_issued','closed'].includes(clinicalStatus))return {kind:'assignment',label:'Assign a clinician',priority:'normal'};
 if(clinicalStatus==='needs_information')return {kind:'information',label:'Awaiting member information',priority:'normal'};
 if(clinicalStatus==='ready_for_prescription')return {kind:'prescription',label:'Prescriber sign-off required',priority:'normal'};
 if(pharmacyStatus==='received')return {kind:'pharmacy',label:'Pharmacy verification required',priority:'normal'};
 return {kind:'current',label:pharmacyStatus||clinicalStatus||'Status not confirmed',priority:'normal'};
}
