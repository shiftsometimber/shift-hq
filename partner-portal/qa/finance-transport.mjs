// Private-QA processor double over existing native refund and capture records.
// No network, account, ledger or refund authorisation is supplied by this module.
import {qaDatabaseAdmitted} from './database-boundary.mjs';
import {digest} from '../platform/domain.mjs';
const forbiddenDatabase='88f40aed-cb23-4372-8c94-8a73f48bc847';
const fictional=email=>typeof email==='string'&&/@example\.(?:test|invalid)$/.test(email);
const deny=(error,status=403)=>Response.json({error,simulation:true},{status});
async function admitted(env){
 if(env.SSTRX_QA_REFUNDS_ENABLED!=='true'||env.STRIPE_MODE!=='test'||env.SSTRX_PRICE_PAYMENT_MODE==='live'||env.STRIPE_SECRET_KEY||env.SSTRX_QA_DATABASE_ID===forbiddenDatabase||!await qaDatabaseAdmitted(env))throw Error('isolated_qa_refund_transport_required');
}
async function schema(DB){
 await DB.prepare('CREATE TABLE IF NOT EXISTS qa_simulated_refunds(idempotency_key TEXT PRIMARY KEY,refund_id TEXT NOT NULL UNIQUE,request_digest TEXT NOT NULL,response_json TEXT NOT NULL,created_at TEXT NOT NULL)').run();
 for(const action of ['UPDATE','DELETE'])await DB.prepare("CREATE TRIGGER IF NOT EXISTS qa_simulated_refunds_no_"+action.toLowerCase()+" BEFORE "+action+" ON qa_simulated_refunds BEGIN SELECT RAISE(ABORT,'immutable_qa_refund_receipt'); END").run();
}
const priceSourceFrom=" FROM rx_lifecycle_payments p JOIN rx_lifecycle_payment_sources s ON s.payment_id=p.id JOIN qa_simulated_price_checkouts q ON q.payment_id=p.id JOIN qa_simulated_price_outcomes o ON o.payment_id=p.id JOIN rx_lifecycle_payment_receipts n ON n.payment_id=p.id AND n.event_id=o.event_id";
async function captureProof(env,row){
 if(row.payment_id===null){
  // Retain the original-payment contract and its independent source references.
  if(row.captured_pence!==row.total_pence||row.payment_intent!==row.stripe_payment_intent_id||!/^pi_test_QA_[a-f0-9]{32}$/.test(row.payment_intent||'')||!/^cs_test_QA_[a-f0-9]{32}$/.test(row.stripe_checkout_session_id||''))return null;
  const captures=await env.DB.prepare("SELECT amount_pence,currency,payload_digest FROM medicine_payment_receipts WHERE order_number=? AND session_id=? AND payment_intent=? AND mode='test'").bind(row.order_number,row.stripe_checkout_session_id,row.payment_intent).all();
  if(!(captures.results||[]).length||(captures.results||[]).some(c=>c.amount_pence!==row.total_pence||c.currency!=='GBP'||!/^[a-f0-9]{64}$/.test(c.payload_digest||'')))return null;
  return {kind:'original'};
 }
 if(typeof row.payment_id!=='string'||!Number.isSafeInteger(row.captured_pence)||row.captured_pence<=0)return null;
 const tables=await env.DB.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('rx_lifecycle_payments','rx_lifecycle_payment_sources','qa_simulated_price_checkouts','qa_simulated_price_outcomes','rx_lifecycle_payment_receipts')").first();
 if(tables.n!==5)return null;
 const p=await env.DB.prepare('SELECT p.*,s.source_json,q.id checkout_id,q.lifecycle_id checkout_lifecycle,q.order_number checkout_order,q.member_id checkout_member,q.idempotency_key checkout_key,q.request_digest checkout_digest,q.session_json,o.event_id capture_event_id,o.action capture_action,o.event_json,o.payload_digest capture_digest,o.occurred_at capture_time,n.payload_digest native_digest,n.state native_state,n.occurred_at native_time'+priceSourceFrom+' WHERE p.id=?').bind(row.payment_id).first();
 if(!p)return null;
 let source,session,event;try{source=JSON.parse(p.source_json);session=JSON.parse(p.session_json);event=JSON.parse(p.event_json)}catch{return null}
 const identity=(await digest(p.id)).slice(0,32),expectedIntent='pi_test_QA_'+identity,expectedSession='cs_test_QA_price_'+identity,expectedEvent='evt_test_QA_price_'+identity;
 const object=event.data?.object;
 // Historical consent may have expired or been superseded. Refund eligibility
 // is based on the retained paid capture, never today's price plan/agreement.
 if(p.state!=='paid'||p.member_id!==row.member_id||p.order_number!==row.order_number||p.amount_pence!==row.captured_pence||p.payment_intent!==row.payment_intent||p.payment_intent!==expectedIntent||p.session_id!==expectedSession||!Number.isSafeInteger(p.version)||p.version<1||source?.kind!=='qa'||source.mode!=='test'||source.qaContract!=='sstrx-durable-price-test-v1'||source.qaOrigin!=='https://my-qa.sstrx.co.uk'||!Number.isSafeInteger(source.planVersion)||!Number.isSafeInteger(source.agreementVersion)||p.checkout_id!==p.session_id||p.checkout_lifecycle!==p.lifecycle_id||p.checkout_order!==p.order_number||p.checkout_member!==p.member_id||p.checkout_key!==p.idempotency_key||p.checkout_key!=='rx-price:'+p.lifecycle_id+':'+p.id||!/^[a-f0-9]{64}$/.test(p.checkout_digest||'')||session.id!==p.session_id||session.object!=='checkout.session'||session.mode!=='payment'||session.status!=='open'||session.payment_status!=='unpaid'||session.livemode!==false||session.simulation!==true||session.qaContract!==source.qaContract||session.client_reference_id!==p.id||session.metadata?.sst_price_payment_id!==p.id||session.metadata?.sst_lifecycle_id!==p.lifecycle_id||session.metadata?.order_reference!==p.order_number||session.amount_total!==p.amount_pence||session.currency!=='gbp'||session.url!==source.qaOrigin+'/member/qa-price-checkout/'+p.id||p.capture_action!=='complete'||p.capture_event_id!==expectedEvent||event.id!==expectedEvent||event.type!=='checkout.session.completed'||event.livemode!==false||!Number.isSafeInteger(event.created)||event.created<=0||event.created>Math.floor(Date.now()/1000)+300||event.created!==p.capture_time||await digest(event)!==p.capture_digest||p.native_digest!==p.capture_digest||p.native_state!=='paid'||p.native_time!==event.created||JSON.stringify(object)!==JSON.stringify({...session,status:'complete',payment_status:'paid',payment_intent:expectedIntent}))return null;
 const guard={sql:"EXISTS(SELECT 1"+priceSourceFrom+" JOIN rx_refunds r ON r.id=? JOIN rx_refund_sources rs ON rs.refund_id=r.id JOIN medicine_orders m ON m.order_number=r.order_number JOIN users u ON u.id=m.user_id WHERE p.id=? AND p.version=? AND p.state='paid' AND p.order_number=? AND p.member_id=? AND p.amount_pence=? AND p.payment_intent=? AND p.session_id=? AND s.source_json=? AND q.id=? AND q.lifecycle_id=p.lifecycle_id AND q.order_number=p.order_number AND q.member_id=p.member_id AND q.idempotency_key=p.idempotency_key AND q.request_digest=? AND q.session_json=? AND o.event_id=? AND o.action='complete' AND o.event_json=? AND o.payload_digest=? AND o.occurred_at=? AND n.state='paid' AND n.payload_digest=o.payload_digest AND n.occurred_at=o.occurred_at AND r.version=? AND r.amount_pence=? AND r.approved_by=? AND r.approval_reference=? AND r.idempotency_key=? AND r.state IN ('submitting','unknown','submitted','completed') AND rs.payment_id=p.id AND rs.payment_intent=p.payment_intent AND rs.captured_pence=p.amount_pence AND r.member_id=p.member_id AND r.order_number=p.order_number AND m.user_id=p.member_id AND m.variant_id=9911 AND m.currency='GBP' AND m.email=? AND u.email=?)",
  args:[row.id,p.id,p.version,p.order_number,p.member_id,p.amount_pence,p.payment_intent,p.session_id,p.source_json,p.checkout_id,p.checkout_digest,p.session_json,p.capture_event_id,p.event_json,p.capture_digest,p.capture_time,row.version,row.amount_pence,row.approved_by,row.approval_reference,row.idempotency_key,row.order_email,row.member_email]};
 return {kind:'additional',paymentId:p.id,eventId:event.id,payloadDigest:p.capture_digest,guard};
}
function digestBody(row,key,proof){return {key,id:row.id,order:row.order_number,paymentIntent:row.payment_intent,amount:row.amount_pence,...proof.kind==='additional'?{paymentSourceId:proof.paymentId,captureEventId:proof.eventId,captureDigest:proof.payloadDigest}:{}};}
async function readKnownRefund(env,request,reference){
 // Read only: never create a missing provider table or issue another refund.
 const present=await env.DB.prepare("SELECT 1 present FROM sqlite_master WHERE name='qa_simulated_refunds' AND type='table'").first();
 if(!present)return deny('qa_refund_receipt_not_found',404);
 const row=await env.DB.prepare('SELECT r.*,s.payment_id,s.payment_intent,s.captured_pence,m.user_id,m.variant_id,m.medicine_name,m.email order_email,m.stripe_checkout_session_id,m.stripe_payment_intent_id,m.total_pence,m.currency order_currency,u.email member_email,q.request_digest,q.response_json,q.created_at receipt_created_at FROM rx_refunds r JOIN qa_simulated_refunds q ON q.refund_id=r.id JOIN rx_refund_sources s ON s.refund_id=r.id JOIN medicine_orders m ON m.order_number=r.order_number JOIN users u ON u.id=m.user_id WHERE r.processor_reference=?').bind(reference).first();
 if(!row)return deny('qa_refund_receipt_not_found',404);
 const key=request.headers.get('Idempotency-Key');
 if(!fictional(row.member_email)||!fictional(row.order_email)||row.variant_id!==9911||!/^TEST[- ]/.test(row.medicine_name)||row.member_id!==row.user_id||row.currency!=='GBP'||String(row.order_currency).toUpperCase()!=='GBP'||row.idempotency_key!==key||!key||!row.approved_by||!row.approval_reference||!['unknown','submitted','completed','requires_action','failed'].includes(row.state))return deny('approved_owned_fictional_refund_required');
 if(!Number.isSafeInteger(row.amount_pence)||row.amount_pence<=0||row.amount_pence>row.captured_pence)return deny('qa_refund_capture_mismatch');
 const proof=await captureProof(env,row);if(!proof)return deny('native_qa_capture_receipt_required');
 const requestDigest=await digest(digestBody(row,key,proof));
 let response;try{response=JSON.parse(row.response_json)}catch{return deny('qa_refund_receipt_corrupt',409)}
 const created=Math.floor(Date.parse(row.receipt_created_at)/1000);
 if(requestDigest!==row.request_digest||response.id!==reference||response.id!=='re_test_QA_'+(await digest(key)).slice(0,32)||response.object!=='refund'||response.amount!==row.amount_pence||response.currency!=='gbp'||response.payment_intent!==row.payment_intent||response.status!=='succeeded'||response.livemode!==false||response.simulation!==true||!Number.isInteger(created)||created<=0||proof.kind==='additional'&&(response.qaCapture?.paymentId!==proof.paymentId||response.qaCapture?.eventId!==proof.eventId||response.qaCapture?.payloadDigest!==proof.payloadDigest))return deny('qa_refund_receipt_mismatch',409);
 return Response.json({...response,created},{headers:{'Cache-Control':'no-store, private'}});
}
export function qaRefundTransport(env){return {async fetch(request){
 await admitted(env);
 const url=new URL(request.url);
 const read=url.pathname.match(/^\/v1\/refunds\/(re_test_QA_[a-f0-9]{32})$/);
 if(request.method==='GET'&&url.origin==='https://api.stripe.com'&&!url.search&&!url.hash&&read)return readKnownRefund(env,request,read[1]);
 if(url.href!=='https://api.stripe.com/v1/refunds'||request.method!=='POST')return deny('qa_refund_route_not_admitted');
 const raw=await request.text();if(raw.length>8192)return deny('qa_refund_request_too_large',413);
 const body=new URLSearchParams(raw),allowed=['payment_intent','amount','metadata[sst_refund_id]','metadata[order_reference]'];
 if([...body.keys()].some(k=>!allowed.includes(k))||allowed.some(k=>body.getAll(k).length!==1))return deny('qa_refund_fields_required',400);
 const key=request.headers.get('Idempotency-Key'),id=body.get('metadata[sst_refund_id]'),order=body.get('metadata[order_reference]');
 const row=await env.DB.prepare('SELECT r.*,s.payment_id,s.payment_intent,s.captured_pence,m.user_id,m.variant_id,m.medicine_name,m.email order_email,m.stripe_checkout_session_id,m.stripe_payment_intent_id,m.total_pence,m.currency order_currency,u.email member_email FROM rx_refunds r JOIN rx_refund_sources s ON s.refund_id=r.id JOIN medicine_orders m ON m.order_number=r.order_number JOIN users u ON u.id=m.user_id WHERE r.id=? AND r.order_number=?').bind(id,order).first();
 if(!row||!fictional(row.member_email)||!fictional(row.order_email)||row.variant_id!==9911||!/^TEST[- ]/.test(row.medicine_name)||row.member_id!==row.user_id||row.currency!=='GBP'||String(row.order_currency).toUpperCase()!=='GBP'||row.idempotency_key!==key||!key||!row.approved_by||!row.approval_reference||!['submitting','unknown','submitted','completed'].includes(row.state))return deny('approved_owned_fictional_refund_required');
 const amount=Number(body.get('amount'));
 if(!/^[1-9]\d*$/.test(body.get('amount')||'')||!Number.isSafeInteger(amount)||amount!==row.amount_pence||amount>row.captured_pence||body.get('payment_intent')!==row.payment_intent)return deny('qa_refund_capture_mismatch');
 const proof=await captureProof(env,row);if(!proof)return deny('native_qa_capture_receipt_required');
 const requestDigest=await digest(digestBody(row,key,proof)),response={id:'re_test_QA_'+(await digest(key)).slice(0,32),object:'refund',amount,currency:'gbp',payment_intent:row.payment_intent,status:'succeeded',livemode:false,simulation:true,...proof.kind==='additional'?{qaCapture:{paymentId:proof.paymentId,eventId:proof.eventId,payloadDigest:proof.payloadDigest}}:{}};
 await schema(env.DB);
 if(proof.kind==='original'){
  await env.DB.prepare('INSERT OR IGNORE INTO qa_simulated_refunds VALUES(?,?,?,?,?)').bind(key,id,requestDigest,JSON.stringify(response),new Date().toISOString()).run();
 }else{
  // The provider's retained outcomes, not native refund states, enforce the
  // remaining capture balance. One atomic statement serialises competing keys.
  const sourceBalance="NOT EXISTS(SELECT 1 FROM qa_simulated_refunds WHERE CASE WHEN json_valid(response_json) THEN CASE WHEN json_extract(response_json,'$.payment_intent')=? AND (json_type(response_json,'$.amount') IS NOT 'integer' OR json_extract(response_json,'$.amount')<=0 OR json_extract(response_json,'$.amount')>9007199254740991 OR json_extract(response_json,'$.object') IS NOT 'refund' OR json_extract(response_json,'$.status') IS NOT 'succeeded' OR json_extract(response_json,'$.currency') IS NOT 'gbp' OR json_extract(response_json,'$.livemode') IS NOT 0 OR json_extract(response_json,'$.simulation') IS NOT 1) THEN 1 ELSE 0 END ELSE 1 END) AND ?<=?-COALESCE((SELECT SUM(json_extract(response_json,'$.amount')) FROM qa_simulated_refunds WHERE json_extract(response_json,'$.payment_intent')=? AND idempotency_key<>?),0)";
  await env.DB.prepare('INSERT OR IGNORE INTO qa_simulated_refunds SELECT ?,?,?,?,? WHERE '+proof.guard.sql+' AND '+sourceBalance).bind(key,id,requestDigest,JSON.stringify(response),new Date().toISOString(),...proof.guard.args,row.payment_intent,amount,row.captured_pence,row.payment_intent,key).run();
 }
 const saved=await env.DB.prepare('SELECT refund_id,request_digest,response_json FROM qa_simulated_refunds WHERE idempotency_key=?').bind(key).first();
 if(!saved||saved.refund_id!==id||saved.request_digest!==requestDigest)return deny(proof.kind==='additional'?'qa_refund_capture_or_limit_changed':'qa_refund_idempotency_conflict',409);
 return Response.json(JSON.parse(saved.response_json),{headers:{'Cache-Control':'no-store, private'}});
}};}
export async function qaRefundEnvironment(env){
 if(env.SSTRX_QA_REFUNDS_ENABLED!=='true')return env;
 await admitted(env);
 if(env.REFUND_TEST_TRANSPORT||env.SSTRX_REFUND_TEST_EXECUTION_ENABLED)throw Error('qa_refund_binding_already_supplied');
 return {...env,SSTRX_REFUND_TEST_EXECUTION_ENABLED:'true',REFUND_TEST_TRANSPORT:qaRefundTransport(env)};
}
