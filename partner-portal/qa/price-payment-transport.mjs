// Durable, network-free additional-payment provider double for the isolated
// private QA stack. Existing member agreement, payment, ledger and supply guards
// remain authoritative. No processor account or real payment is used.
import {qaDatabaseAdmitted} from './database-boundary.mjs';
import {digest,fail,readObject} from '../platform/domain.mjs';
import {authenticate,sessionHash} from '../service/member-kernel.mjs';
import {stripePriceWebhook,ensurePriceSchema} from '../platform/price-adjustments.mjs';
import {QA_PRICE_HTML,QA_PRICE_CLIENT} from './price-payment-pages.mjs';
export const QA_PRICE_CONTRACT='sstrx-durable-price-test-v1';
export const QA_PRICE_ORIGIN='https://my-qa.sstrx.co.uk';
export const QA_PRICE_CALLBACK_KEY='whsec_FICTIONAL_QA_PRICE_CALLBACK_ONLY';
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const fictional=v=>typeof v==='string'&&/@example\.(?:test|invalid)$/.test(v);
const now=()=>new Date().toISOString();
const headers={'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'};
const json=(body,status=200)=>Response.json(body,{status,headers});
async function admitted(env){
 if(env.SSTRX_QA_PRICE_PAYMENTS_ENABLED!=='true'||env.STRIPE_MODE!=='test'||env.SSTRX_PRICE_PAYMENT_MODE==='live'||env.STRIPE_SECRET_KEY||env.SSTRX_PRICE_PAYMENT_COMMISSIONING||!await qaDatabaseAdmitted(env))fail(503,'isolated_qa_price_transport_required');
}
const prepared=new WeakMap();
async function schema(DB){
 DB=DB.__sstrxBaseDB||DB;if(prepared.has(DB))return prepared.get(DB);
 const task=(async()=>{
  await DB.prepare('CREATE TABLE IF NOT EXISTS qa_simulated_price_checkouts(payment_id TEXT PRIMARY KEY,id TEXT NOT NULL UNIQUE,lifecycle_id TEXT NOT NULL,order_number TEXT NOT NULL,member_id INTEGER NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,request_digest TEXT NOT NULL,session_json TEXT NOT NULL,created_at TEXT NOT NULL)').run();
  await DB.prepare('CREATE TABLE IF NOT EXISTS qa_simulated_price_outcomes(payment_id TEXT PRIMARY KEY,event_id TEXT NOT NULL UNIQUE,action TEXT NOT NULL,event_json TEXT NOT NULL,payload_digest TEXT NOT NULL,occurred_at INTEGER NOT NULL,created_at TEXT NOT NULL)').run();
  for(const table of ['qa_simulated_price_checkouts','qa_simulated_price_outcomes'])for(const action of ['UPDATE','DELETE'])await DB.prepare('CREATE TRIGGER IF NOT EXISTS '+table+'_no_'+action.toLowerCase()+' BEFORE '+action+' ON '+table+" BEGIN SELECT RAISE(ABORT,'immutable_qa_price_receipt'); END").run();
 })();prepared.set(DB,task);try{return await task}catch(e){prepared.delete(DB);throw e;}
}
function parse(value){try{return JSON.parse(value)}catch{fail(409,'qa_price_source_requires_review')}}
function sourceMatches(source){return source?.kind==='qa'&&source.mode==='test'&&source.qaContract===QA_PRICE_CONTRACT&&source.qaOrigin===QA_PRICE_ORIGIN;}
async function paymentSource(env,id){
 return env.DB.prepare("SELECT p.*,s.source_json,m.email order_email,m.variant_id,m.medicine_name,m.user_id,m.currency order_currency,u.email member_email,r.user_id record_member FROM rx_lifecycle_payments p JOIN rx_lifecycle_payment_sources s ON s.payment_id=p.id JOIN medicine_orders m ON m.order_number=p.order_number JOIN users u ON u.id=m.user_id JOIN rx_lifecycle_price_plans plan ON plan.lifecycle_id=p.lifecycle_id JOIN clinical_member_records r ON r.id=plan.record_id WHERE p.id=?").bind(id).first();
}
function fictionalPayment(p){
 return p&&p.member_id===p.user_id&&p.record_member===p.member_id&&fictional(p.member_email)&&fictional(p.order_email)&&p.variant_id===9911&&/^(?:TEST[- ]|Synthetic )/.test(p.medicine_name||'')&&p.order_currency==='GBP'&&Number.isSafeInteger(p.amount_pence)&&p.amount_pence>0;
}
export function qaPricePaymentTransport(env){return {qaContract:QA_PRICE_CONTRACT,async fetch(request){
 await admitted(env);
 const url=new URL(request.url);
 if(request.method!=='POST'||url.href!=='https://api.stripe.com/v1/checkout/sessions'||request.headers.has('Authorization'))return json({error:'qa_price_route_required'},403);
 const raw=await request.text();if(raw.length>8192)return json({error:'qa_price_request_too_large'},413);
 const b=new URLSearchParams(raw),fields=['mode','integration_identifier','client_reference_id','metadata[sst_price_payment_id]','metadata[sst_lifecycle_id]','metadata[order_reference]','line_items[0][quantity]','line_items[0][price_data][currency]','line_items[0][price_data][unit_amount]','line_items[0][price_data][product_data][name]','success_url','cancel_url','expires_at',...['sst_price_payment_id','sst_lifecycle_id','order_reference'].map(k=>'payment_intent_data[metadata]['+k+']')];
 if([...b.keys()].some(k=>!fields.includes(k))||fields.some(k=>b.getAll(k).length!==1))return json({error:'qa_price_exact_fields_required'},400);
 const id=b.get('client_reference_id');if(!new RegExp('^'+uuid+'$').test(id||''))return json({error:'qa_price_payment_required'},422);
 const p=await paymentSource(env,id),source=p&&parse(p.source_json);
 if(!fictionalPayment(p)||!sourceMatches(source)||!['submitting','unknown','checkout_open','paid','failed'].includes(p.state))return json({error:'owned_fictional_price_payment_required'},403);
 const plan=await env.DB.prepare('SELECT * FROM rx_lifecycle_price_plans WHERE lifecycle_id=? AND member_id=?').bind(p.lifecycle_id,p.member_id).first();
 const current=plan&&await env.DB.prepare('SELECT version,state_json FROM clinical_prescription_requests WHERE record_id=?').bind(plan.record_id).first(),agreement=current&&parse(current.state_json);
 const key=request.headers.get('Idempotency-Key');
 if(!plan||!current||agreement.status!=='accepted'||plan.version!==source.planVersion||current.version!==source.agreementVersion||agreement.version!==source.agreementVersion||agreement.quote?.pricePlan?.lifecycleId!==p.lifecycle_id||agreement.quote?.pricePlan?.version!==plan.version||plan.expires_at!==source.planExpiresAt||agreement.expiresAt!==source.agreementExpiresAt||plan.expires_at<=now()||agreement.expiresAt<=now()||plan.delta_pence!==p.amount_pence||plan.delta_pence<=0||plan.order_number!==p.order_number||key!==p.idempotency_key)return json({error:'current_approved_qa_price_agreement_required'},409);
 const economics=await env.DB.prepare('SELECT terms_json FROM rx_economics WHERE order_number=?').bind(p.order_number).first();
 if(!['shift_collects','complete_service'].includes(parse(economics?.terms_json).model))return json({error:'qa_price_collection_model_required'},409);
 if(b.get('mode')!=='payment'||!/^sstrxprice_[a-z]{8}$/.test(b.get('integration_identifier')||'')||b.get('metadata[sst_price_payment_id]')!==p.id||b.get('metadata[sst_lifecycle_id]')!==p.lifecycle_id||b.get('metadata[order_reference]')!==p.order_number||b.get('line_items[0][quantity]')!=='1'||b.get('line_items[0][price_data][currency]')!=='gbp'||b.get('line_items[0][price_data][unit_amount]')!==String(p.amount_pence)||b.get('line_items[0][price_data][product_data][name]')!=='Agreed order price adjustment'||b.get('expires_at')!==String(Math.floor(Date.parse(p.expires_at)/1000))||['success_url','cancel_url'].some(k=>b.get(k)!=='https://my-timber.app/member/my-shift?view=orders')||['sst_price_payment_id','sst_lifecycle_id','order_reference'].some(k=>b.get('payment_intent_data[metadata]['+k+']')!==b.get('metadata['+k+']')))return json({error:'qa_price_checkout_does_not_match'},409);
 await schema(env.DB);
 const requestDigest=await digest(raw),sessionId='cs_test_QA_price_'+(await digest(p.id)).slice(0,32);
 const session={id:sessionId,object:'checkout.session',mode:'payment',status:'open',payment_status:'unpaid',livemode:false,simulation:true,qaContract:QA_PRICE_CONTRACT,client_reference_id:p.id,metadata:{sst_price_payment_id:p.id,sst_lifecycle_id:p.lifecycle_id,order_reference:p.order_number},amount_total:p.amount_pence,currency:'gbp',expires_at:Math.floor(Date.parse(p.expires_at)/1000),url:QA_PRICE_ORIGIN+'/member/qa-price-checkout/'+p.id};
 await env.DB.prepare('INSERT OR IGNORE INTO qa_simulated_price_checkouts VALUES(?,?,?,?,?,?,?,?,?)').bind(p.id,sessionId,p.lifecycle_id,p.order_number,p.member_id,key,requestDigest,JSON.stringify(session),now()).run();
 const retained=await env.DB.prepare('SELECT * FROM qa_simulated_price_checkouts WHERE payment_id=?').bind(p.id).first();
 if(!retained||retained.idempotency_key!==key||retained.request_digest!==requestDigest||retained.session_json!==JSON.stringify(session))return json({error:'qa_price_checkout_reference_conflict'},409);
 return json(session);
}};}
export async function qaPricePaymentEnvironment(env){
 if(env.SSTRX_QA_PRICE_PAYMENTS_ENABLED!=='true')return env;
 await admitted(env);
 if(env.LIFECYCLE_PAYMENT_TEST_TRANSPORT||env.STRIPE_PRICE_WEBHOOK_SECRET)fail(503,'qa_price_binding_already_supplied');
 return {...env,LIFECYCLE_PAYMENT_TEST_TRANSPORT:qaPricePaymentTransport(env),STRIPE_PRICE_WEBHOOK_SECRET:QA_PRICE_CALLBACK_KEY};
}
async function owned(env,id,actor){
 const p=await paymentSource(env,id);if(!fictionalPayment(p)||p.member_id!==Number(actor.id)||!sourceMatches(parse(p.source_json)))fail(404,'qa_price_checkout_not_found');
 const q=await env.DB.prepare('SELECT * FROM qa_simulated_price_checkouts WHERE payment_id=?').bind(id).first();
 if(!q)fail(409,'qa_price_checkout_not_confirmed');
 const s=parse(q.session_json);
 if(q.member_id!==p.member_id||q.lifecycle_id!==p.lifecycle_id||q.order_number!==p.order_number||q.idempotency_key!==p.idempotency_key||s.id!==q.id||s.client_reference_id!==p.id||s.metadata?.sst_lifecycle_id!==p.lifecycle_id||s.metadata?.order_reference!==p.order_number||s.amount_total!==p.amount_pence||s.livemode!==false||s.simulation!==true||s.qaContract!==QA_PRICE_CONTRACT||s.url!==QA_PRICE_ORIGIN+'/member/qa-price-checkout/'+id)fail(409,'qa_price_source_requires_review');
 const outcome=await env.DB.prepare('SELECT * FROM qa_simulated_price_outcomes WHERE payment_id=?').bind(id).first();
 if(outcome&&await digest(parse(outcome.event_json))!==outcome.payload_digest)fail(409,'qa_price_receipt_requires_review');
 return {p,q,s,outcome};
}
export async function qaPricePaymentRoutes(request,env){
 const url=new URL(request.url),page=url.pathname.match(new RegExp('^/member/qa-price-checkout/(lifecycle/)?('+uuid+')$')),api=url.pathname.match(new RegExp('^/v1/member/clinical-records/qa-price-checkout/('+uuid+')$')),asset=url.pathname==='/assets/clinical-records/qa-price-payment.js';
 if(!page&&!api&&!asset)return null;
 try{
  await admitted(env);const origin=request.headers.get('Origin');
  if(url.hostname!=='api.shiftsometimber.co.uk'||url.search||origin&&!['https://shiftsometimber.co.uk','https://my-timber.app'].includes(origin)||request.method==='POST'&&!['https://shiftsometimber.co.uk','https://my-timber.app'].includes(origin))fail(403,'qa_price_origin_required');
  if(!['GET','HEAD'].includes(request.method)&&!(api&&request.method==='POST'))fail(405,'method_not_allowed');
  const actor=await authenticate(request,env);if(!actor||Number(actor.email_verified)!==1||!fictional(actor.email))fail(401,'native_fictional_member_sign_in_required');
  const expected=request.headers.get('X-My-Timber-Expected-Account');if(expected&&expected!==String(actor.id))fail(409,'account_changed');
  const hash=await sessionHash(request,env,actor.id);
  if(asset)return new Response(request.method==='HEAD'?null:QA_PRICE_CLIENT,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
  await ensurePriceSchema(env.DB);await schema(env.DB);
  if(page?.[1]){
   const p=await env.DB.prepare("SELECT p.id FROM rx_lifecycle_payments p JOIN rx_lifecycle_price_plans plan ON plan.lifecycle_id=p.lifecycle_id WHERE p.lifecycle_id=? AND p.member_id=? AND plan.member_id=? ORDER BY CASE WHEN p.state='paid' THEN 0 ELSE 1 END,p.rowid DESC LIMIT 1").bind(page[2],actor.id,actor.id).first();
   if(!p)fail(404,'qa_price_checkout_not_found');await owned(env,p.id,actor);
   return new Response(null,{status:303,headers:{...headers,Location:'/member/qa-price-checkout/'+p.id}});
  }
  const id=api?.[1]||page[2];let state=await owned(env,id,actor);
  if(page)return new Response(request.method==='HEAD'?null:QA_PRICE_HTML,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
  if(request.method==='POST'){
   const b=await readObject(request,1000);if(Object.keys(b).length!==1||!['complete','expire','fail','reconcile'].includes(b.action))fail(422,'qa_price_action_required');
   if(b.action==='reconcile'&&!state.outcome)fail(409,'qa_price_saved_receipt_required');
   if(state.outcome&&b.action!=='reconcile'&&b.action!==state.outcome.action)fail(409,'qa_price_outcome_already_selected');
   if(!state.outcome){
    if(!['submitting','unknown','checkout_open'].includes(state.p.state))fail(409,'qa_price_attempt_requires_review');
    const action=b.action,type=action==='complete'?'checkout.session.completed':action==='expire'?'checkout.session.expired':'checkout.session.async_payment_failed',created=Math.floor(Date.now()/1000);
    const event={id:'evt_test_QA_price_'+(await digest(id)).slice(0,32),created,type,livemode:false,data:{object:{...state.s,status:action==='expire'?'expired':'complete',payment_status:action==='complete'?'paid':'unpaid',payment_intent:action==='complete'?'pi_test_QA_'+(await digest(id)).slice(0,32):null}}};
    const payload=await digest(event),date=now();
    await env.DB.prepare("INSERT OR IGNORE INTO qa_simulated_price_outcomes SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM user_sessions WHERE user_id=? AND token_hash=? AND revoked_at IS NULL AND julianday(expires_at)>julianday(?))").bind(id,event.id,action,JSON.stringify(event),payload,created,date,actor.id,hash,date).run();
    state=await owned(env,id,actor);if(!state.outcome)fail(401,'member_session_required');if(state.outcome.action!==action)fail(409,'qa_price_outcome_already_selected');
   }
   const raw=state.outcome.event_json,ts=Math.floor(Date.now()/1000),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(QA_PRICE_CALLBACK_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const sig=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ts+'.'+raw))),b=>b.toString(16).padStart(2,'0')).join('');
   const receipt=await stripePriceWebhook(new Request('https://api.shiftsometimber.co.uk/v1/hq/clinical/platform/processor/adjustments',{method:'POST',headers:{'Stripe-Signature':'t='+ts+',v1='+sig},body:raw}),env);
   if(!receipt.ok)fail(503,'qa_price_receipt_requires_reconciliation');
   state=await owned(env,id,actor);
  }
  return json({simulation:true,moneyMoved:false,memberId:Number(actor.id),paymentId:id,orderReference:state.p.order_number,amountPence:state.p.amount_pence,currency:'GBP',state:state.p.state,outcome:state.outcome?.action||'open',receiptPending:!!state.outcome&&!['paid','failed'].includes(state.p.state),sessionExpiresAt:actor.expires_at});
 }catch(e){return json({error:e.status?e.message:'qa_price_checkout_unavailable',simulation:true},e.status||503);}
}
