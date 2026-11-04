import {createDiagnosticOrder} from './diagnostics.mjs';
import {existingHqIdentity,credentialsCurrent,currentPartner,permission,authCondition} from '../service/clinical-kernel.mjs';
import {ensurePlatformSchema} from './schema.mjs';
import {SERVICES,API_VERSION,fail,text,economicsTerms,reconcileEconomics,commissioning,nextAction,declineRefund,EXPENSE_KINDS,readObject} from './domain.mjs';
import {ADAPTERS,selectFutureSupplier,captureOrderRoute,queueSubmission,submitJob,reconcileJob} from './integrations.mjs';
const BASE='/v1/hq/clinical/platform',at=()=>new Date().toISOString();
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private','Access-Control-Allow-Origin':'https://hq.shiftsometimber.co.uk','Access-Control-Allow-Credentials':'true','Vary':'Origin','X-Content-Type-Options':'nosniff'}});
const all=async q=>(await q.all()).results||[];
const input=request=>readObject(request);
export async function platformActor(request,env){
 const identity=await existingHqIdentity(request,env);if(identity.response)return {response:identity.response};const u=identity.user;if(!u?.mfaEnabled)fail(403,'mfa_required');
 const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)sst_hq_session=([^;]+)/)?.[1];if(!token)fail(401,'session_required');
 const {digest}=await import('./domain.mjs');const sessionHash=await digest(token);
 if(['owner','admin','operations','support'].includes(u.role))return {id:u.id,user:u,role:u.role,mfa:true,sessionHash,internal:true,commercial:['owner','admin'].includes(u.role)};
 if(u.role!=='clinical')fail(403,'platform_role_required');
 const r=await env.DB.prepare('SELECT state_json FROM partner_staff WHERE hq_user_id=?').bind(u.id).first(),staff=r?JSON.parse(r.state_json):null;
 if(!staff||staff.status!=='active'||!credentialsCurrent(staff,at())){
  await ensurePlatformSchema(env.DB);
  const entries=await all(env.DB.prepare("SELECT m.*,o.state_json FROM rx_org_memberships m JOIN partner_organisations o ON o.id=m.org_id WHERE m.hq_user_id=? AND m.status='active' AND m.role IN ('clinical_admin','pharmacy_admin')").bind(u.id));
  const memberships=entries.filter(m=>{const o=JSON.parse(m.state_json);return o.status==='approved'&&o.expiresAt>at()&&(m.role==='clinical_admin'?o.kind==='clinical':o.kind==='pharmacy')});
  // Ambiguous organisation selection is not silently resolved to a broader view.
  if(memberships.length!==1)fail(403,'verified_partner_required');const m=memberships[0];
  return {id:u.id,user:u,role:u.role,mfa:true,sessionHash,orgId:m.org_id,internal:false,commercial:false,orgAdmin:true,staff:{id:'membership-'+u.id,kind:m.role,orgId:m.org_id,hqUserId:u.id,status:'active',version:m.version}};
 }
 await currentPartner(env,staff);
 return {id:u.id,user:u,role:u.role,mfa:true,sessionHash,staff,orgId:staff.orgId,internal:false,commercial:false};
}
async function ownsCase(env,a,id){
 const r=await env.DB.prepare('SELECT * FROM clinical_member_records WHERE id=?').bind(id).first();if(!r)return null;
 if(a.internal)return r;
 if(a.staff.kind!=='clinician'||!permission(a.staff,'weight_management','review',at()))return null;
 return await env.DB.prepare('SELECT 1 ok FROM clinical_case_assignments WHERE record_id=? AND hq_user_id=? AND active=1 AND expires_at>?').bind(id,a.id,at()).first()&&r.review_sharing?r:null;
}
async function overview(env,a,search=""){
 const filters=a.internal?'1=1':a.staff.kind==='clinical_admin'?`r.review_sharing=1 AND EXISTS(SELECT 1 FROM clinical_case_assignments x JOIN partner_staff ps ON ps.hq_user_id=x.hq_user_id WHERE x.record_id=r.id AND ps.org_id=? AND x.active=1 AND x.expires_at>?)`:a.staff.kind==='clinician'?`r.review_sharing=1 AND EXISTS(SELECT 1 FROM clinical_case_assignments x WHERE x.record_id=r.id AND x.hq_user_id=? AND x.active=1 AND x.expires_at>?)`:`f.partner_id=?`;
 const args=a.internal?[]:a.staff.kind==='clinical_admin'?[a.orgId,at()]:a.staff.kind==='clinician'?[a.id,at()]:[a.orgId];
 const source=await all(env.DB.prepare(`SELECT r.id recordId,r.order_number orderNumber,r.user_id memberId,r.updated_at updatedAt,CASE WHEN json_extract(rx.state_json,'$.status')='issued' THEN 'prescription_issued' ELSE cs.status END clinicalStatus,f.partner_id pharmacyOrgId,json_extract(f.state_json,'$.status') pharmacyStatus,
 EXISTS(SELECT 1 FROM clinical_case_assignments x WHERE x.record_id=r.id AND x.active=1 AND x.expires_at>?) assigned,
 (SELECT COUNT(*) FROM partner_workflow_sync s WHERE s.order_number=r.order_number AND s.status='pending') syncPending,
 (SELECT MIN(due_at) FROM rx_followups u WHERE u.record_id=r.id AND u.status IN ('open','needs_owner')) reviewDueAt,
 m.reorder_of_order_id repeatOfOrderId
 FROM clinical_member_records r JOIN medicine_orders m ON m.order_number=r.order_number AND m.user_id=r.user_id LEFT JOIN clinical_case_state cs ON cs.record_id=r.id LEFT JOIN clinical_prescription_requests rx ON rx.record_id=r.id LEFT JOIN partner_fulfilment f ON f.order_number=r.order_number
 WHERE ${filters} AND (?='' OR r.order_number LIKE ? ESCAPE '\\' OR CAST(r.user_id AS TEXT)=? OR r.id=?) ORDER BY r.updated_at DESC LIMIT 201`).bind(at(),...args,search,'%'+search.replace(/[\\%_]/g,c=>'\\'+c)+'%',search,search));
 const records=source.slice(0,200).map(r=>({...r,action:nextAction(r),url:(a.staff?.kind==='dispensing'?'/workspace/dispensing#':'/workspace/clinical#')+r.recordId}));
 const counts={};for(const r of records)counts[r.action.kind]=(counts[r.action.kind]||0)+1;
 const config=a.orgId?await all(env.DB.prepare('SELECT service,config_json,version,updated_at FROM rx_service_config WHERE org_id=?').bind(a.orgId)):[];
 return {apiVersion:API_VERSION,observedAt:at(),source:'existing_clinical_order_and_fulfilment_records',role:a.staff?.kind||a.role,records,counts,coverage:{limit:200,hasMore:source.length>200,countsScope:'returned_authorised_records'},services:Object.entries(SERVICES).map(([id,s])=>{const c=config.find(c=>c.service===id);return {id,...s,...commissioning(c?JSON.parse(c.config_json):null)}}),integrations:Object.entries(ADAPTERS).map(([id,x])=>({id,label:x.label,state:x.state,live:false})),commercialAvailable:a.commercial};
}
export async function platformRoute(request,env){
 const url=new URL(request.url);if(url.pathname!==BASE&&!url.pathname.startsWith(BASE+'/'))return null;
 try{
  if(request.headers.get('Origin')&&request.headers.get('Origin')!=='https://hq.shiftsometimber.co.uk')fail(403,'origin_forbidden');
  if(request.method==='POST'&&request.headers.get('Origin')!=='https://hq.shiftsometimber.co.uk')fail(403,'origin_required');
  if(!['GET','POST'].includes(request.method))fail(405,'method_not_allowed');
  const a=await platformActor(request,env);if(a.response)return a.response;await ensurePlatformSchema(env.DB);
  const p=url.pathname.slice(BASE.length).split('/').filter(Boolean);
  if(p[0]==='identity'&&p.length===1&&request.method==='GET')return json({staff:a.staff||null,organisationId:a.orgId||null,role:a.staff?.kind||a.role});
  if(p[0]==='memberships'){
   if(!a.orgAdmin&&!a.commercial)fail(403,'organisation_admin_required');
   if(request.method==='GET')return json({memberships:await all(env.DB.prepare(a.commercial?'SELECT hq_user_id,org_id,role,status,version FROM rx_org_memberships ORDER BY org_id,hq_user_id LIMIT 200':'SELECT hq_user_id,org_id,role,status,version FROM rx_org_memberships WHERE org_id=? ORDER BY hq_user_id LIMIT 200').bind(...a.commercial?[]:[a.orgId]))});
   if(request.method==='POST'&&p.length===1){
    if(!a.commercial)fail(403,'owner_membership_approval_required');const b=await input(request);text(b.approvalReference);if(!Number.isInteger(b.userId)||!['clinical_admin','pharmacy_admin'].includes(b.role))fail(422,'valid_membership_required');
    const user=await env.DB.prepare("SELECT id FROM hq_users WHERE id=? AND role='clinical' AND status='active' AND mfa_enabled=1").bind(b.userId).first(),org=await env.DB.prepare('SELECT state_json FROM partner_organisations WHERE id=?').bind(b.orgId).first();
    if(!user||!org)fail(422,'existing_mfa_user_and_organisation_required');const o=JSON.parse(org.state_json);if(o.status!=='approved'||o.expiresAt<=at()||o.kind!==(b.role==='clinical_admin'?'clinical':'pharmacy'))fail(422,'approved_matching_organisation_required');
    const g=authCondition(a,at()),r=await env.DB.prepare(`INSERT OR IGNORE INTO rx_org_memberships SELECT ?,?,?,'active',1 WHERE ${g.sql}`).bind(b.userId,b.orgId,b.role,...g.args).run();if(r.meta.changes!==1)fail(409,'membership_exists_or_access_changed');return json({created:true,invitationSent:false,clinicalPermissionsGranted:false},201);
   }
   if(request.method==='POST'&&p.length===3&&p[2]==='revoke'){
    const b=await input(request),org=a.orgId||b.orgId,id=Number(p[1]);if(id===a.id)fail(409,'independent_administrator_required');const g=authCondition(a,at()),r=await env.DB.prepare(`UPDATE rx_org_memberships SET status='revoked',version=version+1 WHERE hq_user_id=? AND org_id=? AND version=? AND status='active' AND ${g.sql}`).bind(id,org,b.version,...g.args).run();if(r.meta.changes!==1)fail(409,'membership_changed');return json({revoked:true,clinicalPermissionsChanged:false});
   }
   fail(404,'not_found');
  }
  if(p.length===0&&request.method==='GET'){const search=url.searchParams.get('q')||'';if(search.length>80||/[\u0000-\u001f]/.test(search))fail(422,'invalid_search');return json(await overview(env,a,search));}
  if(p[0]==='repeat-clearance'&&request.method==='POST'&&p.length===1){
   if(a.internal||a.staff.kind!=='clinician'||!permission(a.staff,'weight_management','clinical_decision',at()))fail(403,'assigned_clinician_required');
   const b=await input(request),record=await ownsCase(env,a,b.recordId);if(!record)fail(404,'case_not_found');text(b.reviewReference);
   if(!Number.isFinite(Date.parse(b.eligibleAt))||new Date(b.eligibleAt).toISOString()!==b.eligibleAt)fail(422,'reviewed_repeat_date_required');
   const date=at(),g=authCondition(a,date),result=await env.DB.batch([
    env.DB.prepare(`UPDATE medicine_orders SET reorder_eligible_at=?,updated_at=? WHERE order_number=? AND user_id=? AND clinical_status='fulfilled' AND ${g.sql} AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=?) AND EXISTS(SELECT 1 FROM clinical_case_assignments WHERE record_id=? AND hq_user_id=? AND active=1 AND expires_at>?)`).bind(b.eligibleAt,date,record.order_number,record.user_id,...g.args,a.staff.id,a.staff.version,record.id,a.id,date),
    env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,?,'order',?,'repeat_review_recorded',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),a.orgId,record.order_number,JSON.stringify({reviewReference:b.reviewReference,eligibleAt:b.eligibleAt}),date)
   ]);if(result[0].meta.changes!==1)fail(409,'fulfilled_order_and_current_assignment_required');return json({reviewRecorded:true,eligibleAt:b.eligibleAt,newPrescriptionRequired:true,automaticPrescription:false,notificationsSent:false});
  }
  if(p[0]==='diagnostics'){
   if(a.internal||a.orgAdmin||a.staff.kind!=='clinician'||!permission(a.staff,'diagnostics','request_test',at()))fail(403,'assigned_diagnostics_clinician_required');
   if(request.method==='POST'&&p.length===1){const b=await input(request),record=await ownsCase(env,a,b.recordId);if(!record)fail(404,'case_not_found');return json(await createDiagnosticOrder(env,a,b,record,authCondition(a,at())),201);}
   if(request.method==='GET'&&p.length===1)return json({orders:await all(env.DB.prepare('SELECT id,record_id,status,version,created_at,updated_at FROM rx_diagnostic_orders d WHERE org_id=? AND EXISTS(SELECT 1 FROM clinical_case_assignments x JOIN clinical_member_records r ON r.id=x.record_id WHERE x.record_id=d.record_id AND x.hq_user_id=? AND x.active=1 AND x.expires_at>? AND r.review_sharing=1) ORDER BY updated_at DESC LIMIT 200').bind(a.orgId,a.id,at()))});
   const order=await env.DB.prepare('SELECT * FROM rx_diagnostic_orders WHERE id=? AND org_id=?').bind(p[1]||'',a.orgId).first();if(!order||!await ownsCase(env,a,order.record_id))fail(404,'diagnostic_order_not_found');
   if(request.method==='GET'&&p[2]==='result'){
    if(!order.result_key||!order.result_digest)fail(409,'verified_result_not_available');const object=await env.CLINICAL_PRIVATE_FILES.get(order.result_key);if(!object)fail(503,'private_result_unavailable');
    const bytes=await new Response(object.body).arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==order.result_digest)fail(503,'private_result_integrity_failure');
    const g=authCondition(a,at()),audit=await env.DB.prepare(`INSERT INTO rx_platform_audit SELECT ?,?,?,'diagnostic_order',?,'result_viewed','{}',? WHERE ${g.sql} AND EXISTS(SELECT 1 FROM clinical_case_assignments WHERE record_id=? AND hq_user_id=? AND active=1 AND expires_at>?)`).bind(crypto.randomUUID(),String(a.id),a.orgId,order.id,at(),...g.args,order.record_id,a.id,at()).run();if(audit.meta.changes!==1)fail(403,'clinical_access_changed');
    return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="laboratory-result.pdf"','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
   }
   if(request.method==='POST'&&p[2]==='review'){
    const b=await input(request);text(b.clinicalReviewReference);if(order.status!=='result_available')fail(409,'result_not_ready_for_review');const g=authCondition(a,at()),r=await env.DB.batch([env.DB.prepare(`UPDATE rx_diagnostic_orders SET status='reviewed',version=version+1,updated_at=? WHERE id=? AND version=? AND ${g.sql}`).bind(at(),order.id,b.version,...g.args),env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,?,'diagnostic_order',?,'result_reviewed',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),a.orgId,order.id,JSON.stringify({clinicalReviewReference:b.clinicalReviewReference}),at())]);if(r[0].meta.changes!==1)fail(409,'diagnostic_order_changed');return json({reviewRecorded:true,notificationsSent:false});
   }
  }
  if(p[0]==='followups'){
   if(request.method==='GET'&&p.length===1){const rows=await all(env.DB.prepare(a.internal?'SELECT * FROM rx_followups ORDER BY due_at LIMIT 201':'SELECT * FROM rx_followups WHERE org_id=? AND assigned_user_id=? ORDER BY due_at LIMIT 201').bind(...a.internal?[]:[a.orgId,a.id]));return json({followups:rows.slice(0,200),hasMore:rows.length>200});}
   if(request.method==='POST'&&p.length===1){
    if(a.internal||a.staff.kind!=='clinician'||!permission(a.staff,'weight_management','clinical_decision',at()))fail(403,'assigned_clinician_required');
    const b=await input(request),r=await ownsCase(env,a,b.recordId);if(!r)fail(404,'case_not_found');
    if(!['review','monitoring','blood_test','prescriber_contact'].includes(b.kind)||!Number.isFinite(Date.parse(b.dueAt))||new Date(b.dueAt).toISOString()!==b.dueAt)fail(422,'valid_followup_required');
    const date=at(),g=authCondition(a,date),id=crypto.randomUUID(),detail={instructions:text(b.instructions,1000)};
    const changes=await env.DB.batch([
     env.DB.prepare(`INSERT INTO rx_followups SELECT ?,?,?,?,?,?,'open',1,?,?,? WHERE ${g.sql} AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=?) AND EXISTS(SELECT 1 FROM clinical_case_assignments WHERE record_id=? AND hq_user_id=? AND active=1 AND expires_at>?)`).bind(id,r.id,a.orgId,a.id,b.kind,b.dueAt,JSON.stringify(detail),date,date,...g.args,a.staff.id,a.staff.version,r.id,a.id,date),
     env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,?,'followup',?,'created','{}',? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),a.orgId,id,date)
    ]);if(changes[0].meta.changes!==1)fail(409,'case_or_access_changed');return json({id,status:'open',version:1,notificationsSent:false},201);
   }
   if(request.method==='POST'&&p.length===3&&p[2]==='assign'){
    if(!a.internal||a.role==='support')fail(403,'operations_assignment_required');const b=await input(request),f=await env.DB.prepare('SELECT * FROM rx_followups WHERE id=?').bind(p[1]).first(),profile=await env.DB.prepare('SELECT state_json FROM partner_staff WHERE hq_user_id=?').bind(b.staffUserId).first(),staff=profile?JSON.parse(profile.state_json):null;
    if(!f||!staff||staff.orgId!==f.org_id||staff.kind!=='clinician'||staff.status!=='active'||!credentialsCurrent(staff,at())||!permission(staff,'weight_management','review',at()))fail(422,'current_same_organisation_clinician_required');await currentPartner(env,staff);const g=authCondition(a,at()),r=await env.DB.prepare(`UPDATE rx_followups SET assigned_user_id=?,status='open',version=version+1,updated_at=? WHERE id=? AND version=? AND status='needs_owner' AND ${g.sql}`).bind(b.staffUserId,at(),f.id,b.version,...g.args).run();if(r.meta.changes!==1)fail(409,'followup_changed');return json({assigned:true,version:b.version+1,notificationsSent:false});
   }
   if(request.method==='POST'&&p.length===3&&p[2]==='complete'){
    const b=await input(request),f=await env.DB.prepare('SELECT * FROM rx_followups WHERE id=? AND org_id=? AND assigned_user_id=?').bind(p[1],a.orgId||'',a.id).first();if(!f||!await ownsCase(env,a,f.record_id))fail(404,'followup_not_found');
    const g=authCondition(a,at()),r=await env.DB.prepare(`UPDATE rx_followups SET status='completed',version=version+1,updated_at=? WHERE id=? AND version=? AND status='open' AND ${g.sql}`).bind(at(),f.id,b.version,...g.args).run();if(r.meta.changes!==1)fail(409,'followup_changed');return json({status:'completed',version:b.version+1});
   }
  }
  if(p[0]==='audit'&&request.method==='GET'&&p.length===1){
   const records=await all(env.DB.prepare(a.internal?'SELECT id,entity_type,entity_id,action,created_at FROM rx_platform_audit ORDER BY created_at DESC LIMIT 200':'SELECT id,entity_type,entity_id,action,created_at FROM rx_platform_audit WHERE org_id=? AND actor_id=? ORDER BY created_at DESC LIMIT 200').bind(...a.internal?[]:[a.orgId,String(a.id)]));return json({events:records});
  }
  if(p[0]==='commercial'){
   if(!a.commercial)fail(403,'owner_commercial_access_required');
   const orderNumber=text(p[1]);const order=await env.DB.prepare('SELECT * FROM medicine_orders WHERE order_number=?').bind(orderNumber).first();if(!order)fail(404,'order_not_found');
   if(request.method==='GET'&&p.length===2){const t=await env.DB.prepare('SELECT * FROM rx_economics WHERE order_number=?').bind(orderNumber).first();if(!t)return json({state:'costs_not_recorded',sellingPence:order.total_pence,currency:order.currency,orderKind:order.reorder_of_order_id?'repeat':'first',contributionPence:null});const entries=await all(env.DB.prepare('SELECT * FROM rx_finance_entries WHERE order_number=? ORDER BY occurred_at,id').bind(orderNumber));return json({terms:JSON.parse(t.terms_json),entries,reconciliation:reconcileEconomics(JSON.parse(t.terms_json),entries)});}
   if(request.method==='POST'&&p[2]==='terms'){
    const b=await input(request),terms=economicsTerms(b);if(terms.sellingPence!==order.total_pence||terms.orderKind!==(order.reorder_of_order_id?'repeat':'first'))fail(409,'terms_must_match_order');const g=authCondition(a,at());
    const rs=await env.DB.batch([env.DB.prepare(`INSERT OR IGNORE INTO rx_economics SELECT ?,1,?,? WHERE ${g.sql}`).bind(orderNumber,JSON.stringify(terms),at(),...g.args),env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,NULL,'economics',?,'terms_recorded',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),orderNumber,JSON.stringify({approvalReference:terms.approvalReference,costSourceReference:terms.costSourceReference}),at())]);if(rs[0].meta.changes!==1)fail(409,'order_terms_already_recorded_or_access_changed');return json({recorded:true,paymentRouteChanged:false,moneyMoved:false},201);
   }
   if(request.method==='POST'&&p[2]==='entry'){
    const b=await input(request);if(!['member_payment','refund','partner_settlement','adjustment_credit','clinical_fee','pharmacy_invoice','delivery_invoice','commission_received',...EXPENSE_KINDS].includes(b.kind)||!Number.isSafeInteger(b.amountPence)||b.amountPence<0)fail(422,'valid_finance_entry_required');
    text(b.eventReference);text(b.sourceReference);if(!Number.isFinite(Date.parse(b.occurredAt)))fail(422,'entry_time_required');
    const existing=await env.DB.prepare('SELECT * FROM rx_finance_entries WHERE event_reference=?').bind(b.eventReference).first();if(existing){if(existing.order_number!==orderNumber||existing.kind!==b.kind||existing.amount_pence!==b.amountPence||existing.source_reference!==b.sourceReference)fail(409,'finance_reference_conflict');return json({duplicate:true,moneyMoved:false});}
    const g=authCondition(a,at()),rs=await env.DB.batch([env.DB.prepare(`INSERT INTO rx_finance_entries SELECT ?,?,?,?,?,?,?,?,? WHERE ${g.sql}`).bind(crypto.randomUUID(),orderNumber,b.eventReference,b.kind,b.amountPence,'GBP',b.sourceReference,b.occurredAt,at(),...g.args),env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,NULL,'finance_entry',?,'entry_recorded',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),orderNumber,JSON.stringify({eventReference:b.eventReference,sourceReference:b.sourceReference}),at())]);if(rs[0].meta.changes!==1)fail(409,'access_changed');return json({recorded:true,moneyMoved:false},201);
   }
   if(request.method==='POST'&&p[2]==='decline-refund'){
    const b=await input(request);text(b.acceptedTermsReference);if(order.clinical_status!=='declined')fail(409,'declined_order_required');return json({...declineRefund(order.total_pence,b.assessmentFeeBps),acceptedTermsReference:b.acceptedTermsReference,moneyMoved:false});
   }
  }
  if(p[0]==='routing'&&request.method==='POST'){
   if(!a.commercial)fail(403,'owner_routing_access_required');const b=await input(request);return json(await selectFutureSupplier(env.DB,b));
  }
  if(p[0]==='integrations'){
   if(!a.commercial)fail(403,'owner_integration_access_required');
   if(request.method==='GET')return json({adapters:Object.entries(ADAPTERS).map(([id,v])=>({id,...v,live:false})),jobs:await all(env.DB.prepare('SELECT id,contract_id,order_number,operation,state,attempts,last_code,updated_at FROM rx_integration_jobs ORDER BY updated_at DESC LIMIT 200'))});
   const b=await input(request);if(p[1]==='capture')return json(await captureOrderRoute(env.DB,b));
   if(p[1]==='queue'){const route=await env.DB.prepare('SELECT * FROM rx_order_routes WHERE order_number=?').bind(b.orderNumber).first();if(!route)fail(404,'route_not_found');return json(await queueSubmission(env.DB,route));}
   if(p[1]==='reconcile')return json(await reconcileJob(env,b.id));
   if(p[1]==='submit'){
    // A built transport must NEVER become an unapproved real supplier transaction.
    if(env.SSTRX_ENVIRONMENT!=='synthetic')fail(403,'supplier_transaction_activation_not_approved');return json(await submitJob(env,b.id));
   }
  }
  fail(404,'not_found');
 }catch(e){return json({error:e.status?e.message:'platform_source_unavailable',counts:null,observedAt:at()},e.status||503);}
}
