import {qaStubProvider} from './stub-provider.mjs';
import {qaRefundEnvironment} from './finance-transport.mjs';
import {qaStatementEnvironment} from './statement-transport.mjs';
import {qaPricePaymentEnvironment,qaPricePaymentRoutes} from './price-payment-transport.mjs';
// Private service binding only: no routes, workers.dev or preview URL.
import clinical from '../service/clinical-service.mjs';
import member from '../service/member-service.mjs';
import {qaDatabaseAdmitted} from './database-boundary.mjs';
export default {async fetch(request,env,ctx){
 if(!await qaDatabaseAdmitted(env))return new Response('TEST service unavailable',{status:503});
 const p=new URL(request.url).pathname;
 if(p==='/v1/hq/clinical/platform/processor/adjustments')return Response.json({error:'no_external_price_processor_in_qa'},{status:403,headers:{'Cache-Control':'no-store'}});
 env=await qaPricePaymentEnvironment(await qaStatementEnvironment(await qaRefundEnvironment(env)));
 const price=await qaPricePaymentRoutes(request,env);if(price)return price;
 if(env.SSTRX_QA_FULFILMENT_ENABLED==='true')env={...env,SSTRX_SYNTHETIC_ADAPTER:qaStubProvider(env)};
 return (p.startsWith('/v1/member/')||p.startsWith('/member/')||p.startsWith('/assets/clinical-records/')?member:clinical).fetch(request,env,ctx);
}};
