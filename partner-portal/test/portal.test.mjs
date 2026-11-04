import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';
import {seal,unseal,upstreamSession,SESSION_COOKIE,MFA_COOKIE,ORIGIN} from '../session.mjs';
import {allowedPath,validProfessional} from '../policy.mjs';

const secret='ab'.repeat(32),token='server-only-test-token-0000000000000000';
const id='00000000-0000-4000-8000-000000000001';
const identity={user:{id:42,role:'clinical',mfaEnabled:true}};
const staff={id:'staff-42',hqUserId:42,status:'active',kind:'clinician',orgId:'org-1',details:{name:'Test Professional'}};
function environment(options={}){
  const calls=[];
  const env={PORTAL_SESSION_KEY:secret,PARTNER_ACCESS_ENABLED:'true',
    HQ_AUTH:{async fetch(request){calls.push(request);const path=new URL(request.url).pathname;if(path.endsWith('/logout'))return new Response('',{status:options.logoutStatus||200});return Response.json(options.identity||identity);}},
    CLINICAL:{async fetch(request){calls.push(request);const path=new URL(request.url).pathname;
      if(path.endsWith('/partners/me'))return Response.json(options.staff||staff,{status:options.staffStatus||200});
      if(path.endsWith('/login/verify'))return Response.json({ok:true},{headers:{'Set-Cookie':'sst_hq_session='+token+'; Domain=.shiftsometimber.co.uk; Path=/; Secure; Max-Age=7200'}});
      if(path.endsWith('/login'))return Response.json(options.loginResult||{mfaRequired:true,challenge:'private-upstream-challenge'});
      return Response.json({orders:[],guard:'original-authority'},{status:options.dataStatus||200,headers:{'Set-Cookie':'sst_hq_session=should-not-leak','Access-Control-Allow-Origin':'*'}});
    }}};return {env,calls};
}
const req=(path,init={})=>new Request(ORIGIN+path,init);
const post=(path,body={},headers={})=>req(path,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
async function signed(path,init={}){const value=await seal({token},secret,'session');return req(path,{...init,headers:{Cookie:SESSION_COOKIE+'='+value,...init.headers}});}

test('encrypted session is opaque, audience bound, expiring and tamper resistant',async()=>{
  const now=1700000000000,value=await seal({token},secret,'session',60,now);
  assert(!value.includes(token));assert.equal((await unseal(value,secret,'session',now+1000)).token,token);
  assert.equal(await unseal(value,secret,'mfa',now),null);
  assert.equal(await unseal(value,secret,'session',now+60001),null);
  assert.equal(await unseal(value+'x',secret,'session',now),null);
  assert.equal(await unseal(value,'cd'.repeat(32),'session',now),null);
});
test('default closed: login and casework never reach an authority',async()=>{
  const {env,calls}=environment();env.PARTNER_ACCESS_ENABLED='false';
  for(const request of [post('/api/login',{username:'TEST',password:'test'}),req('/api/clinical'),req('/workspace/clinical')])assert.equal((await worker.fetch(request,env)).status,503);
  assert.equal(calls.length,0);
});
test('HQ cookies, bearer tokens and application tokens cannot authenticate a partner',async()=>{
  const {env,calls}=environment();const response=await worker.fetch(req('/api/clinical',{headers:{Cookie:'sst_hq_session='+token,Authorization:'Bearer '+token,'X-Application-Token':'a'.repeat(64)}}),env);
  assert.equal(response.status,401);assert.equal(calls.length,0);
});
test('cross-origin and missing-origin POSTs are refused before authentication',async()=>{
  const {env,calls}=environment();
  for(const origin of ['', 'https://hq.shiftsometimber.co.uk','https://evil.example'])assert.equal((await worker.fetch(post('/api/login',{}, {Origin:origin}),env)).status,403);
  assert.equal(calls.length,0);
});
test('role policy excludes administration, directory, finance, staff assignment and signing',()=>{
  for(const path of ['/api/clinical/staff','/api/clinical/partners','/api/clinical/partners/organisations','/api/clinical/commissioning','/api/clinical/notifications','/api/clinical/prescription-finance','/api/clinical/'+id+'/assignment','/api/clinical/prescriptions/'+id+'/sign'])for(const method of ['GET','POST'])assert.equal(allowedPath(path,method,'clinician'),false,path);
  assert(allowedPath('/api/clinical/'+id+'/action','POST','clinician'));
  assert(!allowedPath('/api/clinical/'+id,'GET','dispensing'));
  assert(allowedPath('/api/clinical/partners/fulfilment/ORDER-1/action','POST','dispensing'));
  assert(!allowedPath('/api/clinical/partners/fulfilment','GET','clinician'));
});
test('active professional binding requires MFA, matching user, organisation and approved role',()=>{
  assert(validProfessional(identity,staff));
  for(const changed of [{status:'suspended'},{orgId:''},{hqUserId:99},{kind:'owner'}])assert(!validProfessional(identity,{...staff,...changed}));
  assert(!validProfessional({user:{...identity.user,role:'owner'}},staff));
  assert(!validProfessional({user:{...identity.user,mfaEnabled:false}},staff));
});
test('each request rechecks current identity and professional access; revocation closes access',async()=>{
  const {env,calls}=environment({staff:{...staff,status:'suspended'}});
  const response=await worker.fetch(await signed('/api/clinical'),env);assert.equal(response.status,401);
  assert.equal(calls.length,2);assert(!calls.some(x=>new URL(x.url).pathname==='/v1/hq/clinical'));
});
test('organisation expiry or professional check failure from original authority is respected',async()=>{
  const {env,calls}=environment({staffStatus:403});assert.equal((await worker.fetch(await signed('/api/clinical'),env)).status,401);assert.equal(calls.length,2);
});
test('shared clinical service receives original case ID, only owned session and bounded query',async()=>{
  const {env,calls}=environment();const response=await worker.fetch(await signed('/api/clinical/'+id+'?orgId=other&role=owner&cursor=next',{headers:{Authorization:'Bearer attacker','X-Application-Token':'attacker'}}),env);
  assert.equal(response.status,200);const actual=calls.at(-1);assert.equal(actual.url,'https://api.shiftsometimber.co.uk/v1/hq/clinical/'+id+'?cursor=next');
  assert.equal(actual.headers.get('Cookie'),'sst_hq_session='+token);assert.equal(actual.headers.get('Authorization'),null);assert.equal(actual.headers.get('X-Application-Token'),null);
  assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);assert.match(response.headers.get('Cache-Control'),/no-store/);
});
test('upstream cross-organisation/assignment denials are propagated without fallback',async()=>{
  const {env}=environment({dataStatus:403});assert.equal((await worker.fetch(await signed('/api/clinical/'+id),env)).status,403);
});
test('pharmacy updates reach existing fulfilment record with unchanged version; never another backend',async()=>{
  const {env,calls}=environment({staff:{...staff,kind:'dispensing'}});
  const request=await signed('/api/clinical/partners/fulfilment/ORDER-1/action',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({version:4,action:'prepare'})});
  const response=await worker.fetch(request,env);assert.equal(response.status,200);assert.equal(await calls.at(-1).text(),'{"version":4,"action":"prepare"}');assert.match(calls.at(-1).url,/\/v1\/hq\/clinical\/partners\/fulfilment\/ORDER-1\/action$/);
});
test('MFA challenge and underlying HQ session never reach browser JSON or cookies',async()=>{
  const {env}=environment();const begin=await worker.fetch(post('/api/login',{username:'TEST',password:'test-password'}),env);
  const beginBody=await begin.text();assert.equal(begin.status,200);assert(!beginBody.includes('private-upstream-challenge'));assert.equal(JSON.parse(beginBody).mfaRequired,true);
  const pending=begin.headers.get('Set-Cookie').split(';')[0];assert(pending.startsWith(MFA_COOKIE+'='));
  const verified=await worker.fetch(post('/api/mfa',{code:'123456'},{Cookie:pending}),env);assert.equal(verified.status,200);
  assert.deepEqual(await verified.json(),{destination:'/workspace/clinical'});
  const cookies=verified.headers.get('Set-Cookie');assert(!cookies.includes(token));assert(!cookies.includes('Domain='));assert.match(cookies,/Secure; HttpOnly; SameSite=Strict; Max-Age=3600/);
});
test('login cannot bypass authenticator verification with a direct session response',async()=>{
  const {env}=environment({loginResult:{ok:true}});assert.equal((await worker.fetch(post('/api/login',{username:'TEST',password:'test'}),env)).status,403);
});
test('logout clears host-only cookies and reports failure to revoke server session',async()=>{
  const {env,calls}=environment({logoutStatus:503});const response=await worker.fetch(await signed('/api/logout',{method:'POST',headers:{Origin:ORIGIN}}),env);
  assert.equal(response.status,503);assert.equal((await response.json()).localSessionCleared,true);assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);assert.equal(calls.length,1);assert.match(calls[0].url,/\/auth\/logout$/);
});
test('wrong hostname and internal pages/assets never serve an HQ interface',async()=>{
  const {env}=environment();assert.equal((await worker.fetch(new Request('https://hq.shiftsometimber.co.uk/'),env)).status,404);
  for(const path of ['/clinical-portal/partners','/clinical-assets/partners/commissioning-client.mjs','/clinical-assets/partners/notifications-client.mjs','/clinical-assets/partners/finance-client.mjs','/v1/hq/me'])assert.equal((await worker.fetch(req(path),env)).status,404,path);
});
test('landing and joined demonstration are noindex, frame blocked, clearly fictional and safe by default',async()=>{
  const {env}=environment();env.PARTNER_ACCESS_ENABLED='false';
  const home=await worker.fetch(req('/'),env);assert.match(await home.text(),/Partner setup is in progress/);
  const demo=await worker.fetch(req('/demo'),env);assert.match(await demo.text(),/SHIFT-DEMO-1042/);assert.match(demo.headers.get('X-Robots-Tag'),/noindex/);assert.equal(demo.headers.get('X-Frame-Options'),'DENY');assert.match(demo.headers.get('Content-Security-Policy'),/connect-src 'self'/);
});
test('oversized JSON rejected, including streamed input without declared size',async()=>{
  const {env}=environment();const response=await worker.fetch(post('/api/login',{username:'TEST',password:'a'.repeat(25000)}),env);assert.equal(response.status,413);
});
test('session extraction recognises upstream token while capping lifetime',()=>{
  assert.deepEqual(upstreamSession(new Response('',{headers:{'Set-Cookie':'sst_hq_session='+token+'; Max-Age=86400; Domain=.shiftsometimber.co.uk'}})),{token,ttl:3600});
});
