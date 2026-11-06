// One original capture is projected into the existing order ledger from the
// immutable native payment receipt. No payment, refund or settlement is sent.
import {digest,fail} from './domain.mjs';
const fictional=v=>typeof v==='string'&&/@example\.(?:test|invalid)$/.test(v);
const paid=['paid','succeeded','completed','fulfilled'];
const primaryPayment="kind='member_payment' AND event_reference NOT LIKE 'price-payment:%'";
const canonicalDate=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
async function modeFor(env,order){
 if(env.SSTRX_ENVIRONMENT==='synthetic'&&env.STRIPE_MODE==='test'){
  const member=await env.DB.prepare('SELECT email FROM users WHERE id=?').bind(order.user_id).first();
  return fictional(member?.email)&&fictional(order.email)&&order.variant_id===9911&&/^(?:TEST[- ]|Synthetic )/.test(order.medicine_name||'')?'test':null;
 }
 return env.SSTRX_ENVIRONMENT==='production'&&env.STRIPE_MODE==='live'&&env.SSTRX_ORIGINAL_CAPTURE_LEDGER_ENABLED==='true'&&env.SSTRX_ORIGINAL_CAPTURE_LEDGER_APPROVAL_REFERENCE?'live':null;
}
export async function originalCaptureContext(env,order){
 const mode=await modeFor(env,order);if(!mode)return {state:'unavailable',reason:'original_capture_ledger_not_enabled'};
 if(!paid.includes(order.status))return {state:'unavailable',reason:'verified_paid_order_required'};
 const exists=await env.DB.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='medicine_payment_receipts'").first();
 if(!exists)return {state:'unavailable',reason:'native_capture_receipt_unavailable'};
 const receipts=(await env.DB.prepare('SELECT * FROM medicine_payment_receipts WHERE order_number=? ORDER BY received_at,event_id LIMIT 1001').bind(order.order_number).all()).results||[];
 if(!receipts.length)return {state:'unavailable',reason:'native_capture_receipt_unavailable'};
 if(receipts.length>1000)fail(409,'native_capture_receipt_cohort_requires_review');
 const prefix=mode==='test'?'cs_test_':'cs_live_';
 if(!String(order.stripe_checkout_session_id).startsWith(prefix)||!/^pi_[A-Za-z0-9_]+$/.test(order.stripe_payment_intent_id||'')||mode==='test'&&!/^pi_test_QA_[a-f0-9]{32}$/.test(order.stripe_payment_intent_id||''))fail(409,'native_capture_order_reference_conflict');
 for(const r of receipts){
  if(r.session_id!==order.stripe_checkout_session_id||r.payment_intent!==order.stripe_payment_intent_id||r.mode!==mode||r.currency!=='GBP'||order.currency!=='GBP'||!Number.isSafeInteger(r.amount_pence)||r.amount_pence<=0||r.amount_pence!==order.total_pence||!/^[a-f0-9]{64}$/.test(r.payload_digest||'')||!r.event_id||!canonicalDate(r.occurred_at)||!canonicalDate(r.received_at)||Date.parse(r.occurred_at)>Date.parse(r.received_at)+300000||Date.parse(r.received_at)>Date.now())fail(409,'native_capture_receipt_conflict');
 }
 const receipt=receipts[0],eventReference='medicine-capture:'+await digest({order:order.order_number,intent:order.stripe_payment_intent_id}),sourceReference='medicine-receipt:'+receipt.event_id;
 const existing=(await env.DB.prepare('SELECT * FROM rx_finance_entries WHERE order_number=? AND '+primaryPayment).bind(order.order_number).all()).results||[];
 if(existing.length){
  if(existing.length===1&&existing[0].event_reference===eventReference&&existing[0].amount_pence===receipt.amount_pence&&existing[0].currency==='GBP'&&existing[0].source_reference===sourceReference&&existing[0].occurred_at===receipt.occurred_at)return {state:'recorded',duplicate:true,entryId:existing[0].id,amountPence:receipt.amount_pence};
  fail(409,'existing_original_payment_entry_requires_review');
 }
 const guard={
  sql:"EXISTS(SELECT 1 FROM medicine_orders WHERE order_number=? AND user_id=? AND stripe_checkout_session_id=? AND stripe_payment_intent_id=? AND total_pence=? AND currency='GBP' AND status IN ('paid','succeeded','completed','fulfilled')) AND EXISTS(SELECT 1 FROM medicine_payment_receipts WHERE event_id=? AND order_number=? AND payload_digest=? AND occurred_at=? AND received_at=?) AND NOT EXISTS(SELECT 1 FROM medicine_payment_receipts WHERE order_number=? AND (NOT (session_id IS ? AND payment_intent IS ? AND mode IS ? AND amount_pence IS ? AND currency IS 'GBP') OR payload_digest IS NULL OR length(payload_digest)<>64 OR payload_digest GLOB '*[^0-9a-f]*')) AND NOT EXISTS(SELECT 1 FROM rx_finance_entries WHERE order_number=? AND "+primaryPayment+")",
  args:[order.order_number,order.user_id,order.stripe_checkout_session_id,order.stripe_payment_intent_id,order.total_pence,receipt.event_id,order.order_number,receipt.payload_digest,receipt.occurred_at,receipt.received_at,order.order_number,order.stripe_checkout_session_id,order.stripe_payment_intent_id,mode,receipt.amount_pence,order.order_number]
 };
 return {state:'ready',orderNumber:order.order_number,amountPence:receipt.amount_pence,sourceReference,eventReference,occurredAt:receipt.occurred_at,receiptId:receipt.event_id,receiptDigest:receipt.payload_digest,entryId:'capture:'+await digest(eventReference),guard};
}
export function originalCaptureEntry(DB,c,auditId,date){
 return DB.prepare("INSERT INTO rx_finance_entries SELECT ?,?,?,'member_payment',?,'GBP',?,?,? WHERE EXISTS(SELECT 1 FROM rx_platform_audit WHERE id=?)").bind(c.entryId,c.orderNumber,c.eventReference,c.amountPence,c.sourceReference,c.occurredAt,date,auditId);
}
export async function recordOriginalCapture(env,actor,order,authority){
 const context=await originalCaptureContext(env,order);if(context.state==='recorded')return {...context,moneyMoved:false};
 if(context.state!=='ready')fail(409,context.reason);
 const economics=await env.DB.prepare('SELECT version,terms_json FROM rx_economics WHERE order_number=?').bind(order.order_number).first();if(!economics)fail(409,'order_economics_required_for_capture_ledger');
 let terms;try{terms=JSON.parse(economics.terms_json)}catch{fail(409,'valid_order_economics_required_for_capture_ledger')}
 if(terms.sellingPence!==order.total_pence||terms.currency!=='GBP')fail(409,'matching_order_economics_required_for_capture_ledger');
 const date=new Date().toISOString(),auditId=crypto.randomUUID();
 const audit=env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,NULL,'finance_entry',?,'original_capture_recorded',?,? WHERE "+authority.sql+" AND "+context.guard.sql+" AND EXISTS(SELECT 1 FROM rx_economics WHERE order_number=? AND version=? AND terms_json=?)").bind(auditId,String(actor.id),order.order_number,JSON.stringify({entryId:context.entryId,receiptId:context.receiptId,receiptDigest:context.receiptDigest,amountPence:context.amountPence,moneyMoved:false}),date,...authority.args,...context.guard.args,order.order_number,economics.version,economics.terms_json);
 const written=await env.DB.batch([audit,originalCaptureEntry(env.DB,context,auditId,date)]);
 if(written[0].meta.changes!==1)fail(409,'capture_source_economics_or_access_changed');
 return {state:'recorded',entryId:context.entryId,amountPence:context.amountPence,moneyMoved:false};
}
export async function originalCaptureWork(env){
 const unavailable=reason=>({state:'unavailable',reason,records:[],limit:100,hasMore:false});
 if(env.SSTRX_ENVIRONMENT!=='synthetic'||env.STRIPE_MODE!=='test')return unavailable('original_capture_ledger_not_enabled');
 const exists=await env.DB.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='medicine_payment_receipts'").first();if(!exists)return unavailable('native_capture_receipt_unavailable');
 // One bounded source query; the mutation revalidates the exact receipts and
 // authority. A worklist must not perform hundreds of per-order DB requests.
 const rows=(await env.DB.prepare("SELECT m.order_number,m.total_pence,COUNT(*) receipt_count,EXISTS(SELECT 1 FROM rx_economics e WHERE e.order_number=m.order_number) has_terms,(SELECT CASE WHEN json_valid(e.terms_json) THEN CASE WHEN json_extract(e.terms_json,'$.sellingPence')=m.total_pence AND json_extract(e.terms_json,'$.currency')='GBP' THEN 0 ELSE 1 END ELSE 1 END FROM rx_economics e WHERE e.order_number=m.order_number) terms_invalid,MIN(r.occurred_at) occurred_at,SUM(CASE WHEN r.session_id IS m.stripe_checkout_session_id AND r.payment_intent IS m.stripe_payment_intent_id AND r.mode IS 'test' AND r.currency IS 'GBP' AND m.currency IS 'GBP' AND r.amount_pence IS m.total_pence AND r.amount_pence>0 AND length(r.payload_digest)=64 AND r.payload_digest NOT GLOB '*[^0-9a-f]*' AND strftime('%Y-%m-%dT%H:%M:%fZ',r.occurred_at) IS r.occurred_at AND strftime('%Y-%m-%dT%H:%M:%fZ',r.received_at) IS r.received_at AND julianday(r.occurred_at)<=julianday(r.received_at)+5.0/1440 AND julianday(r.received_at)<=julianday('now') AND length(m.stripe_payment_intent_id)=43 AND substr(m.stripe_payment_intent_id,12) NOT GLOB '*[^0-9a-f]*' THEN 0 ELSE 1 END) conflicts FROM medicine_orders m JOIN users u ON u.id=m.user_id JOIN medicine_payment_receipts r ON r.order_number=m.order_number WHERE m.variant_id=9911 AND (m.medicine_name GLOB 'TEST-*' OR m.medicine_name GLOB 'TEST *' OR m.medicine_name GLOB 'Synthetic *') AND (u.email GLOB '*@example.test' OR u.email GLOB '*@example.invalid') AND (m.email GLOB '*@example.test' OR m.email GLOB '*@example.invalid') AND m.status IN ('paid','succeeded','completed','fulfilled') AND m.stripe_checkout_session_id GLOB 'cs_test_QA_*' AND m.stripe_payment_intent_id GLOB 'pi_test_QA_*' AND NOT EXISTS(SELECT 1 FROM rx_finance_entries e WHERE e.order_number=m.order_number AND e.kind='member_payment' AND e.event_reference NOT LIKE 'price-payment:%') GROUP BY m.order_number ORDER BY m.created_at DESC LIMIT 101").all()).results||[];
 return {state:'available',records:rows.slice(0,100).map(row=>({orderReference:row.order_number,amountPence:row.total_pence,occurredAt:row.occurred_at,state:row.conflicts||row.receipt_count>1000||row.terms_invalid?'requires_review':row.has_terms?'ready':'terms_required'})),limit:100,hasMore:rows.length>100};
}
