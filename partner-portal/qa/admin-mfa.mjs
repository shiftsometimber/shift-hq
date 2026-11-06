// Synthetic browser acceptance only. Uses the compiled gateway; no external services.
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import gateway from '../../.partner-qa/sstrx.bundle.mjs';
const origin='https://sstrx.shiftsometimber.co.uk';
let state;
function reset(options={}){
 state={mfaEnabled:false,revoked:new Set(),challenge:null,setupFailure:options.setupFailure||false,activationPending:options.activationPending||false};
}
reset();
const env={PARTNER_ACCESS_ENABLED:'true',SSTRX_PORTAL_ENABLED:'true',PORTAL_SESSION_KEY:'ab'.repeat(32),
 HQ_AUTH:{async fetch(request){
  const path=new URL(request.url).pathname;
  if(path.endsWith('/auth/login')){
   if(state.mfaEnabled){state.challenge='fictional-challenge';return Response.json({mfaRequired:true,challenge:state.challenge});}
   return Response.json({ok:true},{headers:{'Set-Cookie':'sst_hq_session=fictional-pending-000000000000000; Path=/; Secure; Max-Age=3600'}});
  }
  if(path.endsWith('/auth/mfa/verify')){
   const b=await request.json();if(b.challenge!==state.challenge||b.code!=='123456')return Response.json({error:'invalid_mfa'},{status:401});
   state.challenge=null;return Response.json({ok:true},{headers:{'Set-Cookie':'sst_hq_session=fictional-verified-000000000000000; Path=/; Secure; Max-Age=3600'}});
  }
  const token=request.headers.get('Cookie')?.match(/sst_hq_session=([^;]+)/)?.[1];
  if(!token||state.revoked.has(token))return Response.json({error:'signed_out'},{status:401});
  if(path.endsWith('/auth/logout')){state.revoked.add(token);return Response.json({ok:true});}
  if(path.endsWith('/me'))return Response.json({user:{id:172,email:'reviewer@example.test',role:'operations',status:'active',mfaEnabled:state.mfaEnabled}});
  if(path.endsWith('/mfa/setup')){if(state.setupFailure){state.setupFailure=false;return Response.json({}, {status:503});}return Response.json({secret:'FICTIONALSETUPKEYFORLOCALTESTSONLY'});}
  if(path.endsWith('/mfa/enable')){const b=await request.json();if(b.code!=='123456')return Response.json({}, {status:422});state.mfaEnabled=true;return Response.json({ok:true});}
  throw Error('Unexpected synthetic path '+path);
 }},
 CLINICAL:{async fetch(){return Response.json({error:'synthetic_no_records'},{status:403});}}
};
const server=http.createServer(async(req,res)=>{try{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 const headers=new Headers(req.headers);headers.set('Cookie',(headers.get('Cookie')||'').replaceAll('qa_shift_partner','__Host-shift_partner'));
 if(req.method==='POST')headers.set('Origin',origin);
 const response=await gateway.fetch(new Request(origin+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}),env);
 res.statusCode=response.status;for(const [k,v]of response.headers)if(k!=='set-cookie')res.setHeader(k,v);
 const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies.map(c=>c.replaceAll('__Host-shift_partner','qa_shift_partner').replace(/; Secure/gi,'')));
 res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){res.statusCode=500;res.end(e.message);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
const results=[],out=new URL('../../.partner-qa/admin-mfa/',import.meta.url);await fs.mkdir(out,{recursive:true});
try{
 for(const [name,type]of [['Chromium',chromium],['WebKit',webkit]]){
  const browser=await type.launch({headless:true});
  try{
   for(const width of [320,390,1440]){
    reset();const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const signIn=async()=>{await page.locator('#partner-username').fill('reviewer@example.test');await page.locator('#partner-password').fill('Fictional-password-only');await page.getByRole('button',{name:'Continue securely'}).click();};
    await page.goto(url);await signIn();const code=page.getByLabel('Six-digit authenticator code');await code.waitFor({state:'visible'});
    assert(await page.getByRole('heading',{name:'Set up your authenticator'}).isVisible());
    assert.equal(await page.locator('#partner-password').inputValue(),'');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' overflow at '+width);
    if(width===390)await page.screenshot({path:new URL(name.toLowerCase()+'-setup.png',out).pathname,fullPage:true});
    await code.fill('000000');await page.getByRole('button',{name:'Verify authenticator'}).click();await page.getByText('Authenticator setup could not be verified. Please check the code.',{exact:true}).waitFor();
    assert.equal(await code.inputValue(),'');await code.fill('123456');await page.getByRole('button',{name:'Verify authenticator'}).click();
    await page.getByText('Authenticator enabled. Sign in again with your password and a fresh authenticator code to open your workspace.',{exact:true}).waitFor();
    assert.equal(await page.locator('.partner-setup-key').count(),0);
    await page.getByRole('link',{name:'Return to sign-in',exact:true}).click();await signIn();await page.locator('#partner-mfa-code').waitFor({state:'visible'});
    await page.locator('#partner-mfa-code').fill('123456');await page.getByRole('button',{name:'Verify & sign in'}).click();await page.waitForURL('**/workspace/overview');
    assert.equal(await page.getByText('Operational oversight',{exact:true}).count(),1);assert(await page.getByRole('heading',{name:'Overview',exact:true}).isVisible());assert.equal(await page.getByRole('link',{name:'Clinical Cases',exact:true}).count(),0);
    assert.deepEqual(errors,[]);results.push({browser:name,width,setup:true,invalidCodeRejected:true,reentryRequiresMfa:true,reviewerRolePreserved:true,overflow:false});await context.close();
   }
   reset();const context=await browser.newContext(),page=await context.newPage();
   await page.goto(url);await page.locator('#partner-username').fill('reviewer@example.test');await page.locator('#partner-password').fill('Fictional-password-only');await page.getByRole('button',{name:'Continue securely'}).click();await page.getByLabel('Six-digit authenticator code').waitFor();
   await page.getByRole('button',{name:'Cancel setup and sign out'}).click();await page.locator('#partner-login-form').waitFor({state:'visible'});assert(state.revoked.has('fictional-pending-000000000000000'));assert.equal(await page.locator('.partner-setup-key').count(),0);
   reset({setupFailure:true});await page.reload();await page.locator('#partner-username').fill('reviewer@example.test');await page.locator('#partner-password').fill('Fictional-password-only');await page.getByRole('button',{name:'Continue securely'}).click();await page.getByText('Authenticator setup could not be verified. Please check the code.',{exact:true}).waitFor();assert(await page.locator('#partner-login-form').isVisible());assert(await page.getByRole('button',{name:'Continue securely'}).isEnabled());
   await context.close();results.push({browser:name,cancelRevokesPending:true,setupFailureRecoverable:true});
  }finally{await browser.close();}
 }
 await fs.writeFile(new URL('results.json',out),JSON.stringify({fictional:true,results},null,2));console.log(JSON.stringify({fictional:true,checks:results.length,results}));
}finally{await new Promise(resolve=>server.close(resolve));}
