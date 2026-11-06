import {RX_MESSAGE_CLIENT} from './platform/messages-ui.mjs';
import {cataloguePage,CATALOGUE_CLIENT} from './platform/catalogue-ui.mjs';
// Branded gateway over the original partner gateway. Same identity and services.
import {createPortal} from './worker.mjs';
import {partnerHqPage,BRAND} from './ui.mjs';
import {signInPage,workspacePage,SST_RX_CSS,SST_RX_CLIENT,FUNCTIONAL_CLIENT,FUNCTIONAL_CSS} from './platform/ui.mjs';
import {SST_LOGO_BASE64} from './assets/logo-data.mjs';
import {accessRequestPage,ACCESS_REQUEST_CSS,ACCESS_REQUEST_CLIENT} from './platform/access-ui.mjs';
import {signAccessRequest} from './platform/access-requests.mjs';
import {readObject} from './platform/domain.mjs';
const ORIGIN='https://sstrx.shiftsometimber.co.uk',native=createPortal(ORIGIN);
const paths=new Set(['overview','clinical','prescriptions','dispensing','delivery','patients','messages','reports','settings','diagnostics','finance','catalogue']);
function memberEntrance(){return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Welcome · SST Rx</title><link rel="stylesheet" href="/assets/sstrx.css"></head><body class="rx-app rx-login"><header class="rx-top"><img class="rx-logo" src="/assets/sstrx-logo.png" alt="SST Rx"><span>PART OF THE SHIFT FAMILY</span></header><main class="rx-entry"><section class="rx-intro"><p>YOUR ACCOUNT. YOUR CARE.</p><h1>Welcome to SST Rx</h1><p>One joined-up SHIFT journey, with the right access for you.</p></section><section class="rx-signin"><h2>I'm a member</h2><p>Orders, care and secure messages. Continue with your existing My Timber account.</p><a class="rx-access-cta" href="/member-sign-in">Member sign-in</a><p>You will sign in securely through My Timber.</p><hr><h2>I'm a professional</h2><p>Authorised clinician and pharmacy access.</p><a class="rx-access-cta" href="/professionals">Professional sign-in</a><p><a href="/request-access">Request professional access</a></p></section></main></body></html>`;}
async function handle(request,env){
 const url=new URL(request.url);if(url.origin!==ORIGIN)return new Response('Not found',{status:404});
 // Derive security headers from the retained gateway; never set a parent-domain cookie.
 const secure=async(body,type='text/html; charset=utf-8',status=200)=>{const base=await native.fetch(new Request(ORIGIN+'/robots.txt'),env),headers=new Headers(base.headers);headers.set('Content-Type',type);return new Response(request.method==='HEAD'?null:body,{status,headers});};
 if(url.pathname==='/assets/sstrx-logo.png'&&['GET','HEAD'].includes(request.method))return secure(Uint8Array.from(atob(SST_LOGO_BASE64),c=>c.charCodeAt(0)),'image/png');
 if(url.pathname==='/assets/sstrx.css'&&['GET','HEAD'].includes(request.method))return secure(SST_RX_CSS+ACCESS_REQUEST_CSS+FUNCTIONAL_CSS,'text/css; charset=utf-8');
 if(url.pathname==='/assets/access-request.js'&&['GET','HEAD'].includes(request.method))return secure(ACCESS_REQUEST_CLIENT,'text/javascript; charset=utf-8');
 if(url.pathname==='/assets/sstrx.js'&&['GET','HEAD'].includes(request.method))return secure(SST_RX_CLIENT+RX_MESSAGE_CLIENT+FUNCTIONAL_CLIENT,'text/javascript; charset=utf-8');
 if(url.pathname==='/assets/catalogue.js'&&['GET','HEAD'].includes(request.method))return secure(CATALOGUE_CLIENT,'text/javascript; charset=utf-8');
 const open=env.SSTRX_PORTAL_ENABLED==='true';
 if(env.MY_SHIFT_REDESIGN_ENABLED==='true'&&['GET','HEAD'].includes(request.method)){
  if(url.pathname==='/')return secure(memberEntrance());
  if(url.pathname==='/member-sign-in')return new Response(null,{status:303,headers:{Location:'https://shiftsometimber.co.uk/member-login?returnTo=%2Fmember%2Fmy-shift','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
  if(url.pathname==='/professionals')return secure(signInPage(open&&env.PARTNER_ACCESS_ENABLED==='true'));
 }
 if(url.pathname==='/'&&['GET','HEAD'].includes(request.method))return secure(signInPage(open&&env.PARTNER_ACCESS_ENABLED==='true').replace('<div class="rx-access-note">','<a class="rx-access-cta" href="/request-access">Request access</a><div class="rx-access-note">'));
 if(url.pathname==='/request-access'&&['GET','HEAD'].includes(request.method))return secure(accessRequestPage(env.SSTRX_ACCESS_REQUESTS_ENABLED==='true'));
 if(url.pathname==='/api/access-request'){
  if(!open||env.SSTRX_ACCESS_REQUESTS_ENABLED!=='true')return secure(JSON.stringify({error:'access_requests_not_available'}),'application/json',503);
  if(request.method!=='POST'||request.headers.get('Origin')!==ORIGIN||request.headers.get('Sec-Fetch-Site')==='cross-site')return secure(JSON.stringify({error:'same_origin_request_required'}),'application/json',403);
  try{const b=await readObject(request,6500),raw=JSON.stringify(b),proof=await signAccessRequest(env.SSTRX_ACCESS_REQUEST_KEY,raw,request.headers.get('CF-Connecting-IP')||'missing-address');
   const r=await env.CLINICAL.fetch(new Request('https://api.shiftsometimber.co.uk/v1/hq/clinical/access-requests',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',...proof},body:raw}));return secure(await r.text(),'application/json',r.status);
  }catch(e){return secure(JSON.stringify({error:e.status?e.message:'access_requests_not_available'}),'application/json',e.status||503);}
 }
 if(!open&&url.pathname!=='/robots.txt'&&url.pathname!=='/api/logout')return secure(JSON.stringify({error:'sst_rx_release_not_activated'}),'application/json',503);
 if(url.pathname.startsWith('/workspace/')&&paths.has(url.pathname.split('/')[2])&&['GET','HEAD'].includes(request.method)){
  const identity=await native.fetch(new Request(ORIGIN+'/api/identity',{headers:request.headers}),env);
  if(!identity.ok)return new Response(null,{status:303,headers:{...Object.fromEntries(identity.headers),Location:'/'}});
  const profile=await identity.json(),kind=profile.partner.kind;
  const functional=env.SSTRX_FUNCTIONAL_V3_ENABLED==='true',commercial=kind==='oversight'&&['owner','admin'].includes(profile.user.role);
  if(url.pathname==='/workspace/finance'&&(!functional||!commercial))return secure('Your current role does not include finance access.','text/plain',403);
  if(url.pathname==='/workspace/catalogue')return kind==='clinician'?secure(cataloguePage()):secure('Current prescriber access is required.','text/plain',403);
  const admin=['clinical_admin','pharmacy_admin','oversight'].includes(kind);
  if(admin){if(!['overview','patients','reports','settings',...functional&&commercial?['finance']:[]].includes(url.pathname.split('/')[2]))return secure('Your role does not include clinical or dispensing actions.','text/plain',403);return secure(workspacePage({kind,nativeHtml:'',messagesHtml:'',functional,commercial}));}
  if(kind==='dispensing'&&['/workspace/clinical','/workspace/diagnostics'].includes(url.pathname))return secure('Your role does not include clinical casework.','text/plain',403);
  if(kind==='clinician'&&['/workspace/dispensing','/workspace/delivery'].includes(url.pathname))return secure('Your role does not include pharmacy operations.','text/plain',403);
  const page=await native.fetch(new Request(ORIGIN+(kind==='clinician'?'/workspace/clinical':'/workspace/dispensing'),{headers:request.headers}),env);
  if(!page.ok)return page;
  return secure(workspacePage({kind,nativeHtml:await page.text(),messagesHtml:partnerHqPage(kind),functional,commercial}));
 }
 const response=await native.fetch(request,env);
 if(url.pathname==='/clinical-assets/client.mjs'&&response.ok){const code=await response.text();return secure(code+"\ndocument.addEventListener('sstrx-open-record',async e=>{await showPortal();await open(e.detail);});\n",'text/javascript; charset=utf-8');}
 if(url.pathname==='/clinical-assets/partners/client.mjs'&&response.ok){const code=await response.text();return secure(code+"\ndocument.addEventListener('sstrx-open-record',e=>openOrder(e.detail));\n",'text/javascript; charset=utf-8');}
 if(response.ok&&response.headers.get('Content-Type')?.includes('text/html')){const html=(await response.text()).replaceAll(BRAND,'<a class="brand" href="/" aria-label="SST Rx home"><img class="rx-logo" src="/assets/sstrx-logo.png" alt="SST Rx"></a>').replace('</head>','<link rel="stylesheet" href="/assets/sstrx.css"></head>').replace(/<title>([\s\S]*?)<\/title>/i,(_,title)=>'<title>'+title.replace(/ \| SHIFT$/,'')+' · SST Rx</title>');return secure(html);}
 return response;
}
export default {async fetch(request,env){try{return await handle(request,env)}catch{return Response.json({error:'sst_rx_source_unavailable'},{status:503,headers:{'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'}})}}};
