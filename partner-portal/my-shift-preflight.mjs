// Keep the existing service in charge of every authenticated operation. This
// wrapper admits only the browser's content-free CORS negotiation while the
// new member-support feature is staged at zero percent.
const API='https://api.shiftsometimber.co.uk';
const HQ='https://hq.shiftsometimber.co.uk';
const ROOT='/v1/hq/clinical/platform/my-shift-support';
export function withMyShiftPreflight(original){return{...original,fetch(request,env,ctx){
 const u=new URL(request.url),path=u.pathname;
 if(request.method!=='OPTIONS'||u.origin!==API||!(path===ROOT||path.startsWith(ROOT+'/')))return original.fetch(request,env,ctx);
 const method=request.headers.get('Access-Control-Request-Method');
 const headers=(request.headers.get('Access-Control-Request-Headers')||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
 if(request.headers.get('Origin')!==HQ||!['GET','POST'].includes(method)||headers.some(h=>h!=='content-type'))return original.fetch(request,env,ctx);
 return new Response(null,{status:204,headers:{'Cache-Control':'no-store, private','Access-Control-Allow-Origin':HQ,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin, Access-Control-Request-Method, Access-Control-Request-Headers'}});
}};}
