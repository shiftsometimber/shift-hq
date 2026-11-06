import {qaStubProvider} from './stub-provider.mjs';
import {qaRefundEnvironment} from './finance-transport.mjs';
// Private service binding only: no routes, workers.dev or preview URL.
import clinical from '../service/clinical-service.mjs';
import member from '../service/member-service.mjs';
import {qaDatabaseAdmitted} from './database-boundary.mjs';
export default {async fetch(request,env,ctx){
 if(!await qaDatabaseAdmitted(env))return new Response('TEST service unavailable',{status:503});
 env=await qaRefundEnvironment(env);
 if(env.SSTRX_QA_FULFILMENT_ENABLED==='true')env={...env,SSTRX_SYNTHETIC_ADAPTER:qaStubProvider(env)};
 const p=new URL(request.url).pathname;
 return (p.startsWith('/v1/member/')||p.startsWith('/member/')||p.startsWith('/assets/clinical-records/')?member:clinical).fetch(request,env,ctx);
}};
