import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {wrapDatabase} from './database.mjs';
import {qaCommerceFetch,qaCompleteCheckout,QA_PAYMENT_KEY,QA_CALLBACK_KEY,QA_PHARMACY} from '../qa/commerce-transport.mjs';
import {fetch as deniedNetwork} from '../qa/commerce-network-deny.mjs';

function fixture(){
 const sql=new DatabaseSync(':memory:'),{DB}=wrapDatabase(sql),id='00000000-0000-4000-8000-000000000031';
 sql.exec("CREATE TABLE sstrx_qa_environment(environment TEXT,database_id TEXT,synthetic_only INTEGER);CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT);CREATE TABLE medicine_orders(order_number TEXT PRIMARY KEY,user_id INTEGER,email TEXT,variant_id INTEGER,medicine_name TEXT,total_pence INTEGER,currency TEXT,status TEXT);");
 sql.prepare('INSERT INTO sstrx_qa_environment VALUES(?,?,1)').run('joined-v31',id);sql.exec("INSERT INTO users VALUES(1,'member@example.test'),(2,'other@example.test');INSERT INTO medicine_orders VALUES('TEST-ORDER',1,'member@example.test',9911,'TEST-NOT-FOR-SUPPLY',16900,'gbp','checkout_open');");
 const env={DB,SSTRX_ENVIRONMENT:'synthetic',SSTRX_QA_STACK:'joined-v31',SSTRX_QA_DATABASE_ID:id,SSTRX_QA_COMMERCE_ENABLED:'true',STRIPE_MODE:'test',STRIPE_SECRET_KEY:QA_PAYMENT_KEY,STRIPE_WEBHOOK_SECRET:QA_CALLBACK_KEY,PHARMACY_CLINICAL_INTAKE_URL:QA_PHARMACY,PHARMACY_INTEGRATION_SECRET:'FICTIONAL_QA_NO_PROVIDER_ACCOUNT'};
 const form=()=>new URLSearchParams({'metadata[order_number]':'TEST-ORDER','metadata[order_type]':'medicine','metadata[user_id]':'1','client_reference_id':'TEST-ORDER','line_items[0][price_data][unit_amount]':'16900','line_items[0][price_data][currency]':'gbp'});
 const create=body=>qaCommerceFetch(env,'https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{'Idempotency-Key':'TEST-ORDER'},body:String(body||form())});
 return{sql,env,form,create};
}
test('QA commerce refuses production/mixed credentials and unmarked databases without creating provider tables or using the network',async()=>{
 const f=fixture();try{
  for(const change of [{SSTRX_ENVIRONMENT:'production'},{STRIPE_MODE:'live'},{SSTRX_QA_COMMERCE_ENABLED:'false'},{SSTRX_QA_DATABASE_ID:'88f40aed-cb23-4372-8c94-8a73f48bc847'},{STRIPE_SECRET_KEY:'sk_test_REAL_LOOKALIKE'}])await assert.rejects(qaCommerceFetch({...f.env,...change},'https://api.stripe.com/v1/checkout/sessions',{method:'POST'}),/isolated_commerce/);
  f.sql.exec('DELETE FROM sstrx_qa_environment');await assert.rejects(f.create(),/isolated_commerce/);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'qa_simulated_%'").get().n,0);assert.throws(()=>deniedNetwork('https://anywhere.invalid'),/external_network_disabled/);
 }finally{f.sql.close()}
});
test('QA creates one amount-bound simulated session on the existing order and rejects changed or non-fictional requests',async()=>{
 const f=fixture();try{
  const first=await(await f.create()).json(),second=await(await f.create()).json();assert.equal(first.id,second.id);assert.match(first.url,/^https:\/\/my-qa\.sstrx\.co\.uk\/qa\/checkout\/cs_test_QA_[a-f0-9]{32}$/);assert.equal(first.livemode,false);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM qa_simulated_checkouts').get().n,1);assert.equal(f.sql.prepare('SELECT status FROM medicine_orders').get().status,'checkout_open');
  const changed=f.form();changed.set('line_items[0][price_data][unit_amount]','1');assert.equal((await f.create(changed)).status,403);f.sql.exec("UPDATE users SET email='not-fictional@real.example' WHERE id=1");assert.equal((await f.create()).status,403);
  await assert.rejects(qaCommerceFetch(f.env,'https://bank.example.invalid/charges'),/not_in_qa_contract/);
 }finally{f.sql.close()}
});
test('QA intake stores only a receipt/digest, deduplicates it and refuses real-looking contact details or a changed submission',async()=>{
 const f=fixture();try{
  const form=new FormData();for(const[k,v]of Object.entries({memberReference:'1',variantId:'9911',patientFirstName:'TEST Member',patientAddress1:'TEST ADDRESS',patientPhone:'07700900000',gpPractice:'TEST ONLY',weightKg:'110'}))form.set(k,v);const reference='SCI-00000000-0000-4000-8000-000000000032';const send=()=>qaCommerceFetch(f.env,QA_PHARMACY,{method:'POST',headers:{'Idempotency-Key':reference},body:form});
  const one=await(await send()).json(),two=await(await send()).json();assert.deepEqual(one,two);assert.equal(one.patientReference,'TEST-PATIENT-1');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM qa_simulated_transport_events').get().n,1);assert.ok(!f.sql.prepare('SELECT response_json FROM qa_simulated_transport_events').get().response_json.includes('ADDRESS'));
  form.set('weightKg','120');assert.equal((await send()).status,409);form.set('patientPhone','07123456789');assert.equal((await send()).status,403);
 }finally{f.sql.close()}
});
test('QA completion requires native member ownership and same-origin action and rejects client-supplied financial fields',async()=>{
 const f=fixture();try{
  const session=await(await f.create()).json(),url='https://api.shiftsometimber.co.uk/v1/qa/checkout/'+session.id;let nativeCalls=0;const routes=()=>{nativeCalls++;return Response.json({ok:true})};
  const request=(body,origin='https://shiftsometimber.co.uk')=>new Request(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await qaCompleteCheckout(request({action:'complete'}),f.env,{},routes,async()=>null)).status,401);assert.equal((await qaCompleteCheckout(request({action:'complete'}),f.env,{},routes,async()=>({id:2}))).status,404);assert.equal((await qaCompleteCheckout(request({action:'complete'},'https://foreign.invalid'),f.env,{},routes,async()=>({id:1}))).status,403);assert.equal((await qaCompleteCheckout(request({action:'complete',amount:1}),f.env,{},routes,async()=>({id:1}))).status,400);assert.equal(nativeCalls,0);
 }finally{f.sql.close()}
});
test('QA unknown callback stays on the same receipt, rejects a changed outcome and records completion once',async()=>{
 const f=fixture();try{
  const session=await(await f.create()).json(),url='https://api.shiftsometimber.co.uk/v1/qa/checkout/'+session.id,ids=[];let fail=true;
  const native=async request=>{const e=await request.json();ids.push(e.id);assert.equal(e.livemode,false);assert.equal(e.data.object.metadata.order_number,'TEST-ORDER');assert.equal(e.data.object.amount_total,16900);assert.match(request.headers.get('Stripe-Signature'),/^t=\d+,v1=[a-f0-9]{64}$/);if(fail)return Response.json({error:'FICTIONAL transient callback failure'},{status:503});f.sql.exec("UPDATE medicine_orders SET status='paid' WHERE order_number='TEST-ORDER'");return Response.json({ok:true})};
  const call=action=>qaCompleteCheckout(new Request(url,{method:'POST',headers:{Origin:'https://shiftsometimber.co.uk','Content-Type':'application/json'},body:JSON.stringify({action})}),f.env,{},native,async()=>({id:1}));
  assert.equal((await call('complete')).status,503);assert.equal(f.sql.prepare('SELECT outcome FROM qa_simulated_checkouts').get().outcome,'processing');assert.equal((await call('expire')).status,409);fail=false;assert.equal((await call('complete')).status,200);assert.equal((await(await call('complete')).json()).duplicate,true);assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(f.sql.prepare('SELECT outcome FROM qa_simulated_checkouts').get().outcome,'paid');
 }finally{f.sql.close()}
});
