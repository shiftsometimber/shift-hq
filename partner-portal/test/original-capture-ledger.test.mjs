import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,ORDER} from './fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {ensureRefundSchema} from '../platform/refunds.mjs';
import {economicsTerms,digest} from '../platform/domain.mjs';
import {qaRefundEnvironment} from '../qa/finance-transport.mjs';
import {qaStatementEnvironment,qaStatementReference} from '../qa/statement-transport.mjs';

const dbId='00000000-0000-4000-8000-000000000031';
const session='cs_test_QA_'+'f'.repeat(32),intent='pi_test_QA_'+'f'.repeat(32),eventId='evt_test_QA_'+session;
const terms=()=>economicsTerms({model:'shift_collects',supplierId:'TEST-SUPPLIER',sellingPence:10000,outputTaxPence:0,taxTreatment:'TEST',approvalReference:'TEST-CAPTURE-COST-APPROVAL',costSourceReference:'TEST-COSTS'});
const read=async(response,status=200)=>{const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;};

// The signed-webhook producer and its immutable-source triggers are qualified
// in Core's medicine-stripe-retry-v1 tests. These fixtures represent its retained
// output, so corrupt-source cases can exercise this consumer's fail-closed checks.
async function setup({receipt=true}={}){
 const f=await fixture();
 Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true',SSTRX_ENVIRONMENT:'synthetic',SSTRX_QA_STACK:'joined-v31',SSTRX_QA_DATABASE_ID:dbId,STRIPE_MODE:'test',SSTRX_QA_REFUNDS_ENABLED:'true',SSTRX_QA_STATEMENTS_ENABLED:'true'});
 f.sql.exec('CREATE TABLE sstrx_qa_environment(environment TEXT,database_id TEXT,synthetic_only INTEGER)');
 f.sql.prepare('INSERT INTO sstrx_qa_environment VALUES(?,?,1)').run('joined-v31',dbId);
 await ensurePlatformSchema(f.DB);await ensureRefundSchema(f.DB);
 f.sql.prepare("INSERT INTO medicine_variants(id,medicine_id,strength_label,selling_price_pence,status,updated_at,sellable,availability_state) VALUES(9911,1,'TEST',10000,'available',?,1,'available')").run(new Date().toISOString());
 f.sql.prepare("UPDATE medicine_orders SET variant_id=9911,medicine_name='TEST-NOT-FOR-SUPPLY',stripe_checkout_session_id=?,stripe_payment_intent_id=?,unit_price_pence=10000,total_pence=10000 WHERE order_number=?").run(session,intent,ORDER);
 f.sql.exec('CREATE TABLE medicine_payment_receipts(event_id TEXT PRIMARY KEY,order_number TEXT,session_id TEXT,payment_intent TEXT,mode TEXT,amount_pence INTEGER,currency TEXT,occurred_at TEXT,received_at TEXT,payload_digest TEXT)');
 const occurredAt=new Date(Math.floor(Date.now()/1000)*1000-60000).toISOString(),receivedAt=new Date(Date.now()-30000).toISOString();
 const checkout={id:session,object:'checkout.session',currency:'gbp',amount_total:10000,livemode:false,simulation:true,client_reference_id:ORDER,metadata:{order_number:ORDER,order_type:'medicine',user_id:'42'}};
 const sourceDigest=await digest({created:Date.parse(occurredAt)/1000,id:eventId,type:'checkout.session.completed',livemode:false,data:{object:{...checkout,payment_status:'paid',payment_intent:intent}}});
 function addReceipt(){f.sql.prepare('INSERT INTO medicine_payment_receipts VALUES(?,?,?,?,?,?,?,?,?,?)').run(eventId,ORDER,session,intent,'test',10000,'GBP',occurredAt,receivedAt,sourceDigest);}
 if(receipt)addReceipt();
 const call=(path,body,actor=1,status=200)=>f.hq('/platform'+path,actor,body).then(r=>read(r,status));
 const recordTerms=()=>call('/commercial/'+ORDER+'/terms',terms(),1,201);
 const capture=()=>call('/commercial/'+ORDER+'/capture',{});
 const ledger=()=>f.sql.prepare("SELECT * FROM rx_finance_entries WHERE kind='member_payment' ORDER BY id").all();
 const audits=()=>f.sql.prepare("SELECT * FROM rx_platform_audit WHERE action='original_capture_recorded' OR (action='terms_recorded' AND json_extract(detail_json,'$.originalCapture.entryId') IS NOT NULL) ORDER BY id").all();
 return {...f,call,recordTerms,capture,ledger,audits,addReceipt,occurredAt,receivedAt,sourceDigest,checkout};
}

test('Native terms link one retained original capture; one independently retained refund reconciles to a matched provider statement',async()=>{
 const f=await setup();try{
  const source=f.sql.prepare('SELECT * FROM medicine_payment_receipts').get();
  const saved=await f.recordTerms();assert.equal(saved.captureLedger.state,'recorded');assert.equal(saved.moneyMoved,false);
  assert.equal(f.ledger().length,1);assert.equal(f.audits().length,1);
  const entry=f.ledger()[0];assert.equal(entry.amount_pence,10000);assert.equal(entry.currency,'GBP');assert.equal(entry.occurred_at,f.occurredAt);assert.equal(entry.source_reference,'medicine-receipt:'+eventId);
  const audit=JSON.parse(f.audits()[0].detail_json);assert.equal(audit.originalCapture.receiptDigest,f.sourceDigest);
  const replay=await f.capture();assert.equal(replay.duplicate,true);assert.equal(replay.moneyMoved,false);
  await f.call('/commercial/'+ORDER+'/entry',{eventReference:entry.event_reference,kind:'member_payment',amountPence:10000,sourceReference:entry.source_reference,occurredAt:f.occurredAt},1,403);
  Object.assign(f.env,await qaRefundEnvironment(f.env));
  const native=f.env.REFUND_TEST_TRANSPORT,calls={post:0,get:0};
  f.env.REFUND_TEST_TRANSPORT={async fetch(req){
   calls[req.method.toLowerCase()]++;const response=await native.fetch(req);
   // The provider retained success, but the create response does not confirm it.
   return req.method==='POST'?Response.json({...await response.json(),status:'pending'}):response;
  }};
  let refund=await f.call('/refunds',{orderReference:ORDER,amountPence:1000,reason:'TEST partial refund',termsReference:'TEST-ORIGINAL-TERMS',clientReference:'TEST-CAPTURE-REFUND'});
  refund=await f.call('/refunds/'+refund.id+'/approve',{version:refund.version,approvalReference:'TEST-FINANCE-APPROVAL',exceptionDueAt:new Date(Date.now()+3600000).toISOString()});
  refund=await f.call('/refunds/'+refund.id+'/submit',{version:refund.version});assert.equal(refund.state,'submitted');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_finance_entries WHERE kind='refund'").get().n,0);
  refund=await f.call('/refunds/'+refund.id+'/reconcile',{version:refund.version});assert.equal(refund.state,'completed');
  assert.deepEqual(calls,{post:1,get:1});
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_finance_entries WHERE kind='refund'").get().n,1);
  assert.throws(()=>f.sql.exec("UPDATE qa_simulated_refunds SET response_json='{}'"),/immutable_qa_refund_receipt/);
  f.sql.exec('CREATE TABLE qa_simulated_checkouts(id TEXT PRIMARY KEY,order_number TEXT,member_id INTEGER,session_json TEXT,outcome TEXT,event_created INTEGER,event_id TEXT,event_type TEXT)');
  f.sql.prepare('INSERT INTO qa_simulated_checkouts VALUES(?,?,?,?,?,?,?,?)').run(session,ORDER,42,JSON.stringify(f.checkout),'paid',Date.parse(f.occurredAt)/1000,eventId,'checkout.session.completed');
  Object.assign(f.env,await qaStatementEnvironment(f.env));
  // End is exclusive and the statement must cover a closed period.
  await delay(2);
  const fromAt=new Date(Date.parse(f.occurredAt)-1000).toISOString(),toAt=new Date().toISOString();
  const command={sourceReference:qaStatementReference(fromAt,toAt),fromAt,toAt,ownerUserId:1,dueAt:new Date(Date.now()+3600000).toISOString(),orderReference:'ALL'};
  const matched=await f.call('/reconciliation',command);assert.equal(matched.state,'matched');assert.equal(matched.variancePence,0);
  const provider=JSON.parse(f.sql.prepare('SELECT statement_json FROM qa_simulated_statements').get().statement_json);
  assert.equal(provider.captureCount,1);assert.equal(provider.refundCount,1);assert.equal(provider.netReceivedPence,9000);assert.equal(provider.bankBalanceRepresented,false);
  assert.equal((await f.call('/reconciliation',command)).duplicate,true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_reconciliation_runs').get().n,1);
  assert.deepEqual(f.sql.prepare('SELECT * FROM medicine_payment_receipts').get(),source);
  assert.deepEqual(f.ledger(),[entry]);assert.equal(f.audits().length,1);assert.deepEqual(calls,{post:1,get:1});
 }finally{f.close();}
});

test('Concurrent original-capture links retain exactly one payment and one audit, then return the original result',async()=>{
 const f=await setup({receipt:false});try{
  await f.recordTerms();f.addReceipt();
  const responses=await Promise.all([f.hq('/platform/commercial/'+ORDER+'/capture',1,{}),f.hq('/platform/commercial/'+ORDER+'/capture',1,{})]);
  const results=[];
  for(const response of responses){const body=await response.json();assert.ok([200,409].includes(response.status),JSON.stringify(body));results.push({status:response.status,body});}
  assert.ok(results.some(r=>r.status===200));assert.equal(f.ledger().length,1);assert.equal(f.audits().length,1);
  const replay=await f.capture();assert.equal(replay.state,'recorded');assert.equal(replay.duplicate,true);assert.equal(replay.entryId,f.ledger()[0].id);
  assert.equal(f.ledger().length,1);assert.equal(f.audits().length,1);
 }finally{f.close();}
});

test('Receipt identity, money, digest and timestamp conflicts cannot become ledger payments or ready finance work',async()=>{
 const cases=[
  ['session',"UPDATE medicine_payment_receipts SET session_id='cs_test_QA_other'"],
  ['intent',"UPDATE medicine_payment_receipts SET payment_intent='pi_test_QA_other'"],
  ['amount','UPDATE medicine_payment_receipts SET amount_pence=9999'],
  ['currency',"UPDATE medicine_payment_receipts SET currency='USD'"],
  ['digest',"UPDATE medicine_payment_receipts SET payload_digest='not-a-digest'"],
  ['mode',"UPDATE medicine_payment_receipts SET mode='live'"],
  ['date',"UPDATE medicine_payment_receipts SET occurred_at='not-a-date'"],
  ['noncanonical',"UPDATE medicine_payment_receipts SET occurred_at=replace(occurred_at,'.000Z','Z')"],
  ['future-received',"UPDATE medicine_payment_receipts SET received_at='2099-01-01T00:00:00.000Z'"],
  ['source-clock',"UPDATE medicine_payment_receipts SET occurred_at=strftime('%Y-%m-%dT%H:%M:%fZ',received_at,'+6 minutes')"]
 ];
 for(const [name,change]of cases){
  const f=await setup({receipt:false});try{
   await f.recordTerms();f.addReceipt();f.sql.exec(change);
   const queue=await f.call('/refunds');assert.equal(queue.captureWork.records.find(r=>r.orderReference===ORDER)?.state,'requires_review',name);
   await f.call('/commercial/'+ORDER+'/capture',{},1,409);
   assert.equal(f.ledger().length,0,name);assert.equal(f.audits().length,0,name);
  }finally{f.close();}
 }
});

test('An existing original manual payment is review work, while a legitimate extra-price payment does not duplicate the original',async()=>{
 for(const extraPrice of [false,true]){
  const f=await setup({receipt:false});try{
   await f.recordTerms();f.addReceipt();
   const reference=extraPrice?'price-payment:TEST-EXTRA':'TEST-MANUAL-ORIGINAL';
   await f.call('/commercial/'+ORDER+'/entry',{eventReference:reference,kind:'member_payment',amountPence:extraPrice?2000:10000,sourceReference:'TEST-EXISTING-RECEIPT',occurredAt:f.occurredAt},1,201);
   if(extraPrice){await f.capture();assert.equal(f.ledger().length,2);assert.equal(f.audits().length,1);}
   else {await f.call('/commercial/'+ORDER+'/capture',{},1,409);assert.equal(f.ledger().length,1);assert.equal(f.audits().length,0);}
  }finally{f.close();}
 }
});

test('Non-finance roles and a session revoked at the write boundary cannot link original payments',async()=>{
 const f=await setup({receipt:false});try{
  await f.recordTerms();f.addReceipt();
  for(const actor of [3,4])await f.call('/commercial/'+ORDER+'/capture',{},actor,403);
  for(const role of ['support','operations']){
   f.sql.prepare('UPDATE hq_users SET role=? WHERE id=2').run(role);
   await f.call('/commercial/'+ORDER+'/capture',{},2,403);
  }
  const batch=f.DB.batch.bind(f.DB);
  f.DB.batch=async statements=>{f.sql.prepare('UPDATE hq_sessions SET revoked_at=? WHERE hq_user_id=1').run(new Date().toISOString());return batch(statements);};
  await f.call('/commercial/'+ORDER+'/capture',{},1,409);
  assert.equal(f.ledger().length,0);assert.equal(f.audits().length,0);
 }finally{f.close();}
});

test('Missing native capture evidence cannot be replaced with client-supplied amounts or an invented receipt',async()=>{
 const f=await setup({receipt:false});try{
  const saved=await f.recordTerms();assert.equal(saved.captureLedger.state,'unavailable');
  await f.call('/commercial/'+ORDER+'/capture',{},1,409);
  await f.call('/commercial/'+ORDER+'/capture',{amountPence:10000,eventId:'invented'},1,422);
  assert.equal(f.ledger().length,0);assert.equal(f.audits().length,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medicine_payment_receipts').get().n,0);
  assert.equal((await f.call('/refunds')).captureWork.records.length,0);
 }finally{f.close();}
});
