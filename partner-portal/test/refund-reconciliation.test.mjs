import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ORDER} from './fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {ensureRefundSchema,memberRefunds,applyRefundReceipt} from '../platform/refunds.mjs';
import {economicsTerms} from '../platform/domain.mjs';
import {qaRefundEnvironment} from '../qa/finance-transport.mjs';
const dbId='00000000-0000-4000-8000-000000000031';
const session='cs_test_QA_'+'c'.repeat(32),intent='pi_test_QA_'+'c'.repeat(32);
const terms=()=>economicsTerms({model:'shift_collects',supplierId:'TEST-SUPPLIER',sellingPence:10000,outputTaxPence:0,taxTreatment:'TEST',approvalReference:'TEST-NATIVE-ECONOMICS-APPROVAL',costSourceReference:'TEST-COSTS'});
async function setup(){
 const f=await fixture();
 Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true',SSTRX_ENVIRONMENT:'synthetic',SSTRX_QA_STACK:'joined-v31',SSTRX_QA_DATABASE_ID:dbId,STRIPE_MODE:'test',SSTRX_QA_REFUNDS_ENABLED:'true'});
 f.sql.exec('CREATE TABLE sstrx_qa_environment(environment TEXT,database_id TEXT,synthetic_only INTEGER)');
 f.sql.prepare('INSERT INTO sstrx_qa_environment VALUES(?,?,1)').run('joined-v31',dbId);
 await ensurePlatformSchema(f.DB);await ensureRefundSchema(f.DB);
 f.sql.prepare("INSERT INTO medicine_variants(id,medicine_id,strength_label,selling_price_pence,status,updated_at,sellable,availability_state) VALUES(9911,1,'TEST',10000,'available',?,1,'available')").run(new Date().toISOString());
 f.sql.prepare("UPDATE medicine_orders SET variant_id=9911,medicine_name='TEST-NOT-FOR-SUPPLY',stripe_checkout_session_id=?,stripe_payment_intent_id=?,unit_price_pence=10000,total_pence=10000 WHERE order_number=?").run(session,intent,ORDER);
 f.sql.exec('CREATE TABLE IF NOT EXISTS medicine_payment_receipts(event_id TEXT PRIMARY KEY,order_number TEXT,session_id TEXT,payment_intent TEXT,mode TEXT,amount_pence INTEGER,currency TEXT,occurred_at TEXT,received_at TEXT,payload_digest TEXT)');
 f.sql.prepare('INSERT INTO medicine_payment_receipts VALUES(?,?,?,?,?,?,?,?,?,?)').run('evt_test_QA_capture',ORDER,session,intent,'test',10000,'GBP',new Date().toISOString(),new Date().toISOString(),'d'.repeat(64));
 Object.assign(f.env,await qaRefundEnvironment(f.env));
 const native=f.env.REFUND_TEST_TRANSPORT;const calls={post:0,get:0};let transform=null;
 f.env.REFUND_TEST_TRANSPORT={async fetch(req){
  calls[req.method.toLowerCase()]++;const response=await native.fetch(req);
  return transform?transform(req,response):response;
 }};
 const raw=(path,body,actor=1)=>f.hq('/platform/refunds'+path,actor,body);
 async function call(path,body,status=200,actor=1){const r=await raw(path,body,actor),b=await r.json();assert.equal(r.status,status,JSON.stringify(b));return b;}
 async function approved(){
  let r=await call('',{orderReference:ORDER,amountPence:1000,reason:'TEST approved historical refund',termsReference:'TEST-ORIGINAL-POLICY-REFERENCE',clientReference:'TEST-KNOWN-REFUND'});
  return call('/'+r.id+'/approve',{version:r.version,approvalReference:'TEST-FINANCE-APPROVAL',exceptionDueAt:new Date(Date.now()+3600000).toISOString()});
 }
 function recordTerms(){f.sql.prepare('INSERT INTO rx_economics VALUES(?,1,?,?)').run(ORDER,JSON.stringify(terms()),new Date().toISOString());}
 async function historicalSubmitted(){
  const r=await approved();
  // Reproduce the already-persisted pre-fix native state, without invoking the
  // new submit guard or issuing another native refund request.
  f.sql.prepare("UPDATE rx_refunds SET state='submitting',version=3 WHERE id=?").run(r.id);
  const body=new URLSearchParams({payment_intent:intent,amount:'1000','metadata[sst_refund_id]':r.id,'metadata[order_reference]':ORDER});
  const response=await f.env.REFUND_TEST_TRANSPORT.fetch(new Request('https://api.stripe.com/v1/refunds',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':'TEST-KNOWN-REFUND'},body}));
  assert.equal(response.status,200);const receipt=await response.json();
  f.sql.prepare("UPDATE rx_refunds SET state='submitted',version=4,processor_reference=? WHERE id=?").run(receipt.id,r.id);
  return {...r,state:'submitted',version:4,processorReference:receipt.id};
 }
 return {...f,calls,call,raw,approved,recordTerms,historicalSubmitted,setTransform:fn=>{transform=fn}};
}
const counts=f=>({provider:f.sql.prepare('SELECT COUNT(*) n FROM qa_simulated_refunds').get().n,
 native:f.sql.prepare('SELECT COUNT(*) n FROM rx_refund_receipts').get().n,
 ledger:f.sql.prepare("SELECT COUNT(*) n FROM rx_finance_entries WHERE kind='refund'").get().n});
test('Missing or invalid native economics blocks the original provider POST before state or version changes',async()=>{
 for(const kind of ['absent','invalid-json','wrong-sale']){
  const f=await setup();try{
   const r=await f.approved();
   if(kind!=='absent')f.sql.prepare('INSERT INTO rx_economics VALUES(?,1,?,?)').run(ORDER,kind==='invalid-json'?'broken':JSON.stringify({...terms(),sellingPence:9999}),new Date().toISOString());
   await f.call('/'+r.id+'/submit',{version:r.version},409);
   const saved=f.sql.prepare('SELECT state,version,processor_reference FROM rx_refunds WHERE id=?').get(r.id);
   assert.equal(saved.state,'approved');assert.equal(saved.version,r.version);assert.equal(saved.processor_reference,null);
   assert.equal(f.calls.post,0);assert.equal(f.calls.get,0);
  }finally{f.close()}
 }
});
test('A historical accepted refund held for missing economics reconciles by GET once after later native terms, preserving different original references',async()=>{
 const f=await setup();try{
  const r=await f.historicalSubmitted();
  assert.deepEqual(counts(f),{provider:1,native:0,ledger:0});
  await f.call('/'+r.id+'/reconcile',{version:r.version},409);assert.equal(f.calls.get,0);
  f.recordTerms();const complete=await f.call('/'+r.id+'/reconcile',{version:r.version});
  assert.equal(complete.state,'completed');assert.equal(complete.reconciled,true);
  assert.equal(complete.termsReference,'TEST-ORIGINAL-POLICY-REFERENCE');
  assert.deepEqual(counts(f),{provider:1,native:1,ledger:1});assert.equal(f.calls.post,1);assert.equal(f.calls.get,1);
  const event=f.sql.prepare("SELECT actor_id,source_reference FROM rx_refund_events WHERE refund_id=? AND state='completed'").get(r.id);
  assert.equal(event.actor_id,1);const audit=JSON.parse(event.source_reference);
  assert.equal(audit.action,'reconcile');assert.equal(audit.termsApprovalReference,'TEST-NATIVE-ECONOMICS-APPROVAL');assert.equal(audit.termsVersion,1);assert.equal(audit.originalTermsReference,'TEST-ORIGINAL-POLICY-REFERENCE');
  assert.equal((await memberRefunds(f.env,42))[0].state,'completed');
  const completedGets=f.calls.get;
  const replay=await f.call('/'+r.id+'/reconcile',{version:complete.version});
  assert.equal(replay.duplicate,true);assert.equal(replay.state,'completed');assert.deepEqual(counts(f),{provider:1,native:1,ledger:1});assert.equal(f.calls.post,1);assert.equal(f.calls.get,completedGets);
  const gets=f.calls.get;await f.call('/'+r.id+'/reconcile',{version:r.version},409);assert.equal(f.calls.get,gets);
  await f.call('/'+r.id+'/reconcile',{version:complete.version},403,3);
  await f.call('/'+r.id+'/reconcile',{version:complete.version},403,4);assert.equal(f.calls.get,gets);
 }finally{f.close()}
});
test('Unverified lookup amount, identity, status, network or missing receipt keeps the existing refund held without another POST',async()=>{
 for(const kind of ['amount','identity','unknown-status','live','missing','network']){
  const f=await setup();try{
   const r=await f.historicalSubmitted();f.recordTerms();
   f.setTransform(async(req,res)=>{
    if(req.method!=='GET')return res;
    if(kind==='network')throw Error('TEST read unavailable');
    if(kind==='missing')return Response.json({error:'not_found'},{status:404});
    const b=await res.json();
    if(kind==='amount')b.amount++;
    if(kind==='identity')b.id='re_test_QA_'+'e'.repeat(32);
    if(kind==='unknown-status')b.status='unverified';
    if(kind==='live')b.livemode=true;
    return Response.json(b);
   });
   await f.call('/'+r.id+'/reconcile',{version:r.version},kind==='amount'?409:kind==='network'?503:502);
   const saved=f.sql.prepare('SELECT state,version FROM rx_refunds WHERE id=?').get(r.id);
   assert.equal(saved.state,'submitted');assert.equal(saved.version,4);
   assert.deepEqual(counts(f),{provider:1,native:0,ledger:0});assert.equal(f.calls.post,1);
  }finally{f.close()}
 }
});
test('Revocation or changed economic terms during read-only lookup cannot write a native receipt or ledger',async()=>{
 for(const kind of ['revoked','terms']){
  const f=await setup();try{
   const r=await f.historicalSubmitted();f.recordTerms();
   f.setTransform(async(req,res)=>{
    if(req.method==='GET'){
     if(kind==='revoked')f.sql.prepare('UPDATE hq_sessions SET revoked_at=? WHERE hq_user_id=1').run(new Date().toISOString());
     else f.sql.prepare('UPDATE rx_economics SET version=version+1 WHERE order_number=?').run(ORDER);
    }
    return res;
   });
   await f.call('/'+r.id+'/reconcile',{version:r.version},409);
   assert.deepEqual(counts(f),{provider:1,native:0,ledger:0});assert.equal(f.calls.post,1);
  }finally{f.close()}
 }
});

test('A reconcile command cannot apply a processor receipt belonging to a different native refund',async()=>{
 const f=await setup();try{
  const r=await f.historicalSubmitted();f.recordTerms();
  const other=await f.call('',{orderReference:ORDER,amountPence:100,reason:'TEST other request',termsReference:'TEST-OTHER-POLICY',clientReference:'TEST-OTHER-REFUND'});
  const response=await f.env.REFUND_TEST_TRANSPORT.fetch(new Request('https://api.stripe.com/v1/refunds/'+r.processorReference,{headers:{'Idempotency-Key':'TEST-KNOWN-REFUND'}}));
  const object=await response.json();
  await assert.rejects(applyRefundReceipt(f.env,{id:'lookup:TEST-CROSS-REFUND',created:object.created,data:{object}},'authenticated_test_api',{refundId:other.id,version:other.version,actorId:1,guard:{sql:'1=1',args:[]},sourceReference:'TEST-CROSS-REFUND'}),/refund_changed/);
  assert.deepEqual(counts(f),{provider:1,native:0,ledger:0});
  assert.equal(f.sql.prepare('SELECT version FROM rx_refunds WHERE id=?').get(r.id).version,4);
  assert.equal(f.sql.prepare('SELECT version FROM rx_refunds WHERE id=?').get(other.id).version,other.version);
 }finally{f.close()}
});
