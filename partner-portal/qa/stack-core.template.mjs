// Generated imports resolve the exact explicit Core source before bundling.
import core from '__CORE_ROOT__/worker.js';
export {SiteContentState} from '__CORE_ROOT__/site-content-state-v1.js';
import hq from '__CORE_ROOT__/hq-ai-v2.js';
import {hqCatalogueRoutes} from '__CORE_ROOT__/hq-catalogue-v1.js';
import {hqCommerceContentRoutes} from '__CORE_ROOT__/hq-commerce-content-v1.js';
import {radarRoutes} from '__CORE_ROOT__/radar-integration-v1.js';
import {medicineCommerceRoutes} from '__CORE_ROOT__/medicine-commerce-v1.js';
import {handleEmailVerification} from '__CORE_ROOT__/auth-email-verification-v1.js';
import {publicTurnstileConfig} from '__CORE_ROOT__/turnstile-auth-v1.js';
import {qaDatabaseAdmitted} from '__QA_ROOT__/database-boundary.mjs';
import {readCatalogueAuthority} from '__CORE_ROOT__/hq-catalogue-governance-v31.mjs';
import {qaCommerceAdmitted,qaCompleteCheckout,qaCheckout,QA_PAYMENT_KEY,QA_CALLBACK_KEY,QA_PHARMACY} from '__QA_ROOT__/commerce-transport.mjs';
import {qaStartHTML,qaCheckoutHTML,QA_COMMERCE_CLIENT} from '__QA_ROOT__/commerce-pages.mjs';
async function authenticateMember(request,env,ctx){const u=new URL(request.url);u.pathname='/v1/me';u.search='';const r=await core.fetch(new Request(u,{headers:request.headers}),env,ctx);if(!r.ok)return null;const d=await r.json();return d.user&&/@example\.(?:test|invalid)$/.test(d.user.email||'')?d.user:null;}
export default {async fetch(request,env,ctx){
 if(!await qaDatabaseAdmitted(env)||env.STRIPE_SECRET_KEY||env.EMAIL||env.PHARMACY_CLINICAL_INTAKE_URL)return Response.json({error:'isolated_test_bindings_required'},{status:503});
 const path=new URL(request.url).pathname;
 if(path==='/v1/commerce/stripe/webhook')return Response.json({error:'no_external_processor_in_qa'},{status:403});
 if(await qaCommerceAdmitted(env)){
  env={...env,STRIPE_SECRET_KEY:QA_PAYMENT_KEY,STRIPE_WEBHOOK_SECRET:QA_CALLBACK_KEY,PHARMACY_CLINICAL_INTAKE_URL:QA_PHARMACY,PHARMACY_INTEGRATION_SECRET:'FICTIONAL_QA_NO_PROVIDER_ACCOUNT',PUBLIC_SITE_URL:'https://my-qa.sstrx.co.uk'};
  if(request.method==='POST'&&['/v1/commerce/medicine-clinical-intake','/v1/commerce/medicine-checkout'].includes(path)){
   const body=path.endsWith('medicine-checkout')?await request.clone().json().catch(()=>null):await request.clone().formData().catch(()=>null),variant=Number(body instanceof FormData?body.get('variantId'):body?.variantId);
   if(variant!==9911)return Response.json({error:'fictional_test_variant_required'},{status:403});
   env.PHARMACY_CATALOGUE_PARTNER_ID=(await readCatalogueAuthority(env.DB,variant)).selectedPartner;
  }
  if(path.startsWith('/v1/qa/checkout/'))return await qaCompleteCheckout(request,env,ctx,medicineCommerceRoutes,authenticateMember)||Response.json({error:'not_found'},{status:404});
  if(path==='/assets/qa-commerce.js'&&request.method==='GET')return new Response(QA_COMMERCE_CLIENT,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'}});
  if(path==='/qa/start'||path.startsWith('/qa/checkout/')){
   if(request.method!=='GET')return Response.json({error:'method_not_allowed'},{status:405});
   const user=await authenticateMember(request,env,ctx);if(!user)return new Response(null,{status:303,headers:{Location:'/member-login','Cache-Control':'no-store'}});
   if(path!=='/qa/start'){const row=await qaCheckout(env,path.split('/').pop());if(!row||Number(row.member_id)!==Number(user.id))return Response.json({error:'simulated_checkout_not_found'},{status:404});}
   return new Response(path==='/qa/start'?qaStartHTML():qaCheckoutHTML(),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, private'}});
  }
 }
 if(request.method==='POST'&&['/v1/auth/register','/v1/auth/request-password-reset','/v1/auth/resend-verification','/v1/hq/auth/bootstrap'].includes(path))return Response.json({error:'provided_test_accounts_required',message:'Use the prepared fictional TEST accounts. No real account or outgoing email can be created here.'},{status:403});
 if(request.method==='POST'&&path==='/v1/hq/users'){let b;try{b=await request.clone().json()}catch{return Response.json({error:'invalid_json'},{status:400})}if(!/@example\.(?:test|invalid)$/i.test(b.email||''))return Response.json({error:'fictional_staff_email_required'},{status:403});}
 if(request.method==='GET'&&path==='/v1/auth/turnstile-config')return Response.json(publicTurnstileConfig(env,request));
 if((request.method==='GET'||request.method==='PATCH'&&/^\/v1\/hq\/radar\/ticker-controls\/[1-9]\d*$/.test(path))&&(path==='/hq/radar-controls'||path==='/hq/radar-social'||path.startsWith('/v1/hq/radar'))){const radar=await radarRoutes(request,env,ctx);if(radar)return radar;}
 const catalogue=await hqCatalogueRoutes(request,env,ctx);if(catalogue)return catalogue;
 const commerceContent=await hqCommerceContentRoutes(request,env,ctx);if(commerceContent)return commerceContent;
 const medicine=await medicineCommerceRoutes(request,env,ctx);if(medicine)return medicine;
 if(path.startsWith('/v1/hq/'))return hq.fetch(request,env,ctx);
 return await handleEmailVerification(request,env,ctx,(r,e,c)=>core.fetch(r,e,c))||core.fetch(request,env,ctx);
}};
