// CI-only browser acceptance. No production URLs, accounts, suppliers or messages.
import {chromium,webkit} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const out=new URL('../../.partner-qa/browser/',import.meta.url);await fs.mkdir(out,{recursive:true});
const stats=values=>{const a=[...values].sort((a,b)=>a-b);return {n:a.length,medianMs:(a[(a.length-1)>>1]+a[a.length>>1])/2,p95Ms:a[Math.ceil(a.length*.95)-1],samplesMs:values}};
const report={scope:'Isolated hosted localhost QA, fictional SQLite records and test authority. Actual Chromium/WebKit engines; not Safari-device, production auth/cookies or supplier acceptance.',engines:[]};
for(const [name,engine]of [['chromium',chromium],['webkit',webkit]]){
 const port=name==='chromium'?4178:4179,base='http://127.0.0.1:'+port,server=spawn(process.execPath,['partner-portal/qa/sstrx-server.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stdout.on('data',b=>{if(String(b).includes('acceptance ready'))resolve()});server.once('error',reject);server.once('exit',code=>reject(Error('QA server stopped '+code)));setTimeout(()=>reject(Error('QA server did not become ready')),15000).unref()});
  browser=await engine.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===base||['data:','blob:'].includes(u.protocol)?route.continue():route.abort()});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const measured={engine:name,layouts:[],pageErrors:errors};
  for(const [key,path]of [['before','/baseline'],['after','/']]){const samples=[];for(let i=0;i<20;i++){await page.goto(base+path);await page.waitForFunction(()=>document.documentElement.dataset.partnerShellMs);samples.push(Number(await page.locator('html').getAttribute('data-partner-shell-ms')))}measured[key+'SignInShell']=stats(samples)}
  await page.goto(base+'/qa/enter/clinician');await page.getByRole('button',{name:'Open',exact:true}).waitFor();let documents=0;page.on('request',r=>{if(r.resourceType()==='document')documents++});
  const nav=[];for(let i=0;i<20;i++){const old=JSON.parse(await page.locator('html').getAttribute('data-rx-navigation-ms')||'[]').length;await page.getByRole('link',{name:i%2===0?'Reports':'Overview',exact:true}).click();await page.waitForFunction(n=>JSON.parse(document.documentElement.dataset.rxNavigationMs||'[]').length>n,old);nav.push(JSON.parse(await page.locator('html').getAttribute('data-rx-navigation-ms')).at(-1))}measured.navigation=stats(nav);measured.fullDocumentLoadsDuringNavigation=documents;assert.equal(documents,0);assert(measured.navigation.medianMs<300,'Navigation median exceeds 300ms');assert(measured.navigation.p95Ms<700,'Navigation p95 exceeds 700ms');
  await page.getByRole('link',{name:'Clinical Cases',exact:true}).click();await page.getByRole('button',{name:'Open order TEST-SHARED-1042',exact:true}).click();await page.getByRole('heading',{name:'Member clinical card',exact:true}).waitFor();await page.getByText('Prescription and treatment options',{exact:true}).waitFor();
  for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:1100});await page.getByRole('link',{name:'Overview',exact:true}).click();const bounds=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert(bounds.scroll<=bounds.width+1,JSON.stringify(bounds));assert(await page.getByRole('button',{name:'Open',exact:true}).isVisible());measured.layouts.push({...bounds,requestedWidth:width});}
  await page.getByRole('link',{name:'Messages & Exceptions',exact:true}).click();await page.getByRole('heading',{name:'Your questions',exact:true}).waitFor();
  await context.request.get(base+'/qa/revoke');await page.getByRole('button',{name:'Refresh view',exact:true}).click();await page.getByRole('link',{name:'Return to sign-in',exact:true}).waitFor();assert.equal(await page.getByText('TEST-SHARED-1042',{exact:true}).count(),0);assert.equal(await page.locator('#rx-native').textContent(),'');measured.expiryClearsPrivateContent=true;
  assert.deepEqual(errors,[]);measured.result='PASS';report.engines.push(measured);
 }catch(error){report.engines.push({engine:name,result:'FAIL',error:error.message});throw error;}
 finally{await browser?.close();server.kill();await fs.writeFile(new URL('acceptance.json',out),JSON.stringify(report,null,2)+'\n');}
}
console.log(JSON.stringify(report));
