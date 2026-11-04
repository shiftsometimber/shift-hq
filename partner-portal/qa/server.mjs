// Managed-preview ONLY. All identities, sessions, messages and records are fictional.
// This module and its cookie transport adapter are never included in Worker uploads.
import http from 'node:http';
import fs from 'node:fs/promises';
import {buildKernel} from '../service/build-kernel.mjs';
import {buildMemberKernel} from '../service/build-member-kernel.mjs';
await buildKernel();await buildMemberKernel();
const {fixture,ORDER}=await import('../test/fixture.mjs'),{reviewAndPropose,issue}=await import('../test/workflow-helpers.mjs');
const {default:portal}=await import('../worker.mjs');
const f=await fixture(),review=await reviewAndPropose(f);await issue(f,review.cookie,review.proposal);let pharmacy=await f.login('DSPTEST');
await f.partner('/partner-desk/threads',pharmacy,{orderNumber:ORDER,subject:'Fictional delivery question',priority:'normal',message:'Fictional QA: can HQ confirm the delivery handover for this order?'});
const file=path=>fs.readFile(new URL('../../'+path,import.meta.url));
const published=['hq.css','hq-management.css','hq-operations.css','hq-partner-desk.css','hq-partners.css','hq-evidence-desk.css','hq-knowledge-editorial.css','hq.js','hq-v111.js','hq-management.js','hq-operations.js','hq-partner-desk.js','hq-partners.js','hq-partner-workflows.js','turnstile-auth-v1.js','gp-directory.js'];
const ownerShell=(await file('index.html')).toString().replace('<head>','<head><base href="/qa-file/"><meta http-equiv="Content-Security-Policy" content="default-src \'self\';script-src \'self\' \'unsafe-inline\';style-src \'self\' \'unsafe-inline\';connect-src \'none\';img-src \'self\' data:;frame-src \'self\'"><script src="/qa-file/owner-fixture.js"></script>');
const shell=`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>FICTIONAL QA · HQ Partner desk</title><link rel="stylesheet" href="/qa-file/hq.css"><link rel="stylesheet" href="/qa-file/hq-partner-desk.css"><style>body{background:#e7e3da}aside{background:#050505;color:#e7e3da}.qa-label{background:#707762;color:#fff;padding:12px 20px}.view:not(.active){display:none}main{padding:24px;margin-left:240px}aside{position:fixed;width:220px;height:100vh;padding:20px}button{min-height:44px}.panel{background:#f7f5ef;padding:22px;border-radius:8px}#pd-notice{padding:12px;background:#dfe4d5}</style></head><body><aside><h2>SHIFT HQ</h2><nav><details open><summary>Partners & fulfilment</summary></details></nav><span id="hqUserChip">Fictional QA owner</span><button id="logoutBtn">Sign out</button></aside><main><p class="qa-label">FICTIONAL LOCAL QA · No real accounts, orders, patients or messages.</p><h1 id="title">Partner desk</h1><section id="dashboard" class="view"><div class="hq-quick-actions"></div></section></main><script>const S={me:{id:1,role:'owner',mfaEnabled:true}};async function call(path,options={}){const r=await fetch('/qa-api'+path,{...options,headers:{'Content-Type':'application/json'}});const d=await r.json();if(!r.ok)throw Error(d.message||d.error);return d;}</script><script src="/qa-file/hq-partner-desk.js"></script><script>window.installPartnerDeskHQ();document.querySelector('[data-view=partnerdesk]').click();</script></body></html>`;
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://'+req.headers.host);let response;
 if(url.pathname==='/qa-owner')response=new Response(ownerShell,{headers:{'Content-Type':'text/html'}});
 else if(url.pathname==='/qa/mobile')response=new Response('<!doctype html><html><head><meta charset="utf-8"><title>Fictional mobile QA</title></head><body style="background:#707762"><h1>Fictional local QA · 390px HQ / 375px partner</h1><iframe title="HQ owner at 390px" src="/qa-owner?qa=owner" style="width:390px;height:1100px;border:0"></iframe><iframe title="Partner at 375px" src="/workspace/hq" style="width:375px;height:1100px;border:0"></iframe></body></html>',{headers:{'Content-Type':'text/html'}});
 else if(url.pathname==='/qa/hq')response=new Response(shell,{headers:{'Content-Type':'text/html'}});
 else if(url.pathname.startsWith('/qa-file/')){const name=url.pathname.slice(9);if(![...published,'owner-fixture.js'].includes(name))throw Error('Invalid QA file');response=new Response(await file(name==='owner-fixture.js'?'partner-portal/qa/owner-fixture.js':name),{headers:{'Content-Type':name.endsWith('.css')?'text/css':'text/javascript'}});}
 else if(url.pathname==='/qa/enter/pharmacy')response=new Response('',{status:303,headers:{Location:'/workspace/hq','Set-Cookie':pharmacy.replace('__Host-shift_partner','qa_shift_partner')+'; Path=/; HttpOnly; SameSite=Lax'}});
 else if(url.pathname.startsWith('/qa-api/v1/hq/clinical')){const parts=[];for await(const p of req)parts.push(p);const data=Buffer.concat(parts);response=await f.hq(url.pathname.slice('/qa-api/v1/hq/clinical'.length),1,data.length?JSON.parse(data.toString()):undefined);}
 else{
  const chunks=[];for await(const p of req)chunks.push(p);const data=Buffer.concat(chunks),headers=new Headers(req.headers);
  headers.set('Cookie',(headers.get('Cookie')||'').replaceAll('qa_shift_partner','__Host-shift_partner').replaceAll('qa_shift_partner_mfa','__Host-shift_partner_mfa').replaceAll('qa_shift_partner_setup','__Host-shift_partner_setup'));
  if(req.method==='POST')headers.set('Origin','https://partner.shiftsometimber.co.uk');headers.set('CF-Connecting-IP','203.0.113.42');
  response=await portal.fetch(new Request('https://partner.shiftsometimber.co.uk'+url.pathname+url.search,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:data}),f.portalEnv);
 }
 if(response.headers.get('Content-Type')?.includes('text/html')&&url.pathname!=='/qa/hq'){const body=await response.text();response=new Response(body.replace('<body','<body').replace(/(<body[^>]*>)/,'$1<p class="demo-banner">FICTIONAL LOCAL QA · No real accounts, patients, orders or messages.</p>'),response);}
 if(response.headers.get('Content-Type')?.includes('text/html')){const headers=new Headers(response.headers);headers.delete('X-Frame-Options');const csp=headers.get('Content-Security-Policy');if(csp)headers.set('Content-Security-Policy',csp.replace(/frame-ancestors[^;]+;?/g,''));response=new Response(response.body,{status:response.status,headers});}
 res.statusCode=response.status;for(const [k,v]of response.headers)if(k.toLowerCase()!=='set-cookie')res.setHeader(k,v);
 const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies.map(x=>x.replaceAll('__Host-shift_partner','qa_shift_partner').replace(/; Secure/gi,'')));
 res.end(Buffer.from(await response.arrayBuffer()));
}catch(e){res.statusCode=500;res.end('Fictional QA error: '+e.message);}}).listen(Number(process.env.PORT||4173),'0.0.0.0',()=>console.log('Fictional connected QA ready; /qa/hq and /qa/enter/pharmacy.'));
