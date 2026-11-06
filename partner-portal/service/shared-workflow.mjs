import {applyPrescriptionEvent} from './vendor/core-prescription-workflow-v1.mjs';
import {ensureSharedSchema} from './schema.mjs';
import {guardedSupplyStatement} from '../platform/supply-holds.mjs';
const stamp=()=>new Date().toISOString();
const safeError=e=>String(e?.error||e?.message||'shared_order_sync_failed').slice(0,180);
const row=(DB,sql,...args)=>DB.prepare(sql).bind(...args).first();
function trackedStatement(native,sql,args=[]){return {native,sql,args,bind(...values){return trackedStatement(native.bind(...values),sql,values)},first(...a){return native.first(...a)},all(...a){return native.all(...a)},run(...a){return native.run(...a)},raw(...a){return native.raw(...a)}};}
// The outbox insert shares the ORIGINAL clinical/fulfilment transaction. A failed
// append rolls the action back. Projection retries reuse the Core event ledger.
export function withSharedOutbox(env){
 const shared=env.SHARED_ORDER_WORKFLOW_ENABLED==='true';
 if(!shared&&env.SSTRX_PLATFORM_ENABLED!=='true')return env;
 const DB=env.DB;
 const facade={__sstrxBaseDB:DB.__sstrxBaseDB||DB,prepare(sql){return trackedStatement(DB.prepare(sql),sql)},async batch(statements){
  const extra=[],orders=new Set();
  for(const s of shared?statements:[]){
   let table,key,recordId,orderNumber;
   if(/^INSERT INTO clinical_case_events\b/.test(s.sql)){table='clinical_case_events';key=s.args[0];recordId=s.args[1];}
   else if(/^INSERT INTO clinical_prescription_events\b/.test(s.sql)){table='clinical_prescription_events';key=s.args[0];recordId=s.args[1];}
   else if(/^INSERT INTO partner_audit\b/.test(s.sql)&&statements.some(x=>/^(?:INSERT INTO|UPDATE) partner_fulfilment\b/.test(x.sql))){table='partner_audit';key=s.args[0];orderNumber=s.args[1]==='order'?s.args[2]:s.args[1];}
   else continue;
   const filter=recordId?'r.id=?':'r.order_number=?',value=recordId||orderNumber;
   const linked=await DB.prepare(`SELECT order_number FROM clinical_member_records r WHERE ${filter}`).bind(value).first();if(linked?.order_number)orders.add(linked.order_number);
   extra.push(DB.prepare(`INSERT OR IGNORE INTO partner_workflow_sync(source_key,record_id,order_number,member_id,payload_json,created_at)
    SELECT ?,r.id,r.order_number,r.user_id,json_object('caseStatus',cs.status,'caseVersion',cs.version,'sourceTable',?,'sourceId',?,
     'rxStatus',json_extract(rx.state_json,'$.status'),'rxVersion',rx.version,'prescriptionId',json_extract(rx.state_json,'$.prescriptionId'),
     'treatment',json_extract(rx.state_json,'$.treatment'),'prescriberId',json_extract(rx.state_json,'$.prescriber.id'),
     'signatureId',sig.id,'signatureDigest',sig.digest,'signedAt',sig.created_at,
     'fulfilmentStatus',json_extract(f.state_json,'$.status'),'fulfilmentVersion',f.version,'tracking',json_extract(f.state_json,'$.tracking')) ,?
    FROM clinical_member_records r JOIN medicine_orders m ON m.order_number=r.order_number AND m.user_id=r.user_id
    LEFT JOIN clinical_case_state cs ON cs.record_id=r.id LEFT JOIN clinical_prescription_requests rx ON rx.record_id=r.id
    LEFT JOIN clinical_prescription_signatures sig ON sig.record_id=r.id AND sig.id=json_extract(rx.state_json,'$.prescriptionId')
    LEFT JOIN partner_fulfilment f ON f.order_number=r.order_number AND f.member_id=r.user_id
    WHERE ${filter} AND EXISTS(SELECT 1 FROM ${table} WHERE id=?)`).bind(table+':'+key,table,key,stamp(),value,key));
  }
  for(const orderNumber of orders){const result=await drainSharedWorkflow({...env,DB},{orderNumber});if(result.pending)throw Object.assign(Error('shared_order_sync_pending'),{status:503});}
  return DB.batch([...statements.map(s=>guardedSupplyStatement(env,DB,s)),...extra]);
 }};
 return {...env,DB:facade};
}
async function clinicalProjection(DB,order,p,event){
 const next=p.caseStatus==='ready_for_prescription'?'approved':p.caseStatus==='declined'?'declined':null;
 if(!next||order.clinical_status===next||order.prescription_reference)return;
 if(order.status!=='paid')throw Error('paid_order_required');
 if(!['not_started','assessment_pending','in_review','more_information_required','needs_information','consultation_required'].includes(order.clinical_status))throw Error('clinical_order_state_changed');
 const now=stamp();
 const results=await DB.batch([
  DB.prepare(`UPDATE medicine_orders SET clinical_status=?,clinical_updated_at=?,updated_at=? WHERE id=? AND status='paid' AND clinical_status=?`).bind(next,now,now,order.id,order.clinical_status),
  DB.prepare(`INSERT INTO order_reference_registry(order_number,channel,source_table,source_id,user_id,status,created_at,updated_at) SELECT ?,'medicine','medicine_orders',?,?,?,?,? WHERE changes()=1 ON CONFLICT(order_number) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`).bind(order.order_number,order.id,order.user_id,next,now,now)
 ]);
 if(results[0].meta?.changes!==1)throw Error('clinical_order_state_changed');
}
async function projectOne(DB,event){
 const p=JSON.parse(event.payload_json);let order=await row(DB,'SELECT * FROM medicine_orders WHERE order_number=? AND user_id=?',event.order_number,event.member_id);
 if(!order)throw Error('shared_owned_order_required');
 await clinicalProjection(DB,order,p,event);
 const refresh=async()=>order=await row(DB,'SELECT * FROM medicine_orders WHERE id=?',order.id);
 await refresh();
 const available=[];
 if(p.rxStatus==='issued'){
  if(!p.signatureId||!p.prescriptionId||!p.signatureDigest||!p.prescriberId)throw Error('verified_signed_prescription_required');
  available.push('prescription_signed');
  if(p.fulfilmentStatus)available.push('sent_to_pharmacy');
 }
 const pharmacyStages={accepted:['pharmacy_received'],preparing:['pharmacy_received','dispensing'],dispatched:['pharmacy_received','dispensing','dispatched'],delivered:['pharmacy_received','dispensing','dispatched','fulfilled']};
 available.push(...pharmacyStages[p.fulfilmentStatus]||[]);
 const all=['prescription_signed','sent_to_pharmacy','pharmacy_received','dispensing','dispatched','fulfilled'];
 for(const status of available){
  // Do not invent the receipt or dispatch stages from unrelated later data.
  const index=all.indexOf(status),current=all.indexOf(order.clinical_status);
  if(current>=index)continue;
  const body={status,eventReference:event.source_key+':'+status,prescriptionReference:p.prescriptionId,occurredAt:event.created_at,
   ...(status==='prescription_signed'?{signedRecordReference:'clinical-signature:'+p.signatureId+':'+p.signatureDigest,prescriberReference:'clinical-professional:'+p.prescriberId,prescription:{medicineName:p.treatment.medicine,strengthLabel:p.treatment.strength,formulation:p.treatment.route,directions:p.treatment.directions.replace(/[\r\n\t]+/g,' '),quantity:p.treatment.quantity}}:{}),
   ...(status==='pharmacy_received'?{pharmacyReceiptReference:event.source_key}:{})};
  const result=await applyPrescriptionEvent(DB,order,body);if(!result.ok)throw result;
  await refresh();
 }
}
export async function drainSharedWorkflow(env,{orderNumber,limit=50}={}){
 if(env.SHARED_ORDER_WORKFLOW_ENABLED!=='true')return {pending:0,completed:0};
 await ensureSharedSchema(env.DB);
 const {results:events=[]}=await env.DB.prepare(`SELECT * FROM partner_workflow_sync WHERE status='pending'${orderNumber?' AND order_number=?':''} ORDER BY id LIMIT ?`).bind(...orderNumber?[orderNumber,limit]:[limit]).all();
 let completed=0;const blocked=new Set();
 for(const event of events){if(blocked.has(event.order_number))continue;
  try{await projectOne(env.DB,event);await env.DB.prepare("UPDATE partner_workflow_sync SET status='completed',completed_at=?,attempts=attempts+1,last_error=NULL WHERE id=? AND status='pending'").bind(stamp(),event.id).run();completed++;}
  catch(error){blocked.add(event.order_number);await env.DB.prepare("UPDATE partner_workflow_sync SET attempts=attempts+1,last_error=? WHERE id=? AND status='pending'").bind(safeError(error),event.id).run();}
 }
 const pending=await env.DB.prepare(`SELECT COUNT(DISTINCT order_number) n FROM partner_workflow_sync WHERE status='pending'${orderNumber?' AND order_number=?':''}`).bind(...orderNumber?[orderNumber]:[]).first();
 return {completed,pending:Number(pending?.n||0)};
}
// Request completion reconciles only the authorised order. Other orders retry
// through the scheduled drain, so an unrelated backlog cannot delay this reply
// or produce a misleading warning about the current member's order.
export async function completeSharedResponse(response,request,env){
 if(!response||!response.ok||env.SHARED_ORDER_WORKFLOW_ENABLED!=='true')return response;
 const path=new URL(request.url).pathname,fulfilment=path.match(/\/clinical\/partners\/fulfilment\/([A-Za-z0-9_-]{1,100})(?:\/|$)/),record=path.match(/\/(?:clinical|clinical-records)\/(?:prescriptions\/)?([a-f0-9-]{36})(?:\/|$)/i)||path.match(/\/clinical\/platform\/(?:cases|lifecycle)\/([a-f0-9-]{36})(?:\/|$)/i);
 let orderNumber=fulfilment?.[1];
 if(record){const linked=await env.DB.prepare('SELECT order_number FROM clinical_member_records WHERE id=?').bind(record[1]).first();orderNumber=linked?.order_number;}
 if(!orderNumber)return response;
 await captureClinicalFollowup(env,orderNumber);
 const outcome=await drainSharedWorkflow(env,{orderNumber}),headers=new Headers(response.headers);headers.set('X-Shift-Shared-Order-Sync',outcome.pending?'pending':'complete');
 return new Response(response.body,{status:response.status,headers});
}
import {captureClinicalFollowup} from '../platform/followups.mjs';
