import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortal} from '../worker.mjs';
import gateway from '../../.partner-qa/sstrx.bundle.mjs';
import source from '../sstrx-worker.mjs';
import {seal,SETUP_COOKIE,SESSION_COOKIE,MFA_COOKIE} from '../session.mjs';
const origin='https://sstrx.shiftsometimber.co.uk',key='ab'.repeat(32);
const setupToken='fictional-pending-00000000000000000000',verifiedToken='fictional-verified-00000000000000000000';
const post=(path,body={},cookie='',requestOrigin=origin)=>new Request(origin+path,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
const cookie=(r,name)=>r.headers.getSetCookie().find(x=>x.startsWith(name+'=')&&!x.includes('Max-Age=0'))?.split(';')[0];
async function result(r,status=200){const text=await r.text();assert.equal(r.status,status,text);return JSON.parse(text);}
function environment(role='operations'){
 const state={user:{id:172,email:'reviewer@example.test',role,status:'active',mfaEnabled:false},revoked:new Set(),calls:[],challenge:null};
 const env={PARTNER_ACCESS_ENABLED:'true',SSTRX_PORTAL_ENABLED:'true',PORTAL_SESSION_KEY:key,
 HQ_AUTH:{async fetch(request){
  const path=new URL(request.url).pathname;state.calls.push(path);
  if(path.endsWith('/auth/login')){
   const b=await request.json();if(b.password!=='Fictional-password-only')return Response.json({}, {status:401});
   if(state.user.mfaEnabled){state.challenge='fictional-mfa-challenge';return Response.json({mfaRequired:true,challenge:state.challenge});}
   return Response.json({ok:true},{headers:{'Set-Cookie':'sst_hq_session='+setupToken+'; Path=/; Secure; Max-Age=3600'}});
  }
  if(path.endsWith('/auth/mfa/verify')){
   const b=await request.json();if(b.challenge!==state.challenge||b.code!=='123456')return Response.json({}, {status:401});
   state.challenge=null;return Response.json({ok:true},{headers:{'Set-Cookie':'sst_hq_session='+verifiedToken+'; Path=/; Secure; Max-Age=3600'}});
  }
  const token=request.headers.get('Cookie')?.match(/sst_hq_session=([^;]+)/)?.[1];
  if(![setupToken,verifiedToken].includes(token)||state.revoked.has(token)||state.user.status!=='active')return Response.json({}, {status:401});
  if(path.endsWith('/auth/logout')){state.revoked.add(token);return Response.json({ok:true});}
  if(path.endsWith('/me'))return Response.json({user:state.user});
  if(path.endsWith('/mfa/setup'))return Response.json({secret:'FICTIONALSETUPKEYFORLOCALTESTSONLY'});
  if(path.endsWith('/mfa/enable')){
   const b=await request.json();if(b.code!=='123456')return Response.json({}, {status:422});
   state.user.mfaEnabled=true;return Response.json({ok:true});
  }
  throw Error('Unexpected HQ request '+path);
 }},
 CLINICAL:{async fetch(request){state.calls.push('clinical:'+new URL(request.url).pathname);return Response.json({error:'denied'},{status:403});}}};
 return {env,state};
}
async function start(portal,env){const r=await portal.fetch(post('/api/login',{username:'reviewer@example.test',password:'Fictional-password-only'}),env);assert.deepEqual(await result(r),{mfaSetupRequired:true});const c=cookie(r,SETUP_COOKIE);assert(c);assert(!c.includes(setupToken));assert.match(r.headers.get('Cache-Control'),/no-store/);assert(!r.headers.getSetCookie().some(x=>x.startsWith(SESSION_COOKIE+'=')));return c;}
for(const [name,portal]of [['source',source],['compiled',gateway]]){
 test(name+': reviewer enrolment remains limited until a separate password and MFA sign-in',async()=>{
  const {env,state}=environment(),pending=await start(portal,env);
  await result(await portal.fetch(new Request(origin+'/api/identity',{headers:{Cookie:pending}}),env),401);
  await result(await portal.fetch(new Request(origin+'/api/clinical/platform',{headers:{Cookie:pending}}),env),401);
  assert.equal((await portal.fetch(new Request(origin+'/workspace/overview',{headers:{Cookie:pending}}),env)).status,303);
  assert.equal((await result(await portal.fetch(post('/api/security/mfa/setup',{},pending),env))).secret,'FICTIONALSETUPKEYFORLOCALTESTSONLY');
  await result(await portal.fetch(post('/api/security/mfa/enable',{code:'000000'},pending),env),422);
  assert.equal(state.user.mfaEnabled,false);
  const enabled=await portal.fetch(post('/api/security/mfa/enable',{code:'123456'},pending),env);
  assert.deepEqual(await result(enabled),{mfaEnabled:true,activationPending:false});
  assert(state.revoked.has(setupToken));assert.equal(state.user.role,'operations');
  assert(enabled.headers.getSetCookie().every(x=>x.includes('Max-Age=0')));
  await result(await portal.fetch(new Request(origin+'/api/identity',{headers:{Cookie:pending}}),env),401);
  const login=await portal.fetch(post('/api/login',{username:'reviewer@example.test',password:'Fictional-password-only'}),env);
  assert.deepEqual(await result(login),{mfaRequired:true});const challenge=cookie(login,MFA_COOKIE);
  await result(await portal.fetch(post('/api/mfa',{code:'000000'},challenge),env),401);
  const verified=await portal.fetch(post('/api/mfa',{code:'123456'},challenge),env);
  assert.deepEqual(await result(verified),{destination:'/workspace/overview'});
  const session=cookie(verified,SESSION_COOKIE);assert(session);
  const identity=await result(await portal.fetch(new Request(origin+'/api/identity',{headers:{Cookie:session}}),env));
  assert.equal(identity.user.role,'operations');
  for(const path of ['/api/clinical/staff','/api/clinical/partners','/api/clinical/commissioning'])assert.equal((await portal.fetch(new Request(origin+path,{headers:{Cookie:session}}),env)).status,403);
  assert(!state.calls.some(x=>x.startsWith('clinical:')));
 });
}
for(const role of ['owner','admin','support'])test('eligible '+role+' can enrol without a clinical partner profile',async()=>{const {env,state}=environment(role),portal=createPortal(origin),c=await start(portal,env);await result(await portal.fetch(post('/api/security/mfa/setup',{},c),env));assert(!state.calls.some(x=>x.startsWith('clinical:')));});
for(const role of ['viewer','content','clinical'])test('ineligible '+role+' cannot use administrator enrolment',async()=>{const {env,state}=environment(role);await result(await createPortal(origin).fetch(post('/api/login',{username:'reviewer@example.test',password:'Fictional-password-only'}),env),403);assert(state.revoked.has(setupToken));assert(!state.calls.some(x=>x.endsWith('/mfa/setup')));});
test('setup rechecks identity, current role, MFA state and expiry before changing an authenticator',async()=>{
 for(const change of ['identity','role','enabled','suspended']){
  const {env,state}=environment(),portal=createPortal(origin),c=await start(portal,env);
  if(change==='identity')state.user.id=999;if(change==='role')state.user.role='viewer';if(change==='enabled')state.user.mfaEnabled=true;if(change==='suspended')state.user.status='suspended';
  await result(await portal.fetch(post('/api/security/mfa/setup',{},c),env),403);assert(!state.calls.some(x=>x.endsWith('/mfa/setup')));
 }
 const {env,state}=environment(),portal=createPortal(origin);
 for(const [aud,at,host]of [['setup',Date.now()-301000,origin],['session',Date.now(),origin],['setup',Date.now(),'https://partner.shiftsometimber.co.uk']]){
  const value=await seal({token:setupToken,authority:'hq',hqUserId:172},key,aud,300,at,host);
  await result(await portal.fetch(post('/api/security/mfa/setup',{},SETUP_COOKIE+'='+value),env),401);
 }
 await result(await portal.fetch(post('/api/security/mfa/setup',{},SETUP_COOKIE+'=forged'),env),401);assert.equal(state.calls.length,0);
});
test('cross-origin setup is rejected and cancellation revokes only the enrolment session',async()=>{
 const {env,state}=environment(),portal=createPortal(origin),c=await start(portal,env);
 await result(await portal.fetch(post('/api/security/mfa/setup',{},c,'https://evil.example'),env),403);
 await result(await portal.fetch(post('/api/logout',{},c),env));assert.deepEqual([...state.revoked],[setupToken]);
 await result(await portal.fetch(post('/api/security/mfa/setup',{},c),env),403);
});
test('administrator setup is unavailable at the legacy professional-only origin',async()=>{
 const {env,state}=environment(),value=await seal({token:setupToken,authority:'hq',hqUserId:172},key,'setup',300,Date.now(),'https://partner.shiftsometimber.co.uk');
 const r=await createPortal().fetch(new Request('https://partner.shiftsometimber.co.uk/api/security/mfa/setup',{method:'POST',headers:{Origin:'https://partner.shiftsometimber.co.uk','Content-Type':'application/json',Cookie:SETUP_COOKIE+'='+value},body:'{}'}),env);
 await result(r,403);assert(!state.calls.some(x=>x.endsWith('/mfa/setup')));
});
