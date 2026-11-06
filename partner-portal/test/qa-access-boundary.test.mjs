import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createQaAccessBoundary} from '../qa/access-boundary.mjs';
import {QA_ACCESS,QA_RX_ORIGIN,QA_MEMBER_LOGIN} from '../qa/access-config.mjs';
import portal,{createSstrxPortal} from '../sstrx-worker.mjs';
import gateway from '../gateway-entry.mjs';
import privateBundle from '../../.partner-qa/rx-private.bundle.mjs';
import {createPortal} from '../worker.mjs';
import {seal,SESSION_COOKIE} from '../session.mjs';
import {signingOrigin} from '../platform/signing.mjs';

const instant=Date.parse('2026-11-06T12:00:00Z'), seconds=instant/1000;
const makeKey=()=>crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const first=await makeKey(), second=await makeKey();
const jwk=async(key,kid)=>({...await crypto.subtle.exportKey('jwk',key.publicKey),kid,alg:'RS256',use:'sig'});
const key1=await jwk(first,'fictional-key-one'),key2=await jwk(second,'fictional-key-two');
const base={iss:QA_ACCESS.issuer,aud:[QA_ACCESS.audience],type:'app',email:QA_ACCESS.emails[0],iat:seconds,exp:seconds+1800};
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
async function token(claims={},header={},key=first){const input=encode({alg:'RS256',typ:'JWT',kid:key1.kid,...header})+'.'+encode({...base,...claims});return input+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key.privateKey,new TextEncoder().encode(input))).toString('base64url');}
function boundary(handler={fetch:()=>new Response('native')},options={}){
 let calls=0;
 const app=createQaAccessBoundary(handler,{now:()=>instant,fetchKeys:async(url,init)=>{calls++;assert.equal(url,QA_ACCESS.issuer+'/cdn-cgi/access/certs');assert.equal(init.redirect,'error');return Response.json({keys:[key1]});},...options});
 return {app,calls:()=>calls};
}
const env={SSTRX_ENVIRONMENT:'synthetic'};
const request=(assertion,url=QA_RX_ORIGIN+'/api/identity',init={})=>new Request(url,{...init,headers:{...assertion?{'Cf-Access-Jwt-Assertion':assertion}:{},...init.headers}});

test('QA: missing assertion and spoofed identity headers never reach native services',async()=>{
 let native=0;const b=boundary({fetch(){native++;return new Response();}});
 const r=await b.app.fetch(request(null,undefined,{headers:{'Cf-Access-Authenticated-User-Email':QA_ACCESS.emails[0],Authorization:'Bearer pretend',Cookie:'CF_Authorization=pretend'}}),env);
 assert.equal(r.status,403);assert.equal(native,0);assert.equal(b.calls(),0);assert.match(r.headers.get('Cache-Control'),/no-store/);
});
test('QA: production, preview, HTTP, suffix and alternate-port hosts are denied before keys or backend',async()=>{
 const b=boundary(),t=await token();
 for(const u of ['https://sstrx.shiftsometimber.co.uk/','https://some-worker.workers.dev/','http://rx-qa.sstrx.co.uk/','https://rx-qa.sstrx.co.uk.evil.invalid/','https://rx-qa.sstrx.co.uk:444/'])assert.equal((await b.app.fetch(request(t,u),env)).status,403,u);
 assert.equal(b.calls(),0);assert.equal((await b.app.fetch(request(t),{})).status,503);
});
test('QA: malformed assertions, algorithms and token-provided key URLs are rejected without fetching them',async()=>{
 const b=boundary();
 for(const t of ['not.jwt','a.b.c','a'.repeat(16001),await token({}, {alg:'none'}),await token({}, {jku:'https://evil.invalid/keys'}),await token({}, {x5u:'https://evil.invalid/cert'}),await token({}, {crit:['unknown']})])assert.equal((await b.app.fetch(request(t),env)).status,403);
 assert.equal(b.calls(),0);
});
test('QA: exact issuer, application audience, app type and bounded valid session are mandatory',async()=>{
 const b=boundary();
 for(const change of [{iss:'https://other.cloudflareaccess.com'},{aud:['another-app']},{type:'org'},{exp:seconds},{exp:seconds+1801},{iat:seconds+31},{nbf:seconds+1},{exp:'future'},{iat:null}])assert.equal((await b.app.fetch(request(await token(change)),env)).status,403,JSON.stringify(change));
 assert.equal(b.calls(),0);
});
test('QA: a different signed identity or service token does not inherit the reviewer policy',async()=>{
 const b=boundary();for(const email of ['other@example.invalid','',null])assert.equal((await b.app.fetch(request(await token({email})),env)).status,403);assert.equal(b.calls(),0);
});
test('QA: cryptographically forged and changed signatures cannot reach the backend',async()=>{
 let native=0;const b=boundary({fetch(){native++;return new Response();}}),good=await token();
 const parts=good.split('.');parts[1]=encode({...base,email:QA_ACCESS.emails[1]});
 for(const t of [parts.join('.'),await token({}, {},second),good.slice(0,-20)])assert.equal((await b.app.fetch(request(t),env)).status,403);
 assert.equal(native,0);assert.equal(b.calls(),1);
});
test('QA: the three signed reviewer identities preserve native cookies and POST bodies without identity grants',async()=>{
 const seen=[];const b=boundary({async fetch(r){seen.push({headers:r.headers,body:await r.text()});return new Response('native');}});
 for(const email of QA_ACCESS.emails){const r=await b.app.fetch(request(await token({email}),QA_RX_ORIGIN+'/api/login',{method:'POST',headers:{Cookie:'CF_Authorization=outer; __Host-shift_partner=inner','Content-Type':'application/json','Cf-Access-Authenticated-User-Email':'spoofed','X-QA-Access-Email':'spoofed'},body:'{"username":"fictional"}'}),env);assert.equal(r.status,200);}
 for(const v of seen){assert.equal(v.headers.get('Cookie'),'__Host-shift_partner=inner');for(const h of ['Cf-Access-Jwt-Assertion','Cf-Access-Authenticated-User-Email','X-QA-Access-Email'])assert.equal(v.headers.get(h),null);assert.equal(v.body,'{"username":"fictional"}');}
 assert.equal(b.calls(),1);
});
test('QA: concurrent valid requests share one bounded public-key retrieval',async()=>{
 const b=boundary(),t=await token();const results=await Promise.all(Array.from({length:10},()=>b.app.fetch(request(t),env)));assert(results.every(r=>r.status===200));assert.equal(b.calls(),1);
});
test('QA: key outage, malformed key feed and weak keys fail closed before native work',async()=>{
 let native=0;
 for(const fetchKeys of [async()=>{throw Error('offline');},async()=>new Response('bad json'),async()=>Response.json({keys:[]}),async()=>Response.json({keys:[{...key1,n:'AQAB'}]})]){
  const b=boundary({fetch(){native++;return new Response();}},{fetchKeys});assert.equal((await b.app.fetch(request(await token()),env)).status,503);
 }assert.equal(native,0);
});
test('QA: expired key cache is not used during outage; unknown-key refresh is rate limited and supports rotation',async()=>{
 let time=instant,calls=0,offline=false;
 const b=boundary(undefined,{now:()=>time,fetchKeys:async()=>{calls++;if(offline)throw Error('offline');return Response.json({keys:time===instant?[key1]:[key1,key2]});}});
 const t=await token(),rotated=await token({}, {kid:key2.kid},second);
 assert.equal((await b.app.fetch(request(t),env)).status,200);
 assert.equal((await b.app.fetch(request(rotated),env)).status,403);assert.equal(calls,1);
 time+=31000;assert.equal((await b.app.fetch(request(rotated),env)).status,200);assert.equal(calls,2);
 time+=300001;offline=true;assert.equal((await b.app.fetch(request(t),env)).status,503);assert.equal(calls,3);
 assert.equal((await b.app.fetch(request(t),env)).status,503);assert.equal(calls,3);
});
test('QA: valid outer Access does not establish an underlying native session',async()=>{
 const app=createSstrxPortal(QA_RX_ORIGIN),b=boundary(app);
 const r=await b.app.fetch(request(await token()),{...env,PARTNER_ACCESS_ENABLED:'true',SSTRX_PORTAL_ENABLED:'true',PORTAL_SESSION_KEY:'ab'.repeat(32)});
 assert.equal(r.status,401);
});
test('QA: browser session audiences cannot cross between the QA and production RX gateways',async()=>{
 const key='ab'.repeat(32),nativeToken='fictional-native-session-000000000000000000';
 const c=await seal({token:nativeToken},key,'session',300,Date.now(),QA_RX_ORIGIN);
 const r=await portal.fetch(new Request('https://sstrx.shiftsometimber.co.uk/api/identity',{headers:{Cookie:SESSION_COOKIE+'='+c}}),{SSTRX_PORTAL_ENABLED:'true',PARTNER_ACCESS_ENABLED:'true',PORTAL_SESSION_KEY:key});assert.equal(r.status,401);
});
test('QA: native professional MFA and role checks remain authoritative behind the verified outer gate',async()=>{
 const key='ab'.repeat(32),cookie=SESSION_COOKIE+'='+await seal({token:'fictional-native-session-000000000000000000'},key,'session',300,Date.now(),QA_RX_ORIGIN),t=await token();
 for(const enabled of [true,false]){
  const b=boundary(createSstrxPortal(QA_RX_ORIGIN));
  const e={...env,PARTNER_ACCESS_ENABLED:'true',SSTRX_PORTAL_ENABLED:'true',PORTAL_SESSION_KEY:key,HQ_AUTH:{fetch:()=>Response.json({user:{id:42,role:'clinical',mfaEnabled:enabled}})},CLINICAL:{fetch:()=>Response.json({hqUserId:42,status:'active',kind:'clinician',orgId:'fictional-clinic'})}};
  const r=await b.app.fetch(request(t,undefined,{headers:{Cookie:cookie}}),e);assert.equal(r.status,enabled?200:401);if(enabled)assert.equal((await r.json()).partner.kind,'clinician');
 }
});
test('QA: CSRF and origin checks survive the private gate without forwarding cross-origin writes',async()=>{
 let upstream=0;const b=boundary(createSstrxPortal(QA_RX_ORIGIN));
 const r=await b.app.fetch(request(await token(),QA_RX_ORIGIN+'/api/login',{method:'POST',headers:{Origin:'https://hq-qa.sstrx.co.uk','Content-Type':'application/json'},body:'{}'}),{...env,PARTNER_ACCESS_ENABLED:'true',SSTRX_PORTAL_ENABLED:'true',HQ_AUTH:{fetch(){upstream++;return new Response();}}});assert.equal(r.status,403);assert.equal(upstream,0);
});
test('QA: member entrance uses the shared QA member identity and never redirects to a production login',async()=>{
 const app=createSstrxPortal(QA_RX_ORIGIN),e={...env,MY_SHIFT_REDESIGN_ENABLED:'true'};
 const r=await app.fetch(new Request(QA_RX_ORIGIN+'/member-sign-in'),e);assert.equal(r.status,303);assert.equal(r.headers.get('Location'),QA_MEMBER_LOGIN);
 assert.equal((await app.fetch(new Request(QA_RX_ORIGIN+'/'),{})).status,503);
 assert.equal((await gateway.fetch(new Request(QA_RX_ORIGIN+'/'),env)).status,404);
 assert.throws(()=>createPortal('https://other.example.invalid'),/unsupported_portal_origin/);
});
test('QA: signing origin remains disallowed in production and is admitted only in the synthetic target',()=>{
 const r=new Request('https://api-qa.sstrx.co.uk/',{headers:{'X-Shift-Portal-Origin':QA_RX_ORIGIN}});
 assert.throws(()=>signingOrigin(r),/signing_origin_not_allowed/);assert.throws(()=>signingOrigin(r,{SSTRX_ENVIRONMENT:'production'}),/signing_origin_not_allowed/);assert.equal(signingOrigin(r,env),QA_RX_ORIGIN);
});
test('QA: the compiled private entry verifies a signed assertion while retaining native sign-in and host restrictions',async()=>{
 const original=globalThis.fetch;let publicReads=0;
 globalThis.fetch=async url=>{assert.equal(url,QA_ACCESS.issuer+'/cdn-cgi/access/certs');publicReads++;return Response.json({keys:[key1]});};
 try{
  assert.equal((await privateBundle.fetch(request(null),env)).status,403);
  // This token is signed only by the in-memory fictional test key, never Cloudflare.
  const realNow=Math.floor(Date.now()/1000),t=await token({iat:realNow,exp:realNow+1800});
  const e={...env,SSTRX_PORTAL_ENABLED:'true',PARTNER_ACCESS_ENABLED:'true',MY_SHIFT_REDESIGN_ENABLED:'true',PORTAL_SESSION_KEY:'ab'.repeat(32)};
  const page=await privateBundle.fetch(request(t,QA_RX_ORIGIN+'/'),e);assert.equal(page.status,200);assert.match(await page.text(),/existing My Timber account/);
  assert.equal((await privateBundle.fetch(request(t),e)).status,401);
  assert.equal((await privateBundle.fetch(request(t,'https://preview.workers.dev/'),e)).status,403);
  assert.equal(publicReads,1);
 }finally{globalThis.fetch=original;}
});
