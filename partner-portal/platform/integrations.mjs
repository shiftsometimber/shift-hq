import {internalPrescriptionDocument} from '../service/clinical-kernel.mjs';
import {ensurePlatformSchema} from './schema.mjs';
import {fail,text,digest,serviceKey} from './domain.mjs';
export const ADAPTERS=Object.freeze({
 direct_portal:{label:'SST Rx authorised pharmacy workspace',state:'implemented',transport:'existing_native_handlers',capabilities:['prescription_receipt','acceptance','dispensing','dispatch','delivery','exceptions']},
 prescriptr:{label:'Prescriptr / Health Finder Pro',state:'documentation_required',transport:null},
 looprx:{label:'LoopRX',state:'documentation_required',transport:null},
 primed:{label:'Primed Pharmacy / Primed Rx',state:'onboarding_then_documentation',transport:null},
 onescript:{label:'Blueco / OneScript',state:'documentation_required',transport:null},
 cloudrx:{label:'CloudRx / Molecule',state:'contract_and_credentials_required',transport:null},
 laboratory:{label:'Laboratory / diagnostics provider',state:'documentation_required',transport:null}
});
const now=()=>new Date().toISOString();
const row=(DB,q,...args)=>DB.prepare(q).bind(...args).first();
export function adapterStatus(id){if(!Object.hasOwn(ADAPTERS,id))fail(422,'unknown_adapter');return {...ADAPTERS[id],id,live:false,sandboxVerified:false};}
export function isolatedSyntheticAdapter({submit,reconcile,verifyWebhook}={}){
 // No endpoint, credentials, headers, signature scheme or production behaviour is invented.
 return {id:'synthetic',mode:'synthetic',version:'fixture-v1',async submit(p){return submit?submit(p):{accepted:true,reference:'SYNTHETIC-'+p.idempotencyKey}},async reconcile(p){return reconcile?reconcile(p):{known:false}},async verifyWebhook(raw,proof){if(!verifyWebhook)fail(403,'fixture_verifier_required');return verifyWebhook(raw,proof)}};
}
export function resolveAdapter(contract,env){
 if(contract.adapter_id==='synthetic'){
  if(env.SSTRX_ENVIRONMENT!=='synthetic'||!env.SSTRX_SYNTHETIC_ADAPTER||env.SSTRX_SYNTHETIC_ADAPTER.mode!=='synthetic')fail(503,'synthetic_adapter_not_permitted');
  return env.SSTRX_SYNTHETIC_ADAPTER;
 }
 adapterStatus(contract.adapter_id);
 // Supplier-specific transports become available only after genuine contracts are reviewed.
 fail(503,contract.adapter_id==='direct_portal'?'use_authorised_portal_workflow':'supplier_adapter_not_commissioned');
}
export async function selectFutureSupplier(DB,{orgId,service,contractId,version,authorisationReference}){
 await ensurePlatformSchema(DB);serviceKey(service);text(authorisationReference);
 const contract=await row(DB,'SELECT * FROM rx_supplier_contracts WHERE id=? AND org_id=?',contractId,orgId);
 if(!contract||contract.state!=='approved')fail(409,'approved_supplier_contract_required');
 const config=JSON.parse(contract.config_json);if(!config.services?.includes(service))fail(409,'supplier_service_not_supported');
 const prior=await row(DB,'SELECT version FROM rx_future_routing WHERE org_id=? AND service=?',orgId,service);
 if((prior?.version||0)!==version)fail(409,'routing_changed');
 const r=await DB.prepare(`INSERT INTO rx_future_routing SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM rx_future_routing WHERE org_id=? AND service=?) ON CONFLICT(org_id,service) DO NOTHING`).bind(orgId,service,version+1,contractId,authorisationReference,now(),orgId,service).run();
 if(prior){const x=await DB.prepare('UPDATE rx_future_routing SET version=version+1,contract_id=?,authorisation_reference=?,updated_at=? WHERE org_id=? AND service=? AND version=?').bind(contractId,authorisationReference,now(),orgId,service,version).run();if(x.meta.changes!==1)fail(409,'routing_changed');}
 else if(r.meta.changes!==1)fail(409,'routing_changed');
 return {version:version+1,contractId,historicalOrdersChanged:0};
}
export async function captureOrderRoute(DB,{orderNumber,memberId,clinicalOrgId,pharmacyOrgId,contractId,prescriptionId,variantId,service,authorisationReference},environment={}){
 await ensurePlatformSchema(DB);serviceKey(service);text(authorisationReference);
 const prior=await row(DB,'SELECT * FROM rx_order_routes WHERE order_number=?',orderNumber);
 if(prior){if(prior.member_id!==memberId||prior.contract_id!==contractId||prior.prescription_id!==prescriptionId||prior.pharmacy_org_id!==pharmacyOrgId)fail(409,'historical_supplier_route_immutable');return prior;}
 const contract=await row(DB,'SELECT * FROM rx_supplier_contracts WHERE id=? AND org_id=?',contractId,clinicalOrgId);
 if(!contract||contract.state!=='approved')fail(409,'approved_supplier_contract_required');
 const config=JSON.parse(contract.config_json);if(config.pharmacyOrgId!==pharmacyOrgId||!config.services?.includes(service))fail(409,'authorised_pharmacy_route_required');
 const task=await row(DB,'SELECT state_json FROM partner_fulfilment WHERE order_number=? AND member_id=? AND partner_id=?',orderNumber,memberId,pharmacyOrgId);
 const rx=task?JSON.parse(task.state_json):null;
 if(!rx||rx.prescriptionId!==prescriptionId||rx.area!==service)fail(409,'signed_native_pharmacy_task_required');
 const signed=await internalPrescriptionDocument({...environment,DB,PRESCRIPTION_SIGNING_ENABLED:'true',PRESCRIPTION_WORKFLOW_ENABLED:'true'},rx);if(!signed?.current||signed.document.prescriber.organisationId!==clinicalOrgId||signed.document.treatment.variantId!==variantId)fail(409,'current_verified_prescription_route_required');
 const mapping=await row(DB,'SELECT * FROM rx_product_mappings WHERE contract_id=? AND variant_id=?',contractId,variantId);
 if(!mapping)fail(409,'verified_product_mapping_required');
 const created=now();await DB.prepare('INSERT INTO rx_order_routes VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(orderNumber,memberId,clinicalOrgId,pharmacyOrgId,contractId,contract.version,service,prescriptionId,JSON.stringify(mapping),authorisationReference,created).run();
 return row(DB,'SELECT * FROM rx_order_routes WHERE order_number=?',orderNumber);
}
export async function queueSubmission(DB,route,operation='submit_prescription'){
 if(operation!=='submit_prescription')fail(422,'unsupported_operation');
 const idempotencyKey=await digest([route.contract_id,route.order_number,route.prescription_id,operation]),id='rx-job-'+idempotencyKey;
 const payloadDigest=await digest({order:route.order_number,prescription:route.prescription_id,contractVersion:route.contract_version,mapping:JSON.parse(route.product_mapping_json)}),created=now();
 await DB.prepare("INSERT OR IGNORE INTO rx_integration_jobs(id,contract_id,order_number,operation,idempotency_key,payload_digest,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'pending',?,?)").bind(id,route.contract_id,route.order_number,operation,idempotencyKey,payloadDigest,created,created).run();
 const job=await row(DB,'SELECT * FROM rx_integration_jobs WHERE id=?',id);if(job.payload_digest!==payloadDigest)fail(409,'idempotency_payload_conflict');return job;
}
export async function submitJob(env,id){
 const DB=env.DB;await ensurePlatformSchema(DB);const job=await row(DB,'SELECT * FROM rx_integration_jobs WHERE id=?',id);if(!job)fail(404,'job_not_found');
 if(['accepted','transport_received','uncertain','submitting'].includes(job.state))return {state:job.state,reference:job.remote_reference,replayed:false};
 if(!['pending','retryable'].includes(job.state))fail(409,'job_not_submittable');
 if(job.next_attempt_at&&Date.parse(job.next_attempt_at)>Date.now())fail(409,'retry_not_due');
 const contract=await row(DB,'SELECT * FROM rx_supplier_contracts WHERE id=?',job.contract_id),route=await row(DB,'SELECT * FROM rx_order_routes WHERE order_number=?',job.order_number);
 if(!contract||contract.state!=='approved'||contract.version!==route.contract_version)fail(409,'supplier_contract_changed_reconcile_required');
 const adapter=resolveAdapter(contract,env),claimed=await DB.prepare("UPDATE rx_integration_jobs SET state='submitting',attempts=attempts+1,updated_at=? WHERE id=? AND state=? AND attempts=?").bind(now(),id,job.state,job.attempts).run();
 if(claimed.meta.changes!==1)fail(409,'job_claimed');
 try{
  const controller=new AbortController(),timeoutMs=Math.min(15000,Math.max(50,Number(env.SSTRX_SUBMISSION_TIMEOUT_MS)||15000));let timer;
  const receipt=await Promise.race([adapter.submit({apiVersion:'sst-rx-v1',idempotencyKey:job.idempotency_key,orderReference:route.order_number,prescriptionReference:route.prescription_id,product:JSON.parse(route.product_mapping_json),signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('submission_timeout'))},timeoutMs)})]).finally(()=>clearTimeout(timer));
  if(receipt?.accepted!==true||typeof receipt.reference!=='string')throw Error('invalid_receipt');text(receipt.reference,160);
  const state=env.SSTRX_CANONICAL_RECEIPTS_ENABLED==='true'?'transport_received':'accepted';await DB.prepare("UPDATE rx_integration_jobs SET state=?,remote_reference=?,last_code=NULL,updated_at=? WHERE id=? AND state='submitting'").bind(state,receipt.reference,now(),id).run();
  return {state,reference:receipt.reference,mode:adapter.mode,pharmacyAcceptanceConfirmed:false};
 }catch(error){
  // A timeout or invalid receipt can follow a successful remote write. Never resubmit blindly.
  const safe=error?.definitelyNotSent===true&&job.attempts<4;
  await DB.prepare('UPDATE rx_integration_jobs SET state=?,last_code=?,next_attempt_at=?,updated_at=? WHERE id=? AND state=\'submitting\'').bind(safe?'retryable':'uncertain',safe?'connection_not_sent':'submission_outcome_unknown',safe?new Date(Date.now()+Math.min(300000,1000*2**job.attempts)).toISOString():null,now(),id).run();
  return {state:safe?'retryable':'uncertain',code:safe?'connection_not_sent':'submission_outcome_unknown'};
 }
}
export async function reconcileJob(env,id){
 const job=await row(env.DB,'SELECT * FROM rx_integration_jobs WHERE id=?',id);if(!job||!['uncertain','submitting'].includes(job.state))fail(409,'uncertain_job_required');
 const contract=await row(env.DB,'SELECT * FROM rx_supplier_contracts WHERE id=?',job.contract_id),adapter=resolveAdapter(contract,env);
 const result=await adapter.reconcile({idempotencyKey:job.idempotency_key,orderReference:job.order_number});
 if(result?.known===true&&result.accepted===true){text(result.reference,160);const state=env.SSTRX_CANONICAL_RECEIPTS_ENABLED==='true'?'transport_received':'accepted';await env.DB.prepare("UPDATE rx_integration_jobs SET state=?,remote_reference=?,last_code=NULL,updated_at=? WHERE id=? AND state IN ('uncertain','submitting')").bind(state,result.reference,now(),id).run();return {state,reference:result.reference,pharmacyAcceptanceConfirmed:false};}
 return {state:job.state,requiresHuman:true};
}
const EVENT_KINDS=new Set(['received','accepted','clarification','rejected','stock_unavailable','dispensing','dispensed','dispatched','delivered','delivery_exception','returned','lab_ordered','sample_received','result_available']);
export async function receiveVerifiedEvent(env,contractId,raw,proof){
 if(typeof raw!=='string'||raw.length>65536)fail(413,'event_too_large');
 if(env.SSTRX_FUNCTIONAL_V3_ENABLED==='true'&&env.SSTRX_CANONICAL_RECEIPTS_ENABLED!=='true')fail(503,'versioned_supplier_receipt_contract_required');
 const contract=await row(env.DB,'SELECT * FROM rx_supplier_contracts WHERE id=?',contractId);if(!contract||contract.state!=='approved')fail(404,'contract_not_found');
 const adapter=resolveAdapter(contract,env),verified=await adapter.verifyWebhook(raw,proof);if(!verified?.verified||verified.contractId!==contractId)fail(403,'webhook_verification_failed');
 const e=verified.event;if(!e||!EVENT_KINDS.has(e.kind))fail(422,'unsupported_supplier_event');text(e.eventReference,160);text(e.orderReference);if(!Number.isFinite(Date.parse(e.occurredAt))||new Date(e.occurredAt).toISOString()!==e.occurredAt||Date.parse(e.occurredAt)>Date.now()+300000)fail(422,'invalid_event_time');
 const route=await row(env.DB,'SELECT * FROM rx_order_routes WHERE order_number=? AND contract_id=?',e.orderReference,contractId);if(!route)fail(404,'supplier_order_not_found');
 if(env.SSTRX_CANONICAL_RECEIPTS_ENABLED==='true'){
  const protocol=JSON.parse(contract.config_json).receiptContract;
  if(!protocol?.approvalReference||protocol.schemaVersion!=='sst-rx-event-v1')fail(409,'approved_supplier_receipt_contract_required');
  if(e.schemaVersion!==protocol.schemaVersion||!Number.isSafeInteger(e.sourceRecordVersion)||e.sourceRecordVersion<1||!e.idempotencyKey)fail(422,'versioned_supplier_receipt_required');
  const record=await row(env.DB,'SELECT id FROM clinical_member_records WHERE order_number=? AND user_id=?',route.order_number,route.member_id);
  if(e.caseReference!==record?.id||e.prescriptionReference!==route.prescription_id)fail(409,'supplier_receipt_episode_mismatch');text(e.idempotencyKey,200);
  const latest=await row(env.DB,"SELECT MAX(CAST(json_extract(event_json,'$.sourceRecordVersion') AS INTEGER)) version FROM rx_integration_events WHERE order_number=? AND contract_id=? AND state='projected' AND json_extract(event_json,'$.prescriptionReference')=?",route.order_number,contractId,route.prescription_id);
  if(latest?.version>=e.sourceRecordVersion){const duplicate=await row(env.DB,'SELECT event_reference FROM rx_integration_events WHERE contract_id=? AND event_reference=?',contractId,e.eventReference);if(!duplicate)fail(409,'obsolete_supplier_record_version');}
 }
 const hash=await digest(raw),existing=await row(env.DB,'SELECT * FROM rx_integration_events WHERE contract_id=? AND event_reference=?',contractId,e.eventReference);
 if(existing){if(existing.payload_digest!==hash)fail(409,'webhook_replay_content_changed');return {duplicate:true,state:existing.state};}
 // Ordered projection is separate: store factual source without manufacturing skipped receipt/dispatch stages.
 if(env.SSTRX_CANONICAL_RECEIPTS_ENABLED==='true'&&['clarification','rejected','stock_unavailable','delivered','delivery_exception','returned'].includes(e.kind))text(e.memberMessage,1000);
 const safe={kind:e.kind,tracking:e.tracking||null,remoteReference:e.remoteReference||null,...env.SSTRX_CANONICAL_RECEIPTS_ENABLED==='true'?{schemaVersion:e.schemaVersion,sourceRecordVersion:e.sourceRecordVersion,prescriptionReference:e.prescriptionReference,caseReference:e.caseReference,idempotencyKey:e.idempotencyKey,pharmacyOrgId:route.pharmacy_org_id,memberMessage:typeof e.memberMessage==='string'?text(e.memberMessage,1000):null}: {}};
 await env.DB.prepare("INSERT INTO rx_integration_events VALUES(?,?,?,?,?,?,?,?,?,?,'awaiting_projection')").bind(crypto.randomUUID(),contractId,e.eventReference,e.orderReference,e.kind,e.occurredAt,now(),hash,adapter.id,JSON.stringify(safe)).run();
 return {accepted:true,state:'awaiting_projection',mode:adapter.mode};
}
export async function projectVerifiedEvents(env,orderNumber,sink){
 if(!sink||sink.mode!=='synthetic'||env.SSTRX_ENVIRONMENT!=='synthetic')fail(503,'approved_supplier_native_projection_required');
 const route=await row(env.DB,'SELECT * FROM rx_order_routes WHERE order_number=?',orderNumber);if(!route)fail(404,'route_not_found');
 const actions={accepted:{from:['received','query'],action:'accept'},clarification:{from:['received','accepted','preparing'],action:'query'},stock_unavailable:{from:['received','accepted','preparing'],action:'query'},rejected:{from:['received','query','accepted','preparing'],action:'reject'},dispensing:{from:['accepted'],action:'prepare'},dispensed:{from:['preparing'],action:'dispensed'},dispatched:{from:['preparing'],action:'dispatch'},delivered:{from:['dispatched','delivery_exception'],action:'delivered'},delivery_exception:{from:['dispatched'],action:'delivery_exception'},returned:{from:['dispatched','delivery_exception','delivered'],action:'returned'}};
 const canonical=env.SSTRX_CANONICAL_RECEIPTS_ENABLED==='true';
 const {results:events=[]}=await env.DB.prepare("SELECT * FROM rx_integration_events WHERE order_number=? AND contract_id=? AND state='awaiting_projection' ORDER BY CASE WHEN ? THEN CAST(json_extract(event_json,'$.sourceRecordVersion') AS INTEGER) ELSE 0 END,occurred_at,received_at,id LIMIT 100").bind(orderNumber,route.contract_id,canonical?1:0).all();
 let sourceVersion=canonical?Number((await row(env.DB,"SELECT MAX(CAST(json_extract(event_json,'$.sourceRecordVersion') AS INTEGER)) version FROM rx_integration_events WHERE order_number=? AND contract_id=? AND state='projected' AND json_extract(event_json,'$.prescriptionReference')=?",orderNumber,route.contract_id,route.prescription_id))?.version||0):0;
 let projected=0;for(let pass=0;pass<10;pass++){let progress=false;
  for(const e of events){if(e.state!=='awaiting_projection')continue;const task=await row(env.DB,'SELECT state_json FROM partner_fulfilment WHERE order_number=? AND partner_id=?',orderNumber,route.pharmacy_org_id),s=task?JSON.parse(task.state_json):null,data=JSON.parse(e.event_json),step=actions[e.kind];if(!s||canonical&&data.sourceRecordVersion!==sourceVersion+1)continue;
   if(data.prescriptionReference&&data.prescriptionReference!==route.prescription_id)continue;
   if(canonical&&e.kind==='received'){await env.DB.prepare("UPDATE rx_integration_events SET state='projected' WHERE id=? AND state='awaiting_projection'").bind(e.id).run();e.state='projected';sourceVersion=data.sourceRecordVersion;projected++;progress=true;continue;}
   if(!step)continue;
   if(!step.from.includes(s.status)||e.kind==='dispensed'&&s.dispensedAt)continue;
   // Native action enforces authentic signature, current stock, version and professional scope.
   if(canonical&&e.kind==='dispatched'&&!s.dispensedAt)continue;
   const r=await sink.apply({orderNumber,pharmacyOrgId:route.pharmacy_org_id,prescriptionId:route.prescription_id,version:s.version,action:step.action,eventReference:e.event_reference,occurredAt:e.occurred_at,tracking:data.tracking,message:data.memberMessage,stockUnavailable:e.kind==='stock_unavailable'});
   if(!r?.ok)continue;
   await env.DB.prepare("UPDATE rx_integration_events SET state='projected' WHERE id=? AND state='awaiting_projection'").bind(e.id).run();e.state='projected';if(canonical)sourceVersion=data.sourceRecordVersion;projected++;progress=true;
  }
  if(!progress)break;
 }
 return {projected,pending:events.filter(e=>e.state==='awaiting_projection').length,source:'verified_supplier_events',mode:'synthetic'};
}
