// Replays the actual public native loader, stylesheet scoper and account scripts.
// All API responses are local synthetic fixtures. No real accounts or sends.
import http from 'node:http';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {repairAccountBoundary} from '../platform/account-boundary-fix.mjs';
const fixture=JSON.parse(await fs.readFile(new URL('../test/fixtures/public-account-boundary.json',import.meta.url),'utf8'));
const report={scope:'Local synthetic API; original public native/account source; actual Chromium and WebKit',engines:[]};
for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]){
 let revoked=false,mode='empty',writes=0;
 const harness=fixture.retainedFactory+'\n'+fixture.legacyLoader.replace('async function B(D)','async function originalLegacy(D)')+'\n'+repairAccountBoundary(fixture.legacyLoader).replace('async function B(D)','async function repairedLegacy(D)')+`
 let w=new Map,r=false,i='42',generation=0,currentReady=true;
 const target=document.getElementById('testAccount');
 function _(){generation++;currentReady=false;target.replaceChildren();}
 function R(){}
 window.MT_MEMBER_IDENTITY=async()=>({user:{id:42},expiresAt:new Date(Date.now()+86400000).toISOString()});window.SST_API={};
 const retained=makeRetained({generation:()=>generation,owner:()=>i,ready:()=>currentReady,clear:_,weightVisible:()=>true,weightData:x=>x});
 window.openAccount=async fixed=>{const result=await(fixed?repairedLegacy:originalLegacy)(new URL('/member/settings',location.origin));target.innerHTML=result.html;await retained.load(result,target);};
 `;
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1');let text,type='text/html',status=200;
  if(req.method!=='GET')writes++;
  if(url.pathname==='/')text='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body data-mt-native-shell><header id="nativeHeader">MY TIMBER</header><main id="testAccount"></main><script src="/harness.js"></script></body>';
  else if(url.pathname==='/harness.js'){text=harness;type='text/javascript';}
  else if(url.pathname==='/member/settings')text=fixture.html;
  else if(fixture.styles[url.pathname]){text=fixture.styles[url.pathname];type='text/css';}
  else if(url.pathname==='/assets/member-experience/v7-retained-script.mjs'){
   const source=url.searchParams.get('source'),context=url.searchParams.get('context'),script=fixture.scripts[source]||'';
   text='(()=>{const ctx=window.MT_RETAINED_CONTEXT('+JSON.stringify(context)+');(function(document,window,fetch,location){'+script+'\n})(ctx.document,ctx.window,ctx.fetch,ctx.location);})();';type='text/javascript';
  }else if(url.pathname.startsWith('/v1/')){
   type='application/json';if(revoked){status=401;text='{"error":"sign_in_required"}';}
   else if(url.pathname==='/v1/member/details')text=JSON.stringify({details:{firstName:'Fictional',lastName:'Member',email:'fictional@example.test',postcode:'AA1 1AA'}});
   else if(url.pathname==='/v1/member/clinical-records'){status=403;text='{"error":"clinical_service_not_open"}';}
   else if(url.pathname.startsWith('/v1/member/treatment/week'))text=JSON.stringify({week:{context:{progress:[]}}});
   else text=JSON.stringify({ok:true,orders:mode==='data'?[{id:1,order_number:'FICTIONAL-ORDER',orderNumber:'FICTIONAL-ORDER',status:'paid',clinicalStatus:'awaiting_review',headline:'Fictional review pending',total_pence:100,totalPence:100,created_at:new Date().toISOString(),updatedAt:new Date().toISOString()}]:[]});
  }else{status=404;text='Not found';}
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(text);
 }catch(e){res.writeHead(500);res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await type.launch();const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(()=>window.openAccount(false));
  assert.equal(await page.locator('#my-shift').count(),0);assert((await page.locator('#ms-status').innerText()).includes('Loading your account'));
  await page.locator('[data-view="profile"]').click();assert(await page.locator('[data-panel="profile"]').evaluate(e=>e.hidden));
  // Keep the broken cached payload: the repaired loader must invalidate it.
  await page.evaluate(()=>window.openAccount(true));await page.locator('#ms-status').filter({hasText:/Order updates checked/}).waitFor();
  assert.equal(await page.locator('#my-shift').count(),1);assert.equal(await page.locator('#my-shift .ms-top').count(),0);assert.equal(await page.locator('#nativeHeader').count(),1);
  assert.equal(await page.locator('#ms-menu').isVisible(),false);
  for(const view of ['profile','health','orders','prescriptions','documents','updates','consultations','account','overview']){
   await page.locator('#ms-menu-toggle').click();await page.locator('[data-view="'+view+'"]').click();assert(await page.locator('[data-panel="'+view+'"]').isVisible(),engine+' inactive CTA '+view);assert.equal(await page.locator('#ms-menu-toggle').getAttribute('aria-expanded'),'false');
  }
  assert((await page.locator('#ms-activity').innerText()).includes('No recent order activity'));
  for(const width of [320,390,540,768,1440]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),engine+' overflow '+width);}
  mode='data';await page.locator('#ms-refresh').click();await page.getByText(/FICTIONAL-ORDER/).first().waitFor();assert(!(await page.locator('#ms-status').innerText()).includes('Loading'));
  revoked=true;await page.locator('#ms-refresh').click();await page.waitForFunction(()=>!document.querySelector('#testAccount').textContent.includes('FICTIONAL-ORDER'));assert(!await page.locator('#testAccount').textContent().then(t=>t.includes('fictional@example.test')));
  assert.equal(writes,0);assert.deepEqual(errors,[]);report.engines.push({engine,baselineFaultReproduced:true,brokenCacheRecovered:true,allNineSectionsWork:true,emptyAndPopulated:true,mobileMenuCollapsed:true,widths:[320,390,540,768,1440],revocationClearsContent:true,writes:0,pageErrors:errors});
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
await fs.mkdir('.partner-qa/browser',{recursive:true});await fs.writeFile('.partner-qa/browser/account-boundary.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
