// A durable, isolated provider double. It uses the same adapter and canonical
// receipt boundary as a commissioned provider, and cannot open a network socket.
import {qaDatabaseAdmitted} from './database-boundary.mjs';
import {fail,digest} from '../platform/domain.mjs';
const KEY='FICTIONAL-QA-PROVIDER-ONLY-NOT-A-CREDENTIAL';
const iso=()=>new Date().toISOString();
async function admitted(env){if(env.SSTRX_QA_FULFILMENT_ENABLED!=='true'||env.SSTRX_CANONICAL_RECEIPTS_ENABLED!=='true'||!await qaDatabaseAdmitted(env))fail(503,'isolated_stub_provider_required');}
async function route(env,order,prescription){
 await admitted(env);
 const r=await env.DB.prepare("SELECT r.*,m.email,m.medicine_name,m.stripe_checkout_session_id FROM rx_order_routes r JOIN medicine_orders m ON m.order_number=r.order_number AND m.user_id=r.member_id WHERE r.order_number=?").bind(order).first();
 if(!r||prescription&&r.prescription_id!==prescription||!/@example\.(?:test|invalid)$/.test(r.email)||!/^(?:TEST[- ]|Synthetic )/.test(r.medicine_name)||!/^cs_test_/.test(r.stripe_checkout_session_id||''))fail(403,'fictional_stub_route_required');
 const c=await env.DB.prepare("SELECT * FROM rx_supplier_contracts WHERE id=? AND adapter_id='synthetic' AND state='approved'").bind(r.contract_id).first();
 if(!c||c.version!==r.contract_version)fail(409,'stub_contract_changed');return r;
}
async function schema(DB){
 await DB.prepare('CREATE TABLE IF NOT EXISTS qa_stub_submissions(idempotency_key TEXT PRIMARY KEY,request_digest TEXT NOT NULL,order_number TEXT NOT NULL,prescription_id TEXT NOT NULL,remote_reference TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL)').run();
 await DB.prepare('CREATE TABLE IF NOT EXISTS qa_stub_receipts(event_reference TEXT PRIMARY KEY,request_digest TEXT NOT NULL,raw TEXT NOT NULL,proof TEXT NOT NULL,created_at TEXT NOT NULL)').run();
}
async function hmac(raw){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(KEY),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);return {key,bytes:new TextEncoder().encode(raw)};}
export function qaStubProvider(env){return {id:'synthetic',mode:'synthetic',version:'sst-rx-event-v1',
 async submit(p){
  const r=await route(env,p.orderReference,p.prescriptionReference);
  const job=await env.DB.prepare('SELECT id FROM rx_integration_jobs WHERE idempotency_key=? AND order_number=?').bind(p.idempotencyKey,r.order_number).first();
  if(p.apiVersion!=='sst-rx-v1'||!job||await digest(p.product)!==await digest(JSON.parse(r.product_mapping_json)))fail(409,'stub_native_submission_required');
  await schema(env.DB);const hash=await digest({apiVersion:p.apiVersion,orderReference:p.orderReference,prescriptionReference:p.prescriptionReference,product:p.product}),ref='TEST-STUB-'+(await digest(p.idempotencyKey)).slice(0,24);
  await env.DB.prepare('INSERT OR IGNORE INTO qa_stub_submissions VALUES(?,?,?,?,?,?)').bind(p.idempotencyKey,hash,r.order_number,r.prescription_id,ref,iso()).run();
  const saved=await env.DB.prepare('SELECT * FROM qa_stub_submissions WHERE idempotency_key=?').bind(p.idempotencyKey).first();if(saved.request_digest!==hash)fail(409,'stub_idempotency_conflict');
  return {accepted:true,reference:saved.remote_reference,simulation:true,pharmacyAcceptanceConfirmed:false};
 },
 async reconcile(p){
  await route(env,p.orderReference);await schema(env.DB);const r=await env.DB.prepare('SELECT remote_reference FROM qa_stub_submissions WHERE idempotency_key=? AND order_number=?').bind(p.idempotencyKey,p.orderReference).first();
  return r?{known:true,accepted:true,reference:r.remote_reference,simulation:true,pharmacyAcceptanceConfirmed:false}:{known:false,simulation:true};
 },
 async createEvent(p){
  const r=await route(env,p.orderReference);if(p.contractId!==r.contract_id||!Number.isSafeInteger(p.sourceRecordVersion)||p.sourceRecordVersion<1)fail(422,'stub_episode_version_required');
  await schema(env.DB);const submission=await env.DB.prepare('SELECT remote_reference FROM qa_stub_submissions WHERE order_number=? AND prescription_id=?').bind(r.order_number,r.prescription_id).first();if(!submission)fail(409,'stub_transport_receipt_required');
  const kinds=['received','accepted','clarification','rejected','stock_unavailable','dispensing','dispensed','dispatched','delivered','delivery_exception','returned'];if(!kinds.includes(p.kind))fail(422,'unsupported_supplier_event');
  const record=await env.DB.prepare('SELECT id FROM clinical_member_records WHERE order_number=? AND user_id=?').bind(r.order_number,r.member_id).first();if(!record)fail(409,'stub_owned_case_required');
  const eventReference='TEST-STUB-EVENT-'+await digest([r.contract_id,r.order_number,r.prescription_id,p.sourceRecordVersion]);
  const command={kind:p.kind,sourceRecordVersion:p.sourceRecordVersion,tracking:p.tracking||null,memberMessage:p.memberMessage||null};const commandHash=await digest(command);
  const e={...command,contractId:r.contract_id,eventReference,orderReference:r.order_number,occurredAt:iso(),schemaVersion:'sst-rx-event-v1',prescriptionReference:r.prescription_id,caseReference:record.id,idempotencyKey:eventReference,remoteReference:submission.remote_reference};
  const raw=JSON.stringify(e),m=await hmac(raw),proof=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',m.key,m.bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  await env.DB.prepare('INSERT OR IGNORE INTO qa_stub_receipts VALUES(?,?,?,?,?)').bind(eventReference,commandHash,raw,proof,iso()).run();
  const saved=await env.DB.prepare('SELECT * FROM qa_stub_receipts WHERE event_reference=?').bind(eventReference).first();if(saved.request_digest!==commandHash)fail(409,'stub_receipt_reference_conflict');return {raw:saved.raw,proof:saved.proof};
 },
 async verifyWebhook(raw,proof){
  await admitted(env);let valid=false;const m=await hmac(raw);if(/^[a-f0-9]{64}$/.test(proof||'')){const bytes=Uint8Array.from(proof.match(/../g),x=>parseInt(x,16));valid=await crypto.subtle.verify('HMAC',m.key,bytes,m.bytes);}
  if(!valid)return {verified:false};const e=JSON.parse(raw);const r=await route(env,e.orderReference,e.prescriptionReference);return {verified:e.contractId===r.contract_id,contractId:r.contract_id,event:e};
 }
};}
