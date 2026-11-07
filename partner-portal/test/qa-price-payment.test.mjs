import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,ORDER,RECORD} from './fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {ensureRefundSchema} from '../platform/refunds.mjs';
import {ensureLifecycleSchema} from '../platform/prescription-lifecycle.mjs';
import {economicsTerms} from '../platform/domain.mjs';
import {priceSettlement,stripePriceWebhook} from '../platform/price-adjustments.mjs';
import {priceSessionMatches} from '../platform/price-processor.mjs';
import memberService from '../service/member-service.mjs';
import qaStack from '../qa/stack-clinical-entry.mjs';
import {qaPricePaymentEnvironment,qaPricePaymentRoutes,QA_PRICE_ORIGIN} from '../qa/price-payment-transport.mjs';
import {qaStatementReference} from '../qa/statement-transport.mjs';
const lifecycle='20000000-0000-4000-8000-000000000001',dbId='00000000-0000-4000-8000-000000000031';
const j=async(response,status=200)=>{const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;};

// Retained approved plan/agreement fixtures are the output of the existing
// lifecycle tests. All checkout creation and receipts below use native HTTP
// member handlers and the durable QA transport, never direct ledger writes.
async function setup(){
 const f=await fixture(),date=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString(),originalTime=new Date(Date.now()-60000).toISOString();
 Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true',SSTRX_ENVIRONMENT:'synthetic',SSTRX_QA_STACK:'joined-v31',SSTRX_QA_DATABASE_ID:dbId,STRIPE_MODE:'test',SSTRX_QA_REFUNDS_ENABLED:'true',SSTRX_QA_STATEMENTS_ENABLED:'true',SSTRX_QA_PRICE_PAYMENTS_ENABLED:'true'});
 f.sql.exec('CREATE TABLE sstrx_qa_environment(environment TEXT,database_id TEXT,synthetic_only INTEGER)');
 f.sql.prepare('INSERT INTO sstrx_qa_environment VALUES(?,?,1)').run('joined-v31',dbId);
 await ensurePlatformSchema(f.DB);await ensureRefundSchema(f.DB);await ensureLifecycleSchema(f.DB);
 f.sql.prepare("INSERT INTO medicine_variants(id,medicine_id,strength_label,selling_price_pence,status,updated_at,sellable,availability_state) VALUES(9911,1,'TEST',10000,'available',?,1,'available')").run(date);
 f.sql.prepare("UPDATE medicine_orders SET variant_id=9911,medicine_name='TEST-NOT-FOR-SUPPLY',total_pence=10000,unit_price_pence=10000 WHERE order_number=?").run(ORDER);
 f.sql.prepare('INSERT INTO rx_economics VALUES(?,1,?,?)').run(ORDER,JSON.stringify(economicsTerms({model:'shift_collects',supplierId:'TEST',sellingPence:10000,outputTaxPence:0,taxTreatment:'TEST',approvalReference:'TEST-TERMS',costSourceReference:'TEST-COSTS'})),date);
 f.sql.prepare("INSERT INTO rx_finance_entries VALUES('TEST-ORIGINAL',?,'TEST-ORIGINAL','member_payment',10000,'GBP','TEST-VERIFIED-ORIGINAL',?,?)").run(ORDER,originalTime,originalTime);
 const baseline=f.sql.prepare('SELECT id,event_reference,kind,amount_pence,currency,source_reference FROM rx_finance_entries WHERE order_number=? ORDER BY id').all(ORDER);
 const plan={lifecycle_id:lifecycle,record_id:RECORD,order_number:ORDER,member_id:42,variant_id:9911,packs:2,mode:'collect_difference',member_total_pence:15000,delta_pence:5000,baseline_json:JSON.stringify(baseline),catalogue_json:JSON.stringify(f.sql.prepare('SELECT * FROM medicine_variants WHERE id=9911').get()),terms_reference:'TEST-TERMS',approval_reference:'TEST-APPROVED-PRICE',cost_reference:'TEST-COST',discount_reference:'TEST-PRICE-DECISION',approved_by:1,expires_at:expires,created_at:date,version:1};
 f.sql.prepare('INSERT INTO rx_lifecycle_price_plans('+Object.keys(plan).join(',')+') VALUES('+Object.keys(plan).map(()=>'?').join(',')+')').run(...Object.values(plan));
 const work={id:lifecycle,record_id:RECORD,order_number:ORDER,member_id:42,prescription_id:'TEST-ORIGINAL-SIGNATURE',prescription_version:1,case_version:1,kind:'amend',state:'proposal_open',version:2,requested_by:3,pharmacy_org_id:'pharmacy-org',finance_owner_id:1,due_at:expires,reason:'TEST amendment',public_message:'TEST agreed replacement',policy_json:'{}',client_reference:'TEST-LIFECYCLE',payload_digest:'a'.repeat(64),created_at:date,updated_at:date};
 f.sql.prepare('INSERT INTO rx_prescription_lifecycle('+Object.keys(work).join(',')+') VALUES('+Object.keys(work).map(()=>'?').join(',')+')').run(...Object.values(work));
 f.sql.prepare('INSERT INTO clinical_prescription_requests VALUES(?,?,42,3,?,?)').run(RECORD,ORDER,JSON.stringify({version:3,status:'accepted',expiresAt:expires,quote:{pricePlan:{lifecycleId:lifecycle,version:1}}}),date);
 const request=(path,body,extra={})=>new Request('https://api.shiftsometimber.co.uk'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:'sst_session='+f.memberToken,Origin:'https://my-timber.app',...body===undefined?{}:{'Content-Type':'application/json'},...extra.headers},body:body===undefined?undefined:JSON.stringify(body)});
 const call=(path,body,extra={})=>qaStack.fetch(request(path,body,extra),f.env,{});
 const adjustment='/v1/member/clinical-records/'+RECORD+'/price-adjustments/'+lifecycle;
 const create=()=>call(adjustment,{version:3,agreed:true});
 const payment=()=>f.sql.prepare('SELECT * FROM rx_lifecycle_payments ORDER BY rowid DESC LIMIT 1').get();
 const checkout=(id=payment().id)=>'/v1/member/clinical-records/qa-price-checkout/'+id;
 const counts=()=>({provider:f.sql.prepare('SELECT COUNT(*) n FROM qa_simulated_price_checkouts').get().n,outcomes:f.sql.prepare('SELECT COUNT(*) n FROM qa_simulated_price_outcomes').get().n,native:f.sql.prepare('SELECT COUNT(*) n FROM rx_lifecycle_payment_receipts').get().n,payments:f.sql.prepare("SELECT COUNT(*) n FROM rx_finance_entries WHERE event_reference LIKE 'price-payment:%'").get().n,increases:f.sql.prepare("SELECT COUNT(*) n FROM rx_finance_entries WHERE event_reference LIKE 'price-increase:%'").get().n});
 return {...f,plan,request,call,adjustment,create,payment,checkout,counts};
}

test('Owned native additional-payment checkout records one signed TEST receipt and independently matches the processor statement',async()=>{
 const f=await setup();try{
  assert.equal((await priceSettlement(f.env,f.plan)).settled,false);
  const opened=await j(await f.create());assert.equal(opened.state,'checkout_open');
  assert.equal(opened.url,QA_PRICE_ORIGIN+'/member/qa-price-checkout/'+f.payment().id);
  const page=await f.call('/member/qa-price-checkout/'+f.payment().id);assert.equal(page.status,200);assert.match(await page.text(),/NO REAL MONEY/);
  const before=await j(await f.call(f.checkout()));assert.equal(before.outcome,'open');assert.equal(before.memberId,42);
  const done=await j(await f.call(f.checkout(),{action:'complete'}));assert.equal(done.state,'paid');assert.equal(done.moneyMoved,false);
  assert.deepEqual(f.counts(),{provider:1,outcomes:1,native:1,payments:1,increases:1});
  assert.equal((await priceSettlement(f.env,f.plan)).settled,true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medicine_orders').get().n,1);
  assert.equal(f.sql.prepare("SELECT amount_pence FROM rx_finance_entries WHERE id='TEST-ORIGINAL'").get().amount_pence,10000);
  await j(await f.call(f.checkout(),{action:'reconcile'}));assert.deepEqual(f.counts(),{provider:1,outcomes:1,native:1,payments:1,increases:1});
  for(const table of ['qa_simulated_price_checkouts','qa_simulated_price_outcomes'])assert.throws(()=>f.sql.exec('DELETE FROM '+table),/immutable_qa_price_receipt/);
  await delay(2);
  const fromAt=new Date(Date.now()-30000).toISOString(),toAt=new Date().toISOString(),command={sourceReference:qaStatementReference(fromAt,toAt),fromAt,toAt,orderReference:'ALL',ownerUserId:1,dueAt:new Date(Date.now()+3600000).toISOString()};
  const reconciliation=await qaStack.fetch(new Request('https://api.shiftsometimber.co.uk/v1/hq/clinical/platform/reconciliation',{method:'POST',headers:{Cookie:'sst_hq_session='+f.tokens[1],Origin:'https://hq.shiftsometimber.co.uk','Content-Type':'application/json'},body:JSON.stringify(command)}),f.env,{});
  const matched=await j(reconciliation);assert.equal(matched.state,'matched');assert.equal(matched.variancePence,0);
  const statement=JSON.parse(f.sql.prepare('SELECT statement_json FROM qa_simulated_statements').get().statement_json);assert.equal(statement.netReceivedPence,5000);assert.equal(statement.additionalCaptureCount,1);assert.equal(statement.additionalPaymentRefundsSupported,true);
 }finally{f.close();}
});

test('Concurrent member taps create one attempt; a lost creation response stays UNKNOWN and recovers only the retained checkout',async()=>{
 const f=await setup();try{
  const env=await qaPricePaymentEnvironment(f.env),native=env.LIFECYCLE_PAYMENT_TEST_TRANSPORT;let posts=0;
  env.LIFECYCLE_PAYMENT_TEST_TRANSPORT={qaContract:native.qaContract,async fetch(req){posts++;await native.fetch(req);throw Error('TEST response lost after durable provider acceptance');}};
  const first=await j(await memberService.fetch(f.request(f.adjustment,{version:3,agreed:true}),env));assert.equal(first.state,'unknown');
  const retries=await Promise.all([memberService.fetch(f.request(f.adjustment,{version:3,agreed:true}),env),memberService.fetch(f.request(f.adjustment,{version:3,agreed:true}),env)]);
  for(const r of retries){const value=await j(r);assert.equal(value.state,'unknown');assert.equal(value.reconciliationRequired,true);}
  assert.equal(posts,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_lifecycle_payments').get().n,1);
  const recovered=await qaPricePaymentRoutes(f.request('/member/qa-price-checkout/lifecycle/'+lifecycle),env);assert.equal(recovered.status,303);assert.equal(recovered.headers.get('Location'),'/member/qa-price-checkout/'+f.payment().id);
  const completed=await j(await qaPricePaymentRoutes(f.request(f.checkout(),{action:'complete'}),env));assert.equal(completed.state,'paid');
  assert.deepEqual(f.counts(),{provider:1,outcomes:1,native:1,payments:1,increases:1});assert.equal(posts,1);
 }finally{f.close();}
});

test('Lost native receipt processing preserves the selected provider outcome and reconciles without another payment',async()=>{
 const f=await setup();try{
  await j(await f.create());const batch=f.DB.batch.bind(f.DB);let failReceipt=true;
  f.DB.batch=async statements=>{if(failReceipt&&statements.some(s=>s.sql.includes('INSERT INTO rx_lifecycle_payment_receipts'))){failReceipt=false;throw Error('TEST native receipt unavailable');}return batch(statements);};
  await j(await f.call(f.checkout(),{action:'complete'}),503);
  assert.deepEqual(f.counts(),{provider:1,outcomes:1,native:0,payments:0,increases:0});
  const held=await j(await f.call(f.checkout()));assert.equal(held.receiptPending,true);
  await j(await f.call(f.checkout(),{action:'expire'}),409);
  await j(await f.call(f.checkout(),{action:'reconcile'}));
  assert.deepEqual(f.counts(),{provider:1,outcomes:1,native:1,payments:1,increases:1});
 }finally{f.close();}
});

test('Wrong member, revoked session, wrong origin and account changes cannot inspect or complete a retained TEST payment',async()=>{
 const f=await setup();try{
  await j(await f.create());
  f.sql.prepare('INSERT INTO users(id,email) VALUES(99,?)').run('other@example.test');f.sql.prepare('INSERT INTO user_auth VALUES(99,1)').run();
  const token='other-fictional-session',hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
  f.sql.prepare('INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES(99,?,?)').run(hash,new Date(Date.now()+3600000).toISOString());
  await j(await f.call(f.checkout(),undefined,{headers:{Cookie:'sst_session='+token}}),404);
  await j(await f.call(f.checkout(),{action:'complete'},{headers:{Origin:'https://outside.example'}}),403);
  await j(await f.call(f.checkout(),{action:'complete'},{headers:{'X-My-Timber-Expected-Account':'99'}}),409);
  f.sql.prepare('UPDATE user_sessions SET revoked_at=? WHERE user_id=42').run(new Date().toISOString());
  await j(await f.call(f.checkout(),{action:'complete'}),401);
  assert.deepEqual(f.counts(),{provider:1,outcomes:0,native:0,payments:0,increases:0});
 }finally{f.close();}
});

test('QA source admission and exact private-session contract reject live credentials, unmarked stores and arbitrary checkout URLs',async()=>{
 const f=await setup();try{
  for(const change of [{SSTRX_ENVIRONMENT:'production'},{STRIPE_MODE:'live'},{STRIPE_SECRET_KEY:'sk_test_NOT_AN_ACCOUNT'},{SSTRX_QA_DATABASE_ID:'88f40aed-cb23-4372-8c94-8a73f48bc847'},{SSTRX_PRICE_PAYMENT_COMMISSIONING:'{}'}])await assert.rejects(qaPricePaymentEnvironment({...f.env,...change}),/isolated_qa_price_transport/);
  await j(await f.create());
  const source=JSON.parse(f.sql.prepare('SELECT source_json FROM rx_lifecycle_payment_sources').get().source_json),session=JSON.parse(f.sql.prepare('SELECT session_json FROM qa_simulated_price_checkouts').get().session_json),payment=f.payment();
  const expected={paymentId:payment.id,lifecycleId:lifecycle,orderReference:ORDER,amount:5000,expires:payment.expires_at};
  assert.equal(priceSessionMatches(session,source,expected),true);
  for(const url of ['https://outside.example/member/qa-price-checkout/'+payment.id,session.url+'?copy=1',session.url+'#copy','https://checkout.stripe.com/pretend'])assert.equal(priceSessionMatches({...session,url},source,expected),false);
  await j(await f.call('/v1/hq/clinical/platform/processor/adjustments',{}),403);
  const bound=await qaPricePaymentEnvironment(f.env);
  await j(await stripePriceWebhook(new Request('https://api.shiftsometimber.co.uk/v1/hq/clinical/platform/processor/adjustments',{method:'POST',body:'{}'}),bound),401);
  assert.deepEqual(f.counts(),{provider:1,outcomes:0,native:0,payments:0,increases:0});
 }finally{f.close();}
});

test('Simultaneous native checkout requests retain one payment intent and one durable provider session',async()=>{
 const f=await setup();try{
  const responses=await Promise.all([f.create(),f.create()]);let opened=0;
  for(const response of responses){
   const body=await response.json();assert.ok([200,409].includes(response.status),JSON.stringify(body));
   if(response.status===200){
    // A second request may observe the already-persisted outbound intent while
    // its first request is still awaiting the provider's creation response.
    assert.ok(['submitting','checkout_open'].includes(body.state),JSON.stringify(body));
    if(body.state==='checkout_open')opened++;else {assert.equal(body.url,null);assert.equal(body.reconciliationRequired,false);}
   }
  }
  assert.ok(opened>0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_lifecycle_payments').get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_lifecycle_payment_sources').get().n,1);
  const retained=f.payment(),provider=f.sql.prepare('SELECT * FROM qa_simulated_price_checkouts').get(),session=JSON.parse(provider.session_json);
  assert.equal(retained.state,'checkout_open');assert.equal(retained.session_id,provider.id);assert.equal(retained.checkout_url,session.url);
  const refreshed=await j(await f.create());assert.equal(refreshed.state,'checkout_open');assert.equal(refreshed.url,retained.checkout_url);
  assert.deepEqual(f.counts(),{provider:1,outcomes:0,native:0,payments:0,increases:0});
 }finally{f.close();}
});

test('A confirmed failed TEST checkout permits only an explicit fresh retry and never reuses its retained outcome',async()=>{
 const f=await setup();try{
  await j(await f.create());const original=f.payment().id;
  await j(await f.call(f.checkout(),{action:'fail'}));assert.equal(f.payment().state,'failed');
  const held=await j(await f.create());assert.equal(held.state,'failed');assert.equal(f.payment().id,original);
  await j(await f.call(f.checkout(),{action:'complete'}),409);
  await j(await f.call(f.adjustment,{version:3,agreed:true,retryFailedPayment:true}));
  assert.notEqual(f.payment().id,original);await j(await f.call(f.checkout(),{action:'complete'}));
  assert.deepEqual(f.counts(),{provider:2,outcomes:2,native:2,payments:1,increases:1});
  assert.equal((await priceSettlement(f.env,f.plan)).settled,true);
 }finally{f.close();}
});
