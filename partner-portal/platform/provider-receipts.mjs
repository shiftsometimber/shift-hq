import {fail,readObject} from './domain.mjs';
import {receiveVerifiedEvent,projectVerifiedEvents} from './integrations.mjs';
import {partnerRoute,existingHqIdentity,internalDispensingAdapters,permission} from '../service/clinical-kernel.mjs';
import {withSharedOutbox,completeSharedResponse} from '../service/shared-workflow.mjs';
// Receipt ingestion and native projection retain the pharmacy professional's
// current session. An owner role cannot stand in for dispensing authority.
export async function providerReceiptRoute(request,env,a,p){
 if(p[0]!=='integrations'||!['simulate','receipts','project','status'].includes(p[1]))return null;
 if(p.length!==2)fail(404,'not_found');
 if(request.method!==(p[1]==='status'?'GET':'POST'))fail(405,'method_not_allowed');
 if(a.internal||a.orgAdmin||a.staff?.kind!=='dispensing'||!a.mfa)fail(403,'pharmacy_receipt_access_required');
 const b=p[1]==='status'?{orderReference:new URL(request.url).searchParams.get('orderReference')}:await readObject(request),r=await env.DB.prepare('SELECT r.*,m.medicine_name FROM rx_order_routes r JOIN medicine_orders m ON m.order_number=r.order_number AND m.user_id=r.member_id WHERE r.order_number=? AND r.pharmacy_org_id=?').bind(b.orderReference,a.orgId).first();
 if(!r||!permission(a.staff,r.service,'supply_decision',new Date().toISOString(),r.medicine_name))fail(404,'supplier_order_not_found');
 if(env.SSTRX_ENVIRONMENT!=='synthetic'||env.SSTRX_CANONICAL_RECEIPTS_ENABLED!=='true')fail(503,'supplier_projection_not_commissioned');
 if(p[1]==='status'){
  const current=await env.DB.prepare("SELECT MAX(CAST(json_extract(event_json,'$.sourceRecordVersion') AS INTEGER)) version FROM rx_integration_events WHERE order_number=? AND contract_id=? AND state='projected' AND json_extract(event_json,'$.prescriptionReference')=?").bind(r.order_number,r.contract_id,r.prescription_id).first();
  const pending=await env.DB.prepare("SELECT COUNT(*) count FROM rx_integration_events WHERE order_number=? AND contract_id=? AND state='awaiting_projection' AND json_extract(event_json,'$.prescriptionReference')=?").bind(r.order_number,r.contract_id,r.prescription_id).first();
  const job=await env.DB.prepare('SELECT state,remote_reference FROM rx_integration_jobs WHERE order_number=? AND contract_id=? ORDER BY created_at DESC LIMIT 1').bind(r.order_number,r.contract_id).first();
  return {simulation:true,orderReference:r.order_number,prescriptionReference:r.prescription_id,nextSourceVersion:Number(current?.version||0)+1,pending:pending?.count||0,transportState:job?.state||'not_submitted',transportReference:job?.remote_reference||null};
 }
 let received=null;
 if(p[1]!=='project'){
  let raw=b.raw,proof=b.proof;
  if(p[1]==='simulate'){
   if(env.SSTRX_QA_FULFILMENT_ENABLED!=='true'||typeof env.SSTRX_SYNTHETIC_ADAPTER?.createEvent!=='function')fail(503,'isolated_stub_provider_required');
   ({raw,proof}=await env.SSTRX_SYNTHETIC_ADAPTER.createEvent({...b,contractId:r.contract_id}));
  }
  received=await receiveVerifiedEvent(env,r.contract_id,raw,proof);
 }
 const projection=await projectVerifiedEvents(env,r.order_number,{mode:'synthetic',async apply(event){
  const headers=new Headers(request.headers);headers.set('Content-Type','application/json');
  const body={version:event.version,action:event.action,...event.message?{message:event.message,reason:event.message}:{},...event.tracking?{carrier:event.tracking.carrier,trackingNumber:event.tracking.number}:{}};
  const req=new Request(new URL('/v1/hq/clinical/partners/fulfilment/'+encodeURIComponent(r.order_number)+'/action',request.url),{method:'POST',headers,body:JSON.stringify(body)}),run=withSharedOutbox(env);
  const response=await partnerRoute(req,run,existingHqIdentity,internalDispensingAdapters(run));if(!response)return {ok:false};
  return {ok:(await completeSharedResponse(response,req,env)).ok};
 }});
 return {simulation:true,received,projection,orderReference:r.order_number,prescriptionReference:r.prescription_id};
}
