import test from 'node:test';
import assert from 'node:assert/strict';
import {priceProcessor,priceCheckoutExpiry,priceSessionMatches,confirmUncertainPriceSession} from '../platform/price-processor.mjs';
const environment=()=>({SSTRX_ENVIRONMENT:'synthetic',STRIPE_MODE:'test',SSTRX_PRICE_PAYMENTS_ENABLED:'true',SSTRX_PRICE_PAYMENT_MODE:'test',STRIPE_SECRET_KEY:['rk','test','FICTIONALONLY'].join('_'),STRIPE_PRICE_WEBHOOK_SECRET:'whsec_FICTIONAL_ONLY',SSTRX_PRICE_PAYMENT_COMMISSIONING:JSON.stringify({version:1,mode:'test',accountId:'acct_FICTIONAL000',collectionModel:'shift_collects',approvalReference:'FICTIONAL-ONLY',sandboxEvidenceReference:'FICTIONAL-EVIDENCE',expiresAt:new Date(Date.now()+3600000).toISOString()})});
test('price processor cannot be enabled by a credential alone, a mixed environment, an expired policy or a different collection model',()=>{
 assert.throws(()=>priceProcessor({STRIPE_SECRET_KEY:['rk','live','FICTIONALONLY'].join('_')},'shift_collects'),/not_commissioned/);
 for(const change of [{SSTRX_ENVIRONMENT:'production'},{STRIPE_MODE:'live'},{SSTRX_PRICE_PAYMENTS_ENABLED:'false'},{STRIPE_PRICE_WEBHOOK_SECRET:''}])assert.throws(()=>priceProcessor({...environment(),...change},'shift_collects'));
 for(const change of [{expiresAt:'2000-01-01T00:00:00Z'},{sandboxEvidenceReference:''},{accountId:'unbound'},{mode:'live'}]){const env=environment();env.SSTRX_PRICE_PAYMENT_COMMISSIONING=JSON.stringify({...JSON.parse(env.SSTRX_PRICE_PAYMENT_COMMISSIONING),...change});assert.throws(()=>priceProcessor(env,'shift_collects'));}
 assert.throws(()=>priceProcessor(environment(),'pharmacy_collects_commission'),/commissioning_required/);
});
test('synthetic transport is rejected on a production or live-mode environment',()=>{
 for(const env of [{SSTRX_ENVIRONMENT:'production'},{SSTRX_ENVIRONMENT:'synthetic',STRIPE_MODE:'live'}])assert.throws(()=>priceProcessor({...env,LIFECYCLE_PAYMENT_TEST_TRANSPORT:{fetch(){throw Error('Must not be called')}}}),/requires_isolation/);
});
test('Checkout expiry preserves a transport margin above the minimum and never exceeds member or price consent',()=>{
 const at=Date.parse('2026-11-06T10:00:00Z');assert.equal(priceCheckoutExpiry('2026-11-06T11:00:00Z','2026-11-06T10:40:00Z',at),'2026-11-06T10:31:00.000Z');
 for(const until of ['invalid','2026-11-06T10:30:00Z','2026-11-06T10:15:00Z'])assert.throws(()=>priceCheckoutExpiry(until,'2026-11-06T11:00:00Z',at),/needs_renewal/);
});
test('processor response validation binds mode, account, consent source, amount, expiry and owned return URL',()=>{
 const source={kind:'stripe',mode:'test',accountId:'acct_FICTIONAL000',policyVersion:1},expected={paymentId:'payment',lifecycleId:'lifecycle',orderReference:'TEST-ORDER',amount:50,expires:'2026-11-06T11:00:00Z'};
 const session={id:'cs_test_FICTIONAL',object:'checkout.session',mode:'payment',status:'open',livemode:false,client_reference_id:'payment',amount_total:50,currency:'gbp',url:'https://checkout.stripe.com/c/pay/FICTIONAL',expires_at:Date.parse(expected.expires)/1000,metadata:{sst_price_payment_id:'payment',sst_lifecycle_id:'lifecycle',order_reference:'TEST-ORDER',sst_processor_account:source.accountId,sst_processor_policy:'1'}};
 assert.equal(priceSessionMatches(session,source,expected),true);
 for(const change of [{livemode:true},{id:'cs_live_FICTIONAL'},{amount_total:51},{expires_at:1},{url:'https://checkout.stripe.com.evil.invalid/'},{metadata:{...session.metadata,sst_processor_account:'acct_OTHER'}},{metadata:{...session.metadata,sst_processor_policy:'2'}}])assert.equal(priceSessionMatches({...session,...change},source,expected),false);
});
test('an unverified Stripe account stops before Checkout creation and emits no provider error or credential',async()=>{
 const original=globalThis.fetch;const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,method:options.method||'GET'});return Response.json({id:'acct_WRONG'})};
 try{await assert.rejects(priceProcessor(environment(),'shift_collects').verifyAccount(),/price_processor_account_unverified/);assert.deepEqual(calls,[{url:'https://api.stripe.com/v1/account',method:'GET'}]);}finally{globalThis.fetch=original;}
});
test('processor uses Workers-compatible no-follow requests and never accepts redirected account or receipt evidence',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{assert.equal(options.redirect,'manual');calls.push({url,method:options.method||'GET'});return new Response(JSON.stringify({id:'acct_FICTIONAL000'}),{status:302,headers:{Location:'https://private-redirect.invalid/','Content-Type':'application/json'}});};
 try{
  const env=environment(),p=priceProcessor(env,'shift_collects');await assert.rejects(p.verifyAccount(),/price_processor_account_unverified/);
  const r=await p.send(new URLSearchParams({fictional:'only'}),'FICTIONAL-IDEMPOTENT-KEY');assert.equal(r.status,302);assert.equal(r.ok,false);
  await assert.rejects(confirmUncertainPriceSession(env,p.source,{},{}),/price_receipt_account_reconciliation_required/);
  assert.equal(calls.length,3);assert.ok(calls.every(x=>new URL(x.url).origin==='https://api.stripe.com'));assert.equal(calls.filter(x=>x.method==='POST').length,1);
 }finally{globalThis.fetch=original;}
});
