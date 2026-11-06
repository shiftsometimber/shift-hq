import test from 'node:test';
import assert from 'node:assert/strict';
import {fetch as sink} from '../qa/simulated-fetch.mjs';
import {confirmSimulatedCheckout,simulatedCommerceEnv} from '../qa/simulated-commerce.mjs';
test('private sink rejects real identities, real keys and every unknown transport without network fallback',async()=>{
 let external=0;const original=globalThis.fetch;globalThis.fetch=async()=>{external++;throw Error('network')};
 try{
  const headers={authorization:'Bearer sk_test_FICTIONAL_PRIVATE_QA_NO_ACCOUNT','Idempotency-Key':'SST-20261106-ABCDEF12'},form=new URLSearchParams({'customer_email':'fictional@example.test','metadata[order_number]':'SST-20261106-ABCDEF12'});
  const call=()=>sink('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers,body:form});
  const a=await (await call()).json(),b=await (await call()).json();assert.deepEqual(a,b);assert.match(a.id,/^cs_test_QA_[a-f0-9]{64}$/);assert.equal(new URL(a.url).origin,'https://my-qa.sstrx.co.uk');
  form.set('customer_email','person@real.example');await assert.rejects(call,/identity/);form.set('customer_email','fictional@example.test');headers.authorization='Bearer sk_live_FORBIDDEN';await assert.rejects(call,/key/);
  for(const url of ['https://api.stripe.com/v1/refunds','https://unknown.example/intake','https://pharmacy.example.test/intake?redirect=1'])await assert.rejects(()=>sink(url,{method:'POST'}));assert.equal(external,0);
 }finally{globalThis.fetch=original;}
});
test('fictional pharmacy receipt is stable, explicitly simulated and bound to native submission identity',async()=>{
 const id='SCI-00000000-0000-4000-8000-000000000031',form=new FormData();form.set('patientEmail','member@example.test');form.set('memberReference','1');form.set('clientReference',id);
 const call=()=>sink('https://pharmacy.example.test/intake',{method:'POST',headers:{authorization:'Bearer FICTIONAL-QA-PHARMACY-NO-TRANSPORT','Idempotency-Key':id},body:form});
 const a=await (await call()).json();assert.equal(a.simulated,true);assert.equal(a.verified,true);assert.deepEqual(a,await (await call()).json());form.set('patientEmail','person@real.example');await assert.rejects(call,/identity/);
});
test('payment confirmation requires native ownership, exact origin and explicit fictional agreement before any callback',async()=>{
 const id='cs_test_QA_'+'a'.repeat(64),req=(body,origin='https://shiftsometimber.co.uk')=>new Request('https://api.shiftsometimber.co.uk/v1/commerce/qa-confirm-checkout',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:'sst_session=fictional'},body:JSON.stringify(body)});let calls=[];
 const denied=async r=>{calls.push(new URL(r.url).pathname);return Response.json({error:'order_not_found'},{status:404})};
 assert.equal((await confirmSimulatedCheckout(req({sessionId:id,confirmFictionalPayment:true}),{}, {},denied)).status,404);assert.deepEqual(calls,['/v1/commerce/medicine-order-status']);calls=[];
 for(const r of [req({sessionId:id}),req({sessionId:id,confirmFictionalPayment:true},'https://foreign.example')])assert.ok((await confirmSimulatedCheckout(r,{}, {},denied)).status>=400);assert.equal(calls.length,0);
 const native=async r=>{calls.push(new URL(r.url).pathname);if(calls.length===1)return Response.json({orderNumber:'SST-20261106-ABCDEF12'});assert.match(r.headers.get('stripe-signature'),/^t=\d+,v1=[a-f0-9]{64}$/);return Response.json({ok:true});};
 const d=await (await confirmSimulatedCheckout(req({sessionId:id,confirmFictionalPayment:true}),simulatedCommerceEnv({}),{},native)).json();assert.equal(d.realPayment,false);assert.equal(d.simulated,true);assert.equal(calls.length,2);
});
