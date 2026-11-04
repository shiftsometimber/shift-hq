import {homePage,joinedDemoPage,partnerHqPage,unavailablePage,CSS,CLIENT,portalHeader} from './ui.mjs';
import {HOST,ORIGIN,SESSION_COOKIE,MFA_COOKIE,SETUP_COOKIE,seal,unseal,cookieValue,setCookie,upstreamSession} from './session.mjs';
import {allowedPath,validProfessional,destination} from './policy.mjs';
import {HQ_CLIENT} from './hq-client.mjs';

const API='https://api.shiftsometimber.co.uk/v1/hq';
const UPSTREAM_ORIGIN='https://hq.shiftsometimber.co.uk';
const ASSETS=new Set(['client.mjs','hq.css','portal-shell.css','portal-shell.mjs','prescription-clinician.mjs','care-form.mjs','care-contract.mjs','demo-care.mjs','demo-questionnaire.mjs','demo-adapter.mjs','demo-signature.mjs','demo-client.mjs','partners/client.mjs','partners/domain.mjs','partners/demo.mjs','partners/style.css','partners/demo-client.mjs'].map(x=>'/clinical-assets/'+x));
const SECURITY={
  'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'X-Robots-Tag':'noindex, nofollow, noarchive','X-Frame-Options':'DENY',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security':'max-age=31536000',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};
function respond(body,status=200,type='text/html; charset=utf-8',extra={}){return new Response(body,{status,headers:{...SECURITY,'Content-Type':type,...extra}});}
const json=(value,status=200,extra={})=>respond(JSON.stringify(value),status,'application/json; charset=utf-8',extra);
const closed=()=>json({error:'professional_onboarding_not_open',message:'Partner sign-in and live casework await approved onboarding and commissioning.'},503);
const clearCookies=response=>{for(const name of [SESSION_COOKIE,MFA_COOKIE,SETUP_COOKIE])response.headers.append('Set-Cookie',setCookie(name,'',0));return response;};
const enabled=env=>env.PARTNER_ACCESS_ENABLED==='true';
const authHeaders=token=>({'Cookie':'sst_hq_session='+token,'Origin':UPSTREAM_ORIGIN});
async function auth(env, token) {
  if(!token || !/^[A-Za-z0-9._~-]{16,2048}$/.test(token))return null;
  const identityResponse=await env.HQ_AUTH.fetch(new Request(API+'/me',{headers:authHeaders(token),redirect:'manual'}));
  if(!identityResponse.ok)return null;
  const identity=await identityResponse.json();
  if(identity?.user?.role!=='clinical'||identity.user.mfaEnabled!==true)return null;
  const staffResponse=await env.CLINICAL.fetch(new Request(API+'/clinical/partners/me',{headers:authHeaders(token),redirect:'manual'}));
  if(!staffResponse.ok)return null;
  const staff=await staffResponse.json();
  return validProfessional(identity,staff)?{identity,staff}:null;
}
async function session(request,env){const data=await unseal(cookieValue(request,SESSION_COOKIE),env.PORTAL_SESSION_KEY,'session');return data?.token?{...await auth(env,data.token),token:data.token}:null;}
async function bodyJson(request) {
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw Object.assign(Error('JSON request required.'),{status:415});
  if(Number(request.headers.get('Content-Length')||0)>24000)throw Object.assign(Error('Request too large.'),{status:413});
  // Bound streamed input as well as declared Content-Length.
  const reader=request.body?.getReader();let size=0,parts=[];
  if(!reader)throw Object.assign(Error('Request body required.'),{status:400});
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>24000){await reader.cancel();throw Object.assign(Error('Request too large.'),{status:413});}parts.push(value);}
  const raw=new Uint8Array(size);let at=0;for(const part of parts){raw.set(part,at);at+=part.byteLength;}
  try{const data=JSON.parse(new TextDecoder().decode(raw));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{throw Object.assign(Error('A JSON object is required.'),{status:400});}
}
async function finishLogin(upstream,env) {
  const s=upstreamSession(upstream);if(!s||s.ttl<1)return json({message:'A verified partner session was not issued.'},401);
  const current=await auth(env,s.token);if(!current)return json({message:'An active, verified partner account with MFA is required.'},403);
  const value=await seal({token:s.token},env.PORTAL_SESSION_KEY,'session',s.ttl);
  const response=json({destination:destination(current.staff)});
  response.headers.append('Set-Cookie',setCookie(SESSION_COOKIE,value,s.ttl));response.headers.append('Set-Cookie',setCookie(MFA_COOKIE,'',0));return response;
}
async function login(request,env,verify) {
  if(!enabled(env))return closed();
  const input=await bodyJson(request);let payload;
  if(verify){
    const pending=await unseal(cookieValue(request,MFA_COOKIE),env.PORTAL_SESSION_KEY,'mfa');
    if(!pending?.challenge||!/^\d{6}$/.test(input.code||''))return json({message:'Please restart sign-in and enter a valid authenticator code.'},401);
    payload={challenge:pending.challenge,code:input.code};
  }else{
    if(typeof input.username!=='string'||!/^[A-Za-z0-9_-]{1,32}$/.test(input.username)||typeof input.password!=='string'||input.password.length>128||!input.password)return json({message:'Enter your partner username and password.'},422);
    payload={username:input.username,password:input.password};
  }
  const headers={'Origin':UPSTREAM_ORIGIN,'Content-Type':'application/json'};
  // Only the edge-provided client address is forwarded for the existing rate limiter.
  const ip=request.headers.get('CF-Connecting-IP');if(ip)headers['CF-Connecting-IP']=ip;
  const response=await env.CLINICAL.fetch(new Request(API+'/clinical/partners/login'+(verify?'/verify':''),{method:'POST',headers,body:JSON.stringify(payload),redirect:'manual'}));
  if(!response.ok)return json({message:response.status===503?'Partner onboarding is not yet commissioned.':'Sign-in could not be verified. Please try again.'},[401,403,422,429,503].includes(response.status)?response.status:503);
  const result=await response.clone().json().catch(()=>({}));
  if(!verify&&result.mfaRequired===true&&typeof result.challenge==='string'){
    const value=await seal({challenge:result.challenge},env.PORTAL_SESSION_KEY,'mfa',300);
    return json({mfaRequired:true},200,{'Set-Cookie':setCookie(MFA_COOKIE,value,300)});
  }
  if(!verify){
    const s=upstreamSession(response);
    if(s){const r=await env.CLINICAL.fetch(new Request(API+'/clinical/partners/enrolment',{headers:authHeaders(s.token),redirect:'manual'}));const profile=r.ok?await r.json():null;
      if(profile?.status==='credentials_pending'&&profile.mfaEnabled===false){const value=await seal({token:s.token},env.PORTAL_SESSION_KEY,'setup',300);return json({mfaSetupRequired:true},200,{'Set-Cookie':setCookie(SETUP_COOKIE,value,300)});}
    }
    return json({message:'Authenticator verification is required for partner access.'},403);
  }
  return finishLogin(response,env);
}
async function setupMfa(request,env,enable){
  if(!enabled(env))return closed();const setup=await unseal(cookieValue(request,SETUP_COOKIE),env.PORTAL_SESSION_KEY,'setup');if(!setup?.token)return json({message:'Restart sign-in to set up your authenticator.'},401);
  const check=await env.CLINICAL.fetch(new Request(API+'/clinical/partners/enrolment',{headers:authHeaders(setup.token),redirect:'manual'}));const p=check.ok?await check.json():null;
  if(p?.status!=='credentials_pending'||p.mfaEnabled!==false)return clearCookies(json({message:'Authenticator setup requires your approved pending account.'},403));
  const b=await bodyJson(request);if(enable&&!/^\d{6}$/.test(b.code||''))return json({message:'Enter a valid six-digit code.'},422);
  const r=await env.HQ_AUTH.fetch(new Request(API+'/mfa/'+(enable?'enable':'setup'),{method:'POST',headers:{...authHeaders(setup.token),'Content-Type':'application/json'},body:JSON.stringify(enable?{code:b.code}:{}),redirect:'manual'}));
  if(!r.ok)return json({message:'Authenticator setup could not be verified. Please check the code.'},r.status===429?429:422);
  if(!enable){const data=await r.json();if(typeof data.secret!=='string'||data.secret.length>200)return json({message:'Authenticator setup is unavailable.'},503);return json({secret:data.secret});}
  try{await env.HQ_AUTH.fetch(new Request(API+'/auth/logout',{method:'POST',headers:authHeaders(setup.token),redirect:'manual'}));}catch{}
  return clearCookies(json({mfaEnabled:true,activationPending:true}));
}
export function rewrite(text) {
  return text.replaceAll(API+'/me','/api/identity').replaceAll('/v1/hq/me','/api/identity')
    .replaceAll(API+'/clinical','/api/clinical').replaceAll('/v1/hq/clinical','/api/clinical')
    .replaceAll('/clinical-portal/dispensing/demo','/demo/dispensing').replaceAll('/clinical-portal/demo','/demo/clinical')
    .replaceAll('/clinical-portal/dispensing','/workspace/dispensing').replaceAll('/clinical-portal/my-profile','/workspace/profile')
    .replaceAll(API+'/', '/api/hq-disabled/');
}
async function upstreamPage(env,path){const response=await env.CLINICAL.fetch(new Request(UPSTREAM_ORIGIN+path));if(!response.ok)throw Error('workspace_template_unavailable');return response.text();}
async function workspace(env,kind,demo,professionalKind=kind) {
  const clinician=kind==='clinician';
  let html=await upstreamPage(env,clinician?'/clinical-portal':kind==='profile'?'/clinical-portal/my-profile':['activation','application'].includes(kind)?'/clinical-portal/partners/'+kind:'/clinical-portal/dispensing'+(demo?'/demo':''));
  html=rewrite(html).replace(/<header\b[^>]*>[\s\S]*?<\/header>/i,portalHeader({demo,kind:professionalKind,signedIn:!demo&&!['activation','application'].includes(kind)}));
  if(clinician){
    html=html.replace(/<section class="view active" id="welcome">[\s\S]*?<\/section>/,'<section class="view active" id="welcome"><h1 id="title">Clinical reviews</h1><p>'+ (demo?'Fictional clinical exercises. No patient data or live actions.':'Your assigned work uses the existing clinical record and shared order history.')+'</p><button id="openClinical" type="button">Open clinical reviews</button><span id="hqUserChip"></span></section>');
    if(demo)html=html.replace('src="/clinical-assets/client.mjs"','src="/clinical-assets/demo-client.mjs"');
  }
  return html.replace('<body','<body class="partner-workspace" data-partner-workspace="true"').replace(/class="partner-workspace" data-partner-workspace="true" class="([^"]*)"/,'class="partner-workspace $1" data-partner-workspace="true"')
    .replace('</head>','<meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/assets/partner-v1.css"><script type="module" src="/assets/partner-v1.js"></script></head>')
    .replaceAll('Dispensing portal · SHIFT HQ','Dispensing | SHIFT Partners').replaceAll('Clinician portal · SHIFT','Clinical reviews | SHIFT Partners');
}
async function handle(request,env) {
  const url=new URL(request.url),path=url.pathname;
  if(url.hostname!==HOST || url.protocol!=='https:')return respond('Not found',404,'text/plain');
  if(/%2f|%5c|%2e|\\/i.test(url.pathname)||url.searchParams.has('token'))return json({message:'Invalid path.'},400);
  if(!['GET','HEAD','POST'].includes(request.method))return respond('Method not allowed',405,'text/plain',{'Allow':'GET, HEAD, POST'});
  if(request.method==='POST' && (request.headers.get('Origin')!==ORIGIN||request.headers.get('Sec-Fetch-Site')==='cross-site'))return json({message:'Same-origin request required.'},403);
  if(path==='/api/logout'&&request.method==='POST'){
    const own=await unseal(cookieValue(request,SESSION_COOKIE),env.PORTAL_SESSION_KEY,'session');let ok=true;
    if(own?.token){try{ok=(await env.HQ_AUTH.fetch(new Request(API+'/auth/logout',{method:'POST',headers:authHeaders(own.token),redirect:'manual'}))).ok;}catch{ok=false;}}
    return clearCookies(json({localSessionCleared:true,...!ok?{message:'This browser has signed out. Server sign-out could not be confirmed.'}:{}},ok?200:503));
  }
  if(path.startsWith('/api/')){
    if(path==='/api/login'&&request.method==='POST')return login(request,env,false);
    if(path==='/api/mfa'&&request.method==='POST')return login(request,env,true);
    if(path==='/api/security/mfa/setup'&&request.method==='POST')return setupMfa(request,env,false);
    if(path==='/api/security/mfa/enable'&&request.method==='POST')return setupMfa(request,env,true);
    if(/^\/api\/clinical\/partners\/application(?:\/(?:action|evidence(?:\/[a-f0-9-]{36})?))?$/.test(path)){
      if(!enabled(env))return closed();const token=request.headers.get('X-Application-Token');if(!/^[a-f0-9]{64}$/.test(token||''))return json({message:'A valid private application link is required.'},401);
      const evidence=path.endsWith('/evidence');const headers=new Headers({Origin:UPSTREAM_ORIGIN,'X-Application-Token':token});
      for(const key of ['Content-Type','X-Evidence-Kind','X-Profile-Version'])if(request.headers.has(key))headers.set(key,request.headers.get(key));
      if(evidence&&request.method==='POST'&&Number(request.headers.get('Content-Length')||0)>5*1024*1024)return json({message:'Images must be smaller than 5 MB.'},413);
      const response=await env.CLINICAL.fetch(new Request(API+path.replace('/api/clinical','/clinical'),{method:request.method,headers,body:request.method==='POST'?(evidence?request.body:JSON.stringify(await bodyJson(request))):undefined,duplex:'half',redirect:'manual'}));
      return respond(response.body,response.status,response.headers.get('Content-Type')||'application/json');
    }
    if(path==='/api/clinical/partners/activation'&&request.method==='POST'){
      if(!enabled(env))return closed();const b=await bodyJson(request);if(!/^[a-f0-9]{64}$/.test(b.token||'')||typeof b.password!=='string'||b.password.length<15||b.password.length>128)return json({message:'A valid single-use setup link and password of 15–128 characters are required.'},422);
      const response=await env.CLINICAL.fetch(new Request(API+'/clinical/partners/activation',{method:'POST',headers:{Origin:UPSTREAM_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({token:b.token,password:b.password}),redirect:'manual'}));
      const d=await response.json().catch(()=>({}));return json(response.ok?{username:d.username,next:'Sign in here to set up your authenticator. HQ approval is required before assigned work opens.'}:{error:d.error||'Account setup is unavailable.'},response.status);
    }
    if(!enabled(env))return closed();
    const own=await session(request,env);if(!own?.staff)return clearCookies(json({message:'Please sign in with your active partner account.'},401));
    if(path==='/api/identity'&&request.method==='GET')return json({user:{id:own.identity.user.id,role:'clinical',name:own.staff.details?.name||own.staff.name, mfaEnabled:true},partner:{kind:own.staff.kind,orgId:own.staff.orgId}});
    if(!allowedPath(path,request.method,own.staff.kind))return json({message:'This function is outside your partner workspace.'},403);
    // Only contract query parameters reach the authority. No actor, org or role override.
    const search=new URLSearchParams();for(const name of ['view','cursor'])if(url.searchParams.has(name))search.set(name,url.searchParams.get(name));
    const headers=new Headers(authHeaders(own.token));
    for(const name of ['Sec-Fetch-Dest'])if(request.headers.has(name))headers.set(name,request.headers.get(name));
    const upstreamPath=API+path.replace('/api/clinical','/clinical');
    let body;if(request.method==='POST'){headers.set('Content-Type','application/json');body=JSON.stringify(await bodyJson(request));}
    const response=await env.CLINICAL.fetch(new Request(upstreamPath+(search.size?'?'+search:''),{method:request.method,headers,body,redirect:'manual'}));
    if(response.status>=300&&response.status<400)return json({message:'The workspace returned an unexpected redirect.'},502);
    const outgoing={};if(response.headers.has('Content-Disposition'))outgoing['Content-Disposition']=response.headers.get('Content-Disposition');const sync=response.headers.get('X-Shift-Shared-Order-Sync');if(['pending','complete'].includes(sync))outgoing['X-Shift-Shared-Order-Sync']=sync;
    return respond(response.body,response.status,response.headers.get('Content-Type')||'application/json',outgoing);
  }
  if(!['GET','HEAD'].includes(request.method))return respond('Not found',404,'text/plain');
  if(path==='/')return respond(homePage(enabled(env)));
  if(path==='/demo')return respond(joinedDemoPage());
  if(path==='/activate')return respond(await workspace(env,'activation',false));
  if(path==='/apply')return respond(await workspace(env,'application',false));
  if(path==='/assets/partner-v1.css')return respond(CSS+WORKSPACE_CSS,200,'text/css; charset=utf-8');
  if(path==='/assets/partner-v1.js')return respond(CLIENT+HQ_CLIENT,200,'text/javascript; charset=utf-8');
  if(path==='/assets/partner-fetch.mjs')return respond("export async function partnerFetch(...args){const r=await globalThis.fetch(...args);const status=r.headers.get('X-Shift-Shared-Order-Sync');if(status)document.dispatchEvent(new CustomEvent('partner-order-sync',{detail:status}));return r;}",200,'text/javascript; charset=utf-8');
  if(path==='/robots.txt')return respond('User-agent: *\nDisallow: /\n',200,'text/plain');
  if(ASSETS.has(path)){
    const response=await env.CLINICAL.fetch(new Request(UPSTREAM_ORIGIN+path));
    if(!response.ok)return respond('Asset unavailable',503,'text/plain');
    let text=rewrite(await response.text());
    if(path==='/clinical-assets/client.mjs'||path==='/clinical-assets/partners/client.mjs')text="import {partnerFetch as fetch} from '/assets/partner-fetch.mjs';\n"+text;
    if(path==='/clinical-assets/partners/demo.mjs')text=text.replaceAll('new URL(url)','new URL(url, location.origin)');
    if(path==='/clinical-assets/partners/client.mjs'||path==='/clinical-assets/partners/demo-client.mjs')text=text.replaceAll("await openOrder(order);notice.textContent='Order update recorded.","await refresh();await openOrder(order);notice.textContent='Order update recorded.");
    // Fictional demo identifiers also work in the managed HTTP preview.
    if(path.includes('demo')&&text.includes('crypto.randomUUID()'))text="const shiftDemoId=()=>crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');\n"+text.replaceAll('crypto.randomUUID()','shiftDemoId()');
    return respond(text,200,response.headers.get('Content-Type')||'text/javascript; charset=utf-8');
  }
  if(path==='/demo/clinical'||path==='/demo/dispensing')return respond(await workspace(env,path.endsWith('clinical')?'clinician':'dispensing',true));
  if(['/workspace/clinical','/workspace/dispensing','/workspace/profile','/workspace/hq'].includes(path)){
    if(!enabled(env))return respond(unavailablePage(),503);
    const own=await session(request,env);if(!own?.staff)return respond('',303,'text/plain',{'Location':'/'});
    if(path==='/workspace/hq')return respond(partnerHqPage(own.staff.kind));
    if(path!=='/workspace/profile'&&path!==destination(own.staff))return respond(unavailablePage('Your approved role does not include this workspace.',403),403);
    return respond(await workspace(env,path==='/workspace/profile'?'profile':own.staff.kind,false,own.staff.kind));
  }
  return respond('Not found',404,'text/plain');
}
const WORKSPACE_CSS=`
body.partner-workspace .partner-header nav{display:flex}
.partner-workspace>.shell{display:block;max-width:none;padding:0}.partner-workspace>.shell>aside{display:none}.partner-workspace>.shell>main{min-width:0;padding:0}.partner-workspace .partner-header{margin:0;border-radius:0}.partner-workspace .partner-header .brand{color:#e7e3da}.partner-workspace .partner-header nav a{color:#e7e3da}.partner-workspace main>section,.partner-workspace>main{max-width:1248px;margin:auto;padding:24px}.partner-workspace .demo-banner{border-radius:0}.partner-workspace #welcome{padding:24px}.partner-workspace .workspace{min-width:0}.partner-workspace .toolbar{flex-wrap:wrap}.partner-workspace button{min-height:42px}.partner-workspace img{max-width:100%}.partner-workspace .record{white-space:normal}.partner-workspace input,.partner-workspace select,.partner-workspace textarea{max-width:100%}@media(max-width:700px){.partner-workspace .workspace{display:block}.partner-workspace .workspace>aside{border:0}.partner-workspace #detail{padding:16px 0}.partner-workspace main>section,.partner-workspace>main{padding:16px}.partner-workspace .partner-header{padding:18px}.partner-workspace .card{max-width:100%;overflow-wrap:anywhere}}
`;
export default {async fetch(request,env){try{const response=await handle(request,env);return request.method==='HEAD'?new Response(null,response):response;}catch(error){return json({message:'Partner workspace is temporarily unavailable.',...error.status?{message:error.message}:{}},error.status||503);}}};
