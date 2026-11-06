import test from 'node:test';
import assert from 'node:assert/strict';
import {myShiftFixture} from '../qa/my-shift-fixture.mjs';
import {PASSWORD_SIGNIN_LAST_DAY} from '../password-signin.mjs';
const sha=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
test('member logout expires both native parent-domain and legacy host-only cookies while retaining the second session',async()=>{
 const f=await myShiftFixture();try{
  const r=await f.call('/v1/member/my-shift/sign-out',{});assert.equal(r.status,200);
  const cookies=r.headers.getSetCookie();assert.equal(cookies.length,2);assert(cookies.some(s=>s.includes('Domain=.shiftsometimber.co.uk')));assert(cookies.some(s=>!s.includes('Domain=')));assert(cookies.every(s=>s.includes('Max-Age=0')&&s.includes('HttpOnly')&&s.includes('Secure')));
  assert.equal((await f.call()).status,401);assert.equal((await f.call(undefined,undefined,f.secondToken)).status,200);
 }finally{f.close();}
});
test('existing temporary owner/test exception can reply to member support; ordinary un-enrolled users and clinical writes stay denied',async()=>{
 const f=await myShiftFixture();try{
  Object.assign(f.env,{SSTRX_PASSWORD_SIGNIN_ENABLED:'true',SSTRX_PASSWORD_SIGNIN_UNTIL:PASSWORD_SIGNIN_LAST_DAY});
  const id=152,token='fictional-limited-support-owner-0000000000000000';f.tokens[id]=token;
  f.sql.prepare("INSERT INTO hq_users(id,email,name,password_hash,role,status,mfa_enabled) VALUES(152,'shiftsometimber@gmail.com','FICTIONAL OWNER AUTHORITY TEST','!fixture-no-password','owner','active',0)").run();
  f.sql.prepare('INSERT INTO hq_sessions(hq_user_id,token_hash,expires_at) VALUES(?,?,?)').run(id,await sha(token),new Date(Date.now()+86400000).toISOString());
  const native=f.env.HQ_AUTH.fetch;f.env.HQ_AUTH.fetch=async request=>{const r=await native(request);if(new URL(request.url).pathname.endsWith('/me')&&r.ok){const d=await r.json(),u=f.sql.prepare('SELECT email,status FROM hq_users WHERE id=?').get(d.user.id);return Response.json({user:{...d.user,...u}});}return r;};
  const t=await(await f.call('/v1/member/my-shift/support',{clientReference:crypto.randomUUID(),message:'FICTIONAL SUPPORT QUESTION'})).json();
  const reply=()=>f.hq('/platform/my-shift-support/'+t.reference,id,{clientReference:crypto.randomUUID(),version:1,message:'FICTIONAL LIMITED OWNER REPLY'});
  const r=await reply();assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).messages.at(-1).body,'FICTIONAL LIMITED OWNER REPLY');
  f.env.SSTRX_PASSWORD_SIGNIN_ENABLED='false';assert.equal((await reply()).status,403);f.env.SSTRX_PASSWORD_SIGNIN_ENABLED='true';
  f.sql.prepare("UPDATE hq_users SET email='ordinary@example.test' WHERE id=152").run();assert.equal((await reply()).status,403);
  assert.equal((await f.hq('/10000000-0000-4000-8000-000000000001/action',id,{action:'decision',outcome:'proceed'})).status,403);
 }finally{f.close();}
});
