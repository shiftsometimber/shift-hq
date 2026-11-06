// Extend the existing support_tickets queue. No separate My Shift message store.
import {fail,readObject} from './domain.mjs';
import {sessionHash} from '../service/member-kernel.mjs';
import {platformActor} from './service.mjs';
import {authCondition} from '../service/clinical-kernel.mjs';
import {passwordSignInAllowed} from '../password-signin.mjs';
const SUBJECT='My Shift support [thread-v1]',format='my-shift-support-1';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const now=()=>new Date().toISOString();
function thread(row){const t=JSON.parse(row.body);if(t.format!==format||!Number.isInteger(t.version)||!Array.isArray(t.messages))fail(503,'support_thread_unavailable');return t;}
function view(row,body=false){const t=thread(row);return{reference:row.reference,status:row.status,version:t.version,updatedAt:row.updated_at,unread:t.messages.some(m=>m.kind==='support'&&m.version>(t.memberReadVersion||0)),...(body?{messages:t.messages.map(({actorId,...m})=>m)}:{}),recipient:'SHIFT support',orderReference:t.orderReference||null,clinical:false};}
async function available(env){if(!await env.DB.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='support_tickets'").first())fail(503,'existing_support_queue_unavailable');}
function supportWriteGuard(env,actor,date){
 if(actor.mfa)return authCondition(actor,date);
 if(!passwordSignInAllowed(env,actor.user,Date.parse(date)))fail(403,'support_role_required');
 // The existing, time-limited owner/test exception applies to support replies
 // only. Clinical, prescribing and pharmacy write guards remain unchanged.
 return {sql:"EXISTS(SELECT 1 FROM hq_users h JOIN hq_sessions ss ON ss.hq_user_id=h.id WHERE h.id=? AND h.email=? AND h.role=? AND h.status='active' AND h.mfa_enabled=0 AND ss.token_hash=? AND ss.revoked_at IS NULL AND julianday(ss.expires_at)>julianday(?))",args:[actor.id,actor.user.email,actor.role,actor.sessionHash,date]};
}
export async function supportList(env,id){await available(env);const {results=[]}=await env.DB.prepare('SELECT reference,status,body,updated_at FROM support_tickets WHERE user_id=? AND subject=? ORDER BY updated_at DESC LIMIT 101').bind(id,SUBJECT).all();return{tickets:results.slice(0,100).map(r=>view(r)),hasMore:results.length>100};}
async function save(env,row,next,status,guard,preserveTime=false,actor){
 const at=preserveTime?row.updated_at:now(),auditAt=now();
 const r=await env.DB.batch([
  env.DB.prepare(`UPDATE support_tickets SET body=?,status=?,updated_at=?,assigned_hq_user_id=COALESCE(assigned_hq_user_id,?) WHERE reference=? AND user_id=? AND subject=? AND body=? AND ${guard.sql}`).bind(JSON.stringify(next),status,at,actor.kind==='support'?actor.id:null,row.reference,row.user_id,SUBJECT,row.body,...guard.args),
  env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,NULL,'support',?,?,?,? WHERE changes()=1").bind(crypto.randomUUID(),String(actor.id),row.reference,preserveTime?'support_read':'support_message',JSON.stringify({version:next.version,actorKind:actor.kind}),auditAt)
 ]);
 if(r[0].meta.changes!==1)fail(409,'support_or_access_changed');return{...view({...row,body:JSON.stringify(next),status,updated_at:at},true),notificationsSent:false};
}
function message(body){if(!uuid.test(body.clientReference||''))fail(422,'valid_message_reference_required');if(typeof body.message!=='string'||!body.message.trim()||body.message.trim().length>4000)fail(422,'message_required');return body.message.trim();}
export async function memberSupport(request,env,actor,parts){
 await available(env);if(parts.length>2||parts[1]&&parts[1]!=='read')fail(404,'support_not_found');
 const reference=parts[0];if(reference&&!/^MS-\d+-[a-f0-9-]{36}$/i.test(reference))fail(404,'support_not_found');
 if(!reference&&request.method==='GET')return supportList(env,actor.id);
 const row=reference?await env.DB.prepare('SELECT * FROM support_tickets WHERE reference=? AND user_id=? AND subject=?').bind(reference,actor.id,SUBJECT).first():null;
 if(reference&&!row)fail(404,'support_not_found');
 if(request.method==='GET'&&!parts[1])return view(row,true);
 if(request.method!=='POST')fail(405,'method_not_allowed');
 const b=await readObject(request,6500),at=now(),hash=await sessionHash(request,env,actor.id),guard={sql:"EXISTS(SELECT 1 FROM user_sessions s JOIN user_auth a ON a.user_id=s.user_id WHERE s.user_id=? AND s.token_hash=? AND s.revoked_at IS NULL AND julianday(s.expires_at)>julianday(?) AND a.email_verified=1)",args:[actor.id,hash,at]};
 if(parts[1]){const t=thread(row);if(!Number.isInteger(b.version)||b.version<0||b.version>t.version)fail(422,'observed_version_required');t.memberReadVersion=Math.max(t.memberReadVersion||0,b.version);return save(env,row,t,row.status,guard,true,{id:actor.id,kind:'member'});}
 const text=message(b);if(row&&b.orderReference!==undefined&&b.orderReference!==thread(row).orderReference)fail(409,'order_reference_changed');if(Object.keys(b).some(k=>!['clientReference','message','version','orderReference'].includes(k)))fail(422,'unknown_message_field');if(!row&&b.orderReference!==undefined&&(typeof b.orderReference!=='string'||b.orderReference.length>100||!await env.DB.prepare('SELECT 1 ok FROM medicine_orders WHERE order_number=? AND user_id=?').bind(b.orderReference,actor.id).first()))fail(404,'order_not_found');
 if(!row){const ref='MS-'+actor.id+'-'+b.clientReference,existing=await env.DB.prepare('SELECT * FROM support_tickets WHERE reference=? AND user_id=? AND subject=?').bind(ref,actor.id,SUBJECT).first();if(existing){if(thread(existing).messages[0]?.body!==text||(thread(existing).orderReference||null)!==(b.orderReference||null))fail(409,'message_reference_changed');return{...view(existing,true),duplicate:true};}
  const t={format,version:1,memberReadVersion:1,orderReference:b.orderReference||null,messages:[{id:b.clientReference,version:1,kind:'member',author:'You',body:text,at}]};
  const r=await env.DB.batch([env.DB.prepare(`INSERT OR IGNORE INTO support_tickets(reference,user_id,subject,priority,status,body,assigned_hq_user_id,created_at,updated_at) SELECT ?,?,?,'normal','open',?,NULL,?,? WHERE ${guard.sql} AND (SELECT COUNT(*) FROM support_tickets WHERE user_id=? AND subject=? AND status!='closed')<10`).bind(ref,actor.id,SUBJECT,JSON.stringify(t),at,at,...guard.args,actor.id,SUBJECT),env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,NULL,'support',?,'support_opened',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(actor.id),ref,JSON.stringify({version:1,actorKind:'member'}),at)]);if(r[0].meta.changes!==1)fail(409,'support_or_access_changed');return{...view({reference:ref,body:JSON.stringify(t),status:'open',updated_at:at},true),notificationsSent:false};
 }
 const t=thread(row),previous=t.messages.find(m=>m.id===b.clientReference);if(previous){if(previous.kind!=='member'||previous.body!==text)fail(409,'message_reference_changed');return{...view(row,true),duplicate:true};}if(b.version!==t.version)fail(409,'support_changed');if(t.messages.length>=200)fail(409,'support_thread_full');
 t.messages.push({id:b.clientReference,version:++t.version,kind:'member',author:'You',body:text,at});t.memberReadVersion=t.version;return save(env,row,t,'open',guard,false,{id:actor.id,kind:'member'});
}
export async function hqMyShiftSupport(request,env){
 const path=new URL(request.url).pathname,root='/v1/hq/clinical/platform/my-shift-support';if(path!==root&&!path.startsWith(root+'/'))return null;
 const json=(b,s=200)=>Response.json(b,{status:s,headers:{'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow','Access-Control-Allow-Origin':'https://hq.shiftsometimber.co.uk','Access-Control-Allow-Credentials':'true','Vary':'Origin'}});
 try{if(env.MY_SHIFT_REDESIGN_ENABLED!=='true')fail(404,'not_found');if(request.headers.get('Origin')!=='https://hq.shiftsometimber.co.uk')fail(403,'hq_origin_required');
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'https://hq.shiftsometimber.co.uk','Access-Control-Allow-Credentials':'true','Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'}});
  const a=await platformActor(request,env);if(a.response)return a.response;if(!a.internal||!['owner','admin','support','operations'].includes(a.role))fail(403,'support_role_required');await available(env);
  const reference=path.slice(root.length+1);if(!reference&&request.method==='GET'){const {results=[]}=await env.DB.prepare('SELECT * FROM support_tickets WHERE subject=? ORDER BY updated_at DESC LIMIT 100').bind(SUBJECT).all();return json({tickets:results.map(r=>({...view(r,true),memberId:r.user_id})),notificationsSent:false});}
  if(request.method!=='POST'||!/^MS-\d+-[a-f0-9-]{36}$/i.test(reference))fail(405,'method_not_allowed');const b=await readObject(request,6500),text=message(b),row=await env.DB.prepare('SELECT * FROM support_tickets WHERE reference=? AND subject=?').bind(reference,SUBJECT).first();if(!row)fail(404,'support_not_found');const t=thread(row),previous=t.messages.find(m=>m.id===b.clientReference);if(previous){if(previous.kind!=='support'||previous.actorId!==a.id||previous.body!==text)fail(409,'message_reference_changed');return json({...view(row,true),duplicate:true});}if(t.version!==b.version)fail(409,'support_changed');if(t.messages.length>=200)fail(409,'support_thread_full');t.messages.push({id:b.clientReference,version:++t.version,kind:'support',author:'SHIFT support',actorId:a.id,body:text,at:now()});return json(await save(env,row,t,'awaiting_member',supportWriteGuard(env,a,now()),false,{id:a.id,kind:'support'}));
 }catch(e){return json({error:e.status?e.message:'support_unavailable'},e.status||503);}
}
