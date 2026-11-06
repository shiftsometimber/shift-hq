import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {functionalDataset} from '../qa/functional-fixtures.mjs';
import {RECORD} from './fixture.mjs';
import {isolatedSyntheticAdapter,captureOrderRoute,queueSubmission,submitJob,receiveVerifiedEvent,projectVerifiedEvents} from '../platform/integrations.mjs';
const j=async r=>{const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d};
async function setup(){
 const f=await functionalDataset('E');f.env.SSTRX_CANONICAL_RECEIPTS_ENABLED='true';const contract='FICTIONAL-RECEIPTS-A',config={pharmacyOrgId:'pharmacy-org',services:['weight_management'],contractReference:'FICTIONAL-CONTRACT',receiptContract:{schemaVersion:'sst-rx-event-v1',approvalReference:'FICTIONAL-APPROVED-EVENT-MAP'}};
 f.sql.prepare("INSERT INTO rx_supplier_contracts VALUES(?,'clinical-org','synthetic',1,'approved',?,?)").run(contract,JSON.stringify(config),new Date().toISOString());f.sql.prepare('INSERT INTO rx_product_mappings VALUES(?,11,?,?,?,?,1)').run(contract,'FICTIONAL-PRODUCT','tablet','Synthetic strength','one synthetic pack');const prescriptionId=JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json).prescriptionId;
 const route=await captureOrderRoute(f.DB,{orderNumber:f.order,memberId:42,clinicalOrgId:'clinical-org',pharmacyOrgId:'pharmacy-org',contractId:contract,prescriptionId,variantId:11,service:'weight_management',authorisationReference:'FICTIONAL-OWNER-ROUTING'});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('FICTIONAL-SUPPLIER-SIGNING-KEY'),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
 f.env.SSTRX_SYNTHETIC_ADAPTER=isolatedSyntheticAdapter({submit:async()=>({accepted:true,reference:'FICTIONAL-HTTP-202'}),verifyWebhook:async(raw,proof)=>{let ok=false;try{ok=await crypto.subtle.verify('HMAC',key,Buffer.from(proof||'','hex'),new TextEncoder().encode(raw));}catch{}return {verified:ok,contractId:contract,event:JSON.parse(raw)}}});
 const receive=async(event,forged=false)=>{const raw=JSON.stringify(event),sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw))).toString('hex');return receiveVerifiedEvent(f.env,contract,raw,forged?'00'.repeat(32):sig)};
 const eventTime=new Date().toISOString(),event=(kind,version,extra={})=>({kind,eventReference:'FICTIONAL-'+kind+'-'+version,orderReference:f.order,occurredAt:eventTime,schemaVersion:'sst-rx-event-v1',sourceRecordVersion:version,prescriptionReference:prescriptionId,caseReference:RECORD,idempotencyKey:'FICTIONAL-EVENT-'+version,memberMessage:'FICTIONAL supplier '+kind+' update',...extra});
 const pharmacy=await f.login('DSPTEST'),sink={mode:'synthetic',apply:async b=>{const r=await f.partner('/partners/fulfilment/'+f.order+'/action',pharmacy,{version:b.version,action:b.action,...b.message?{message:b.message}:{},...b.tracking?{carrier:b.tracking.carrier,trackingNumber:b.tracking.number}:{}});return {ok:r.ok};}};
 return {...f,contract,route,receive,event,sink};
}
test('RX-P1 authenticated 202 transport receipt cannot manufacture pharmacy acceptance',async()=>{
 const f=await setup();try{const job=await queueSubmission(f.DB,f.route),r=await submitJob(f.env,job.id);assert.equal(r.state,'transport_received');assert.equal(r.pharmacyAcceptanceConfirmed,false);assert.equal(JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json).status,'received');assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM partner_audit WHERE action='fulfilment_accept'").get().n,0);}finally{f.close();}
});
test('RX-EVT3 authenticated supplier clarification, rejection, same-timestamp delivery failure and return project in source-version order exactly once',async()=>{
 for(const outcome of ['rejected','returned']){const f=await setup();try{
  await f.receive(f.event('received',1));await f.receive(f.event('clarification',2));await projectVerifiedEvents(f.env,f.order,f.sink);let state=()=>JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json);assert.equal(state().status,'query');assert.equal(state().message,'FICTIONAL supplier clarification update');
  if(outcome==='rejected'){await f.receive(f.event('rejected',3));await projectVerifiedEvents(f.env,f.order,f.sink);assert.equal(state().status,'rejected');}
  else{for(const [kind,n]of [['accepted',3],['dispensing',4],['dispensed',5],['dispatched',6],['delivery_exception',7],['returned',8]].reverse())await f.receive(f.event(kind,n,kind==='dispatched'?{tracking:{carrier:'dpd',number:'FICTIONAL-RECEIPT-TRACKING'}}:{}));await projectVerifiedEvents(f.env,f.order,f.sink);assert.equal(state().status,'returned');assert.equal(state().deliveryUpdate.note,'FICTIONAL supplier returned update');assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM partner_audit WHERE action='fulfilment_delivery_exception'").get().n,1);}
  const before=f.sql.prepare('SELECT COUNT(*) n FROM partner_audit').get().n;await projectVerifiedEvents(f.env,f.order,f.sink);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM partner_audit').get().n,before);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_integration_events WHERE state='awaiting_projection'").get().n,0);
  if(process.env.SSTRX_QA_EVIDENCE_DIR){const dir=path.join(process.env.SSTRX_QA_EVIDENCE_DIR,'supplier-receipts');await fs.mkdir(dir,{recursive:true});const exported=await j(await f.hq('/platform/exports/'+RECORD,4,{purpose:'FICTIONAL authenticated supplier receipt evidence'}));assert(exported.content.audit.some(e=>e.action.startsWith('supplier_')&&e.organisationId==='pharmacy-org'));await fs.writeFile(path.join(dir,outcome+'.json'),JSON.stringify({scope:'SIMULATED AUTHENTICATED PROVIDER ONLY; not a chosen-supplier sandbox receipt',receipts:f.sql.prepare('SELECT * FROM rx_integration_events ORDER BY occurred_at').all(),nativeAudit:f.sql.prepare("SELECT * FROM partner_audit WHERE entity_type='order' ORDER BY version").all(),supply:state(),hq:await j(await f.hq('/platform',1)),exported},null,2));}
 }finally{f.close();}}
});
test('RX-EVT4 supplier exception receipts need a safe member update and cannot be mistaken for a normal dispatch',async()=>{
 const f=await setup();try{await assert.rejects(f.receive(f.event('rejected',1,{memberMessage:undefined})),/invalid_reference/);await f.receive(f.event('received',1));await f.receive(f.event('stock_unavailable',2));await projectVerifiedEvents(f.env,f.order,f.sink);const state=JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json);assert.equal(state.status,'query');assert.equal(state.dispensedAt,undefined);assert.equal(state.tracking,undefined);}finally{f.close();}
});
test('RX-EVT1 / RX-EVT2 verified receipts replay once, buffer out-of-order delivery and require an explicit dispensing receipt',async()=>{
 const f=await setup();try{
  const delivered=f.event('delivered',6);await f.receive(delivered);assert.equal((await projectVerifiedEvents(f.env,f.order,f.sink)).projected,0);await f.receive(f.event('received',1));
  for(const [kind,version]of [['accepted',2],['dispensing',3],['dispatched',5]])await f.receive(f.event(kind,version,kind==='dispatched'?{tracking:{carrier:'dpd',number:'TEST-ONLY-TRACKING'}}:{}));
  await projectVerifiedEvents(f.env,f.order,f.sink);assert.equal(JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json).status,'preparing');
  await f.receive(f.event('dispensed',4));await projectVerifiedEvents(f.env,f.order,f.sink);assert.equal(JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json).status,'delivered');assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM partner_audit WHERE action='fulfilment_dispensed'").get().n,1);
  assert((await f.receive(delivered)).duplicate);await assert.rejects(f.receive(f.event('accepted',1)),/obsolete_supplier_record_version/);await assert.rejects(f.receive({...delivered,remoteReference:'CHANGED'}),/webhook_replay_content_changed/);
 }finally{f.close();}
});
test('RX-INT1 signed canonical supplier receipts reject forged proofs, wrong case/episode and schema mismatches',async()=>{
 const f=await setup();try{await assert.rejects(f.receive(f.event('accepted',2),true),/webhook_verification_failed/);await assert.rejects(f.receive(f.event('accepted',2,{prescriptionReference:crypto.randomUUID()})),/supplier_receipt_episode_mismatch/);await assert.rejects(f.receive(f.event('accepted',2,{caseReference:crypto.randomUUID()})),/supplier_receipt_episode_mismatch/);await assert.rejects(f.receive(f.event('accepted',2,{schemaVersion:'unapproved-v2'})),/versioned_supplier_receipt_required/);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_integration_events').get().n,0);}finally{f.close();}
});
