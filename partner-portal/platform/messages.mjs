// Private conversations share the existing clinical record, identity and D1 store.
// HQ receives routing metadata, never member/professional message content.
import {fail,text,digest} from './domain.mjs';
import {permission,authCondition,currentPartner,credentialsCurrent} from '../service/clinical-kernel.mjs';
const now=()=>new Date().toISOString(),rows=async q=>(await q.all()).results||[];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const columns='t.id,t.record_id,t.order_number,t.org_id,t.channel,t.status,t.version,t.created_at,t.updated_at';
function guard(a,date){return a.member?{sql:"EXISTS(SELECT 1 FROM user_sessions s JOIN users u ON u.id=s.user_id JOIN user_auth v ON v.user_id=u.id WHERE s.user_id=? AND s.token_hash=? AND s.revoked_at IS NULL AND julianday(s.expires_at)>julianday(?) AND v.email_verified=1)",args:[a.id,a.sessionHash,date]}:authCondition(a,date);}
function scope(a){
 if(a.member)return {sql:'t.member_id=? AND EXISTS(SELECT 1 FROM clinical_member_records r WHERE r.id=t.record_id AND r.user_id=?)',args:[a.id,a.id],body:true};
 if(a.internal)return {sql:'1=1',args:[],body:false};
 if(a.orgAdmin)return {sql:'t.org_id=?',args:[a.orgId],body:false};
 if(a.staff?.kind==='clinician'&&permission(a.staff,'weight_management','review',now()))return {sql:"t.channel='clinical' AND t.org_id=? AND EXISTS(SELECT 1 FROM clinical_member_records r JOIN clinical_case_assignments x ON x.record_id=r.id WHERE r.id=t.record_id AND r.review_sharing=1 AND x.hq_user_id=? AND x.active=1 AND x.expires_at>?)",args:[a.orgId,a.id,now()],body:true};
 if(a.staff?.kind==='dispensing'&&permission(a.staff,'weight_management','view_fulfilment',now()))return {sql:"t.channel='pharmacy' AND t.org_id=? AND EXISTS(SELECT 1 FROM partner_fulfilment f WHERE f.order_number=t.order_number AND f.partner_id=?)",args:[a.orgId,a.orgId],body:true};
 fail(403,'assigned_care_team_required');
}
async function target(env,a,recordId,channel){
 const record=await env.DB.prepare('SELECT * FROM clinical_member_records WHERE id=?').bind(recordId).first();if(!record||a.member&&record.user_id!==a.id)fail(404,'record_not_found');
 if(!['clinical','pharmacy'].includes(channel))fail(422,'care_team_required');
 if(!a.member&&a.staff?.kind!==(channel==='clinical'?'clinician':'dispensing'))fail(403,'assigned_care_team_required');
 let candidates;
 if(channel==='clinical'){
  if(!record.review_sharing)fail(403,'clinical_sharing_required');
  candidates=await rows(env.DB.prepare("SELECT p.state_json FROM clinical_case_assignments x JOIN partner_staff p ON p.hq_user_id=x.hq_user_id WHERE x.record_id=? AND x.active=1 AND x.expires_at>? AND p.kind='clinician'").bind(record.id,now()));
 }else candidates=await rows(env.DB.prepare("SELECT p.state_json FROM partner_fulfilment f JOIN partner_staff p ON p.org_id=f.partner_id WHERE f.order_number=? AND p.kind='dispensing'").bind(record.order_number));
 const verified=[];for(const row of candidates){const staff=JSON.parse(row.state_json);if(staff.status!=='active'||!credentialsCurrent(staff,now())||!permission(staff,'weight_management',channel==='clinical'?'review':'view_fulfilment',now())||!a.member&&staff.hqUserId!==a.id)continue;try{await currentPartner(env,staff);verified.push(staff)}catch{}}
 const orgs=[...new Set(verified.map(s=>s.orgId))];if(orgs.length!==1)fail(409,'one_verified_assigned_care_team_required');
 return {record,orgId:orgs[0],professionals:verified};
}
export async function listConversations(env,a){
 const s=scope(a),readKind=a.member?'member':a.internal?'hq':'professional';
 const threads=await rows(env.DB.prepare(`SELECT ${columns},COALESCE(z.version,0) read_version,json_extract(o.state_json,'$.name') organisation,EXISTS(SELECT 1 FROM rx_messages m WHERE m.thread_id=t.id AND m.version>COALESCE(z.version,0) AND m.actor_kind=?) incoming_unread FROM rx_message_threads t LEFT JOIN rx_message_reads z ON z.thread_id=t.id AND z.actor_kind=? AND z.actor_id=? LEFT JOIN partner_organisations o ON o.id=t.org_id WHERE ${s.sql} ORDER BY t.updated_at DESC,t.id LIMIT 101`).bind(a.member?'professional':'member',readKind,a.id,...s.args));
 return {threads:threads.slice(0,100).map(({incoming_unread,...t})=>({...t,unread:s.body?!!incoming_unread:t.version>t.read_version})),hasMore:threads.length>100,contentAvailable:s.body,metadataOnly:!s.body,notificationsSent:false};
}
async function visible(env,a,id,body=false){const s=scope(a);if(body&&!s.body)fail(403,'message_content_restricted_to_member_and_care_team');const t=await env.DB.prepare(`SELECT t.* FROM rx_message_threads t WHERE t.id=? AND ${s.sql}`).bind(id,...s.args).first();if(!t)fail(404,'conversation_not_found');return t;}
export async function readConversation(env,a,id){
 const t=await visible(env,a,id,true),s=scope(a),g=guard(a,now());
 const messages=await rows(env.DB.prepare(`SELECT m.version,m.actor_kind,m.author_label,m.body,m.created_at FROM rx_messages m WHERE m.thread_id=? AND EXISTS(SELECT 1 FROM rx_message_threads t WHERE t.id=m.thread_id AND ${s.sql}) AND ${g.sql} ORDER BY m.version`).bind(id,...s.args,...g.args));
 const organisation=await env.DB.prepare('SELECT state_json FROM partner_organisations WHERE id=?').bind(t.org_id).first();
 return {thread:{id:t.id,record_id:t.record_id,order_number:t.order_number,channel:t.channel,version:t.version,status:t.status,recipient:(t.channel==='clinical'?'Clinical team':'Dispensing pharmacy')+(organisation?' · '+JSON.parse(organisation.state_json).name:'')},messages,notificationsSent:false};
}
export async function markConversationRead(env,a,id,b){
 const t=await visible(env,a,id),s=scope(a),date=now(),g=guard(a,date);if(!Number.isInteger(b.version)||b.version<1||b.version>t.version)fail(422,'observed_version_required');
 await env.DB.prepare(`INSERT INTO rx_message_reads SELECT ?,?,?,?,? WHERE ${g.sql} AND EXISTS(SELECT 1 FROM rx_message_threads t WHERE t.id=? AND ${s.sql}) ON CONFLICT(thread_id,actor_kind,actor_id) DO UPDATE SET version=MAX(version,excluded.version),read_at=excluded.read_at`).bind(id,a.member?'member':a.internal?'hq':'professional',a.id,b.version,date,...g.args,id,...s.args).run();return {readVersion:b.version,contentAvailable:s.body};
}
export async function sendSecureMessage(env,a,id,b){
 if(!a.member&&(a.internal||a.orgAdmin))fail(403,'member_or_assigned_professional_required');
 if(!uuid.test(b.clientReference||''))fail(422,'valid_message_reference_required');const body=text(b.message,4000),actorKind=a.member?'member':'professional',payload=await digest([body,b.recordId||null,b.channel||null,id||null]);
 const previous=await env.DB.prepare('SELECT * FROM rx_messages WHERE id=?').bind(b.clientReference).first();
 if(previous){await visible(env,a,previous.thread_id,true);if(previous.actor_kind!==actorKind||previous.actor_id!==a.id||previous.payload_digest!==payload)fail(409,'message_reference_changed');return {id:previous.thread_id,version:previous.version,duplicate:true,notificationsSent:false};}
 let t,assigned;
 if(id)t=await visible(env,a,id,true);else{
  assigned=await target(env,a,b.recordId,b.channel);t=await env.DB.prepare('SELECT * FROM rx_message_threads WHERE record_id=? AND org_id=? AND channel=?').bind(b.recordId,assigned.orgId,b.channel).first();
  if(t)fail(409,'conversation_already_exists');t={id:crypto.randomUUID(),record_id:b.recordId,order_number:assigned.record.order_number,member_id:assigned.record.user_id,org_id:assigned.orgId,channel:b.channel,version:0};
 }
 if(t.version>0&&b.version!==t.version)fail(409,'conversation_changed');
 assigned=assigned||await target(env,a,t.record_id,t.channel);if(assigned.orgId!==t.org_id)fail(409,'assigned_care_team_changed');
 const date=now(),g=guard(a,date),version=t.version+1,status=a.member?'awaiting_professional':'awaiting_member',scopeGuard=a.member?{sql:'r.user_id=?',args:[a.id]}:t.channel==='clinical'?{sql:'r.review_sharing=1 AND EXISTS(SELECT 1 FROM clinical_case_assignments x WHERE x.record_id=r.id AND x.hq_user_id=? AND x.active=1 AND x.expires_at>?)',args:[a.id,date]}:{sql:'EXISTS(SELECT 1 FROM partner_fulfilment f WHERE f.order_number=r.order_number AND f.partner_id=?)',args:[a.orgId]};
 // Assignment, verified professional state and session are rechecked inside the write.
 const careGuard=t.channel==='clinical'?"r.review_sharing=1 AND EXISTS(SELECT 1 FROM clinical_case_assignments x JOIN partner_staff p ON p.hq_user_id=x.hq_user_id WHERE x.record_id=r.id AND x.active=1 AND x.expires_at>? AND p.org_id=? AND json_extract(p.state_json,'$.status')='active')":"EXISTS(SELECT 1 FROM partner_fulfilment f WHERE f.order_number=r.order_number AND f.partner_id=?)";
 const careArgs=t.channel==='clinical'?[date,t.org_id]:[t.org_id],checks=`${g.sql} AND EXISTS(SELECT 1 FROM clinical_member_records r WHERE r.id=? AND ${scopeGuard.sql} AND ${careGuard})`,args=[...g.args,t.record_id,...scopeGuard.args,...careArgs];
 const first=t.version===0?env.DB.prepare(`INSERT OR IGNORE INTO rx_message_threads SELECT ?,?,?,?,?,?,?,1,?,? WHERE ${checks}`).bind(t.id,t.record_id,t.order_number,t.member_id,t.org_id,t.channel,status,date,date,...args):env.DB.prepare(`UPDATE rx_message_threads SET version=?,status=?,updated_at=? WHERE id=? AND version=? AND ${checks}`).bind(version,status,date,t.id,t.version,...args);
 const author=a.member?'Member':a.staff.details.name;
 const statements=[first,env.DB.prepare('INSERT INTO rx_messages SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1').bind(b.clientReference,t.id,version,actorKind,a.id,author,body,payload,date),env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,?,'secure_message',?,'message_recorded',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),t.org_id,t.id,JSON.stringify({version,actorKind}),date)];
 if(a.member)for(const staff of assigned.professionals)statements.push(alertStatement(env,'member:'+b.clientReference+':'+staff.id,'professional',staff.id,'member_message',t.id,version,date));
 else{
  statements.push(alertStatement(env,'professional:'+b.clientReference,'member',String(t.member_id),'member_message',t.id,version,date));
  const event='secure-message:'+b.clientReference;statements.push(env.DB.prepare("INSERT OR IGNORE INTO clinical_notification_events SELECT ?,?,?,?,'secure_message','You have a secure message','Sign in to My Timber to read and reply securely.',?,? WHERE EXISTS(SELECT 1 FROM rx_messages WHERE id=? AND thread_id=?)").bind(event,t.member_id,t.record_id,t.order_number,'/member/messages',date,b.clientReference,t.id));
  statements.push(env.DB.prepare("INSERT OR IGNORE INTO clinical_notification_channels SELECT ?,'app','awaiting_approval',NULL,NULL,? WHERE EXISTS(SELECT 1 FROM clinical_notification_events WHERE id=?)").bind(event,date,event));
 }
 statements.push(alertStatement(env,'owner:'+b.clientReference,'hq_owner',null,'member_message',t.id,version,date));
 const result=await env.DB.batch(statements);if(result[0].meta.changes!==1)fail(409,'conversation_or_access_changed');return {id:t.id,version,status,notificationsSent:false,notificationStatus:'awaiting_approval'};
}
function alertStatement(env,id,kind,recipient,source,sourceId,version,date){return env.DB.prepare("INSERT OR IGNORE INTO rx_message_alerts SELECT ?,?,?,?,?,?,'awaiting_approval',NULL,? WHERE EXISTS(SELECT 1 FROM rx_message_threads WHERE id=? AND version=?)").bind(id,kind,recipient,source,sourceId,version,date,sourceId,version);}
export function hqConversationAlerts(env,t,actor,date){
 const side=actor.internal?'professional':'hq_owner',recipient=actor.internal?t.staff_id:null;
 return [env.DB.prepare("INSERT OR IGNORE INTO rx_message_alerts SELECT ?,?,?,?,?,?,'awaiting_approval',NULL,? WHERE EXISTS(SELECT 1 FROM partner_hq_threads WHERE id=? AND version=?)").bind('hq-thread:'+t.id+':'+t.version,side,recipient,'hq_partner_message',t.id,t.version,date,t.id,t.version)];
}
export async function messageAlertDrafts(env,a){
 if(!a.internal||!['owner','admin'].includes(a.role))fail(403,'owner_message_alert_review_required');
 const alerts=await rows(env.DB.prepare("SELECT * FROM rx_message_alerts WHERE status='awaiting_approval' ORDER BY created_at LIMIT 100")),drafts=[];
 for(const alert of alerts){let recipients=[];
  if(alert.recipient_kind==='member'){const r=await env.DB.prepare('SELECT u.email FROM users u JOIN user_auth x ON x.user_id=u.id WHERE u.id=? AND x.email_verified=1').bind(Number(alert.recipient_id)).first();if(r)recipients=[r.email];}
  if(alert.recipient_kind==='professional'){const r=await env.DB.prepare('SELECT state_json FROM partner_staff WHERE id=?').bind(alert.recipient_id).first();if(r){const staff=JSON.parse(r.state_json);if(staff.status==='active'&&credentialsCurrent(staff,now())){try{await currentPartner(env,staff);recipients=[staff.details.email]}catch{}}}}
  if(alert.recipient_kind==='hq_owner')recipients=(await rows(env.DB.prepare("SELECT email FROM hq_users WHERE role='owner' AND status='active' AND mfa_enabled=1"))).map(r=>r.email);
  recipients=recipients.filter(e=>typeof e==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const link=alert.recipient_kind==='member'?'https://shiftsometimber.co.uk/member/messages':alert.recipient_kind==='professional'?'https://sstrx.shiftsometimber.co.uk/workspace/messages':'https://hq.shiftsometimber.co.uk/';
  drafts.push({id:alert.id,to:recipients,cc:[],subject:alert.recipient_kind==='hq_owner'?'A secure conversation needs attention':'You have a secure message',body:'There is a new secure message or conversation update. Sign in to read it and check whether a response is needed.\n\n'+link,attachments:[],source:alert.source,createdAt:alert.created_at,recipientVerificationRequired:true,approvalRequired:true,sent:false});
 }
 return {drafts,notificationsSent:false,sendAvailable:false};
}
