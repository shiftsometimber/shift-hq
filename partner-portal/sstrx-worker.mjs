// Branded gateway over the original partner gateway. Same identity and services.
import {createPortal} from './worker.mjs';
import {partnerHqPage,BRAND} from './ui.mjs';
import {signInPage,workspacePage,SST_RX_CSS,SST_RX_CLIENT} from './platform/ui.mjs';
import {SST_LOGO_BASE64} from './assets/logo-data.mjs';
const ORIGIN='https://sstrx.shiftsometimber.co.uk',native=createPortal(ORIGIN);
const paths=new Set(['overview','clinical','prescriptions','dispensing','delivery','patients','messages','reports','settings']);
async function handle(request,env){
 const url=new URL(request.url);if(url.origin!==ORIGIN)return new Response('Not found',{status:404});
 // Derive security headers from the retained gateway; never set a parent-domain cookie.
 const secure=async(body,type='text/html; charset=utf-8',status=200)=>{const base=await native.fetch(new Request(ORIGIN+'/robots.txt'),env),headers=new Headers(base.headers);headers.set('Content-Type',type);return new Response(request.method==='HEAD'?null:body,{status,headers});};
 if(url.pathname==='/assets/sstrx-logo.png'&&['GET','HEAD'].includes(request.method))return secure(Uint8Array.from(atob(SST_LOGO_BASE64),c=>c.charCodeAt(0)),'image/png');
 if(url.pathname==='/assets/sstrx.css'&&['GET','HEAD'].includes(request.method))return secure(SST_RX_CSS,'text/css; charset=utf-8');
 if(url.pathname==='/assets/sstrx.js'&&['GET','HEAD'].includes(request.method))return secure(SST_RX_CLIENT,'text/javascript; charset=utf-8');
 const open=env.SSTRX_PORTAL_ENABLED==='true';
 if(url.pathname==='/'&&['GET','HEAD'].includes(request.method))return secure(signInPage(open&&env.PARTNER_ACCESS_ENABLED==='true'));
 if(!open&&url.pathname!=='/robots.txt'&&url.pathname!=='/api/logout')return secure(JSON.stringify({error:'sst_rx_release_not_activated'}),'application/json',503);
 if(url.pathname.startsWith('/workspace/')&&paths.has(url.pathname.split('/')[2])&&['GET','HEAD'].includes(request.method)){
  const identity=await native.fetch(new Request(ORIGIN+'/api/identity',{headers:request.headers}),env);
  if(!identity.ok)return new Response(null,{status:303,headers:{...Object.fromEntries(identity.headers),Location:'/'}});
  const profile=await identity.json(),kind=profile.partner.kind;
  const admin=['clinical_admin','pharmacy_admin'].includes(kind);
  if(admin){if(!['overview','patients','reports','settings'].includes(url.pathname.split('/')[2]))return secure('Your role does not include clinical or dispensing actions.','text/plain',403);return secure(workspacePage({kind,nativeHtml:'',messagesHtml:''}));}
  if(kind==='dispensing'&&url.pathname==='/workspace/clinical')return secure('Your role does not include clinical casework.','text/plain',403);
  if(kind==='clinician'&&['/workspace/dispensing','/workspace/delivery'].includes(url.pathname))return secure('Your role does not include pharmacy operations.','text/plain',403);
  const page=await native.fetch(new Request(ORIGIN+(kind==='clinician'?'/workspace/clinical':'/workspace/dispensing'),{headers:request.headers}),env);
  if(!page.ok)return page;
  return secure(workspacePage({kind,nativeHtml:await page.text(),messagesHtml:partnerHqPage(kind)}));
 }
 const response=await native.fetch(request,env);
 if(url.pathname==='/clinical-assets/client.mjs'&&response.ok){const code=await response.text();return secure(code+"\ndocument.addEventListener('sstrx-open-record',async e=>{await showPortal();await open(e.detail);});\n",'text/javascript; charset=utf-8');}
 if(url.pathname==='/clinical-assets/partners/client.mjs'&&response.ok){const code=await response.text();return secure(code+"\ndocument.addEventListener('sstrx-open-record',e=>openOrder(e.detail));\n",'text/javascript; charset=utf-8');}
 if(response.ok&&response.headers.get('Content-Type')?.includes('text/html')){const html=(await response.text()).replaceAll(BRAND,'<a class="brand" href="/" aria-label="SST Rx home"><img class="rx-logo" src="/assets/sstrx-logo.png" alt="SST Rx"></a>').replace('</head>','<link rel="stylesheet" href="/assets/sstrx.css"></head>').replace(/<title>([\s\S]*?)<\/title>/i,(_,title)=>'<title>'+title.replace(/ \| SHIFT$/,'')+' · SST Rx</title>');return secure(html);}
 return response;
}
export default {async fetch(request,env){try{return await handle(request,env)}catch{return Response.json({error:'sst_rx_source_unavailable'},{status:503,headers:{'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'}})}}};
