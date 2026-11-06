import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const source=await fs.readFile(new URL('../../hq.js',import.meta.url),'utf8'),start=source.indexOf('    function installWebsiteUpdater(){'),end=source.indexOf('\n    rationaliseKnowledgeNavigation();',start),install=source.slice(start,end);
test('Retained Website editor saves a versioned draft, preserves other edits, recovers a lost response and refuses a stale overwrite',async()=>{
 for(const type of [chromium,webkit]){
 const browser=await type.launch({headless:true});try{
 for(const width of [390,1280])for(const scenario of ['saved','lost','stale']){
 const page=await browser.newPage({viewport:{width,height:844}});
 const rows=[{id:7,label:'TEST first',page_path:'/__test-only',status:'published',version:1,draft_text:'Old draft',published_text:'Approved published copy'},{id:8,label:'TEST second',page_path:'/__test-second',status:'draft',version:4,draft_text:'Second saved draft',published_text:null}];let writes=0;
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><nav><button data-view="website">Website</button></nav><section id="website"><div class="toolbar"><p class="sub"></p><button id="refresh">Refresh</button></div><div id="newContent"></div><div id="contentList"></div></section></body>'});
  if(u.pathname==='/v1/hq/site-content'&&req.method()==='GET')return route.fulfill({json:{content:rows,deliveryState:{status:'unavailable',reason:'TEST delivery not bound'}}});
  if(u.pathname==='/v1/hq/site-content/7'&&req.method()==='PATCH'){
   const body=req.postDataJSON();assert.equal(body.action,'save');assert.equal(body.expectedVersion,1);assert.equal(body.text,'New fictional draft');writes++;
   if(scenario==='stale'){rows[0].version=2;rows[0].draft_text='Another approved edit';return route.fulfill({status:409,json:{error:'version_conflict'}});}
   rows[0].version=2;rows[0].draft_text=body.text;assert.equal(rows[0].published_text,'Approved published copy');assert.equal(rows[0].status,'published');
   if(scenario==='lost')return route.fulfill({status:503,json:{error:'TEST_lost_after_commit'}});
   return route.fulfill({json:{saved:true,status:'published',version:2}});
  }
  throw Error('Unapproved Website request '+req.method()+' '+u.pathname);
 });
 const load=async()=>{
  await page.goto('https://hq-qa.sstrx.co.uk/');
  await page.addScriptTag({content:"window.$=s=>document.querySelector(s);window.$$=s=>[...document.querySelectorAll(s)];window.esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('\"','&quot;');window.badge=s=>esc(s);window.radarCall=async(p,o)=>{const r=await fetch(p,o);const d=await r.json();if(!r.ok)throw Error(d.error||'unavailable');return d;};("+install+")();document.querySelector('#refresh').click();"});
  await page.getByRole('button',{name:'Save draft',exact:true}).first().waitFor();
 };
 await load();assert.equal(await page.locator('[data-site-publish="7"]').isDisabled(),true);await page.getByLabel('TEST second text',{exact:true}).fill('Unsaved second draft');await page.getByLabel('TEST first text',{exact:true}).fill('New fictional draft');await page.locator('[data-site-save="7"]').click();
 if(scenario==='stale'){
  await page.getByText('This field changed since you opened it. Your text is still here; refresh the current record before retrying.',{exact:true}).waitFor();assert.equal(await page.getByLabel('TEST first text',{exact:true}).inputValue(),'New fictional draft');assert.equal(rows[0].draft_text,'Another approved edit');
 }else{
  await page.getByText('Draft saved. Current publication retained.',{exact:true}).waitFor();assert.equal(await page.locator('[data-site-content="7"]').getAttribute('data-site-content-version'),'2');assert.equal(await page.getByLabel('TEST second text',{exact:true}).inputValue(),'Unsaved second draft');assert.equal(rows[0].published_text,'Approved published copy');await load();assert.equal(await page.getByLabel('TEST first text',{exact:true}).inputValue(),'New fictional draft');
 }
 assert.equal(writes,1);await page.close();
 }
 }finally{await browser.close()}
 }
});
