import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {workspacePage,SST_RX_CLIENT,SST_RX_CSS,nextAssignedClinicalRecord} from '../platform/ui.mjs';
import {PROFESSIONAL_DESIGN_CSS} from '../platform/professional-design.mjs';

const origin='https://rx-qa.sstrx.co.uk';
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const record=(n,changes={})=>({
 recordId:id(n),orderNumber:'SST-TEST-NEXT-'+n,memberId:n,
 clinicalStatus:'awaiting_review',rxStatus:'draft',pharmacyStatus:null,
 action:{kind:'review',responsibility:'clinical',label:'Review the assigned TEST evidence',
  owner:{name:'TEST assigned clinician'},dueAt:null,overdue:false,canClaim:false,deadlineState:'not_configured'},
 ...changes
});
const delivered=()=>record(90,{clinicalStatus:'prescription_issued',rxStatus:'issued',pharmacyStatus:'delivered',
 action:{kind:'current',responsibility:null,label:'Delivery recorded; follow the agreed care plan',
  owner:null,dueAt:null,overdue:false,canClaim:false,deadlineState:'not_required'}});
const overview=(records,hasMore=false)=>({
 records,counts:{authorised:records.length},coordination:{unowned:0,overdue:0,deadlineNotConfigured:0},
 role:'clinical',source:'fictional_test_records',services:[],coverage:{hasMore},
 observedAt:new Date().toISOString(),sessionExpiresAt:new Date(Date.now()+600000).toISOString()
});

test('Next clinical work uses only supplied entitled clinical actions, excluding current and other-role work while retaining a new clinical exception on a delivered case',()=>{
 const operations=record(1,{action:{kind:'assignment',responsibility:'operations',overdue:true}});
 const pharmacy=record(2,{action:{kind:'pharmacy',responsibility:'pharmacy',overdue:true}});
 const current=delivered();
 const exception=record(3,{clinicalStatus:'prescription_issued',pharmacyStatus:'delivered',
  action:{kind:'exception',responsibility:'clinical',label:'Review the reported TEST supply problem',overdue:true}});
 const records=[operations,pharmacy,current,{recordId:id(4)},exception];
 const before=JSON.stringify(records);
 assert.equal(nextAssignedClinicalRecord(records),exception);
 assert.equal(JSON.stringify(records),before);
 assert.equal(nextAssignedClinicalRecord([operations,pharmacy,current,{recordId:id(4)}]),null);
 assert.equal(nextAssignedClinicalRecord(null),null);
 assert.equal(nextAssignedClinicalRecord([]),null);
});

test('Next-case ordering uses reported overdue state, active clinical work, due time and stable source order without inventing a readiness decision',()=>{
 const review=record(1,{action:{kind:'review',responsibility:'clinical',overdue:false,dueAt:'2026-11-07T08:00:00.000Z'}});
 const overdueInfo=record(2,{action:{kind:'information',responsibility:'clinical',overdue:true,dueAt:'2026-11-07T07:00:00.000Z'}});
 assert.equal(nextAssignedClinicalRecord([review,overdueInfo]),overdueInfo);
 const overdueReview=record(3,{action:{kind:'review',responsibility:'clinical',overdue:true,dueAt:'2026-11-07T10:00:00.000Z'}});
 assert.equal(nextAssignedClinicalRecord([overdueInfo,overdueReview]),overdueReview);
 const earlier=record(4,{action:{kind:'review',responsibility:'clinical',overdue:true,dueAt:'2026-11-07T09:00:00.000Z'}});
 assert.equal(nextAssignedClinicalRecord([overdueReview,earlier]),earlier);
 const first=record(5),second=record(6),invalidDate=record(7,{action:{kind:'review',responsibility:'clinical',dueAt:'Not supplied'}});
 assert.equal(nextAssignedClinicalRecord([first,second,invalidDate]),first);
 assert.equal(nextAssignedClinicalRecord([invalidDate,review]),review);
 assert.equal(Object.hasOwn(nextAssignedClinicalRecord([review]),'readyToSign'),false);
});

test('Actual next-case UI stays unverified, opens the existing case, qualifies empty coverage and clears private state in both browsers and phone/desktop layouts',async()=>{
 for(const [engine,type]of[['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch({headless:true});
  try{
   for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:900}});
    try{
     const pending=record(10),completed=delivered();
     let data=overview([completed,pending]),denied=false;
     const mutations=[],unexpected=[],pageErrors=[];
     const page=await context.newPage();page.setDefaultTimeout(8000);
     page.on('pageerror',e=>pageErrors.push(e.message));
     await page.addInitScript(()=>{
      window.openedTestCases=[];
      document.addEventListener('sstrx-open-record',e=>window.openedTestCases.push(e.detail));
     });
     const html=workspacePage({
      kind:'clinician',functional:false,commercial:false,
      nativeHtml:'<!doctype html><html><body><section id="clinical"><h2>Existing fictional clinical workspace</h2></section></body></html>',
      messagesHtml:'<main><p>Fictional message view</p></main>'
     });
     const fonts=new Set(['SourceSansPro-Regular.woff','SourceSansPro-Semibold.woff','SourceSansPro-Bold.woff','IBMPlexMono-Regular.woff']);
     await page.route('**/*',async route=>{
      const req=route.request(),u=new URL(req.url());
      if(u.origin!==origin){unexpected.push(req.method()+' '+u.href);return route.fulfill({status:403,body:'External requests are forbidden in this fictional test'});}
      if(!['GET','HEAD'].includes(req.method())){mutations.push(req.method()+' '+u.pathname);return route.fulfill({status:403,json:{error:'test_mutation_forbidden'}});}
      if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:html});
      if(u.pathname==='/assets/sstrx.css')return route.fulfill({contentType:'text/css',body:SST_RX_CSS+PROFESSIONAL_DESIGN_CSS});
      if(u.pathname==='/assets/sstrx.js')return route.fulfill({contentType:'text/javascript',body:SST_RX_CLIENT});
      if(u.pathname==='/assets/sstrx-logo.png')return route.fulfill({status:404,body:''});
      if(u.pathname.startsWith('/professional-fonts/')&&fonts.has(u.pathname.split('/').pop())){
       const bytes=await fs.readFile(new URL('../../professional-fonts/'+u.pathname.split('/').pop(),import.meta.url));
       return route.fulfill({contentType:'font/woff',body:bytes});
      }
      if(u.pathname==='/api/clinical/platform')return route.fulfill(denied?{status:401,json:{error:'test_session_expired'}}:{json:data});
      unexpected.push(req.method()+' '+u.pathname);return route.fulfill({status:404,json:{error:'unexpected_test_request'}});
     });
     await page.goto(origin+'/workspace/overview');
     await page.locator('#rx-next-case code').waitFor();
     assert.equal(await page.locator('#rx-next-case code').textContent(),pending.orderNumber,engine+' '+width);
     assert.equal(await page.locator('[data-rx-readiness]').getAttribute('data-rx-readiness'),'unverified');
     assert.match(await page.locator('[data-rx-readiness]').textContent(),/open the case to check the current evidence and sign gates/);
     assert.equal(await page.locator('#rx-next-case button').count(),1);
     assert.equal(await page.locator('#rx-next-case').getByRole('button',{name:/^(Sign|Approve|Dispense)/}).count(),0);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     await page.getByRole('button',{name:'Open assigned case',exact:true}).click();
     await page.waitForURL(origin+'/workspace/clinical');
     assert.deepEqual(await page.evaluate(()=>window.openedTestCases),[pending.recordId]);
     assert.equal(await page.locator('#rx-heading').textContent(),'Clinical Cases');
     assert.equal(await page.locator('#rx-next-case').isVisible(),false);
     await page.locator('nav [data-rx-view="overview"]').click();
     await page.locator('#rx-next-case code').waitFor();

     data=overview([completed]);
     await page.evaluate(()=>document.dispatchEvent(new Event('partner-order-sync')));
     await page.getByText('No pending clinical action in the loaded assigned records.',{exact:true}).waitFor();
     assert.equal(await page.locator('#rx-next-case code').count(),0);
     assert.equal(await page.getByRole('button',{name:'Open assigned case',exact:true}).count(),0);

     // This deliberately changes coverage only: a bounded view must not retain
     // an unqualified empty claim merely because its record array is unchanged.
     data={...data,coverage:{hasMore:true}};
     await page.evaluate(()=>document.dispatchEvent(new Event('partner-order-sync')));
     await page.getByText('No pending clinical action in this loaded view. More authorised records may remain outside this view.',{exact:true}).waitFor();
     assert.equal(await page.getByText('No pending clinical action in the loaded assigned records.',{exact:true}).count(),0);

     data=overview([pending],true);
     await page.evaluate(()=>document.dispatchEvent(new Event('partner-order-sync')));
     await page.locator('#rx-next-case code').waitFor();
     denied=true;
     await page.evaluate(()=>document.dispatchEvent(new Event('partner-access-denied')));
     await page.getByRole('link',{name:'Return to sign-in',exact:true}).waitFor();
     assert.equal(await page.locator('#rx-next-case').textContent(),'');
     assert.equal(await page.locator('#rx-counts').textContent(),'');
     assert.ok(await page.evaluate(()=>document.documentElement.dataset.rxPrivateClearedAt));
     await page.evaluate(()=>document.dispatchEvent(new Event('partner-order-sync')));
     await page.getByText('Your session has ended. Sign in again to continue.',{exact:false}).waitFor();
     assert.equal(await page.locator('#rx-next-case').textContent(),'');
     assert.deepEqual(mutations,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(pageErrors,[]);
    }finally{await context.close();}
   }
  }finally{await browser.close();}
 }
});
