// Read-only HQ projection of retained Rx/My Shift services. No clinical body,
// copied order authority, state command, or new persistence table is introduced.
import {coordinateRecords} from '../platform/coordination.mjs';
import {informationExceptions} from '../platform/functional-casework.mjs';
const rows=async query=>(await query.all()).results||[];
const last=values=>values.filter(x=>typeof x==='string'&&Number.isFinite(Date.parse(x))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null;
const allowedAction=action=>Object.fromEntries(['key','kind','code','label','responsibility','owner','dueAt','unowned','overdue','deadlineState','policyVersion','claimVersion','canClaim'].filter(k=>Object.hasOwn(action||{},k)).map(k=>[k,action[k]]));
export async function hqOperatingPicture(env,actor){
 const testScope=env.SSTRX_ENVIRONMENT==='synthetic'?"m.stripe_checkout_session_id LIKE 'cs_test_%' AND (lower(m.email) LIKE '%@example.invalid' OR lower(m.email) LIKE '%@example.test')":"r.order_number GLOB 'TEST-*' AND lower(m.email) LIKE '%@example.invalid'";
 const source=await rows(env.DB.prepare(`SELECT r.id recordId,r.order_number orderNumber,r.updated_at updatedAt,cs.version caseVersion,cs.updated_at caseUpdatedAt,
 rx.version rxVersion,json_extract(rx.state_json,'$.status') rxStatus,
 CASE WHEN json_extract(rx.state_json,'$.status')='issued' THEN 'prescription_issued' ELSE cs.status END clinicalStatus,
 f.partner_id pharmacyOrgId,json_extract(f.state_json,'$.status') pharmacyStatus,f.version pharmacyVersion,f.updated_at pharmacyUpdatedAt,
 COALESCE(json_extract(f.state_json,'$.area'),'weight_management') service,m.clinical_status sharedStatus,
 EXISTS(SELECT 1 FROM clinical_case_assignments x WHERE x.record_id=r.id AND x.active=1 AND x.expires_at>?) assigned,
 (SELECT COUNT(*) FROM rx_supply_holds h WHERE h.order_number=r.order_number AND h.state='open') openHolds,
 (SELECT COUNT(*) FROM partner_workflow_sync s WHERE s.order_number=r.order_number AND s.status='pending') syncPending,
 (SELECT MIN(due_at) FROM rx_followups u WHERE u.record_id=r.id AND u.status IN ('open','needs_owner')) reviewDueAt,
 (SELECT MIN(occurred_at) FROM rx_finance_entries e WHERE e.order_number=m.order_number AND e.kind='member_payment') paidAt,
 (SELECT MIN(created_at) FROM clinical_prescription_signatures s WHERE s.record_id=r.id AND s.id=json_extract(rx.state_json,'$.prescriptionId')) signedAt
 FROM clinical_member_records r JOIN medicine_orders m ON m.order_number=r.order_number AND m.user_id=r.user_id
 LEFT JOIN clinical_case_state cs ON cs.record_id=r.id LEFT JOIN clinical_prescription_requests rx ON rx.record_id=r.id
 LEFT JOIN partner_fulfilment f ON f.order_number=r.order_number AND f.member_id=r.user_id
 WHERE ${testScope}
 ORDER BY r.updated_at DESC,r.id LIMIT 151`).bind(new Date().toISOString()));
 const selected=source.slice(0,150),ids=JSON.stringify(selected.map(x=>x.recordId));
 const audit=selected.length?await rows(env.DB.prepare(`SELECT a.id,a.entity_id,a.action,a.version,a.created_at FROM partner_audit a JOIN clinical_member_records r ON r.order_number=a.entity_id JOIN partner_fulfilment f ON f.order_number=r.order_number AND f.member_id=r.user_id WHERE (json_extract(f.state_json,'$.episodeStartAuditId') IS NULL OR a.rowid>=(SELECT rowid FROM partner_audit WHERE id=json_extract(f.state_json,'$.episodeStartAuditId'))) AND a.entity_type='order' AND r.id IN (SELECT value FROM json_each(?)) AND a.action IN ('fulfilment_accept','fulfilment_dispensed','fulfilment_dispatch','fulfilment_delivered') ORDER BY a.created_at,a.version`).bind(ids)):[];
 const coordinated=await informationExceptions(env,actor,await coordinateRecords(env,actor,selected));
 const observedAt=new Date().toISOString();
 const records=coordinated.map(record=>{
  const events=audit.filter(e=>e.entity_id===record.orderNumber),event=kind=>events.find(e=>e.action===kind);
  const milestone=(key,at,source,evidence)=>({key,confirmed:!!at,at:at||null,source,evidence_ref:evidence||null});
  const milestones=[milestone('paid',record.paidAt,'rx_finance_entries',null),milestone('signed',record.signedAt,'clinical_prescription_signatures',null),...['fulfilment_accept','fulfilment_dispensed','fulfilment_dispatch','fulfilment_delivered'].map((kind,i)=>{const e=event(kind);return milestone(['accepted','dispensed','dispatched','delivered'][i],e?.created_at,'partner_audit',e?.id);})];
  const sourceUpdatedAt=last([record.updatedAt,record.caseUpdatedAt,record.pharmacyUpdatedAt]);
  return {case_ref:record.recordId,order_ref:record.orderNumber,partition:'TEST',case_version:record.caseVersion,prescription_version:record.rxVersion,pharmacy_version:record.pharmacyVersion,
   last_confirmed_shared_stage:record.sharedStatus,clinical_stage:record.clinicalStatus,pharmacy_stage:record.pharmacyStatus,
   source_updated_at:sourceUpdatedAt,observed_at:observedAt,sync_status:record.syncPending?'pending':'no_pending_projection_record',sync_pending:record.syncPending,
   // Source age is not projector lag. Keep that distinction explicit.
   freshness:{source_updated_at:sourceUpdatedAt,projection_lag_ms:null,projection_lag_status:'unverified'},
   milestones,action:allowedAction(record.action),rx_path:'/workspace/clinical#'+record.recordId};
 });
 return {ok:true,partition:'TEST',observed_at:observedAt,source:'Existing clinical_member_records + medicine_orders + clinical_case_state + clinical_prescription_requests + partner_fulfilment + partner_audit + rx_action_claims',records,coverage:{returned:records.length,has_more:source.length>150,limit:150},notifications_sent:false,clinical_commands_available:false,device_receipt:'UNVERIFIED',privacy:'Operational metadata only; assessment answers, clinical message bodies, medicine labels and prescribed directions are excluded.'};
}
