import {setupStubProvider} from '../qa/stub-provider-setup.mjs';
import {providerReceiptRoute} from './provider-receipts.mjs';
import {passwordSignInAllowed} from '../password-signin.mjs';
import {functionalCaseRoute} from './functional-case-routes.mjs';
import {refundRoute} from './refunds.mjs';
import {financeOperationsRoute} from './finance-operations.mjs';
import {lifecycleRoute} from './prescription-lifecycle.mjs';
import {auditExportRoute} from './audit-export.mjs';
import {informationExceptions} from './functional-casework.mjs';
import {catalogueSignoff} from './catalogue.mjs';
import {listConversations,readConversation,sendSecureMessage,markConversationRead,messageAlertDrafts} from './messages.mjs';
import {createDiagnosticOrder} from './diagnostics.mjs';
import {existingHqIdentity,credentialsCurrent,currentPartner,permission,authCondition,newStaff} from '../service/clinical-kernel.mjs';
import {ensurePlatformSchema} from './schema.mjs';
import {SERVICES,API_VERSION,fail,text,economicsTerms,reconcileEconomics,commissioning,nextAction,declineRefund,EXPENSE_KINDS,readObject} from './domain.mjs';
import {ADAPTERS,selectFutureSupplier,captureOrderRoute,queueSubmission,submitJob,reconcileJob} from './integrations.mjs';
import {coordinateRecords,claimAction} from './coordination.mjs';
import {HOLD_KINDS} from './supply-holds.mjs';
const BASE='/v1/hq/clinical/platform',at=()=>new Date().toISOString();
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private','Access-Control-Allow-Origin':'https://hq.shiftsometimber.co.uk','Access-Control-Allow-Credentials':'true','Vary':'Origin','X-Content-Type-Options':'nosniff'}});
const all=async q=>(await q.all()).results||[];
const input=request=>readObject(request);
export async function platformActor(request,env){
 const identity=await existingHqIdentity(request,env);if(identity.response)return {response:identity.response};const u=identity.user;if(!u?.mfaEnabled&&!passwordSignInAllowed(env,u))fail(403,'mfa_required');
 const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)sst_hq_session=([^;]+)/)?.[1];if(!token)fail(401,'session_required');
 const {digest}=await import('./domain.mjs');const sessionHash=await digest(token);
 if(['owner','admin','operations','support'].includes(u.role))return {id:u.id,user:u,role:u.role,mfa:u.mfaEnabled===true,sessionHash,internal:true,commercial:['owner','admin'].includes(u.role)};
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
export async function overview(env,a,search=""){
 const filters=a.internal?'1=1':a.staff.kind==='clinical_admin'?`r.review_sharing=1 AND EXISTS(SELECT 1 FROM clinical_case_assignments x JOIN partner_staff ps ON ps.hq_user_id=x.hq_user_id WHERE x.record_id=r.id AND ps.org_id=? AND x.active=1 AND x.expires_at>?)`:a.staff.kind==='clinician'?`r.review_sharing=1 AND EXISTS(SELECT 1 FROM clinical_case_assignments x WHERE x.record_id=r.id AND x.hq_user_id=? AND x.active=1 AND x.expires_at>?)`:`f.partner_id=?`;
 const args=a.internal?[]:a.staff.kind==='clinical_admin'?[a.orgId,at()]:a.staff.kind==='clinician'?[a.id,at()]:[a.orgId];
 const source=await all(env.DB.prepare(`SELECT r.id recordId,r.order_number orderNumber,r.user_id memberId,r.updated_at updatedAt,cs.version caseVersion,cs.updated_at caseUpdatedAt,rx.version rxVersion,json_extract(rx.state_json,'$.status') rxStatus,CASE WHEN json_extract(rx.state_json,'$.status')='issued' THEN 'prescription_issued' ELSE cs.status END clinicalStatus,f.partner_id pharmacyOrgId,json_extract(f.state_json,'$.status') pharmacyStatus,json_extract(f.state_json,'$.dispensedAt') dispensedAt,f.version pharmacyVersion,f.updated_at pharmacyUpdatedAt,COALESCE(json_extract(f.state_json,'$.area'),'weight_management') service,m.medicine_name medicine,m.clinical_status sharedStatus,
 (SELECT COUNT(*) FROM rx_supply_holds h WHERE h.order_number=r.order_number AND h.state='open') openHolds,
 EXISTS(SELECT 1 FROM clinical_case_assignments x WHERE x.record_id=r.id AND x.active=1 AND x.expires_at>?) assigned,
 (SELECT COUNT(*) FROM partner_workflow_sync s WHERE s.order_number=r.order_number AND s.status='pending') syncPending,
 (SELECT MIN(due_at) FROM rx_followups u WHERE u.record_id=r.id AND u.status IN ('open','needs_owner')) reviewDueAt,
 m.reorder_of_order_id repeatOfOrderId
 FROM clinical_member_records r JOIN medicine_orders m ON m.order_number=r.order_number AND m.user_id=r.user_id LEFT JOIN clinical_case_state cs ON cs.record_id=r.id LEFT JOIN clinical_prescription_requests rx ON rx.record_id=r.id LEFT JOIN partner_fulfilment f ON f.order_number=r.order_number
 WHERE ${filters} AND (?='' OR r.order_number LIKE ? ESCAPE '\\' OR CAST(r.user_id AS TEXT)=? OR r.id=?) ORDER BY r.updated_at DESC LIMIT 201`).bind(at(),...args,search,'%'+search.replace(/[\\%_]/g,c=>'\\'+c)+'%',search,search));
 const records=await informationExceptions(env,a,await coordinateRecords(env,a,source.slice(0,200).map(r=>({...r,url:(a.staff?.kind==='dispensing'?'/workspace/dispensing#':'/workspace/clinical#')+r.recordId}))));
 const counts={};for(const r of records)counts[r.action.kind]=(counts[r.action.kind]||0)+1;
 const config=a.orgId?await all(env.DB.prepare('SELECT service,config_json,version,updated_at FROM rx_service_config WHERE org_id=?').bind(a.orgId)):[];
 return {apiVersion:API_VERSION,observedAt:at(),sessionExpiresAt:(await env.DB.prepare('SELECT expires_at FROM hq_sessions WHERE hq_user_id=? AND token_hash=? AND revoked_at IS NULL').bind(a.id,a.sessionHash).first())?.expires_at||null,source:'existing_clinical_order_and_fulfilment_records',memberExperienceCandidate:env.MY_SHIFT_REDESIGN_ENABLED==='true',role:a.staff?.kind||a.role,records,counts,coordination:{unowned:records.filter(r=>r.action.unowned).length,overdue:records.filter(r=>r.action.overdue).length,deadlineNotConfigured:records.filter(r=>r.action.deadlineState==='not_configured').length,held:records.filter(r=>r.openHolds).length,notificationsSent:false},coverage:{limit:200,hasMore:source.length>200,countsScope:'returned_authorised_records'},services:Object.entries(SERVICES).map(([id,s])=>{const c=config.find(c=>c.service===id);return {id,...s,...commissioning(c?JSON.parse(c.config_json):null)}}),integrations:Object.entries(ADAPTERS).map(([id,x])=>({id,label:x.label,state:x.state,live:false})),qaProviderManagementAvailable:env.SSTRX_QA_FULFILMENT_ENABLED==='true'&&env.SSTRX_ENVIRONMENT==='synthetic'&&a.commercial,qaProviderAvailable:env.SSTRX_QA_FULFILMENT_ENABLED==='true'&&env.SSTRX_ENVIRONMENT==='synthetic'&&a.staff?.kind==='dispensing'&&typeof env.SSTRX_SYNTHETIC_ADAPTER?.createEvent==='function',commercialAvailable:a.commercial};
}
export async function platformRoute(request,env){
 const url=new URL(request.url);if(url.pathname!==BASE&&!url.pathname.startsWith(BASE+'/'))return null;
 try{
  if(request.headers.get('Origin')&&request.headers.get('Origin')!=='https://hq.shiftsometimber.co.uk')fail(403,'origin_forbidden');
  if(request.method==='POST'&&request.headers.get('Origin')!=='https://hq.shiftsometimber.co.uk')fail(403,'origin_required');
  if(!['GET','POST'].includes(request.method))fail(405,'method_not_allowed');
  const a=await platformActor(request,env);if(a.response)return a.response;await ensurePlatformSchema(env.DB);
  const p=url.pathname.slice(BASE.length).split('/').filter(Boolean);
  const providerReceipt=await providerReceiptRoute(request,env,a,p);if(providerReceipt)return json(providerReceipt);
  const functionalCase=await functionalCaseRoute(request,env,a,p);if(functionalCase)return json(functionalCase);
  const refunds=await refundRoute(request,env,a,p);if(refunds)return json(refunds);
  const financeOperations=await financeOperationsRoute(request,env,a,p);if(financeOperations)return json(financeOperations);
  const lifecycle=await lifecycleRoute(request,env,a,p);if(lifecycle)return json(lifecycle);
  const auditExport=await auditExportRoute(request,env,a,p);if(auditExport)return json(auditExport);
  if(p[0]==='catalogue'&&p.length===2&&/^[1-9]\d*$/.test(p[1]))return json(await catalogueSignoff(request,env,a,Number(p[1])));
  if(p[0]==='identity'&&p.length===1&&request.method==='GET')return json({staff:a.staff||null,organisationId:a.orgId||null,role:a.staff?.kind||a.role});
  if(p[0]==='messages'){
   if(env.SSTRX_SECURE_MESSAGES_ENABLED!=='true')fail(503,'secure_messages_not_open');
   if(request.method==='GET'&&p.length===1)return json(await listConversations(env,a));
   if(request.method==='GET'&&p.length===2)return json(await readConversation(env,a,p[1]));
   if(request.method==='POST'&&p.length===3&&p[2]==='read')return json(await markConversationRead(env,a,p[1],await input(request)));
   if(request.method==='POST'&&p.length<=2)return json(await sendSecureMessage(env,a,p[1]||null,await input(request)),201);
   fail(404,'not_found');
  }
  if(p[0]==='message-alerts'){
   if(env.SSTRX_SECURE_MESSAGES_ENABLED!=='true')fail(503,'secure_messages_not_open');
   if(request.method==='GET'&&p.length===1)return json(await messageAlertDrafts(env,a));
   fail(404,'not_found');
  }
  if(p[0]==='access-requests'){
   if(!a.internal||!['owner','admin','operations'].includes(a.role))fail(403,'internal_access_reviewer_required');
   if(request.method==='GET'&&p.length===1){const list=await all(env.DB.prepare("SELECT * FROM rx_access_requests ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'needs_information' THEN 1 WHEN 'approved_for_onboarding' THEN 2 ELSE 3 END,created_at DESC LIMIT 101"));return json({requests:list.slice(0,100).map(r=>({...r,details:JSON.parse(r.details_json),details_json:undefined,duplicate_key:undefined,payload_digest:undefined,contactDetailsVerified:false})),hasMore:list.length>100,canApprove:a.commercial,organisations:await all(env.DB.prepare("SELECT id,json_extract(state_json,'$.name') name,json_extract(state_json,'$.kind') kind FROM partner_organisations WHERE json_extract(state_json,'$.status') IN ('pending','approved') ORDER BY name")),notificationsSent:false});}
   if(request.method==='POST'&&p.length===3&&['review','onboarding'].includes(p[2])){
    if(!a.commercial)fail(403,'owner_access_approval_required');const b=await input(request),row=await env.DB.prepare('SELECT * FROM rx_access_requests WHERE id=?').bind(p[1]).first();if(!row)fail(404,'access_request_not_found');if(row.version!==b.version)fail(409,'access_request_changed');const date=at(),g=authCondition(a,date);
    if(p[2]==='review'){
     if(!['approved_for_onboarding','declined','needs_information'].includes(b.decision)||!['pending','needs_information'].includes(row.status))fail(409,'request_not_awaiting_review');text(b.reviewNote,1000);
     const changes=await env.DB.batch([env.DB.prepare(`UPDATE rx_access_requests SET status=?,version=version+1,reviewed_by=?,review_note=?,updated_at=? WHERE id=? AND version=? AND status IN ('pending','needs_information') AND ${g.sql}`).bind(b.decision,a.id,b.reviewNote,date,row.id,b.version,...g.args),env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,NULL,'access_request',?,'reviewed',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),row.id,JSON.stringify({decision:b.decision}),date)]);if(changes[0].meta.changes!==1)fail(409,'request_or_access_changed');return json({status:b.decision,version:b.version+1,accessGranted:false,notificationsSent:false});
    }
    if(row.status!=='approved_for_onboarding')fail(409,'approved_request_required');const details=JSON.parse(row.details_json),kind=details.requestedRole==='clinician'?'clinician':details.requestedRole==='pharmacy_operator'?'dispensing':null;if(!kind)fail(409,'administrator_identity_and_membership_setup_required');
    const org=await env.DB.prepare('SELECT state_json FROM partner_organisations WHERE id=?').bind(b.orgId).first();if(!org)fail(422,'existing_organisation_required');const o=JSON.parse(org.state_json);if(o.kind!==(kind==='clinician'?'clinical':'pharmacy')||!['pending','approved'].includes(o.status))fail(422,'matching_organisation_required');
    const id=crypto.randomUUID(),staff=newStaff({kind,orgId:b.orgId,name:details.fullName,email:details.workEmail},id,date),changes=await env.DB.batch([
     env.DB.prepare(`INSERT INTO partner_staff SELECT ?,NULL,NULL,?,?,0,?,? WHERE ${g.sql} AND EXISTS(SELECT 1 FROM rx_access_requests WHERE id=? AND version=? AND status='approved_for_onboarding') AND EXISTS(SELECT 1 FROM partner_organisations WHERE id=? AND state_json=?)`).bind(id,kind,b.orgId,JSON.stringify(staff),date,...g.args,row.id,b.version,b.orgId,org.state_json),
     env.DB.prepare("UPDATE rx_access_requests SET status='onboarding_started',onboarding_staff_id=?,version=version+1,updated_at=? WHERE id=? AND version=? AND changes()=1").bind(id,date,row.id,b.version),
     env.DB.prepare("INSERT INTO partner_audit SELECT ?,'staff',?,0,?,'application_created',?,? WHERE changes()=1").bind(crypto.randomUUID(),id,String(a.id),JSON.stringify({source:'approved_sst_rx_request',requestId:row.id}),date)
    ]);if(changes[0].meta.changes!==1)fail(409,'request_or_access_changed');return json({staffId:id,status:'draft',accessGranted:false,credentialsCreated:false,notificationsSent:false},201);
   }
   fail(404,'not_found');
  }
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
  if(p[0]==='responsibility'&&p.length===1&&request.method==='POST'){
   const b=await input(request),view=await overview(env,a),record=view.records.find(r=>r.recordId===b.recordId);if(!record)fail(404,'case_not_found');return json(await claimAction(env,a,b,record));
  }
  if(p[0]==='operational-policy'&&p.length===1&&request.method==='POST'){
   if(!a.commercial)fail(403,'owner_policy_approval_required');const b=await input(request);text(b.approvalReference);if(!Object.hasOwn(SERVICES,b.service)||!Number.isInteger(b.version))fail(422,'valid_policy_required');
   const org=await env.DB.prepare('SELECT state_json FROM partner_organisations WHERE id=?').bind(b.orgId).first();if(!org||JSON.parse(org.state_json).status!=='approved')fail(422,'approved_organisation_required');
   const windows=b.windowsMinutes;if(!windows||typeof windows!=='object'||Array.isArray(windows)||Object.entries(windows).some(([k,v])=>!['reconcile_status','review_supply_hold','decline_finance_review','verify_prescription','dispense','dispatch','await_delivery','assign_review','await_member_information','await_treatment_response','prescriber_signoff','confirm_handover','prepare_prescription','clinical_review','pharmacy_query','pharmacy_rejected','pharmacy_delivery_exception','pharmacy_returned'].includes(k)||!Number.isInteger(v)||v<1||v>43200))fail(422,'valid_operational_windows_required');
   const old=await env.DB.prepare('SELECT * FROM rx_service_config WHERE org_id=? AND service=?').bind(b.orgId,b.service).first();if((old?.version||0)!==b.version)fail(409,'policy_changed');const config=old?JSON.parse(old.config_json):{};config.operationalPolicy={approvalReference:b.approvalReference,windowsMinutes:windows};const g=authCondition(a,at()),date=at();
   const result=await env.DB.batch([env.DB.prepare(`INSERT INTO rx_service_config SELECT ?,?,1,?,? WHERE ${g.sql} ON CONFLICT(org_id,service) DO UPDATE SET version=rx_service_config.version+1,config_json=excluded.config_json,updated_at=excluded.updated_at WHERE rx_service_config.version=?`).bind(b.orgId,b.service,JSON.stringify(config),date,...g.args,b.version),env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,?,'operational_policy',?,'policy_recorded',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),b.orgId,b.service,JSON.stringify({approvalReference:b.approvalReference}),date)]);if(result[0].meta.changes!==1)fail(409,'policy_or_access_changed');return json({recorded:true,version:b.version+1,clinicalPathwayEnabled:false,notificationsSent:false});
  }
  if(p[0]==='supply-holds'&&p.length===2){
   const orderNumber=text(p[1]),r=await env.DB.prepare('SELECT id FROM clinical_member_records WHERE order_number=?').bind(orderNumber).first();if(!r)fail(404,'order_not_found');
   const view=await overview(env,a,orderNumber);if(!view.records.some(x=>x.orderNumber===orderNumber))fail(404,'order_not_found');
   if(request.method==='GET')return json({holds:await all(env.DB.prepare('SELECT id,kind,state,version,source_reference,review_reference,created_at,updated_at FROM rx_supply_holds WHERE order_number=? ORDER BY created_at').bind(orderNumber))});
   const b=await input(request),date=at(),g=authCondition(a,date);if(a.orgAdmin)fail(403,'professional_or_operations_account_required');
   if(b.action==='open'){
    if(!HOLD_KINDS.includes(b.kind))fail(422,'valid_supply_concern_required');text(b.sourceReference,300);text(b.clientReference,100);
    const id='hold-'+b.clientReference,prior=await env.DB.prepare('SELECT * FROM rx_supply_holds WHERE id=?').bind(id).first();if(prior){if(prior.order_number!==orderNumber||prior.kind!==b.kind||prior.source_reference!==b.sourceReference)fail(409,'hold_reference_conflict');return json({id,state:prior.state,duplicate:true});}
    const results=await env.DB.batch([env.DB.prepare(`INSERT INTO rx_supply_holds SELECT ?,?,?,?,?, 'open',1,?,NULL,?,? WHERE ${g.sql}`).bind(id,orderNumber,b.kind,a.orgId||null,a.id,b.sourceReference,date,date,...g.args),env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,?,'supply_hold',?,'reported',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),a.orgId||null,id,JSON.stringify({kind:b.kind,orderNumber}),date)]);if(results[0].meta.changes!==1)fail(409,'access_changed');return json({id,state:'open',version:1,supplyBlocked:true,prescriptionCancelled:false,notificationsSent:false},201);
   }
   if(b.action==='resolve'){
    const hold=await env.DB.prepare("SELECT * FROM rx_supply_holds WHERE id=? AND order_number=? AND state='open'").bind(b.id,orderNumber).first();if(!hold)fail(404,'open_hold_not_found');
    if(a.internal||a.orgAdmin||!['clinician','dispensing'].includes(a.staff?.kind))fail(403,'authorised_professional_review_required');
    const area=view.records.find(x=>x.orderNumber===orderNumber).service;if(!permission(a.staff,area,a.staff.kind==='clinician'?'clinical_decision':'supply_decision',date,view.records.find(x=>x.orderNumber===orderNumber).medicine))fail(403,'authorised_professional_review_required');text(b.reviewReference,300);
    const scope=a.staff.kind==='clinician'?{sql:'EXISTS(SELECT 1 FROM clinical_case_assignments WHERE record_id=? AND hq_user_id=? AND active=1 AND expires_at>?)',args:[r.id,a.id,date]}:{sql:'EXISTS(SELECT 1 FROM partner_fulfilment WHERE order_number=? AND partner_id=?)',args:[orderNumber,a.orgId]};
    const results=await env.DB.batch([env.DB.prepare(`UPDATE rx_supply_holds SET state='resolved',version=version+1,review_reference=?,updated_at=? WHERE id=? AND version=? AND ${g.sql} AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=? AND state_json=?) AND EXISTS(SELECT 1 FROM partner_organisations WHERE id=? AND json_extract(state_json,'$.status')='approved' AND json_extract(state_json,'$.expiresAt')>?) AND ${scope.sql}`).bind(b.reviewReference,date,hold.id,b.version,...g.args,a.staff.id,a.staff.version,JSON.stringify(a.staff),a.orgId,date,...scope.args),env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,?,'supply_hold',?,'professional_review_recorded',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),a.orgId,hold.id,JSON.stringify({reviewReference:b.reviewReference}),date)]);if(results[0].meta.changes!==1)fail(409,'hold_or_access_changed');return json({state:'resolved',version:b.version+1,clinicalApproval:false,automaticRedispatch:false,notificationsSent:false});
   }
   fail(422,'valid_hold_action_required');
  }
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
   if(request.method==='GET'&&p.length===1)return json({orders:await all(env.DB.prepare('SELECT d.id,d.record_id,d.status,d.version,d.created_at,d.updated_at,l.priority,l.due_at,l.ack_at FROM rx_diagnostic_orders d LEFT JOIN rx_diagnostic_alerts l ON l.order_id=d.id WHERE d.org_id=? AND EXISTS(SELECT 1 FROM clinical_case_assignments x JOIN clinical_member_records r ON r.id=x.record_id WHERE x.record_id=d.record_id AND x.hq_user_id=? AND x.active=1 AND x.expires_at>? AND r.review_sharing=1) ORDER BY d.updated_at DESC LIMIT 200').bind(a.orgId,a.id,at()))});
   const order=await env.DB.prepare('SELECT * FROM rx_diagnostic_orders WHERE id=? AND org_id=?').bind(p[1]||'',a.orgId).first();if(!order||!await ownsCase(env,a,order.record_id))fail(404,'diagnostic_order_not_found');
   if(request.method==='GET'&&p[2]==='result'){
    if(!order.result_key||!order.result_digest)fail(409,'verified_result_not_available');const object=await env.CLINICAL_PRIVATE_FILES.get(order.result_key);if(!object)fail(503,'private_result_unavailable');
    const bytes=await new Response(object.body).arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==order.result_digest)fail(503,'private_result_integrity_failure');
    const g=authCondition(a,at()),audit=await env.DB.prepare(`INSERT INTO rx_platform_audit SELECT ?,?,?,'diagnostic_order',?,'result_viewed','{}',? WHERE ${g.sql} AND EXISTS(SELECT 1 FROM clinical_case_assignments WHERE record_id=? AND hq_user_id=? AND active=1 AND expires_at>?)`).bind(crypto.randomUUID(),String(a.id),a.orgId,order.id,at(),...g.args,order.record_id,a.id,at()).run();if(audit.meta.changes!==1)fail(403,'clinical_access_changed');
    return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="laboratory-result.pdf"','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
   }
   if(request.method==='POST'&&p[2]==='acknowledge'&&p.length===3){
    const b=await input(request);text(b.acknowledgementReference);if(order.status!=='result_available')fail(409,'result_not_ready_for_review');const date=at(),g=authCondition(a,date),r=await env.DB.batch([
     env.DB.prepare(`UPDATE rx_diagnostic_alerts SET acknowledged_by=?,ack_reference=?,ack_at=?,version=version+1 WHERE order_id=? AND version=? AND ack_at IS NULL AND ${g.sql} AND EXISTS(SELECT 1 FROM clinical_case_assignments WHERE record_id=? AND hq_user_id=? AND active=1 AND expires_at>?) AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=?)`).bind(a.id,b.acknowledgementReference,date,order.id,b.version,...g.args,order.record_id,a.id,date,a.staff.id,a.staff.version),
     env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,?,'diagnostic_order',?,'critical_result_acknowledged',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),a.orgId,order.id,JSON.stringify({acknowledgementReference:b.acknowledgementReference,resultDigest:order.result_digest}),date)
    ]);if(r[0].meta.changes!==1)fail(409,'critical_alert_or_access_changed');return json({acknowledged:true,clinicalReviewRequired:true,notificationsSent:false});
   }
   if(request.method==='POST'&&p[2]==='review'&&p.length===3){
    const b=await input(request);text(b.clinicalReviewReference);if(order.status!=='result_available')fail(409,'result_not_ready_for_review');const alert=await env.DB.prepare('SELECT * FROM rx_diagnostic_alerts WHERE order_id=?').bind(order.id).first();if(alert){if(!alert.ack_at)fail(409,'critical_result_acknowledgement_required');text(b.followupPlanReference);}
    const date=at(),g=authCondition(a,date),r=await env.DB.batch([env.DB.prepare(`UPDATE rx_diagnostic_orders SET status='reviewed',version=version+1,updated_at=? WHERE id=? AND version=? AND status='result_available' AND ${g.sql} AND EXISTS(SELECT 1 FROM clinical_case_assignments WHERE record_id=? AND hq_user_id=? AND active=1 AND expires_at>?) AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=?)`).bind(date,order.id,b.version,...g.args,order.record_id,a.id,date,a.staff.id,a.staff.version),env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,?,'diagnostic_order',?,'result_reviewed',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),a.orgId,order.id,JSON.stringify({clinicalReviewReference:b.clinicalReviewReference,followupPlanReference:b.followupPlanReference||null,resultDigest:order.result_digest}),date)]);if(r[0].meta.changes!==1)fail(409,'diagnostic_order_changed');return json({reviewRecorded:true,notificationsSent:false});
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
    const b=await input(request);if(env.SSTRX_FUNCTIONAL_V3_ENABLED==='true'&&['refund','refund_reversal'].includes(b.kind))fail(403,'processor_reconciled_refund_required');if(!['member_payment','refund','partner_settlement','adjustment_credit','clinical_fee','pharmacy_invoice','delivery_invoice','commission_received',...EXPENSE_KINDS].includes(b.kind)||!Number.isSafeInteger(b.amountPence)||b.amountPence<0)fail(422,'valid_finance_entry_required');
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
   if(request.method==='GET')return json({adapters:Object.entries(ADAPTERS).map(([id,v])=>({id,...v,live:false})),jobs:await all(env.DB.prepare('SELECT id,contract_id,order_number,operation,state,attempts,last_code,updated_at FROM rx_integration_jobs ORDER BY updated_at DESC LIMIT 200')),contracts:await all(env.DB.prepare("SELECT id,org_id,config_json FROM rx_supplier_contracts WHERE adapter_id='synthetic' AND state='approved' ORDER BY id")),testOrganisations:env.SSTRX_QA_FULFILMENT_ENABLED==='true'?await all(env.DB.prepare("SELECT id,json_extract(state_json,'$.name') name,json_extract(state_json,'$.kind') kind FROM partner_organisations WHERE json_extract(state_json,'$.status')='approved'")):[],testVariants:env.SSTRX_QA_FULFILMENT_ENABLED==='true'?await all(env.DB.prepare("SELECT v.id,m.name,v.strength_label FROM medicine_variants v JOIN medicine_products m ON m.id=v.medicine_id WHERE m.name GLOB 'TEST*' OR m.name GLOB 'Synthetic *'")):[]});
   const b=await input(request);if(p.length===2&&['stub-contract','stub-handover'].includes(p[1]))return json(await setupStubProvider(env,a,p[1],b));if(p[1]==='capture')return json(await captureOrderRoute(env.DB,b,env));
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
