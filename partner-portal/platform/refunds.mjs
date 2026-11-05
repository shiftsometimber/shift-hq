// Refund commands reuse the existing paid order and finance ledger. A request or
// an HTTP acknowledgement can never masquerade as processor completion.
import {fail,text,pence,digest,readObject} from './domain.mjs';
import {authCondition} from '../service/clinical-kernel.mjs';
import {passwordSignInAllowed} from '../password-signin.mjs';
const at=()=>new Date().toISOString(),rows=async q=>(await q.all()).results||[];
export const REFUND_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS rx_refunds(id TEXT PRIMARY KEY,order_number TEXT NOT NULL REFERENCES medicine_orders(order_number),member_id INTEGER NOT NULL,amount_pence INTEGER NOT NULL CHECK(amount_pence>0),currency TEXT NOT NULL,reason TEXT NOT NULL,terms_reference TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL,requested_by INTEGER NOT NULL,approved_by INTEGER,approval_reference TEXT,processor_reference TEXT UNIQUE,idempotency_key TEXT NOT NULL UNIQUE,payload_digest TEXT NOT NULL,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_refund_receipts(event_id TEXT PRIMARY KEY,refund_id TEXT NOT NULL REFERENCES rx_refunds(id),processor_reference TEXT NOT NULL,payload_digest TEXT NOT NULL,processor_status TEXT NOT NULL,occurred_at INTEGER NOT NULL,received_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_refund_events(id TEXT PRIMARY KEY,refund_id TEXT NOT NULL REFERENCES rx_refunds(id),version INTEGER NOT NULL,state TEXT NOT NULL,source_reference TEXT NOT NULL,actor_id INTEGER,created_at TEXT NOT NULL,UNIQUE(refund_id,version))`,
 `CREATE TABLE IF NOT EXISTS rx_finance_authorities(hq_user_id INTEGER PRIMARY KEY,limit_pence INTEGER NOT NULL,expires_at TEXT NOT NULL,approval_reference TEXT NOT NULL,granted_by INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_finance_exceptions(id TEXT PRIMARY KEY,order_number TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,owner_user_id INTEGER NOT NULL,due_at TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_reconciliation_runs(id TEXT PRIMARY KEY,from_at TEXT NOT NULL,to_at TEXT NOT NULL,source_reference TEXT NOT NULL,variance_pence INTEGER NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL)`
];
const ready=new WeakMap();
export async function ensureRefundSchema(DB){DB=DB.__sstrxBaseDB||DB;if(ready.has(DB))return ready.get(DB);const p=(async()=>{for(const s of REFUND_SCHEMA)await DB.prepare(s).run()})();ready.set(DB,p);try{await p}catch(e){ready.delete(DB);throw e}}
export function financeGuard(env,a){
 if(a.mfa)return authCondition(a,at());
 if(!passwordSignInAllowed(env,a.user))fail(403,'finance_authentication_required');
 return {sql:"EXISTS(SELECT 1 FROM hq_sessions s JOIN hq_users u ON u.id=s.hq_user_id WHERE s.hq_user_id=? AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status='active' AND u.role=? AND u.email=? AND u.mfa_enabled=0 AND julianday('now')<julianday(?))",args:[a.id,a.sessionHash,at(),a.role,a.user.email,env.SSTRX_PASSWORD_SIGNIN_UNTIL]};
}
async function authority(env,a){
 if(!a.internal)fail(403,'finance_access_required');
 if(a.commercial)return {limit:100000000,delegated:false};
 const grant=await env.DB.prepare('SELECT * FROM rx_finance_authorities WHERE hq_user_id=? AND expires_at>?').bind(a.id,at()).first();
 if(!grant)fail(403,'finance_access_required');return {limit:grant.limit_pence,delegated:true};
}
function publicRefund(r){return {id:r.id,orderReference:r.order_number,amountPence:r.amount_pence,currency:r.currency,state:r.state,version:r.version,termsReference:r.terms_reference,requestedAt:r.created_at,updatedAt:r.updated_at,processorReference:r.processor_reference||null,needsAttention:['failed','unknown','requires_action'].includes(r.state)};}
export async function memberRefunds(env,memberId){return (await rows(env.DB.prepare('SELECT * FROM rx_refunds WHERE member_id=? ORDER BY updated_at DESC LIMIT 100').bind(memberId))).map(publicRefund);}
function eventStatement(env,r,state,source,actor,version=r.version+1){return env.DB.prepare('INSERT INTO rx_refund_events SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rx_refunds WHERE id=? AND version=?)').bind(crypto.randomUUID(),r.id,version,state,source,actor,at(),r.id,version);}
async function processorRequest(env,r,paymentIntent){
 if(env.SSTRX_ENVIRONMENT!=='synthetic'||env.SSTRX_REFUND_TEST_EXECUTION_ENABLED!=='true')fail(503,'refund_execution_not_authorised');
 const body=new URLSearchParams({payment_intent:paymentIntent,amount:String(r.amount_pence),'metadata[sst_refund_id]':r.id,'metadata[order_reference]':r.order_number});
 const options={method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':r.idempotency_key},body:body.toString()};
 // Only an explicitly bound synthetic transport or a Stripe TEST key is admitted.
 if(env.REFUND_TEST_TRANSPORT)return env.REFUND_TEST_TRANSPORT.fetch(new Request('https://api.stripe.com/v1/refunds',options));
 if(!/^sk_test_/.test(env.STRIPE_SECRET_KEY||''))fail(503,'stripe_test_credentials_required');
 options.headers.Authorization='Bearer '+env.STRIPE_SECRET_KEY;return fetch('https://api.stripe.com/v1/refunds',{...options,signal:AbortSignal.timeout(15000)});
}
export async function refundRoute(request,env,a,parts){
 if(parts[0]!=='refunds'&&parts[0]!=='reconciliation')return null;
 if(env.SSTRX_FUNCTIONAL_V3_ENABLED!=='true')fail(404,'functional_finance_not_open');
 await ensureRefundSchema(env.DB);const auth=await authority(env,a),g=financeGuard(env,a);
 if(parts[0]==='reconciliation'){
  if(request.method==='GET')return {runs:await rows(env.DB.prepare('SELECT * FROM rx_reconciliation_runs ORDER BY created_at DESC LIMIT 100')),exceptions:await rows(env.DB.prepare("SELECT * FROM rx_finance_exceptions WHERE state='open' ORDER BY due_at"))};
  if(request.method!=='POST')fail(405,'method_not_allowed');
  const b=await readObject(request);text(b.sourceReference);if(!Number.isInteger(b.ownerUserId)||!Number.isFinite(Date.parse(b.dueAt))||b.dueAt<=at()||!Number.isFinite(Date.parse(b.fromAt))||!Number.isFinite(Date.parse(b.toAt))||b.fromAt>=b.toAt)fail(422,'reconciliation_owner_and_deadline_required');
  if(env.SSTRX_ENVIRONMENT!=='synthetic'||!env.STATEMENT_TEST_TRANSPORT)fail(503,'authenticated_processor_statement_required');
  const statementResponse=await env.STATEMENT_TEST_TRANSPORT.fetch(new Request('https://processor.invalid/statement/'+encodeURIComponent(b.sourceReference)));
  const statement=await statementResponse.json();if(!statementResponse.ok||statement.reference!==b.sourceReference||statement.fromAt!==b.fromAt||statement.toAt!==b.toAt||statement.currency!=='GBP')fail(409,'processor_statement_does_not_match');pence(statement.netReceivedPence);
  const ledger=await env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN kind IN ('member_payment','refund_reversal') THEN amount_pence WHEN kind IN ('refund','adjustment_credit') THEN -amount_pence ELSE 0 END),0) total FROM rx_finance_entries WHERE occurred_at>=? AND occurred_at<?").bind(b.fromAt,b.toAt).first();
  const owner=await env.DB.prepare("SELECT id FROM hq_users WHERE id=? AND status='active' AND role IN ('owner','admin','operations')").bind(b.ownerUserId).first();if(!owner)fail(422,'active_finance_owner_required');
  const id=crypto.randomUUID(),variance=statement.netReceivedPence-ledger.total,date=at();
  const commands=[env.DB.prepare(`INSERT INTO rx_reconciliation_runs SELECT ?,?,?,?,?,?,? WHERE ${g.sql}`).bind(id,text(b.fromAt),text(b.toAt),b.sourceReference,variance,variance?'variance':'matched',date,...g.args)];
  if(variance)commands.push(env.DB.prepare("INSERT INTO rx_finance_exceptions SELECT ?,?,'reconciliation_variance','open',?,?,?,? WHERE EXISTS(SELECT 1 FROM rx_reconciliation_runs WHERE id=?)").bind('recon:'+id,b.orderReference||'ALL',b.ownerUserId,b.dueAt,JSON.stringify({variancePence:variance,sourceReference:b.sourceReference}),date,id));
  const result=await env.DB.batch(commands);if(result[0].meta.changes!==1)fail(409,'finance_access_changed');return {id,state:variance?'variance':'matched',variancePence:variance};
 }
 if(request.method==='GET'&&parts.length===1)return {refunds:(await rows(env.DB.prepare('SELECT * FROM rx_refunds ORDER BY updated_at DESC LIMIT 200'))).map(publicRefund),approvalLimitPence:auth.limit,fullCommercial:a.commercial,replacementWork:a.commercial?await rows(env.DB.prepare("SELECT l.id,l.record_id recordId,l.order_number orderReference,l.kind,l.version,l.due_at dueAt FROM rx_prescription_lifecycle l LEFT JOIN rx_lifecycle_funding f ON f.lifecycle_id=l.id WHERE l.state='acknowledged' AND f.lifecycle_id IS NULL ORDER BY l.due_at")):[],withdrawalFinanceWork:a.commercial?await rows(env.DB.prepare("SELECT l.id,l.record_id recordId,l.order_number orderReference,l.kind,l.version,l.finance_owner_id ownerUserId,l.due_at dueAt FROM rx_prescription_lifecycle l LEFT JOIN rx_lifecycle_finance_reviews r ON r.lifecycle_id=l.id WHERE l.state IN ('closed','acknowledged','issued') AND r.lifecycle_id IS NULL ORDER BY l.due_at")):[]};
 if(request.method==='POST'&&parts.length===1){
  const b=await readObject(request);text(b.clientReference);text(b.reason,500);text(b.termsReference,300);pence(b.amountPence);if(!b.amountPence)fail(422,'positive_refund_amount_required');
  const order=await env.DB.prepare('SELECT * FROM medicine_orders WHERE order_number=?').bind(b.orderReference).first();if(!order||!['paid','succeeded','completed','fulfilled'].includes(order.status))fail(409,'paid_order_required');if(order.currency!=='GBP')fail(422,'supported_order_currency_required');
  const payload=await digest({order:order.order_number,amount:b.amountPence,reason:b.reason,terms:b.termsReference});const prior=await env.DB.prepare('SELECT * FROM rx_refunds WHERE idempotency_key=?').bind(b.clientReference).first();
  if(prior){if(prior.payload_digest!==payload)fail(409,'refund_reference_conflict');return {...publicRefund(prior),duplicate:true};}
  const id=crypto.randomUUID(),date=at();
  const result=await env.DB.batch([
   env.DB.prepare(`INSERT INTO rx_refunds SELECT ?,?,?,?,?,?,?,'requested',1,?,NULL,NULL,NULL,?,?,NULL,?,? WHERE ${g.sql} AND ?<=(SELECT total_pence-COALESCE((SELECT SUM(amount_pence) FROM rx_refunds WHERE order_number=? AND state NOT IN ('failed','declined','cancelled')),0) FROM medicine_orders WHERE order_number=?)`).bind(id,order.order_number,order.user_id,b.amountPence,'GBP',b.reason,b.termsReference,a.id,b.clientReference,payload,date,date,...g.args,b.amountPence,order.order_number,order.order_number),
   env.DB.prepare("INSERT INTO rx_refund_events SELECT ?,?,1,'requested',?,?,? WHERE EXISTS(SELECT 1 FROM rx_refunds WHERE id=?)").bind(crypto.randomUUID(),id,b.clientReference,a.id,date,id)
  ]);if(result[0].meta.changes!==1)fail(409,'refund_exceeds_unreserved_payment_or_access_changed');return publicRefund(await env.DB.prepare('SELECT * FROM rx_refunds WHERE id=?').bind(id).first());
 }
 const r=await env.DB.prepare('SELECT * FROM rx_refunds WHERE id=?').bind(parts[1]).first();if(!r)fail(404,'refund_not_found');
 if(request.method==='GET'&&parts.length===2)return {...publicRefund(r),events:await rows(env.DB.prepare('SELECT version,state,source_reference,created_at FROM rx_refund_events WHERE refund_id=? ORDER BY version').bind(r.id))};
 const b=await readObject(request);if(b.version!==r.version)fail(409,'refund_changed');
 if(parts[2]==='approve'&&request.method==='POST'){
  if(r.state!=='requested')fail(409,'refund_not_awaiting_approval');if(r.amount_pence>auth.limit)fail(403,'refund_exceeds_approval_authority');text(b.approvalReference,300);
  if(!Number.isFinite(Date.parse(b.exceptionDueAt))||b.exceptionDueAt<=at())fail(422,'explicit_refund_exception_deadline_required');
  const delegated=auth.delegated?' AND EXISTS(SELECT 1 FROM rx_finance_authorities WHERE hq_user_id=? AND expires_at>? AND limit_pence>=?)':'';
  const results=await env.DB.batch([env.DB.prepare(`UPDATE rx_refunds SET state='approved',version=version+1,approved_by=?,approval_reference=?,updated_at=? WHERE id=? AND version=? AND state='requested' AND ${g.sql}${delegated}`).bind(a.id,b.approvalReference,at(),r.id,r.version,...g.args,...auth.delegated?[a.id,at(),r.amount_pence]:[]),eventStatement(env,r,'approved',b.approvalReference,a.id),env.DB.prepare("INSERT INTO rx_finance_exceptions SELECT ?,?,'refund_watch','watching',?,?,?,? WHERE EXISTS(SELECT 1 FROM rx_refunds WHERE id=? AND version=? AND state='approved')").bind('refund:'+r.id,r.order_number,a.id,b.exceptionDueAt,JSON.stringify({refundId:r.id,approvalReference:b.approvalReference,automaticRetry:false}),at(),r.id,r.version+1)]);if(results[0].meta.changes!==1)fail(409,'refund_or_authority_changed');return publicRefund(await env.DB.prepare('SELECT * FROM rx_refunds WHERE id=?').bind(r.id).first());
 }
 if(parts[2]==='submit'&&request.method==='POST'){
  if(!['approved','unknown'].includes(r.state))fail(409,'approved_or_unknown_refund_required');
  if(r.amount_pence>auth.limit)fail(403,'refund_exceeds_approval_authority');
  if(env.SSTRX_ENVIRONMENT!=='synthetic'||env.SSTRX_REFUND_TEST_EXECUTION_ENABLED!=='true')fail(503,'refund_execution_not_authorised');
  const order=await env.DB.prepare('SELECT stripe_payment_intent_id FROM medicine_orders WHERE order_number=?').bind(r.order_number).first();if(!/^pi_/.test(order?.stripe_payment_intent_id||''))fail(409,'verified_processor_payment_reference_required');
  const reserved=await env.DB.prepare(`UPDATE rx_refunds SET state='submitting',version=version+1,updated_at=? WHERE id=? AND version=? AND state IN ('approved','unknown') AND ${g.sql}`).bind(at(),r.id,r.version,...g.args).run();if(reserved.meta.changes!==1)fail(409,'refund_or_access_changed');
  let response;try{response=await processorRequest(env,r,order.stripe_payment_intent_id);}catch(e){await env.DB.prepare("UPDATE rx_refunds SET state='unknown',last_error='processor_outcome_unknown',version=version+1,updated_at=? WHERE id=? AND state='submitting'").bind(at(),r.id).run();return {...publicRefund(await env.DB.prepare('SELECT * FROM rx_refunds WHERE id=?').bind(r.id).first()),reconcileUsingSameIdempotencyKey:true};}
  const receipt=await response.json().catch(()=>null);
  if(!response.ok||!receipt||!/^re_/.test(receipt.id||'')||receipt.amount!==r.amount_pence||receipt.currency!=='gbp'||receipt.payment_intent!==order.stripe_payment_intent_id){await env.DB.prepare("UPDATE rx_refunds SET state='unknown',last_error='processor_receipt_not_verified',version=version+1,updated_at=? WHERE id=? AND state='submitting'").bind(at(),r.id).run();fail(502,'refund_processor_outcome_unknown');}
  const results=await env.DB.batch([env.DB.prepare("UPDATE rx_refunds SET state='submitted',processor_reference=?,version=version+1,last_error=NULL,updated_at=? WHERE id=? AND state='submitting'").bind(receipt.id,at(),r.id),env.DB.prepare("INSERT INTO rx_refund_events SELECT ?,id,version,'submitted',?,NULL,? FROM rx_refunds WHERE id=? AND processor_reference=?").bind(crypto.randomUUID(),receipt.id,at(),r.id,receipt.id)]);
  if(results[0].meta.changes!==1)fail(409,'refund_submission_changed');
  // A successful create response can be reconciled by its authenticated receipt.
  if(receipt.status==='succeeded')await applyRefundReceipt(env,{id:'api:'+receipt.id+':succeeded',created:Math.floor(Date.now()/1000),data:{object:receipt}},'authenticated_test_api');
  return publicRefund(await env.DB.prepare('SELECT * FROM rx_refunds WHERE id=?').bind(r.id).first());
 }
 fail(404,'refund_action_not_found');
}
export async function applyRefundReceipt(env,event,source){
 if(!['verified_stripe_webhook','authenticated_test_api'].includes(source))fail(403,'verified_processor_receipt_required');
 if(source==='authenticated_test_api'&&env.SSTRX_ENVIRONMENT!=='synthetic')fail(403,'synthetic_receipt_forbidden');
 const object=event.data?.object;if(!object||!/^re_/.test(object.id||'')||!Number.isInteger(event.created))fail(422,'valid_refund_receipt_required');text(event.id,200);
 const payload=await digest(event),prior=await env.DB.prepare('SELECT payload_digest FROM rx_refund_receipts WHERE event_id=?').bind(event.id).first();if(prior){if(prior.payload_digest!==payload)fail(409,'processor_event_conflict');return {duplicate:true};}
 const r=await env.DB.prepare('SELECT r.*,m.stripe_payment_intent_id FROM rx_refunds r JOIN medicine_orders m ON m.order_number=r.order_number WHERE r.processor_reference=?').bind(object.id).first();if(!r)fail(404,'submitted_refund_not_found');
 if(object.amount!==r.amount_pence||object.currency!=='gbp'||object.payment_intent!==r.stripe_payment_intent_id)fail(409,'refund_receipt_does_not_match');
 const last=await env.DB.prepare('SELECT MAX(occurred_at) at FROM rx_refund_receipts WHERE refund_id=?').bind(r.id).first();if(last?.at>event.created)return {stale:true};
 const next=object.status==='succeeded'?'completed':['failed','canceled'].includes(object.status)?'failed':object.status==='requires_action'?'requires_action':'submitted';
 if(r.state==='completed'&&next==='submitted')return {stale:true};
 if(r.state==='failed'&&next!=='failed')return {stale:true};
 const date=at(),v=r.version+1,sql=[
  env.DB.prepare('UPDATE rx_refunds SET state=?,version=?,last_error=?,updated_at=? WHERE id=? AND version=? AND NOT EXISTS(SELECT 1 FROM rx_refund_receipts WHERE refund_id=? AND occurred_at>?)').bind(next,v,next==='failed'?'processor_refund_failed':null,date,r.id,r.version,r.id,event.created),
  env.DB.prepare('INSERT INTO rx_refund_receipts SELECT ?,?,?,?,?,?,? WHERE changes()=1').bind(event.id,r.id,object.id,payload,object.status,event.created,date),
  env.DB.prepare('INSERT INTO rx_refund_events SELECT ?,?,?,?, ?,NULL,? WHERE EXISTS(SELECT 1 FROM rx_refund_receipts WHERE event_id=?)').bind(crypto.randomUUID(),r.id,v,next,event.id,date,event.id)
 ];
 const terms=await env.DB.prepare('SELECT order_number FROM rx_economics WHERE order_number=?').bind(r.order_number).first();
 if(next==='completed'&&r.state!=='completed'){
  if(!terms)fail(409,'order_economics_required_for_refund_reconciliation');
  sql.push(env.DB.prepare("INSERT OR IGNORE INTO rx_finance_entries SELECT ?,?,?,'refund',?,'GBP',?,?,? WHERE EXISTS(SELECT 1 FROM rx_refund_receipts WHERE event_id=?)").bind(crypto.randomUUID(),r.order_number,'processor-refund:'+object.id,r.amount_pence,event.id,new Date(event.created*1000).toISOString(),date,event.id));
  sql.push(env.DB.prepare("UPDATE rx_finance_exceptions SET state='resolved' WHERE id=? AND EXISTS(SELECT 1 FROM rx_refund_receipts WHERE event_id=?)").bind('refund:'+r.id,event.id));
 }
 if(next==='failed'){
  const watch=await env.DB.prepare('SELECT id FROM rx_finance_exceptions WHERE id=?').bind('refund:'+r.id).first();if(!watch)fail(409,'refund_exception_owner_and_deadline_required');
  sql.push(env.DB.prepare("UPDATE rx_finance_exceptions SET kind='refund_failed',state='open',detail_json=? WHERE id=? AND EXISTS(SELECT 1 FROM rx_refund_receipts WHERE event_id=?)").bind(JSON.stringify({refundId:r.id,sourceReference:event.id,automaticRetry:false}),'refund:'+r.id,event.id));
  if(r.state==='completed')sql.push(env.DB.prepare("INSERT OR IGNORE INTO rx_finance_entries SELECT ?,?,?,'refund_reversal',?,'GBP',?,?,? WHERE EXISTS(SELECT 1 FROM rx_refund_receipts WHERE event_id=?)").bind(crypto.randomUUID(),r.order_number,'refund-reversal:'+object.id,r.amount_pence,event.id,new Date(event.created*1000).toISOString(),date,event.id));
 }
 const result=await env.DB.batch(sql);if(result[0].meta.changes!==1)fail(409,'refund_receipt_race');return {recorded:true,state:next};
}
export async function stripeRefundWebhook(request,env){
 const json=(x,s=200)=>Response.json(x,{status:s,headers:{'Cache-Control':'no-store'}});
 try{
  if(env.SSTRX_FUNCTIONAL_V3_ENABLED!=='true')fail(404,'not_found');if(request.method!=='POST')fail(405,'method_not_allowed');
  if(!env.STRIPE_REFUND_WEBHOOK_SECRET)fail(503,'refund_webhook_not_configured');
  const raw=await request.text();if(raw.length>100000)fail(413,'webhook_too_large');
  const parts=(request.headers.get('Stripe-Signature')||'').split(',').map(x=>x.split('=')),ts=parts.find(x=>x[0]==='t')?.[1],sigs=parts.filter(x=>x[0]==='v1').map(x=>x[1]);
  if(!/^\d+$/.test(ts||'')||Math.abs(Date.now()/1000-Number(ts))>300)fail(401,'webhook_signature_expired');
  const enc=new TextEncoder(),key=await crypto.subtle.importKey('raw',enc.encode(env.STRIPE_REFUND_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  let valid=false;for(const s of sigs)if(/^[a-f0-9]{64}$/.test(s)&&await crypto.subtle.verify('HMAC',key,Uint8Array.from(s.match(/../g),x=>parseInt(x,16)),enc.encode(ts+'.'+raw)))valid=true;
  if(!valid)fail(401,'webhook_signature_invalid');const event=JSON.parse(raw);if(!['refund.created','refund.updated','refund.failed'].includes(event.type))return json({ignored:true});
  if(event.livemode!==false)fail(403,'live_refund_processing_not_authorised');await ensureRefundSchema(env.DB);return json(await applyRefundReceipt(env,event,'verified_stripe_webhook'));
 }catch(e){return json({error:e.status?e.message:'refund_webhook_unavailable'},e.status||503);}
}
