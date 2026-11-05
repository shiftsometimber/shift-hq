import {existingHqIdentity,credentialsCurrent,currentPartner,permission,authCondition} from './clinical-kernel.mjs';
import {ensureSharedSchema} from './schema.mjs';
import {overview} from '../platform/service.mjs';
const BASE='/v1/hq/clinical/partner-desk';
const now=()=>new Date().toISOString(),rows=async q=>(await q.all()).results||[];
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private','Access-Control-Allow-Origin':'https://hq.shiftsometimber.co.uk','Access-Control-Allow-Credentials':'true','Vary':'Origin','X-Content-Type-Options':'nosniff'}});
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
async function input(request){if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'json_required');const text=await request.text();if(text.length>6000)fail(413,'request_too_large');try{return JSON.parse(text)}catch{fail(400,'invalid_json')}}
const text=(v,max=2000)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))fail(422,'valid_message_required');return v.trim()};
async function actor(request,env){
 const data=await existingHqIdentity(request,env);if(data.response)return {response:data.response};
 const user=data.user;if(!user||!user.mfaEnabled)fail(403,'mfa_required');
 const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)sst_hq_session=([^;]+)/)?.[1];if(!token)fail(401,'session_required');
 const sessionHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),x=>x.toString(16).padStart(2,'0')).join('');
 const proof={id:user.id,role:user.role,mfa:true,sessionHash};
 if(['owner','admin','operations'].includes(user.role))return {user,...proof,internal:true};
 if(user.role!=='clinical')fail(403,'partner_role_required');
 const entry=await env.DB.prepare('SELECT state_json FROM partner_staff WHERE hq_user_id=?').bind(user.id).first();
 const staff=entry?JSON.parse(entry.state_json):null;
 if(!staff||staff.status!=='active'||!credentialsCurrent(staff,now()))fail(403,'verified_partner_required');
 await currentPartner(env,staff);return {user,staff,...proof,internal:false};
}
async function ownsOrder(env,a,number){
 if(a.internal)return !!await env.DB.prepare('SELECT id FROM medicine_orders WHERE order_number=?').bind(number).first();
 if(a.staff.kind==='clinician')return !!await env.DB.prepare(`SELECT r.id FROM clinical_member_records r JOIN clinical_case_assignments x ON x.record_id=r.id WHERE r.order_number=? AND x.hq_user_id=? AND x.active=1 AND x.expires_at>? AND r.review_sharing=1`).bind(number,a.user.id,now()).first()&&permission(a.staff,'weight_management','review',now());
 const r=await env.DB.prepare('SELECT state_json FROM partner_fulfilment WHERE order_number=? AND partner_id=?').bind(number,a.staff.orgId).first();
 return !!r&&permission(a.staff,'weight_management','view_fulfilment',now(),JSON.parse(r.state_json).medicine);
}
export async function hqDeskRoute(request,env){
 const url=new URL(request.url);if(url.pathname!==BASE&&!url.pathname.startsWith(BASE+'/'))return null;
 try{
  const origin=request.headers.get('Origin');if(origin&&origin!=='https://hq.shiftsometimber.co.uk')fail(403,'origin_forbidden');
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'https://hq.shiftsometimber.co.uk','Access-Control-Allow-Credentials':'true','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'}});
  if(request.method==='POST'&&origin!=='https://hq.shiftsometimber.co.uk')fail(403,'origin_required');
  const a=await actor(request,env);if(a.response)return a.response;await ensureSharedSchema(env.DB);
  const parts=url.pathname.slice(BASE.length).split('/').filter(Boolean);
  if(parts[0]==='questions'&&parts.length===1&&request.method==='GET'){
   if(!a.internal)fail(403,'hq_access_required');
   const questions=await rows(env.DB.prepare("SELECT id,order_number,status,priority,'SHIFT HQ' owner_name,created_at,updated_at FROM partner_hq_threads WHERE status='awaiting_hq' ORDER BY CASE priority WHEN 'urgent' THEN 0 ELSE 1 END,created_at LIMIT 101"));
   return json({threads:questions.slice(0,100),hasMore:questions.length>100});
  }
  if(parts[0]==='counts'&&parts.length===1&&request.method==='GET'){
   if(!a.internal)fail(403,'hq_access_required');
   const counts=await env.DB.prepare("SELECT COUNT(*) awaitingHq,SUM(CASE WHEN priority='urgent' THEN 1 ELSE 0 END) urgent FROM partner_hq_threads WHERE status='awaiting_hq'").first();return json({awaitingHq:counts.awaitingHq,urgent:counts.urgent||0,accessRequestsPending:env.SSTRX_ACCESS_REQUESTS_ENABLED==='true'?Number((await env.DB.prepare("SELECT COUNT(*) n FROM rx_access_requests WHERE status IN ('pending','needs_information')").first()).n):null});
  }
  if(parts[0]==='assign'&&parts.length===1&&request.method==='POST'){
   if(!a.internal)fail(403,'hq_assignment_required');const b=await input(request);
   if(!/^[a-f0-9-]{36}$/.test(b.recordId||'')||!Number.isInteger(b.staffUserId)||typeof b.active!=='boolean')fail(422,'valid_assignment_required');
   const record=await env.DB.prepare('SELECT id,order_number FROM clinical_member_records WHERE id=?').bind(b.recordId).first();if(!record)fail(404,'record_not_found');
   const entry=await env.DB.prepare('SELECT state_json FROM partner_staff WHERE hq_user_id=?').bind(b.staffUserId).first(),staff=entry?JSON.parse(entry.state_json):null;
   if(b.active){if(!staff||staff.kind!=='clinician'||!permission(staff,'weight_management','review',now()))fail(403,'verified_clinician_required');await currentPartner(env,staff);}
   const date=now(),expiry=new Date(Date.now()+7*86400000).toISOString(),g=authCondition(a,date),id=crypto.randomUUID();
   const result=await env.DB.batch([env.DB.prepare(`INSERT INTO clinical_case_assignments(record_id,hq_user_id,active,expires_at) SELECT ?,?,?,? WHERE ${g.sql} ON CONFLICT(record_id,hq_user_id) DO UPDATE SET active=excluded.active,expires_at=excluded.expires_at`).bind(record.id,b.staffUserId,b.active?1:0,expiry,...g.args),env.DB.prepare("INSERT INTO clinical_member_audit SELECT ?,?,?,'hq_assignment_changed',?,? WHERE changes()=1").bind(id,record.id,a.user.id,JSON.stringify({reviewerHqUserId:b.staffUserId,active:b.active,expiresAt:expiry,source:'hq_partner_desk'}),date)]);
   if(result[0].meta?.changes!==1)fail(409,'assignment_or_access_changed');return json({assigned:b.active,expiresAt:expiry,notificationsSent:false});
  }
  if(!parts.length&&request.method==='GET'){
   const threads=await rows(a.internal?env.DB.prepare('SELECT * FROM partner_hq_threads ORDER BY updated_at DESC LIMIT 100'):env.DB.prepare('SELECT * FROM partner_hq_threads WHERE org_id=? AND staff_id=? ORDER BY updated_at DESC LIMIT 100').bind(a.staff.orgId,a.staff.id));
   const visible=a.internal?threads:[];if(!a.internal)for(const thread of threads)if(await ownsOrder(env,a,thread.order_number))visible.push(thread);
   if(!a.internal)return json({threads:visible,internal:false});
   const orders=await rows(env.DB.prepare(`SELECT r.id recordId,r.order_number orderNumber,CASE WHEN json_extract(rx.state_json,'$.status')='issued' THEN 'prescription_issued' ELSE c.status END clinicalStatus,c.version caseVersion,m.clinical_status sharedStatus,m.status paymentStatus,f.partner_id pharmacyId,json_extract(f.state_json,'$.status') pharmacyStatus,
     (SELECT COUNT(*) FROM partner_hq_threads t WHERE t.order_number=r.order_number AND t.status='awaiting_hq') questions,
     (SELECT COUNT(*) FROM partner_workflow_sync s WHERE s.order_number=r.order_number AND s.status='pending') syncPending,
     (SELECT a.hq_user_id FROM clinical_case_assignments a WHERE a.record_id=r.id AND a.active=1 AND a.expires_at>? LIMIT 1) clinicianId
     FROM clinical_member_records r JOIN medicine_orders m ON m.order_number=r.order_number AND m.user_id=r.user_id LEFT JOIN clinical_case_state c ON c.record_id=r.id LEFT JOIN clinical_prescription_requests rx ON rx.record_id=r.id LEFT JOIN partner_fulfilment f ON f.order_number=r.order_number ORDER BY r.updated_at DESC LIMIT 150`).bind(now()));
   const professionals=await rows(env.DB.prepare(`SELECT p.hq_user_id id,json_extract(p.state_json,'$.details.name') name,p.kind,p.org_id orgId FROM partner_staff p WHERE json_extract(p.state_json,'$.status')='active' ORDER BY name`));
   const organisations=await rows(env.DB.prepare(`SELECT id,json_extract(state_json,'$.name') name,json_extract(state_json,'$.kind') kind,json_extract(state_json,'$.status') status FROM partner_organisations ORDER BY name`));
   const coordination=env.SSTRX_PLATFORM_ENABLED==='true'?await overview(env,a):null;
   if(coordination)for(const order of orders)order.action=coordination.records.find(r=>r.recordId===order.recordId)?.action||null;
   return json({internal:true,threads:visible,orders,professionals,organisations,coordination:coordination?.coordination||null,coverage:{orderLimit:150,ordersMayBePartial:orders.length>=150,threadLimit:100,threadsMayBePartial:threads.length>=100},counts:{accessRequestsPending:env.SSTRX_ACCESS_REQUESTS_ENABLED==='true'?Number((await env.DB.prepare("SELECT COUNT(*) n FROM rx_access_requests WHERE status IN ('pending','needs_information')").first()).n):null,followupsNeedingOwner:env.SSTRX_PLATFORM_ENABLED==='true'?Number((await env.DB.prepare("SELECT COUNT(*) n FROM rx_followups WHERE status='needs_owner'").first()).n):null,awaitingHq:visible.filter(t=>t.status==='awaiting_hq').length,unassigned:orders.filter(o=>!o.clinicianId&&o.paymentStatus==='paid'&&!['prescription_issued','declined','closed'].includes(o.clinicalStatus)&&!['fulfilled','cancelled','declined','dispatched','dispensing','sent_to_pharmacy','pharmacy_received'].includes(o.sharedStatus)).length,exceptions:orders.filter(o=>['query','rejected','delivery_exception','returned','cancelled'].includes(o.pharmacyStatus)||o.syncPending).length},readiness:{sstRxPlatformEnabled:env.SSTRX_PLATFORM_ENABLED==='true',sstRxUrl:env.SSTRX_PORTAL_ENABLED==='true'?'https://sstrx.shiftsometimber.co.uk/':null,partnerSignIn:env.PARTNER_LOGIN_ENABLED==='true',clinicalReview:env.CLINICAL_REVIEW_READY==='true',prescriptionSigning:env.PRESCRIPTION_SIGNING_ENABLED==='true'&&!!env.PRESCRIPTION_SIGNATURE_POLICY_REFERENCE,dispensing:env.PARTNER_FULFILMENT_ENABLED==='true',professionalCount:professionals.length},partnerUrl:'https://partner.shiftsometimber.co.uk/'});
  }
  if(parts[0]==='threads'&&parts.length===1&&request.method==='POST'){
   const b=await input(request),order=text(b.orderNumber,100);let recipient=a.staff;
   if(a.internal){if(!Number.isInteger(b.staffUserId))fail(422,'assigned_partner_required');const r=await env.DB.prepare('SELECT state_json FROM partner_staff WHERE hq_user_id=?').bind(b.staffUserId).first();recipient=r?JSON.parse(r.state_json):null;if(!recipient||recipient.status!=='active'||!credentialsCurrent(recipient,now()))fail(403,'verified_partner_required');await currentPartner(env,recipient);if(!await ownsOrder(env,{internal:false,staff:recipient,user:{id:b.staffUserId}},order))fail(403,'assigned_partner_required');}
   if(!await ownsOrder(env,a,order))fail(404,'order_not_found');
   const subject=text(b.subject,120),body=text(b.message),id=crypto.randomUUID(),date=now();const priority=b.priority==='urgent'?'urgent':'normal';
   const status=a.internal?'awaiting_partner':'awaiting_hq',g=authCondition(a,date);const result=await env.DB.batch([env.DB.prepare(`INSERT INTO partner_hq_threads SELECT ?,?,?,?,?,?,?,1,?,? WHERE ${g.sql} AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=?)`).bind(id,order,recipient.orgId,recipient.id,subject,priority,status,date,date,...g.args,recipient.id,recipient.version),env.DB.prepare("INSERT INTO partner_hq_messages SELECT ?,?,1,?,?,?,? WHERE changes()=1").bind(crypto.randomUUID(),id,a.user.id,a.internal?'hq':'partner',body,date)]);
   if(result[0].meta?.changes!==1)fail(409,'partner_or_access_changed');
   return json({id,status,version:1,notificationsSent:false},201);
  }
  if(parts[0]==='threads'&&parts.length>=2){
   const t=await env.DB.prepare('SELECT * FROM partner_hq_threads WHERE id=?').bind(parts[1]).first();
   if(!t||!a.internal&&(t.org_id!==a.staff.orgId||t.staff_id!==a.staff.id)||!await ownsOrder(env,a,t.order_number))fail(404,'thread_not_found');
   if(parts.length===2&&request.method==='GET')return json({thread:t,messages:await rows(env.DB.prepare('SELECT version,actor_kind,body,created_at FROM partner_hq_messages WHERE thread_id=? ORDER BY version').bind(t.id))});
   if(parts[2]==='reply'&&parts.length===3&&request.method==='POST'){
    const b=await input(request);if(b.version!==t.version)fail(409,'thread_changed');const message=text(b.message),version=t.version+1,date=now(),status=b.close===true?'closed':a.internal?'awaiting_partner':'awaiting_hq';
    const g=authCondition(a,date);const result=await env.DB.batch([env.DB.prepare(`UPDATE partner_hq_threads SET version=?,status=?,updated_at=? WHERE id=? AND version=? AND ${g.sql}`).bind(version,status,date,t.id,t.version,...g.args),env.DB.prepare("INSERT INTO partner_hq_messages SELECT ?,?,?,?,?,?,? WHERE changes()=1").bind(crypto.randomUUID(),t.id,version,a.user.id,a.internal?'hq':'partner',message,date)]);
    if(result[0].meta?.changes!==1)fail(409,'thread_changed');return json({status,version,notificationsSent:false});
   }
  }
  fail(404,'not_found');
 }catch(e){return json({error:e.status?e.message:'partner_desk_unavailable'},e.status||503);}
}
