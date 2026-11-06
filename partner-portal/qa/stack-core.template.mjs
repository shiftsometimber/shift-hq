// Generated imports resolve the exact explicit Core source before bundling.
import core from '__CORE_ROOT__/worker.js';
import hq from '__CORE_ROOT__/hq-ai-v2.js';
import {hqCatalogueRoutes} from '__CORE_ROOT__/hq-catalogue-v1.js';
import {medicineCommerceRoutes} from '__CORE_ROOT__/medicine-commerce-v1.js';
import {handleEmailVerification} from '__CORE_ROOT__/auth-email-verification-v1.js';
import {publicTurnstileConfig} from '__CORE_ROOT__/turnstile-auth-v1.js';
import {qaDatabaseAdmitted} from '__QA_ROOT__/database-boundary.mjs';
export default {async fetch(request,env,ctx){
 if(!await qaDatabaseAdmitted(env)||env.STRIPE_SECRET_KEY||env.EMAIL||env.PHARMACY_CLINICAL_INTAKE_URL)return Response.json({error:'isolated_test_bindings_required'},{status:503});
 const path=new URL(request.url).pathname;
 if(request.method==='POST'&&['/v1/auth/register','/v1/auth/request-password-reset','/v1/auth/resend-verification','/v1/hq/auth/bootstrap'].includes(path))return Response.json({error:'provided_test_accounts_required',message:'Use the prepared fictional TEST accounts. No real account or outgoing email can be created here.'},{status:403});
 if(request.method==='POST'&&path==='/v1/hq/users'){let b;try{b=await request.clone().json()}catch{return Response.json({error:'invalid_json'},{status:400})}if(!/@example\.(?:test|invalid)$/i.test(b.email||''))return Response.json({error:'fictional_staff_email_required'},{status:403});}
 if(request.method==='GET'&&path==='/v1/auth/turnstile-config')return Response.json(publicTurnstileConfig(env,request));
 const catalogue=await hqCatalogueRoutes(request,env,ctx);if(catalogue)return catalogue;
 const medicine=await medicineCommerceRoutes(request,env,ctx);if(medicine)return medicine;
 if(path.startsWith('/v1/hq/'))return hq.fetch(request,env,ctx);
 return await handleEmailVerification(request,env,ctx,(r,e,c)=>core.fetch(r,e,c))||core.fetch(request,env,ctx);
}};
