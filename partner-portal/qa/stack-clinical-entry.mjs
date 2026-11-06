// Private service binding only: no routes, workers.dev or preview URL.
import clinical from '../service/clinical-service.mjs';
import member from '../service/member-service.mjs';
import {qaDatabaseAdmitted} from './database-boundary.mjs';
export default {async fetch(request,env,ctx){
 if(!await qaDatabaseAdmitted(env))return new Response('TEST service unavailable',{status:503});
 const p=new URL(request.url).pathname;
 return (p.startsWith('/v1/member/')||p.startsWith('/member/')||p.startsWith('/assets/clinical-records/')?member:clinical).fetch(request,env,ctx);
}};
