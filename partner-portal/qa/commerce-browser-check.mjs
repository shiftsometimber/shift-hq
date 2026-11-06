// Real engines over the exact built private stack, with every request handled
// in-process. This proves the UI/native transport contract, not hosted/device
// performance, real Access, processor, pharmacy or professional approval.
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
export async function checkCommerceBrowsers({edge,env,ctx,jwt,memberCookies,sql}){
 const results=[];
 for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]){
  let browser;const errors=[],timings=[],requests=[],multipart=new Map();let cookieNormalisations=0,multipartBridges=0;
  try{
   browser=await type.launch();const context=await browser.newContext({viewport:{width:390,height:844}});context.setDefaultTimeout(12000);
   await context.addCookies([...memberCookies].map(([name,value])=>({name,value,url:'https://my-qa.sstrx.co.uk/',httpOnly:true,secure:true,sameSite:'Lax'})));
   // Playwright's WebKit intercepted request omits multipart Blob bytes. The
   // test bridge captures the actual UI-created FormData values and file bytes
   // before interception; no answers/files are invented by the handler. This
   // does NOT qualify the hosted browser's multipart network transport.
   if(engine==='webkit'){
    await context.exposeBinding('__sstQaMultipart',(_,items)=>{const id=crypto.randomUUID();multipart.set(id,items);return id;});
    await context.addInitScript(()=>{const original=window.fetch;window.fetch=async(input,options={})=>{if(options.body instanceof FormData){const items=[];for(const[k,v]of options.body)items.push([k,typeof v==='string'?v:{bytes:Array.from(new Uint8Array(await v.arrayBuffer())),type:v.type,name:v.name}]);const h=new Headers(options.headers);h.set('X-SST-QA-Multipart',await window.__sstQaMultipart(items));options={...options,headers:h};}return original(input,options);};});
   }
   await context.route('**/*',async route=>{
    try{const q=route.request(),u=new URL(q.url());if(u.origin!=='https://my-qa.sstrx.co.uk')throw Error('Unexpected browser transport refused: '+u.origin);const headers=await q.allHeaders();headers['Cf-Access-Jwt-Assertion']=jwt;
     // Intercepted WebKit requests can omit Cookie. Only the synthetic context's
     // exact URL-scoped jar is used; this does not prove hosted cookie delivery.
     if(!headers.cookie){const c=await context.cookies(q.url());if(c.length){headers.cookie=c.map(x=>x.name+'='+x.value).join('; ');cookieNormalisations++;}}
     let body=['GET','HEAD'].includes(q.method())?undefined:q.postDataBuffer();const captured=headers['x-sst-qa-multipart'];
     if(captured){const items=multipart.get(captured);assert.ok(items,'UI-created multipart capture missing');multipart.delete(captured);body=new FormData();for(const[k,v]of items)if(typeof v==='string')body.set(k,v);else body.set(k,new Blob([Uint8Array.from(v.bytes)],{type:v.type}),v.name);delete headers['x-sst-qa-multipart'];delete headers['content-type'];delete headers['content-length'];multipartBridges++;}
     const start=performance.now(),r=await edge.fetch(new Request(q.url(),{method:q.method(),headers,body}),env,ctx);requests.push({path:u.pathname,method:q.method(),status:r.status});timings.push({path:u.pathname,ms:Math.round((performance.now()-start)*10)/10});await route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())});
    }catch(e){errors.push(e.stack);await route.fulfill({status:500,body:'Synthetic qualification error'});}
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.stack));
   const before=sql.prepare('SELECT COUNT(*) n FROM medicine_orders').get().n;
   await page.goto('https://my-qa.sstrx.co.uk/qa/start');await page.getByRole('button',{name:'Submit fictional assessment and open simulated checkout',exact:true}).click();
   await page.waitForURL(/\/qa\/checkout\/cs_test_QA_[a-f0-9]{32}$/);await page.getByRole('button',{name:'Simulate payment received',exact:true}).click();
   const assessment=page.getByRole('link',{name:'Continue the native assessment',exact:true});await assessment.waitFor();const href=await assessment.getAttribute('href');assert.match(href,/^\/member\/treatment-records\?record=[a-f0-9-]{36}$/);
   const recordId=new URL(href,'https://my-qa.sstrx.co.uk').searchParams.get('record'),record=sql.prepare('SELECT * FROM clinical_member_records WHERE id=?').get(recordId);assert.ok(record);assert.equal(sql.prepare('SELECT COUNT(*) n FROM medicine_orders').get().n,before+1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM clinical_member_records WHERE order_number=?').get(record.order_number).n,1);
   assert.equal(sql.prepare('SELECT status FROM medicine_orders WHERE order_number=?').get(record.order_number).status,'paid');assert.notEqual(record.status,'approved');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await assessment.click();await page.waitForURL(/\/member\/treatment-records\?record=/);await page.getByText('Step 1 of 14',{exact:true}).waitFor();await page.getByLabel('Full name',{exact:true}).waitFor();await page.getByLabel('Date of birth',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const hq=await env.CLINICAL.fetch(new Request('https://api.shiftsometimber.co.uk/v1/member/my-shift',{headers:{Origin:'https://my-timber.app',Cookie:[...memberCookies].map(([k,v])=>k+'='+v).join('; ')}}));assert.equal(hq.status,200);const state=await hq.json();assert.equal(state.orders.find(o=>o.reference===record.order_number)?.recordId,recordId);
   assert.deepEqual(errors,[]);results.push({engine,browserVersion:browser.version(),result:'PASS',orderReference:record.order_number,caseReference:recordId,oneOrderOneCase:true,nativeAssessmentRendered:true,clinicalApprovalGranted:false,horizontalOverflow:false,requests,timings,cookieNormalisations,multipartBridges,scope:'Local intercepted exact built stack; WebKit retains actual UI-created FormData bytes through a test bridge. Hosted multipart upload, cookie delivery, timing and physical devices remain unverified'});await context.close();
  }catch(e){results.push({engine,result:'FAIL',error:e.stack,errors,requests,browserState:await browser?.contexts()[0]?.pages()[0]?.locator('body').innerText().catch(()=>null)});throw Object.assign(e,{browserResults:results});}
  finally{await browser?.close();}
 }
 return results;
}
