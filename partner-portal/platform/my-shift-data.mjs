// Read-only member projection. All clinical, prescription and supply writes stay
// in the retained services. No My Shift order/profile/message schema is created.
import {memberView,memberTracking} from '../service/member-kernel.mjs';
import {listConversations} from './messages.mjs';
import {supportList} from './my-shift-support.mjs';
import {ensureRefundSchema,memberRefunds} from './refunds.mjs';
import {informationList} from './functional-casework.mjs';
import {ensureLifecycleSchema,lifecycleList,memberLifecycle} from './prescription-lifecycle.mjs';
const rows=async q=>(await q.all()).results||[];
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
const terminal=new Set(['delivered','fulfilled','declined','cancelled','rejected','returned']);
const titles={prescription_issued:'Prescription signed',fulfilment_accept:'Pharmacy accepted',fulfilment_prepare:'Dispensing underway',fulfilment_dispensed:'Dispensed',fulfilment_dispatch:'Dispatched',fulfilment_delivered:'Delivery update received',fulfilment_delivery_exception:'Delivery needs attention',fulfilment_query:'Your pharmacy has a question',information_requested:'Your clinician needs more information',clinical_decision:'Clinical review updated',assessment_submitted:'Assessment received'};
export function orderTimeline({order,prescription,fulfilment,signature,paidAt,dispensedAt}){
 const events=fulfilment?.events||[];
 const event=kind=>date(events.find(e=>e.action===kind)?.created_at);
 // "Preparing" is not evidence of completed dispensing. Dispatch is not proof
 // of delivery; neither expected dates nor a tracking URL complete that step.
 const signed=prescription?.prescriptionId&&prescription.issuedAt&&signature?.id===prescription.prescriptionId;
 const dispatched=event('fulfilment_dispatch');
 const delivered=event('fulfilment_delivered');
 return [
  {key:'paid',label:'Paid',complete:['paid','succeeded','completed','fulfilled','refunded'].includes(order.status),at:date(paidAt),source:'medicine_orders'},
  {key:'signed',label:'Prescription signed',complete:!!signed,at:signed?date(prescription.issuedAt):null,source:'clinical_prescription_signatures'},
  {key:'accepted',label:'Pharmacy accepted',complete:!!event('fulfilment_accept'),at:event('fulfilment_accept'),source:'partner_audit'},
  {key:'dispensed',label:'Dispensed',complete:!!date(dispensedAt),at:date(dispensedAt),source:'partner_audit'},
  {key:'dispatched',label:'Dispatched',complete:!!dispatched,at:dispatched,source:'partner_audit'},
  {key:'delivered',label:'Delivered',complete:!!delivered,at:delivered,source:'partner_audit'}
 ];
}
export async function myShiftSnapshot(env,actor){
 const observedAt=new Date().toISOString();
 const identity=await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(actor.id).first();
 // One bounded query for the order set, followed by one batch of supply events.
 // Reuse the native member projections; do not make per-order service requests.
 const source=await rows(env.DB.prepare(`SELECT m.*,r.id record_id,r.revision,r.review_sharing,r.status assessment_status,cs.version case_version,rx.state_json prescription_json,sig.id signature_id,f.state_json fulfilment_json,COALESCE(rt.pharmacy_org_id,f.partner_id) pharmacy_id,rt.contract_id,org.state_json pharmacy_json,
 (SELECT occurred_at FROM rx_finance_entries e WHERE e.order_number=m.order_number AND e.kind='member_payment' ORDER BY occurred_at LIMIT 1) paid_at,
 (SELECT created_at FROM partner_audit a WHERE a.entity_type='order' AND a.entity_id=m.order_number AND a.action='fulfilment_dispensed' AND (json_extract(f.state_json,'$.episodeStartAuditId') IS NULL OR a.rowid>=(SELECT rowid FROM partner_audit WHERE id=json_extract(f.state_json,'$.episodeStartAuditId'))) ORDER BY version LIMIT 1) dispensed_at,
 (SELECT state FROM rx_integration_jobs j WHERE j.order_number=m.order_number AND j.state IN ('uncertain','submitting','retryable','failed','retry') ORDER BY updated_at DESC LIMIT 1) uncertain_state,
 (SELECT updated_at FROM rx_integration_jobs j WHERE j.order_number=m.order_number AND j.state IN ('uncertain','submitting','retryable','failed','retry') ORDER BY updated_at DESC LIMIT 1) uncertain_at
 FROM medicine_orders m LEFT JOIN clinical_member_records r ON r.order_number=m.order_number AND r.user_id=m.user_id
 LEFT JOIN clinical_case_state cs ON cs.record_id=r.id LEFT JOIN clinical_prescription_requests rx ON rx.record_id=r.id AND rx.member_id=m.user_id AND rx.order_number=m.order_number
 LEFT JOIN clinical_prescription_signatures sig ON sig.record_id=r.id AND sig.id=json_extract(rx.state_json,'$.prescriptionId') AND sig.version=rx.version
 LEFT JOIN partner_fulfilment f ON f.order_number=m.order_number AND f.member_id=m.user_id AND r.id IS NOT NULL
 LEFT JOIN rx_order_routes rt ON rt.order_number=m.order_number AND rt.member_id=m.user_id LEFT JOIN partner_organisations org ON org.id=COALESCE(rt.pharmacy_org_id,f.partner_id)
 WHERE m.user_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 101`).bind(actor.id));
 const supplyEvents=source.length?await rows(env.DB.prepare(`SELECT a.entity_id,a.action,a.created_at FROM partner_audit a JOIN medicine_orders m ON m.order_number=a.entity_id JOIN partner_fulfilment f ON f.order_number=m.order_number AND f.member_id=m.user_id WHERE (json_extract(f.state_json,'$.episodeStartAuditId') IS NULL OR a.rowid>=(SELECT rowid FROM partner_audit WHERE id=json_extract(f.state_json,'$.episodeStartAuditId'))) AND a.entity_type='order' AND m.user_id=? AND a.entity_id IN (${source.slice(0,100).map(()=>'?').join(',')}) AND a.action IN ('fulfilment_accept','fulfilment_dispatch','fulfilment_delivered') ORDER BY a.entity_id,a.version`).bind(actor.id,...source.slice(0,100).map(o=>o.order_number))):[];
 const orders=source.slice(0,100).map(order=>{
  let prescription=null,fulfilment=null;
  if(order.prescription_json&&env.PRESCRIPTION_WORKFLOW_ENABLED==='true'){
   const state=JSON.parse(order.prescription_json);prescription=memberView(state);
   if(state.recordRevision!==order.revision||!order.review_sharing||order.case_version!==state.caseVersion){prescription.status='needs_review';prescription.canRespond=false;}
  }
  if(order.fulfilment_json&&(env.PARTNER_TRACKING_READ_ENABLED==='true'||env.PARTNER_FULFILMENT_ENABLED==='true'))fulfilment={...memberTracking(JSON.parse(order.fulfilment_json)),events:supplyEvents.filter(e=>e.entity_id===order.order_number)};
  const timeline=orderTimeline({order,prescription,fulfilment,signature:order.signature_id?{id:order.signature_id}:null,paidAt:order.paid_at,dispensedAt:order.dispensed_at});
  const status=fulfilment?.status||prescription?.status||order.clinical_status||order.status;
  return {reference:order.order_number,recordId:order.record_id||null,createdAt:date(order.created_at),updatedAt:date(fulfilment?.updatedAt||prescription?.updatedAt||order.clinical_updated_at||order.updated_at),payment:{status:order.status,totalPence:order.total_pence,currency:order.currency},status,active:!terminal.has(status)&&!['cancelled','refunded','failed'].includes(order.status),timeline,tracking:timeline.find(s=>s.key==='dispatched').complete?fulfilment?.tracking||null:null,deliveryUpdate:fulfilment?.deliveryUpdate||null,uncertain:order.uncertain_state?{state:order.uncertain_state,at:date(order.uncertain_at)}:null,supplier:order.pharmacy_id?{id:order.pharmacy_id,name:order.pharmacy_json?JSON.parse(order.pharmacy_json).name:order.pharmacy_id,contractId:order.contract_id||null}:null,repeat:!!order.reorder_of_order_id,prescription:prescription?{status:prescription.status,id:prescription.prescriptionId||null,issuedAt:date(prescription.issuedAt)}:null};
 });
 if(env.SSTRX_FUNCTIONAL_V3_ENABLED==='true'){
  await ensureRefundSchema(env.DB);await ensureLifecycleSchema(env.DB);const refunds=await memberRefunds(env,actor.id);
  for(const order of orders){order.refunds=refunds.filter(r=>r.orderReference===order.reference);order.informationRequests=order.recordId?await informationList(env,{id:order.recordId,order_number:order.reference}):[];order.lifecycleRequests=order.recordId?(await lifecycleList(env,order.recordId)).map(memberLifecycle):[];order.supplyHistory=order.recordId?await rows(env.DB.prepare("SELECT prescription_id prescriptionId,pharmacy_org_id pharmacyOrganisationId,archived_at archivedAt,json_extract(fulfilment_json,'$.status') status FROM rx_supply_history WHERE record_id=? AND member_id=? ORDER BY archived_at DESC").bind(order.recordId,actor.id)):[];}
 }
 const events=await rows(env.DB.prepare(`SELECT 'prescription:'||e.id id,e.kind,r.order_number,r.id record_id,e.created_at,'clinical_prescription_events' source FROM clinical_prescription_events e JOIN clinical_member_records r ON r.id=e.record_id WHERE r.user_id=?
 UNION ALL SELECT 'pharmacy:'||e.id id,e.action kind,r.order_number,r.id record_id,e.created_at,'partner_audit' source FROM partner_audit e JOIN clinical_member_records r ON r.order_number=e.entity_id JOIN partner_fulfilment f ON f.order_number=r.order_number AND f.member_id=r.user_id WHERE e.entity_type='order' AND r.user_id=?
 UNION ALL SELECT 'case:'||e.id id,e.kind,r.order_number,r.id record_id,e.created_at,'clinical_case_events' source FROM clinical_case_events e JOIN clinical_member_records r ON r.id=e.record_id WHERE r.user_id=?
 ORDER BY 5 DESC,1 DESC LIMIT 100`).bind(actor.id,actor.id,actor.id));
 const updates=events.filter(e=>Object.hasOwn(titles,e.kind)).map(e=>({id:e.id,kind:e.kind,title:titles[e.kind],reference:e.order_number,recordId:e.record_id,at:date(e.created_at),source:e.source,view:'orders'}));
 const results=await Promise.allSettled([env.SSTRX_SECURE_MESSAGES_ENABLED==='true'?listConversations(env,{member:true,id:actor.id}):Promise.reject(Error('care_messages_not_open')),supportList(env,actor.id)]);
 const care=results[0].status==='fulfilled'?results[0].value:null,support=results[1].status==='fulfilled'?results[1].value:null;
 const unread=care&&support&&!care.hasMore&&!support.hasMore?care.threads.filter(t=>t.unread).length+support.tickets.filter(t=>t.unread).length:null;
 const latest=[...updates,...(care?.threads||[]).map(t=>({id:t.id,title:t.unread?'New care message':'Care conversation updated',at:date(t.updated_at),reference:t.order_number,view:'messages',thread:t.id,source:'rx_message_threads'})),...(support?.tickets||[]).map(t=>({id:t.reference,title:t.unread?'New message from SHIFT':'SHIFT support updated',at:date(t.updatedAt),reference:t.orderReference||null,view:'messages',support:t.reference,source:'support_tickets'}))].filter(e=>e.at).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,2);
 return {memberId:actor.id,account:{firstName:identity?.first_name||'',lastName:identity?.last_name||'',email:identity?.email||'',memberSince:date(identity?.created_at)},orders,hasMoreOrders:source.length>100,activeOrders:source.length>100?null:orders.filter(o=>o.active).length,unread,latest,careUpdates:updates,careThreads:care?.threads||[],supportAvailable:!!support,careMessagesAvailable:!!care,observedAt,refreshSeconds:5,clinicalServiceOpen:env.CLINICAL_REVIEW_READY==='true',source:'Existing SHIFT identity, medicine_orders, clinical records, prescriptions, partner_fulfilment, partner_audit, support_tickets and Rx conversations',notificationsSent:false};
}
