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
async function replacementSignature(f,directions='FICTIONAL AMENDED DIRECTIONS',expectedStatus=200){
 const cookie=await f.login('CLNTEST'),current=f.state();let p=(await j(await f.partner('/prescriptions/'+RECORD+'/proposal',cookie,{version:current.version,partnerId:'pharmacy-org',expiresAt:new Date(Date.now()+3600000).toISOString(),reason:'FICTIONAL reviewed amendment',clinicalRationale:'Fictional acceptance only',treatment:{variantId:11,packs:1,quantity:'One fictional pack',dose:'Fictional dose',route:'Oral test formulation',directions}}))).prescription;
 await j(await f.member('/prescription/decision',{version:p.version,action:'accept',agreed:true}));
 const key=await authenticator(),c=await j(await f.partner('/prescriptions/'+RECORD+'/keys/challenge',cookie,{})),registered=await j(await f.partner('/prescriptions/'+RECORD+'/keys/register',cookie,{challengeId:c.id,proof:await key.register(c.challenge)}));
 await j(await f.hq('/prescriptions/keys/'+registered.keyId+'/approve',2,{version:0,expiresAt:new Date(Date.now()+3600000).toISOString(),verificationReference:'FICTIONAL independent replacement signing key review'}));
 const challenge=await j(await f.partner('/prescriptions/'+RECORD+'/signing-challenge',cookie,{version:p.version+1,keyId:registered.keyId}));
 const body={version:p.version+1,challengeId:challenge.id,document:challenge.document,proof:await key.sign(challenge.challenge)};if(f.beforeSign)await f.beforeSign();const signed=await j(await f.partner('/prescriptions/'+RECORD+'/sign',cookie,body),expectedStatus);return {signed,cookie,body};
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
