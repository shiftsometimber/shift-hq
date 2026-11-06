import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {functionalClient} from '../platform/functional-ui.mjs';
test('Assigned-pharmacy mobile UI requires an explicit fictional stock observation and retries saved receipts once without creating another provider event',async()=>{
 for(const [engine,type]of[['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch();
  try{
   const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(8000);let observed=false;const writes=[];
   const order='SST-TEST-PENDING-STOCK',record='10000000-0000-4000-8000-000000000001',old='2026-11-06T10:00:00.000Z';
   await page.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<body data-functional="true" data-rx-kind="dispensing"><main id="rx-native"></main><p id="rx-notice" role="alert"></p></body>'});
    if(u.pathname==='/api/clinical/platform')return route.fulfill({json:{records:[{orderNumber:order,recordId:record}],qaProviderAvailable:true}});
    if(u.pathname==='/api/clinical/platform/lifecycle/'+record)return route.fulfill({json:{requests:[]}});
    if(u.pathname==='/api/clinical/platform/integrations/status')return route.fulfill({json:{simulation:true,transportState:'transport_received',pending:observed?0:1,nextSourceVersion:4,qaStock:{simulation:true,variantId:9911,stockOnHand:14,reserved:2,updatedAt:old,fresh:observed}}});
    if(u.pathname==='/api/clinical/platform/integrations/stock'&&req.method()==='POST'){
     const body=req.postDataJSON();writes.push({path:u.pathname,body});
     assert.equal(body.acknowledgeSyntheticObservation,true);assert.equal(body.stockOnHand,14);assert.equal(body.expectedStockOnHand,14);assert.equal(body.expectedReserved,2);assert.equal(body.expectedUpdatedAt,old);assert.match(body.sourceReference,/^TEST-STOCK-/);observed=true;
     return route.fulfill({json:{simulation:true,stockObservation:{recorded:true,realStockVerified:false},projection:{pending:0,projected:1}}});
    }
    throw Error(engine+' unexpected '+req.method()+' '+u.pathname);
   });
   await page.goto('https://rx-qa.sstrx.co.uk/workspace/dispensing');
   await page.addScriptTag({content:'('+functionalClient.toString()+')();'});
   await page.evaluate(order=>document.dispatchEvent(new CustomEvent('sstrx-open-record',{detail:order})),order);
   await page.getByText('TEST provider · simulated supply',{exact:true}).click();
   const button=page.getByRole('button',{name:'Record fictional stock and retry saved receipt',exact:true});await button.waitFor();
   await button.click();assert.equal(writes.length,0);
   await page.getByRole('checkbox',{name:'I confirm this stock observation is fictional',exact:true}).check();
   await button.evaluate(b=>{b.click();b.click();});
   await page.getByText('Fictional stock observation saved; pending provider receipts reconciled.',{exact:true}).waitFor();
   assert.equal(writes.length,1);
   assert.equal(await page.getByRole('button',{name:'Retry pending native projection',exact:true}).count(),0);
   await page.close();
  }finally{await browser.close();}
 }
});
