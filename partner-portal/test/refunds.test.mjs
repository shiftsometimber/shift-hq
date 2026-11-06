import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fixture,ORDER} from './fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {ensureRefundSchema,applyRefundReceipt,stripeRefundWebhook,memberRefunds} from '../platform/refunds.mjs';
import {digest,economicsTerms,reconcileEconomics} from '../platform/domain.mjs';
const json=async(r,status=200)=>{const b=await r.json();assert.equal(r.status,status,JSON.stringify(b));return b};
async function retainFinance(f,name){if(!process.env.SSTRX_QA_EVIDENCE_DIR)return;const dir=path.join(process.env.SSTRX_QA_EVIDENCE_DIR,'finance');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,name+'.json'),JSON.stringify({scope:'SYNTHETIC RECEIPTS ONLY; no actual payment or refund',member:await memberRefunds(f.env,42),refunds:f.sql.prepare('SELECT * FROM rx_refunds').all(),processorReceipts:f.sql.prepare('SELECT * FROM rx_refund_receipts').all(),events:f.sql.prepare('SELECT * FROM rx_refund_events ORDER BY version').all(),ledger:f.sql.prepare('SELECT * FROM rx_finance_entries ORDER BY created_at').all(),exceptions:f.sql.prepare('SELECT * FROM rx_finance_exceptions').all(),economics:reconcileEconomics(f.terms,f.sql.prepare('SELECT * FROM rx_finance_entries').all())},null,2));}
async function setup(){
 const f=await fixture();Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true',SSTRX_ENVIRONMENT:'synthetic',SSTRX_REFUND_TEST_EXECUTION_ENABLED:'true'});await ensurePlatformSchema(f.DB);await ensureRefundSchema(f.DB);
 f.sql.prepare("UPDATE medicine_orders SET stripe_payment_intent_id='pi_FICTIONAL_ONLY',unit_price_pence=10000,total_pence=10000 WHERE order_number=?").run(ORDER);
 const total=f.sql.prepare('SELECT total_pence FROM medicine_orders WHERE order_number=?').get(ORDER).total_pence;
 const terms=economicsTerms({model:'shift_collects',supplierId:'FICTIONAL-SUPPLIER',sellingPence:total,outputTaxPence:0,taxTreatment:'TEST TERMS',approvalReference:'TEST-ACCEPTED-TERMS',costSourceReference:'TEST-COSTS'});
 f.sql.prepare('INSERT INTO rx_economics VALUES(?,1,?,?)').run(ORDER,JSON.stringify(terms),new Date().toISOString());
 f.sql.prepare("INSERT INTO rx_finance_entries VALUES('test-payment',?,'test-payment','member_payment',?,'GBP','TEST-PROCESSOR',?,?)").run(ORDER,total,new Date().toISOString(),new Date().toISOString());
 const call=(path,body,actor=1)=>f.hq('/platform/'+path,actor,body);
 async function create(extra={}){return json(await call('refunds',{orderReference:ORDER,amountPence:1000,reason:'FICTIONAL cancellation',termsReference:'TEST-ACCEPTED-TERMS',clientReference:crypto.randomUUID(),...extra}));}
 async function approve(r,actor=1){return json(await call('refunds/'+r.id+'/approve',{version:r.version,approvalReference:'TEST-FINANCE-APPROVAL',exceptionDueAt:new Date(Date.now()+3600000).toISOString()},actor));}
 return {...f,total,terms,call,create,approve};
}
function transport(status='pending'){return {calls:[],async fetch(req){this.calls.push({key:req.headers.get('Idempotency-Key'),body:await req.text()});return Response.json({id:'re_FICTIONAL_1',amount:1000,currency:'gbp',payment_intent:'pi_FICTIONAL_ONLY',status});}};}
const receipt=(id,status='succeeded',created=Math.floor(Date.now()/1000))=>({id,type:'refund.updated',livemode:false,created,data:{object:{id:'re_FICTIONAL_1',amount:1000,currency:'gbp',payment_intent:'pi_FICTIONAL_ONLY',status}}});
test('RX-RF1 requested and submitted refunds cannot be shown as completed; verified completion updates owned member view and ledger once',async()=>{
 const f=await setup();try{
  const t=transport();f.env.REFUND_TEST_TRANSPORT=t;let r=await f.create();assert.equal(r.state,'requested');r=await f.approve(r);r=await json(await f.call('refunds/'+r.id+'/submit',{version:r.version}));assert.equal(r.state,'submitted');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_finance_entries WHERE kind='refund'").get().n,0);
  assert.equal((await memberRefunds(f.env,42))[0].state,'submitted');assert.deepEqual(await memberRefunds(f.env,99),[]);
  await applyRefundReceipt(f.env,receipt('evt_FICTIONAL_1'),'verified_stripe_webhook');assert.equal((await memberRefunds(f.env,42))[0].state,'completed');
  assert.deepEqual(await applyRefundReceipt(f.env,receipt('evt_FICTIONAL_1'),'verified_stripe_webhook'),{duplicate:true});assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_finance_entries WHERE kind='refund'").get().n,1);
  await assert.rejects(applyRefundReceipt(f.env,{...receipt('evt_FICTIONAL_1'),created:1},'verified_stripe_webhook'),/processor_event_conflict/);
  await retainFinance(f,'verified-completed-refund');
 }finally{f.close();}
});
test('RX-RF2 unknown processor outcome retries with the original key and never issues a second financial instruction',async()=>{
 const f=await setup();try{
  const t=transport();let count=0;const bound=t.fetch.bind(t);t.fetch=async q=>{if(count++===0){t.calls.push({key:q.headers.get('Idempotency-Key')});throw Error('TEST network lost after acceptance');}return bound(q)};f.env.REFUND_TEST_TRANSPORT=t;
  let r=await f.approve(await f.create());r=await json(await f.call('refunds/'+r.id+'/submit',{version:r.version}));assert.equal(r.state,'unknown');r=await json(await f.call('refunds/'+r.id+'/submit',{version:r.version}));assert.equal(r.state,'submitted');assert.equal(t.calls.length,2);assert.equal(t.calls[0].key,t.calls[1].key);
 }finally{f.close();}
});
test('RX-RF3 over-refunding, changed idempotency payload, stale approval and unauthorised roles are blocked',async()=>{
 const f=await setup();try{
  const clientReference=crypto.randomUUID(),r=await f.create({amountPence:f.total,clientReference});const replay=await f.create({amountPence:f.total,clientReference});assert(replay.duplicate);assert.equal(replay.id,r.id);
  await json(await f.call('refunds',{orderReference:ORDER,amountPence:f.total-1,reason:'FICTIONAL cancellation',termsReference:'TEST-ACCEPTED-TERMS',clientReference}),409);
  await json(await f.call('refunds',{orderReference:ORDER,amountPence:1,reason:'TEST',termsReference:'TEST',clientReference:crypto.randomUUID()}),409);
  await json(await f.call('refunds',undefined,3),403);await json(await f.call('refunds',undefined,4),403);
  await f.approve(r);await json(await f.call('refunds/'+r.id+'/approve',{version:1,approvalReference:'TEST',exceptionDueAt:new Date(Date.now()+3600000).toISOString()}),409);
 }finally{f.close();}
});
test('RX-RF4 a bank return after success reverses contribution and creates an owned exception with the authorised deadline',async()=>{
 const f=await setup();try{
  f.env.REFUND_TEST_TRANSPORT=transport('succeeded');let r=await f.approve(await f.create());await json(await f.call('refunds/'+r.id+'/submit',{version:r.version}));
  await applyRefundReceipt(f.env,receipt('evt_FICTIONAL_RETURN','failed',Math.floor(Date.now()/1000)+1),'verified_stripe_webhook');
  assert.equal((await memberRefunds(f.env,42))[0].state,'failed');const exception=f.sql.prepare("SELECT * FROM rx_finance_exceptions WHERE kind='refund_failed'").get();assert.equal(exception.owner_user_id,1);assert.equal(exception.state,'open');assert(exception.due_at);
  const entries=f.sql.prepare('SELECT * FROM rx_finance_entries').all();assert.equal(reconcileEconomics(f.terms,entries).refundPence,0);
  assert.deepEqual(await applyRefundReceipt(f.env,receipt('evt_FICTIONAL_OLD','succeeded',Math.floor(Date.now()/1000)),'verified_stripe_webhook'),{stale:true});
  await retainFinance(f,'refund-returned-and-reversed');
 }finally{f.close();}
});
test('RX-RF5 processor signature and environment gates prevent unsigned or live callbacks and real refund execution',async()=>{
 const f=await setup();try{
  f.env.STRIPE_REFUND_WEBHOOK_SECRET='FICTIONAL-WEBHOOK-SECRET';const u='https://api.shiftsometimber.co.uk/v1/hq/clinical/platform/processor/refunds';
  await json(await stripeRefundWebhook(new Request(u,{method:'POST',body:JSON.stringify(receipt('evt_UNSIGNED'))}),f.env),401);
  const event={...receipt('evt_LIVE'),livemode:true},raw=JSON.stringify(event),ts=Math.floor(Date.now()/1000),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(f.env.STRIPE_REFUND_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ts+'.'+raw))).toString('hex');
  await json(await stripeRefundWebhook(new Request(u,{method:'POST',headers:{'Stripe-Signature':`t=${ts},v1=${sig}`},body:raw}),f.env),403);
  let r=await f.approve(await f.create());f.env.SSTRX_ENVIRONMENT='production';await json(await f.call('refunds/'+r.id+'/submit',{version:r.version}),503);assert.equal(f.sql.prepare('SELECT state FROM rx_refunds').get().state,'approved');
 }finally{f.close();}
});
test('RX-RF6 reconciliation derives its ledger total and leaves an owned variance rather than trusting client totals',async()=>{
 const f=await setup();try{
  const b={sourceReference:'TEST-STATEMENT',fromAt:'2000-01-01T00:00:00Z',toAt:'2099-01-01T00:00:00Z',ownerUserId:1,dueAt:new Date(Date.now()+3600000).toISOString(),ledgerTotalPence:999,processorTotalPence:999};
  f.env.STATEMENT_TEST_TRANSPORT={fetch:async()=>Response.json({reference:b.sourceReference,fromAt:b.fromAt,toAt:b.toAt,currency:'GBP',netReceivedPence:f.total-300})};
  const result=await json(await f.call('reconciliation',b));assert.equal(result.variancePence,-300);assert.equal(result.state,'variance');assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_finance_exceptions WHERE kind='reconciliation_variance' AND owner_user_id=1").get().n,1);
 }finally{f.close();}
});
test('RX-RF7 a receipt racing another refund version cannot leave a receipt, event or refund ledger entry behind',async()=>{
 const f=await setup();try{
  f.env.REFUND_TEST_TRANSPORT=transport();let r=await f.approve(await f.create());r=await json(await f.call('refunds/'+r.id+'/submit',{version:r.version}));const eventsBefore=f.sql.prepare('SELECT COUNT(*) n FROM rx_refund_events').get().n;
  const batch=f.DB.batch.bind(f.DB);f.DB.batch=async commands=>{f.sql.prepare('UPDATE rx_refunds SET version=version+1 WHERE id=?').run(r.id);return batch(commands)};
  await assert.rejects(applyRefundReceipt(f.env,receipt('evt_FICTIONAL_RACE'),'verified_stripe_webhook'),/refund_receipt_race/);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_finance_entries WHERE kind='refund'").get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_refund_receipts').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_refund_events').get().n,eventsBefore);
 }finally{f.close();}
});
