import original,{existingHqIdentity,partnerRoute,prescriptionHqRoute,hqClinicalRoute,commissioningRoute,notificationManagementRoute,internalDispensingAdapters,credentialsCurrent,currentPartner} from './clinical-kernel.mjs';
import {ensureSharedSchema} from './schema.mjs';
import {withSharedOutbox,drainSharedWorkflow,completeSharedResponse} from './shared-workflow.mjs';
import {hqDeskRoute} from './hq-desk.mjs';
import {platformRoute} from '../platform/service.mjs';
import {linkOutstandingPaidOrders} from '../platform/intake.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {publicAccessRequest} from '../platform/access-requests.mjs';
import {hqMyShiftSupport} from '../platform/my-shift-support.mjs';
import {ensureFunctionalSchema} from '../platform/functional-casework.mjs';
import {stripeRefundWebhook} from '../platform/refunds.mjs';
import {stripePriceWebhook} from '../platform/price-adjustments.mjs';
import {ensureLifecycleSchema} from '../platform/prescription-lifecycle.mjs';
import {ensureRefundSchema} from '../platform/refunds.mjs';
import {ensureAuditSchema} from '../platform/audit-export.mjs';
const API='/v1/hq/clinical';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private','Access-Control-Allow-Origin':'https://hq.shiftsometimber.co.uk','Access-Control-Allow-Credentials':'true','Vary':'Origin'}});
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.hostname!=='api.shiftsometimber.co.uk'||!url.pathname.startsWith(API))return original.fetch(request,env,ctx);
  try{
   if(url.pathname===API+'/platform/processor/refunds')return stripeRefundWebhook(request,env);
   if(url.pathname===API+'/platform/processor/adjustments')return stripePriceWebhook(request,env);
   if(env.SSTRX_FUNCTIONAL_V3_ENABLED==='true'){await ensureFunctionalSchema(env.DB);await ensureLifecycleSchema(env.DB);}
   if(env.SSTRX_AUDIT_V3_ENABLED==='true'){await ensurePlatformSchema(env.DB);await ensureRefundSchema(env.DB);await ensureAuditSchema(env.DB);}
   if(url.pathname===API+'/access-requests')return publicAccessRequest(request,env);
   const support=await hqMyShiftSupport(request,env);if(support)return support;
   if(env.SSTRX_PLATFORM_ENABLED==='true'){await ensureSharedSchema(env.DB);await ensurePlatformSchema(env.DB);const platform=await platformRoute(request,env);if(platform)return platform;}
   const desk=await hqDeskRoute(request,env);if(desk)return desk;
   // Onboarding exposes only the current professional's activation state, never cases.
   if(url.pathname===API+'/partners/enrolment'&&request.method==='GET'){
    if(env.PARTNER_LOGIN_ENABLED!=='true'||env.PARTNER_INTERNAL_SETUP_ONLY==='true')return json({error:'professional_onboarding_not_open'},503);
    const auth=await existingHqIdentity(request,env);if(auth.response)return auth.response;
    if(auth.user?.role!=='clinical')return json({error:'partner_role_required'},403);
    const record=await env.DB.prepare('SELECT state_json FROM partner_staff WHERE hq_user_id=?').bind(auth.user.id).first(),staff=record?JSON.parse(record.state_json):null;
    if(!staff||!['credentials_pending','active'].includes(staff.status)||!credentialsCurrent(staff,new Date().toISOString()))return json({error:'approved_professional_required'},403);
    await currentPartner(env,staff);return json({kind:staff.kind,status:staff.status,mfaEnabled:auth.user.mfaEnabled===true});
   }
   const flags={...env,NOTIFICATION_EVENTS_ENABLED:'true',PARTNER_OPERATIONS_ENABLED:'true',PARTNER_INTERNAL_SETUP_ONLY:env.PARTNER_INTERNAL_SETUP_ONLY==='false'?'false':'true',PRESCRIPTION_WORKFLOW_ENABLED:'true',PARTNER_NOTIFICATION_REVIEW_ENABLED:'true'};
   if(env.SHARED_ORDER_WORKFLOW_ENABLED==='true')await ensureSharedSchema(env.DB);
   const run=withSharedOutbox(flags);
   const rx=await prescriptionHqRoute(request,run,existingHqIdentity);if(rx)return completeSharedResponse(rx,request,env);
   const setup=await commissioningRoute(request,run,existingHqIdentity);if(setup)return setup;
   const notifications=await notificationManagementRoute(request,run,existingHqIdentity);if(notifications)return notifications;
   const partner=await partnerRoute(request,run,existingHqIdentity,internalDispensingAdapters(run));if(partner)return completeSharedResponse(partner,request,env);
   return completeSharedResponse(await hqClinicalRoute(request,run,existingHqIdentity),request,env);
  }catch{return json({error:'clinical_service_unavailable'},503);}
 },
 async scheduled(event,env,ctx){if(env.SHARED_ORDER_WORKFLOW_ENABLED==='true')ctx.waitUntil(drainSharedWorkflow(env));if(env.SSTRX_PAID_RECORD_LINK_ENABLED==='true')ctx.waitUntil(linkOutstandingPaidOrders(env));}
};
