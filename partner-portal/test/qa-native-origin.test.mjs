import test from 'node:test';
import assert from 'node:assert/strict';
import {createQaNativeOrigin} from '../qa/native-origin.mjs';
import {QA_ACCESS} from '../qa/access-config.mjs';
const enabled=!!process.env.SSTRX_QA_CORE_ROOT;
const enc=new TextEncoder(),b64=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
async function access(){
 const key=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',key.publicKey),kid:'fixture-native',alg:'RS256',use:'sig'},now=Math.floor(Date.now()/1000),payload=b64({alg:'RS256',typ:'JWT',kid:jwk.kid})+'.'+b64({iss:QA_ACCESS.issuer,aud:[QA_ACCESS.audience],type:'app',email:QA_ACCESS.emails[0],iat:now,exp:now+600});
 const token=payload+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key.privateKey,enc.encode(payload))).toString('base64url');
 return{token,options:{fetchKeys:async()=>Response.json({keys:[jwk]})}};
}
test('QA native origin admits only exact protected hosts and rejects missing Access, foreign CSRF origins and host aliases before native execution',async()=>{
 const a=await access();let calls=0;const app=createQaNativeOrigin({fetch(){calls++;return Response.json({ok:true})}},{host:'api-qa.sstrx.co.uk'},a.options),env={SSTRX_ENVIRONMENT:'synthetic'};
 for(const [url,headers]of [['https://api-qa.sstrx.co.uk/v1/me',{}],['https://api-qa.sstrx.co.uk/v1/me',{'Cf-Access-Jwt-Assertion':a.token,Origin:'https://attacker.example'}],['https://alias.workers.dev/v1/me',{'Cf-Access-Jwt-Assertion':a.token}],['https://api-qa.sstrx.co.uk/v1/me',{'Cf-Access-Jwt-Assertion':a.token,'Sec-Fetch-Site':'cross-site'}]])assert.equal((await app.fetch(new Request(url,{headers}),env)).status,403);
 assert.equal((await app.fetch(new Request('https://api-qa.sstrx.co.uk/v1/auth/login',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':a.token}}),env)).status,403);assert.equal(calls,0);
 assert.throws(()=>createQaNativeOrigin({}, {host:'production.example'}),/unsupported/);
});
test('QA origin cookies stay Secure/HttpOnly and host-bound; redirects cannot leave the private QA origin',async()=>{
 const a=await access(),env={SSTRX_ENVIRONMENT:'synthetic'},request=()=>new Request('https://api-qa.sstrx.co.uk/v1/me',{headers:{'Cf-Access-Jwt-Assertion':a.token}});
 const app=handler=>createQaNativeOrigin({fetch:async()=>handler()},{host:'api-qa.sstrx.co.uk'},a.options);
 const response=await app(()=>new Response('',{status:302,headers:{'Set-Cookie':'sst_session=fictional; Path=/; Domain=.shiftsometimber.co.uk; HttpOnly; Secure; SameSite=Lax',Location:'https://shiftsometimber.co.uk/member/dashboard'}})).fetch(request(),env);
 assert.equal(response.status,302);assert.equal(response.headers.get('Location'),'https://api-qa.sstrx.co.uk/member/dashboard');assert.doesNotMatch(response.headers.get('Set-Cookie'),/Domain=/i);assert.match(response.headers.get('Set-Cookie'),/HttpOnly; Secure/);
 for(const cookie of ['sst_session=fictional; HttpOnly','sst_session=fictional; Secure','sst_session=fictional; Secure; HttpOnly; Domain=other.example'])assert.equal((await app(()=>new Response('',{headers:{'Set-Cookie':cookie}})).fetch(request(),env)).status,503);
 assert.equal((await app(()=>new Response('',{status:302,headers:{Location:'https://checkout.stripe.com/example'}})).fetch(request(),env)).status,503);
});
test('QA adapter retains actual current Core native member/owner/MFA sessions and role denials on the same isolated database',{skip:!enabled},async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('External network disabled')};let s;
 try{
  const {nativeAccounts}=await import('../qa/native-accounts.mjs');s=await nativeAccounts();const a=await access(),env={...s.env,SSTRX_ENVIRONMENT:'synthetic'};
  const app=createQaNativeOrigin({fetch:s.nativeFetch},{host:'api-qa.sstrx.co.uk'},a.options);
  const req=(path,body,cookie)=>new Request('https://api-qa.sstrx.co.uk'+path,{method:body?'POST':'GET',headers:{'Cf-Access-Jwt-Assertion':a.token,Origin:'https://api-qa.sstrx.co.uk',Cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  let r=await app.fetch(req('/v1/hq/me',null,s.ownerSession),env,{});assert.equal(r.status,200);let d=await r.json();assert.equal(d.user.id,s.owner.id);assert.equal(d.user.mfaEnabled,true);
  r=await app.fetch(req('/v1/hq/me',null,s.memberSession),env,{});assert.equal(r.status,401);
  const secret=s.secrets.get('member');r=await app.fetch(req('/v1/auth/login',{email:secret.email,password:secret.password}),env,{});assert.equal(r.status,200);const cookies=r.headers.getSetCookie();assert.equal(cookies.filter(c=>c.startsWith('sst_session=')).length,1);assert.ok(cookies.every(c=>!c.includes('Domain=')&&c.includes('Secure')&&c.includes('HttpOnly')));assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://api-qa.sstrx.co.uk');
  const memberCookie=cookies.find(c=>c.startsWith('sst_session=')).split(';')[0];r=await app.fetch(req('/v1/me',null,memberCookie),env,{});assert.equal(r.status,200);d=await r.json();assert.equal(d.user.id,s.member.id);
  const before=s.sql.prepare('SELECT COUNT(*) n FROM hq_users').get().n;r=await app.fetch(req('/v1/hq/users',{email:'deny@example.invalid',password:'Fictional-only-pass-42!',name:'Denied account',role:'owner'},s.actors.support.session),env,{});assert.equal(r.status,403);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM hq_users').get().n,before);
  r=await app.fetch(req('/v1/auth/logout',{},memberCookie),env,{});assert.equal(r.status,200);assert.ok(r.headers.getSetCookie().every(c=>!c.includes('Domain=')&&c.includes('Max-Age=0')));r=await app.fetch(req('/v1/me',null,memberCookie),env,{});assert.equal(r.status,401);
 }finally{s?.close();globalThis.fetch=old;}
});
