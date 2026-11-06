// Audit driver: real compiled app, isolated exact-schema SQLite, no external network.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {chromium,webkit} from 'playwright';
import {wholeAppFixture} from './whole-app-fixture.mjs';
import {runAppActions} from './whole-app-actions.mjs';
const origin='https://shiftsometimber.co.uk';
const directory=process.env.WHOLE_APP_EVIDENCE_DIRECTORY||'.partner-qa/whole-app';
await fs.mkdir(directory,{recursive:true});
const report={sourceCommit:process.env.WHOLE_APP_SOURCE||'working-tree',scope:'Synthetic browser interception of exact compiled app. No hosted, supplier or physical-device acceptance.',engines:[]};
for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
 const f=await wholeAppFixture();f.tracking();f.setup();let apiAdapter;
 if(process.env.WHOLE_APP_LEGACY_MODULE)apiAdapter=await fs.readFile(new URL('./public-assets/api-adapter-v33d.js',pathToFileURL(process.env.WHOLE_APP_LEGACY_MODULE)),'utf8');
 if(process.env.WHOLE_APP_LEGACY_MODULE){
  const legacy=await import(process.env.WHOLE_APP_LEGACY_MODULE),prior=f.env.MEMBER_LEGACY;
  Object.assign(f.env,{MEMBER_EXPERIENCE_V1_ENABLED:'true',CORE:{async fetch(r){if(new URL(r.url).pathname==='/api-adapter-v33d.js'&&apiAdapter)return new Response(apiAdapter,{headers:{'Content-Type':'text/javascript'}});f.unverified.push({path:new URL(r.url).pathname,method:r.method,reason:'Exact currently serving Core source not yet qualified for isolated run'});return Response.json({error:'unverified_core_transport_in_isolated_fixture'},{status:503});}}});
  f.env.MEMBER_LEGACY={fetch(r){const p=new URL(r.url).pathname;return p.startsWith('/assets/clinical-records/')||p.startsWith('/v1/member/my-shift')||p.startsWith('/v1/member/secure-messages')||['/member/messages','/member/care','/v1/member/care-card'].includes(p)?prior.fetch(r):legacy.default.fetch(r,f.env,{waitUntil:p=>p.catch(()=>{})});}};
 }
 const originalFetch=globalThis.fetch;globalThis.fetch=async(input,options)=>{const u=new URL(input instanceof Request?input.url:input);f.unverified.push({path:u.pathname,method:options?.method||'GET',reason:'Network disabled in isolated audit'});return Response.json({error:'unverified_external_transport_in_isolated_fixture'},{status:503});};
 const errors=[],requests=[],rows=[];let browser,ctx;
 try{
  browser=await type.launch();ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await ctx.addCookies([{name:'sst_session',value:f.tokens[0],url:origin+'/',httpOnly:true,secure:true,sameSite:'Lax'}]);
  await ctx.route('**/*',async route=>{
   const q=route.request(),headers=await q.allHeaders();const localUrl=new URL(q.url());if(localUrl.protocol==='blob:'||localUrl.protocol==='data:'){if(localUrl.protocol==='blob:'&&localUrl.origin!==origin)throw Error('Foreign local blob');await route.continue();return;}
   if(name==='webkit'&&!headers.cookie){const c=await ctx.cookies(q.url());if(c.length)headers.cookie=c.map(x=>x.name+'='+x.value).join('; ');}
   try{
    const u=new URL(q.url());if(u.origin!==origin){f.unverified.push({path:u.pathname,method:q.method(),reason:'External origin blocked in isolated browser audit'});await route.fulfill({status:503,body:'Isolated audit: external service unverified'});return;}
    const request=new Request(q.url(),{method:q.method(),headers,body:['GET','HEAD'].includes(q.method())?undefined:q.postDataBuffer()});
    const r=await f.app.fetch(request,f.env,{waitUntil:p=>p.catch(e=>errors.push(e.message))});
    requests.push({path:u.pathname+u.search,method:q.method(),status:r.status,...q.postData()?{syntheticRequestBody:q.postData()}: {}});
    await route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())});
   }catch(e){errors.push(e.message);await route.fulfill({status:500,body:'Isolated audit error'}).catch(()=>{});}
  });
  const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/member/dashboard?mt-rollback=1#today');
  await page.waitForFunction(()=>document.body.dataset.memberSession==='ready'&&window.__MT_NAV_READY===true);
  const start=await page.evaluate(()=>performance.timeOrigin);
  for(const label of ['Welcome','Today','Journey','Shop','Grub','Fit','Support','More']){
   try{
    const a=page.locator('a:visible').filter({hasText:new RegExp('^'+label+'$')}).first();await a.click();
    await page.waitForTimeout(250);
    if(label==='More')await page.waitForFunction(()=>document.querySelectorAll('[data-mx-door]').length===4||document.querySelector('#mtNativeMain')?.innerText.includes('could not load'),{},{timeout:12000}).catch(()=>{});
    rows.push(await page.evaluate(label=>{
     const main=document.getElementById('mtNativeMain');
     return {label,path:location.pathname+location.search+location.hash,sameDocument:performance.timeOrigin===window.__auditOrigin,
      content:main?.dataset.mtContent,heading:[...main?.querySelectorAll('h1,h2')||[]].map(x=>x.textContent.trim()),
      text:main?.innerText.slice(0,800),controls:[...main?.querySelectorAll('a,button,input,select,textarea,summary')||[]].filter(x=>x.getBoundingClientRect().height>0).map(x=>({tag:x.tagName,label:x.textContent.trim().slice(0,100)||x.getAttribute('aria-label')||x.name||x.type,id:x.id,href:x.getAttribute('href'),type:x.type,data:{...x.dataset},disabled:x.disabled||false})),
      overflow:document.documentElement.scrollWidth>innerWidth};
    },label));
    if(label==='Today')await page.evaluate(v=>window.__auditOrigin=v,start);
   }catch(e){rows.push({label,error:e.message});}
  }
  const actions=process.env.WHOLE_APP_ACTIONS==='true'?await runAppActions(page,f,requests,name):null;
  report.engines.push({name,rows,actions,errors,requests,unverified:f.unverified});
 }catch(e){report.engines.push({name,rows,errors:[...errors,e.message],requests,unverified:f.unverified});}
 finally{await ctx?.close();await browser?.close();globalThis.fetch=originalFetch;f.close();}
 await fs.writeFile(directory+'/inventory.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({engine:name,screens:report.engines.at(-1).rows.map(r=>({label:r.label,controls:r.controls?.length,heading:r.heading,error:r.error})),errors:report.engines.at(-1).errors,actionSummary:report.engines.at(-1).actions?.summary,unverified:f.unverified}));
}

// Discovery cannot be mistaken for full acceptance.
if(report.engines.some(e=>e.errors?.length||e.actions?.checks.some(c=>c.outcome==="FAIL_SYNTHETIC")))process.exitCode=1;
else if(report.engines.some(e=>e.unverified?.length||e.actions?.checks.some(c=>c.outcome.startsWith("BLOCKED_"))))process.exitCode=2;
