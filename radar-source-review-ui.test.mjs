import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';

// Entirely fictional local fixtures. Every request is intercepted; no live HQ or API access.
const root=new URL('./',import.meta.url),origin='https://hq-fixture.invalid',api='https://api.shiftsometimber.co.uk',out='radar-source-review-evidence';
mkdirSync(out,{recursive:true});
const original={id:601,status:'published',headline:'Previously reviewed article',region:'UK',regulator:'Fictional source',verification:{verified:true,reason:'Original evidence reviewed'},source_evidence:[{authority:'Original authority',url:'https://example.org/original',title:'Original evidence',source_date:'2026-09-10'}],content_package:{headline:'Previously reviewed article',standfirst:'Original approved summary',article_markdown:'Original reviewed article remains intact.',seo:{title:'Original title'},destinations:['medicine_news']},source_change:{id:99,observed_at:'2026-09-16 10:15:00',source:'Fictional <img src=x onerror=alert(1)> authority',url:'https://example.org/changed?title=%22safe%22',observation:{headline:'Changed <img src=x onerror=alert(1)> announcement',verification:{reason:'New evidence is not a clinical approval'},evidence:[{authority:'Fictional source',title:'Observation <script>alert(1)</script>',source_date:'2026-09-16',url:'javascript:alert(1)'}]}}};
const report={proof:'FICTIONAL_LOCAL_HQ_SOURCE_REVIEW',cases:[],failures:[]},browser=await chromium.launch({headless:true});
try{
 for(const fixture of [
  {name:'owner-desktop',role:'owner',width:1440},
  {name:'editor-mobile',role:'editor',width:390},
  {name:'operations',role:'operations',width:1440},
  {name:'support-cannot-correct',role:'support',width:390},
  {name:'correction-failure-preserves-package',role:'admin',width:1440,failCorrection:true},
  {name:'unchanged-review-kept',role:'owner',width:1440,unchanged:true}
 ]){
  const event=structuredClone(original),requests=[],errors=[];if(fixture.unchanged){event.source_change=null;event.status='approved';}
  const context=await browser.newContext({viewport:{width:fixture.width,height:900},timezoneId:'America/Los_Angeles'}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===origin){
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!['index.html','hq.js','hq-v111.js','hq.css','hq-knowledge-editorial.css','hq-evidence-desk.css','turnstile-auth-v1.js'].includes(name))return route.abort();
    return route.fulfill({status:200,contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html',body:readFileSync(new URL(name,root))});
   }
   if(url.origin!==api)return route.abort();
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-credentials':'true','access-control-allow-headers':'content-type','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'}});
   const headers={'access-control-allow-origin':origin,'access-control-allow-credentials':'true'},send=(data,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
   if(request.method()!=='GET')requests.push({path:url.pathname,method:request.method(),body:request.postDataJSON()});
   if(url.pathname==='/v1/hq/me')return send({ok:true,user:{name:'Fictional reviewer',email:'fixture@example.invalid',role:fixture.role}});
   if(url.pathname==='/v1/crm/stats')return send({stats:{total:0,registered:0,cases:0,pharmacyOrders:0}});
   if(url.pathname==='/v1/crm/people')return send({people:[]});
   if(url.pathname==='/v1/hq/radar/queue')return send({ok:true,events:[event]});
   if(url.pathname==='/v1/hq/radar/publication-jobs')return send({ok:true,jobs:[{id:1,event_id:event.id,status:'queued',created_at:'2026-09-16T09:00:00Z'}]});
   if(url.pathname.endsWith('/correct')){
    if(fixture.failCorrection)return send({ok:false,error:'forbidden'},403);
    event.headline='Changed source announcement';event.content_package={};event.source_evidence=event.source_change.observation.evidence;event.source_change=null;event.status='verified';
    return send({ok:true,status:'verified',source_observation_id:99,message:'Correction started from the changed source. A new article package and approval are required.'});
   }
   if(url.pathname.endsWith('/process')){event.content_package={headline:'Fresh draft',article_markdown:'Fresh evidence-bound article'};event.status='ready_for_review';return send({ok:true,status:'ready_for_review'});}
   return send({ok:true});
  });
  try{
   await page.goto(`${origin}/?view=radar`,{waitUntil:'domcontentloaded'});
   await page.locator('[data-radar-open="601"]').waitFor();
   if(!fixture.unchanged){assert.equal(await page.locator('.radar-source-change-label').count(),1);assert.equal(await page.locator('[data-radar-publish]').count(),0);}
   await page.locator('[data-radar-open="601"]').click();
   const dialog=page.locator('#radarEventEditor');await dialog.waitFor({state:'visible'});
   assert.equal(await dialog.locator('[name=article_markdown]').inputValue(),original.content_package.article_markdown);
   assert.equal(await dialog.locator('[name=headline]').inputValue(),original.headline);
   await page.screenshot({path:`${out}/${fixture.name}-before.png`,fullPage:true});
   if(fixture.unchanged){
    assert.equal(await dialog.locator('[data-radar-correct]').count(),0);assert.equal(await dialog.locator('[data-radar-save]').isEnabled(),true);assert.equal(await dialog.locator('[data-radar-publish-now]').count(),1);
   }else{
    assert.equal(await dialog.locator('[data-radar-save]').isDisabled(),true);assert.equal(await dialog.locator('[data-radar-decide=approve]').isDisabled(),true);assert.equal(await dialog.locator('[data-radar-publish-now]').count(),0);
    assert.match(await dialog.locator('.radar-source-change').textContent(),/16 Sept 2026, 11:15 UK time/);
    assert.equal(await dialog.locator('.radar-source-change img,.radar-source-change script').count(),0);
    assert.equal(await dialog.locator('.radar-source-change a[href^="javascript:"]').count(),0);
    assert.equal(await dialog.locator('.radar-source-change a').first().getAttribute('href'),original.source_change.url);
    assert.equal(await dialog.locator('[name=article_markdown]').getAttribute('readonly'),'');
    if(fixture.role==='support')assert.equal(await dialog.locator('[data-radar-correct]').count(),0);
    else{
     page.once('dialog',async prompt=>{assert.match(prompt.message(),/stop being publicly published/);await prompt.dismiss()});
     await dialog.locator('[data-radar-correct]').click();assert.equal(requests.length,0);assert.equal(event.status,'published');
     await dialog.locator('[name=review_note]').fill('Checked changed primary evidence');
     page.once('dialog',prompt=>prompt.accept());await dialog.locator('[data-radar-correct]').click();
     if(fixture.failCorrection){
      await page.waitForFunction(()=>document.querySelector('#radarEventState')?.textContent.includes('Correction failed'));
      assert.equal(await dialog.locator('[name=article_markdown]').inputValue(),original.content_package.article_markdown);assert.equal(event.status,'published');
     }else{
      await dialog.locator('[data-radar-prepare]').waitFor();assert.equal(await dialog.locator('[name=article_markdown]').inputValue(),'');assert.equal(requests.length,1);assert.equal(await dialog.locator('a[href^="javascript:"]').count(),0);
      assert.equal(requests[0].path,'/v1/hq/radar/events/601/correct');assert.deepEqual(requests[0].body,{note:'Checked changed primary evidence'});
      await dialog.locator('[data-radar-prepare]').click();
      await page.waitForFunction(()=>document.querySelector('#radarEventState')?.textContent==='Draft prepared. Review it before approval.');
      assert.equal(await dialog.locator('[name=article_markdown]').inputValue(),'Fresh evidence-bound article');assert.equal(event.status,'ready_for_review');
      assert.equal(requests.length,2);assert.equal(requests[1].path,'/v1/hq/radar/events/601/process');
      if(fixture.role!=='owner'&&fixture.role!=='admin')assert.equal(await dialog.locator('[data-radar-decide=approve]').isDisabled(),true);
     }
    }
   }
   assert.equal(requests.filter(r=>/approve|publish/.test(r.path)).length,0,'No fixture flow may approve or publish automatically');
   assert.deepEqual(errors,[]);
   const overflow=await dialog.evaluate(el=>el.scrollWidth-el.clientWidth);assert.equal(overflow,0,'Dialog must contain phone content');
   await page.screenshot({path:`${out}/${fixture.name}.png`,fullPage:true});
   report.cases.push({name:fixture.name,role:fixture.role,viewport:fixture.width,ok:true,writePaths:requests.map(r=>r.path),overflow});
  }catch(e){report.failures.push({name:fixture.name,error:e.message});await page.screenshot({path:`${out}/${fixture.name}-failure.png`,fullPage:true});}
  finally{await context.close()}
 }
}finally{await browser.close();writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));assert.equal(report.failures.length,0,'Source review UI fixture checks must pass');
