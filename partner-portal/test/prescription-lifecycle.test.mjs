import memberService from '../service/member-service.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {functionalDataset} from '../qa/functional-fixtures.mjs';
import {RECORD} from './fixture.mjs';
import {authenticator} from './authenticator.mjs';
import portal from '../sstrx-worker.mjs';
import {captureOrderRoute,queueSubmission,submitJob,receiveVerifiedEvent,isolatedSyntheticAdapter} from '../platform/integrations.mjs';
import {applyPricePaymentEvent,priceSettlement,stripePriceWebhook} from '../platform/price-adjustments.mjs';
import {economicsTerms,reconcileEconomics} from '../platform/domain.mjs';
const ORIGIN='https://sstrx.shiftsometimber.co.uk';
const j=async(r,status=200)=>{const b=await r.json();assert.equal(r.status,status,JSON.stringify(b));return b;};
async function retainEvidence(f,name){
 if(!process.env.SSTRX_QA_EVIDENCE_DIR)return;const dir=path.join(process.env.SSTRX_QA_EVIDENCE_DIR,name);await fs.mkdir(dir,{recursive:true});
 for(const [role,actor]of [['clinical',3],['owner',1],['pharmacy',4]]){const exported=await j(await f.hq('/platform/exports/'+RECORD,actor,{purpose:'FICTIONAL acceptance evidence '+name}));await fs.writeFile(path.join(dir,role+'-verified-export.json'),JSON.stringify(exported,null,2));}
 await fs.writeFile(path.join(dir,'linked-records.json'),JSON.stringify({scope:'SYNTHETIC ONLY; no actual prescription, payment, supplier order or patient change',member:await j(await f.callMemberSnapshot()),hq:await j(await f.hq('/platform',1)),lifecycle:f.sql.prepare('SELECT * FROM rx_prescription_lifecycle').all(),supplyHistory:f.sql.prepare('SELECT * FROM rx_supply_history').all(),fulfilment:JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json),financeTasks:f.sql.prepare('SELECT * FROM clinical_prescription_finance_tasks').all(),financeReviews:f.sql.prepare('SELECT * FROM rx_lifecycle_finance_reviews').all(),funding:f.sql.prepare('SELECT * FROM rx_lifecycle_funding').all(),nativeOrderCount:f.sql.prepare('SELECT COUNT(*) n FROM medicine_orders').get().n,signatureCount:f.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_signatures').get().n},null,2));
}
async function setup(code='E'){
 const f=await functionalDataset(code),date=new Date().toISOString();
 for(const org of ['clinical-org','pharmacy-org']){const row=f.sql.prepare('SELECT * FROM rx_service_config WHERE org_id=?').get(org),config=row?JSON.parse(row.config_json):{};config.lifecycleProtocol={version:1,approvalReference:'FICTIONAL-'+org+'-WITHDRAWAL-POLICY',freshSignatureForReplacement:true,dispositions:['not_supplied','physically_returned','quarantined_before_dispatch']};f.sql.prepare("INSERT INTO rx_service_config VALUES(?,'weight_management',?,?,?) ON CONFLICT(org_id,service) DO UPDATE SET version=excluded.version,config_json=excluded.config_json").run(org,(row?.version||0)+1,JSON.stringify(config),date);}
 const batch=f.DB.batch.bind(f.DB);f.DB.batch=async commands=>{try{return await batch(commands);}catch(e){console.error('LIFECYCLE TEST SQL ERROR',e.stack);throw e;}};
 const state=()=>JSON.parse(f.sql.prepare('SELECT state_json FROM clinical_prescription_requests WHERE record_id=?').get(RECORD).state_json),original=state();
 const command={kind:'cancel',version:original.version,reason:'FICTIONAL withdrawal review',message:'Your care team is reviewing this prescription and supply has been placed on hold.',clientReference:crypto.randomUUID(),dueAt:new Date(Date.now()+3600000).toISOString(),financeOwnerId:1};
 const call=(path='',body,actor=3)=>f.hq('/platform/lifecycle/'+RECORD+path,actor,body);
 const request=body=>call('',body||command),ack=(r,extra={})=>call('/'+r.id+'/acknowledge',{version:r.version,reference:'FICTIONAL-PHARMACY-RECEIPT-'+r.id,disposition:'not_supplied',...extra},4);
 return {...f,original,command,state,call,request,ack,orderRow:()=>f.sql.prepare('SELECT * FROM medicine_orders WHERE id=1').get(),callMemberSnapshot:()=>memberService.fetch(new Request('https://my-timber.app/v1/member/my-shift',{headers:{Cookie:'sst_session='+f.memberToken,Origin:'https://my-timber.app'}}),f.env)};
}
async function freshReview(f){
 const work=f.sql.prepare("SELECT * FROM rx_prescription_lifecycle WHERE state='acknowledged'").get();await j(await f.call('/'+work.id+'/finance',{version:work.version,additionalMemberChargePence:0,costPence:0,sourceKind:'receipt',sourceReference:'FICTIONAL-PHARMACY-NO-ADDITIONAL-COST',approvalReference:'FICTIONAL-OWNER-FUNDING-APPROVAL'},1));
 const cookie=await f.login('CLNTEST'),version=()=>f.sql.prepare('SELECT version FROM clinical_case_state WHERE record_id=?').get(RECORD).version;
 for(const b of [{action:'start_review'},{action:'review_evidence',evidenceId:'front-photo-fixture',outcome:'approve'},{action:'decision',outcome:'proceed',identityVerified:true,independentMeasurementsVerified:true,verification:'FICTIONAL current independent checks',handover:f.handover,rationale:'FICTIONAL new review for replacement',message:'Fictional replacement review recorded'}])await j(await f.partner('/'+RECORD+'/action',cookie,{version:version(),assessmentVersion:1,...b}));
}
async function replacementSignature(f,directions='FICTIONAL AMENDED DIRECTIONS',expectedStatus=200,variantId=11){
 const cookie=await f.login('CLNTEST'),current=f.state();let p=(await j(await f.partner('/prescriptions/'+RECORD+'/proposal',cookie,{version:current.version,partnerId:'pharmacy-org',expiresAt:new Date(Date.now()+3600000).toISOString(),reason:'FICTIONAL reviewed amendment',clinicalRationale:'Fictional acceptance only',treatment:{variantId,packs:1,quantity:'One fictional pack',dose:'Fictional dose',route:'Oral test formulation',directions}}))).prescription;
 await j(await f.member('/prescription/decision',{version:p.version,action:'accept',agreed:true}));
 if(f.afterAgreement)await f.afterAgreement(f,p,cookie);const agreedVersion=f.state().version;
 const key=await authenticator(),c=await j(await f.partner('/prescriptions/'+RECORD+'/keys/challenge',cookie,{})),registered=await j(await f.partner('/prescriptions/'+RECORD+'/keys/register',cookie,{challengeId:c.id,proof:await key.register(c.challenge)}));
 await j(await f.hq('/prescriptions/keys/'+registered.keyId+'/approve',2,{version:0,expiresAt:new Date(Date.now()+3600000).toISOString(),verificationReference:'FICTIONAL independent replacement signing key review'}));
 const challenge=await j(await f.partner('/prescriptions/'+RECORD+'/signing-challenge',cookie,{version:agreedVersion,keyId:registered.keyId}));
 const body={version:agreedVersion,challengeId:challenge.id,document:challenge.document,proof:await key.sign(challenge.challenge)};if(f.beforeSign)await f.beforeSign();const signed=await j(await f.partner('/prescriptions/'+RECORD+'/sign',cookie,body),expectedStatus);return {signed,cookie,body};
}
test('RX-SG2 a signed cancellation holds supply until an assigned pharmacy acknowledges; immutable signature and finance review remain',async()=>{
 const f=await setup();try{
  const original=f.sql.prepare('SELECT * FROM clinical_prescription_signatures').get(),requested=await j(await f.request());assert.equal(requested.state,'requested');assert.equal(f.state().status,'issued');
  assert((await j(await f.request())).duplicate);const cookie=await f.login('DSPTEST');await j(await f.partner('/partners/fulfilment/'+f.order+'/action',cookie,{version:0,action:'accept'}),409);
  const ack=await j(await f.ack(requested));assert.equal(ack.state,'closed');assert.equal(f.state().status,'cancelled');assert.equal(JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json).status,'cancelled');assert.equal(f.orderRow().clinical_status,'cancelled');
  assert.deepEqual(f.sql.prepare('SELECT * FROM clinical_prescription_signatures').get(),original);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_versions').get().n,4);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM clinical_prescription_finance_tasks WHERE kind='cancellation_review'").get().n,1);assert((await j(await f.ack(requested))).duplicate);
  await retainEvidence(f,'signed-cancellation');
 }finally{f.close();}
});
test('RX-LC7 withdrawal finance remains owned and due until an explicit terms-based outcome; other roles and unconfirmed refunds cannot close it',async()=>{
 const f=await setup();try{const request=await j(await f.request()),closed=await j(await f.ack(request));let work=(await j(await f.hq('/platform',1))).records[0];assert.equal(work.action.code,'withdrawal_payment_review');assert.equal(work.action.owner.userId,1);assert.equal(work.action.dueAt,f.command.dueAt);
  const command={version:closed.version,outcome:'no_refund_due',termsReference:'FICTIONAL-ACCEPTED-NO-REFUND-TERMS',approvalReference:'FICTIONAL-OWNER-REVIEW',reason:'FICTIONAL signed policy acceptance test only'};
  await j(await f.call('/'+request.id+'/financial-resolution',command,6),403);await j(await f.call('/'+request.id+'/financial-resolution',{...command,outcome:'processor_refund_completed',refundId:'UNCONFIRMED'},1),409);
  let finances=await j(await f.hq('/platform/refunds',1));assert.equal(finances.withdrawalFinanceWork.length,1);await j(await f.call('/'+request.id+'/financial-resolution',command,1));assert((await j(await f.call('/'+request.id+'/financial-resolution',command,1))).duplicate);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_lifecycle_finance_reviews').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_refunds').get().n,0);assert.equal(f.sql.prepare("SELECT status FROM clinical_prescription_finance_tasks WHERE id=?").get('lifecycle-finance:'+request.id).status,'reviewed');assert.equal((await j(await f.hq('/platform/refunds',1))).withdrawalFinanceWork.length,0);assert.notEqual((await j(await f.hq('/platform',1))).records[0].action.code,'withdrawal_payment_review');
  const audit=await j(await f.hq('/platform/exports/'+RECORD,1,{purpose:'FICTIONAL withdrawal finance verification'}));assert(audit.content.audit.some(e=>e.action==='withdrawal_finance_reviewed'&&e.actorId==='1'));
 }finally{f.close();}
});
test('RX-C3 signed amendment requires pharmacy withdrawal, a fresh decision, member agreement and a new verified signature; original history survives',async()=>{
 const f=await setup();try{
  const old=f.sql.prepare('SELECT document_json,digest FROM clinical_prescription_signatures').get(),request=await j(await f.request({...f.command,kind:'amend'}));
  await j(await f.ack(request));const cookie=await f.login('CLNTEST');await j(await f.partner('/prescriptions/'+RECORD+'/proposal',cookie,{version:f.state().version}),409);
  await freshReview(f);const result=await replacementSignature(f);assert.equal(result.signed.pharmacyTaskCreated,true);assert.notEqual(f.state().prescriptionId,f.original.prescriptionId);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_signatures').get().n,2);
  assert.deepEqual(f.sql.prepare('SELECT document_json,digest FROM clinical_prescription_signatures WHERE id=?').get(f.original.prescriptionId),old);const history=f.sql.prepare('SELECT * FROM rx_supply_history').get();assert.equal(history.prescription_id,f.original.prescriptionId);assert.equal(JSON.parse(history.fulfilment_json).status,'cancelled');assert.equal(f.orderRow().prescription_reference,f.state().prescriptionId);assert.equal(f.orderRow().clinical_status,'sent_to_pharmacy');
  await j(await f.partner('/prescriptions/'+RECORD+'/sign',result.cookie,result.body),409);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_signatures').get().n,2);
  await retainEvidence(f,'signed-amendment');
 }finally{f.close();}
});
test('RX-DL2 replacement after dispatch requires a documented pharmacy return and creates a linked new supply with independent state',async()=>{
 const f=await setup('I');try{
  const r=await j(await f.request({...f.command,kind:'replacement'}));await j(await f.ack(r),409);
  await j(await f.ack(r,{disposition:'physically_returned'}));await freshReview(f);await replacementSignature(f,'FICTIONAL REPLACEMENT SUPPLY DIRECTIONS');
  const supply=JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json);assert.equal(supply.status,'received');assert.equal(supply.tracking,undefined);assert.equal(supply.prescriptionId,f.state().prescriptionId);assert.notEqual(supply.prescriptionId,f.original.prescriptionId);
  const history=f.sql.prepare('SELECT * FROM rx_supply_history').get();assert.equal(JSON.parse(history.fulfilment_json).status,'returned');assert.equal(f.sql.prepare('SELECT new_prescription_id FROM rx_prescription_lifecycle').get().new_prescription_id,supply.prescriptionId);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medicine_orders').get().n,1);const member=await j(await f.callMemberSnapshot());assert.equal(member.orders[0].timeline.find(s=>s.key==='dispensed').complete,false);assert.equal(member.orders[0].timeline.find(s=>s.key==='dispatched').complete,false);assert.equal(member.orders[0].supplyHistory.length,1);
  const pharmacy=await f.login('DSPTEST');for(const action of ['accept','prepare','dispensed','dispatch','delivered']){const current=JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json);await j(await f.partner('/partners/fulfilment/'+f.order+'/action',pharmacy,{version:current.version,action,...action==='dispatch'?{carrier:'dpd',trackingNumber:'FICTIONAL-REPLACEMENT-ONLY'}:{},...action==='delivered'?{message:'FICTIONAL replacement delivery confirmed'}:{}}));}
  const delivered=await j(await f.callMemberSnapshot());assert.equal(delivered.orders[0].status,'delivered');assert.equal(delivered.orders[0].timeline.find(s=>s.key==='dispensed').complete,true);assert.equal(delivered.orders[0].timeline.find(s=>s.key==='dispatched').complete,true);assert.equal(delivered.orders[0].supplyHistory.length,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medicine_orders').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_signatures').get().n,2);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_refunds").get().n,0);
  await retainEvidence(f,'linked-replacement-delivered');
 }finally{f.close();}
});
test('RX-LC4 unrelated roles, stale versions, changed protocols and missing release authorisation cannot change signed records',async()=>{
 const f=await setup();try{
  await j(await f.request({...f.command,version:0}),409);await j(await f.call('',f.command,1),403);const r=await j(await f.request());await j(await f.call('/'+r.id+'/acknowledge',{version:1,reference:'TEST',disposition:'not_supplied'},5),404);
  f.sql.prepare("UPDATE rx_service_config SET version=version+1 WHERE org_id='pharmacy-org'").run();await j(await f.ack(r),409);assert.equal(f.state().status,'issued');assert.equal(f.sql.prepare('SELECT ack_at FROM rx_prescription_lifecycle').get().ack_at,null);
  f.env.SSTRX_ENVIRONMENT='production';await j(await f.ack(r),503);
 }finally{f.close();}
});

test('RX-LC5 a supply hold arriving immediately before replacement signing rolls the entire new issue back',async()=>{
 const f=await setup();try{const r=await j(await f.request({...f.command,kind:'amend'}));await j(await f.ack(r));await freshReview(f);
  f.beforeSign=async()=>{const batch=f.DB.batch.bind(f.DB);let raced=false;f.DB.batch=async commands=>{if(!raced&&commands.some(s=>s.sql.startsWith('INSERT INTO clinical_prescription_events')&&s.args.includes('prescription_issued'))){raced=true;f.sql.prepare("INSERT INTO rx_supply_holds VALUES('raced-hold',?,'supply_clarification','pharmacy-org',4,'open',1,'FICTIONAL-LATE-HOLD',NULL,?,?)").run(f.order,new Date().toISOString(),new Date().toISOString());}return batch(commands);};};
  await replacementSignature(f,'FICTIONAL LATE-HOLD TEST',409);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_signatures').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_supply_history').get().n,0);assert.equal(f.state().status,'accepted');
 }finally{f.close();}
});
test('RX-LC6 replacement archives supplier routing, supersedes the old job and rejects a late receipt for the withdrawn prescription',async()=>{
 const f=await setup();try{
  const contract='FICTIONAL-LINKED-REPLACEMENT',date=new Date().toISOString(),config={pharmacyOrgId:'pharmacy-org',services:['weight_management'],contractReference:'FICTIONAL',receiptContract:{schemaVersion:'sst-rx-event-v1',approvalReference:'FICTIONAL-EVENT-MAP'}};
  f.sql.prepare("INSERT INTO rx_supplier_contracts VALUES(?,'clinical-org','synthetic',1,'approved',?,?)").run(contract,JSON.stringify(config),date);f.sql.prepare('INSERT INTO rx_product_mappings VALUES(?,11,?,?,?,?,1)').run(contract,'FICTIONAL-PRODUCT','tablet','Synthetic strength','one synthetic pack');const oldRoute=await captureOrderRoute(f.DB,{orderNumber:f.order,memberId:42,clinicalOrgId:'clinical-org',pharmacyOrgId:'pharmacy-org',contractId:contract,prescriptionId:f.original.prescriptionId,variantId:11,service:'weight_management',authorisationReference:'FICTIONAL-ROUTING'}),oldJob=await queueSubmission(f.DB,oldRoute);
  const work=await j(await f.request({...f.command,kind:'amend'}));await j(await f.ack(work));await freshReview(f);await replacementSignature(f);
  assert.equal(f.sql.prepare('SELECT prescription_id FROM rx_order_route_history').get().prescription_id,f.original.prescriptionId);assert.equal(f.sql.prepare('SELECT state FROM rx_integration_jobs WHERE id=?').get(oldJob.id).state,'superseded');await assert.rejects(submitJob(f.env,oldJob.id),/job_not_submittable/);
  const current=f.sql.prepare('SELECT * FROM rx_order_routes').get();assert.equal(current.prescription_id,f.state().prescriptionId);const newJob=await queueSubmission(f.DB,current);assert.notEqual(newJob.idempotency_key,oldJob.idempotency_key);
  f.env.SSTRX_CANONICAL_RECEIPTS_ENABLED='true';f.env.SSTRX_SYNTHETIC_ADAPTER=isolatedSyntheticAdapter({verifyWebhook:async raw=>({verified:true,contractId:contract,event:JSON.parse(raw)})});await assert.rejects(receiveVerifiedEvent(f.env,contract,JSON.stringify({kind:'accepted',eventReference:'LATE-OLD-RECEIPT',orderReference:f.order,occurredAt:date,schemaVersion:'sst-rx-event-v1',sourceRecordVersion:2,prescriptionReference:f.original.prescriptionId,caseReference:RECORD,idempotencyKey:'OLD-RECEIPT-2'}),'FICTIONAL-VERIFIER'),/supplier_receipt_episode_mismatch/);assert.equal(JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json).status,'received');
 }finally{f.close();}
});
async function priceSetup(mode='collect_difference',variantId=12,total=150){
 const f=await setup(),date=new Date().toISOString();
 for(const [id,price]of [[12,150],[13,70]]){f.sql.prepare("INSERT INTO medicine_variants(id,medicine_id,strength_label,selling_price_pence,status,updated_at,sellable,availability_state) VALUES(?,1,?,?,'available',?,1,'available')").run(id,'FICTIONAL alternative '+id,price,date);f.sql.prepare('INSERT INTO medicine_inventory VALUES(?,20,0,?)').run(id,date);}
 const terms=economicsTerms({model:'shift_collects',supplierId:'FICTIONAL-SUPPLIER',sellingPence:100,outputTaxPence:0,taxTreatment:'FICTIONAL',approvalReference:'FICTIONAL-ACCEPTED-TERMS',costSourceReference:'FICTIONAL-COSTS'});
 f.sql.prepare('INSERT INTO rx_economics VALUES(?,1,?,?)').run(f.order,JSON.stringify(terms),date);f.sql.prepare("INSERT INTO rx_finance_entries VALUES('original-payment',?,'original-payment','member_payment',100,'GBP','pi_FICTIONAL_E',?,?)").run(f.order,date,date);
 const lifecycle=await j(await f.request({...f.command,kind:'amend'}));await j(await f.ack(lifecycle));await freshReview(f);
 const value={version:2,variantId,packs:1,mode,memberTotalPence:total,termsReference:'FICTIONAL-ACCEPTED-TERMS',approvalReference:'FICTIONAL-PRICE-APPROVAL',costReference:'FICTIONAL-SUPPLIER-PRICE',discountReference:'FICTIONAL-ABSORBED-DIFFERENCE',expiresAt:new Date(Date.now()+3600000).toISOString()};
 const plan=await j(await f.call('/'+lifecycle.id+'/price-plan',value,1));
 const payment=(body,token=f.memberToken)=>memberService.fetch(new Request('https://my-timber.app/v1/member/clinical-records/'+RECORD+'/price-adjustments/'+lifecycle.id,{method:body?'POST':'GET',headers:{Cookie:'sst_session='+token,Origin:'https://my-timber.app',...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined}),f.env);
 return {...f,lifecycle,plan,priceCommand:value,payment};
}
function paymentTransport(){return {calls:[],async fetch(request){const b=Object.fromEntries(new URLSearchParams(await request.text()));this.calls.push({body:b,key:request.headers.get('Idempotency-Key')});return Response.json({id:'cs_test_FICTIONAL_ADJUSTMENT',livemode:false,client_reference_id:b.client_reference_id,amount_total:Number(b['line_items[0][price_data][unit_amount]']),currency:'gbp',url:'https://checkout.stripe.com/c/pay/FICTIONAL_ONLY'});}};}
function priceReceipt(f,type='checkout.session.completed',paid='paid',id=crypto.randomUUID()){
 const p=f.sql.prepare('SELECT * FROM rx_lifecycle_payments ORDER BY rowid DESC LIMIT 1').get();return {id:'evt_'+id,type,created:Math.floor(Date.now()/1000),livemode:false,data:{object:{id:p.session_id||'cs_test_FICTIONAL_ADJUSTMENT',client_reference_id:p.id,metadata:{sst_price_payment_id:p.id,sst_lifecycle_id:p.lifecycle_id,order_reference:p.order_number},amount_total:p.amount_pence,currency:'gbp',payment_intent:'pi_FICTIONAL_PRICE_CHANGE',payment_status:paid}}};
}
for(const [mode,unknown] of [['test',false],['live',false],['test',true]])test('RX-PROC '+mode+' protocol '+(unknown?'unknown result':'checkout')+' uses exact commissioned account and signed receipt; every HTTP request is intercepted',async()=>{
 const f=await priceSetup();try{
  const accountId='acct_FICTIONAL000',calls=[],secret='whsec_FICTIONAL_PROCESSOR_ONLY';let session,wrongReconciliationAccount=false;
  f.afterAgreement=async(_f,p)=>{
   const original=globalThis.fetch;
   Object.assign(f.env,{SSTRX_ENVIRONMENT:mode==='live'?'production':'synthetic',STRIPE_MODE:mode,SSTRX_PRICE_PAYMENTS_ENABLED:'true',SSTRX_PRICE_PAYMENT_MODE:mode,STRIPE_SECRET_KEY:['rk',mode,'FICTIONALONLY'].join('_'),STRIPE_PRICE_WEBHOOK_SECRET:secret,SSTRX_PRICE_PAYMENT_COMMISSIONING:JSON.stringify({version:1,mode,accountId,collectionModel:'shift_collects',approvalReference:'FICTIONAL-COMMISSIONING',sandboxEvidenceReference:'FICTIONAL-INTERCEPTED-WIRE-TEST',expiresAt:new Date(Date.now()+3600000).toISOString()})});
   globalThis.fetch=async(url,options={})=>{
    assert.equal(new URL(url).origin,'https://api.stripe.com');calls.push({path:new URL(url).pathname,method:options.method||'GET'});assert.equal(options.redirect,'manual');
    if(new URL(url).pathname==='/v1/account')return Response.json({id:wrongReconciliationAccount?'acct_WRONG':accountId});
    if((options.method||'GET')==='GET'&&new URL(url).pathname==='/v1/checkout/sessions/'+session.id)return Response.json({...session,payment_intent:'pi_FICTIONAL_WIRE_'+mode,payment_status:'paid'});
    assert.equal(new URL(url).pathname,'/v1/checkout/sessions');const b=Object.fromEntries(new URLSearchParams(options.body));assert.equal(b['line_items[0][price_data][unit_amount]'],'50');assert.equal(b['payment_method_types[0]'],undefined);assert.equal(b['payment_intent_data[metadata][sst_price_payment_id]'],b.client_reference_id);assert(Number(b.expires_at)*1000-Date.now()>1800000);assert.match(options.headers['Idempotency-Key'],/^rx-price:/);
    const metadata=Object.fromEntries(Object.entries(b).filter(([key])=>key.startsWith('metadata[')).map(([key,value])=>[key.slice(9,-1),value]));
    session={id:'cs_'+mode+'_FICTIONAL_WIRE_ONLY',object:'checkout.session',mode:'payment',status:'open',livemode:mode==='live',client_reference_id:b.client_reference_id,amount_total:50,currency:'gbp',metadata,expires_at:Number(b.expires_at),url:'https://checkout.stripe.com/c/pay/FICTIONAL_ONLY'};
    if(unknown)throw Error('FICTIONAL response lost after provider acceptance');return Response.json(session);
   };
   try{
    const request={agreed:true,version:p.version+1,amountPence:1};const result=await j(await f.payment(request));assert.equal(result.state,unknown?'unknown':'checkout_open');await j(await f.payment(request));assert.equal(calls.filter(c=>c.method==='POST').length,1);
    const row=f.sql.prepare('SELECT * FROM rx_lifecycle_payments').get(),source=JSON.parse(f.sql.prepare('SELECT source_json FROM rx_lifecycle_payment_sources').get().source_json);assert.equal(source.accountId,accountId);assert.equal(source.mode,mode);assert.equal(source.kind,'stripe');assert.throws(()=>f.sql.exec("UPDATE rx_lifecycle_payment_sources SET source_json='{}'"),/immutable_processor_source/);
    const event={id:'evt_FICTIONAL_WIRE_'+mode+'_'+unknown,type:'checkout.session.async_payment_succeeded',created:Math.floor(Date.now()/1000),livemode:mode==='live',data:{object:{...session,payment_intent:'pi_FICTIONAL_WIRE_'+mode,payment_status:'paid'}}};
    await assert.rejects(applyPricePaymentEvent(f.env,event),mode==='live'?/not_authorised/:/source_mismatch/);
    // Disabling NEW Checkout creation must not discard a genuine late webhook.
    f.env.SSTRX_PRICE_PAYMENTS_ENABLED='false';const raw=JSON.stringify(event),ts=Math.floor(Date.now()/1000),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']),sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ts+'.'+raw))).toString('hex');
    const signed=()=>stripePriceWebhook(new Request('https://api.shiftsometimber.co.uk/v1/hq/clinical/platform/processor/adjustments',{method:'POST',headers:{'Stripe-Signature':'t='+ts+',v1='+sig},body:raw}),f.env);
    if(unknown){wrongReconciliationAccount=true;assert.equal((await j(await signed(),503)).error,'price_receipt_account_reconciliation_required');assert.equal(f.sql.prepare('SELECT state FROM rx_lifecycle_payments').get().state,'unknown');assert.equal(calls.filter(c=>c.method==='POST').length,1);wrongReconciliationAccount=false;}
    assert.equal((await j(await signed())).state,'paid');assert.equal((await j(await signed())).duplicate,true);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_finance_entries WHERE event_reference=?").get('price-payment:'+row.id).n,1);assert.equal(calls.filter(c=>c.method==='POST').length,1);
    assert(f.sql.prepare("SELECT 1 FROM rx_audit_journal WHERE source_table='rx_lifecycle_payment_sources'").get());
   }finally{globalThis.fetch=original;f.env.SSTRX_ENVIRONMENT='synthetic';f.env.STRIPE_MODE='test';}
  };
  await replacementSignature(f,'FICTIONAL processor wire protocol only',200,12);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medicine_orders').get().n,1);assert.equal(f.sql.prepare("SELECT SUM(amount_pence) n FROM rx_finance_entries WHERE kind='member_payment'").get().n,150);
  if(!unknown)await retainEvidence(f,'processor-'+mode+'-intercepted-price-adjustment');
 }finally{f.close();}
});
test('RX-PRICE1 increased-price amendment requires the exact finance plan, member consent and verified top-up; one existing order and linked history survive',async()=>{
 const f=await priceSetup();try{const t=paymentTransport();f.env.LIFECYCLE_PAYMENT_TEST_TRANSPORT=t;
  f.afterAgreement=async(_f,p,cookie)=>{let d=await j(await f.payment({agreed:true,version:p.version+1}));assert.equal(d.state,'checkout_open');await j(await f.payment({agreed:true,version:p.version+1}));assert.equal(t.calls.length,1);
   const key=f.sql.prepare('SELECT * FROM clinical_prescriber_signing_keys LIMIT 1').get();assert.equal((await j(await f.callMemberSnapshot())).orders[0].pricePlans[0].settled,false);
   // Transport creation and a completed-but-unpaid event are not settlement.
   await applyPricePaymentEvent(f.env,priceReceipt(f,'checkout.session.completed','unpaid'));
   assert.equal((await priceSettlement(f.env,f.sql.prepare('SELECT * FROM rx_lifecycle_price_plans').get())).settled,false);
   assert.equal((await j(await f.partner('/prescriptions/'+RECORD+'/signing-challenge',cookie,{version:p.version+1,keyId:key.id}),409)).error,'payment_reconciliation_required');
   const event=priceReceipt(f,'checkout.session.async_payment_succeeded');await applyPricePaymentEvent(f.env,event);assert((await applyPricePaymentEvent(f.env,event)).duplicate);
  };
  await replacementSignature(f,'FICTIONAL higher price treatment',200,12);assert.equal(f.state().comparison.paymentState,'settled');assert.equal(f.orderRow().total_pence,100);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medicine_orders').get().n,1);assert.equal(f.sql.prepare("SELECT SUM(amount_pence) n FROM rx_finance_entries WHERE kind='member_payment'").get().n,150);assert.equal((await j(await f.callMemberSnapshot())).orders[0].pricePlans[0].settled,true);assert.equal((await j(await f.hq('/platform/refunds',1))).priceWork.length,0);
  await retainEvidence(f,'increased-price-amendment');
 }finally{f.close();}
});
test('RX-PRICE2 an owner can absorb a documented higher catalogue price without a second payment; exact approval, discount and scope are retained',async()=>{
 const f=await priceSetup('absorb_difference',12,100);try{await j(await f.call('/'+f.lifecycle.id+'/price-plan',f.priceCommand,6),403);assert((await j(await f.call('/'+f.lifecycle.id+'/price-plan',f.priceCommand,1))).duplicate);await j(await f.call('/'+f.lifecycle.id+'/price-plan',{...f.priceCommand,memberTotalPence:90},1),422);
  await replacementSignature(f,'FICTIONAL absorbed price difference',200,12);assert.equal(f.state().comparison.revisedTotalPence,100);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_lifecycle_payments').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_signatures').get().n,2);await retainEvidence(f,'absorbed-price-amendment');
 }finally{f.close();}
});
test('RX-PRICE3 reduced-price amendment remains held until an exact completed refund is linked; duplicate receipts and links cannot issue a second refund',async()=>{
 const f=await priceSetup('refund_difference',13,70);try{
  f.afterAgreement=async(_f,p)=>{const plan=f.sql.prepare('SELECT * FROM rx_lifecycle_price_plans').get();assert.equal((await priceSettlement(f.env,plan)).settled,false);
   let refund=await j(await f.hq('/platform/refunds',1,{orderReference:f.order,amountPence:30,reason:'FICTIONAL lower price amendment',termsReference:f.priceCommand.termsReference,clientReference:crypto.randomUUID()}));refund=await j(await f.hq('/platform/refunds/'+refund.id+'/approve',1,{version:refund.version,approvalReference:'FICTIONAL-LOWER-PRICE',exceptionDueAt:new Date(Date.now()+3600000).toISOString()}));
   await j(await f.call('/'+f.lifecycle.id+'/price-refund',{version:2,refundId:refund.id},1),409);
   f.env.REFUND_TEST_TRANSPORT={fetch:async()=>Response.json({id:'re_FICTIONAL_PRICE',amount:30,currency:'gbp',payment_intent:'pi_FICTIONAL_E',status:'succeeded'})};await j(await f.hq('/platform/refunds/'+refund.id+'/submit',1,{version:refund.version}));
   const link={version:2,refundId:refund.id};await j(await f.call('/'+f.lifecycle.id+'/price-refund',link,1));assert((await j(await f.call('/'+f.lifecycle.id+'/price-refund',link,1))).duplicate);assert((await priceSettlement(f.env,plan)).settled);
  };
  await replacementSignature(f,'FICTIONAL lower price treatment',200,13);assert.equal(f.state().comparison.revisedTotalPence,70);assert.equal(f.state().comparison.refundState,'completed');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_refunds').get().n,1);assert.equal(f.sql.prepare("SELECT SUM(CASE WHEN kind='member_payment' THEN amount_pence WHEN kind='refund' THEN -amount_pence ELSE 0 END) n FROM rx_finance_entries").get().n,70);await retainEvidence(f,'reduced-price-amendment');
 }finally{f.close();}
});
test('RX-PRICE4 unknown checkout outcome is held without a second submission; verified later receipt reconciles the original attempt',async()=>{
 const f=await priceSetup();try{let calls=0;f.env.LIFECYCLE_PAYMENT_TEST_TRANSPORT={fetch:async()=>{calls++;throw Error('FICTIONAL timeout after acceptance');}};
  f.afterAgreement=async(_f,p)=>{assert.equal((await j(await f.payment({version:p.version+1,agreed:true}))).state,'unknown');assert((await j(await f.payment({version:p.version+1,agreed:true}))).reconciliationRequired);assert.equal(calls,1);await applyPricePaymentEvent(f.env,priceReceipt(f));};await replacementSignature(f,'FICTIONAL reconciled top-up',200,12);assert.equal(calls,1);
 }finally{f.close();}
});
test('RX-PRICE5 forged, mismatched and live top-up receipts are rejected; changed ledger before signing rolls the new signature back',async()=>{
 const f=await priceSetup();try{f.env.LIFECYCLE_PAYMENT_TEST_TRANSPORT=paymentTransport();f.afterAgreement=async(_f,p)=>{await j(await f.payment({version:p.version+1,agreed:true}));const e=priceReceipt(f);await assert.rejects(applyPricePaymentEvent(f.env,{...e,livemode:true}),/not_authorised/);await assert.rejects(applyPricePaymentEvent(f.env,{...e,data:{object:{...e.data.object,amount_total:51}}}),/does_not_match/);await applyPricePaymentEvent(f.env,e);};
  f.beforeSign=async()=>{f.sql.prepare("INSERT INTO rx_finance_entries VALUES('late-refund',?,'late-refund','refund',1,'GBP','FICTIONAL-RACE',?,?)").run(f.order,new Date().toISOString(),new Date().toISOString());};await replacementSignature(f,'FICTIONAL price receipt race',409,12);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_signatures').get().n,1);
  f.env.STRIPE_PRICE_WEBHOOK_SECRET='FICTIONAL';await j(await stripePriceWebhook(new Request('https://api.shiftsometimber.co.uk/v1/hq/clinical/platform/processor/adjustments',{method:'POST',body:JSON.stringify(priceReceipt(f))}),f.env),401);
 }finally{f.close();}
});
async function sendSignedPriceEvent(f,event){const raw=JSON.stringify(event),ts=Math.floor(Date.now()/1000),secret='FICTIONAL-PRICE-WEBHOOK-KEY';f.env.STRIPE_PRICE_WEBHOOK_SECRET=secret;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']),sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ts+'.'+raw))).toString('hex');return stripePriceWebhook(new Request('https://api.shiftsometimber.co.uk/v1/hq/clinical/platform/processor/adjustments',{method:'POST',headers:{'Stripe-Signature':'t='+ts+',v1='+sig},body:raw}),f.env);}
test('RX-PRICE6 only a verified failed checkout permits an explicit new attempt; stale failures cannot undo paid settlement',async()=>{
 const f=await priceSetup();try{const t=paymentTransport(),base=t.fetch.bind(t);t.fetch=async request=>{const r=await base(request),s=await r.json();s.id+='_attempt_'+t.calls.length;return Response.json(s)};f.env.LIFECYCLE_PAYMENT_TEST_TRANSPORT=t;
  f.afterAgreement=async(_f,p)=>{const request={version:p.version+1,agreed:true};await j(await f.payment(request));await j(await sendSignedPriceEvent(f,priceReceipt(f,'checkout.session.async_payment_failed','unpaid')));assert.equal((await j(await f.payment(request))).state,'failed');assert.equal(t.calls.length,1);assert.equal(f.sql.prepare("SELECT owner_user_id FROM rx_finance_exceptions WHERE kind='price_payment_failed'").get().owner_user_id,1);
   await j(await f.payment({...request,retryFailedPayment:true}));assert.equal(t.calls.length,2);assert.notEqual(t.calls[0].key,t.calls[1].key);await j(await sendSignedPriceEvent(f,priceReceipt(f,'checkout.session.async_payment_succeeded')));await j(await sendSignedPriceEvent(f,priceReceipt(f,'checkout.session.async_payment_failed','unpaid')));assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_lifecycle_payments WHERE state='paid'").get().n,1);assert.equal(f.sql.prepare('SELECT state FROM rx_finance_exceptions WHERE id=?').get('price:'+f.lifecycle.id).state,'resolved');
  };await replacementSignature(f,'FICTIONAL recovered failed payment',200,12);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_lifecycle_payments').get().n,2);await retainEvidence(f,'failed-payment-explicit-retry');
 }finally{f.close();}
});
test('RX-PRICE7 the original and additional payment refund separately against their own processor references and limits; a later refund stops supply',async()=>{
 const f=await priceSetup();try{f.env.LIFECYCLE_PAYMENT_TEST_TRANSPORT=paymentTransport();f.afterAgreement=async(_f,p)=>{await j(await f.payment({version:p.version+1,agreed:true}));await applyPricePaymentEvent(f.env,priceReceipt(f));};await replacementSignature(f,'FICTIONAL payment-source refund test',200,12);
  const terms=JSON.parse(f.sql.prepare('SELECT terms_json FROM rx_economics').get().terms_json),before=reconcileEconomics(terms,f.sql.prepare('SELECT * FROM rx_finance_entries').all());assert.equal(before.approvedAdditionalSalePence,50);assert.equal(before.netSalePence,150);assert.equal(before.memberBalancePence,0);
  const payment=f.sql.prepare("SELECT * FROM rx_lifecycle_payments WHERE state='paid'").get(),intents=[];f.env.REFUND_TEST_TRANSPORT={fetch:async request=>{const b=Object.fromEntries(new URLSearchParams(await request.text()));intents.push(b.payment_intent);return Response.json({id:'re_FICTIONAL_MULTI_'+intents.length,amount:Number(b.amount),currency:'gbp',payment_intent:b.payment_intent,status:'succeeded'});}};
  for(const [amount,paymentSourceId]of [[100,undefined],[50,payment.id]]){let r=await j(await f.hq('/platform/refunds',1,{orderReference:f.order,amountPence:amount,paymentSourceId,termsReference:'FICTIONAL-ACCEPTED-TERMS',reason:'FICTIONAL complete cancellation',clientReference:crypto.randomUUID()}));r=await j(await f.hq('/platform/refunds/'+r.id+'/approve',1,{version:r.version,approvalReference:'FICTIONAL-SOURCE-REFUND',exceptionDueAt:new Date(Date.now()+3600000).toISOString()}));await j(await f.hq('/platform/refunds/'+r.id+'/submit',1,{version:r.version}));}
  assert.deepEqual(intents,['pi_FICTIONAL_E','pi_FICTIONAL_PRICE_CHANGE']);assert.equal(reconcileEconomics(terms,f.sql.prepare('SELECT * FROM rx_finance_entries').all()).netSalePence,0);
  await j(await f.hq('/platform/refunds',1,{orderReference:f.order,amountPence:1,paymentSourceId:payment.id,termsReference:'FICTIONAL',reason:'FICTIONAL over-refund',clientReference:crypto.randomUUID()}),409);
  const pharmacy=await f.login('DSPTEST'),current=JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json);await j(await f.partner('/partners/fulfilment/'+f.order+'/action',pharmacy,{version:current.version,action:'accept'}),422);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medicine_orders').get().n,1);await retainEvidence(f,'additional-and-original-payment-refunds');
 }finally{f.close();}
});
test('RX-LC8 a dispensed but undispatched prescription can only be withdrawn with the protocol-approved quarantine disposition',async()=>{
 const f=await setup();try{const pharmacy=await f.login('DSPTEST');for(const action of ['accept','prepare','dispensed']){const s=JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json);await j(await f.partner('/partners/fulfilment/'+f.order+'/action',pharmacy,{version:s.version,action}));}
  const l=await j(await f.request());await j(await f.ack(l),409);await j(await f.ack(l,{disposition:'quarantined_before_dispatch'}));assert.equal(f.state().status,'cancelled');assert.equal(JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json).status,'cancelled');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_signatures').get().n,1);await retainEvidence(f,'dispensed-quarantine-cancellation');
 }finally{f.close();}
});
test('RX-PRICE8 a second amendment uses the previous agreed price and its same-order ledger, preserving both signed supply episodes',async()=>{
 const f=await priceSetup();try{f.env.LIFECYCLE_PAYMENT_TEST_TRANSPORT=paymentTransport();f.afterAgreement=async(_f,p)=>{await j(await f.payment({version:p.version+1,agreed:true}));await applyPricePaymentEvent(f.env,priceReceipt(f));};await replacementSignature(f,'FICTIONAL first paid amendment',200,12);
  f.afterAgreement=null;const l=await j(await f.request({...f.command,kind:'amend',version:f.state().version,clientReference:crypto.randomUUID()}));await j(await f.ack(l));await freshReview(f);await j(await f.call('/'+l.id+'/price-plan',{...f.priceCommand,mode:'no_change',version:2,memberTotalPence:150,approvalReference:'FICTIONAL-SECOND-PRICE-APPROVAL'},1));await replacementSignature(f,'FICTIONAL second reviewed amendment',200,12);
  assert.equal(f.state().comparison.originalTotalPence,150);assert.equal(f.state().comparison.revisedTotalPence,150);assert.equal(f.state().comparison.deltaPence,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_signatures').get().n,3);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_supply_history').get().n,2);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medicine_orders').get().n,1);await retainEvidence(f,'second-linked-amendment');
 }finally{f.close();}
});
test('RX-PRICE9 a revised finance approval retains immutable history and invalidates the old member agreement before any payment or signature',async()=>{
 const f=await priceSetup();try{f.env.LIFECYCLE_PAYMENT_TEST_TRANSPORT=paymentTransport();f.afterAgreement=async(_f,p,cookie)=>{
  const revised=await j(await f.call('/'+f.lifecycle.id+'/price-plan',{...f.priceCommand,planVersion:1,memberTotalPence:160,approvalReference:'FICTIONAL-REVISED-PRICE-APPROVAL'},1));assert.equal(revised.version,2);assert.equal(revised.requiresFreshProposalAndAgreement,true);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_lifecycle_price_plan_history').get().n,2);assert.throws(()=>f.sql.prepare("DELETE FROM rx_lifecycle_price_plan_history WHERE version=1").run(),/immutable/);
  await j(await f.payment({version:p.version+1,agreed:true}),409);assert.equal(f.env.LIFECYCLE_PAYMENT_TEST_TRANSPORT.calls.length,0);const oldKey=f.sql.prepare('SELECT id FROM clinical_prescriber_signing_keys LIMIT 1').get();assert.equal((await j(await f.partner('/prescriptions/'+RECORD+'/signing-challenge',cookie,{version:p.version+1,keyId:oldKey.id}),409)).error,'prescription_price_changed');
  const proposal=(await j(await f.partner('/prescriptions/'+RECORD+'/proposal',cookie,{version:f.state().version,partnerId:'pharmacy-org',expiresAt:new Date(Date.now()+3600000).toISOString(),reason:'FICTIONAL revised price and renewed agreement',clinicalRationale:'Fictional current clinician review',treatment:{variantId:12,packs:1,quantity:'One fictional pack',dose:'Fictional dose',route:'Oral test formulation',directions:'FICTIONAL revised proposal'}}))).prescription;await j(await f.member('/prescription/decision',{version:proposal.version,action:'accept',agreed:true}));await j(await f.payment({version:f.state().version,agreed:true}));assert.equal(f.sql.prepare('SELECT amount_pence FROM rx_lifecycle_payments').get().amount_pence,60);await applyPricePaymentEvent(f.env,priceReceipt(f));
 };
 await replacementSignature(f,'FICTIONAL first approval, superseded',200,12);assert.equal(f.state().comparison.revisedTotalPence,160);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_signatures').get().n,2);const owner=await j(await f.hq('/platform/exports/'+RECORD,1,{purpose:'FICTIONAL revised approval verification'}));assert.equal(owner.content.priceApprovalHistory.length,2);assert.equal(owner.content.assessments,undefined);await retainEvidence(f,'revised-price-renewed-consent');
 }finally{f.close();}
});
test('RX-PRICE10 expired member authority prevents checkout, and a timed-out attempt stays owned and cannot be repeated',async()=>{
 const f=await priceSetup();try{let calls=0;f.env.SSTRX_PAYMENT_TIMEOUT_MS=15;f.env.LIFECYCLE_PAYMENT_TEST_TRANSPORT={fetch:async()=>{calls++;return new Promise(()=>{})}};
  f.afterAgreement=async(_f,p)=>{const body={version:p.version+1,agreed:true};const row=f.sql.prepare('SELECT * FROM user_sessions WHERE user_id=42').get();f.sql.prepare("UPDATE user_sessions SET revoked_at=? WHERE user_id=42").run(new Date().toISOString());await j(await f.payment(body),401);assert.equal(calls,0);f.sql.prepare('UPDATE user_sessions SET revoked_at=NULL WHERE user_id=42').run();const r=await j(await f.payment(body));assert.equal(r.state,'unknown');assert((await j(await f.payment(body))).reconciliationRequired);assert.equal(calls,1);const e=f.sql.prepare('SELECT * FROM rx_finance_exceptions WHERE id=?').get('price:'+f.lifecycle.id);assert.equal(e.kind,'price_payment_unknown');assert.equal(e.owner_user_id,1);assert.equal(e.due_at,f.command.dueAt);await applyPricePaymentEvent(f.env,priceReceipt(f));};
  await replacementSignature(f,'FICTIONAL timed-out payment recovery',200,12);assert.equal(calls,1);
 }finally{f.close();}
});
test('RX-HQ1 a delivered old episode cannot complete a replacement timeline in HQ or My Shift; new receipts then match all three views',async()=>{
 const f=await setup('J');try{f.env.HQ_V3_TEST_MODE='true';const before=await j(await f.hq('/partner-desk/operations',1));assert.equal(before.records[0].milestones.find(x=>x.key==='delivered').confirmed,true);
  const l=await j(await f.request({...f.command,kind:'replacement'}));await j(await f.ack(l,{disposition:'physically_returned'}));await freshReview(f);await replacementSignature(f,'FICTIONAL joined HQ replacement');const pending=await j(await f.hq('/partner-desk/operations',1)),member=await j(await f.callMemberSnapshot());assert.equal(pending.records[0].case_ref,RECORD);for(const key of ['accepted','dispensed','dispatched','delivered'])assert.equal(pending.records[0].milestones.find(x=>x.key===key).confirmed,false,key);assert.equal(member.orders[0].timeline.find(x=>x.key==='delivered').complete,false);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM partner_audit WHERE action='fulfilment_delivered'").get().n,1);
  const pharmacy=await f.login('DSPTEST');for(const action of ['accept','prepare','dispensed','dispatch','delivered']){const s=JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json);await j(await f.partner('/partners/fulfilment/'+f.order+'/action',pharmacy,{version:s.version,action,...action==='dispatch'?{carrier:'dpd',trackingNumber:'FICTIONAL-JOINED-ONLY'}:{},...action==='delivered'?{message:'FICTIONAL new episode receipt'}:{}}));}
  const hq=await j(await f.hq('/partner-desk/operations',1)),after=await j(await f.callMemberSnapshot()),receipt=f.sql.prepare("SELECT id,created_at FROM partner_audit WHERE action='fulfilment_delivered' ORDER BY rowid DESC LIMIT 1").get();assert.equal(hq.records[0].milestones.find(x=>x.key==='delivered').at,receipt.created_at);assert.equal(hq.records[0].milestones.find(x=>x.key==='delivered').evidence_ref,receipt.id);assert.equal(after.orders[0].timeline.find(x=>x.key==='delivered').at,receipt.created_at);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medicine_orders').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_signatures').get().n,2);await retainEvidence(f,'joined-hq-replacement-delivery');
 }finally{f.close();}
});

for(const canonical of [false,true])test('RX-SUP-WITHDRAW an already received supplier job is withdrawn with its signed episode ('+(canonical?'transport_received':'accepted')+')',async()=>{
 const f=await setup();try{
  const contract='FICTIONAL-RECEIVED-WITHDRAWAL',date=new Date().toISOString(),config={pharmacyOrgId:'pharmacy-org',services:['weight_management'],contractReference:'FICTIONAL',receiptContract:{schemaVersion:'sst-rx-event-v1',approvalReference:'FICTIONAL-EVENT-MAP'}};
  f.sql.prepare("INSERT INTO rx_supplier_contracts VALUES(?,'clinical-org','synthetic',1,'approved',?,?)").run(contract,JSON.stringify(config),date);f.sql.prepare('INSERT INTO rx_product_mappings VALUES(?,11,?,?,?,?,1)').run(contract,'FICTIONAL-PRODUCT','tablet','Synthetic strength','one synthetic pack');
  f.env.SSTRX_CANONICAL_RECEIPTS_ENABLED=canonical?'true':'false';f.env.SSTRX_SYNTHETIC_ADAPTER=isolatedSyntheticAdapter({submit:async()=>({accepted:true,reference:'FICTIONAL-ORIGINAL-TRANSPORT-RECEIPT'})});
  const route=await captureOrderRoute(f.DB,{orderNumber:f.order,memberId:42,clinicalOrgId:'clinical-org',pharmacyOrgId:'pharmacy-org',contractId:contract,prescriptionId:f.original.prescriptionId,variantId:11,service:'weight_management',authorisationReference:'FICTIONAL-ROUTING'}),job=await queueSubmission(f.DB,route);
  assert.equal((await submitJob(f.env,job.id)).state,canonical?'transport_received':'accepted');
  const work=await j(await f.request({...f.command,kind:'amend'}));await j(await f.ack(work));await freshReview(f);await replacementSignature(f);
  const archived=f.sql.prepare('SELECT * FROM rx_integration_jobs WHERE id=?').get(job.id);assert.equal(archived.state,'superseded');assert.equal(archived.remote_reference,'FICTIONAL-ORIGINAL-TRANSPORT-RECEIPT');assert.equal(archived.attempts,1);
  await assert.rejects(submitJob(f.env,job.id),/job_not_submittable/);
  const next=await queueSubmission(f.DB,f.sql.prepare('SELECT * FROM rx_order_routes').get());assert.notEqual(next.id,job.id);assert.equal(next.state,'pending');
 }finally{f.close()}
});
