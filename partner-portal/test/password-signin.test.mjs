import {test,after,mock} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import portal from '../sstrx-worker.mjs';
import gateway from '../../.partner-qa/sstrx.bundle.mjs';
import compiledClinical from '../../.partner-qa/clinical.bundle.mjs';
import {passwordSignInAllowed,PASSWORD_SIGNIN_LAST_DAY} from '../password-signin.mjs';
import {SESSION_COOKIE} from '../session.mjs';
const now=Date.parse('2026-11-05T20:00:00.000Z');
mock.method(Date,'now',()=>now);after(()=>mock.restoreAll());
const origin='https://sstrx.shiftsometimber.co.uk';
const accounts=[
 {id:152,email:'shiftsometimber@gmail.com',role:'owner'},
 {id:171,email:'matt@shiftsometimber.co.uk',role:'owner'},
 {id:172,email:'sstrx@shiftsometimber.co.uk',role:'operations'}
];
const flags={SSTRX_PASSWORD_SIGNIN_ENABLED:'true',SSTRX_PASSWORD_SIGNIN_UNTIL:PASSWORD_SIGNIN_LAST_DAY};
const post=(path,b,cookie='')=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(b)});
const get=(path,cookie='')=>new Request(origin+path,{headers:{Cookie:cookie}});
async function json(r,status=200){const text=await r.text();assert.equal(r.status,status,text);return JSON.parse(text);}
const digest=async x=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x))).toString('hex');
async function scopedFixture(){
 const f=await fixture();Object.assign(f.env,flags,{SSTRX_PLATFORM_ENABLED:'true'});Object.assign(f.portalEnv,flags,{SSTRX_PORTAL_ENABLED:'true'});
 for(const a of accounts){
  f.tokens[a.id]='fictional-owner-review-'+a.id+'-0000000000000000';
  f.sql.prepare("INSERT INTO hq_users(id,email,name,password_hash,role,status,mfa_enabled) VALUES(?,?,?,?,?,'active',0)").run(a.id,a.email,'Fictional access test','!fixture-no-password',a.role);
  f.sql.prepare('INSERT INTO hq_sessions(hq_user_id,token_hash,expires_at) VALUES(?,?,?)').run(a.id,await digest(f.tokens[a.id]),new Date(Date.now()+30*86400000).toISOString());
 }
 const native=f.env.HQ_AUTH.fetch;
 f.env.HQ_AUTH.fetch=async request=>{
  const path=new URL(request.url).pathname;
  if(path.endsWith('/auth/login')){
   const b=await request.clone().json(),a=accounts.find(a=>a.email===b.email);
   if(a){
    if(b.password!=='Synthetic-only-password-987')return Response.json({error:'bad_password'},{status:401});
    const u=f.sql.prepare('SELECT * FROM hq_users WHERE id=?').get(a.id);
    if(u.mfa_enabled===0)return Response.json({ok:true},{headers:{'Set-Cookie':'sst_hq_session='+f.tokens[a.id]+'; Path=/; Secure; Max-Age=3600'}});
   }
  }
  const r=await native(request);
  if(path.endsWith('/me')&&r.ok){
   const d=await r.json(),u=f.sql.prepare('SELECT email,status FROM hq_users WHERE id=?').get(d.user.id);
   return Response.json({user:{...d.user,email:u.email,status:u.status}});
  }
  return r;
 };
 f.portalEnv.CLINICAL={fetch:r=>compiledClinical.fetch(r,f.env,{waitUntil(){}})};
 return f;
}
async function signIn(app,f,a){
 const r=await app.fetch(post('/api/login',{username:a.email,password:'Synthetic-only-password-987'}),f.portalEnv);
 assert.deepEqual(await json(r),{destination:'/workspace/overview'});
 const cookie=r.headers.getSetCookie().find(c=>c.startsWith(SESSION_COOKIE+'=')&&!c.includes('Max-Age=0'))?.split(';')[0];assert(cookie);
 assert(r.headers.getSetCookie().some(c=>c.includes('Secure; HttpOnly; SameSite=Strict')));
 return cookie;
}
test('temporary password sign-in requires the exact account, role, active state, explicit flag and bounded expiry',()=>{
 for(const a of accounts){
  const u={...a,status:'active',mfaEnabled:false};assert(passwordSignInAllowed(flags,u,now));
  for(const bad of [{id:999},{email:'other@example.test'},{role:'clinical'},{status:'suspended'},{mfaEnabled:true}])assert(!passwordSignInAllowed(flags,{...u,...bad},now));
  for(const env of [{},{...flags,SSTRX_PASSWORD_SIGNIN_ENABLED:'false'},{...flags,SSTRX_PASSWORD_SIGNIN_UNTIL:'bad'},{...flags,SSTRX_PASSWORD_SIGNIN_UNTIL:'2026-12-01T00:00:00Z'}])assert(!passwordSignInAllowed(env,u,now));
  assert(!passwordSignInAllowed(flags,u,Date.parse(PASSWORD_SIGNIN_LAST_DAY)));
 }
});
for(const [name,app]of [['source',portal],['compiled',gateway]])for(const account of accounts)test(name+': '+account.role+' '+account.id+' enters the real dashboard contract using password only',async()=>{
 const f=await scopedFixture();try{
  const cookie=await signIn(app,f,account);
  const me=await json(await app.fetch(get('/api/identity',cookie),f.portalEnv));assert.equal(me.user.id,account.id);assert.equal(me.user.mfaEnabled,false);assert.equal(me.user.role,account.role);
  const page=await app.fetch(get('/workspace/overview',cookie),f.portalEnv);assert.equal(page.status,200);assert.match(await page.text(),/Operational oversight/);
  const overview=await json(await app.fetch(get('/api/clinical/platform',cookie),f.portalEnv));assert.equal(overview.role,account.role);assert.equal(overview.records.length,1);assert.equal(overview.commercialAvailable,account.role==='owner');assert.match(overview.source,/existing_clinical/);
  for(const path of ['/api/clinical/staff','/api/clinical/commissioning','/api/hq/users','/api/hq/deploy'])assert.equal((await app.fetch(get(path,cookie),f.portalEnv)).status,403,path);
  assert.equal((await app.fetch(post('/api/clinical/10000000-0000-4000-8000-000000000001/action',{action:'approve'},cookie),f.portalEnv)).status,403);
  await json(await app.fetch(post('/api/logout',{},cookie),f.portalEnv));
  await json(await app.fetch(get('/api/identity',cookie),f.portalEnv),401);
 }finally{f.close();}
});
test('password still verified; existing enrolled accounts still require their native MFA challenge',async()=>{
 const f=await scopedFixture();try{
  await json(await gateway.fetch(post('/api/login',{username:accounts[0].email,password:'wrong'}),f.portalEnv),401);
  f.sql.prepare('UPDATE hq_users SET mfa_enabled=1 WHERE id=152').run();
  const d=await json(await gateway.fetch(post('/api/login',{username:accounts[0].email,password:'Synthetic-only-password-987'}),f.portalEnv));assert.equal(d.mfaRequired,true);assert(!d.destination);
 }finally{f.close();}
});
test('flag removal, expiry, role change and account suspension terminate already-issued password-only access',async()=>{
 for(const change of ['flag','expiry','role','status']){
  const f=await scopedFixture();try{
   const c=await signIn(gateway,f,accounts[2]);
   if(change==='flag')f.portalEnv.SSTRX_PASSWORD_SIGNIN_ENABLED='false';
   if(change==='expiry')f.portalEnv.SSTRX_PASSWORD_SIGNIN_UNTIL='2026-11-04T00:00:00Z';
   if(change==='role')f.sql.prepare("UPDATE hq_users SET role='owner' WHERE id=172").run();
   if(change==='status')f.sql.prepare("UPDATE hq_users SET status='suspended' WHERE id=172").run();
   await json(await gateway.fetch(get('/api/identity',c),f.portalEnv),401);
   assert.equal((await gateway.fetch(get('/workspace/overview',c),f.portalEnv)).status,303);
  }finally{f.close();}
 }
});
test('dashboard authority independently requires scope and keeps clinical/pharmacy MFA enforced',async()=>{
 const f=await scopedFixture();try{
  const direct=id=>new Request('https://api.shiftsometimber.co.uk/v1/hq/clinical/platform',{headers:{Origin:'https://hq.shiftsometimber.co.uk',Cookie:'sst_hq_session='+f.tokens[id]}});
  await json(await compiledClinical.fetch(direct(152),f.env,{}));
  f.env.SSTRX_PASSWORD_SIGNIN_ENABLED='false';
  await json(await compiledClinical.fetch(direct(152),f.env,{}),403);
  f.env.SSTRX_PASSWORD_SIGNIN_ENABLED='true';
  for(const id of [3,4]){f.sql.prepare('UPDATE hq_users SET mfa_enabled=0 WHERE id=?').run(id);await json(await compiledClinical.fetch(direct(id),f.env,{}),403);}
 }finally{f.close();}
});
test('legacy professional portal and other owner identities do not receive password-only admission',async()=>{
 const f=await scopedFixture();try{
  const {createPortal}=await import('../worker.mjs');
  const r=await createPortal().fetch(new Request('https://partner.shiftsometimber.co.uk/api/login',{method:'POST',headers:{Origin:'https://partner.shiftsometimber.co.uk','Content-Type':'application/json'},body:JSON.stringify({username:accounts[0].email,password:'Synthetic-only-password-987'})}),f.portalEnv);assert.equal(r.status,422);
  const u={id:1,email:'fixture-1@example.test',role:'owner',status:'active',mfaEnabled:false};assert(!passwordSignInAllowed(flags,u,now));
 }finally{f.close();}
});
