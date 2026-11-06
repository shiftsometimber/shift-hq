// Server-side Checkout transport. Configuration is deployment/commissioning
// evidence, never a client field. No transport or live mode is enabled by default.
import {fail,text} from './domain.mjs';
export const PRICE_STRIPE_VERSION='2026-09-30.endive';
const endpoint='https://api.stripe.com';
export function priceProcessor(env,collectionModel){
 if(env.LIFECYCLE_PAYMENT_TEST_TRANSPORT){
  if(env.SSTRX_ENVIRONMENT!=='synthetic'||env.STRIPE_MODE==='live'||env.SSTRX_PRICE_PAYMENT_MODE==='live')fail(503,'synthetic_price_transport_requires_isolation');
  const qa=env.LIFECYCLE_PAYMENT_TEST_TRANSPORT.qaContract;
  if(qa&&(qa!=='sstrx-durable-price-test-v1'||env.SSTRX_QA_PRICE_PAYMENTS_ENABLED!=='true'||env.SSTRX_QA_STACK!=='joined-v31'||env.STRIPE_MODE!=='test'||env.STRIPE_SECRET_KEY||env.SSTRX_PRICE_PAYMENT_COMMISSIONING))fail(503,'synthetic_price_transport_requires_isolation');
  const source=qa?{kind:'qa',mode:'test',qaContract:qa,qaOrigin:'https://my-qa.sstrx.co.uk'}:{kind:'fixture',mode:'test'};
  return {source,verifyAccount:async()=>{},send:(body,key,signal)=>env.LIFECYCLE_PAYMENT_TEST_TRANSPORT.fetch(new Request(endpoint+'/v1/checkout/sessions',{method:'POST',signal,headers:{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':key,'Stripe-Version':PRICE_STRIPE_VERSION},body:body.toString()}))};
 }
 const mode=env.SSTRX_PRICE_PAYMENT_MODE;
 if(env.SSTRX_PRICE_PAYMENTS_ENABLED!=='true'||!['test','live'].includes(mode)||env.STRIPE_MODE!==mode||env.SSTRX_ENVIRONMENT!==(mode==='live'?'production':'synthetic'))fail(503,'price_payment_processor_not_commissioned');
 let p;try{p=JSON.parse(env.SSTRX_PRICE_PAYMENT_COMMISSIONING||'null')}catch{}
 if(!p||!Number.isSafeInteger(p.version)||p.version<1||p.mode!==mode||!/^acct_[A-Za-z0-9]+$/.test(p.accountId||'')||!['shift_collects','complete_service'].includes(p.collectionModel)||p.collectionModel!==collectionModel||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=Date.now())fail(503,'current_price_processor_commissioning_required');
 for(const value of [p.approvalReference,p.sandboxEvidenceReference])try{text(value,400)}catch{fail(503,'price_processor_approval_evidence_required')}
 const key=env.STRIPE_SECRET_KEY;
 if(!new RegExp('^[sr]k_'+mode+'_[A-Za-z0-9_]+$').test(key||'')||!/^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_PRICE_WEBHOOK_SECRET||''))fail(503,'matching_price_processor_credentials_required');
 const headers={Authorization:'Bearer '+key,'Stripe-Version':PRICE_STRIPE_VERSION};
 const source={kind:'stripe',mode,accountId:p.accountId,policyVersion:p.version,approvalReference:p.approvalReference,sandboxEvidenceReference:p.sandboxEvidenceReference,commissionedUntil:p.expiresAt};
 return {source,async verifyAccount(){
  try{const r=await fetch(endpoint+'/v1/account',{headers,redirect:'manual',signal:AbortSignal.timeout(15000)}),account=await r.json();if(!r.ok||account.id!==p.accountId)throw Error();}catch{fail(503,'price_processor_account_unverified')}
 },send:(body,idempotencyKey,signal)=>fetch(endpoint+'/v1/checkout/sessions',{method:'POST',headers:{...headers,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':idempotencyKey},body:body.toString(),signal,redirect:'manual'})};
}
export function priceCheckoutExpiry(planExpires,agreementExpires,at=Date.now()){
 const expires=Math.floor(Math.min(at+31*60000,Date.parse(planExpires),Date.parse(agreementExpires))/1000);
 // Leave a full minute for transport above Stripe's 30-minute minimum. A
 // shorter/expiring agreement needs renewed consent before another session.
 if(!Number.isSafeInteger(expires)||expires*1000<at+31*60000-1000)fail(409,'price_payment_agreement_needs_renewal');
 return new Date(expires*1000).toISOString();
}
export function priceSessionMatches(session,source,{paymentId,lifecycleId,orderReference,amount,expires}){
 const prefix=source.mode==='live'?'cs_live_':'cs_test_';
 if(source.kind==='qa'){
  const m=session?.metadata;
  return source.mode==='test'&&source.qaContract==='sstrx-durable-price-test-v1'&&source.qaOrigin==='https://my-qa.sstrx.co.uk'&&session?.qaContract===source.qaContract&&session.simulation===true&&session.livemode===false&&/^cs_test_QA_price_[a-f0-9]{32}$/.test(session.id||'')&&session.object==='checkout.session'&&session.mode==='payment'&&session.status==='open'&&session.client_reference_id===paymentId&&session.amount_total===amount&&session.currency==='gbp'&&session.expires_at===Math.floor(Date.parse(expires)/1000)&&m?.sst_price_payment_id===paymentId&&m?.sst_lifecycle_id===lifecycleId&&m?.order_reference===orderReference&&session.url===source.qaOrigin+'/member/qa-price-checkout/'+paymentId;
 }
 if(!session||session.livemode!==(source.mode==='live')||!session.id?.startsWith(prefix)||session.client_reference_id!==paymentId||session.amount_total!==amount||session.currency!=='gbp'||!/^https:\/\/checkout\.stripe\.com\//.test(session.url||''))return false;
 if(source.kind==='stripe'){
  if(session.object!=='checkout.session'||session.mode!=='payment'||session.status!=='open'||session.expires_at!==Math.floor(Date.parse(expires)/1000))return false;
  const m=session.metadata;if(m?.sst_price_payment_id!==paymentId||m?.sst_lifecycle_id!==lifecycleId||m?.order_reference!==orderReference||m?.sst_processor_account!==source.accountId||m?.sst_processor_policy!==String(source.policyVersion))return false;
 }
 return true;
}
export async function confirmUncertainPriceSession(env,source,payment,event){
 // A lost create response has no locally bound session ID. Authenticate a
 // read of the reported session under the original account before trusting it.
 // This never replays Checkout creation and remains available after new
 // Checkout creation has been disabled or its commissioning window expired.
 const mode=source.mode,key=env.STRIPE_SECRET_KEY;
 if(!new RegExp('^[sr]k_'+mode+'_[A-Za-z0-9_]+$').test(key||''))fail(503,'price_receipt_reconciliation_credentials_required');
 const headers={Authorization:'Bearer '+key,'Stripe-Version':PRICE_STRIPE_VERSION};
 try{
  const get=async path=>{const r=await fetch(endpoint+path,{headers,redirect:'manual',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();return r.json()};
  if((await get('/v1/account')).id!==source.accountId)throw Error();
  const reported=event.data.object,s=await get('/v1/checkout/sessions/'+encodeURIComponent(reported.id)),m=s.metadata;
  if(s.id!==reported.id||s.object!=='checkout.session'||s.mode!=='payment'||s.livemode!==(mode==='live')||s.client_reference_id!==payment.id||s.amount_total!==payment.amount_pence||s.currency!=='gbp'||m?.sst_price_payment_id!==payment.id||m?.sst_lifecycle_id!==payment.lifecycle_id||m?.order_reference!==payment.order_number||m?.sst_processor_account!==source.accountId||m?.sst_processor_policy!==String(source.policyVersion))throw Error();
  if(reported.payment_status==='paid'&&(s.payment_status!=='paid'||s.payment_intent!==reported.payment_intent))throw Error();
  if(['checkout.session.async_payment_failed','checkout.session.expired'].includes(event.type)&&(s.payment_status==='paid'||event.type==='checkout.session.expired'&&s.status!=='expired'))throw Error();
 }catch{fail(503,'price_receipt_account_reconciliation_required')}
}
