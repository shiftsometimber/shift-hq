import {allowedPath} from '../policy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {functionalDataset} from '../qa/functional-fixtures.mjs';
import {qaStubProvider} from '../qa/stub-provider.mjs';
import {captureOrderRoute,queueSubmission,submitJob,reconcileJob} from '../platform/integrations.mjs';
const j=async(r,status=200)=>{const b=await r.json();assert.equal(r.status,status,JSON.stringify(b));return b;};
async function setup(){
 const f=await functionalDataset('E'),marker='11111111-1111-4111-8111-111111111111';
 Object.assign(f.env,{SSTRX_QA_STACK:'joined-v31',SSTRX_QA_DATABASE_ID:marker,SSTRX_QA_FULFILMENT_ENABLED:'true',SSTRX_CANONICAL_RECEIPTS_ENABLED:'true'});
 f.sql.exec('CREATE TABLE sstrx_qa_environment(environment TEXT PRIMARY KEY,database_id TEXT,synthetic_only INTEGER)');f.sql.prepare('INSERT INTO sstrx_qa_environment VALUES(?,?,1)').run('joined-v31',marker);
 const contract='TEST-DURABLE-STUB',config={pharmacyOrgId:'pharmacy-org',services:['weight_management'],contractReference:'TEST-ONLY',receiptContract:{schemaVersion:'sst-rx-event-v1',approvalReference:'TEST-RECEIPT-CONTRACT'}};
 f.sql.prepare("INSERT INTO rx_supplier_contracts VALUES(?,'clinical-org','synthetic',1,'approved',?,?)").run(contract,JSON.stringify(config),new Date().toISOString());f.sql.prepare('INSERT INTO rx_product_mappings VALUES(?,11,?,?,?,?,1)').run(contract,'TEST-PROVIDER-PRODUCT','tablet','Synthetic strength','one synthetic pack');
 const prescriptionId=JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json).prescriptionId;
 const route=await captureOrderRoute(f.DB,{orderNumber:f.order,memberId:42,clinicalOrgId:'clinical-org',pharmacyOrgId:'pharmacy-org',contractId:contract,prescriptionId,variantId:11,service:'weight_management',authorisationReference:'TEST-OWNER-ROUTING'});
 f.env.SSTRX_SYNTHETIC_ADAPTER=qaStubProvider(f.env);const job=await queueSubmission(f.DB,route),pharmacy=await f.login('DSPTEST');
 const command=(kind,sourceRecordVersion,extra={})=>({orderReference:f.order,kind,sourceRecordVersion,memberMessage:'TEST provider '+kind+' — no actual supply',...extra});
 const call=b=>f.partner('/platform/integrations/simulate',pharmacy,b);
 return {...f,route,job,pharmacy,command,call};
}
test('Durable stub acknowledgement survives adapter restart and never means pharmacy acceptance',async()=>{
 const f=await setup();try{
  const r=await submitJob(f.env,f.job.id);assert.equal(r.state,'transport_received');assert.equal(r.pharmacyAcceptanceConfirmed,false);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM qa_stub_submissions').get().n,1);
  assert.equal(JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json).status,'received');
  const adapter=qaStubProvider(f.env),known=await adapter.reconcile({idempotencyKey:f.job.idempotency_key,orderReference:f.order});assert.equal(known.known,true);assert.equal(known.reference,r.reference);
  await submitJob(f.env,f.job.id);assert.equal(f.sql.prepare('SELECT attempts FROM rx_integration_jobs').get().attempts,1);
 }finally{f.close();}
});
test('Provider receipts run the native pharmacy actions, retain one episode and replay without duplicate native events',async()=>{
 const f=await setup();try{
  assert.equal((await submitJob(f.env,f.job.id)).state,'transport_received');
  let n=0;for(const kind of ['received','accepted','dispensing','dispensed','dispatched','delivered']){
   const body=f.command(kind,++n,kind==='dispatched'?{tracking:{carrier:'dpd',number:'TEST-STUB-NO-SHIPMENT'}}:{}),r=await j(await f.call(body));assert.equal(r.projection.pending,0,JSON.stringify(r));const status=await j(await f.partner('/platform/integrations/status?orderReference='+encodeURIComponent(f.order),f.pharmacy));assert.equal(status.nextSourceVersion,n+1);
   const before=f.sql.prepare("SELECT COUNT(*) n FROM partner_audit WHERE action LIKE 'fulfilment_%'").get().n;const replay=await j(await f.call(body));assert.equal(replay.received.duplicate,true);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM partner_audit WHERE action LIKE 'fulfilment_%'").get().n,before);
  }
  const s=JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json);assert.equal(s.status,'delivered');assert(s.dispensedAt);assert.equal(s.prescriptionId,f.route.prescription_id);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_integration_events').get().n,6);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM qa_stub_receipts').get().n,6);
  const h=await j(await f.hq('/platform',1));assert.equal(h.records.find(r=>r.orderNumber===f.order).pharmacyStatus,'delivered');
 }finally{f.close();}
});
test('Durable stub reconciles unknown submission without issuing another instruction',async()=>{
 const f=await setup();try{
  const original=f.env.SSTRX_SYNTHETIC_ADAPTER;f.env.SSTRX_SYNTHETIC_ADAPTER={...original,async submit(p){await original.submit(p);throw Error('TEST connection lost after receipt');}};
  assert.equal((await submitJob(f.env,f.job.id)).state,'uncertain');await submitJob(f.env,f.job.id);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM qa_stub_submissions').get().n,1);
  f.env.SSTRX_SYNTHETIC_ADAPTER=qaStubProvider(f.env);const r=await reconcileJob(f.env,f.job.id);assert.equal(r.state,'transport_received');assert.equal(r.pharmacyAcceptanceConfirmed,false);assert.equal(f.sql.prepare('SELECT attempts FROM rx_integration_jobs').get().attempts,1);
 }finally{f.close();}
});
test('Receipts require the assigned MFA pharmacy; owners, other pharmacies, forged proofs and changed replay are denied',async()=>{
 const f=await setup();try{
  await submitJob(f.env,f.job.id);const body=f.command('received',1);
  await j(await f.hq('/platform/integrations/simulate',1,body),403);
  await j(await f.partner('/platform/integrations/simulate',await f.login('DSPOTHER'),body),404);
  const receipt=await f.env.SSTRX_SYNTHETIC_ADAPTER.createEvent({...body,contractId:f.route.contract_id});
  await j(await f.partner('/platform/integrations/receipts',f.pharmacy,{orderReference:f.order,...receipt,proof:'00'.repeat(32)}),403);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_integration_events').get().n,0);
  await j(await f.call(body));await j(await f.call({...body,kind:'accepted'}),409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_integration_events').get().n,1);
 }finally{f.close();}
});
test('Stub is closed outside the explicit QA marker, mode and reserved fictional member partition',async()=>{
 const f=await setup();try{
  const p={idempotencyKey:f.job.idempotency_key,orderReference:f.order,prescriptionReference:f.route.prescription_id,apiVersion:'sst-rx-v1',product:JSON.parse(f.route.product_mapping_json)};
  for(const change of [{SSTRX_ENVIRONMENT:'production'},{SSTRX_QA_FULFILMENT_ENABLED:'false'},{SSTRX_QA_DATABASE_ID:'22222222-2222-4222-8222-222222222222'}])await assert.rejects(qaStubProvider({...f.env,...change}).submit(p),/isolated_stub_provider_required/);
  f.sql.prepare("UPDATE medicine_orders SET email='actual@deliverable.example' WHERE order_number=?").run(f.order);await assert.rejects(qaStubProvider(f.env).submit(p),/fictional_stub_route_required/);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='qa_stub_submissions'").get().n,0);
 }finally{f.close();}
});

test('Portal permits only the three pharmacy receipt POSTs and never integration administration or clinician access',()=>{
 for(const action of ['simulate','receipts','project']){const path='/api/clinical/platform/integrations/'+action;assert.equal(allowedPath(path,'POST','dispensing'),true);for(const kind of ['clinician','oversight','pharmacy_admin','clinical_admin'])assert.equal(allowedPath(path,'POST',kind),false);assert.equal(allowedPath(path,'GET','dispensing'),false);}
 for(const action of ['submit','capture','queue','reconcile','simulate/extra'])assert.equal(allowedPath('/api/clinical/platform/integrations/'+action,'POST','dispensing'),false);
});

test('Out-of-order simulated delivery stays pending until every canonical native prerequisite exists',async()=>{
 const f=await setup();try{
  await submitJob(f.env,f.job.id);let r=await j(await f.call(f.command('delivered',6)));assert.equal(r.projection.pending,1);assert.equal(JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json).status,'received');
  for(const [kind,version]of [['received',1],['accepted',2],['dispensing',3]])await j(await f.call(f.command(kind,version)));
  r=await j(await f.call(f.command('dispatched',5,{tracking:{carrier:'dpd',number:'TEST-OUT-OF-ORDER-NO-SHIPMENT'}})));assert.equal(r.projection.pending,2);assert.equal(JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json).status,'preparing');
  r=await j(await f.call(f.command('dispensed',4)));assert.equal(r.projection.pending,0);assert.equal(JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment').get().state_json).status,'delivered');
 }finally{f.close();}
});

test('Owner TEST setup creates a versioned stub contract and queues only a current signed fictional episode',async()=>{
 const f=await functionalDataset('E');try{
  const marker='11111111-1111-4111-8111-111111111111';Object.assign(f.env,{SSTRX_QA_STACK:'joined-v31',SSTRX_QA_DATABASE_ID:marker,SSTRX_QA_FULFILMENT_ENABLED:'true',SSTRX_CANONICAL_RECEIPTS_ENABLED:'true'});
  f.sql.exec('CREATE TABLE sstrx_qa_environment(environment TEXT PRIMARY KEY,database_id TEXT,synthetic_only INTEGER)');f.sql.prepare('INSERT INTO sstrx_qa_environment VALUES(?,?,1)').run('joined-v31',marker);f.env.SSTRX_SYNTHETIC_ADAPTER=qaStubProvider(f.env);
  const body={contractReference:'TEST-NATIVE-SETUP',clinicalOrgId:'clinical-org',pharmacyOrgId:'pharmacy-org',variantId:11,approvalReference:'TEST-OWNER-APPROVAL'};
  await j(await f.hq('/platform/integrations/stub-contract',6,body),403);
  const made=await j(await f.hq('/platform/integrations/stub-contract',1,body));assert.equal(made.realSupplierCommissioned,false);assert.equal((await j(await f.hq('/platform/integrations/stub-contract',1,body))).duplicate,true);
  await j(await f.hq('/platform/integrations/stub-contract',1,{...body,approvalReference:'CHANGED'}),409);
  const command={contractId:made.contractId,orderReference:f.order,approvalReference:'TEST-HANDOVER-APPROVAL'},r=await j(await f.hq('/platform/integrations/stub-handover',1,command));assert.equal(r.state,'transport_received');assert.equal(r.realSupplierOrderCreated,false);assert.equal(r.pharmacyAcceptanceConfirmed,false);
  const replay=await j(await f.hq('/platform/integrations/stub-handover',1,command));assert.equal(replay.jobId,r.jobId);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_integration_jobs').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM qa_stub_submissions').get().n,1);
  const dashboard=await j(await f.hq('/platform/integrations',1));assert.equal(dashboard.contracts.length,1);assert.equal(dashboard.testVariants[0].id,11);
 }finally{f.close();}
});
