import {ensurePlatformSchema} from './schema.mjs';
import {text,fail,digest} from './domain.mjs';
// Neutral laboratory workflow. Production adapters must verify their own genuine
// contract and source before supplying events. No lab endpoint/protocol is assumed.
const date=()=>new Date().toISOString();
export async function createDiagnosticOrder(env,a,b,record,guard){
 if(env.SSTRX_DIAGNOSTICS_ENABLED!=='true')fail(503,'diagnostics_pathway_not_commissioned');
 for(const key of ['contractId','testCode','collectionMethod','clinicalRequestReference','clientReference'])text(b[key]);
 if(!['home_collection','venous_collection','clinic_collection'].includes(b.collectionMethod))fail(422,'approved_collection_method_required');
 const contract=await env.DB.prepare('SELECT * FROM rx_supplier_contracts WHERE id=? AND org_id=?').bind(b.contractId,a.orgId).first();if(!contract||contract.state!=='approved'||!JSON.parse(contract.config_json).services?.includes('diagnostics'))fail(409,'approved_laboratory_contract_required');
 const prior=await env.DB.prepare('SELECT * FROM rx_diagnostic_orders WHERE client_reference=?').bind(b.clientReference).first(),request={testCode:b.testCode,collectionMethod:b.collectionMethod,clinicalRequestReference:b.clinicalRequestReference};
 if(prior){if(prior.member_id!==record.user_id||prior.record_id!==record.id||prior.contract_id!==b.contractId||prior.request_json!==JSON.stringify(request))fail(409,'diagnostic_request_reference_conflict');return {id:prior.id,status:prior.status,duplicate:true};}
 const id=crypto.randomUUID(),at=date();const result=await env.DB.batch([
  env.DB.prepare(`INSERT INTO rx_diagnostic_orders SELECT ?,?,?,?,?,?,?,'draft',1,?,NULL,NULL,?,? WHERE ${guard.sql} AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=?) AND EXISTS(SELECT 1 FROM clinical_case_assignments WHERE record_id=? AND hq_user_id=? AND active=1 AND expires_at>?)`).bind(id,record.id,a.orgId,record.user_id,a.id,b.contractId,b.clientReference,JSON.stringify(request),at,at,...guard.args,a.staff.id,a.staff.version,record.id,a.id,at),
  env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,?,'diagnostic_order',?,'draft_created','{}',? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),a.orgId,id,at)
 ]);if(result[0].meta.changes!==1)fail(409,'clinical_access_changed');return {id,status:'draft',submittedToSupplier:false,notificationsSent:false};
}
export async function syntheticLabEvent(env,{orderId,eventReference,kind,sourceReference,resultBytes}){
 // This entry is deliberately not exposed as a production webhook.
 if(env.SSTRX_ENVIRONMENT!=='synthetic')fail(503,'verified_laboratory_adapter_required');await ensurePlatformSchema(env.DB);text(eventReference);text(sourceReference);
 const order=await env.DB.prepare('SELECT * FROM rx_diagnostic_orders WHERE id=?').bind(orderId).first();if(!order)fail(404,'diagnostic_order_not_found');
 const duplicate=await env.DB.prepare('SELECT * FROM rx_diagnostic_events WHERE event_reference=?').bind(eventReference).first();if(duplicate){if(duplicate.order_id!==orderId||duplicate.kind!==kind||duplicate.source_reference!==sourceReference)fail(409,'diagnostic_event_reference_conflict');return {duplicate:true};}
 const transitions={submitted:['draft'],sample_received:['submitted'],result_available:['sample_received'],delivery_exception:['submitted','sample_received']};if(!transitions[kind]?.includes(order.status))fail(409,'diagnostic_event_out_of_sequence');
 let key=order.result_key,hash=order.result_digest;
 if(kind==='result_available'){
  if(!(resultBytes instanceof Uint8Array)||!resultBytes.length||resultBytes.length>8*1024*1024||!env.CLINICAL_PRIVATE_FILES)fail(422,'valid_private_result_required');
  hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',resultBytes)),b=>b.toString(16).padStart(2,'0')).join('');key='diagnostics/'+order.id+'/'+hash;await env.CLINICAL_PRIVATE_FILES.put(key,resultBytes,{httpMetadata:{contentType:'application/pdf'}});
 }
 const at=date();const r=await env.DB.batch([
  env.DB.prepare('UPDATE rx_diagnostic_orders SET status=?,version=version+1,result_key=?,result_digest=?,updated_at=? WHERE id=? AND version=?').bind(kind, key,hash,at,orderId,order.version),
  env.DB.prepare('INSERT INTO rx_diagnostic_events SELECT ?,?,?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),orderId,eventReference,kind,sourceReference,at,at)
 ]);if(r[0].meta.changes!==1)fail(409,'diagnostic_order_changed');return {status:kind,version:order.version+1,resultRequiresClinicalReview:kind==='result_available',notificationsSent:false};
}
