import {createSstrxPortal} from '../sstrx-worker.mjs';
import {createQaAccessBoundary} from './access-boundary.mjs';
import {createQaNativeOrigin} from './native-origin.mjs';
import {QA_RX_ORIGIN} from './access-config.mjs';
import {REVIEWER_EXPIRY_CLIENT} from './reviewer-expiry.mjs';
const note='<div data-sst-test-notice role="note" style="padding:12px;background:#242c1b;color:#E7E3DA;font:600 14px/1.5 system-ui">FICTIONAL TEST SYSTEM · Simulated prescribing, dispensing and delivery · No real members, payments or shipments · Reviewer sign-in lasts 30 minutes · <a style="color:inherit" href="https://my-qa.sstrx.co.uk/qa/start">Start a fresh fictional order</a></div>';
const privateHeaders={'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
const requestFor=(request,hostname,origin)=>{const u=new URL(request.url);u.hostname=hostname;const h=new Headers(request.headers);h.delete('Host');if(h.has('Origin'))h.set('Origin',origin);return new Request(u,new Request(request,{headers:h}));};
const native={fetch(request,env,ctx){const p=new URL(request.url).pathname;return (p.startsWith('/v1/hq/clinical/')||p.startsWith('/v1/member/my-shift')||p.startsWith('/v1/member/clinical-records')||p.startsWith('/v1/member/secure-messages')||p==='/v1/member/care-card'?env.CLINICAL:env.CORE).fetch(request);}};
const api=Object.fromEntries(['hq-qa.sstrx.co.uk','my-qa.sstrx.co.uk','api-qa.sstrx.co.uk'].map(host=>[host,createQaNativeOrigin(native,{host})]));
const rx=createQaAccessBoundary(createSstrxPortal(QA_RX_ORIGIN));
const reviewerRuntime=createQaAccessBoundary({fetch(){return new Response(REVIEWER_EXPIRY_CLIENT,{headers:{...privateHeaders,'Content-Type':'text/javascript; charset=utf-8'}})}});
const pages=createQaAccessBoundary({async fetch(request,env){
 const u=new URL(request.url),origin=request.headers.get('Origin');
 if(!['GET','HEAD'].includes(request.method)||origin&&origin!==u.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return new Response('TEST origin required',{status:403,headers:privateHeaders});
 if(u.hostname==='my-qa.sstrx.co.uk'&&u.pathname==='/test-purchase')return new Response(null,{status:303,headers:{...privateHeaders,Location:u.origin+'/qa/start'}});
 if(u.hostname==='my-qa.sstrx.co.uk'&&u.pathname==='/test-checkout')return new Response('This old fictional checkout format has been retired. Check the existing order in My Shift before starting any new attempt.',{status:410,headers:{...privateHeaders,'Content-Type':'text/plain; charset=utf-8'}});
 let response;
 if(u.hostname==='my-qa.sstrx.co.uk'&&(u.pathname.startsWith('/qa/')||u.pathname==='/assets/qa-commerce.js')){response=await env.CORE.fetch(requestFor(request,'api.shiftsometimber.co.uk','https://shiftsometimber.co.uk'));
 }else if(u.hostname==='my-qa.sstrx.co.uk'&&(u.pathname.startsWith('/member/')&&!/^\/member\/(?:dashboard|login)(?:\.html)?\/?$/.test(u.pathname)||u.pathname.startsWith('/assets/clinical-records/'))){
  response=await env.CLINICAL.fetch(requestFor(request,'api.shiftsometimber.co.uk','https://my-timber.app'));
 }else{
  const prefix=u.hostname==='hq-qa.sstrx.co.uk'?'/hq':'/member';
  if(u.hostname==='my-qa.sstrx.co.uk'&&['/','/member/dashboard'].includes(u.pathname))return Response.redirect(u.origin+'/member/my-shift',303);
  if(u.hostname==='my-qa.sstrx.co.uk'&&['/member-login','/member-login.html','/member/login','/member/login.html'].includes(u.pathname))u.pathname='/login.html';
  if(u.hostname==='hq-qa.sstrx.co.uk'&&u.pathname==='/')u.pathname='/index.html';
  if(u.hostname==='api-qa.sstrx.co.uk')return Response.json({scope:'FICTIONAL TEST API',status:'Native authentication required',productionReady:false},{headers:privateHeaders});
  u.pathname=prefix+u.pathname;response=await env.ASSETS.fetch(new Request(u,{method:request.method}));
 }
 const headers=new Headers(response.headers);for(const [k,v]of Object.entries(privateHeaders))headers.set(k,v);
 if((headers.get('Content-Type')||'').includes('text/html')&&request.method!=='HEAD'){
  const html=(await response.text()).replace(/(<body[^>]*>)/,'$1'+note);headers.delete('Content-Length');headers.delete('ETag');headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");return new Response(html,{status:response.status,headers});
 }
 return new Response(response.body,{status:response.status,headers});
}});
export default {async fetch(request,env,ctx){const u=new URL(request.url);if(env.SSTRX_QA_STACK!=='joined-v31')return new Response('TEST stack unavailable',{status:503,headers:privateHeaders});const response=u.pathname==='/assets/qa-reviewer-expiry.js'?await reviewerRuntime.fetch(request,env,ctx):u.hostname==='rx-qa.sstrx.co.uk'?await rx.fetch(request,env,ctx):u.pathname.startsWith('/v1/')||u.pathname==='/hq/catalogue-controls'?await api[u.hostname]?.fetch(request,env,ctx)||new Response('Not found',{status:404}):await pages.fetch(request,env,ctx);if(request.method==='HEAD'||!(response.headers.get('Content-Type')||'').includes('text/html'))return response;let html=(await response.text()).replaceAll('href="https://hq.shiftsometimber.co.uk/','href="https://hq-qa.sstrx.co.uk/');if(!html.includes('data-sst-test-notice'))html=html.replace(/(<body[^>]*>)/,'$1'+note);const expires=response.headers.get('X-SST-QA-Review-Expires');if(/^[0-9]+$/.test(expires||''))html=html.replace('</body>','<script defer src="/assets/qa-reviewer-expiry.js" data-review-expires="'+expires+'"></script></body>');const h=new Headers(response.headers);h.delete('Content-Length');h.delete('ETag');for(const [k,v]of Object.entries(privateHeaders))h.set(k,v);return new Response(html,{status:response.status,headers:h});}};
