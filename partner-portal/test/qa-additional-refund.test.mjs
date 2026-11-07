import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,ORDER,RECORD} from './fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {ensureRefundSchema} from '../platform/refunds.mjs';
import {ensureLifecycleSchema} from '../platform/prescription-lifecycle.mjs';
import {economicsTerms} from '../platform/domain.mjs';
import {priceSettlement} from '../platform/price-adjustments.mjs';
import clinical from '../service/clinical-service.mjs';
import qaStack from '../qa/stack-clinical-entry.mjs';
import {qaRefundEnvironment,qaRefundTransport} from '../qa/finance-transport.mjs';
import {qaStatementReference} from '../qa/statement-transport.mjs';
const lifecycle='30000000-0000-4000-8000-000000000001',dbId='00000000-0000-4000-8000-000000000031';
const originalSession='cs_test_QA_'+'a'.repeat(32),originalIntent='pi_test_QA_'+'a'.repeat(32);
const j=async(r,status=200)=>{const body=await r.json();assert.equal(r.status,status,JSON.stringify(body));return body;};
async function setup(){
 const f=await fixture(),date=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString(),originalAt=new Date(Math.floor(Date.now()/1000)*1000-60000).toISOString();
 Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true',SSTRX_ENVIRONMENT:'synthetic',SSTRX_QA_STACK:'joined-v31',SSTRX_QA_DATABASE_ID:dbId,STRIPE_MODE:'test',SSTRX_QA_REFUNDS_ENABLED:'true',SSTRX_QA_STATEMENTS_ENABLED:'true',SSTRX_QA_PRICE_PAYMENTS_ENABLED:'true'});
 f.sql.exec('CREATE TABLE sstrx_qa_environment(environment TEXT,database_id TEXT,synthetic_only INTEGER)');
 f.sql.prepare('INSERT INTO sstrx_qa_environment VALUES(?,?,1)').run('joined-v31',dbId);
 await ensurePlatformSchema(f.DB);await ensureRefundSchema(f.DB);await ensureLifecycleSchema(f.DB);
 f.sql.prepare("INSERT INTO medicine_variants(id,medicine_id,strength_label,selling_price_pence,status,updated_at,sellable,availability_state) VALUES(9911,1,'TEST',10000,'available',?,1,'available')").run(date);
 f.sql.prepare("UPDATE medicine_orders SET variant_id=9911,medicine_name='TEST-NOT-FOR-SUPPLY',total_pence=10000,unit_price_pence=10000,stripe_checkout_session_id=?,stripe_payment_intent_id=? WHERE order_number=?").run(originalSession,originalIntent,ORDER);
 f.sql.exec('CREATE TABLE medicine_payment_receipts(event_id TEXT PRIMARY KEY,order_number TEXT,session_id TEXT,payment_intent TEXT,mode TEXT,amount_pence INTEGER,currency TEXT,occurred_at TEXT,received_at TEXT,payload_digest TEXT)');
 f.sql.prepare('INSERT INTO medicine_payment_receipts VALUES(?,?,?,?,?,?,?,?,?,?)').run('evt_test_QA_'+originalSession,ORDER,originalSession,originalIntent,'test',10000,'GBP',originalAt,originalAt,'a'.repeat(64));
 f.sql.prepare('INSERT INTO rx_economics VALUES(?,1,?,?)').run(ORDER,JSON.stringify(economicsTerms({model:'shift_collects',supplierId:'TEST',sellingPence:10000,outputTaxPence:0,taxTreatment:'TEST',approvalReference:'TEST-TERMS',costSourceReference:'TEST-COSTS'})),date);
 f.sql.prepare("INSERT INTO rx_finance_entries VALUES('TEST-ORIGINAL',?,'TEST-ORIGINAL','member_payment',10000,'GBP','TEST-VERIFIED-ORIGINAL',?,?)").run(ORDER,originalAt,originalAt);
 const baseline=f.sql.prepare('SELECT id,event_reference,kind,amount_pence,currency,source_reference FROM rx_finance_entries WHERE order_number=? ORDER BY id').all(ORDER);
 // Retained approved plan/agreement fixtures; the actual additional capture and
 // every refund below use native HTTP handlers with the durable QA bindings.
 const plan={lifecycle_id:lifecycle,record_id:RECORD,order_number:ORDER,member_id:42,variant_id:9911,packs:2,mode:'collect_difference',member_total_pence:15000,delta_pence:5000,baseline_json:JSON.stringify(baseline),catalogue_json:JSON.stringify(f.sql.prepare('SELECT * FROM medicine_variants WHERE id=9911').get()),terms_reference:'TEST-TERMS',approval_reference:'TEST-PRICE',cost_reference:'TEST-COST',discount_reference:'TEST-PRICE',approved_by:1,expires_at:expires,created_at:date,version:1};
 const work={id:lifecycle,record_id:RECORD,order_number:ORDER,member_id:42,prescription_id:'TEST-ORIGINAL-SIGNATURE',prescription_version:1,case_version:1,kind:'amend',state:'proposal_open',version:2,requested_by:3,pharmacy_org_id:'pharmacy-org',finance_owner_id:1,due_at:expires,reason:'TEST amendment',public_message:'TEST replacement',policy_json:'{}',client_reference:'TEST-LIFECYCLE',payload_digest:'a'.repeat(64),created_at:date,updated_at:date};
 for(const [table,value]of [['rx_lifecycle_price_plans',plan],['rx_prescription_lifecycle',work]])f.sql.prepare('INSERT INTO '+table+'('+Object.keys(value).join(',')+') VALUES('+Object.keys(value).map(()=>'?').join(',')+')').run(...Object.values(value));
 f.sql.prepare('INSERT INTO clinical_prescription_requests VALUES(?,?,42,3,?,?)').run(RECORD,ORDER,JSON.stringify({version:3,status:'accepted',expiresAt:expires,quote:{pricePlan:{lifecycleId:lifecycle,version:1}}}),date);
 function request(path,body,member=false){return new Request('https://api.shiftsometimber.co.uk'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:member?'sst_session='+f.memberToken:'sst_hq_session='+f.tokens[1],Origin:member?'https://my-timber.app':'https://hq.shiftsometimber.co.uk',...body===undefined?{}:{'Content-Type':'application/json'}},body:body===undefined?undefined:JSON.stringify(body)});}
 const call=(path,body,member=false)=>qaStack.fetch(request(path,body,member),f.env,{});
 await j(await call('/v1/member/clinical-records/'+RECORD+'/price-adjustments/'+lifecycle,{version:3,agreed:true},true));
 const payment=f.sql.prepare('SELECT * FROM rx_lifecycle_payments').get();
 await j(await call('/v1/member/clinical-records/qa-price-checkout/'+payment.id,{action:'complete'},true));
 const paid=f.sql.prepare('SELECT * FROM rx_lifecycle_payments WHERE id=?').get(payment.id);
 const hq=(path,body)=>call('/v1/hq/clinical/platform'+path,body);
 async function approved(amount,paymentSourceId=paid.id){
  let refund=await j(await hq('/refunds',{orderReference:ORDER,amountPence:amount,...paymentSourceId?{paymentSourceId}:{},reason:'TEST source-specific refund',termsReference:'TEST-TERMS',clientReference:crypto.randomUUID()}));
  refund=await j(await hq('/refunds/'+refund.id+'/approve',{version:refund.version,approvalReference:'TEST-FINANCE',exceptionDueAt:new Date(Date.now()+3600000).toISOString()}));return refund;
 }
 const submit=refund=>hq('/refunds/'+refund.id+'/submit',{version:refund.version});
 const count=table=>f.sql.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(table)?f.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n:0;
 return {...f,plan,paid,originalAt,request,call,hq,approved,submit,count};
}

test('Original and additional TEST refunds keep separate processor references and limits, and independently reconcile after old consent expires',async()=>{
 const f=await setup();try{
  const oldSource=f.sql.prepare('SELECT source_json FROM rx_lifecycle_payment_sources').get().source_json;
  f.sql.prepare('UPDATE rx_lifecycle_price_plans SET expires_at=?,version=version+1').run(new Date(Date.now()-1000).toISOString());
  f.sql.prepare("UPDATE clinical_prescription_requests SET version=4,state_json=?").run(JSON.stringify({version:4,status:'issued',expiresAt:new Date(Date.now()-1000).toISOString()}));
  const original=await f.approved(1000,null),extra=await f.approved(2000);
  assert.equal((await j(await f.submit(original))).state,'completed');assert.equal((await j(await f.submit(extra))).state,'completed');
  const sources=f.sql.prepare('SELECT payment_id,payment_intent,captured_pence FROM rx_refund_sources ORDER BY captured_pence DESC').all();
  assert.equal(sources[0].payment_id,null);assert.equal(sources[0].payment_intent,originalIntent);assert.equal(sources[0].captured_pence,10000);
  assert.equal(sources[1].payment_id,f.paid.id);assert.equal(sources[1].payment_intent,f.paid.payment_intent);assert.equal(sources[1].captured_pence,5000);
  for(const [amount,paymentSourceId]of [[9001,null],[3001,f.paid.id]])await j(await f.hq('/refunds',{orderReference:ORDER,amountPence:amount,...paymentSourceId?{paymentSourceId}:{},reason:'TEST over-refund',termsReference:'TEST-TERMS',clientReference:crypto.randomUUID()}),409);
  assert.equal((await priceSettlement(f.env,f.plan)).settled,false);
  assert.equal(f.sql.prepare('SELECT source_json FROM rx_lifecycle_payment_sources').get().source_json,oldSource);
  assert.equal(f.count('qa_simulated_refunds'),2);assert.equal(f.sql.prepare("SELECT SUM(amount_pence) n FROM rx_finance_entries WHERE kind='refund'").get().n,3000);
  const capture={id:originalSession,object:'checkout.session',currency:'gbp',amount_total:10000,livemode:false,simulation:true,client_reference_id:ORDER,metadata:{order_number:ORDER,order_type:'medicine',user_id:'42'}};
  f.sql.exec('CREATE TABLE qa_simulated_checkouts(id TEXT PRIMARY KEY,order_number TEXT,member_id INTEGER,session_json TEXT,outcome TEXT,event_created INTEGER,event_id TEXT,event_type TEXT)');
  f.sql.prepare('INSERT INTO qa_simulated_checkouts VALUES(?,?,?,?,?,?,?,?)').run(originalSession,ORDER,42,JSON.stringify(capture),'paid',Date.parse(f.originalAt)/1000,'evt_test_QA_'+originalSession,'checkout.session.completed');
  await delay(2);const fromAt=new Date(Date.parse(f.originalAt)-1000).toISOString(),toAt=new Date().toISOString();
  const matched=await j(await f.hq('/reconciliation',{sourceReference:qaStatementReference(fromAt,toAt),fromAt,toAt,orderReference:'ALL',ownerUserId:1,dueAt:new Date(Date.now()+3600000).toISOString()}));
  assert.equal(matched.state,'matched');assert.equal(matched.variancePence,0);
  const statement=JSON.parse(f.sql.prepare('SELECT statement_json FROM qa_simulated_statements').get().statement_json);
  assert.equal(statement.netReceivedPence,12000);assert.equal(statement.captureCount,2);assert.equal(statement.additionalCaptureCount,1);assert.equal(statement.refundCount,2);assert.equal(statement.additionalPaymentRefundsSupported,true);
 }finally{f.close();}
});

test('Accepted additional refund recovers by source-qualified GET once and cannot reconcile with corrupted native capture evidence',async()=>{
 const f=await setup();try{
  const refund=await f.approved(1000),env=await qaRefundEnvironment(f.env),native=env.REFUND_TEST_TRANSPORT,calls={post:0,get:0};
  env.REFUND_TEST_TRANSPORT={async fetch(req){calls[req.method.toLowerCase()]++;const response=await native.fetch(req);return req.method==='POST'?Response.json({...await response.json(),status:'pending'}):response;}};
  const call=(path,body)=>clinical.fetch(f.request('/v1/hq/clinical/platform'+path,body),env,{});
  let current=await j(await call('/refunds/'+refund.id+'/submit',{version:refund.version}));assert.equal(current.state,'submitted');
  const receipt=f.sql.prepare('SELECT * FROM rx_lifecycle_payment_receipts').get();
  f.sql.prepare("UPDATE rx_lifecycle_payment_receipts SET payload_digest='corrupt'").run();
  await j(await call('/refunds/'+refund.id+'/reconcile',{version:current.version}),502);
  assert.equal(f.count('rx_refund_receipts'),0);assert.equal(f.count('qa_simulated_refunds'),1);
  f.sql.prepare('UPDATE rx_lifecycle_payment_receipts SET payload_digest=?').run(receipt.payload_digest);
  current=await j(await call('/refunds/'+refund.id+'/reconcile',{version:current.version}));assert.equal(current.state,'completed');
  assert.equal(f.count('rx_refund_receipts'),1);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_finance_entries WHERE kind='refund'").get().n,1);
  const before={...calls};assert.equal((await j(await call('/refunds/'+refund.id+'/reconcile',{version:current.version}))).duplicate,true);assert.deepEqual(calls,before);assert.equal(calls.post,1);
  const response=JSON.parse(f.sql.prepare('SELECT response_json FROM qa_simulated_refunds').get().response_json);assert.equal(response.qaCapture.paymentId,f.paid.id);assert.equal(response.qaCapture.payloadDigest,receipt.payload_digest);
 }finally{f.close();}
});

test('Missing, uncertain, mismatched or corrupted additional-capture proof cannot manufacture a TEST refund',async()=>{
 const changes=[
  "DELETE FROM rx_lifecycle_payment_receipts",
  "UPDATE rx_lifecycle_payment_receipts SET payload_digest='corrupt'",
  "UPDATE rx_lifecycle_payments SET state='unknown'",
  "UPDATE rx_lifecycle_payments SET member_id=99",
  "UPDATE rx_lifecycle_payments SET amount_pence=4999",
  "UPDATE rx_lifecycle_payments SET payment_intent='pi_test_QA_wrong'",
  "DROP TRIGGER qa_simulated_price_outcomes_no_update; UPDATE qa_simulated_price_outcomes SET payload_digest='corrupt'",
  "DROP TRIGGER qa_simulated_price_checkouts_no_update; UPDATE qa_simulated_price_checkouts SET session_json=json_set(session_json,'$.amount_total',4999)",
  "DROP TRIGGER rx_price_source_immutable_update; UPDATE rx_lifecycle_payment_sources SET source_json=json_set(source_json,'$.kind','fixture')"
 ];
 for(const change of changes){
  const f=await setup();try{
   const refund=await f.approved(1000);f.sql.exec(change);
   await j(await f.submit(refund),502);
   assert.equal(f.count('qa_simulated_refunds'),0,change);assert.equal(f.count('rx_refund_receipts'),0,change);
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_finance_entries WHERE kind='refund'").get().n,0,change);
  }finally{f.close();}
 }
});

test('Atomic provider capture balance defeats inconsistent competing native reservations and same-key replay cannot duplicate refunds',async()=>{
 const f=await setup();try{
  const first=await f.approved(3000);
  // Inject an inconsistent historical reservation snapshot. The provider must
  // retain its own capture limit even when native reservations need repair.
  f.sql.prepare("UPDATE rx_refunds SET state='failed' WHERE id=?").run(first.id);
  const second=await f.approved(3000);f.sql.prepare("UPDATE rx_refunds SET state='approved' WHERE id=?").run(first.id);
  const results=await Promise.all([f.submit(first),f.submit(second)]);let completed=0;
  for(const r of results){const body=await r.json();assert.ok([200,502].includes(r.status),JSON.stringify(body));if(r.status===200){assert.equal(body.state,'completed');completed++;}}
  assert.equal(completed,1);assert.equal(f.count('qa_simulated_refunds'),1);
  assert.equal(f.sql.prepare("SELECT SUM(amount_pence) n FROM rx_finance_entries WHERE kind='refund'").get().n,3000);
  const retained=f.sql.prepare('SELECT * FROM qa_simulated_refunds').get(),refund=f.sql.prepare('SELECT * FROM rx_refunds WHERE id=?').get(retained.refund_id),source=f.sql.prepare('SELECT * FROM rx_refund_sources WHERE refund_id=?').get(refund.id);
  const request=()=>new Request('https://api.stripe.com/v1/refunds',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':refund.idempotency_key},body:new URLSearchParams({payment_intent:source.payment_intent,amount:String(refund.amount_pence),'metadata[sst_refund_id]':refund.id,'metadata[order_reference]':ORDER})});
  const transport=qaRefundTransport(f.env),replays=await Promise.all([transport.fetch(request()),transport.fetch(request())]);
  for(const r of replays)assert.deepEqual(await j(r),JSON.parse(retained.response_json));
  assert.equal(f.count('qa_simulated_refunds'),1);
 }finally{f.close();}
});
