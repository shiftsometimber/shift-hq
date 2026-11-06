import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {wrapDatabase} from './database.mjs';
import {fixture,ORDER} from './fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {ensureRefundSchema,memberRefunds} from '../platform/refunds.mjs';
import {economicsTerms} from '../platform/domain.mjs';
import {qaRefundTransport,qaRefundEnvironment} from '../qa/finance-transport.mjs';
const dbId='00000000-0000-4000-8000-000000000031';
const session='cs_test_QA_'+'a'.repeat(32),intent='pi_test_QA_'+'a'.repeat(32);
const captureSchema='CREATE TABLE IF NOT EXISTS medicine_payment_receipts(event_id TEXT PRIMARY KEY,order_number TEXT,session_id TEXT,payment_intent TEXT,mode TEXT,amount_pence INTEGER,currency TEXT,occurred_at TEXT,received_at TEXT,payload_digest TEXT)';
const mark=DB=>({DB,SSTRX_ENVIRONMENT:'synthetic',SSTRX_QA_STACK:'joined-v31',SSTRX_QA_DATABASE_ID:dbId,STRIPE_MODE:'test',SSTRX_QA_REFUNDS_ENABLED:'true'});
function marker(sql){sql.exec('CREATE TABLE sstrx_qa_environment(environment TEXT,database_id TEXT,synthetic_only INTEGER)');sql.prepare('INSERT INTO sstrx_qa_environment VALUES(?,?,1)').run('joined-v31',dbId);}
function capture(sql,order='TEST-ORDER'){sql.prepare('INSERT INTO medicine_payment_receipts VALUES(?,?,?,?,?,?,?,?,?,?)').run('evt_test_QA_original',order,session,intent,'test',10000,'GBP',new Date().toISOString(),new Date().toISOString(),'b'.repeat(64));}
function setup(){
 const sql=new DatabaseSync(':memory:'),{DB}=wrapDatabase(sql);marker(sql);
 sql.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT);CREATE TABLE medicine_orders(order_number TEXT PRIMARY KEY,user_id INTEGER,variant_id INTEGER,medicine_name TEXT,email TEXT,stripe_checkout_session_id TEXT,stripe_payment_intent_id TEXT,total_pence INTEGER,currency TEXT);CREATE TABLE rx_refunds(id TEXT PRIMARY KEY,order_number TEXT,member_id INTEGER,amount_pence INTEGER,currency TEXT,state TEXT,idempotency_key TEXT,approved_by INTEGER,approval_reference TEXT);CREATE TABLE rx_refund_sources(refund_id TEXT PRIMARY KEY,payment_id TEXT,payment_intent TEXT,captured_pence INTEGER);"+captureSchema);
 sql.prepare('INSERT INTO users VALUES(1,?)').run('fiction@example.test');
 sql.prepare("INSERT INTO medicine_orders VALUES('TEST-ORDER',1,9911,'TEST-NOT-FOR-SUPPLY','fiction@example.test',?,?,10000,'GBP')").run(session,intent);
 sql.prepare("INSERT INTO rx_refunds VALUES('TEST-REFUND','TEST-ORDER',1,1000,'GBP','submitting','TEST-REFUND-KEY',2,'TEST-APPROVAL')").run();
 sql.prepare("INSERT INTO rx_refund_sources VALUES('TEST-REFUND',NULL,?,10000)").run(intent);capture(sql);
 const env=mark(DB),transport=qaRefundTransport(env);
 const request=(fields={},extra={})=>new Request(extra.url||'https://api.stripe.com/v1/refunds',{method:extra.method||'POST',headers:{'Idempotency-Key':extra.key||'TEST-REFUND-KEY','Content-Type':'application/x-www-form-urlencoded'},body:extra.method==='GET'?undefined:new URLSearchParams({payment_intent:intent,amount:'1000','metadata[sst_refund_id]':'TEST-REFUND','metadata[order_reference]':'TEST-ORDER',...fields}).toString()});
 return {sql,DB,env,transport,request,close:()=>sql.close()};
}
test('QA refund transport refuses live, unmarked, mixed and externally supplied processor bindings before creating receipts',async()=>{
 const f=setup();try{
  for(const change of [{SSTRX_ENVIRONMENT:'production'},{STRIPE_MODE:'live'},{SSTRX_QA_REFUNDS_ENABLED:'false'},{SSTRX_QA_DATABASE_ID:'88f40aed-cb23-4372-8c94-8a73f48bc847'},{STRIPE_SECRET_KEY:'sk_test_real_lookalike'}])await assert.rejects(qaRefundTransport({...f.env,...change}).fetch(f.request()),/isolated_qa_refund/);
  await assert.rejects(qaRefundEnvironment({...f.env,REFUND_TEST_TRANSPORT:{}}),/already_supplied/);
  f.sql.exec('DELETE FROM sstrx_qa_environment');await assert.rejects(f.transport.fetch(f.request()),/isolated_qa_refund/);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='qa_simulated_refunds'").get().n,0);
 }finally{f.close()}
});
test('QA refund response binds the existing approval, native capture and key and retains one immutable receipt for concurrent retries',async()=>{
 const f=setup();try{
  const responses=await Promise.all([f.transport.fetch(f.request()),f.transport.fetch(f.request())]),values=await Promise.all(responses.map(r=>r.json()));
  assert.deepEqual(values[0],values[1]);assert.match(values[0].id,/^re_test_QA_[a-f0-9]{32}$/);assert.equal(values[0].status,'succeeded');assert.equal(values[0].livemode,false);assert.equal(values[0].simulation,true);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM qa_simulated_refunds').get().n,1);
  assert.throws(()=>f.sql.exec("UPDATE qa_simulated_refunds SET response_json='{}'"),/immutable_qa_refund_receipt/);
  assert.throws(()=>f.sql.exec('DELETE FROM qa_simulated_refunds'),/immutable_qa_refund_receipt/);
 }finally{f.close()}
});
test('QA refund transport denies altered amount, intent, key, order, route, duplicate fields and unauthorised selections',async()=>{
 const f=setup();try{
  for(const req of [f.request({amount:'1'}),f.request({payment_intent:'pi_live_FORBIDDEN'}),f.request({}, {key:'OTHER'}),f.request({'metadata[order_reference]':'OTHER'}),f.request({extra:'forbidden'}),f.request({}, {url:'http://api.stripe.com/v1/refunds'}),f.request({}, {url:'https://api.stripe.com/v1/refunds?copy=1'}),f.request({}, {method:'GET'})])assert.ok((await f.transport.fetch(req)).status>=400);
  const duplicate=f.request();assert.equal((await f.transport.fetch(new Request(duplicate,{body:(await duplicate.text())+'&amount=1000'}))).status,400);
  for(const sql of ["UPDATE users SET email='someone@deliverable.example'","UPDATE medicine_orders SET variant_id=11","UPDATE rx_refunds SET approved_by=NULL","UPDATE rx_refunds SET state='requested'","UPDATE rx_refund_sources SET payment_id='unqualified-additional-payment'"]){
   const x=setup();try{x.sql.exec(sql);assert.equal((await x.transport.fetch(x.request())).status,403);}finally{x.close()}
  }
 }finally{f.close()}
});
test('Missing, conflicting or corrupt capture proof cannot be converted to a simulated refund',async()=>{
 for(const change of ['DELETE FROM medicine_payment_receipts',"UPDATE medicine_payment_receipts SET amount_pence=1","UPDATE medicine_payment_receipts SET payload_digest='invalid'","UPDATE medicine_orders SET stripe_checkout_session_id='cs_live_not_allowed'"]){
  const f=setup();try{f.sql.exec(change);assert.equal((await f.transport.fetch(f.request())).status,403);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='qa_simulated_refunds'").get().n,0);}finally{f.close()}
 }
});
test('A changed approved request cannot reuse the processor idempotency receipt',async()=>{
 const f=setup();try{
  assert.equal((await f.transport.fetch(f.request())).status,200);
  f.sql.exec('UPDATE rx_refunds SET amount_pence=2000');
  assert.equal((await f.transport.fetch(f.request({amount:'2000'}))).status,409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM qa_simulated_refunds').get().n,1);
 }finally{f.close()}
});
test('Native refund request, approval and lost response recover through the durable QA binding with one owned ledger entry',async()=>{
 const f=await fixture(),oldFetch=globalThis.fetch;let network=0;
 try{
  globalThis.fetch=async()=>{network++;throw Error('External network disabled')};
  Object.assign(f.env,mark(f.DB),{SSTRX_PLATFORM_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true'});marker(f.sql);await ensurePlatformSchema(f.DB);await ensureRefundSchema(f.DB);
  f.sql.prepare("INSERT INTO medicine_variants(id,medicine_id,strength_label,selling_price_pence,status,updated_at,sellable,availability_state) VALUES(9911,1,'TEST',10000,'available',?,1,'available')").run(new Date().toISOString());
  f.sql.prepare("UPDATE medicine_orders SET variant_id=9911,medicine_name='TEST-NOT-FOR-SUPPLY',stripe_checkout_session_id=?,stripe_payment_intent_id=?,total_pence=10000 WHERE order_number=?").run(session,intent,ORDER);
  f.sql.exec(captureSchema);capture(f.sql,ORDER);
  f.sql.prepare('INSERT INTO rx_economics VALUES(?,1,?,?)').run(ORDER,JSON.stringify(economicsTerms({model:'shift_collects',supplierId:'TEST',sellingPence:10000,outputTaxPence:0,taxTreatment:'TEST',approvalReference:'TEST-TERMS',costSourceReference:'TEST-COSTS'})),new Date().toISOString());
  Object.assign(f.env,await qaRefundEnvironment(f.env));
  const native=f.env.REFUND_TEST_TRANSPORT;let calls=0;
  f.env.REFUND_TEST_TRANSPORT={async fetch(req){const res=await native.fetch(req);if(calls++===0)throw Error('TEST response lost after stored processor acceptance');return res;}};
  async function call(path,body){const r=await f.hq('/platform/refunds'+path,1,body),d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;}
  let r=await call('',{orderReference:ORDER,amountPence:1000,reason:'TEST cancellation',termsReference:'TEST-TERMS',clientReference:'TEST-NATIVE-REFUND'});
  r=await call('/'+r.id+'/approve',{version:r.version,approvalReference:'TEST-APPROVAL',exceptionDueAt:new Date(Date.now()+3600000).toISOString()});
  r=await call('/'+r.id+'/submit',{version:r.version});assert.equal(r.state,'unknown');
  r=await call('/'+r.id+'/submit',{version:r.version});assert.equal(r.state,'completed');
  assert.equal((await memberRefunds(f.env,42))[0].state,'completed');assert.deepEqual(await memberRefunds(f.env,99),[]);
  for(const table of ['qa_simulated_refunds','rx_refund_receipts'])assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n,1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_finance_entries WHERE kind='refund'").get().n,1);
  assert.equal(f.sql.prepare("SELECT state FROM rx_finance_exceptions WHERE id=?").get('refund:'+r.id).state,'resolved');
  assert.equal(network,0);
 }finally{globalThis.fetch=oldFetch;f.close()}
});
