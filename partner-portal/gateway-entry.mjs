// One deployed gateway, two explicitly admitted origins; existing partners stay put.
import legacy from './worker.mjs';
import sstrx from './sstrx-worker.mjs';
export default {fetch(request,env,ctx){
 const origin=new URL(request.url).origin;
 if(origin==='https://partner.shiftsometimber.co.uk')return legacy.fetch(request,env,ctx);
 if(origin==='https://sstrx.shiftsometimber.co.uk')return sstrx.fetch(request,env,ctx);
 return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow'}});
}};
