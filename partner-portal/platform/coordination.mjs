// Derived from authoritative records. Claims contain responsibility metadata only;
// completing a dashboard task can never complete a prescription or a delivery.
import {permission,credentialsCurrent,authCondition} from '../service/clinical-kernel.mjs';
import {digest,fail,text} from './domain.mjs';
const rows=async q=>(await q.all()).results||[];
const terminal=new Set(['declined','closed','cancelled']);
export function actionFor(r){
 if(r.syncPending)return {kind:'reconciliation',code:'reconcile_status',label:'Reconcile the saved order update',responsibility:'operations'};
 if(r.openHolds)return {kind:'exception',code:'review_supply_hold',label:'Review the reported supply problem',responsibility:r.pharmacyOrgId?'pharmacy':'clinical'};
 if(r.clinicalStatus==='declined'||r.sharedStatus==='declined')return {kind:'finance',code:'decline_finance_review',label:'Confirm the assessment outcome and payment review',responsibility:'operations'};
 if(r.pharmacyStatus==='delivered')return {kind:'current',code:'delivery_recorded',label:'Delivery recorded; follow the agreed care plan',responsibility:null};
 if(['query','rejected','delivery_exception','returned'].includes(r.pharmacyStatus))return {kind:'exception',code:'pharmacy_'+r.pharmacyStatus,label:({query:'Resolve the pharmacy clarification',rejected:'Review the rejected supply',delivery_exception:'Resolve the delivery problem',returned:'Review the returned shipment'})[r.pharmacyStatus],responsibility:r.pharmacyStatus==='rejected'?'clinical':'pharmacy'};
 if(r.pharmacyStatus==='received')return {kind:'pharmacy',code:'verify_prescription',label:'Verify and accept the prescription',responsibility:'pharmacy'};
 if(r.pharmacyStatus==='accepted')return {kind:'pharmacy',code:'dispense',label:'Complete the dispensing checks',responsibility:'pharmacy'};
 if(r.pharmacyStatus==='preparing')return {kind:'pharmacy',code:'dispatch',label:'Confirm dispatch and tracking',responsibility:'pharmacy'};
 if(r.pharmacyStatus==='dispatched')return {kind:'delivery',code:'await_delivery',label:'Await a confirmed delivery update',responsibility:'pharmacy'};
 if(r.pharmacyStatus==='cancelled'||terminal.has(r.clinicalStatus))return {kind:'current',code:'closed',label:'Treatment or supply closed; retain the recorded plan',responsibility:null};
 if(!r.assigned)return {kind:'assignment',code:'assign_review',label:'Assign an authorised clinician',responsibility:'operations'};
 if(['needs_information','information_requested','awaiting_information'].includes(r.clinicalStatus))return {kind:'information',code:'await_member_information',label:'Await the requested information and review the response',responsibility:'clinical'};
 if(r.rxStatus==='awaiting_member'||r.rxStatus==='clinician_query')return {kind:'information',code:'await_treatment_response',label:'Await the member’s treatment response',responsibility:'clinical'};
 if(['accepted','needs_review','member_question'].includes(r.rxStatus))return {kind:'prescription',code:'prescriber_signoff',label:'Review the current agreement and sign if appropriate',responsibility:'clinical'};
 if(r.clinicalStatus==='prescription_issued')return {kind:'pharmacy',code:'confirm_handover',label:'Confirm that the chosen pharmacy received the prescription',responsibility:'operations'};
 if(r.clinicalStatus==='ready_for_prescription')return {kind:'prescription',code:'prepare_prescription',label:'Prepare the proposed treatment for member agreement',responsibility:'clinical'};
 return {kind:'review',code:'clinical_review',label:'Complete the assigned clinical review',responsibility:'clinical'};
}
function deadline(policy,code,started){
 const minutes=policy?.windowsMinutes?.[code];
 if(!policy?.approvalReference||!Number.isInteger(minutes)||minutes<1||minutes>43200||!Number.isFinite(Date.parse(started)))return null;
 return new Date(Date.parse(started)+minutes*60000).toISOString();
}
export async function coordinateRecords(env,a,records,observedAt=new Date().toISOString()){
 if(!records.length)return [];
 const ids=JSON.stringify(records.map(r=>r.recordId));
 // One bounded read batch, rather than one database round trip per case.
 const read=await env.DB.batch([
  env.DB.prepare("SELECT p.hq_user_id,p.state_json,h.name,o.state_json organisation FROM partner_staff p JOIN hq_users h ON h.id=p.hq_user_id JOIN partner_organisations o ON o.id=p.org_id WHERE h.status='active' AND h.mfa_enabled=1 AND p.hq_user_id IN (SELECT hq_user_id FROM clinical_case_assignments WHERE record_id IN (SELECT value FROM json_each(?)) UNION SELECT owner_user_id FROM rx_action_claims WHERE record_id IN (SELECT value FROM json_each(?)))").bind(ids,ids),
  env.DB.prepare('SELECT x.*,h.name,h.role,h.status,h.mfa_enabled FROM rx_action_claims x JOIN hq_users h ON h.id=x.owner_user_id WHERE record_id IN (SELECT value FROM json_each(?))').bind(ids),
  env.DB.prepare('SELECT record_id,hq_user_id FROM clinical_case_assignments WHERE record_id IN (SELECT value FROM json_each(?)) AND active=1 AND expires_at>?').bind(ids,observedAt),
  env.DB.prepare("SELECT * FROM (SELECT id,record_id,assigned_user_id,due_at,status,ROW_NUMBER() OVER(PARTITION BY record_id ORDER BY due_at,id) rn FROM rx_followups WHERE record_id IN (SELECT value FROM json_each(?)) AND status IN ('open','needs_owner')) WHERE rn=1").bind(ids),
  env.DB.prepare("SELECT * FROM (SELECT d.id,d.record_id,d.org_id,l.due_at,l.ack_at,ROW_NUMBER() OVER(PARTITION BY d.record_id ORDER BY l.due_at,d.id) rn FROM rx_diagnostic_orders d JOIN rx_diagnostic_alerts l ON l.order_id=d.id WHERE d.record_id IN (SELECT value FROM json_each(?)) AND d.status='result_available' AND l.priority='critical') WHERE rn=1").bind(ids),
  env.DB.prepare('SELECT org_id,service,config_json FROM rx_service_config WHERE org_id IN (SELECT p.org_id FROM partner_staff p JOIN clinical_case_assignments x ON x.hq_user_id=p.hq_user_id WHERE x.record_id IN (SELECT value FROM json_each(?)) UNION SELECT f.partner_id FROM partner_fulfilment f JOIN clinical_member_records r ON r.order_number=f.order_number WHERE r.id IN (SELECT value FROM json_each(?)))').bind(ids,ids)
 ]);
 const [people,claims,assigned,followups,alerts,config]=read.map(r=>r.results||[]);
 const approved=new Map();
 for(const p of people){const s=JSON.parse(p.state_json),o=JSON.parse(p.organisation);if(s.status!=='active'||!credentialsCurrent(s,observedAt)||o.status!=='approved'||o.expiresAt<=observedAt||o.kind!==(s.kind==='clinician'?'clinical':'pharmacy'))continue;approved.set(p.hq_user_id,{profile:s,name:p.name});}
 const out=[];
 for(const record of records){
  const area=record.service||'weight_management';
  if(!a.internal&&!a.orgAdmin&&!permission(a.staff,area,a.staff.kind==='clinician'?'review':'view_fulfilment',observedAt,record.medicine))continue;
  const action=actionFor(record),assignments=assigned.filter(x=>x.record_id===record.recordId);
  const clinicians=assignments.map(x=>approved.get(x.hq_user_id)).filter(p=>p?.profile.kind==='clinician'&&permission(p.profile,area,'review',observedAt,record.medicine));
  // An operations user does not become the clinical decision owner by claiming work.
  const orgId=action.responsibility==='pharmacy'?record.pharmacyOrgId:clinicians.length===1?clinicians[0].profile.orgId:null;
  const policyRow=config.find(c=>c.org_id===orgId&&c.service===area),policy=policyRow?JSON.parse(policyRow.config_json).operationalPolicy:null;
  const started=action.responsibility==='pharmacy'?record.pharmacyUpdatedAt:record.caseUpdatedAt||record.updatedAt;
  const sourceKey=await digest([record.recordId,action.code,record.caseVersion,record.rxVersion,record.pharmacyVersion,record.syncPending,record.openHolds]);
  const claim=claims.find(x=>x.record_id===record.recordId&&x.source_key===sourceKey);
  let owner=null;
  if(action.responsibility==='clinical'&&clinicians.length===1){const p=clinicians[0];owner={userId:p.profile.hqUserId,name:p.name,organisationId:p.profile.orgId,source:'current_clinical_assignment'};}
  if(claim){
   const p=approved.get(claim.owner_user_id),u=claim;
   if(action.responsibility==='operations'&&u.status==='active'&&u.mfa_enabled===1&&['owner','admin','operations'].includes(u.role))owner={userId:u.owner_user_id,name:u.name,organisationId:null,source:'acknowledged_operational_owner'};
   if(action.responsibility==='pharmacy'&&p?.profile.kind==='dispensing'&&p.profile.orgId===record.pharmacyOrgId&&permission(p.profile,area,'view_fulfilment',observedAt,record.medicine))owner={userId:p.profile.hqUserId,name:p.name,organisationId:p.profile.orgId,source:'acknowledged_pharmacy_owner'};
  }
  let dueAt=deadline(policy,action.code,started),clockSource=dueAt?'approved_operational_policy':null;
  // A clinician's follow-up deadline remains separate from the supply clock.
  const followup=followups.find(x=>x.record_id===record.recordId);
  const clinicalView=a.internal||a.staff?.kind==='clinician'||a.staff?.kind==='clinical_admin';
  if(clinicalView&&followup&&Date.parse(followup.due_at)<Date.parse(observedAt)){
   action.kind='overdue';action.code='clinical_followup';action.label='Complete the clinician’s overdue follow-up';action.responsibility='clinical';dueAt=followup.due_at;clockSource='recorded_clinical_followup';
   const p=approved.get(followup.assigned_user_id);owner=p?.profile.kind==='clinician'&&clinicians.some(c=>c.profile.hqUserId===p.profile.hqUserId)?{userId:p.profile.hqUserId,name:p.name,organisationId:p.profile.orgId,source:'recorded_followup_assignment'}:null;
  }
  const alert=clinicalView?alerts.find(x=>x.record_id===record.recordId):null;
  if(alert){action.kind='exception';action.code='critical_result_review';action.label=alert.ack_at?'Complete the clinical review and follow-up of the flagged result':'Acknowledge and review the laboratory’s flagged result';action.responsibility='clinical';dueAt=alert.due_at;clockSource='verified_laboratory_response_deadline';const p=clinicians.filter(x=>x.profile.orgId===alert.org_id);owner=p.length===1?{userId:p[0].profile.hqUserId,name:p[0].name,organisationId:alert.org_id,source:'current_clinical_assignment'}:null;}
  const active=action.responsibility!==null,overdue=!!dueAt&&Date.parse(dueAt)<Date.parse(observedAt),unowned=active&&!owner;
  out.push({...record,action:{...action,key:sourceKey,owner,dueAt,waitStartedAt:started||null,clockSource,policyReference:clockSource==='approved_operational_policy'?policy.approvalReference:null,overdue,unowned,priority:overdue||unowned||action.kind==='exception'||action.kind==='reconciliation'?'urgent':'normal',deadlineState:!active?'not_required':dueAt?overdue?'overdue':'within_recorded_deadline':'not_configured',claimVersion:claim?.version||0,canClaim:!a.orgAdmin&&(action.responsibility==='operations'?a.internal&&['owner','admin','operations'].includes(a.role):action.responsibility==='pharmacy'&&a.staff?.kind==='dispensing'&&a.orgId===record.pharmacyOrgId),escalation:unowned?'owner_required':overdue?'deadline_exceeded':action.kind==='exception'?'exception_requires_review':null}});
 }
 return out.sort((x,y)=>Number(y.action.priority==='urgent')-Number(x.action.priority==='urgent')||(x.action.dueAt||'z').localeCompare(y.action.dueAt||'z')||x.orderNumber.localeCompare(y.orderNumber));
}
export async function claimAction(env,a,b,current){
 text(b.sourceKey,64);if(!current||current.action.key!==b.sourceKey)fail(409,'action_changed_refresh_required');
 if(!current.action.canClaim)fail(403,'appropriate_operational_owner_required');
 if(!Number.isInteger(b.version)||b.version!==current.action.claimVersion)fail(409,'ownership_changed');
 const date=new Date().toISOString(),g=authCondition(a,date);
 const result=await env.DB.batch([
  env.DB.prepare(`INSERT INTO rx_action_claims SELECT ?,?,?,1,?,?,? WHERE ${g.sql} ON CONFLICT(record_id,source_key) DO UPDATE SET owner_user_id=excluded.owner_user_id,version=rx_action_claims.version+1,acknowledged_at=excluded.acknowledged_at,updated_at=excluded.updated_at WHERE rx_action_claims.version=?`).bind(current.recordId,b.sourceKey,a.id,date,date,date,...g.args,b.version),
  env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,?,'case_action',?,'responsibility_acknowledged',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),a.orgId||null,current.recordId,JSON.stringify({sourceKey:b.sourceKey}),date)
 ]);if(result[0].meta.changes!==1)fail(409,'ownership_or_access_changed');
 return {acknowledged:true,version:b.version+1,clinicalDecisionMade:false,notificationsSent:false};
}
