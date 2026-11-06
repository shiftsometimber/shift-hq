// Refund commands reuse the existing paid order and finance ledger. A request or
// an HTTP acknowledgement can never masquerade as processor completion.
import {fail,text,pence,digest,readObject,economicsTerms} from './domain.mjs';
import {authCondition} from '../service/clinical-kernel.mjs';
import {passwordSignInAllowed} from '../password-signin.mjs';
const at=()=>new Date().toISOString(),rows=async q=>(await q.all()).results||[];
export const REFUND_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS rx_refunds(id TEXT PRIMARY KEY,order_number TEXT NOT NULL REFERENCES medicine_orders(order_number),member_id INTEGER NOT NULL,amount_pence INTEGER NOT NULL CHECK(amount_pence>0),currency TEXT NOT NULL,reason TEXT NOT NULL,terms_reference TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL,requested_by INTEGER NOT NULL,approved_by INTEGER,approval_reference TEXT,processor_reference TEXT UNIQUE,idempotency_key TEXT NOT NULL UNIQUE,payload_digest TEXT NOT NULL,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_refund_receipts(event_id TEXT PRIMARY KEY,refund_id TEXT NOT NULL REFERENCES rx_refunds(id),processor_reference TEXT NOT NULL,payload_digest TEXT NOT NULL,processor_status TEXT NOT NULL,occurred_at INTEGER NOT NULL,received_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_refund_events(id TEXT PRIMARY KEY,refund_id TEXT NOT NULL REFERENCES rx_refunds(id),version INTEGER NOT NULL,state TEXT NOT NULL,source_reference TEXT NOT NULL,actor_id INTEGER,created_at TEXT NOT NULL,UNIQUE(refund_id,version))`,
 `CREATE TABLE IF NOT EXISTS rx_refund_sources(refund_id TEXT PRIMARY KEY REFERENCES rx_refunds(id),payment_id TEXT,payment_intent TEXT NOT NULL,captured_pence INTEGER NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_finance_authorities(hq_user_id INTEGER PRIMARY KEY,limit_pence INTEGER NOT NULL,expires_at TEXT NOT NULL,approval_reference TEXT NOT NULL,granted_by INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_finance_exceptions(id TEXT PRIMARY KEY,order_number TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,owner_user_id INTEGER NOT NULL,due_at TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_reconciliation_sources(run_id TEXT PRIMARY KEY,statement_digest TEXT NOT NULL,request_digest TEXT NOT NULL,ledger_total_pence INTEGER NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TRIGGER IF NOT EXISTS rx_reconciliation_sources_no_update BEFORE UPDATE ON rx_reconciliation_sources BEGIN SELECT RAISE(ABORT,'immutable_reconciliation_source'); END`,
 `CREATE TRIGGER IF NOT EXISTS rx_reconciliation_sources_no_delete BEFORE DELETE ON rx_reconciliation_sources BEGIN SELECT RAISE(ABORT,'immutable_reconciliation_source'); END`,
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
async function validatedRefundEconomics(env,orderNumber){
 const row=await env.DB.prepare('SELECT e.version,e.terms_json,m.total_pence,m.currency FROM rx_economics e JOIN medicine_orders m ON m.order_number=e.order_number WHERE e.order_number=?').bind(orderNumber).first();
 if(!row)fail(409,'order_economics_required_for_refund_reconciliation');
 let terms;try{const raw=JSON.parse(row.terms_json);if(raw.currency!=='GBP')throw Error('currency');terms=economicsTerms(raw);}catch{fail(409,'valid_order_economics_required_for_refund_reconciliation');}
 if(!Number.isSafeInteger(row.version)||row.version<1||String(row.currency).toUpperCase()!=='GBP'||terms.sellingPence!==row.total_pence)fail(409,'matching_order_economics_required_for_refund_reconciliation');
 return {version:row.version,json:row.terms_json,approvalReference:terms.approvalReference};
}
function economicsCondition(orderNumber,economics){return {sql:'EXISTS(SELECT 1 FROM rx_economics WHERE order_number=? AND version=? AND terms_json=?)',args:[orderNumber,economics.version,economics.json]};}
async function processorLookup(env,r){
 if(env.SSTRX_ENVIRONMENT!=='synthetic'||env.SSTRX_REFUND_TEST_EXECUTION_ENABLED!=='true')fail(503,'refund_reconciliation_not_authorised');
 const url='https://api.stripe.com/v1/refunds/'+encodeURIComponent(r.processor_reference);
 const options={method:'GET',headers:{'Idempotency-Key':r.idempotency_key}};
 if(env.REFUND_TEST_TRANSPORT)return env.REFUND_TEST_TRANSPORT.fetch(new Request(url,options));
 if(!/^sk_test_/.test(env.STRIPE_SECRET_KEY||''))fail(503,'stripe_test_credentials_required');
 options.headers.Authorization='Bearer '+env.STRIPE_SECRET_KEY;
 return fetch(url,{...options,signal:AbortSignal.timeout(15000)});
}
export async function refundRoute(request,env,a,parts){
 if(parts[0]!=='refunds'&&parts[0]!=='reconciliation')return null;
 if(env.SSTRX_FUNCTIONAL_V3_ENABLED!=='true')fail(404,'functional_finance_not_open');
 await ensureRefundSchema(env.DB);const auth=await authority(env,a),g=financeGuard(env,a);
 if(parts[0]==='reconciliation'){
  if(request.method==='GET')return {runs:await rows(env.DB.prepare('SELECT * FROM rx_reconciliation_runs ORDER BY created_at DESC LIMIT 100')),exceptions:await rows(env.DB.prepare("SELECT * FROM rx_finance_exceptions WHERE state='open' ORDER BY due_at"))};
  if(request.method!=='POST')fail(405,'method_not_allowed');
  const b=await readObject(request);text(b.sourceReference);if(!Number.isInteger(b.ownerUserId)||!Number.isFinite(Date.parse(b.dueAt))||!Number.isFinite(Date.parse(b.fromAt))||!Number.isFinite(Date.parse(b.toAt))||b.fromAt>=b.toAt)fail(422,'reconciliation_owner_and_deadline_required');
  if(env.SSTRX_ENVIRONMENT!=='synthetic'||!env.STATEMENT_TEST_TRANSPORT)fail(503,'authenticated_processor_statement_required');
  const statementResponse=await env.STATEMENT_TEST_TRANSPORT.fetch(new Request('https://processor.invalid/statement/'+encodeURIComponent(b.sourceReference)));
  const statement=await statementResponse.json();if(!statementResponse.ok||statement.reference!==b.sourceReference||statement.fromAt!==b.fromAt||statement.toAt!==b.toAt||statement.currency!=='GBP')fail(409,'processor_statement_does_not_match');pence(statement.netReceivedPence);
  if(b.orderReference&&b.orderReference!=='ALL')fail(422,'reconciliation_is_period_wide');
  const statementDigest=await digest(statement),requestDigest=await digest({sourceReference:b.sourceReference,fromAt:b.fromAt,toAt:b.toAt,ownerUserId:b.ownerUserId,dueAt:b.dueAt,scope:'ALL'});
  const id='recon-'+await digest({sourceReference:b.sourceReference,fromAt:b.fromAt,toAt:b.toAt});
  const previous=await rows(env.DB.prepare('SELECT r.*,s.statement_digest,s.request_digest FROM rx_reconciliation_runs r LEFT JOIN rx_reconciliation_sources s ON s.run_id=r.id WHERE r.source_reference=? AND r.from_at=? AND r.to_at=?').bind(b.sourceReference,b.fromAt,b.toAt));
  if(previous.length){
   if(previous.length!==1||!previous[0].statement_digest)fail(409,'legacy_reconciliation_requires_review');
   const r=previous[0];if(r.statement_digest!==statementDigest||r.request_digest!==requestDigest)fail(409,'reconciliation_reference_conflict');
   return {id:r.id,state:r.state,variancePence:r.variance_pence,duplicate:true};
  }
  if(b.dueAt<=at())fail(422,'reconciliation_owner_and_deadline_required');
  const ledger=await env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN kind IN ('member_payment','refund_reversal') THEN amount_pence WHEN kind IN ('refund','adjustment_credit') THEN -amount_pence ELSE 0 END),0) total FROM rx_finance_entries WHERE occurred_at>=? AND occurred_at<?").bind(b.fromAt,b.toAt).first();
  if(!Number.isSafeInteger(ledger?.total))fail(409,'reconciliation_ledger_total_invalid');
  const owner=await env.DB.prepare("SELECT id FROM hq_users WHERE id=? AND status='active' AND role IN ('owner','admin','operations')").bind(b.ownerUserId).first();if(!owner)fail(422,'active_finance_owner_required');
  const variance=statement.netReceivedPence-ledger.total,date=at();if(!Number.isSafeInteger(variance))fail(422,'reconciliation_variance_invalid');
  const commands=[env.DB.prepare(`INSERT OR IGNORE INTO rx_reconciliation_runs SELECT ?,?,?,?,?,?,? WHERE ${g.sql}`).bind(id,text(b.fromAt),text(b.toAt),b.sourceReference,variance,variance?'variance':'matched',date,...g.args),env.DB.prepare('INSERT OR IGNORE INTO rx_reconciliation_sources SELECT ?,?,?,?,? WHERE changes()=1').bind(id,statementDigest,requestDigest,ledger.total,date)];
  if(variance)commands.push(env.DB.prepare("INSERT OR IGNORE INTO rx_finance_exceptions SELECT ?,?,'reconciliation_variance','open',?,?,?,? WHERE EXISTS(SELECT 1 FROM rx_reconciliation_sources WHERE run_id=? AND statement_digest=? AND request_digest=?)").bind('recon:'+id,'ALL',b.ownerUserId,b.dueAt,JSON.stringify({variancePence:variance,sourceReference:b.sourceReference,ledgerTotalPence:ledger.total,processorTotalPence:statement.netReceivedPence}),date,id,statementDigest,requestDigest));
  const result=await env.DB.batch(commands),retained=await env.DB.prepare('SELECT r.*,s.statement_digest,s.request_digest FROM rx_reconciliation_runs r JOIN rx_reconciliation_sources s ON s.run_id=r.id WHERE r.id=?').bind(id).first();
  if(!retained)fail(409,'finance_access_changed');
  if(retained.statement_digest!==statementDigest||retained.request_digest!==requestDigest)fail(409,'reconciliation_reference_conflict');
  return {id:retained.id,state:retained.state,variancePence:retained.variance_pence,duplicate:result[0].meta.changes!==1};
 }
 if(request.method==='GET'&&parts.length===1)return {refunds:(await rows(env.DB.prepare('SELECT * FROM rx_refunds ORDER BY updated_at DESC LIMIT 200'))).map(publicRefund),approvalLimitPence:auth.limit,fullCommercial:a.commercial,canReconcileKnownReceipt:Boolean(a.mfa)&&auth.limit>0,paymentSources:await rows(env.DB.prepare("SELECT id,order_number orderReference,amount_pence amountPence FROM rx_lifecycle_payments WHERE state='paid' ORDER BY created_at DESC LIMIT 200")),priceWork:a.commercial?await (await import('./price-adjustments.mjs')).priceWork(env):[],replacementWork:a.commercial?await rows(env.DB.prepare("SELECT l.id,l.record_id recordId,l.order_number orderReference,l.kind,l.version,l.due_at dueAt FROM rx_prescription_lifecycle l LEFT JOIN rx_lifecycle_funding f ON f.lifecycle_id=l.id WHERE l.state='acknowledged' AND f.lifecycle_id IS NULL ORDER BY l.due_at")):[],withdrawalFinanceWork:a.commercial?await rows(env.DB.prepare("SELECT l.id,l.record_id recordId,l.order_number orderReference,l.kind,l.version,l.finance_owner_id ownerUserId,l.due_at dueAt FROM rx_prescription_lifecycle l LEFT JOIN rx_lifecycle_finance_reviews r ON r.lifecycle_id=l.id WHERE l.state IN ('closed','acknowledged','issued') AND r.lifecycle_id IS NULL ORDER BY l.due_at")):[]};
 if(request.method==='POST'&&parts.length===1){
  const b=await readObject(request);text(b.clientReference);text(b.reason,500);text(b.termsReference,300);pence(b.amountPence);if(!b.amountPence)fail(422,'positive_refund_amount_required');
  const order=await env.DB.prepare('SELECT * FROM medicine_orders WHERE order_number=?').bind(b.orderReference).first();if(!order||!['paid','succeeded','completed','fulfilled'].includes(order.status))fail(409,'paid_order_required');if(order.currency!=='GBP')fail(422,'supported_order_currency_required');
  let source={payment_id:null,payment_intent:order.stripe_payment_intent_id,captured_pence:order.total_pence};if(b.paymentSourceId){const payment=await env.DB.prepare("SELECT * FROM rx_lifecycle_payments WHERE id=? AND order_number=? AND member_id=? AND state='paid'").bind(b.paymentSourceId,order.order_number,order.user_id).first();if(!payment)fail(409,'verified_matching_additional_payment_required');source={payment_id:payment.id,payment_intent:payment.payment_intent,captured_pence:payment.amount_pence};}
  if(!/^pi_/.test(source.payment_intent||''))fail(409,'verified_processor_payment_reference_required');
  const payload=await digest({order:order.order_number,amount:b.amountPence,reason:b.reason,terms:b.termsReference,paymentSourceId:source.payment_id});const prior=await env.DB.prepare('SELECT * FROM rx_refunds WHERE idempotency_key=?').bind(b.clientReference).first();
  if(prior){if(prior.payload_digest!==payload)fail(409,'refund_reference_conflict');return {...publicRefund(prior),duplicate:true};}
  const id=crypto.randomUUID(),date=at();
  const result=await env.DB.batch([
   env.DB.prepare(`INSERT INTO rx_refunds SELECT ?,?,?,?,?,?,?,'requested',1,?,NULL,NULL,NULL,?,?,NULL,?,? WHERE ${g.sql} AND ?<=?-COALESCE((SELECT SUM(r.amount_pence) FROM rx_refunds r LEFT JOIN rx_refund_sources s ON s.refund_id=r.id WHERE r.order_number=? AND COALESCE(s.payment_id,'')=? AND r.state NOT IN ('failed','declined','cancelled')),0)`).bind(id,order.order_number,order.user_id,b.amountPence,'GBP',b.reason,b.termsReference,a.id,b.clientReference,payload,date,date,...g.args,b.amountPence,source.captured_pence,order.order_number,source.payment_id||''),
   env.DB.prepare('INSERT INTO rx_refund_sources SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rx_refunds WHERE id=?)').bind(id,source.payment_id,source.payment_intent,source.captured_pence,date,id),
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
 if(parts[2]==='reconcile'&&request.method==='POST'){
  if(!a.mfa)fail(403,'finance_mfa_required');
  if(!['submitted','unknown','requires_action','completed','failed'].includes(r.state)||!/^re_[A-Za-z0-9_]{1,180}$/.test(r.processor_reference||'')||!r.approved_by||!r.approval_reference)fail(409,'known_approved_processor_refund_required');
  if(r.amount_pence>auth.limit)fail(403,'refund_exceeds_approval_authority');
  const currentFinanceGuard=()=>{const current=financeGuard(env,a);if(auth.delegated){current.sql+=" AND EXISTS(SELECT 1 FROM rx_finance_authorities WHERE hq_user_id=? AND expires_at>? AND julianday(expires_at)>julianday('now') AND limit_pence>=?)";current.args.push(a.id,at(),r.amount_pence);}return current;};
  if(r.state==='completed'){
   const cg=currentFinanceGuard(),current=await env.DB.prepare('SELECT 1 present WHERE ('+cg.sql+") AND EXISTS(SELECT 1 FROM rx_refunds WHERE id=? AND version=? AND state='completed')").bind(...cg.args,r.id,r.version).first();
   if(!current)fail(409,'refund_or_access_changed');
   return {...publicRefund(r),reconciled:true,duplicate:true};
  }
  const economics=await validatedRefundEconomics(env,r.order_number),eg=economicsCondition(r.order_number,economics);
  let response;try{response=await processorLookup(env,r);}catch(e){if(e.status)throw e;fail(503,'refund_lookup_unavailable');}
  const receipt=await response.json().catch(()=>null);
  if(!response.ok||!receipt||receipt.id!==r.processor_reference||receipt.object!=='refund'||receipt.livemode===true||!Number.isInteger(receipt.created)||receipt.created<=0||receipt.created>Math.floor(Date.now()/1000)+300||!['pending','requires_action','succeeded','failed','canceled'].includes(receipt.status))fail(502,'refund_lookup_not_verified');
  const source=await env.DB.prepare('SELECT COALESCE(s.payment_intent,m.stripe_payment_intent_id) payment_intent FROM medicine_orders m LEFT JOIN rx_refund_sources s ON s.refund_id=? WHERE m.order_number=?').bind(r.id,r.order_number).first();
  if(receipt.amount!==r.amount_pence||receipt.currency!=='gbp'||receipt.payment_intent!==source?.payment_intent)fail(409,'refund_receipt_does_not_match');
  const reconciliation={termsApprovalReference:economics.approvalReference,termsVersion:economics.version,originalTermsReference:r.terms_reference};
  const event={id:'lookup:'+r.processor_reference+':'+await digest({receipt,reconciliation}),created:receipt.created,data:{object:receipt},reconciliation};
  const cg=currentFinanceGuard(),result=await applyRefundReceipt(env,event,'authenticated_test_api',{refundId:r.id,version:r.version,actorId:a.id,guard:{sql:'('+cg.sql+') AND '+eg.sql,args:[...cg.args,...eg.args]},sourceReference:JSON.stringify({action:'reconcile',eventId:event.id,...reconciliation})});
  return {...publicRefund(await env.DB.prepare('SELECT * FROM rx_refunds WHERE id=?').bind(r.id).first()),reconciled:result.recorded===true||result.duplicate===true,duplicate:result.duplicate===true,stale:result.stale===true};
 }
 if(parts[2]==='submit'&&request.method==='POST'){
  if(!['approved','unknown'].includes(r.state))fail(409,'approved_or_unknown_refund_required');
  if(r.amount_pence>auth.limit)fail(403,'refund_exceeds_approval_authority');
  if(env.SSTRX_ENVIRONMENT!=='synthetic'||env.SSTRX_REFUND_TEST_EXECUTION_ENABLED!=='true')fail(503,'refund_execution_not_authorised');
  const order=await env.DB.prepare('SELECT COALESCE(s.payment_intent,o.stripe_payment_intent_id) stripe_payment_intent_id FROM medicine_orders o LEFT JOIN rx_refund_sources s ON s.refund_id=? WHERE o.order_number=?').bind(r.id,r.order_number).first();if(!/^pi_/.test(order?.stripe_payment_intent_id||''))fail(409,'verified_processor_payment_reference_required');
  const economics=await validatedRefundEconomics(env,r.order_number),eg=economicsCondition(r.order_number,economics);
  const reserved=await env.DB.prepare(`UPDATE rx_refunds SET state='submitting',version=version+1,updated_at=? WHERE id=? AND version=? AND state IN ('approved','unknown') AND ${g.sql} AND ${eg.sql}`).bind(at(),r.id,r.version,...g.args,...eg.args).run();if(reserved.meta.changes!==1)fail(409,'refund_or_access_changed');
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
export async function applyRefundReceipt(env,event,source,command=null){
 if(!['verified_stripe_webhook','authenticated_test_api'].includes(source))fail(403,'verified_processor_receipt_required');
 if(source==='authenticated_test_api'&&env.SSTRX_ENVIRONMENT!=='synthetic')fail(403,'synthetic_receipt_forbidden');
 const object=event.data?.object;if(!object||!/^re_/.test(object.id||'')||!Number.isInteger(event.created))fail(422,'valid_refund_receipt_required');text(event.id,200);
 if(command){
  if(source!=='authenticated_test_api'||!Number.isSafeInteger(command.actorId)||!Number.isSafeInteger(command.version)||!command.guard?.sql||!Array.isArray(command.guard.args))fail(403,'refund_reconciliation_command_required');
  const active=await env.DB.prepare('SELECT 1 present WHERE '+command.guard.sql).bind(...command.guard.args).first();if(!active)fail(409,'refund_terms_or_access_changed');
  const current=await env.DB.prepare('SELECT version FROM rx_refunds WHERE id=?').bind(command.refundId).first();if(current?.version!==command.version)fail(409,'refund_changed');
 }
 const payload=await digest(event),prior=await env.DB.prepare('SELECT payload_digest FROM rx_refund_receipts WHERE event_id=?').bind(event.id).first();if(prior){if(prior.payload_digest!==payload)fail(409,'processor_event_conflict');return {duplicate:true};}
 const r=await env.DB.prepare('SELECT r.*,COALESCE(s.payment_intent,m.stripe_payment_intent_id) stripe_payment_intent_id FROM rx_refunds r JOIN medicine_orders m ON m.order_number=r.order_number LEFT JOIN rx_refund_sources s ON s.refund_id=r.id WHERE r.processor_reference=?').bind(object.id).first();if(!r)fail(404,'submitted_refund_not_found');
 if(command&&(command.refundId!==r.id||command.version!==r.version))fail(409,'refund_changed');
 if(object.amount!==r.amount_pence||object.currency!=='gbp'||object.payment_intent!==r.stripe_payment_intent_id)fail(409,'refund_receipt_does_not_match');
 const last=await env.DB.prepare('SELECT MAX(occurred_at) at FROM rx_refund_receipts WHERE refund_id=?').bind(r.id).first();if(last?.at>event.created)return {stale:true};
 const next=object.status==='succeeded'?'completed':['failed','canceled'].includes(object.status)?'failed':object.status==='requires_action'?'requires_action':'submitted';
 if(r.state==='completed'&&next==='submitted')return {stale:true};
 if(r.state==='failed'&&next!=='failed')return {stale:true};
 const date=at(),v=r.version+1,sql=[
  env.DB.prepare('UPDATE rx_refunds SET state=?,version=?,last_error=?,updated_at=? WHERE id=? AND version=? AND NOT EXISTS(SELECT 1 FROM rx_refund_receipts WHERE refund_id=? AND occurred_at>?)'+(command?' AND ('+command.guard.sql+')':'')).bind(next,v,next==='failed'?'processor_refund_failed':null,date,r.id,r.version,r.id,event.created,...command?command.guard.args:[]),
  env.DB.prepare('INSERT INTO rx_refund_receipts SELECT ?,?,?,?,?,?,? WHERE changes()=1').bind(event.id,r.id,object.id,payload,object.status,event.created,date),
  env.DB.prepare('INSERT INTO rx_refund_events SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rx_refund_receipts WHERE event_id=?)').bind(crypto.randomUUID(),r.id,v,next,command?.sourceReference||event.id,command?.actorId||null,date,event.id)
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
