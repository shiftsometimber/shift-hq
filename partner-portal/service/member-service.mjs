import original,{authenticate,sessionHash} from './member-kernel.mjs';
import {ensureSharedSchema} from './schema.mjs';
import {withSharedOutbox,completeSharedResponse} from './shared-workflow.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {readObject} from '../platform/domain.mjs';
import {linkPaidOrder} from '../platform/intake.mjs';
export default {async fetch(request,env,ctx){
 if(env.SHARED_ORDER_WORKFLOW_ENABLED!=='true')return original.fetch(request,env,ctx);
 const path=new URL(request.url).pathname;
 if(env.SSTRX_PLATFORM_ENABLED==='true'&&path.startsWith('/v1/member/clinical-records')){
  const origins=['https://shiftsometimber.co.uk','https://www.shiftsometimber.co.uk','https://my-timber.app'];
  const origin=request.headers.get('Origin');
  if(origin&&!origins.includes(origin)||request.method==='POST'&&!origins.includes(origin))return Response.json({error:'origin_not_allowed'},{status:403});
  const actor=await authenticate(request,env);
  const admitted=actor&&Number(actor.email_verified)===1&&(env.CLINICAL_REVIEW_READY==='true'||env.CLINICAL_TEST_MEMBER_EMAIL&&actor.email.toLowerCase()===env.CLINICAL_TEST_MEMBER_EMAIL.toLowerCase())&&env.CLINICAL_MEMBER_RECORDS_ENABLED==='true'&&env.CLINICAL_PRIVATE_FILES;
  if(admitted){
   await ensurePlatformSchema(env.DB);
   if(env.SSTRX_PAID_RECORD_LINK_ENABLED==='true'&&path==='/v1/member/clinical-records'&&request.method==='GET'){
    const {results=[]}=await env.DB.prepare("SELECT order_number FROM medicine_orders WHERE user_id=? AND status='paid' ORDER BY id DESC LIMIT 50").bind(actor.id).all();
    for(const order of results)await linkPaidOrder(env,order.order_number,actor.id);
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
