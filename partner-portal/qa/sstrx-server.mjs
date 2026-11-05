// FICTIONAL LOCAL QA ONLY. Host-cookie translation is excluded from production.
import http from 'node:http';
import fs from 'node:fs/promises';
import {fixture} from '../test/fixture.mjs';
import {reviewAndPropose,issue} from '../test/workflow-helpers.mjs';
import portal from '../sstrx-worker.mjs';
import legacy from '../worker.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
const ORIGIN='https://sstrx.shiftsometimber.co.uk';
const f=await fixture();Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_PAID_RECORD_LINK_ENABLED:'true',SSTRX_ENVIRONMENT:'synthetic',STRIPE_MODE:'test',SSTRX_TEST_SIGNING:'true'});f.env.SSTRX_ACCESS_REQUESTS_ENABLED='true';f.portalEnv.SSTRX_ACCESS_REQUESTS_ENABLED='true';f.env.SSTRX_ACCESS_REQUEST_KEY='SYNTHETIC-TRANSPORT-KEY-NOT-A-REAL-CREDENTIAL';f.portalEnv.SSTRX_ACCESS_REQUEST_KEY=f.env.SSTRX_ACCESS_REQUEST_KEY;f.portalEnv.SSTRX_PORTAL_ENABLED='true';await ensurePlatformSchema(f.DB);
const review=await reviewAndPropose(f);await issue(f,review.cookie,review.proposal);
async function seededSession(kind){const username=kind==='owner'?'fixture-1@example.test':kind==='pharmacy'?'DSPTEST':'CLNTEST';
 const h={Origin:ORIGIN,'CF-Connecting-IP':'203.0.113.42','Content-Type':'application/json'};
 const a=await portal.fetch(new Request(ORIGIN+'/api/login',{method:'POST',headers:h,body:JSON.stringify({username,password:'Synthetic-only-password-987'})}),f.portalEnv);
 if(!a.ok)throw Error('Fictional password stage failed');const cookie=a.headers.getSetCookie()[0].split(';')[0];
 const b=await portal.fetch(new Request(ORIGIN+'/api/mfa',{method:'POST',headers:{...h,Cookie:cookie},body:'{"code":"123456"}'}),f.portalEnv);if(!b.ok)throw Error('Fictional MFA stage failed');
 return b.headers.getSetCookie().find(x=>x.startsWith('__Host-shift_partner=')).split(';')[0];
}
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://'+req.headers.host),body=[];for await(const p of req)body.push(p);
 if(url.pathname==='/qa/hq'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html><head><meta charset="utf-8"><title>FICTIONAL HQ acceptance</title></head><body><p>FICTIONAL HQ ACCEPTANCE · No real accounts or external messages</p><aside><nav><details open><summary>Partners &amp; fulfilment</summary></details></nav></aside><h1 id="title">HQ</h1><span id="hqUserChip">Fictional owner</span><button id="logoutBtn">Sign out</button><div class="hq-quick-actions"></div><main></main><script src="/qa/hq-shell.js"></script><script src="/qa/hq-partner-desk.js"></script><script src="/qa/hq-start.js"></script></body></html>');return;}
 if(url.pathname==='/qa/hq-shell.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end('var S={me:{id:1,role:"owner"}};var call=async(path,options={})=>{const r=await fetch("/qa/hq-api"+path,{...options,headers:{"Content-Type":"application/json"}});const d=await r.json();if(!r.ok)throw Object.assign(Error(d.error||"Fictional HQ request failed"),{status:r.status});return d;};');return;}
 if(url.pathname==='/qa/hq-partner-desk.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await fs.readFile(new URL('../../hq-partner-desk.js',import.meta.url)));return;}
 if(url.pathname==='/qa/hq-start.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end('window.installPartnerDeskHQ();');return;}
 if(url.pathname.startsWith('/qa/hq-api/v1/hq/clinical')){const path=url.pathname.slice('/qa/hq-api/v1/hq/clinical'.length),r=await f.hq(path,1,req.method==='POST'?JSON.parse(Buffer.concat(body).toString()):undefined);res.writeHead(r.status,{'Content-Type':'application/json'});res.end(await r.text());return;}
 if(['/qa/enter/clinician','/qa/enter/pharmacy','/qa/enter/owner'].includes(url.pathname)){const cookie=await seededSession(url.pathname.split('/').pop());res.writeHead(303,{Location:'/workspace/overview','Set-Cookie':cookie.replaceAll('__Host-shift_partner','qa_shift_partner')+'; Path=/; HttpOnly; SameSite=Lax'});res.end();return;}
 if(url.pathname==='/qa/mobile'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html><head><title>Fictional mobile SST Rx at 390px</title></head><body style="margin:0;background:#707762"><iframe title="SST Rx at 390px" src="/workspace/overview" width="390" height="1000" style="border:0;display:block"></iframe></body></html>');return;}
 if(url.pathname==='/qa/revoke'){f.sql.prepare('UPDATE hq_sessions SET revoked_at=? WHERE hq_user_id IN (3,4)').run(new Date().toISOString());res.writeHead(200,{'Content-Type':'application/json'});res.end('{"fictional":true,"revoked":true}');return;}
 const isLegacy=url.pathname.startsWith('/baseline'),path=isLegacy?url.pathname.slice('/baseline'.length)||'/':url.pathname;
 const origin=isLegacy?'https://partner.shiftsometimber.co.uk':ORIGIN,headers=new Headers(req.headers);headers.set('Cookie',(headers.get('Cookie')||'').replaceAll('qa_shift_partner','__Host-shift_partner'));headers.set('CF-Connecting-IP','203.0.113.42');if(req.method==='POST')headers.set('Origin',origin);
 let response=await (isLegacy?legacy:portal).fetch(new Request(origin+path+url.search,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(body)}),f.portalEnv);
 if(response.headers.get('Content-Type')?.includes('text/html')){const text=await response.text();response=new Response(text.replace(/(<body[^>]*>)/,'$1<div class="rx-qa-label" style="background:#dfe3d5;color:#303829;padding:7px 18px;font:11px system-ui;text-align:center">FICTIONAL ACCEPTANCE ENVIRONMENT · No real patients, prescriptions, payments or external messages</div>'),response);const h=new Headers(response.headers);h.delete('X-Frame-Options');h.set('Content-Security-Policy',h.get('Content-Security-Policy')?.replace("style-src 'self'","style-src 'self' 'unsafe-inline'").replace("frame-ancestors 'none'","frame-ancestors 'self'")||"default-src 'self'");response=new Response(response.body,{status:response.status,headers:h});}
 res.statusCode=response.status;for(const [k,v]of response.headers)if(k.toLowerCase()!=='set-cookie')res.setHeader(k,v);const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies.map(c=>c.replaceAll('__Host-shift_partner','qa_shift_partner').replace(/; Secure/gi,'')));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){res.statusCode=500;res.end('Fictional QA unavailable: '+e.message);}}).listen(Number(process.env.PORT||4173),'0.0.0.0',()=>console.log('SST Rx fictional acceptance ready. CLNTEST / DSPTEST. All credentials and identities are synthetic.'));
