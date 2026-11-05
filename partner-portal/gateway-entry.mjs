// One deployed gateway, two explicitly admitted origins; existing partners stay put.
import legacy from './worker.mjs';
import sstrx from './sstrx-worker.mjs';
import {HQ_PARTNER_DESK_SOURCE} from './assets/hq-desk-data.mjs';
export default {fetch(request,env,ctx){
 const url=new URL(request.url),origin=url.origin;
 // A single existing HQ browser module; no HQ page, session or API is proxied.
 // Its exact route avoids replacing concurrent HQ/public/member releases.
 if(origin==='https://hq.shiftsometimber.co.uk'&&url.pathname==='/hq-partner-desk.js'&&['GET','HEAD'].includes(request.method))return new Response(request.method==='HEAD'?null:HQ_PARTNER_DESK_SOURCE,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
 if(origin==='https://partner.shiftsometimber.co.uk')return legacy.fetch(request,env,ctx);
 if(origin==='https://sstrx.shiftsometimber.co.uk')return sstrx.fetch(request,env,ctx);
 return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow'}});
}};
