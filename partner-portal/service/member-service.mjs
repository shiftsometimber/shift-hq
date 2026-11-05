import {memberInbox} from '../platform/member-inbox.mjs';
import {myShiftRoutes} from '../platform/my-shift-routes.mjs';
import {listConversations,readConversation,sendSecureMessage,markConversationRead} from '../platform/messages.mjs';
import {MEMBER_MESSAGE_CLIENT} from '../platform/messages-ui.mjs';
import original,{authenticate,sessionHash} from './member-kernel.mjs';
import {ensureSharedSchema} from './schema.mjs';
import {withSharedOutbox,completeSharedResponse} from './shared-workflow.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {readObject} from '../platform/domain.mjs';
import {linkPaidOrder} from '../platform/intake.mjs';
import {ensureFunctionalSchema} from '../platform/functional-casework.mjs';
import {memberInformationRoute} from '../platform/member-information.mjs';
import {ensureRefundSchema} from '../platform/refunds.mjs';
import {ensureLifecycleSchema} from '../platform/prescription-lifecycle.mjs';
import {exportRecord} from '../platform/audit-export.mjs';
export default {async fetch(request,env,ctx){
 if(env.SHARED_ORDER_WORKFLOW_ENABLED!=='true')return original.fetch(request,env,ctx);
 if(env.SSTRX_FUNCTIONAL_V3_ENABLED==='true')await ensureFunctionalSchema(env.DB);
 const myShift=await myShiftRoutes(request,env);if(myShift)return myShift;
 const inbox=await memberInbox(request,env);if(inbox)return inbox;
 const path=new URL(request.url).pathname;
 if(env.SSTRX_SECURE_MESSAGES_ENABLED==='true'&&path==='/assets/clinical-records/client.mjs'&&request.method==='GET'){
  const response=await original.fetch(request,env,ctx);if(!response.ok)return response;return new Response(await response.text()+MEMBER_MESSAGE_CLIENT,{status:response.status,headers:response.headers});
 }

 if(env.SSTRX_PLATFORM_ENABLED==='true'&&path.startsWith('/v1/member/clinical-records')){
  const origins=['https://shiftsometimber.co.uk','https://www.shiftsometimber.co.uk','https://my-timber.app'];
  const origin=request.headers.get('Origin');
  if(origin&&!origins.includes(origin)||request.method==='POST'&&!origins.includes(origin))return Response.json({error:'origin_not_allowed'},{status:403});
  const actor=await authenticate(request,env);
  const expected=request.headers.get('X-My-Timber-Expected-Account');if(actor&&expected&&expected!==String(actor.id))return Response.json({error:'account_changed'},{status:409,headers:{'Cache-Control':'no-store, private'}});
  const admitted=actor&&Number(actor.email_verified)===1&&(env.CLINICAL_REVIEW_READY==='true'||env.CLINICAL_TEST_MEMBER_EMAIL&&actor.email.toLowerCase()===env.CLINICAL_TEST_MEMBER_EMAIL.toLowerCase())&&env.CLINICAL_MEMBER_RECORDS_ENABLED==='true'&&env.CLINICAL_PRIVATE_FILES;
  if(admitted){
   const information=await memberInformationRoute(request,withSharedOutbox(env),actor,original);if(information)return completeSharedResponse(information,request,env);
   await ensurePlatformSchema(env.DB);
   const exportPath=path.match(/^\/v1\/member\/clinical-records\/([a-f0-9-]{36})\/verified-export$/i);
   if(exportPath){const respond=(b,status=200)=>Response.json(b,{status,headers:{'Cache-Control':'no-store, private','Access-Control-Allow-Origin':origin||'https://my-timber.app','Access-Control-Allow-Credentials':'true','Vary':'Origin','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'}});try{if(request.method!=='POST')return respond({error:'method_not_allowed'},405);if(env.SSTRX_FUNCTIONAL_V3_ENABLED!=='true')return respond({error:'verified_export_not_open'},404);const b=await readObject(request,2000);await ensureRefundSchema(env.DB);await ensureLifecycleSchema(env.DB);const a={member:true,id:actor.id,sessionHash:await sessionHash(request,env,actor.id)};return respond(await exportRecord(env,a,exportPath[1],b.purpose));}catch(e){return respond({error:e.status?e.message:'verified_export_unavailable'},e.status||503);}}
   if(env.SSTRX_PAID_RECORD_LINK_ENABLED==='true'&&path==='/v1/member/clinical-records'&&request.method==='GET'){
    const {results=[]}=await env.DB.prepare("SELECT order_number FROM medicine_orders WHERE user_id=? AND status='paid' ORDER BY id DESC LIMIT 50").bind(actor.id).all();
    for(const order of results)await linkPaidOrder(env,order.order_number,actor.id);
   }
   const messagePath=path.match(/^\/v1\/member\/clinical-records\/([a-f0-9-]{36})\/messages(?:\/([a-f0-9-]{36})(?:\/(read))?)?$/i);
   if(messagePath){
    const respond=(b,status=200)=>Response.json(b,{status,headers:{'Cache-Control':'no-store, private','Access-Control-Allow-Origin':origin||'https://my-timber.app','Access-Control-Allow-Credentials':'true','Vary':'Origin','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'}});
    try{
     if(env.SSTRX_SECURE_MESSAGES_ENABLED!=='true')throw Object.assign(Error('secure_messages_not_open'),{status:503});
     if(!['GET','POST'].includes(request.method))throw Object.assign(Error('method_not_allowed'),{status:405});
     const owned=await env.DB.prepare('SELECT id FROM clinical_member_records WHERE id=? AND user_id=?').bind(messagePath[1],actor.id).first();if(!owned)return respond({error:'record_not_found'},404);
     const a={member:true,id:actor.id,sessionHash:await sessionHash(request,env,actor.id)};
     if(messagePath[2]){const t=await env.DB.prepare('SELECT id FROM rx_message_threads WHERE id=? AND record_id=? AND member_id=?').bind(messagePath[2],owned.id,actor.id).first();if(!t)return respond({error:'conversation_not_found'},404);}
     if(request.method==='GET'){const d=messagePath[2]?await readConversation(env,a,messagePath[2]):await listConversations(env,a);if(d.threads)d.threads=d.threads.filter(t=>t.record_id===owned.id);return respond(d);}
     const b=await readObject(request,6500);return respond(messagePath[3]?await markConversationRead(env,a,messagePath[2],b):await sendSecureMessage(env,a,messagePath[2]||null,{...b,recordId:owned.id}),201);
    }catch(e){return respond({error:e.status?e.message:'secure_messages_unavailable'},e.status||503);}
   }
   if(path==='/v1/member/clinical-records/repeats'&&request.method==='POST'){
    const respond=(b,s=200)=>Response.json(b,{status:s,headers:{'Cache-Control':'no-store, private','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Vary':'Origin'}});
    let b;try{b=await readObject(request,3000)}catch(e){return respond({error:e.message},e.status||400)}
    if(!/^[a-f0-9-]{36}$/i.test(b.clientReference||'')||typeof b.previousOrderNumber!=='string')return respond({error:'valid_repeat_request_required'},422);
    const owned=await env.DB.prepare("SELECT id,clinical_status FROM medicine_orders WHERE order_number=? AND user_id=? AND clinical_status='fulfilled'").bind(b.previousOrderNumber,actor.id).first();if(!owned)return respond({error:'eligible_previous_order_not_found'},404);
    const prior=await env.DB.prepare('SELECT * FROM rx_repeat_requests WHERE client_reference=?').bind(b.clientReference).first();
    if(prior){if(prior.member_id!==actor.id||prior.previous_order_number!==b.previousOrderNumber)return respond({error:'repeat_reference_conflict'},409);return respond({id:prior.id,status:prior.status,duplicate:true,clinicalApproval:false});}
    const date=new Date().toISOString(),id=crypto.randomUUID(),hash=await sessionHash(request,env,actor.id);
    const r=await env.DB.prepare("INSERT INTO rx_repeat_requests SELECT ?,?,?,?,'awaiting_review',? WHERE EXISTS(SELECT 1 FROM user_sessions WHERE user_id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>?)").bind(id,b.previousOrderNumber,actor.id,b.clientReference,date,actor.id,hash,date).run();if(r.meta.changes!==1)return respond({error:'session_changed'},401);
    return respond({id,status:'awaiting_review',clinicalApproval:false,checkoutCreated:false,notificationsSent:false},201);
   }
  }
 }
 await ensureSharedSchema(env.DB);const response=await original.fetch(request,withSharedOutbox(env),ctx);
 return completeSharedResponse(response,request,env);
}};
